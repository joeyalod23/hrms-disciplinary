const express = require('express');
const { getDB } = require('../db/schema');
const { verifyToken } = require('../middleware/auth');
const { logAudit } = require('../middleware/audit');

const router = express.Router();

router.get('/', verifyToken, (req, res) => {
  const db = getDB();
  const loading = db.prepare('SELECT * FROM manpower_loading ORDER BY is_subcon, trade').all();
  const periods = db.prepare('SELECT * FROM manpower_periods ORDER BY sort_order').all() || [];
  const values = db.prepare('SELECT * FROM manpower_loading_values').all() || [];

  const valMap = {};
  values.forEach(v => { valMap[v.loading_id + '-' + v.period_id] = v.value; });
  loading.forEach(l => {
    l.vals = {};
    periods.forEach(p => { l.vals[p.id] = valMap[l.id + '-' + p.id] || 0; });
  });

  const directItems = loading.filter(l => l.category === 'Direct' && !l.is_subcon);
  const subconItems = loading.filter(l => l.is_subcon);
  const indirectItems = loading.filter(l => l.category === 'Indirect');

  const sumVals = (items, pid) => items.reduce((s, i) => s + (Number(i.vals[pid]) || 0), 0);
  const sum = (items, f) => items.reduce((s, i) => s + (Number(i[f]) || 0), 0);

  const tDirect = { required: sum([...directItems, ...subconItems], 'required_bow'), balance: sum([...directItems, ...subconItems], 'balance') };
  const tIndirect = { required: sum(indirectItems, 'required_bow'), balance: sum(indirectItems, 'balance') };
  periods.forEach(p => {
    tDirect[p.id] = sumVals([...directItems, ...subconItems], p.id);
    tIndirect[p.id] = sumVals(indirectItems, p.id);
  });

  const lastP = periods[periods.length - 1];
  const teams = db.prepare('SELECT t.*, (SELECT COUNT(*) FROM employee_team_assignments eta JOIN employees e ON eta.employee_id = e.id WHERE eta.team_id = t.id AND eta.is_active = 1 AND e.status = \'Active\') as c FROM teams t WHERE t.is_active = 1 ORDER BY t.name').all();
  const totalActive = db.prepare("SELECT COUNT(*) as c FROM employees WHERE status = 'Active'").get().c;
  const totalByTrade = db.prepare("SELECT trade, COUNT(*) as c FROM employees WHERE status = 'Active' AND trade IS NOT NULL GROUP BY trade ORDER BY c DESC").all();
  const allEmps = db.prepare("SELECT id, employee_id, full_name, trade, position FROM employees WHERE status = 'Active' ORDER BY full_name").all();
  const tradeEmps = {};
  allEmps.forEach(e => { if (e.trade) { if (!tradeEmps[e.trade]) tradeEmps[e.trade] = []; tradeEmps[e.trade].push(e); } });
  const assignments = db.prepare('SELECT ma.*, e.full_name, e.employee_id, e.trade as emp_trade, t.name as team_name FROM manpower_assignments ma JOIN employees e ON ma.employee_id = e.id LEFT JOIN teams t ON ma.team_id = t.id WHERE ma.is_active = 1 ORDER BY t.name, e.full_name').all();

  res.render('manpower/index', {
    loading, periods, directItems, subconItems, indirectItems,
    tDirect, tIndirect,
    adminReq: sum(directItems, 'required_bow'),
    subconReq: sum(subconItems, 'required_bow'),
    activeAdmin: lastP ? sumVals(directItems, lastP.id) : 0,
    activeSubcon: lastP ? sumVals(subconItems, lastP.id) : 0,
    subconBal: sum(subconItems, 'balance'),
    teams, totalActive, totalByTrade, tradeEmps, allEmps,
    assignments, totalAssignments: assignments.length
  });
});

router.post('/loading/add', verifyToken, (req, res) => {
  const db = getDB();
  const { category, trade, is_subcon, required_bow, balance } = req.body;
  db.prepare('INSERT INTO manpower_loading (category, trade, is_subcon, required_bow, balance, updated_by) VALUES (?,?,?,?,?,?)')
    .run(category || 'Direct', trade, is_subcon ? 1 : 0, required_bow || 0, balance || 0, req.user.id);
  logAudit(req, 'Add Manpower', 'Manpower', null, trade);
  res.redirect('/manpower');
});

