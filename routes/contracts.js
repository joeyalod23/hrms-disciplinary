const express = require('express');
const { getDB } = require('../db/schema');
const { verifyToken } = require('../middleware/auth');
const { logAudit } = require('../middleware/audit');
const { notifyContractExpiry } = require('../services/notification');
const { syncData } = require('../services/data-sync');

const router = express.Router();

function branchClause(req, alias) {
  const bid = req.user?.branch_id;
  if (bid) return ` AND ${alias}.branch_id = ${parseInt(bid)}`;
  return '';
}

function employeeBranchClause(req) {
  const bid = req.user?.branch_id;
  if (bid) return ` AND c.employee_id IN (SELECT id FROM employees WHERE branch_id = ${parseInt(bid)})`;
  return '';
}

router.get('/', verifyToken, (req, res) => {
  syncData();
  const db = getDB();
  const page = parseInt(req.query.page) || 1;
  const limit = 20;
  const offset = (page - 1) * limit;
  const status = req.query.status || '';
  const search = req.query.search || '';
  const expiring = req.query.expiring || '';
  const bc = branchClause(req, 'e');

  let query = `SELECT e.full_name, e.employee_id AS emp_rec_id, e.position, e.trade, e.id AS emp_id, c.* FROM employees e LEFT JOIN contracts c ON c.employee_id = e.id AND c.id = (SELECT c2.id FROM contracts c2 WHERE c2.employee_id = e.id ORDER BY c2.id DESC LIMIT 1) WHERE e.status = 'Active'${bc}`;
  let countQuery = `SELECT COUNT(*) as count FROM employees e LEFT JOIN contracts c ON c.employee_id = e.id AND c.id = (SELECT c2.id FROM contracts c2 WHERE c2.employee_id = e.id ORDER BY c2.id DESC LIMIT 1) WHERE e.status = 'Active'${bc}`;
  const params = [];

  if (status === 'No Contract') {
    query += ' AND c.id IS NULL';
    countQuery += ' AND c.id IS NULL';
  } else if (status) {
    query += ' AND c.status = ?';
    countQuery += ' AND c.status = ?';
    params.push(status);
  }
  if (search) { query += " AND (e.full_name LIKE ? OR e.employee_id LIKE ?)"; countQuery += " AND (e.full_name LIKE ? OR e.employee_id LIKE ?)"; params.push(`%${search}%`, `%${search}%`); }
  if (expiring) { query += " AND c.end_date BETWEEN date('now') AND date('now', '+60 days') AND c.status = 'Active'"; countQuery += " AND c.end_date BETWEEN date('now') AND date('now', '+60 days') AND c.status = 'Active'"; }

  query += ' ORDER BY e.full_name ASC LIMIT ? OFFSET ?';
  const totalParams = [...params];
  params.push(limit, offset);

  const contracts = db.prepare(query).all(...params);
  const now = new Date();
  contracts.forEach(c => {
    if (c.end_date && c.status === 'Active') {
      const daysLeft = Math.ceil((new Date(c.end_date) - now) / (1000 * 60 * 60 * 24));
      c.is_expiring = daysLeft >= 0 && daysLeft <= 60;
      c.days_left = daysLeft;
    } else {
      c.is_expiring = false;
      c.days_left = null;
    }
  });
  const total = db.prepare(countQuery).get(...totalParams).count;

  const bid = req.user?.branch_id;
  const branchFilter = bid ? ` AND branch_id = ${parseInt(bid)}` : '';
  const expiringCount = db.prepare(`SELECT COUNT(*) as c FROM contracts WHERE end_date BETWEEN date('now') AND date('now', '+60 days') AND status = 'Active'${branchFilter}`).get().c;
  const activeCount = db.prepare(`SELECT COUNT(*) as c FROM contracts WHERE status = 'Active'${branchFilter}`).get().c;
  const expiredCount = db.prepare(`SELECT COUNT(*) as c FROM contracts WHERE status = 'Expired'${branchFilter}`).get().c;
  const totalEmployees = bid
    ? db.prepare(`SELECT COUNT(*) as c FROM employees WHERE status = 'Active' AND branch_id = ?`).get(bid).c
    : db.prepare("SELECT COUNT(*) as c FROM employees WHERE status = 'Active'").get().c;
  const noContractCount = bid
    ? db.prepare(`SELECT COUNT(*) as c FROM employees e WHERE e.status = 'Active' AND e.branch_id = ? AND NOT EXISTS (SELECT 1 FROM contracts c WHERE c.employee_id = e.id)`).get(bid).c
    : db.prepare("SELECT COUNT(*) as c FROM employees e WHERE e.status = 'Active' AND NOT EXISTS (SELECT 1 FROM contracts c WHERE c.employee_id = e.id)").get().c;

  res.render('contracts/index', { contracts, total, page, limit, status, search, expiring, pages: Math.ceil(total / limit), expiringCount, activeCount, expiredCount, totalEmployees, noContractCount });
});

