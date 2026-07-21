const express = require('express');
const bcrypt = require('bcryptjs');
const speakeasy = require('speakeasy');
const qrcode = require('qrcode');
const { getDB } = require('../db/schema');
const { verifyToken, requireRole } = require('../middleware/auth');
const { logAudit } = require('../middleware/audit');
const { sendEmail, resetTransporter } = require('../services/notification');

const router = express.Router();

router.get('/', verifyToken, (req, res) => {
  const db = getDB();
  const settings = {};
  db.prepare('SELECT * FROM system_settings').all().forEach(r => { settings[r.key] = r.value; });
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  res.render('settings/index', { layout: 'layouts/main', settings, user, totpUrl: null });
});

router.post('/totp/setup', verifyToken, (req, res) => {
  const secret = speakeasy.generateSecret({ name: 'HRMS:' + req.user.username });
  const db = getDB();
  db.prepare('UPDATE users SET totp_secret = ? WHERE id = ?').run(secret.base32, req.user.id);
  qrcode.toDataURL(secret.otpauth_url, (err, url) => {
    res.json({ secret: secret.base32, qr: url });
  });
});

router.post('/totp/verify', verifyToken, (req, res) => {
  const { token } = req.body;
  const db = getDB();
  const user = db.prepare('SELECT totp_secret FROM users WHERE id = ?').get(req.user.id);
  if (!user.totp_secret) return res.status(400).json({ error: 'No secret configured' });
  const verified = speakeasy.totp.verify({ secret: user.totp_secret, encoding: 'base32', token });
  if (!verified) return res.status(400).json({ error: 'Invalid token' });
  db.prepare('UPDATE users SET totp_enabled = 1 WHERE id = ?').run(req.user.id);
  logAudit(req, 'Enable 2FA', 'Security', req.user.id);
  res.json({ ok: true });
});

router.post('/totp/disable', verifyToken, (req, res) => {
  const db = getDB();
  db.prepare('UPDATE users SET totp_secret = NULL, totp_enabled = 0 WHERE id = ?').run(req.user.id);
  logAudit(req, 'Disable 2FA', 'Security', req.user.id);
  res.json({ ok: true });
});

router.post('/smtp', verifyToken, requireRole('admin'), (req, res) => {
  const db = getDB();
  const { host, port, secure, user, pass, from } = req.body;
  const upsert = 'INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, ?)';
  db.prepare(upsert).run('smtp_host', host || '');
  db.prepare(upsert).run('smtp_port', String(port || 587));
  db.prepare(upsert).run('smtp_secure', secure ? 'true' : 'false');
  db.prepare(upsert).run('smtp_user', user || '');
  db.prepare(upsert).run('smtp_pass', pass || '');
  db.prepare(upsert).run('smtp_from', from || '');
  logAudit(req, 'Update SMTP Settings', 'System');
  resetTransporter();
  res.json({ ok: true });
});

router.post('/notify', verifyToken, requireRole('admin', 'hrd'), (req, res) => {
  const db = getDB();
  const upsert = 'INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, ?)';
  db.prepare(upsert).run('notify_pm_email', req.body.pm_email || '');
  db.prepare(upsert).run('notify_hr_deputy_email', req.body.hr_deputy_email || '');
  db.prepare(upsert).run('notify_hr_head_email', req.body.hr_head_email || '');
  logAudit(req, 'Update Notification Settings', 'System');
  res.json({ ok: true });
});

router.post('/smtp/test', verifyToken, requireRole('admin'), async (req, res) => {
  const { to } = req.body;
  if (!to) return res.status(400).json({ error: 'Recipient email required' });
  resetTransporter();
  const result = await sendEmail({ to, subject: 'HRMS Test Email', html: '<h3>Test Email</h3><p>This is a test email from HRMS. If you received this, your SMTP configuration is working.</p>' });
  if (result.ok) {
    res.json({ ok: true });
  } else {
    res.status(500).json({ error: result.error || 'Email send failed.' });
  }
});

module.exports = router;
