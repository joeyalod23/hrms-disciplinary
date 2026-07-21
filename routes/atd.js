const express = require('express');
const { getDB } = require('../db/schema');
const { verifyToken } = require('../middleware/auth');
const { logAudit } = require('../middleware/audit');

const router = express.Router();

function generateATDNumber(db) {
  const year = new Date().getFullYear();
  const count = db.prepare("SELECT COUNT(*) as c FROM atd_records WHERE strftime('%Y', created_at) = ?").get(String(year)).c + 1;
  return `ATD-${year}-${String(count).padStart(4, '0')}`;
}

router.get('/', verifyToken, (req, res) => {
  const db = getDB();
  const page = parseInt(req.query.page) || 1;
  const limit = 20;
  const offset = (page - 1) * limit;
  const status = req.query.status || '';
  const search = req.query.search || '';

  let query = `SELECT a.*, e.full_name, e.employee_id FROM atd_records a JOIN employees e ON a.employee_id = e.id WHERE 1=1`;
  let countQuery = `SELECT COUNT(*) as count FROM atd_records a JOIN employees e ON a.employee_id = e.id WHERE 1=1`;
  const params = [];
  if (status) { query += ' AND a.status = ?'; countQuery += ' AND a.status = ?'; params.push(status); }
  if (search) { query += " AND (e.full_name LIKE ? OR e.employee_id LIKE ?)"; countQuery += " AND (e.full_name LIKE ? OR e.employee_id LIKE ?)"; params.push(`%${search}%`, `%${search}%`); }
  query += ' ORDER BY e.full_name ASC LIMIT ? OFFSET ?';
  const totalParams = [...params];
  params.push(limit, offset);
  const records = db.prepare(query).all(...params);
  const total = db.prepare(countQuery).get(...totalParams).count;

  res.render('atd/index', { records, total, page, limit, status, search, pages: Math.ceil(total / limit) });
});

router.get('/add', verifyToken, (req, res) => {
  const db = getDB();
  const employees = db.prepare("SELECT id, employee_id, full_name FROM employees WHERE status = 'Active' ORDER BY full_name").all();
  res.render('atd/form', { record: null, employees, today: new Date().toISOString().split('T')[0] });
});

router.post('/add', verifyToken, (req, res) => {
  const db = getDB();
  const { employee_id, weekly_deduction, start_date, end_date, remarks, items } = req.body;
  const atd_number = generateATDNumber(db);
  const total = Array.isArray(items) ? items.reduce((s, i) => s + parseFloat(i.amount || 0), 0) : 0;
  const result = db.prepare(
    'INSERT INTO atd_records (atd_number, employee_id, total_deduction, weekly_deduction, start_date, end_date, remarks, created_by) VALUES (?,?,?,?,?,?,?,?)'
  ).run(atd_number, employee_id, total, weekly_deduction||0, start_date||null, end_date||null, remarks||null, req.user.id);

  const insItem = db.prepare('INSERT INTO atd_items (atd_id, item_name, amount) VALUES (?,?,?)');
  if (Array.isArray(items)) {
    for (const item of items) {
      if (item.name && item.amount) insItem.run(result.lastInsertRowid, item.name, parseFloat(item.amount));
    }
  }
  logAudit(req, 'Add ATD Record', 'ATD', result.lastInsertRowid, atd_number);
  res.redirect('/atd');
});

router.get('/view/:id', verifyToken, (req, res) => {
  const db = getDB();
  const record = db.prepare(`SELECT a.*, e.full_name, e.employee_id, e.position FROM atd_records a JOIN employees e ON a.employee_id = e.id WHERE a.id = ?`).get(req.params.id);
  if (!record) return res.redirect('/atd');
  const items = db.prepare('SELECT * FROM atd_items WHERE atd_id = ?').all(req.params.id);
  res.render('atd/view', { record, items });
});

router.post('/update-status/:id', verifyToken, (req, res) => {
  const db = getDB();
  db.prepare('UPDATE atd_records SET status = ? WHERE id = ?').run(req.body.status, req.params.id);
  res.redirect(`/atd/view/${req.params.id}`);
});

router.get('/export', verifyToken, (req, res) => {
  const db = getDB();
  const data = db.prepare(`
    SELECT a.atd_number, e.employee_id, e.full_name, e.position, a.total_deduction, a.weekly_deduction, a.start_date, a.end_date, a.status, a.remarks
    FROM atd_records a JOIN employees e ON a.employee_id = e.id ORDER BY a.created_at DESC
  `).all();
  let csv = 'ATD#,Employee ID,Name,Position,Total Deduction,Weekly Deduction,Start Date,End Date,Status,Remarks\n';
  for (const r of data) {
    csv += `"${r.atd_number}","${r.employee_id}","${r.full_name}","${r.position||''}","${r.total_deduction}","${r.weekly_deduction}","${r.start_date||''}","${r.end_date||''}","${r.status}","${(r.remarks||'').replace(/"/g,'""')}"\n`;
  }
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=atd_records_export.csv');
  res.send(csv);
});

module.exports = router;