router.get('/add', verifyToken, (req, res) => {
  const db = getDB();
  const bid = req.user?.branch_id;
  const preselect = req.query.emp || '';
  const employees = bid
    ? db.prepare("SELECT id, employee_id, full_name, position FROM employees WHERE status = 'Active' AND branch_id = ? ORDER BY full_name").all(bid)
    : db.prepare("SELECT id, employee_id, full_name, position FROM employees WHERE status = 'Active' ORDER BY full_name").all();
  res.render('contracts/form', { contract: null, employees, today: new Date().toISOString().split('T')[0], preselect });
});

router.post('/add', verifyToken, (req, res) => {
  const db = getDB();
  const { employee_id, contract_type, daily_rate, monthly_rate, start_date, end_date, project_site, remarks } = req.body;
  const assignedBranchId = req.user?.branch_id || null;
  const result = db.prepare(
    `INSERT INTO contracts (employee_id, contract_type, daily_rate, monthly_rate, start_date, end_date, project_site, remarks, created_by, branch_id) VALUES (?,?,?,?,?,?,?,?,?,?)`
  ).run(employee_id, contract_type, daily_rate||null, monthly_rate||null, start_date, end_date, project_site||'Vail Land Development', remarks||null, req.user.id, assignedBranchId);
  db.prepare(`UPDATE employees SET daily_rate=?, monthly_rate=?, date_hired=COALESCE(date_hired, ?), date_ended=? WHERE id=?`).run(daily_rate||null, monthly_rate||null, start_date, end_date, employee_id);
  try {
    const contract = db.prepare('SELECT * FROM contracts WHERE id = ?').get(result.lastInsertRowid);
    if (contract && contract.end_date) {
      const daysUntilExpiry = Math.ceil((new Date(contract.end_date) - new Date()) / (1000 * 60 * 60 * 24));
      if (daysUntilExpiry <= 30 && daysUntilExpiry >= 0) {
        const employee = db.prepare('SELECT * FROM employees WHERE id = ?').get(employee_id);
        if (employee && employee.email) notifyContractExpiry(employee, contract);
      }
    }
  } catch (err) {
    console.error('Failed to send contract expiry notification:', err);
  }
  logAudit(req, 'Add Contract', 'Contract', result.lastInsertRowid, `${employee_id} - ${start_date} to ${end_date}`);
  res.redirect('/contracts');
});

router.get('/edit/:id', verifyToken, (req, res) => {
  const db = getDB();
  const contract = db.prepare('SELECT * FROM contracts WHERE id = ?').get(req.params.id);
  if (!contract) return res.redirect('/contracts');
  const employees = db.prepare("SELECT id, employee_id, full_name, position FROM employees ORDER BY full_name").all();
  res.render('contracts/form', { contract, employees, today: '' });
});

router.post('/edit/:id', verifyToken, (req, res) => {
  const db = getDB();
  const { employee_id, contract_type, daily_rate, monthly_rate, start_date, end_date, status, project_site, remarks } = req.body;
  db.prepare(`UPDATE contracts SET employee_id=?, contract_type=?, daily_rate=?, monthly_rate=?, start_date=?, end_date=?, status=?, project_site=?, remarks=? WHERE id=?`)
    .run(employee_id, contract_type, daily_rate||null, monthly_rate||null, start_date, end_date, status, project_site, remarks||null, req.params.id);
  db.prepare(`UPDATE employees SET daily_rate=COALESCE(?, daily_rate), monthly_rate=COALESCE(?, monthly_rate), date_hired=COALESCE(date_hired, ?), date_ended=? WHERE id=?`).run(daily_rate, monthly_rate, start_date, end_date, employee_id);
  try {
    const contract = db.prepare('SELECT * FROM contracts WHERE id = ?').get(req.params.id);
    if (contract && contract.end_date && contract.status === 'Active') {
      const daysUntilExpiry = Math.ceil((new Date(contract.end_date) - new Date()) / (1000 * 60 * 60 * 24));
      if (daysUntilExpiry <= 30 && daysUntilExpiry >= 0) {
        const employee = db.prepare('SELECT * FROM employees WHERE id = ?').get(contract.employee_id);
        if (employee && employee.email) notifyContractExpiry(employee, contract);
      }
    }
  } catch (err) {
    console.error('Failed to send contract expiry notification:', err);
  }
  logAudit(req, 'Edit Contract', 'Contract', req.params.id);
  res.redirect('/contracts');
});

