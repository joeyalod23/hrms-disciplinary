const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { getDB } = require('../db/schema');
const { verifyToken } = require('../middleware/auth');
const { logAudit } = require('../middleware/audit');
const { parseDAT, generateAttendance } = require('../services/biometric-parser');

const router = express.Router();
const upload = multer({ dest: path.join(__dirname, '..', 'uploads') });

router.get('/', verifyToken, (req, res) => {
  const db = getDB();
  const month = parseInt(req.query.month) || (new Date().getMonth() + 1);
  const year = parseInt(req.query.year) || new Date().getFullYear();
  const search = req.query.search || '';
  const dateFrom = req.query.date_from || '';
  const dateTo = req.query.date_to || '';
  const filter = req.query.filter || '';
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  const today = now.toISOString().slice(0, 10);
  const showAll = req.query.view === 'all';
  const isTodayView = !showAll && !dateFrom && !dateTo && !req.query.month && !req.query.year;

  let records = [];

  if (filter === 'norecord') {
    const nrDate = (dateFrom && dateTo && dateFrom === dateTo) ? dateFrom : today;
    let nrQuery = `SELECT e.id, e.employee_id, e.full_name, e.position, e.trade, NULL as date,
      NULL as am_in, NULL as am_out, NULL as pm_in, NULL as pm_out,
      NULL as ot_in, NULL as ot_out, 0 as ot_hours, 0 as nd_minutes,
      'No Record' as status, 0 as tardiness_minutes, NULL as missing_punches, NULL as remarks
      FROM employees e WHERE e.status = 'Active'
      AND e.id NOT IN (SELECT employee_id FROM attendance_records WHERE date = ? AND employee_id IS NOT NULL)
      AND e.id NOT IN (SELECT employee_id FROM leave_applications WHERE status = 'Approved' AND date_from <= ? AND date_to >= ? AND employee_id IS NOT NULL)`;
    const nrParams = [nrDate, nrDate, nrDate];
    if (search) {
      nrQuery += ` AND (e.full_name LIKE ? OR e.employee_id LIKE ?)`;
      nrParams.push(`%${search}%`, `%${search}%`);
    }
    nrQuery += ` ORDER BY e.full_name ASC`;
    records = db.prepare(nrQuery).all(...nrParams);
  } else {
    const filterMap = { present: ['Present'], late: ['Late'], halfday: ['Half Day'], leave: ['Sick Leave','Filed Leave','Emergency Leave'], absent: ['Absent','AWOL'] };

    let query = `SELECT ar.*, e.full_name, e.employee_id, e.position, e.trade
      FROM attendance_records ar JOIN employees e ON ar.employee_id = e.id WHERE 1=1`;
    const params = [];

    if (dateFrom && dateTo) {
      query += ` AND ar.date BETWEEN ? AND ?`;
      params.push(dateFrom, dateTo);
    } else if (dateFrom) {
      query += ` AND ar.date >= ?`;
      params.push(dateFrom);
    } else if (dateTo) {
      query += ` AND ar.date <= ?`;
      params.push(dateTo);
    } else if (showAll || req.query.month || req.query.year) {
      query += ` AND strftime('%m', ar.date) = ? AND strftime('%Y', ar.date) = ?`;
      params.push(String(month).padStart(2, '0'), String(year));
    } else {
      query += ` AND ar.date = ?`;
      params.push(today);
    }

    if (filterMap[filter]) {
      query += ` AND ar.status IN (${filterMap[filter].map(() => '?').join(',')})`;
      params.push(...filterMap[filter]);
    }

    if (search) {
      query += ` AND (e.full_name LIKE ? OR e.employee_id LIKE ?)`;
      params.push(`%${search}%`, `%${search}%`);
    }
    query += ` ORDER BY e.full_name ASC, ar.date ASC`;
    records = db.prepare(query).all(...params);
  }

  const mappedRecords = records.map(r => {
    const hasStraight = r.am_in || r.am_out || r.pm_in || r.pm_out;
    const startBoundary = hasStraight ? '16:30' : '17:00';
    const endBoundary = '22:00';
    if (r.ot_in && r.ot_out) {
      const s = r.ot_in < startBoundary ? startBoundary : r.ot_in;
      const e = r.ot_out > endBoundary ? endBoundary : r.ot_out;
      if (s < e) {
        const [sh, sm] = s.split(':').map(Number);
        const [eh, em] = e.split(':').map(Number);
        r.ot_hours = Math.round(((eh + em / 60) - (sh + sm / 60)) * 100) / 100;
      } else {
        r.ot_hours = 0;
      }
    } else {
      r.ot_hours = 0;
    }
    return r;
  });
  const summary = db.prepare(`SELECT * FROM attendance_monthly_summary WHERE month = ? AND year = ? ORDER BY employee_id`).all(month, year);

  const months = [];
  for (let m = 1; m <= 12; m++) {
    const d = new Date(year, m - 1);
    months.push({ value: m, name: d.toLocaleString('en-US', { month: 'long' }) });
  }

  const statsDate = (dateFrom && dateTo && dateFrom === dateTo) ? dateFrom : today;
  const totalActive = db.prepare("SELECT COUNT(*) as c FROM employees WHERE status = 'Active'").get().c;
  const todayPresent = db.prepare("SELECT COUNT(*) as c FROM attendance_records WHERE date = ? AND status = 'Present'").get(statsDate).c;
  const todayLate = db.prepare("SELECT COUNT(*) as c FROM attendance_records WHERE date = ? AND status = 'Late'").get(statsDate).c;
  const todayNoRecord = db.prepare("SELECT COUNT(*) as c FROM employees e WHERE e.status = 'Active' AND e.id NOT IN (SELECT employee_id FROM attendance_records WHERE date = ? AND employee_id IS NOT NULL) AND e.id NOT IN (SELECT employee_id FROM leave_applications WHERE status = 'Approved' AND date_from <= ? AND date_to >= ? AND employee_id IS NOT NULL)").get(statsDate, statsDate, statsDate).c;
  const todayAbsentStatus = db.prepare("SELECT COUNT(*) as c FROM attendance_records WHERE date = ? AND status = 'Absent'").get(statsDate).c;
  const todayAwol = db.prepare("SELECT COUNT(*) as c FROM attendance_records WHERE date = ? AND status = 'AWOL'").get(statsDate).c;
  const todayHalfDay = db.prepare("SELECT COUNT(*) as c FROM attendance_records WHERE date = ? AND status = 'Half Day'").get(statsDate).c;
  const todayLeave = db.prepare(`
    SELECT COUNT(DISTINCT emp_id) as c FROM (
      SELECT employee_id as emp_id FROM attendance_records WHERE date = ? AND status IN ('Sick Leave','Filed Leave','Emergency Leave')
      UNION
      SELECT la.employee_id as emp_id FROM leave_applications la
      JOIN leave_types lt ON la.leave_type_id = lt.id
      WHERE la.status = 'Approved' AND la.date_from <= ? AND la.date_to >= ? AND la.employee_id IS NOT NULL
      AND la.employee_id NOT IN (SELECT employee_id FROM attendance_records WHERE date = ? AND employee_id IS NOT NULL)
    )
  `).get(statsDate, statsDate, statsDate, statsDate).c;
  const todayHoliday = db.prepare("SELECT COUNT(*) as c FROM attendance_records WHERE date = ? AND status = 'Holiday'").get(statsDate).c;

  const leaveByType = db.prepare(`
    SELECT status, COUNT(*) as count
    FROM attendance_records WHERE date = ?
    AND status IN ('Sick Leave','Filed Leave','Emergency Leave')
    GROUP BY status
  `).all(statsDate);

  const todayOnLeaveList = db.prepare(`
    SELECT DISTINCT e.full_name, e.employee_id, e.position, e.department,
      CASE
        WHEN ar.status IN ('Sick Leave','Filed Leave','Emergency Leave') THEN ar.status
        WHEN lt.code = 'SL' THEN 'Sick Leave'
        WHEN lt.code = 'EL' THEN 'Emergency Leave'
        ELSE 'Filed Leave'
      END as status
    FROM employees e
    LEFT JOIN attendance_records ar ON ar.employee_id = e.id AND ar.date = ?
      AND ar.status IN ('Sick Leave','Filed Leave','Emergency Leave')
    LEFT JOIN leave_applications la ON la.employee_id = e.id AND la.status = 'Approved'
      AND la.date_from <= ? AND la.date_to >= ?
    LEFT JOIN leave_types lt ON la.leave_type_id = lt.id
    WHERE e.status = 'Active' AND (
      ar.status IN ('Sick Leave','Filed Leave','Emergency Leave')
      OR (la.id IS NOT NULL AND ar.id IS NULL)
    )
    ORDER BY e.full_name ASC
  `).all(statsDate, statsDate, statsDate);

  const leaveMonthStats = db.prepare(`
    SELECT la.leave_type_id, lt.name as type_name, lt.code as type_code,
           COUNT(*) as total_apps,
           SUM(CASE WHEN la.status = 'Pending' THEN 1 ELSE 0 END) as pending,
           SUM(CASE WHEN la.status = 'Approved' THEN 1 ELSE 0 END) as approved,
           SUM(CASE WHEN la.status = 'Denied' THEN 1 ELSE 0 END) as denied,
           SUM(CASE WHEN la.status = 'Approved' THEN la.days ELSE 0 END) as total_days
    FROM leave_applications la
    JOIN leave_types lt ON la.leave_type_id = lt.id
    WHERE strftime('%Y-%m', la.date_from) = ? OR strftime('%Y-%m', la.date_to) = ?
    GROUP BY la.leave_type_id
    ORDER BY total_apps DESC
  `).all(String(year) + '-' + String(month).padStart(2, '0'), String(year) + '-' + String(month).padStart(2, '0'));

  const dailyTrend = db.prepare(`
    SELECT date,
      COUNT(*) as total,
      SUM(CASE WHEN status IN ('Present','Late') THEN 1 ELSE 0 END) as present
    FROM attendance_records
    WHERE date >= date('now', 'localtime', '-29 days')
    GROUP BY date ORDER BY date ASC
  `).all();

  const employees = db.prepare("SELECT id, employee_id, full_name FROM employees WHERE status = 'Active' ORDER BY full_name").all();

  let leaves = [];
  try {
    leaves = db.prepare(`
      SELECT la.*, lt.name as leave_type_name, lt.code as leave_type_code,
             e.full_name as employee_name, e.employee_id
      FROM leave_applications la
      JOIN leave_types lt ON la.leave_type_id = lt.id
      JOIN employees e ON la.employee_id = e.id
      ORDER BY la.created_at DESC
    `).all();
  } catch (e) { leaves = []; }

  const activeLeaves = db.prepare(`
    SELECT la.*, lt.name as leave_type_name, lt.code as leave_type_code,
           e.full_name as employee_name, e.employee_id, e.position, e.department
    FROM leave_applications la
    JOIN leave_types lt ON la.leave_type_id = lt.id
    JOIN employees e ON la.employee_id = e.id
    WHERE la.status IN ('Approved','Pending') AND la.date_to >= ?
    ORDER BY la.date_from ASC
  `).all(today);

  const leaveTimeline = activeLeaves.map(la => {
    const from = new Date(la.date_from + 'T00:00:00');
    const to = new Date(la.date_to + 'T00:00:00');
    const todayDate = new Date(today + 'T00:00:00');
    const days = [];
    let dayNum = 0;
    let currentDayNum = 0;
    const d = new Date(from);
    while (d <= to) {
      const dow = d.getDay();
      if (dow !== 0 && dow !== 6) {
        dayNum++;
        const ds = d.toISOString().slice(0, 10);
        const isPast = d < todayDate;
        const isToday = ds === today;
        const isFuture = d > todayDate;
        if (isToday) currentDayNum = dayNum;
        days.push({ date: ds, dayNum, isPast, isToday, isFuture });
      }
      d.setDate(d.getDate() + 1);
    }
    const totalWorkDays = dayNum;
    const remaining = currentDayNum > 0 ? totalWorkDays - currentDayNum : totalWorkDays;
    const isOngoing = currentDayNum > 0 && currentDayNum <= totalWorkDays;
    const isFinished = todayDate > to;
    return { ...la, days, totalWorkDays, currentDayNum, remaining, isOngoing, isFinished };
  });

  const leaveTypes = db.prepare('SELECT * FROM leave_types WHERE is_active = 1').all();

  let awolAlerts = [];
  try {
    awolAlerts = db.prepare(`
      SELECT ae.*, e.full_name as employee_name, e.employee_id
      FROM attendance_exceptions ae
      JOIN employees e ON ae.employee_id = e.id
      WHERE ae.status = 'Open'
      ORDER BY ae.created_at DESC
    `).all();
  } catch (e) { awolAlerts = []; }

  let silStats = { credited: 0, total_active: 0 };
  try {
    silStats = db.prepare(`
      SELECT COUNT(*) as credited,
             (SELECT COUNT(*) FROM employees WHERE status = 'Active') as total_active
      FROM employees WHERE sil_credited = 1
    `).get();
  } catch (e) { silStats = { credited: 0, total_active: 0 }; }

  res.render('attendance/index', {
    records: mappedRecords, summary, month, year, months, search, dateFrom, dateTo,
    statsDate, totalActive, todayPresent, todayLate, todayNoRecord, todayAbsentStatus,
    todayAwol, todayHalfDay, todayLeave, todayHoliday, dailyTrend, isTodayView, today,
    filter, employees, leaves, leaveTypes, awolAlerts, silStats, user: req.user,
    leaveByType, todayOnLeaveList, leaveMonthStats, leaveTimeline
  });
});

