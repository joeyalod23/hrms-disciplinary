const express = require('express');
const { getDB } = require('../db/schema');
const { verifyToken, requireRole } = require('../middleware/auth');
const { logAudit } = require('../middleware/audit');

const router = express.Router();

router.get('/', verifyToken, requireRole('admin', 'hrd'), (req, res) => {
  const db = getDB();
  const error = req.query.error || null;
  const branches = db.prepare('SELECT b.*, (SELECT COUNT(*) FROM employees WHERE branch_id = b.id) as employee_count, (SELECT COUNT(*) FROM users WHERE branch_id = b.id) as user_count FROM branches b ORDER BY b.name').all();
  res.render('branches/index', { branches, error });
});

router.get('/add', verifyToken, requireRole('admin'), (req, res) => {
  res.render('branches/add');
});

router.post('/add', verifyToken, requireRole('admin'), (req, res) => {
  const { name, code, address, contact_person, contact_number, email } = req.body;
  if (!name || !code) {
    return res.render('branches/add', { error: 'Name and Code are required' });
  }
  const db = getDB();
  const existing = db.prepare('SELECT id FROM branches WHERE code = ?').get(code);
  if (existing) {
    return res.render('branches/add', { error: 'Branch code already exists', form: req.body });
  }
  db.prepare('INSERT INTO branches (name, code, address, contact_person, contact_number, email) VALUES (?, ?, ?, ?, ?, ?)').run(name, code, address || null, contact_person || null, contact_number || null, email || null);
  logAudit(req, `Created branch: ${name}`, 'Branches');
  res.redirect('/branches');
});

router.get('/edit/:id', verifyToken, requireRole('admin'), (req, res) => {
  const db = getDB();
  const branch = db.prepare('SELECT * FROM branches WHERE id = ?').get(req.params.id);
  if (!branch) {
    return res.render('error', { message: 'Branch not found' });
  }
  res.render('branches/edit', { branch });
});

router.post('/edit/:id', verifyToken, requireRole('admin'), (req, res) => {
  const { name, code, address, contact_person, contact_number, email, is_active } = req.body;
  const db = getDB();
  const branch = db.prepare('SELECT * FROM branches WHERE id = ?').get(req.params.id);
  if (!branch) {
    return res.render('error', { message: 'Branch not found' });
  }
  if (!name || !code) {
    return res.render('branches/edit', { branch, error: 'Name and Code are required' });
  }
  const existing = db.prepare('SELECT id FROM branches WHERE code = ? AND id != ?').get(code, req.params.id);
  if (existing) {
    return res.render('branches/edit', { branch, error: 'Branch code already exists' });
  }
  db.prepare('UPDATE branches SET name = ?, code = ?, address = ?, contact_person = ?, contact_number = ?, email = ?, is_active = ? WHERE id = ?').run(name, code, address || null, contact_person || null, contact_number || null, email || null, is_active !== undefined ? 1 : 0, req.params.id);
  logAudit(req, `Updated branch: ${name}`, 'Branches', parseInt(req.params.id));
  res.redirect('/branches');
});

router.get('/users', verifyToken, requireRole('admin'), (req, res) => {
  const db = getDB();
  const users = db.prepare('SELECT u.*, b.name as branch_name, b.code as branch_code FROM users u LEFT JOIN branches b ON u.branch_id = b.id ORDER BY u.username').all();
  const branches = db.prepare('SELECT * FROM branches WHERE is_active = 1 ORDER BY name').all();
  res.render('branches/users', { users, branches });
});

router.post('/users/:id/branch', verifyToken, requireRole('admin'), (req, res) => {
  const db = getDB();
  const { branch_id } = req.body;
  db.prepare('UPDATE users SET branch_id = ? WHERE id = ?').run(branch_id || null, req.params.id);
  logAudit(req, `Updated user branch assignment`, 'Users', parseInt(req.params.id));
  res.redirect('/branches/users');
});

router.post('/delete/:id', verifyToken, requireRole('admin'), (req, res) => {
  const db = getDB();
  const branch = db.prepare('SELECT * FROM branches WHERE id = ?').get(req.params.id);
  if (!branch) {
    return res.render('error', { message: 'Branch not found' });
  }
  const refs = db.prepare("SELECT (SELECT COUNT(*) FROM employees WHERE branch_id = ?) + (SELECT COUNT(*) FROM users WHERE branch_id = ?) as cnt").get(req.params.id, req.params.id);
  if (refs.cnt > 0) {
    return res.redirect('/branches?error=Cannot delete branch with active employees or users. Deactivate it instead.');
  }
  db.prepare('DELETE FROM branches WHERE id = ?').run(req.params.id);
  logAudit(req, `Deleted branch: ${branch.name}`, 'Branches', parseInt(req.params.id));
  res.redirect('/branches');
});

module.exports = router;
