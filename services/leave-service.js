const { getDB } = require('../db/schema');

class LeaveService {
  get SIL_TYPE_ID() { return 5; }

  getSilTypeId() {
    const db = getDB();
    const row = db.prepare("SELECT id FROM leave_types WHERE code = 'SIL'").get();
    return row ? row.id : null;
  }

  calculateSilEntitlement(employeeId) {
    const db = getDB();
    const emp = db.prepare("SELECT id, date_hired, sil_credited, status FROM employees WHERE id = ?").get(employeeId);
    if (!emp) return { granted: false, reason: 'Employee not found' };
    if (emp.sil_credited) return { granted: false, reason: 'SIL already credited' };
    if (!emp.date_hired) return { granted: false, reason: 'No date_hired' };
    if (emp.status !== 'Active') return { granted: false, reason: 'Employee is not Active' };

    const daysSinceHire = this._dateDiffDays(emp.date_hired, new Date().toISOString().split('T')[0]);
    if (daysSinceHire < 365) {
      return {
        granted: false,
        reason: `Only ${daysSinceHire} days of service; 365 days required`
      };
    }

    const silTypeId = this.getSilTypeId();
    if (!silTypeId) return { granted: false, reason: 'SIL leave type not configured' };

    const year = new Date().getFullYear();
    const tx = db.transaction(() => {
      db.prepare(`
        INSERT INTO leave_balances (employee_id, leave_type_id, year, total_days, used_days, pending_days)
        VALUES (?, ?, ?, 5, 0, 0)
        ON CONFLICT(employee_id, leave_type_id, year) DO UPDATE SET
          total_days = total_days + 5
      `).run(employeeId, silTypeId, year);

      db.prepare("UPDATE employees SET sil_credited = 1, sil_credited_date = date('now') WHERE id = ?")
        .run(employeeId);
    });
    tx();

    return { granted: true, days: 5, year };
  }

  processSilAccrual() {
    const db = getDB();
    const eligible = db.prepare(`
      SELECT id, employee_id, full_name, date_hired
      FROM employees
      WHERE sil_credited = 0
        AND date_hired IS NOT NULL
        AND status = 'Active'
        AND date_hired <= date('now', '-365 days')
    `).all();

    const results = [];
    for (const emp of eligible) {
      const result = this.calculateSilEntitlement(emp.id);
      results.push({ employee: emp.full_name, employee_id: emp.employee_id, ...result });
    }
    return results;
  }

  validateLeaveBalance(employeeId, leaveTypeId, requestedDays) {
    const db = getDB();
    if (!employeeId || !leaveTypeId || !requestedDays || requestedDays <= 0) {
      return { valid: false, error: 'Invalid request parameters' };
    }

    const lt = db.prepare("SELECT days_per_year FROM leave_types WHERE id = ? AND is_active = 1").get(leaveTypeId);
    if (lt && lt.days_per_year === 0) {
      return { valid: true, available: Infinity, total: 0, used: 0, pending: 0 };
    }

    const year = new Date().getFullYear();
    const bal = db.prepare(`
      SELECT total_days, used_days, pending_days
      FROM leave_balances
      WHERE employee_id = ? AND leave_type_id = ? AND year = ?
    `).get(employeeId, leaveTypeId, year);

    if (!bal) {
      if (lt && lt.days_per_year > 0) {
        db.prepare(`
          INSERT INTO leave_balances (employee_id, leave_type_id, year, total_days, used_days, pending_days)
          VALUES (?, ?, ?, ?, 0, 0)
        `).run(employeeId, leaveTypeId, year, lt.days_per_year);
        return { valid: true, available: lt.days_per_year, total: lt.days_per_year, used: 0, pending: 0 };
      }
      return { valid: false, error: 'No leave balance record found for this type', available: 0 };
    }

    const available = bal.total_days - bal.used_days - bal.pending_days;
    if (requestedDays > available) {
      return {
        valid: false,
        error: `Insufficient balance. Requested: ${requestedDays}, Available: ${available}`,
        available,
        total: bal.total_days,
        used: bal.used_days,
        pending: bal.pending_days
      };
    }

    return { valid: true, available, total: bal.total_days, used: bal.used_days, pending: bal.pending_days };
  }

  checkDoubleBooking(employeeId, dateFrom, dateTo, excludeRequestId = null) {
    const db = getDB();
    if (!employeeId || !dateFrom || !dateTo) {
      return { conflict: true, error: 'Missing required parameters' };
    }

    let query = `
      SELECT id, date_from, date_to, status
      FROM leave_applications
      WHERE employee_id = ?
        AND status IN ('Pending', 'Approved')
        AND date_from <= ?
        AND date_to >= ?
    `;
    const params = [employeeId, dateTo, dateFrom];

    if (excludeRequestId) {
      query += ' AND id != ?';
      params.push(excludeRequestId);
    }

    const conflict = db.prepare(query).get(...params);
    if (conflict) {
      return {
        conflict: true,
        error: `Date range overlaps with an existing ${conflict.status} leave (ID: ${conflict.id}, ${conflict.date_from} to ${conflict.date_to})`,
        conflictingId: conflict.id
      };
    }
    return { conflict: false };
  }

