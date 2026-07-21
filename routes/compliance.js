const express = require('express');
const { getDB } = require('../db/schema');
const { verifyToken, requireRole } = require('../middleware/auth');
const { logAudit } = require('../middleware/audit');

const router = express.Router();

router.get('/', verifyToken, (req, res) => {
  const db = getDB();

  db.prepare("UPDATE compliance_calendar SET status = 'Overdue' WHERE status = 'Pending' AND due_date < date('now', 'localtime')").run();

  const items = db.prepare('SELECT * FROM compliance_calendar ORDER BY due_date ASC').all();
  res.render('compliance/index', { items });
});

router.post('/add', verifyToken, requireRole('admin', 'hrd'), (req, res) => {
  const db = getDB();
  const { title, description, module, reference_id, due_date, priority } = req.body;
  db.prepare('INSERT INTO compliance_calendar (title, description, module, reference_id, due_date, priority, created_by) VALUES (?,?,?,?,?,?,?)')
    .run(title, description||null, module, reference_id||null, due_date, priority||'Normal', req.user.id);
  logAudit(req, 'Add Compliance Item', 'Compliance', null, title);
  res.redirect('/compliance');
});

router.post('/status', verifyToken, (req, res) => {
  const db = getDB();
  const id = req.body.id;
  if (!id) return res.redirect('/compliance');
  const current = db.prepare('SELECT status FROM compliance_calendar WHERE id = ?').get(id);
  if (!current || current.status === 'Completed') return res.redirect('/compliance');
  const { status } = req.body;
  if (!['Pending', 'Overdue', 'Completed'].includes(status)) return res.status(400).send('Invalid status');
  if (status === 'Completed') {
    db.prepare("UPDATE compliance_calendar SET status = 'Completed', completed_date = date('now', 'localtime'), completed_by = ? WHERE id = ?").run(req.user.id, id);
  } else {
    db.prepare("UPDATE compliance_calendar SET status = ?, completed_date = NULL, completed_by = NULL WHERE id = ?").run(status, id);
  }
  logAudit(req, 'Update Compliance Status', 'Compliance', id, `Status changed to ${status}`);
  res.redirect('/compliance');
});

router.get('/complete/:id', verifyToken, (req, res) => {
  const db = getDB();
  db.prepare("UPDATE compliance_calendar SET status = 'Completed', completed_date = date('now', 'localtime'), completed_by = ? WHERE id = ?").run(req.user.id, req.params.id);
  res.redirect('/compliance');
});

router.get('/delete/:id', verifyToken, requireRole('admin', 'hrd'), (req, res) => {
  const db = getDB();
  db.prepare('DELETE FROM compliance_calendar WHERE id = ?').run(req.params.id);
  res.redirect('/compliance');
});

router.post('/auto-generate', verifyToken, requireRole('admin', 'hrd'), (req, res) => {
  const db = getDB();

  const expiringContracts = db.prepare("SELECT c.id, e.full_name, c.end_date FROM contracts c JOIN employees e ON c.employee_id = e.id WHERE c.status = 'Active' AND c.end_date BETWEEN date('now', 'localtime') AND date('now', 'localtime', '+30 days')").all();
  const ins = db.prepare("INSERT OR IGNORE INTO compliance_calendar (title, description, module, reference_id, due_date, priority, created_by) VALUES (?,?,?,?,?,?,?)");
  for (const c of expiringContracts) {
    ins.run(`Contract Expiry: ${c.full_name}`, `Employment contract of ${c.full_name} ends on ${c.end_date}`, 'Contract', c.id, c.end_date, 'High', req.user.id);
  }

  const pendingEvals = db.prepare(`SELECT e.id, e.full_name FROM employees e LEFT JOIN evaluation_records ev ON e.id = ev.employee_id AND ev.evaluation_type = 'Annual' AND strftime('%Y', ev.created_at) = strftime('%Y', 'now') WHERE ev.id IS NULL AND e.status = 'Active'`).all();
  for (const ev of pendingEvals) {
    ins.run(`Annual Evaluation: ${ev.full_name}`, `Annual performance evaluation for ${ev.full_name} is due`, 'Evaluation', ev.id, dateFuture(30), 'Normal', req.user.id);
  }

  logAudit(req, 'Auto-Generate Compliance Items', 'Compliance', null, `${expiringContracts.length} contracts, ${pendingEvals.length} evaluations`);
  res.redirect('/compliance');
});

function dateFuture(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

module.exports = router;
