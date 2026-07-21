const express = require('express');
const path = require('path');
const multer = require('multer');
const { getDB } = require('../db/schema');
const { verifyToken, requireRole } = require('../middleware/auth');
const { logAudit } = require('../middleware/audit');
const leaveService = require('../services/leave-service');

const router = express.Router();
const leaveUpload = multer({
  dest: path.join(__dirname, '..', 'public', 'uploads', 'leave_docs'),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = ['.pdf', '.jpg', '.jpeg', '.png', '.webp'];
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, ok.includes(ext));
  }
});

router.get('/api/types', verifyToken, (req, res) => {
  const db = getDB();
  res.json(db.prepare('SELECT * FROM leave_types WHERE is_active = 1').all());
});

router.get('/api/balances/:employee_id', verifyToken, (req, res) => {
  const eid = Number(req.params.employee_id);
  const year = req.query.year || new Date().getFullYear();
  const balances = leaveService.getAllBalances(eid);
  res.json(balances);
});

router.get('/api/balances/:employee_id/:leave_type_id', verifyToken, (req, res) => {
  const eid = Number(req.params.employee_id);
  const ltid = Number(req.params.leave_type_id);
  const bal = leaveService.getAvailableBalance(eid, ltid);
  res.json(bal);
});

router.post('/api/apply', verifyToken, (req, res) => {
  const db = getDB();
  const { employee_id, leave_type_id, date_from, date_to, days, reason } = req.body;

  if (!employee_id || !leave_type_id || !date_from || !date_to || !days || !reason) {
    return res.status(400).json({ error: 'All fields required' });
  }
  const requestedDays = Number(days);
  if (requestedDays <= 0) {
    return res.status(400).json({ error: 'Leave days must be positive' });
  }
  if (new Date(date_from) > new Date(date_to)) {
    return res.status(400).json({ error: 'Start date cannot be after end date' });
  }

  const conflict = leaveService.checkDoubleBooking(employee_id, date_from, date_to);
  if (conflict.conflict) {
    return res.status(409).json({ error: conflict.error });
  }

  const balCheck = leaveService.validateLeaveBalance(employee_id, leave_type_id, requestedDays);
  if (!balCheck.valid) {
    return res.status(422).json({ error: balCheck.error, available: balCheck.available });
  }

  const info = db.prepare(`
    INSERT INTO leave_applications (employee_id, leave_type_id, date_from, date_to, days, reason)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(employee_id, leave_type_id, date_from, date_to, requestedDays, reason);

  db.prepare(`
    INSERT INTO leave_balances (employee_id, leave_type_id, year, total_days, used_days, pending_days)
    VALUES (?, ?, ?, 0, 0, ?)
    ON CONFLICT(employee_id, leave_type_id, year) DO UPDATE SET
      pending_days = pending_days + ?
  `).run(employee_id, leave_type_id, new Date(date_from).getFullYear(), requestedDays, requestedDays);

  logAudit(req, 'Apply Leave', 'Leaves', info.lastInsertRowid, `Employee ${employee_id} - ${requestedDays} day(s) ${date_from}-${date_to}`);
  res.status(201).json({ id: info.lastInsertRowid });
});

router.post('/api/apply-with-attachment', verifyToken, leaveUpload.single('attachment'), (req, res) => {
  const db = getDB();
  const { employee_id, leave_type_id, date_from, date_to, days, reason } = req.body;

  if (!employee_id || !leave_type_id || !date_from || !date_to || !days || !reason) {
    return res.status(400).json({ error: 'All fields required' });
  }
  const requestedDays = Number(days);
  if (requestedDays <= 0) {
    return res.status(400).json({ error: 'Leave days must be positive' });
  }
  if (new Date(date_from) > new Date(date_to)) {
    return res.status(400).json({ error: 'Start date cannot be after end date' });
  }

  const conflict = leaveService.checkDoubleBooking(employee_id, date_from, date_to);
  if (conflict.conflict) {
    if (req.file) {
      const fs = require('fs');
      fs.unlink(req.file.path, () => {});
    }
    return res.status(409).json({ error: conflict.error });
  }

  const balCheck = leaveService.validateLeaveBalance(employee_id, leave_type_id, requestedDays);
  if (!balCheck.valid) {
    if (req.file) {
      const fs = require('fs');
      fs.unlink(req.file.path, () => {});
    }
    return res.status(422).json({ error: balCheck.error, available: balCheck.available });
  }

  const attachmentUrl = req.file ? `/uploads/leave_docs/${req.file.filename}` : null;

  const info = db.prepare(`
    INSERT INTO leave_applications (employee_id, leave_type_id, date_from, date_to, days, reason, attachment_url)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(employee_id, leave_type_id, date_from, date_to, requestedDays, reason, attachmentUrl);

  db.prepare(`
    INSERT INTO leave_balances (employee_id, leave_type_id, year, total_days, used_days, pending_days)
    VALUES (?, ?, ?, 0, 0, ?)
    ON CONFLICT(employee_id, leave_type_id, year) DO UPDATE SET
      pending_days = pending_days + ?
  `).run(employee_id, leave_type_id, new Date(date_from).getFullYear(), requestedDays, requestedDays);

  logAudit(req, 'Apply Leave with Attachment', 'Leaves', info.lastInsertRowid, `Employee ${employee_id} - ${requestedDays} day(s)`);
  res.status(201).json({ id: info.lastInsertRowid, attachment_url: attachmentUrl });
});

router.patch('/api/:id/status', verifyToken, requireRole('admin', 'hrd'), (req, res) => {
  const db = getDB();
  const { status, denied_reason } = req.body;
  const app = db.prepare(`
    SELECT la.*, lt.code as leave_type_code
    FROM leave_applications la
    JOIN leave_types lt ON la.leave_type_id = lt.id
    WHERE la.id = ?
  `).get(Number(req.params.id));

  if (!app) return res.status(404).json({ error: 'Leave application not found' });
  if (app.status !== 'Pending') return res.status(400).json({ error: 'Already processed' });

  if (status === 'Approved') {
    const balCheck = leaveService.validateLeaveBalance(app.employee_id, app.leave_type_id, app.days);
    if (!balCheck.valid) {
      return res.status(422).json({ error: `Cannot approve: ${balCheck.error}` });
    }
  }

  db.prepare(`
    UPDATE leave_applications
    SET status = ?, approver_id = ?, approved_date = ?, denied_reason = ?
    WHERE id = ?
  `).run(
    status,
    req.user.id,
    status === 'Approved' ? new Date().toISOString().split('T')[0] : null,
    denied_reason || null,
    app.id
  );

  if (status === 'Approved') {
    db.prepare(`
      UPDATE leave_balances
      SET pending_days = MAX(0, pending_days - ?),
          used_days = used_days + ?
      WHERE employee_id = ? AND leave_type_id = ? AND year = ?
    `).run(app.days, app.days, app.employee_id, app.leave_type_id, new Date(app.date_from).getFullYear());

    const leaveStatusMap = { 'SL': 'Sick Leave', 'EL': 'Emergency Leave', 'VL': 'Filed Leave', 'BL': 'Filed Leave', 'SIL': 'Filed Leave' };
    const attStatus = leaveStatusMap[app.leave_type_code] || 'Filed Leave';
    const start = new Date(app.date_from);
    const end = new Date(app.date_to);
    const tx = db.transaction(() => {
      const d = new Date(start);
      while (d <= end) {
        const ds = d.toISOString().slice(0, 10);
        const dayOfWeek = d.getDay();
        if (dayOfWeek !== 0 && dayOfWeek !== 6) {
          const existing = db.prepare('SELECT id, status FROM attendance_records WHERE employee_id = ? AND date = ?').get(app.employee_id, ds);
          if (existing) {
            if (!['Sick Leave', 'Filed Leave', 'Emergency Leave', 'Holiday'].includes(existing.status)) {
              db.prepare('UPDATE attendance_records SET status = ?, remarks = ? WHERE id = ?').run(attStatus, `Auto-set from approved leave #${app.id}`, existing.id);
            }
          } else {
            db.prepare('INSERT INTO attendance_records (employee_id, date, status, remarks, recorded_by) VALUES (?,?,?,?,?)').run(app.employee_id, ds, attStatus, `Auto-set from approved leave #${app.id}`, req.user.id);
          }
        }
        d.setDate(d.getDate() + 1);
      }
    });
    tx();
  } else if (status === 'Denied' || status === 'Cancelled') {
    db.prepare(`
      UPDATE leave_balances
      SET pending_days = MAX(0, pending_days - ?)
      WHERE employee_id = ? AND leave_type_id = ? AND year = ?
    `).run(app.days, app.employee_id, app.leave_type_id, new Date(app.date_from).getFullYear());
  }

  logAudit(req, `${status} Leave`, 'Leaves', app.id, `Application #${app.id} - ${app.leave_type_code}`);
  res.json({ ok: true });
});

router.get('/api/employees/:id/leave-summary', verifyToken, (req, res) => {
  const db = getDB();
  const year = req.query.year || new Date().getFullYear();
  const applications = db.prepare(`
    SELECT la.*, lt.name as leave_type_name, lt.code as leave_type_code
    FROM leave_applications la
    JOIN leave_types lt ON la.leave_type_id = lt.id
    WHERE la.employee_id = ? AND (strftime('%Y', la.date_from) = ? OR strftime('%Y', la.date_to) = ?)
    ORDER BY la.created_at DESC
  `).all(Number(req.params.id), String(year), String(year));
  res.json(applications);
});

router.get('/api/employees/:id/sil-status', verifyToken, (req, res) => {
  const db = getDB();
  const emp = db.prepare("SELECT id, employee_id, full_name, date_hired, sil_credited, sil_credited_date FROM employees WHERE id = ?").get(Number(req.params.id));
  if (!emp) return res.status(404).json({ error: 'Employee not found' });

  const bal = db.prepare(`
    SELECT total_days, used_days, pending_days
    FROM leave_balances
    WHERE employee_id = ? AND leave_type_id = (SELECT id FROM leave_types WHERE code = 'SIL')
      AND year = ?
  `).all(emp.id, new Date().getFullYear());

  res.json({
    ...emp,
    sil_balance: bal.length > 0 ? {
      total: bal[0].total_days,
      used: bal[0].used_days,
      pending: bal[0].pending_days,
      available: bal[0].total_days - bal[0].used_days - bal[0].pending_days
    } : null
  });
});

router.post('/api/sil/grant/:employee_id', verifyToken, requireRole('admin', 'hrd'), (req, res) => {
  const result = leaveService.calculateSilEntitlement(Number(req.params.employee_id));
  if (result.granted) {
    logAudit(req, 'Grant SIL', 'Leaves', req.params.employee_id, `Granted ${result.days} days SIL`);
    res.json(result);
  } else {
    res.status(422).json(result);
  }
});

router.post('/api/sil/process-all', verifyToken, requireRole('admin', 'hrd'), (req, res) => {
  const results = leaveService.processSilAccrual();
  logAudit(req, 'Bulk SIL Grant', 'Leaves', null, `${results.filter(r => r.granted).length} employees granted SIL`);
  res.json({ processed: results.length, granted: results.filter(r => r.granted).length, results });
});

router.get('/api/awol-exceptions', verifyToken, (req, res) => {
  const db = getDB();
  const exceptions = db.prepare(`
    SELECT ae.*, e.full_name as employee_name, e.employee_id, e.position, e.department
    FROM attendance_exceptions ae
    JOIN employees e ON ae.employee_id = e.id
    ORDER BY ae.created_at DESC
  `).all();
  res.json(exceptions);
});

router.get('/api/awol-exceptions/open', verifyToken, (req, res) => {
  const db = getDB();
  const open = db.prepare(`
    SELECT ae.*, e.full_name as employee_name, e.employee_id, e.position, e.department
    FROM attendance_exceptions ae
    JOIN employees e ON ae.employee_id = e.id
    WHERE ae.status = 'Open'
    ORDER BY ae.created_at DESC
  `).all();
  res.json(open);
});

router.patch('/api/awol-exceptions/:id/resolve', verifyToken, requireRole('admin', 'hrd'), (req, res) => {
  const db = getDB();
  const { resolution } = req.body;
  const exc = db.prepare('SELECT * FROM attendance_exceptions WHERE id = ?').get(Number(req.params.id));
  if (!exc) return res.status(404).json({ error: 'Exception not found' });

  db.prepare(`
    UPDATE attendance_exceptions
    SET status = 'Resolved', reviewed_by = ?, reviewed_date = date('now'), resolution = ?
    WHERE id = ?
  `).run(req.user.id, resolution || null, exc.id);

  db.prepare("UPDATE employees SET awol_flag = 0, awol_cleared_date = date('now') WHERE id = ?").run(exc.employee_id);
  logAudit(req, 'Resolve AWOL Exception', 'Leaves', exc.id, `Employee ${exc.employee_id}`);
  res.json({ ok: true });
});

router.post('/api/awol-exceptions/resolve-all', verifyToken, requireRole('admin', 'hrd'), (req, res) => {
  const db = getDB();
  const open = db.prepare("SELECT * FROM attendance_exceptions WHERE status = 'Open'").all();
  const tx = db.transaction(() => {
    for (const exc of open) {
      db.prepare(`
        UPDATE attendance_exceptions SET status = 'Resolved', reviewed_by = ?, reviewed_date = date('now'), resolution = 'Batch resolved'
        WHERE id = ?
      `).run(req.user.id, exc.id);
      db.prepare("UPDATE employees SET awol_flag = 0, awol_cleared_date = date('now') WHERE id = ?").run(exc.employee_id);
    }
  });
  tx();
  logAudit(req, 'Batch Resolve AWOL', 'Leaves', null, `${open.length} exception(s) resolved`);
  res.json({ resolved: open.length });
});

router.post('/api/detect-absenteeism', verifyToken, requireRole('admin', 'hrd'), (req, res) => {
  const results = leaveService.detectThreeDayAbsenteeism();
  logAudit(req, 'AWOL Detection Run', 'Leaves', null, `${results.length} employee(s) flagged`);
  res.json({ flagged: results.length, results });
});

router.post('/api/balances/update', verifyToken, requireRole('admin', 'hrd'), (req, res) => {
  const db = getDB();
  const { employee_id, leave_type_id, total_days } = req.body;
  if (!employee_id || !leave_type_id || total_days === undefined) {
    return res.status(400).json({ error: 'employee_id, leave_type_id, and total_days required' });
  }
  const year = new Date().getFullYear();
  db.prepare(`
    INSERT INTO leave_balances (employee_id, leave_type_id, year, total_days, used_days, pending_days)
    VALUES (?, ?, ?, ?, 0, 0)
    ON CONFLICT(employee_id, leave_type_id, year) DO UPDATE SET total_days = ?
  `).run(employee_id, leave_type_id, year, total_days, total_days);
  res.json({ ok: true });
});

router.get('/api/dashboard-stats', verifyToken, (req, res) => {
  const db = getDB();
  const openAwol = db.prepare("SELECT COUNT(*) as count FROM attendance_exceptions WHERE status = 'Open'").get().count;
  const pendingLeaves = db.prepare("SELECT COUNT(*) as count FROM leave_applications WHERE status = 'Pending'").get().count;
  const silDue = db.prepare(`
    SELECT COUNT(*) as count FROM employees
    WHERE sil_credited = 0 AND date_hired IS NOT NULL
      AND date_hired <= date('now', '-365 days') AND status = 'Active'
  `).get().count;

  res.json({ openAwol, pendingLeaves, silDue });
});

module.exports = router;