router.get('/absent', verifyToken, (req, res) => {
  const db = getDB();
  const absNow = new Date();
  absNow.setMinutes(absNow.getMinutes() - absNow.getTimezoneOffset());
  const date = req.query.date || absNow.toISOString().slice(0, 10);
  const absent = db.prepare(
    "SELECT e.* FROM employees e WHERE e.status='Active' AND e.id NOT IN (SELECT employee_id FROM attendance_records WHERE date=? AND employee_id IS NOT NULL) ORDER BY e.full_name"
  ).all(date);
  res.render('attendance/absent', { absent, date });
});

router.get('/add', verifyToken, (req, res) => {
  const db = getDB();
  const employees = db.prepare("SELECT id, employee_id, full_name, position FROM employees WHERE status = 'Active' ORDER BY full_name").all();
  const addNow = new Date();
  addNow.setMinutes(addNow.getMinutes() - addNow.getTimezoneOffset());
  res.render('attendance/form', { record: null, employees, today: addNow.toISOString().split('T')[0] });
});

router.post('/add', verifyToken, (req, res) => {
  const db = getDB();
  let { employee_id, date, am_in, am_out, pm_in, pm_out, ot_in, ot_out, status, tardiness_minutes, remarks, nd_minutes } = req.body;
  if (Array.isArray(employee_id)) employee_id = employee_id[employee_id.length - 1];
  if (Array.isArray(date)) date = date[date.length - 1];
  const existing = db.prepare('SELECT id FROM attendance_records WHERE employee_id = ? AND date = ?').get(employee_id, date);
  if (existing) {
    db.prepare(`UPDATE attendance_records SET am_in=?, am_out=?, pm_in=?, pm_out=?, ot_in=?, ot_out=?, status=?, tardiness_minutes=?, remarks=?, nd_minutes=?, recorded_by=? WHERE id=?`)
      .run(am_in||null, am_out||null, pm_in||null, pm_out||null, ot_in||null, ot_out||null, status, tardiness_minutes||0, remarks||null, nd_minutes||0, req.user.id, existing.id);
  } else {
    const month = new Date(date).getMonth() + 1;
    const year = new Date(date).getFullYear();
    db.prepare(`INSERT INTO attendance_records (employee_id, date, am_in, am_out, pm_in, pm_out, ot_in, ot_out, status, tardiness_minutes, remarks, nd_minutes, recorded_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(employee_id, date, am_in||null, am_out||null, pm_in||null, pm_out||null, ot_in||null, ot_out||null, status, tardiness_minutes||0, remarks||null, nd_minutes||0, req.user.id);
    db.prepare(`INSERT OR IGNORE INTO attendance_monthly_summary (employee_id, month, year) VALUES (?,?,?)`).run(employee_id, month, year);
  }
  logAudit(req, 'Record Attendance', 'Attendance', employee_id, `${date} - ${status}`);
  res.redirect('/attendance');
});

router.get('/edit/:id', verifyToken, (req, res) => {
  const db = getDB();
  const record = db.prepare('SELECT * FROM attendance_records WHERE id = ?').get(req.params.id);
  if (!record) return res.redirect('/attendance');
  const employees = db.prepare("SELECT id, employee_id, full_name, position FROM employees WHERE status = 'Active' ORDER BY full_name").all();
  res.render('attendance/form', { record, employees, today: '' });
});

router.post('/edit/:id', verifyToken, (req, res) => {
  const db = getDB();
  let { employee_id, date, am_in, am_out, pm_in, pm_out, ot_in, ot_out, status, tardiness_minutes, remarks, nd_minutes } = req.body;
  if (Array.isArray(employee_id)) employee_id = employee_id[employee_id.length - 1];
  if (Array.isArray(date)) date = date[date.length - 1];
  db.prepare(`UPDATE attendance_records SET employee_id=?, date=?, am_in=?, am_out=?, pm_in=?, pm_out=?, ot_in=?, ot_out=?, status=?, tardiness_minutes=?, remarks=?, nd_minutes=?, recorded_by=? WHERE id=?`)
    .run(employee_id, date, am_in||null, am_out||null, pm_in||null, pm_out||null, ot_in||null, ot_out||null, status, tardiness_minutes||0, remarks||null, nd_minutes||0, req.user.id, req.params.id);
  logAudit(req, 'Update Attendance', 'Attendance', req.params.id);
  res.redirect('/attendance');
});

router.get('/delete/:id', verifyToken, (req, res) => {
  const db = getDB();
  db.prepare('DELETE FROM attendance_records WHERE id = ?').run(req.params.id);
  logAudit(req, 'Delete Attendance Record', 'Attendance', req.params.id);
  res.redirect('/attendance');
});

router.post('/add-leave', verifyToken, (req, res) => {
  const db = getDB();
  const { employee_id, date_from, date_to, leave_type, reason } = req.body;
  if (!employee_id || !date_from || !date_to || !leave_type) {
    return res.redirect('/attendance#leave');
  }
  const leaveStatusMap = { 'SL': 'Sick Leave', 'EL': 'Emergency Leave', 'VL': 'Filed Leave', 'BL': 'Filed Leave', 'SIL': 'Filed Leave', 'sick': 'Sick Leave', 'emergency': 'Emergency Leave', 'filed': 'Filed Leave' };
  const attStatus = leaveStatusMap[leave_type] || 'Filed Leave';
  const leaveTypeMap = { 'SL': 2, 'EL': 3, 'VL': 1, 'BL': 4, 'SIL': 5, 'sick': 2, 'emergency': 3, 'filed': 1 };
  const leaveTypeId = leaveTypeMap[leave_type] || 1;
  const start = new Date(date_from);
  const end = new Date(date_to);
  let days = 0;
  const tx = db.transaction(() => {
    const d = new Date(start);
    while (d <= end) {
      const ds = d.toISOString().slice(0, 10);
      const dayOfWeek = d.getDay();
      if (dayOfWeek !== 0 && dayOfWeek !== 6) {
        days++;
        const existing = db.prepare('SELECT id, status FROM attendance_records WHERE employee_id = ? AND date = ?').get(employee_id, ds);
        if (existing) {
          if (!['Sick Leave', 'Filed Leave', 'Emergency Leave', 'Holiday'].includes(existing.status)) {
            db.prepare('UPDATE attendance_records SET status = ?, remarks = ? WHERE id = ?').run(attStatus, reason || `Quick leave - ${leave_type}`, existing.id);
          }
        } else {
          db.prepare('INSERT INTO attendance_records (employee_id, date, status, remarks, recorded_by) VALUES (?,?,?,?,?)').run(employee_id, ds, attStatus, reason || `Quick leave - ${leave_type}`, req.user.id);
        }
      }
      d.setDate(d.getDate() + 1);
    }
    if (days > 0) {
      const year = start.getFullYear();
      db.prepare(`INSERT INTO leave_applications (employee_id, leave_type_id, date_from, date_to, days, reason, status, approver_id, approved_date) VALUES (?,?,?,?,?,?,?,?,?)`).run(employee_id, leaveTypeId, date_from, date_to, days, reason || 'Quick leave entry', 'Approved', req.user.id, new Date().toISOString().split('T')[0]);
      db.prepare(`INSERT INTO leave_balances (employee_id, leave_type_id, year, total_days, used_days, pending_days) VALUES (?, ?, ?, 0, ?, 0) ON CONFLICT(employee_id, leave_type_id, year) DO UPDATE SET used_days = used_days + ?`).run(employee_id, leaveTypeId, year, days, days);
    }
  });
  tx();
  logAudit(req, 'Quick Add Leave', 'Attendance', employee_id, `${date_from} to ${date_to} - ${attStatus} (${days} days)`);
  res.redirect('/attendance#leave');
});

router.get('/summary', verifyToken, (req, res) => {
  const db = getDB();
  const month = parseInt(req.query.month) || (new Date().getMonth() + 1);
  const year = parseInt(req.query.year) || new Date().getFullYear();

  const summary = db.prepare(`
    SELECT ams.*, e.full_name, e.employee_id, e.position, e.trade, e.department
    FROM attendance_monthly_summary ams
    JOIN employees e ON ams.employee_id = e.id
    WHERE ams.month = ? AND ams.year = ?
    ORDER BY e.full_name
  `).all(month, year);

  const months = [];
  for (let m = 1; m <= 12; m++) {
    const d = new Date(year, m - 1);
    months.push({ value: m, name: d.toLocaleString('en-US', { month: 'long' }) });
  }

  res.render('attendance/summary', { summary, month, year, months });
});

router.post('/update-summary', verifyToken, (req, res) => {
  const db = getDB();
  const month = parseInt(req.body.month) || (new Date().getMonth() + 1);
  const year = parseInt(req.body.year) || new Date().getFullYear();

  const records = db.prepare(`
    SELECT employee_id,
      COUNT(*) as total_days,
      SUM(CASE WHEN status = 'Present' THEN 1 ELSE 0 END) as present,
      SUM(CASE WHEN status = 'Late' THEN 1 ELSE 0 END) as late,
      SUM(CASE WHEN status = 'Half Day' THEN 1 ELSE 0 END) as halfday,
      SUM(CASE WHEN status IN ('AWOL','Absent') THEN 1 ELSE 0 END) as awol_absent,
      SUM(CASE WHEN status = 'Sick Leave' THEN 1 ELSE 0 END) as sick,
      SUM(CASE WHEN status = 'Filed Leave' THEN 1 ELSE 0 END) as filed,
      SUM(CASE WHEN status = 'Emergency Leave' THEN 1 ELSE 0 END) as emergency,
      SUM(tardiness_minutes) as total_tardy
    FROM attendance_records
    WHERE strftime('%m', date) = ? AND strftime('%Y', date) = ?
    GROUP BY employee_id
  `  ).all(String(month).padStart(2, '0'), String(year));

  const upsert = db.prepare(`
    INSERT INTO attendance_monthly_summary (employee_id, month, year, total_working_days, days_present, total_tardiness, total_halfday, total_awol, total_sick_leave, total_filed_leave, total_emergency_leave, total_absent)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(employee_id, month, year) DO UPDATE SET
      total_working_days=excluded.total_working_days, days_present=excluded.days_present,
      total_tardiness=excluded.total_tardiness, total_halfday=excluded.total_halfday,
      total_awol=excluded.total_awol, total_sick_leave=excluded.total_sick_leave,
      total_filed_leave=excluded.total_filed_leave, total_emergency_leave=excluded.total_emergency_leave,
      total_absent=excluded.total_absent
  `);
  for (const r of records) {
    upsert.run(r.employee_id, month, year, r.total_days, r.present, r.total_tardy, r.halfday, r.awol_absent, r.sick, r.filed, r.emergency, r.awol_absent);
  }
  logAudit(req, 'Update Attendance Summary', 'Attendance', null, `${month}/${year}`);
  res.redirect('/attendance/summary?month=' + month + '&year=' + year);
});

router.get('/export', verifyToken, (req, res) => {
  const db = getDB();
  const month = parseInt(req.query.month) || (new Date().getMonth() + 1);
  const year = parseInt(req.query.year) || new Date().getFullYear();

  const records = db.prepare(`
    SELECT e.employee_id, e.full_name, e.position, e.trade, ar.date, ar.am_in, ar.am_out, ar.pm_in, ar.pm_out, ar.status, ar.tardiness_minutes, ar.missing_punches, ar.nd_minutes, ar.remarks
    FROM attendance_records ar JOIN employees e ON ar.employee_id = e.id
    WHERE strftime('%m', ar.date) = ? AND strftime('%Y', ar.date) = ? AND ar.date IS NOT NULL
    ORDER BY e.full_name, ar.date
  `).all(String(month).padStart(2, '0'), String(year));

  let csv = 'Employee ID,Name,Position,Trade,Date,AM In (7:30-12:00),AM Out (7:30-12:00),PM In (1:00-4:30),PM Out (1:00-4:30),Status,Tardiness (min),Missing Punches,Night Diff (min),Remarks\n';
  for (const r of records) {
    csv += `"${r.employee_id}","${r.full_name}","${r.position || ''}","${r.trade || ''}","${r.date}","${r.am_in || ''}","${r.am_out || ''}","${r.pm_in || ''}","${r.pm_out || ''}","${r.status}","${r.tardiness_minutes}","${r.missing_punches || ''}","${r.nd_minutes || 0}","${(r.remarks||'').replace(/"/g,'""')}"\n`;
  }
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename=attendance_${month}_${year}.csv`);
  res.send(csv);
});

// ── Biometric .dat Upload ───────────────────────────────────────────────

router.get('/upload', verifyToken, (req, res) => {
  res.render('attendance/upload', { parsed: null, result: null });
});

router.post('/upload', verifyToken, upload.single('datfile'), (req, res) => {
  if (!req.file) return res.render('attendance/upload', { parsed: null, result: null, error: 'Please select a .dat file' });

  const filePath = req.file.path;
  let parsed;
  try {
    parsed = parseDAT(filePath);
  } catch (e) {
    fs.unlink(filePath, () => {});
    return res.render('attendance/upload', { parsed: null, result: null, error: 'Failed to parse file: ' + e.message });
  }

  if (parsed.total === 0) {
    fs.unlink(filePath, () => {});
    return res.render('attendance/upload', { parsed: null, result: null, error: 'No records found in the file. Check the file format.' });
  }

  const jsonPath = filePath + '.json';
  fs.writeFileSync(jsonPath, JSON.stringify(parsed.parsed_rows));
  const db = getDB();
  const empMap = {};
  const employees = db.prepare("SELECT id, employee_id, full_name FROM employees WHERE status = 'Active'").all();
  for (const e of employees) {
    empMap[e.employee_id] = e.full_name;
    empMap[String(e.employee_id)] = e.full_name;
  }
  const previewRows = parsed.parsed_rows.slice(0, 100).map(r => ({
    ...r,
    matched_employee: empMap[r.id] || 'NOT FOUND',
  }));
  fs.unlink(filePath, () => {});
  res.render('attendance/upload', { parsed: { ...parsed, previewRows }, result: null, dataFile: req.file.filename + '.json' });
});

router.post('/upload/import', verifyToken, (req, res) => {
  const dataFile = req.body.data_file;
  if (!dataFile) return res.render('attendance/upload', { parsed: null, result: null, error: 'No data file reference' });

  const jsonPath = path.join(__dirname, '..', 'uploads', dataFile);
  let rows;
  try {
    rows = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  } catch (e) {
    return res.render('attendance/upload', { parsed: null, result: null, error: 'Data file not found or expired. Please upload again.' });
  }
  fs.unlink(jsonPath, () => {});

  const db = getDB();
  const result = generateAttendance(rows, db);
  logAudit(req, 'Import Attendance from .dat', 'Attendance', null, `${result.inserted} inserted, ${result.updated} updated, ${result.skipped} skipped, ${result.errors.length} errors`);
  res.render('attendance/upload', { parsed: null, result });
});

// ── Consecutive Absences (3-5 days) ────────────────────────────────

router.get('/consecutive-absences', verifyToken, (req, res) => {
  const db = getDB();

  if (req.query.refresh) {
    const leaveService = require('../services/leave-service');
    try { leaveService.detectThreeDayAbsenteeism(); } catch (e) { console.error(e); }
  }

  const twoWeeksAgo = new Date();
  twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
  const startBound = twoWeeksAgo.toISOString().slice(0, 10);

  const activeEmployees = db.prepare("SELECT id, employee_id, full_name, position, department FROM employees WHERE status = 'Active' ORDER BY full_name").all();

  const records = [];
  for (const emp of activeEmployees) {
    const atts = db.prepare(`
      SELECT date, status FROM attendance_records
      WHERE employee_id = ? AND date >= ?
      ORDER BY date ASC
    `).all(emp.id, startBound);

    const attMap = {};
    for (const a of atts) {
      attMap[a.date] = a.status;
    }

    const allDates = [];
    const d = new Date(startBound);
    const today = new Date();
    while (d <= today) {
      const ds = d.toISOString().slice(0, 10);
      allDates.push(ds);
      d.setDate(d.getDate() + 1);
    }

    let streak = 0, streakStart = null, streakEnd = null, streakStatuses = [];
    for (const ds of allDates) {
      const status = attMap[ds];
      const isAbsent = !status || status === 'Absent' || status === 'AWOL' || status === 'No Record';
      if (isAbsent) {
        if (streak === 0) streakStart = ds;
        streak++;
        streakEnd = ds;
        streakStatuses.push(status || 'No Record');
      } else {
        if (streak >= 3 && streak <= 5) {
          const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
          records.push({
            ...emp,
            days: streak,
            start_date: streakStart,
            end_date: streakEnd,
            statuses: streakStatuses,
            record_id: atts.length > 0 ? atts[atts.length - 1].id : null
          });
        }
        streak = 0;
        streakStart = null;
        streakEnd = null;
        streakStatuses = [];
      }
    }

    if (streak >= 3 && streak <= 5) {
      records.push({
        ...emp,
        days: streak,
        start_date: streakStart,
        end_date: streakEnd,
        statuses: streakStatuses,
        record_id: atts.length > 0 ? atts[atts.length - 1].id : null
      });
    }
  }

  records.sort((a, b) => b.days - a.days);

  const exceptions = db.prepare(`
    SELECT ae.*, e.full_name as employee_name, e.employee_id
    FROM attendance_exceptions ae
    JOIN employees e ON ae.employee_id = e.id
    WHERE ae.exception_type = '3-Day AWOL'
    ORDER BY ae.created_at DESC
    LIMIT 50
  `).all();

  res.render('attendance/consecutive-absences', { records, exceptions });
});

module.exports = router;