router.get('/loading/edit/:id', verifyToken, (req, res) => {
  const db = getDB();
  const item = db.prepare('SELECT * FROM manpower_loading WHERE id = ?').get(req.params.id);
  const periods = db.prepare('SELECT * FROM manpower_periods ORDER BY sort_order').all();
  const values = db.prepare('SELECT * FROM manpower_loading_values WHERE loading_id = ?').all(req.params.id);
  const valMap = {};
  values.forEach(v => { valMap[v.period_id] = v.value; });
  if (!item) return res.redirect('/manpower');
  res.render('manpower/edit', { item, periods, values: valMap });
});

router.post('/loading/update/:id', verifyToken, (req, res) => {
  const db = getDB();
  const { trade, category, is_subcon, required_bow, balance } = req.body;
  db.prepare('UPDATE manpower_loading SET trade=?, category=?, is_subcon=?, required_bow=?, balance=? WHERE id=?')
    .run(trade, category, is_subcon ? 1 : 0, required_bow || 0, balance || 0, req.params.id);
  const periods = db.prepare('SELECT id FROM manpower_periods').all();
  const upsert = db.prepare('INSERT OR REPLACE INTO manpower_loading_values (loading_id, period_id, value) VALUES (?,?,?)');
  periods.forEach(p => {
    const key = 'val_' + p.id;
    if (req.body[key] !== undefined) {
      upsert.run(req.params.id, p.id, req.body[key] || 0);
    }
  });
  // Recompute balance
  const loading = db.prepare('SELECT * FROM manpower_loading WHERE id = ?').get(req.params.id);
  if (loading) {
    const lastP = db.prepare('SELECT id FROM manpower_periods ORDER BY sort_order DESC').get();
    if (lastP) {
      const pv = db.prepare('SELECT value FROM manpower_loading_values WHERE loading_id = ? AND period_id = ?').get(req.params.id, lastP.id);
      const bal = (loading.required_bow || 0) - (pv ? (pv.value || 0) : 0);
      db.prepare('UPDATE manpower_loading SET balance = ? WHERE id = ?').run(bal, req.params.id);
    }
  }
  logAudit(req, 'Update Manpower', 'Manpower', req.params.id, trade);
  res.redirect('/manpower');
});

router.get('/loading/delete/:id', verifyToken, (req, res) => {
  const db = getDB();
  db.prepare('DELETE FROM manpower_loading WHERE id = ?').run(req.params.id);
  res.redirect('/manpower');
});

router.post('/loading/save-val', verifyToken, (req, res) => {
  const db = getDB();
  const { loading_id, period_id, value } = req.body;
  db.prepare('INSERT OR REPLACE INTO manpower_loading_values (loading_id, period_id, value) VALUES (?,?,?)').run(loading_id, period_id, value || 0);
  const l = db.prepare('SELECT * FROM manpower_loading WHERE id = ?').get(loading_id);
  if (l) {
    const lastP = db.prepare('SELECT id FROM manpower_periods ORDER BY sort_order DESC').get();
    if (lastP) {
      const pv = db.prepare('SELECT value FROM manpower_loading_values WHERE loading_id = ? AND period_id = ?').get(loading_id, lastP.id);
      const bal = (l.required_bow || 0) - (pv ? (pv.value || 0) : 0);
      db.prepare('UPDATE manpower_loading SET balance = ? WHERE id = ?').run(bal, loading_id);
    }
  }
  res.redirect('/manpower');
});

router.post('/period/add', verifyToken, (req, res) => {
  const db = getDB();
  const { label } = req.body;
  if (!label || !label.trim()) return res.redirect('/manpower');
  const mx = db.prepare('SELECT COALESCE(MAX(sort_order),0) as m FROM manpower_periods').get().m;
  db.prepare('INSERT INTO manpower_periods (label, sort_order) VALUES (?,?)').run(label.trim(), mx + 1);
  logAudit(req, 'Add Period', 'Manpower', null, label);
  res.redirect('/manpower');
});

router.get('/period/delete/:id', verifyToken, (req, res) => {
  const db = getDB();
  db.prepare('DELETE FROM manpower_periods WHERE id = ?').run(req.params.id);
  res.redirect('/manpower');
});