  detectThreeDayAbsenteeism() {
    const db = getDB();
    const today = new Date().toISOString().split('T')[0];
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
    const startDate = threeDaysAgo.toISOString().split('T')[0];

    const activeEmployees = db.prepare("SELECT id, employee_id, full_name FROM employees WHERE status = 'Active' AND awol_flag = 0").all();
    const exceptions = [];

    for (const emp of activeEmployees) {
      const attendanceCount = db.prepare(`
        SELECT COUNT(*) as count
        FROM attendance_records
        WHERE employee_id = ?
          AND date BETWEEN ? AND ?
          AND (am_in IS NOT NULL OR pm_in IS NOT NULL)
      `).get(emp.id, startDate, today).count;

      if (attendanceCount > 0) continue;

      const leaveCount = db.prepare(`
        SELECT COUNT(*) as count
        FROM leave_applications
        WHERE employee_id = ?
          AND status IN ('Approved', 'Pending')
          AND date_from <= ?
          AND date_to >= ?
      `).get(emp.id, today, startDate).count;

      if (leaveCount > 0) continue;

      const existing = db.prepare(`
        SELECT id FROM attendance_exceptions
        WHERE employee_id = ?
          AND exception_type = '3-Day AWOL'
          AND status = 'Open'
      `).get(emp.id);
      if (existing) continue;

      try {
        db.prepare(`
          INSERT INTO attendance_exceptions (employee_id, exception_type, start_date, end_date, days_missed, notes)
          VALUES (?, '3-Day AWOL', ?, ?, 3, ?)
        `).run(emp.id, startDate, today, `Auto-flagged: 0 attendance records and 0 leave applications from ${startDate} to ${today}`);

        db.prepare("UPDATE employees SET awol_flag = 1, awol_flag_date = date('now') WHERE id = ?").run(emp.id);

        exceptions.push({
          employeeId: emp.id,
          employee: emp.full_name,
          employee_id: emp.employee_id,
          startDate,
          endDate: today,
          daysMissed: 3
        });
      } catch (e) {
        console.error(`Failed to flag employee ${emp.employee_id}:`, e.message);
      }
    }

    return exceptions;
  }

  getAvailableBalance(employeeId, leaveTypeId) {
    const db = getDB();
    const year = new Date().getFullYear();

    const lt = db.prepare("SELECT days_per_year FROM leave_types WHERE id = ? AND is_active = 1").get(leaveTypeId);
    if (lt && lt.days_per_year === 0) {
      return { total_days: 0, used_days: 0, pending_days: 0, available: Infinity };
    }

    const bal = db.prepare(`
      SELECT total_days, used_days, pending_days
      FROM leave_balances
      WHERE employee_id = ? AND leave_type_id = ? AND year = ?
    `).get(employeeId, leaveTypeId, year);

    if (!bal) {
      if (lt && lt.days_per_year > 0) {
        db.prepare(`
          INSERT INTO leave_balances (employee_id, leave_type_id, year, total_days, used_days, pending_days)
          VALUES (?, ?, ?, ?, 0, 0)
        `).run(employeeId, leaveTypeId, year, lt.days_per_year);
        return { total_days: lt.days_per_year, used_days: 0, pending_days: 0, available: lt.days_per_year };
      }
      return { total_days: 0, used_days: 0, pending_days: 0, available: 0 };
    }
    return {
      total_days: bal.total_days,
      used_days: bal.used_days,
      pending_days: bal.pending_days,
      available: bal.total_days - bal.used_days - bal.pending_days
    };
  }

  getAllBalances(employeeId) {
    const db = getDB();
    const year = new Date().getFullYear();
    const allTypes = db.prepare('SELECT id, name, code, days_per_year FROM leave_types WHERE is_active = 1').all();
    for (const lt of allTypes) {
      if (lt.days_per_year > 0) {
        db.prepare(`
          INSERT INTO leave_balances (employee_id, leave_type_id, year, total_days, used_days, pending_days)
          VALUES (?, ?, ?, ?, 0, 0)
          ON CONFLICT(employee_id, leave_type_id, year) DO NOTHING
        `).run(employeeId, lt.id, year, lt.days_per_year);
      }
    }
    const balances = db.prepare(`
      SELECT lb.*, lt.name, lt.code, lt.days_per_year
      FROM leave_balances lb
      JOIN leave_types lt ON lb.leave_type_id = lt.id
      WHERE lb.employee_id = ? AND lb.year = ?
    `).all(employeeId, year);
    const result = balances.map(b => ({
      ...b,
      available: b.days_per_year === 0 ? Infinity : b.total_days - b.used_days - b.pending_days
    }));
    for (const lt of allTypes) {
      if (lt.days_per_year === 0 && !result.find(r => r.leave_type_id === lt.id)) {
        result.push({ leave_type_id: lt.id, name: lt.name, code: lt.code, days_per_year: 0, total_days: 0, used_days: 0, pending_days: 0, available: Infinity });
      }
    }
    return result;
  }

  _dateDiffDays(date1, date2) {
    const d1 = new Date(date1);
    const d2 = new Date(date2);
    return Math.floor((d2 - d1) / (1000 * 60 * 60 * 24));
  }
}

module.exports = new LeaveService();
