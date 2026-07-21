const express = require('express');
const { getDB } = require('../db/schema');
const { verifyToken } = require('../middleware/auth');
const { syncData } = require('../services/data-sync');

const router = express.Router();

function branchClause(req, prefix) {
  const bid = req.user?.branch_id;
  if (bid) return ` AND ${prefix}employee_id IN (SELECT id FROM employees WHERE branch_id = ${parseInt(bid)})`;
  const filter = req.query.branch_id;
  if (filter) return ` AND ${prefix}employee_id IN (SELECT id FROM employees WHERE branch_id = ${parseInt(filter)})`;
  return '';
}

router.get('/', verifyToken, (req, res) => {
  syncData();
  const db = getDB();
  const bf = branchClause(req, 'dc.');
  const isCorporate = !req.user?.branch_id;

  const totalCases = req.user?.branch_id
    ? db.prepare(`SELECT COUNT(*) as count FROM disciplinary_cases WHERE employee_id IN (SELECT id FROM employees WHERE branch_id = ?)`).get(req.user.branch_id).count
    : req.query.branch_id
      ? db.prepare(`SELECT COUNT(*) as count FROM disciplinary_cases WHERE employee_id IN (SELECT id FROM employees WHERE branch_id = ?)`).get(req.query.branch_id).count
      : db.prepare('SELECT COUNT(*) as count FROM disciplinary_cases').get().count;

  const totalEmployees = req.user?.branch_id
    ? db.prepare(`SELECT COUNT(*) as count FROM employees WHERE branch_id = ?`).get(req.user.branch_id).count
    : req.query.branch_id
      ? db.prepare(`SELECT COUNT(*) as count FROM employees WHERE branch_id = ?`).get(req.query.branch_id).count
      : db.prepare('SELECT COUNT(*) as count FROM employees').get().count;

  const activeEmployees = req.user?.branch_id
    ? db.prepare(`SELECT COUNT(*) as c FROM employees WHERE status = 'Active' AND branch_id = ?`).get(req.user.branch_id).c
    : req.query.branch_id
      ? db.prepare(`SELECT COUNT(*) as c FROM employees WHERE status = 'Active' AND branch_id = ?`).get(req.query.branch_id).c
      : db.prepare("SELECT COUNT(*) as c FROM employees WHERE status = 'Active'").get().c;

  const activeContracts = req.user?.branch_id
    ? db.prepare(`SELECT COUNT(*) as c FROM contracts WHERE status = 'Active' AND branch_id = ?`).get(req.user.branch_id).c
    : req.query.branch_id
      ? db.prepare(`SELECT COUNT(*) as c FROM contracts WHERE status = 'Active' AND branch_id = ?`).get(req.query.branch_id).c
      : db.prepare("SELECT COUNT(*) as c FROM contracts WHERE status = 'Active'").get().c;

  const todayPresent = req.user?.branch_id
    ? db.prepare(`SELECT COUNT(*) as c FROM attendance_records WHERE date = date('now') AND status = 'Present' AND employee_id IN (SELECT id FROM employees WHERE branch_id = ?)`).get(req.user.branch_id).c
    : req.query.branch_id
      ? db.prepare(`SELECT COUNT(*) as c FROM attendance_records WHERE date = date('now') AND status = 'Present' AND employee_id IN (SELECT id FROM employees WHERE branch_id = ?)`).get(req.query.branch_id).c
      : db.prepare("SELECT COUNT(*) as c FROM attendance_records WHERE date = date('now') AND status = 'Present'").get().c;

  const bunkhouseOcc = req.user?.branch_id
    ? db.prepare(`SELECT COUNT(*) as c FROM bunkhouse_occupants WHERE is_active = 1 AND room_id IN (SELECT id FROM bunkhouse_rooms WHERE branch_id = ?)`).get(req.user.branch_id).c
    : req.query.branch_id
      ? db.prepare(`SELECT COUNT(*) as c FROM bunkhouse_occupants WHERE is_active = 1 AND room_id IN (SELECT id FROM bunkhouse_rooms WHERE branch_id = ?)`).get(req.query.branch_id).c
      : db.prepare("SELECT COUNT(*) as c FROM bunkhouse_occupants WHERE is_active = 1").get().c;

  const bunkhouseTotal = req.user?.branch_id
    ? (db.prepare("SELECT SUM(capacity) as c FROM bunkhouse_rooms WHERE is_active = 1 AND branch_id = ?").get(req.user.branch_id).c || 1)
    : req.query.branch_id
      ? (db.prepare("SELECT SUM(capacity) as c FROM bunkhouse_rooms WHERE is_active = 1 AND branch_id = ?").get(req.query.branch_id).c || 1)
      : (db.prepare("SELECT SUM(capacity) as c FROM bunkhouse_rooms WHERE is_active = 1").get().c || 1);

  const openAtds = req.user?.branch_id
    ? db.prepare(`SELECT COUNT(*) as c FROM atd_records WHERE status = 'Active' AND employee_id IN (SELECT id FROM employees WHERE branch_id = ?)`).get(req.user.branch_id).c
    : req.query.branch_id
      ? db.prepare(`SELECT COUNT(*) as c FROM atd_records WHERE status = 'Active' AND employee_id IN (SELECT id FROM employees WHERE branch_id = ?)`).get(req.query.branch_id).c
      : db.prepare("SELECT COUNT(*) as c FROM atd_records WHERE status = 'Active'").get().c;

  const casesBySeverity = req.user?.branch_id
    ? db.prepare(`SELECT oc.severity, COUNT(*) as count FROM disciplinary_cases dc JOIN offense_categories oc ON dc.offense_category_id = oc.id WHERE dc.employee_id IN (SELECT id FROM employees WHERE branch_id = ?) GROUP BY oc.severity`).all(req.user.branch_id)
    : req.query.branch_id
      ? db.prepare(`SELECT oc.severity, COUNT(*) as count FROM disciplinary_cases dc JOIN offense_categories oc ON dc.offense_category_id = oc.id WHERE dc.employee_id IN (SELECT id FROM employees WHERE branch_id = ?) GROUP BY oc.severity`).all(req.query.branch_id)
      : db.prepare(`SELECT oc.severity, COUNT(*) as count FROM disciplinary_cases dc JOIN offense_categories oc ON dc.offense_category_id = oc.id GROUP BY oc.severity`).all();

  const casesByStatus = req.user?.branch_id
    ? db.prepare(`SELECT status, COUNT(*) as count FROM disciplinary_cases WHERE employee_id IN (SELECT id FROM employees WHERE branch_id = ?) GROUP BY status`).all(req.user.branch_id)
    : req.query.branch_id
      ? db.prepare(`SELECT status, COUNT(*) as count FROM disciplinary_cases WHERE employee_id IN (SELECT id FROM employees WHERE branch_id = ?) GROUP BY status`).all(req.query.branch_id)
      : db.prepare("SELECT status, COUNT(*) as count FROM disciplinary_cases GROUP BY status").all();

  const casesByDepartment = req.user?.branch_id
    ? db.prepare(`SELECT e.department, COUNT(*) as count FROM disciplinary_cases dc JOIN employees e ON dc.employee_id = e.id WHERE e.branch_id = ? GROUP BY e.department ORDER BY count DESC`).all(req.user.branch_id)
    : req.query.branch_id
      ? db.prepare(`SELECT e.department, COUNT(*) as count FROM disciplinary_cases dc JOIN employees e ON dc.employee_id = e.id WHERE e.branch_id = ? GROUP BY e.department ORDER BY count DESC`).all(req.query.branch_id)
      : db.prepare(`SELECT e.department, COUNT(*) as count FROM disciplinary_cases dc JOIN employees e ON dc.employee_id = e.id GROUP BY e.department ORDER BY count DESC`).all();

  const monthlyTrends = req.user?.branch_id
    ? db.prepare(`SELECT strftime('%Y-%m', created_at) as month, COUNT(*) as count FROM disciplinary_cases WHERE employee_id IN (SELECT id FROM employees WHERE branch_id = ?) GROUP BY month ORDER BY month LIMIT 12`).all(req.user.branch_id)
    : req.query.branch_id
      ? db.prepare(`SELECT strftime('%Y-%m', created_at) as month, COUNT(*) as count FROM disciplinary_cases WHERE employee_id IN (SELECT id FROM employees WHERE branch_id = ?) GROUP BY month ORDER BY month LIMIT 12`).all(req.query.branch_id)
      : db.prepare(`SELECT strftime('%Y-%m', created_at) as month, COUNT(*) as count FROM disciplinary_cases GROUP BY month ORDER BY month LIMIT 12`).all();

  const topOffenses = req.user?.branch_id
    ? db.prepare(`SELECT oc.name, COUNT(*) as count FROM disciplinary_cases dc JOIN offense_categories oc ON dc.offense_category_id = oc.id WHERE dc.employee_id IN (SELECT id FROM employees WHERE branch_id = ?) GROUP BY oc.name ORDER BY count DESC LIMIT 10`).all(req.user.branch_id)
    : req.query.branch_id
      ? db.prepare(`SELECT oc.name, COUNT(*) as count FROM disciplinary_cases dc JOIN offense_categories oc ON dc.offense_category_id = oc.id WHERE dc.employee_id IN (SELECT id FROM employees WHERE branch_id = ?) GROUP BY oc.name ORDER BY count DESC LIMIT 10`).all(req.query.branch_id)
      : db.prepare(`SELECT oc.name, COUNT(*) as count FROM disciplinary_cases dc JOIN offense_categories oc ON dc.offense_category_id = oc.id GROUP BY oc.name ORDER BY count DESC LIMIT 10`).all();

  const avgResolutionDays = req.user?.branch_id
    ? db.prepare(`SELECT AVG(julianday(resolution_date) - julianday(created_at)) as avg_days FROM disciplinary_cases WHERE resolution_date IS NOT NULL AND status = 'Resolved' AND employee_id IN (SELECT id FROM employees WHERE branch_id = ?)`).get(req.user.branch_id)
    : req.query.branch_id
      ? db.prepare(`SELECT AVG(julianday(resolution_date) - julianday(created_at)) as avg_days FROM disciplinary_cases WHERE resolution_date IS NOT NULL AND status = 'Resolved' AND employee_id IN (SELECT id FROM employees WHERE branch_id = ?)`).get(req.query.branch_id)
      : db.prepare(`SELECT AVG(julianday(resolution_date) - julianday(created_at)) as avg_days FROM disciplinary_cases WHERE resolution_date IS NOT NULL AND status = 'Resolved'`).get();

  const casesByCODGroup = req.user?.branch_id
    ? db.prepare(`SELECT SUBSTR(oc.code, 1, 1) as group_code, COUNT(*) as count, SUM(oc.weight) as total_weight FROM disciplinary_cases dc JOIN offense_categories oc ON dc.offense_category_id = oc.id WHERE dc.employee_id IN (SELECT id FROM employees WHERE branch_id = ?) GROUP BY group_code ORDER BY group_code`).all(req.user.branch_id)
    : req.query.branch_id
      ? db.prepare(`SELECT SUBSTR(oc.code, 1, 1) as group_code, COUNT(*) as count, SUM(oc.weight) as total_weight FROM disciplinary_cases dc JOIN offense_categories oc ON dc.offense_category_id = oc.id WHERE dc.employee_id IN (SELECT id FROM employees WHERE branch_id = ?) GROUP BY group_code ORDER BY group_code`).all(req.query.branch_id)
      : db.prepare(`SELECT SUBSTR(oc.code, 1, 1) as group_code, COUNT(*) as count, SUM(oc.weight) as total_weight FROM disciplinary_cases dc JOIN offense_categories oc ON dc.offense_category_id = oc.id GROUP BY group_code ORDER BY group_code`).all();

  const repeatOffenders = req.user?.branch_id
    ? db.prepare(`SELECT e.id, e.full_name, e.employee_id, e.position, e.department, COUNT(*) as case_count, SUM(oc.weight) as total_weight FROM disciplinary_cases dc JOIN employees e ON dc.employee_id = e.id LEFT JOIN offense_categories oc ON dc.offense_category_id = oc.id WHERE e.branch_id = ? GROUP BY e.id HAVING case_count > 1 ORDER BY total_weight DESC, case_count DESC LIMIT 10`).all(req.user.branch_id)
    : req.query.branch_id
      ? db.prepare(`SELECT e.id, e.full_name, e.employee_id, e.position, e.department, COUNT(*) as case_count, SUM(oc.weight) as total_weight FROM disciplinary_cases dc JOIN employees e ON dc.employee_id = e.id LEFT JOIN offense_categories oc ON dc.offense_category_id = oc.id WHERE e.branch_id = ? GROUP BY e.id HAVING case_count > 1 ORDER BY total_weight DESC, case_count DESC LIMIT 10`).all(req.query.branch_id)
      : db.prepare(`SELECT e.id, e.full_name, e.employee_id, e.position, e.department, COUNT(*) as case_count, SUM(oc.weight) as total_weight FROM disciplinary_cases dc JOIN employees e ON dc.employee_id = e.id LEFT JOIN offense_categories oc ON dc.offense_category_id = oc.id GROUP BY e.id HAVING case_count > 1 ORDER BY total_weight DESC, case_count DESC LIMIT 10`).all();

  const totalWeight = casesBySeverity.reduce((sum, s) => sum + (s.total_weight || 0), 0);

  const nteStats = req.user?.branch_id
    ? db.prepare(`SELECT COUNT(*) as total, SUM(CASE WHEN status = 'Draft' THEN 1 ELSE 0 END) as draft, SUM(CASE WHEN status = 'Issued/Served' THEN 1 ELSE 0 END) as issued, SUM(CASE WHEN status = 'Replied' THEN 1 ELSE 0 END) as replied FROM nte_cases WHERE employee_id IN (SELECT id FROM employees WHERE branch_id = ?)`).get(req.user.branch_id)
    : req.query.branch_id
      ? db.prepare(`SELECT COUNT(*) as total, SUM(CASE WHEN status = 'Draft' THEN 1 ELSE 0 END) as draft, SUM(CASE WHEN status = 'Issued/Served' THEN 1 ELSE 0 END) as issued, SUM(CASE WHEN status = 'Replied' THEN 1 ELSE 0 END) as replied FROM nte_cases WHERE employee_id IN (SELECT id FROM employees WHERE branch_id = ?)`).get(req.query.branch_id)
      : db.prepare(`SELECT COUNT(*) as total, SUM(CASE WHEN status = 'Draft' THEN 1 ELSE 0 END) as draft, SUM(CASE WHEN status = 'Issued/Served' THEN 1 ELSE 0 END) as issued, SUM(CASE WHEN status = 'Replied' THEN 1 ELSE 0 END) as replied FROM nte_cases`).get();

  const investigationStats = db.prepare(`SELECT COUNT(*) as total, SUM(CASE WHEN status = 'Draft' THEN 1 ELSE 0 END) as draft, SUM(CASE WHEN status = 'Submitted' THEN 1 ELSE 0 END) as submitted, SUM(CASE WHEN status = 'Final' THEN 1 ELSE 0 END) as final FROM investigation_reports`).get();

  const cdafStats = db.prepare(`SELECT COUNT(*) as total, SUM(CASE WHEN action_type = 'Verbal Reprimand' THEN 1 ELSE 0 END) as verbal, SUM(CASE WHEN action_type = 'Written Reprimand' THEN 1 ELSE 0 END) as written, SUM(CASE WHEN status = 'Open' THEN 1 ELSE 0 END) as open FROM cdaf_records`).get();

  const branches = db.prepare(`
    SELECT b.id, b.name, b.code,
           (SELECT COUNT(*) FROM employees e WHERE e.branch_id = b.id) as employee_count,
           (SELECT COUNT(*) FROM employees e WHERE e.branch_id = b.id AND e.status = 'Active') as active_employee_count,
           (SELECT COUNT(*) FROM disciplinary_cases dc WHERE dc.employee_id IN (SELECT id FROM employees WHERE branch_id = b.id)) as case_count,
           (SELECT COUNT(*) FROM atd_records ar WHERE ar.employee_id IN (SELECT id FROM employees WHERE branch_id = b.id) AND ar.status = 'Active') as atd_count
    FROM branches b WHERE b.is_active = 1 ORDER BY b.name
  `).all();

  const selectedBranchId = !req.user?.branch_id ? (req.query.branch_id || '') : '';

  res.render('reports/index', {
    totalCases, totalEmployees, casesBySeverity, casesByStatus,
    casesByDepartment, monthlyTrends, topOffenses, avgResolutionDays,
    activeEmployees, activeContracts, todayPresent, bunkhouseOcc, bunkhouseTotal,
    openAtds, isCorporate, branches, selectedBranchId,
    casesByCODGroup, repeatOffenders, totalWeight,
    nteStats, investigationStats, cdafStats
  });
});