router.post('/trade/add-emp', verifyToken, (req, res) => {
  const db = getDB();
  const { employee_id, trade } = req.body;
  if (!employee_id || !trade) return res.redirect('/manpower');
  db.prepare('UPDATE employees SET trade = ?, project_site = COALESCE(project_site,?) WHERE id = ?').run(trade, 'Vail Land Development', employee_id);
  logAudit(req, 'Add Emp to Trade', 'Manpower', employee_id, trade);
  res.redirect('/manpower');
});

router.get('/trade/remove-emp/:id', verifyToken, (req, res) => {
  const db = getDB();
  const e = db.prepare('SELECT trade FROM employees WHERE id = ?').get(req.params.id);
  if (e) { db.prepare('UPDATE employees SET trade = NULL WHERE id = ?').run(req.params.id); logAudit(req, 'Remove Emp from Trade', 'Manpower', req.params.id, e.trade); }
  res.redirect('/manpower');
});

router.post('/assign', verifyToken, (req, res) => {
  const db = getDB();
  const { employee_id, project_site, trade, team_id } = req.body;
  db.prepare("UPDATE manpower_assignments SET is_active = 0, date_ended = date('now') WHERE employee_id = ? AND is_active = 1").run(employee_id);
  db.prepare('INSERT INTO manpower_assignments (employee_id, project_site, trade, team_id, created_by) VALUES (?,?,?,?,?)').run(employee_id, project_site || 'Vail Land Development', trade, team_id || null, req.user.id);
  db.prepare('UPDATE employees SET trade = ?, project_site = ? WHERE id = ?').run(trade, project_site || 'Vail Land Development', employee_id);
  logAudit(req, 'Assign Employee', 'Manpower', employee_id, trade + ' -> ' + project_site);
  res.redirect('/manpower');
});

router.get('/unassign/:id', verifyToken, (req, res) => {
  const db = getDB();
  db.prepare("UPDATE manpower_assignments SET is_active = 0, date_ended = date('now') WHERE id = ?").run(req.params.id);
  res.redirect('/manpower');
});

router.get('/api/employees', verifyToken, (req, res) => {
  const db = getDB();
  const q = req.query.q || '';
  res.json(db.prepare("SELECT id, employee_id, full_name, trade FROM employees WHERE status = 'Active' AND (full_name LIKE ? OR employee_id LIKE ?) LIMIT 20").all('%' + q + '%', '%' + q + '%'));
});

router.get('/teams', verifyToken, (req, res) => {
  const db = getDB();
  const positions = db.prepare("SELECT DISTINCT position FROM employees WHERE status = 'Active' AND position IS NOT NULL AND position != '' ORDER BY position").all().map(p => p.position);
  const groups = positions.map(pos => ({ position: pos, employees: db.prepare('SELECT id, employee_id, full_name, position, trade, department FROM employees WHERE status = \'Active\' AND position = ? ORDER BY full_name').all(pos), count: db.prepare('SELECT COUNT(*) as c FROM employees WHERE status = \'Active\' AND position = ?').get(pos).c }));
  res.render('manpower/teams', { groups, total: groups.reduce((s, g) => s + g.count, 0) });
});

router.post('/teams/add', verifyToken, (req, res) => {
  const db = getDB();
  const { name, leadman, foreman } = req.body;
  if (!name || !name.trim()) return res.redirect('/manpower');
  db.prepare('INSERT INTO teams (name, leadman, foreman) VALUES (?,?,?)').run(name.trim(), leadman || null, foreman || null);
  res.redirect('/manpower');
});

router.get('/teams/delete/:id', verifyToken, (req, res) => {
  const db = getDB();
  db.prepare('UPDATE teams SET is_active = 0 WHERE id = ?').run(req.params.id);
  res.redirect('/manpower/teams');
});

router.post('/teams/add-member', verifyToken, (req, res) => {
  const db = getDB();
  const { team_id, employee_id } = req.body;
  db.prepare("UPDATE employee_team_assignments SET is_active = 0, end_date = date('now') WHERE employee_id = ? AND is_active = 1").run(employee_id);
  db.prepare('INSERT INTO employee_team_assignments (employee_id, team_id) VALUES (?,?)').run(employee_id, team_id);
  res.redirect('/manpower/teams');
});

router.get('/teams/remove-member/:id', verifyToken, (req, res) => {
  const db = getDB();
  db.prepare("UPDATE employee_team_assignments SET is_active = 0, end_date = date('now') WHERE id = ?").run(req.params.id);
  res.redirect('/manpower/teams');
});

module.exports = router;