router.get('/:id', verifyToken, (req, res) => {
  res.redirect(`/contracts/view/${req.params.id}`);
});

router.get('/view/:id', verifyToken, (req, res) => {
  const db = getDB();
  const contract = db.prepare(`SELECT c.*, e.full_name AS employee_name, e.employee_id, e.position, e.trade, e.department FROM contracts c JOIN employees e ON c.employee_id = e.id WHERE c.id = ?`).get(req.params.id);
  if (!contract) return res.redirect('/contracts');
  const extensions = db.prepare(`SELECT * FROM contract_extensions WHERE contract_id = ? ORDER BY extension_date_from ASC`).all(req.params.id);
  res.render('contracts/view', { contract, extensions });
});

router.post('/extend/:id', verifyToken, (req, res) => {
  const db = getDB();
  const { extension_date_from, extension_date_to, reason, memo_number } = req.body;
  const contract = db.prepare('SELECT * FROM contracts WHERE id = ?').get(req.params.id);
  if (!contract) return res.redirect('/contracts');
  db.prepare(`INSERT INTO contract_extensions (contract_id, employee_id, extension_date_from, extension_date_to, reason, memo_number, created_by) VALUES (?,?,?,?,?,?,?)`)
    .run(req.params.id, contract.employee_id, extension_date_from, extension_date_to, reason||null, memo_number||null, req.user.id);
  db.prepare(`UPDATE contracts SET end_date = ?, status = 'Active' WHERE id = ?`).run(extension_date_to, req.params.id);
  db.prepare(`UPDATE employees SET date_ended = ? WHERE id = ?`).run(extension_date_to, contract.employee_id);
  try {
    const contract = db.prepare('SELECT * FROM contracts WHERE id = ?').get(req.params.id);
    if (contract && contract.end_date) {
      const daysUntilExpiry = Math.ceil((new Date(contract.end_date) - new Date()) / (1000 * 60 * 60 * 24));
      if (daysUntilExpiry <= 30 && daysUntilExpiry >= 0) {
        const employee = db.prepare('SELECT * FROM employees WHERE id = ?').get(contract.employee_id);
        if (employee && employee.email) notifyContractExpiry(employee, contract);
      }
    }
  } catch (err) {
    console.error('Failed to send contract expiry notification:', err);
  }
  logAudit(req, 'Extend Contract', 'Contract', req.params.id, `${extension_date_from} to ${extension_date_to}`);
  res.redirect(`/contracts/view/${req.params.id}`);
});

router.get('/export', verifyToken, (req, res) => {
  const db = getDB();
  const bc = branchClause(req, 'e');
  const contracts = db.prepare(`
    SELECT e.employee_id, e.full_name, e.position, e.trade, c.contract_type, c.daily_rate, c.monthly_rate, c.start_date, c.end_date, c.status, c.project_site, c.remarks
    FROM employees e LEFT JOIN contracts c ON c.employee_id = e.id AND c.id = (SELECT c2.id FROM contracts c2 WHERE c2.employee_id = e.id ORDER BY c2.id DESC LIMIT 1) WHERE e.status = 'Active'${bc} ORDER BY e.full_name ASC
  `).all();
  let csv = 'Employee ID,Name,Position,Trade,Type,Daily Rate,Monthly Rate,Start Date,End Date,Status,Project Site,Remarks\n';
  for (const c of contracts) {
    csv += `"${c.employee_id}","${c.full_name}","${c.position||''}","${c.trade||''}","${c.contract_type||'No Contract'}","${c.daily_rate||''}","${c.monthly_rate||''}","${c.start_date||''}","${c.end_date||''}","${c.status||'No Contract'}","${c.project_site||''}","${(c.remarks||'').replace(/"/g,'""')}"\n`;
  }
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=contracts_export.csv');
  res.send(csv);
});

module.exports = router;
