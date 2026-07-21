const express = require('express');
const { getDB } = require('../db/schema');
const { verifyToken } = require('../middleware/auth');

const router = express.Router();

function generateCdafNumber(db) {
  const year = new Date().getFullYear();
  const count = db.prepare("SELECT COUNT(*) as count FROM cdaf_records WHERE strftime('%Y', created_at) = ?").get(String(year)).count + 1;
  return `CDAF-${year}-${String(count).padStart(4, '0')}`;
}

router.get('/', verifyToken, (req, res) => {
  const db = getDB();
  const page = parseInt(req.query.page) || 1;
  const limit = 20;
  const offset = (page - 1) * limit;
  const status = req.query.status || '';
  const search = req.query.search || '';

  let query = `SELECT c.*, e.full_name as employee_name, e.employee_id as emp_id, oc.name as offense_name, oc.severity
    FROM cdaf_records c
    JOIN employees e ON c.employee_id = e.id
    LEFT JOIN offense_categories oc ON c.offense_category_id = oc.id WHERE 1=1`;
  let countQuery = `SELECT COUNT(*) as count FROM cdaf_records c JOIN employees e ON c.employee_id = e.id WHERE 1=1`;
  const params = [];

  if (status) { query += ' AND c.status = ?'; countQuery += ' AND c.status = ?'; params.push(status); }
  if (search) { query += " AND (e.full_name LIKE ? OR c.cdaf_number LIKE ?)"; countQuery += " AND (e.full_name LIKE ? OR c.cdaf_number LIKE ?)"; params.push(`%${search}%`, `%${search}%`); }

  const total = db.prepare(countQuery).get(...params).count;
  params.push(limit, offset);
  const records = db.prepare(query + ' ORDER BY e.full_name ASC LIMIT ? OFFSET ?').all(...params);

  res.render('cdaf/index', { records, total, page, limit, search, status, pages: Math.ceil(total / limit) });
});

router.get('/add', verifyToken, (req, res) => {
  const db = getDB();
  const employees = db.prepare("SELECT id, employee_id, full_name, department, position FROM employees WHERE status = 'Active' ORDER BY full_name ASC").all();
  const lightOffenses = db.prepare("SELECT * FROM offense_categories WHERE severity = 'Light' ORDER BY name").all();
  const today = new Date().toISOString().split('T')[0];
  res.render('cdaf/form', { record: null, employees, lightOffenses, today });
});

router.post('/add', verifyToken, (req, res) => {
  const db = getDB();
  const { employee_id, offense_category_id, incident_date, description, action_type, counselled_by, counselling_notes } = req.body;
  const empId = parseInt(employee_id);

  const priorCount = db.prepare("SELECT COUNT(*) as count FROM cdaf_records WHERE employee_id = ? AND status != 'Closed'").get(empId).count;
  const offenseNumber = priorCount + 1;

  const isMinor = db.prepare("SELECT severity FROM offense_categories WHERE id = ?").get(offense_category_id);
  if (isMinor && isMinor.severity !== 'Light') {
    const employees = db.prepare("SELECT id, employee_id, full_name, department, position FROM employees WHERE status = 'Active' ORDER BY full_name ASC").all();
    const lightOffenses = db.prepare("SELECT * FROM offense_categories WHERE severity = 'Light' ORDER BY name").all();
    const today = new Date().toISOString().split('T')[0];
    return res.render('cdaf/form', { record: null, employees, lightOffenses, today, error: 'CDAF is only for Light (Minor) offenses. Use Incident Report for higher severity.' });
  }

  const cdaf_number = generateCdafNumber(db);
  db.prepare(`
    INSERT INTO cdaf_records (cdaf_number, employee_id, offense_category_id, offense_number, incident_date, description, action_type, counselled_by, counselling_notes, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(cdaf_number, empId, offense_category_id || null, offenseNumber, incident_date, description, action_type, counselled_by || null, counselling_notes || null, req.user.id);

  res.redirect('/cdaf');
});

router.get('/view/:id', verifyToken, (req, res) => {
  const db = getDB();
  const record = db.prepare(`
    SELECT c.*, e.full_name as employee_name, e.employee_id as emp_id, e.department, e.position,
           oc.name as offense_name, oc.severity, u.full_name as created_by_name
    FROM cdaf_records c
    JOIN employees e ON c.employee_id = e.id
    LEFT JOIN offense_categories oc ON c.offense_category_id = oc.id
    LEFT JOIN users u ON c.created_by = u.id
    WHERE c.id = ?
  `).get(req.params.id);
  if (!record) return res.redirect('/cdaf');

  const priorCdafs = db.prepare("SELECT * FROM cdaf_records WHERE employee_id = ? AND id != ? ORDER BY created_at ASC").all(record.employee_id, req.params.id);

  res.render('cdaf/view', { record, priorCdafs });
});

router.post('/acknowledge/:id', verifyToken, (req, res) => {
  const db = getDB();
  const { employee_response, acknowledged_date } = req.body;
  db.prepare(`
    UPDATE cdaf_records SET employee_acknowledged=1, employee_response=?, acknowledged_date=?, status='Acknowledged', updated_at=CURRENT_TIMESTAMP WHERE id=?
  `).run(employee_response || null, acknowledged_date || null, req.params.id);
  res.redirect(`/cdaf/view/${req.params.id}`);
});

router.post('/close/:id', verifyToken, (req, res) => {
  const db = getDB();
  db.prepare("UPDATE cdaf_records SET status='Closed', updated_at=CURRENT_TIMESTAMP WHERE id=?").run(req.params.id);
  res.redirect(`/cdaf/view/${req.params.id}`);
});

router.post('/delete/:id', verifyToken, (req, res) => {
  const db = getDB();
  db.prepare('DELETE FROM cdaf_records WHERE id=?').run(req.params.id);
  res.redirect('/cdaf');
});

module.exports = router;
