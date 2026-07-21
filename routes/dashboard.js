const express = require('express');
const { getDB } = require('../db/schema');
const { verifyToken } = require('../middleware/auth');
const { logAudit } = require('../middleware/audit');
const { syncData } = require('../services/data-sync');

const router = express.Router();

function branchFilter(req) {
  const bid = req.user?.branch_id;
  if (bid) return ` AND e.branch_id = ${parseInt(bid)}`;
  return '';
}

function branchFilterDirect(table, req) {
  const bid = req.user?.branch_id;
  if (bid) return ` AND ${table}.branch_id = ${parseInt(bid)}`;
  return '';
}

router.get('/', verifyToken, (req, res) => {
  syncData();
  const db = getDB();
  const bf = branchFilter(req);
  const bfCases = req.user?.branch_id ? ` AND dc.id IN (SELECT id FROM disciplinary_cases WHERE employee_id IN (SELECT id FROM employees WHERE branch_id = ${parseInt(req.user.branch_id)}))` : '';
  const bfContracts = branchFilterDirect('c', req);
  const attDate = req.query.date ? `'${req.query.date}'` : 'date(\'now\', \'localtime\')';
  const today = new Date(); today.setMinutes(today.getMinutes() - today.getTimezoneOffset());
  const selectedDate = req.query.date || today.toISOString().slice(0, 10);

  const employeeCountQ = req.user?.branch_id
    ? db.prepare(`SELECT COUNT(*) as count FROM employees WHERE status = 'Active' AND branch_id = ?`).get(req.user.branch_id)
    : db.prepare("SELECT COUNT(*) as count FROM employees WHERE status = 'Active'").get();
  const totalEmployees = employeeCountQ.count;

  const caseTotalQ = req.user?.branch_id
    ? db.prepare(`SELECT COUNT(*) as count FROM disciplinary_cases WHERE employee_id IN (SELECT id FROM employees WHERE branch_id = ?)`).get(req.user.branch_id)
    : db.prepare('SELECT COUNT(*) as count FROM disciplinary_cases').get();
  const totalCases = caseTotalQ.count;

  const openCasesQ = req.user?.branch_id
    ? db.prepare(`SELECT COUNT(*) as count FROM disciplinary_cases WHERE employee_id IN (SELECT id FROM employees WHERE branch_id = ?) AND status IN ('Open', 'Under Investigation', 'For Hearing')`).get(req.user.branch_id)
    : db.prepare("SELECT COUNT(*) as count FROM disciplinary_cases WHERE status IN ('Open', 'Under Investigation', 'For Hearing')").get();
  const openCases = openCasesQ.count;

  const presentCount = req.user?.branch_id
    ? db.prepare(`SELECT COUNT(*) as c FROM attendance_records ar JOIN employees e ON ar.employee_id = e.id WHERE ar.date = ${attDate} AND ar.status = 'Present' AND e.status = 'Active' AND e.branch_id = ?`).get(req.user.branch_id).c
    : db.prepare(`SELECT COUNT(*) as c FROM attendance_records ar JOIN employees e ON ar.employee_id = e.id WHERE ar.date = ${attDate} AND ar.status = 'Present' AND e.status = 'Active'`).get().c;
  const lateCount = req.user?.branch_id
    ? db.prepare(`SELECT COUNT(*) as c FROM attendance_records ar JOIN employees e ON ar.employee_id = e.id WHERE ar.date = ${attDate} AND ar.status = 'Late' AND e.status = 'Active' AND e.branch_id = ?`).get(req.user.branch_id).c
    : db.prepare(`SELECT COUNT(*) as c FROM attendance_records ar JOIN employees e ON ar.employee_id = e.id WHERE ar.date = ${attDate} AND ar.status = 'Late' AND e.status = 'Active'`).get().c;
  const halfDayCount = req.user?.branch_id
    ? db.prepare(`SELECT COUNT(*) as c FROM attendance_records ar JOIN employees e ON ar.employee_id = e.id WHERE ar.date = ${attDate} AND ar.status = 'Half Day' AND e.status = 'Active' AND e.branch_id = ?`).get(req.user.branch_id).c
    : db.prepare(`SELECT COUNT(*) as c FROM attendance_records ar JOIN employees e ON ar.employee_id = e.id WHERE ar.date = ${attDate} AND ar.status = 'Half Day' AND e.status = 'Active'`).get().c;
  const absentCount = req.user?.branch_id
    ? db.prepare(`SELECT COUNT(*) as c FROM employees e WHERE e.status = 'Active' AND e.branch_id = ? AND e.id NOT IN (SELECT employee_id FROM attendance_records WHERE date = ${attDate} AND status IN ('Present','Late','Half Day','Sick Leave','Filed Leave','Emergency Leave','Holiday','Absent','AWOL') AND employee_id IS NOT NULL)`).get(req.user.branch_id).c
    : db.prepare(`SELECT COUNT(*) as c FROM employees e WHERE e.status = 'Active' AND e.id NOT IN (SELECT employee_id FROM attendance_records WHERE date = ${attDate} AND status IN ('Present','Late','Half Day','Sick Leave','Filed Leave','Emergency Leave','Holiday','Absent','AWOL') AND employee_id IS NOT NULL)`).get().c;
  const onLeaveCount = req.user?.branch_id
    ? db.prepare(`SELECT COUNT(*) as c FROM attendance_records ar JOIN employees e ON ar.employee_id = e.id WHERE ar.date = ${attDate} AND ar.status IN ('Sick Leave','Filed Leave','Emergency Leave') AND e.status = 'Active' AND e.branch_id = ?`).get(req.user.branch_id).c
    : db.prepare(`SELECT COUNT(*) as c FROM attendance_records ar JOIN employees e ON ar.employee_id = e.id WHERE ar.date = ${attDate} AND ar.status IN ('Sick Leave','Filed Leave','Emergency Leave') AND e.status = 'Active'`).get().c;
  const holidayCount = req.user?.branch_id
    ? db.prepare(`SELECT COUNT(*) as c FROM attendance_records ar JOIN employees e ON ar.employee_id = e.id WHERE ar.date = ${attDate} AND ar.status = 'Holiday' AND e.status = 'Active' AND e.branch_id = ?`).get(req.user.branch_id).c
    : db.prepare(`SELECT COUNT(*) as c FROM attendance_records ar JOIN employees e ON ar.employee_id = e.id WHERE ar.date = ${attDate} AND ar.status = 'Holiday' AND e.status = 'Active'`).get().c;

  const absentEmployees = req.user?.branch_id
    ? db.prepare(`SELECT e.id, e.full_name, e.employee_id, e.position, e.department, COALESCE(ar.status,'No Record') as att_status FROM employees e LEFT JOIN attendance_records ar ON ar.employee_id = e.id AND ar.date = ${attDate} WHERE e.status = 'Active' AND (ar.id IS NULL OR ar.status IN ('Absent','AWOL')) AND e.branch_id = ? ORDER BY e.full_name`).all(req.user.branch_id)
    : db.prepare(`SELECT e.id, e.full_name, e.employee_id, e.position, e.department, COALESCE(ar.status,'No Record') as att_status FROM employees e LEFT JOIN attendance_records ar ON ar.employee_id = e.id AND ar.date = ${attDate} WHERE e.status = 'Active' AND (ar.id IS NULL OR ar.status IN ('Absent','AWOL')) ORDER BY e.full_name`).all();

  const stats = {
    totalEmployees,
    todayPresent: presentCount + lateCount,
    presentCount,
    lateCount,
    absentCount,
    onLeaveCount,
    absentEmployees,
    openCases,
    expiringContracts: req.user?.branch_id
      ? db.prepare(`SELECT COUNT(*) as c FROM contracts WHERE end_date BETWEEN date('now') AND date('now', '+30 days') AND status = 'Active' AND branch_id = ?`).get(req.user.branch_id).c
      : db.prepare("SELECT COUNT(*) as c FROM contracts WHERE end_date BETWEEN date('now') AND date('now', '+30 days') AND status = 'Active'").get().c,
    bunkhouseOccupied: req.user?.branch_id
      ? db.prepare(`SELECT COUNT(*) as c FROM bunkhouse_occupants WHERE is_active = 1 AND room_id IN (SELECT id FROM bunkhouse_rooms WHERE branch_id = ?)`).get(req.user.branch_id).c
      : db.prepare("SELECT COUNT(*) as c FROM bunkhouse_occupants WHERE is_active = 1").get().c,
    bunkhouseTotal: req.user?.branch_id
      ? (db.prepare("SELECT SUM(capacity) as c FROM bunkhouse_rooms WHERE is_active = 1 AND branch_id = ?").get(req.user.branch_id).c || 0)
      : (db.prepare("SELECT SUM(capacity) as c FROM bunkhouse_rooms WHERE is_active = 1").get().c || 0),
    activeATD: req.user?.branch_id
      ? db.prepare(`SELECT COUNT(*) as c FROM atd_records WHERE status = 'Active' AND employee_id IN (SELECT id FROM employees WHERE branch_id = ?)`).get(req.user.branch_id).c
      : db.prepare("SELECT COUNT(*) as c FROM atd_records WHERE status = 'Active'").get().c,
  };

  const moduleStats = {};

  moduleStats.openPRF = req.user?.branch_id
    ? db.prepare("SELECT COUNT(*) as c FROM recruitment_requests WHERE status IN ('Open','In Progress') AND created_by IN (SELECT id FROM users WHERE branch_id = ?)").get(req.user.branch_id).c
    : db.prepare("SELECT COUNT(*) as c FROM recruitment_requests WHERE status IN ('Open','In Progress')").get().c;

  moduleStats.activeSubcon = db.prepare("SELECT COUNT(*) as c FROM subcon_employees WHERE is_active = 1").get().c;

  moduleStats.activeFieldChecks = db.prepare("SELECT COUNT(*) as c FROM field_checks WHERE status IN ('Open','Addressed')").get().c;

  moduleStats.manpowerAssign = db.prepare("SELECT COUNT(*) as c FROM manpower_assignments WHERE is_active = 1").get().c;

  moduleStats.openIncidents = db.prepare("SELECT COUNT(*) as c FROM incident_reports WHERE status = 'Open'").get().c;

  moduleStats.activeNte = db.prepare("SELECT COUNT(*) as c FROM nte_cases WHERE status IN ('Draft','Issued/Served','Replied')").get().c;

  moduleStats.scheduledHearings = db.prepare("SELECT COUNT(*) as c FROM hearings WHERE status = 'Scheduled' AND hearing_date >= date('now', 'localtime')").get().c;

  moduleStats.vaultDocs = db.prepare("SELECT COUNT(*) as c FROM document_vault").get().c;

  moduleStats.activeBranches = db.prepare("SELECT COUNT(*) as c FROM branches WHERE is_active = 1").get().c;

  moduleStats.activeUsers = db.prepare("SELECT COUNT(*) as c FROM users WHERE is_active = 1").get().c;

  db.prepare("UPDATE compliance_calendar SET status = 'Overdue' WHERE status = 'Pending' AND due_date < date('now', 'localtime')").run();

  const tasks = db.prepare("SELECT * FROM compliance_calendar WHERE status = 'Pending' AND due_date <= date('now', 'localtime', '+7 days') ORDER BY due_date ASC LIMIT 10").all();

  const statusData = req.user?.branch_id
    ? db.prepare(`SELECT status, COUNT(*) as count FROM disciplinary_cases WHERE employee_id IN (SELECT id FROM employees WHERE branch_id = ?) GROUP BY status`).all(req.user.branch_id)
    : db.prepare("SELECT status, COUNT(*) as count FROM disciplinary_cases GROUP BY status").all();
  const monthlyData = req.user?.branch_id
    ? db.prepare(`SELECT strftime('%Y-%m', created_at) as month, COUNT(*) as count FROM disciplinary_cases WHERE created_at >= date('now', '-6 months') AND employee_id IN (SELECT id FROM employees WHERE branch_id = ?) GROUP BY month ORDER BY month`).all(req.user.branch_id)
    : db.prepare(`SELECT strftime('%Y-%m', created_at) as month, COUNT(*) as count FROM disciplinary_cases WHERE created_at >= date('now', '-6 months') GROUP BY month ORDER BY month`).all();

  const recentCases = req.user?.branch_id
    ? db.prepare(`SELECT dc.*, e.full_name as employee_name, e.employee_id as emp_id FROM disciplinary_cases dc JOIN employees e ON dc.employee_id = e.id WHERE e.branch_id = ? ORDER BY dc.created_at DESC LIMIT 5`).all(req.user.branch_id)
    : db.prepare(`SELECT dc.*, e.full_name as employee_name, e.employee_id as emp_id FROM disciplinary_cases dc JOIN employees e ON dc.employee_id = e.id ORDER BY dc.created_at DESC LIMIT 5`).all();

  const upcomingHearings = req.user?.branch_id
    ? db.prepare(`SELECT h.*, dc.case_number, e.full_name as employee_name FROM hearings h JOIN disciplinary_cases dc ON h.case_id = dc.id JOIN employees e ON dc.employee_id = e.id WHERE h.status = 'Scheduled' AND h.hearing_date >= date('now') AND e.branch_id = ? ORDER BY h.hearing_date ASC LIMIT 5`).all(req.user.branch_id)
    : db.prepare(`SELECT h.*, dc.case_number, e.full_name as employee_name FROM hearings h JOIN disciplinary_cases dc ON h.case_id = dc.id JOIN employees e ON dc.employee_id = e.id WHERE h.status = 'Scheduled' AND h.hearing_date >= date('now') ORDER BY h.hearing_date ASC LIMIT 5`).all();

  const expiringContracts = req.user?.branch_id
    ? db.prepare(`SELECT c.id, e.full_name, c.end_date FROM contracts c JOIN employees e ON c.employee_id = e.id WHERE c.status = 'Active' AND c.end_date BETWEEN date('now') AND date('now', '+30 days') AND c.branch_id = ? ORDER BY c.end_date ASC LIMIT 10`).all(req.user.branch_id)
    : db.prepare(`SELECT c.id, e.full_name, c.end_date FROM contracts c JOIN employees e ON c.employee_id = e.id WHERE c.status = 'Active' AND c.end_date BETWEEN date('now') AND date('now', '+30 days') ORDER BY c.end_date ASC LIMIT 10`).all();

  const recentLogs = db.prepare("SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 10").all();

  const overdueRow = db.prepare("SELECT COUNT(*) as c FROM compliance_calendar WHERE status = 'Overdue'").get();
  const overdueCount = overdueRow ? overdueRow.c : 0;

  const severityData = req.user?.branch_id
    ? db.prepare(`SELECT oc.severity, COUNT(*) as count, SUM(oc.weight) as total_weight FROM disciplinary_cases dc JOIN offense_categories oc ON dc.offense_category_id = oc.id WHERE dc.employee_id IN (SELECT id FROM employees WHERE branch_id = ?) GROUP BY oc.severity ORDER BY oc.severity`).all(req.user.branch_id)
    : db.prepare(`SELECT oc.severity, COUNT(*) as count, SUM(oc.weight) as total_weight FROM disciplinary_cases dc JOIN offense_categories oc ON dc.offense_category_id = oc.id GROUP BY oc.severity ORDER BY oc.severity`).all();

  const groupData = req.user?.branch_id
    ? db.prepare(`SELECT SUBSTR(oc.code, 1, 1) as group_code, COUNT(*) as count, SUM(oc.weight) as total_weight FROM disciplinary_cases dc JOIN offense_categories oc ON dc.offense_category_id = oc.id WHERE dc.employee_id IN (SELECT id FROM employees WHERE branch_id = ?) GROUP BY group_code ORDER BY group_code`).all(req.user.branch_id)
    : db.prepare(`SELECT SUBSTR(oc.code, 1, 1) as group_code, COUNT(*) as count, SUM(oc.weight) as total_weight FROM disciplinary_cases dc JOIN offense_categories oc ON dc.offense_category_id = oc.id GROUP BY group_code ORDER BY group_code`).all();

  const topOffenses = req.user?.branch_id
    ? db.prepare(`SELECT oc.name, oc.code, oc.severity, oc.weight, COUNT(*) as count FROM disciplinary_cases dc JOIN offense_categories oc ON dc.offense_category_id = oc.id WHERE dc.employee_id IN (SELECT id FROM employees WHERE branch_id = ?) GROUP BY oc.id ORDER BY count DESC LIMIT 10`).all(req.user.branch_id)
    : db.prepare(`SELECT oc.name, oc.code, oc.severity, oc.weight, COUNT(*) as count FROM disciplinary_cases dc JOIN offense_categories oc ON dc.offense_category_id = oc.id GROUP BY oc.id ORDER BY count DESC LIMIT 10`).all();

  const repeatOffenders = req.user?.branch_id
    ? db.prepare(`SELECT e.id, e.full_name, e.employee_id, e.position, e.department, COUNT(*) as case_count, SUM(oc.weight) as total_weight FROM disciplinary_cases dc JOIN employees e ON dc.employee_id = e.id LEFT JOIN offense_categories oc ON dc.offense_category_id = oc.id WHERE e.branch_id = ? GROUP BY e.id HAVING case_count > 1 ORDER BY case_count DESC LIMIT 10`).all(req.user.branch_id)
    : db.prepare(`SELECT e.id, e.full_name, e.employee_id, e.position, e.department, COUNT(*) as case_count, SUM(oc.weight) as total_weight FROM disciplinary_cases dc JOIN employees e ON dc.employee_id = e.id LEFT JOIN offense_categories oc ON dc.offense_category_id = oc.id GROUP BY e.id HAVING case_count > 1 ORDER BY case_count DESC LIMIT 10`).all();

  const totalWeight = severityData.reduce((sum, s) => sum + (s.total_weight || 0), 0);

  res.render('dashboard', {
    totalCases, stats, moduleStats, tasks, statusData, monthlyData, recentCases,
    upcomingHearings, expiringContracts, recentLogs, overdueCount,
    severityData, totalWeight, groupData, topOffenses, repeatOffenders,
    selectedDate
  });
});

router.post('/attendance/mark-absent', verifyToken, (req, res) => {
  const db = getDB();
  const { employee_id } = req.body;
  const markNow = new Date();
  markNow.setMinutes(markNow.getMinutes() - markNow.getTimezoneOffset());
  const today = markNow.toISOString().slice(0, 10);
  const existing = db.prepare("SELECT id FROM attendance_records WHERE employee_id = ? AND date = ?").get(employee_id, today);
  if (existing) {
    db.prepare("UPDATE attendance_records SET status = 'Absent', remarks = 'Marked absent via dashboard override' WHERE id = ?").run(existing.id);
  } else {
    db.prepare("INSERT INTO attendance_records (employee_id, date, status, remarks) VALUES (?,?, 'Absent', 'Marked absent via dashboard override')").run(employee_id, today);
  }
  logAudit(req, 'Mark Absent', 'Attendance', employee_id, 'Manual override from dashboard');
  res.redirect('/');
});

module.exports = router;
