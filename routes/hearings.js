const express = require('express');
const { getDB } = require('../db/schema');
const { verifyToken } = require('../middleware/auth');
const { notifyHearingSchedule } = require('../services/notification');

const router = express.Router();

router.get('/', verifyToken, (req, res) => {
  const db = getDB();
  const page = parseInt(req.query.page) || 1;
  const limit = 20;
  const offset = (page - 1) * limit;
  const status = req.query.status || '';

  let query = `
    SELECT h.*, dc.case_number, e.full_name as employee_name
    FROM hearings h
    JOIN disciplinary_cases dc ON h.case_id = dc.id
    JOIN employees e ON dc.employee_id = e.id
    WHERE 1=1`;
  let countQuery = `
    SELECT COUNT(*) as count FROM hearings h
    JOIN disciplinary_cases dc ON h.case_id = dc.id
    WHERE 1=1`;
  const params = [];

  if (status) {
    query += ' AND h.status = ?';
    countQuery += ' AND h.status = ?';
    params.push(status);
  }

  query += ' ORDER BY e.full_name ASC LIMIT ? OFFSET ?';
  const totalParams = [...params];
  params.push(limit, offset);

  const hearings = db.prepare(query).all(...params);
  const total = db.prepare(countQuery).get(...totalParams).count;

  res.render('hearings/index', {
    hearings, total, page, limit, status,
    pages: Math.ceil(total / limit)
  });
});

router.get('/add', verifyToken, (req, res) => {
  const db = getDB();
  const cases = db.prepare(`
    SELECT dc.id, dc.case_number, e.full_name as employee_name
    FROM disciplinary_cases dc
    JOIN employees e ON dc.employee_id = e.id
    WHERE dc.status IN ('Open', 'Under Investigation', 'For Hearing')
    ORDER BY dc.case_number
  `).all();
  res.render('hearings/form', { hearing: null, cases });
});

router.post('/add', verifyToken, (req, res) => {
  const db = getDB();
  const { case_id, hearing_date, start_time, end_time, notes } = req.body;
  const result = db.prepare('INSERT INTO hearings (case_id, hearing_date, start_time, end_time, notes, created_by) VALUES (?, ?, ?, ?, ?, ?)')
    .run(case_id, hearing_date, start_time || null, end_time || null, notes || null, req.user.id);
  db.prepare("UPDATE disciplinary_cases SET status = 'For Hearing', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status NOT IN ('Resolved', 'Dismissed')")
    .run(case_id);
  try {
    const hearing = db.prepare('SELECT * FROM hearings WHERE id = ?').get(result.lastInsertRowid);
    const caseData = db.prepare('SELECT * FROM disciplinary_cases WHERE id = ?').get(case_id);
    const employee = db.prepare('SELECT * FROM employees WHERE id = ?').get(caseData.employee_id);
    if (employee && employee.email) notifyHearingSchedule(employee, hearing, caseData);
  } catch (err) {
    console.error('Failed to send hearing notification:', err);
  }
  res.redirect('/hearings');
});

router.get('/edit/:id', verifyToken, (req, res) => {
  const db = getDB();
  const hearing = db.prepare('SELECT * FROM hearings WHERE id = ?').get(req.params.id);
  if (!hearing) return res.redirect('/hearings');
  const cases = db.prepare(`
    SELECT dc.id, dc.case_number, e.full_name as employee_name
    FROM disciplinary_cases dc
    JOIN employees e ON dc.employee_id = e.id
    ORDER BY dc.case_number
  `).all();
  res.render('hearings/form', { hearing, cases });
});

router.post('/edit/:id', verifyToken, (req, res) => {
  const db = getDB();
  const { case_id, hearing_date, start_time, end_time, status, notes } = req.body;
  db.prepare('UPDATE hearings SET case_id=?, hearing_date=?, start_time=?, end_time=?, status=?, notes=? WHERE id=?')
    .run(case_id, hearing_date, start_time || null, end_time || null, status, notes || null, req.params.id);
  try {
    const hearing = db.prepare('SELECT * FROM hearings WHERE id = ?').get(req.params.id);
    if (hearing && hearing.status === 'Scheduled') {
      const caseData = db.prepare('SELECT * FROM disciplinary_cases WHERE id = ?').get(hearing.case_id);
      const employee = db.prepare('SELECT * FROM employees WHERE id = ?').get(caseData.employee_id);
      if (employee && employee.email) notifyHearingSchedule(employee, hearing, caseData);
    }
  } catch (err) {
    console.error('Failed to send hearing notification:', err);
  }
  res.redirect('/hearings');
});

module.exports = router;
