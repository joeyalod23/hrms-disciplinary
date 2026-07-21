const express = require('express');
const { getDB } = require('../db/schema');
const { verifyToken } = require('../middleware/auth');

const router = express.Router();

function generateInvNumber(db) {
  const year = new Date().getFullYear();
  const count = db.prepare("SELECT COUNT(*) as count FROM investigation_reports WHERE strftime('%Y', created_at) = ?").get(String(year)).count + 1;
  return `IR-${year}-${String(count).padStart(4, '0')}`;
}

router.get('/', verifyToken, (req, res) => {
  const db = getDB();
  const page = parseInt(req.query.page) || 1;
  const limit = 20;
  const offset = (page - 1) * limit;
  const status = req.query.status || '';
  const search = req.query.search || '';

  let query = `SELECT inv.*, dc.case_number, e.full_name as employee_name
    FROM investigation_reports inv
    JOIN disciplinary_cases dc ON inv.case_id = dc.id
    JOIN employees e ON dc.employee_id = e.id WHERE 1=1`;
  let countQuery = `SELECT COUNT(*) as count FROM investigation_reports inv
    JOIN disciplinary_cases dc ON inv.case_id = dc.id WHERE 1=1`;
  const params = [];

  if (status) { query += ' AND inv.status = ?'; countQuery += ' AND inv.status = ?'; params.push(status); }
  if (search) { query += " AND (e.full_name LIKE ? OR inv.report_number LIKE ? OR dc.case_number LIKE ?)"; countQuery += " AND (e.full_name LIKE ? OR inv.report_number LIKE ? OR dc.case_number LIKE ?)"; params.push(`%${search}%`, `%${search}%`, `%${search}%`); }

  const total = db.prepare(countQuery).get(...params).count;
  params.push(limit, offset);
  const reports = db.prepare(query + ' ORDER BY e.full_name ASC LIMIT ? OFFSET ?').all(...params);

  res.render('investigations/index', { reports, total, page, limit, search, status, pages: Math.ceil(total / limit) });
});

router.get('/add/:case_id', verifyToken, (req, res) => {
  const db = getDB();
  const caseData = db.prepare(`
    SELECT dc.*, e.full_name as employee_name FROM disciplinary_cases dc
    JOIN employees e ON dc.employee_id = e.id WHERE dc.id = ?
  `).get(req.params.case_id);
  if (!caseData) return res.redirect('/cases');
  const existing = db.prepare('SELECT * FROM investigation_reports WHERE case_id = ?').get(req.params.case_id);
  if (existing) return res.redirect(`/investigations/view/${existing.id}`);
  const today = new Date().toISOString().split('T')[0];
  res.render('investigations/form', { report: null, caseData, today });
});

router.post('/add', verifyToken, (req, res) => {
  const db = getDB();
  const { case_id, investigator, investigation_date, findings, conclusion, recommended_action, is_guilty } = req.body;
  const report_number = generateInvNumber(db);
  const result = db.prepare(`
    INSERT INTO investigation_reports (case_id, report_number, investigator, investigation_date, findings, conclusion, recommended_action, is_guilty, submitted_by, submitted_date, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, date('now'), 'Submitted')
  `).run(case_id, report_number, investigator, investigation_date, findings, conclusion, recommended_action || null, is_guilty !== undefined ? (is_guilty ? 1 : 0) : null, req.user.id);
  res.redirect(`/investigations/view/${result.lastInsertRowid}`);
});

router.get('/view/:id', verifyToken, (req, res) => {
  const db = getDB();
  const report = db.prepare(`
    SELECT inv.*, dc.case_number, dc.status as case_status, e.full_name as employee_name, e.department, e.position,
           u.full_name as submitted_by_name
    FROM investigation_reports inv
    JOIN disciplinary_cases dc ON inv.case_id = dc.id
    JOIN employees e ON dc.employee_id = e.id
    LEFT JOIN users u ON inv.submitted_by = u.id
    WHERE inv.id = ?
  `).get(req.params.id);
  if (!report) return res.redirect('/investigations');
  res.render('investigations/view', { report });
});

router.post('/review/:id', verifyToken, (req, res) => {
  const db = getDB();
  const { reviewed_by } = req.body;
  db.prepare(`
    UPDATE investigation_reports SET status='Reviewed', reviewed_by=?, reviewed_date=date('now'), updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='Submitted'
  `).run(reviewed_by || null, req.params.id);
  res.redirect(`/investigations/view/${req.params.id}`);
});

router.post('/finalize/:id', verifyToken, (req, res) => {
  const db = getDB();
  const report = db.prepare('SELECT * FROM investigation_reports WHERE id = ?').get(req.params.id);
  if (!report) return res.redirect('/investigations');
  db.prepare("UPDATE investigation_reports SET status='Final', updated_at=CURRENT_TIMESTAMP WHERE id=?").run(req.params.id);
  db.prepare("UPDATE disciplinary_cases SET updated_at=CURRENT_TIMESTAMP WHERE id=?").run(report.case_id);
  res.redirect(`/investigations/view/${req.params.id}`);
});

router.get('/edit/:id', verifyToken, (req, res) => {
  const db = getDB();
  const report = db.prepare(`
    SELECT inv.*, dc.case_number, e.full_name as employee_name FROM investigation_reports inv
    JOIN disciplinary_cases dc ON inv.case_id = dc.id
    JOIN employees e ON dc.employee_id = e.id WHERE inv.id = ?
  `).get(req.params.id);
  if (!report) return res.redirect('/investigations');
  if (report.status !== 'Draft') return res.redirect(`/investigations/view/${req.params.id}`);
  const today = new Date().toISOString().split('T')[0];
  res.render('investigations/form', { report, caseData: report, today });
});

router.post('/edit/:id', verifyToken, (req, res) => {
  const db = getDB();
  const { investigator, investigation_date, findings, conclusion, recommended_action, is_guilty } = req.body;
  db.prepare(`
    UPDATE investigation_reports SET investigator=?, investigation_date=?, findings=?, conclusion=?, recommended_action=?, is_guilty=?, updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='Draft'
  `).run(investigator, investigation_date, findings, conclusion, recommended_action || null, is_guilty !== undefined ? (is_guilty ? 1 : 0) : null, req.params.id);
  res.redirect(`/investigations/view/${req.params.id}`);
});

module.exports = router;
