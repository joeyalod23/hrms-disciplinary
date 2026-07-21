const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getDB } = require('../db/schema');
const { JWT_SECRET } = require('../middleware/auth');

const router = express.Router();

function verifyEmployeeToken(req, res, next) {
  const token = req.cookies.emp_token;
  if (!token) return res.redirect('/portal/login');
  try {
    const decoded = jwt.verify(token, JWT_SECRET + '_emp');
    req.employee = decoded;
    res.locals.employee = decoded;
    next();
  } catch {
    res.clearCookie('emp_token');
    res.redirect('/portal/login');
  }
}

router.get('/login', (req, res) => {
  if (req.cookies.emp_token) return res.redirect('/portal');
  res.render('portal/login', { layout: false, error: null });
});

router.post('/login', (req, res) => {
  const { employee_id, password } = req.body;
  const db = getDB();
  const emp = db.prepare('SELECT * FROM employees WHERE employee_id = ? AND can_login = 1').get(employee_id);
  if (!emp || !emp.password_hash || !bcrypt.compareSync(password, emp.password_hash)) {
    return res.render('portal/login', { layout: false, error: 'Invalid credentials or portal access not enabled.' });
  }
  const token = jwt.sign(
    { id: emp.id, employee_id: emp.employee_id, full_name: emp.full_name },
    JWT_SECRET + '_emp',
    { expiresIn: '8h' }
  );
  res.cookie('emp_token', token, { httpOnly: true, maxAge: 8 * 3600000 });
  res.redirect('/portal');
});

router.get('/logout', (req, res) => {
  res.clearCookie('emp_token');
  res.redirect('/portal/login');
});

router.get('/', verifyEmployeeToken, (req, res) => {
  const db = getDB();
  const emp = db.prepare('SELECT * FROM employees WHERE id = ?').get(req.employee.id);
  const attendance = db.prepare(`
    SELECT * FROM attendance_records WHERE employee_id = ?
    ORDER BY date DESC LIMIT 30
  `).all(emp.id);
  const contracts = db.prepare(`
    SELECT * FROM contracts WHERE employee_id = ? ORDER BY start_date DESC
  `).all(emp.id);
  const cases = db.prepare(`
    SELECT dc.*, oc.name as offense_name, oc.severity
    FROM disciplinary_cases dc
    LEFT JOIN offense_categories oc ON dc.offense_category_id = oc.id
    WHERE dc.employee_id = ? ORDER BY dc.created_at DESC
  `).all(emp.id);
  const atds = db.prepare(`
    SELECT * FROM atd_records WHERE employee_id = ? AND status = 'Active'
  `).all(emp.id);
  const ntes = db.prepare(`
    SELECT * FROM nte_cases WHERE employee_id = ? ORDER BY created_at DESC LIMIT 5
  `).all(emp.id);
  res.render('portal/dashboard', {
    layout: 'layouts/portal',
    emp, attendance, contracts, cases, atds, ntes,
  });
});

module.exports = router;
