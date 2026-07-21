const express = require('express');
const router = express.Router();
const { getDB } = require('../db/schema');
const { verifyToken } = require('../middleware/auth');

router.get('/', verifyToken, (req, res) => {
  const db = getDB();
  const search = req.query.search || '';
  const company = req.query.company || '';
  const status = req.query.status || '';
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = 50;
  const offset = (page - 1) * limit;

  let where = [];
  let params = [];
  if (search) {
    where.push('employee_name LIKE ?');
    params.push('%' + search + '%');
  }
  if (company) {
    where.push('company_name LIKE ?');
    params.push('%' + company + '%');
  }
  if (status === 'active') {
    where.push('is_active = 1');
  } else if (status === 'inactive') {
    where.push('is_active = 0');
  }
  const whereClause = where.length > 0 ? 'WHERE ' + where.join(' AND ') : '';

  const total = db.prepare('SELECT COUNT(*) as c FROM subcon_employees ' + whereClause).get(...params).c;
  const rows = db.prepare('SELECT * FROM subcon_employees ' + whereClause + ' ORDER BY employee_name ASC LIMIT ? OFFSET ?').all(...params, limit, offset);
  const companies = db.prepare('SELECT DISTINCT company_name FROM subcon_employees ORDER BY company_name').all();

  res.render('subcon/index', {
    rows, companies, search, company, status,
    page, pages: Math.ceil(total / limit), total, offset
  });
});

router.post('/add', verifyToken, (req, res) => {
  const { employee_name, company_name, is_active } = req.body;
  if (!employee_name || !company_name) {
    return res.redirect('/subcon');
  }
  const db = getDB();
  db.prepare('INSERT INTO subcon_employees (employee_name, company_name, is_active) VALUES (?, ?, ?)').run(employee_name.trim(), company_name.trim(), is_active === '0' ? 0 : 1);
  res.redirect('/subcon');
});

router.get('/edit/:id', verifyToken, (req, res) => {
  const db = getDB();
  const row = db.prepare('SELECT * FROM subcon_employees WHERE id = ?').get(req.params.id);
  if (!row) return res.redirect('/subcon');
  res.render('subcon/edit', { row });
});

router.post('/edit/:id', verifyToken, (req, res) => {
  const { employee_name, company_name, is_active } = req.body;
  if (!employee_name || !company_name) {
    return res.redirect('/subcon/edit/' + req.params.id);
  }
  const db = getDB();
  db.prepare('UPDATE subcon_employees SET employee_name = ?, company_name = ?, is_active = ? WHERE id = ?').run(employee_name.trim(), company_name.trim(), is_active === '0' ? 0 : 1, req.params.id);
  res.redirect('/subcon');
});

router.post('/toggle/:id', verifyToken, (req, res) => {
  const db = getDB();
  const row = db.prepare('SELECT is_active FROM subcon_employees WHERE id = ?').get(req.params.id);
  if (row) {
    db.prepare('UPDATE subcon_employees SET is_active = ? WHERE id = ?').run(row.is_active ? 0 : 1, req.params.id);
  }
  res.redirect('/subcon');
});

router.post('/delete/:id', verifyToken, (req, res) => {
  const db = getDB();
  db.prepare('DELETE FROM subcon_employees WHERE id = ?').run(req.params.id);
  res.redirect('/subcon');
});

module.exports = router;
