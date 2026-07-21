const express = require('express');
const { getDB } = require('../db/schema');
const { verifyToken, requireRole } = require('../middleware/auth');

const router = express.Router();

router.get('/', verifyToken, requireRole('admin', 'hrd'), (req, res) => {
  const db = getDB();
  const page = parseInt(req.query.page) || 1;
  const limit = 50;
  const offset = (page - 1) * limit;
  const module = req.query.module || '';
  const search = req.query.search || '';

  let query = 'SELECT * FROM audit_logs WHERE 1=1';
  let countQuery = 'SELECT COUNT(*) as count FROM audit_logs WHERE 1=1';
  const params = [];
  if (module) { query += ' AND module = ?'; countQuery += ' AND module = ?'; params.push(module); }
  if (search) { query += ' AND (username LIKE ? OR action LIKE ? OR details LIKE ?)'; countQuery += ' AND (username LIKE ? OR action LIKE ? OR details LIKE ?)'; params.push(`%${search}%`, `%${search}%`, `%${search}%`); }
  query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  const totalParams = [...params];
  params.push(limit, offset);
  const logs = db.prepare(query).all(...params);
  const total = db.prepare(countQuery).get(...totalParams).count;

  const modules = db.prepare('SELECT DISTINCT module FROM audit_logs ORDER BY module').all().map(m => m.module);

  res.render('audit/index', { logs, total, page, limit, module, search, pages: Math.ceil(total / limit), modules });
});

router.get('/clear', verifyToken, requireRole('admin'), (req, res) => {
  const db = getDB();
  db.prepare("DELETE FROM audit_logs WHERE created_at < date('now', '-90 days')").run();
  res.redirect('/audit');
});

module.exports = router;