router.get('/export', verifyToken, (req, res) => {
  const db = getDB();
  const type = req.query.type || 'disciplinary';
  const bf = branchClause(req, 'dc.');

  function employeeScope(table) {
    const bid = req.user?.branch_id;
    if (bid) return ` AND ${table}.employee_id IN (SELECT id FROM employees WHERE branch_id = ${parseInt(bid)})`;
    const filter = req.query.branch_id;
    if (filter) return ` AND ${table}.employee_id IN (SELECT id FROM employees WHERE branch_id = ${parseInt(filter)})`;
    return '';
  }

  function directScope(table) {
    const bid = req.user?.branch_id;
    if (bid) return ` AND ${table}.branch_id = ${parseInt(bid)}`;
    const filter = req.query.branch_id;
    if (filter) return ` AND ${table}.branch_id = ${parseInt(filter)}`;
    return '';
  }

  if (type === 'all' || type === 'disciplinary') {
    const cases = db.prepare(`
      SELECT dc.case_number, e.full_name as employee_name, e.department, e.employee_id,
             oc.name as offense, oc.severity, dc.incident_date, dc.report_date,
             dc.status, dc.penalty, dc.resolution_date, dc.created_at
      FROM disciplinary_cases dc JOIN employees e ON dc.employee_id = e.id
      LEFT JOIN offense_categories oc ON dc.offense_category_id = oc.id
      WHERE 1=1 ${employeeScope('dc')}
      ORDER BY dc.created_at DESC
    `).all();
    const fields = ['case_number','employee_name','department','employee_id','offense','severity','incident_date','report_date','status','penalty','resolution_date','created_at'];
    let csv = fields.join(',') + '\n';
    for (const row of cases) {
      csv += fields.map(f => `"${(row[f] || '').toString().replace(/"/g, '""')}"`).join(',') + '\n';
    }
    if (type === 'disciplinary') {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=disciplinary_cases_export.csv');
      return res.send(csv);
    }
  }

  if (type === 'all' || type === 'employees') {
    const es = directScope('e');
    const emps = db.prepare(`SELECT e.employee_id, e.full_name, e.position, e.trade, e.department, e.project_site, e.classification, e.date_hired, e.status, e.sss_no, e.pagibig_no, e.philhealth_no, e.daily_rate FROM employees e WHERE 1=1 ${es.replace('AND', '')} ORDER BY e.full_name`).all();
    let csv = 'Employee ID,Name,Position,Trade,Department,Project Site,Classification,Date Hired,Status,SSS,Pag-IBIG,PhilHealth,Daily Rate\n';
    for (const e of emps) {
      csv += `"${e.employee_id}","${e.full_name}","${e.position||''}","${e.trade||''}","${e.department}","${e.project_site}","${e.classification}","${e.date_hired||''}","${e.status}","${e.sss_no||''}","${e.pagibig_no||''}","${e.philhealth_no||''}","${e.daily_rate||''}"\n`;
    }
    if (type === 'employees') {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=employees_export.csv');
      return res.send(csv);
    }
  }

  if (type === 'all' || type === 'attendance') {
    const att = db.prepare(`
      SELECT e.employee_id, e.full_name, ar.date, ar.am_in, ar.am_out, ar.pm_in, ar.pm_out, ar.status, ar.tardiness_minutes
      FROM attendance_records ar JOIN employees e ON ar.employee_id = e.id
      WHERE 1=1 ${employeeScope('ar')}
      ORDER BY ar.date DESC LIMIT 1000
    `).all();
    let csv = 'Employee ID,Name,Date,AM In,AM Out,PM In,PM Out,Status,Tardiness (min)\n';
    for (const r of att) {
      csv += `"${r.employee_id}","${r.full_name}","${r.date}","${r.am_in||''}","${r.am_out||''}","${r.pm_in||''}","${r.pm_out||''}","${r.status}","${r.tardiness_minutes}"\n`;
    }
    if (type === 'attendance') {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=attendance_export.csv');
      return res.send(csv);
    }
  }

  if (type === 'all' || type === 'contracts') {
    const cont = db.prepare(`
      SELECT e.employee_id, e.full_name, c.contract_type, c.daily_rate, c.monthly_rate, c.start_date, c.end_date, c.status, c.project_site
      FROM contracts c JOIN employees e ON c.employee_id = e.id
      WHERE 1=1 ${directScope('c')}
      ORDER BY c.end_date ASC
    `).all();
    let csv = 'Employee ID,Name,Type,Daily Rate,Monthly Rate,Start Date,End Date,Status,Project Site\n';
    for (const c of cont) {
      csv += `"${c.employee_id}","${c.full_name}","${c.contract_type}","${c.daily_rate||''}","${c.monthly_rate||''}","${c.start_date}","${c.end_date}","${c.status}","${c.project_site}"\n`;
    }
    if (type === 'contracts') {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=contracts_export.csv');
      return res.send(csv);
    }
  }

  if (type === 'all') {
    const a = db.prepare(`SELECT e.employee_id, e.full_name, a.atd_number, a.total_deduction, a.status FROM atd_records a JOIN employees e ON a.employee_id = e.id WHERE 1=1 ${employeeScope('a')} ORDER BY a.created_at DESC`).all();
    let csv = 'Employee ID,Name,ATD#,Total Deduction,Status\n';
    for (const r of a) {
      csv += `"${r.employee_id}","${r.full_name}","${r.atd_number}","${r.total_deduction}","${r.status}"\n`;
    }
    const m = db.prepare(`SELECT category, trade, is_subcon, q4_2025, jan_2026, required_bow, balance FROM manpower_loading WHERE 1=1 ${directScope('m')} ORDER BY category, is_subcon, trade`).all();
    csv += '\n\nMANPOWER LOADING\nCategory,Trade,Subcon,Q4 2025,Jan 2026,Required BOW,Balance\n';
    for (const r of m) {
      csv += `"${r.category}","${r.trade}","${r.is_subcon ? 'Yes' : 'No'}","${r.q4_2025||0}","${r.jan_2026||0}","${r.required_bow||0}","${r.balance||0}"\n`;
    }
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=sitevigil_hr_full_report_${new Date().toISOString().split('T')[0]}.csv`);
    return res.send(csv);
  }

  res.redirect('/reports');
});

module.exports = router;
