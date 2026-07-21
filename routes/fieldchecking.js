const express = require('express');
const multer = require('multer');
const path = require('path');
const { getDB } = require('../db/schema');
const { verifyToken } = require('../middleware/auth');
const { logAudit } = require('../middleware/audit');

const router = express.Router();

const storage = multer.diskStorage({
  destination: path.join(__dirname, '..', 'public', 'uploads', 'fieldchecks'),
  filename: (req, file, cb) => {
    cb(null, 'fc-' + Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname));
  }
});
const upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 } });

router.get('/', verifyToken, (req, res) => {
  const db = getDB();
  const page = parseInt(req.query.page) || 1;
  const limit = 20;
  const offset = (page - 1) * limit;
  const month = req.query.month || '';
  const year = req.query.year || '';

  let query = 'SELECT * FROM field_checks WHERE 1=1';
  let countQuery = 'SELECT COUNT(*) as count FROM field_checks WHERE 1=1';
  const params = [];
  if (month) { query += " AND strftime('%m', inspection_date) = ?"; countQuery += " AND strftime('%m', inspection_date) = ?"; params.push(month.padStart(2,'0')); }
  if (year) { query += " AND strftime('%Y', inspection_date) = ?"; countQuery += " AND strftime('%Y', inspection_date) = ?"; params.push(year); }
  query += ' ORDER BY inspection_date DESC LIMIT ? OFFSET ?';
  const totalParams = [...params];
  params.push(limit, offset);
  const checks = db.prepare(query).all(...params);
  const total = db.prepare(countQuery).get(...totalParams).count;

  res.render('fieldchecking/index', { checks, total, page, limit, month, year, pages: Math.ceil(total / limit) });
});

router.get('/add', verifyToken, (req, res) => {
  res.render('fieldchecking/form', { check: null, today: new Date().toISOString().split('T')[0], now: new Date().toTimeString().slice(0, 5) });
});

router.post('/add', verifyToken, (req, res) => {
  const db = getDB();
  const { inspection_date, inspection_time, project_site, inspector, foreman, leadman, summary } = req.body;
  const date = new Date(inspection_date);
  const result = db.prepare(
    `INSERT INTO field_checks (inspection_date, inspection_time, project_site, inspector, foreman, leadman, summary, created_by) VALUES (?,?,?,?,?,?,?,?)`
  ).run(inspection_date, inspection_time||null, project_site||'Vail Land Development', inspector||null, foreman||null, leadman||null, summary||null, req.user.id);
  const violations = JSON.parse(req.body.violations || '[]');
  const insV = db.prepare('INSERT INTO field_check_violations (field_check_id, employee_name, designation, violation, action_taken) VALUES (?,?,?,?,?)');
  for (const v of violations) {
    insV.run(result.lastInsertRowid, v.employee_name||'', v.designation||'', v.violation, v.action_taken||'');
  }
  logAudit(req, 'Add Field Check', 'Field Checking', result.lastInsertRowid, inspection_date);
  res.redirect('/fieldchecking');
});

router.get('/view/:id', verifyToken, (req, res) => {
  const db = getDB();
  const check = db.prepare('SELECT * FROM field_checks WHERE id = ?').get(req.params.id);
  if (!check) return res.redirect('/fieldchecking');
  const violations = db.prepare('SELECT * FROM field_check_violations WHERE field_check_id = ?').all(req.params.id);
  res.render('fieldchecking/view', { check, violations });
});

router.post('/update-status/:id', verifyToken, (req, res) => {
  const db = getDB();
  db.prepare('UPDATE field_checks SET status = ? WHERE id = ?').run(req.body.status, req.params.id);
  res.redirect(`/fieldchecking/view/${req.params.id}`);
});

module.exports = router;
