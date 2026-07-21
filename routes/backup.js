const express = require('express');
const path = require('path');
const fs = require('fs');
const { getDB } = require('../db/schema');
const { verifyToken, requireRole } = require('../middleware/auth');
const { logAudit } = require('../middleware/audit');

const router = express.Router();
const BACKUP_DIR = path.join(__dirname, '..', 'backups');

if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

router.get('/', verifyToken, requireRole('admin', 'hrd'), (req, res) => {
  const backups = fs.readdirSync(BACKUP_DIR)
    .filter(f => f.endsWith('.db'))
    .map(f => {
      const st = fs.statSync(path.join(BACKUP_DIR, f));
      return { name: f, size: st.size, date: st.mtime };
    })
    .sort((a, b) => b.date - a.date);
  res.render('backup/index', { layout: 'layouts/main', backups });
});

router.post('/create', verifyToken, requireRole('admin', 'hrd'), (req, res) => {
  const db = getDB();
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `sitevigil-backup-${ts}.db`;
  const dest = path.join(BACKUP_DIR, filename);
  db.backup(dest);
  logAudit(req, 'Create Backup', 'System', null, filename);
  res.json({ ok: true, filename });
});

router.post('/restore/:filename', verifyToken, requireRole('admin'), (req, res) => {
  const filepath = path.join(BACKUP_DIR, req.params.filename);
  if (!fs.existsSync(filepath)) return res.status(404).json({ error: 'Backup not found' });
  logAudit(req, 'Restore Backup', 'System', null, req.params.filename);
  res.json({ ok: true, message: 'Restore requires server restart with backup file.' });
});

router.delete('/:filename', verifyToken, requireRole('admin'), (req, res) => {
  const filepath = path.join(BACKUP_DIR, req.params.filename);
  if (!fs.existsSync(filepath)) return res.status(404).json({ error: 'Not found' });
  fs.unlinkSync(filepath);
  logAudit(req, 'Delete Backup', 'System', null, req.params.filename);
  res.status(204).send();
});

module.exports = router;
