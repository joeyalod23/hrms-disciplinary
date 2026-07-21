const express = require('express');
const { getDB } = require('../db/schema');
const { verifyToken } = require('../middleware/auth');
const { logAudit } = require('../middleware/audit');

const router = express.Router();

function branchFilter(req) {
  const bid = req.user?.branch_id;
  if (bid) return ` AND branch_id = ${parseInt(bid)}`;
  return '';
}

function autoCreateContract(db, empId, dateHired, dateEnded, classification, projectSite, dailyRate, monthlyRate, branchId, createdBy) {
  if (!dateHired) return;
  const existing = db.prepare('SELECT id FROM contracts WHERE employee_id = ?').get(empId);
  if (existing) return;
  const endDate = dateEnded || (() => { const d = new Date(dateHired); d.setMonth(d.getMonth() + 6); return d.toISOString().split('T')[0]; })();
  const contractType = classification === 'Provisionary' ? 'Provisionary' : (classification || 'Project-Based');
  db.prepare(`INSERT INTO contracts (employee_id, contract_type, daily_rate, monthly_rate, start_date, end_date, project_site, remarks, created_by, branch_id) VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(empId, contractType, dailyRate || null, monthlyRate || null, dateHired, endDate, projectSite || 'Vail Land Development', dateEnded ? null : 'Auto-created - Provisional (no end date set)', createdBy || null, branchId || null);
}

function syncEmployeeDatesFromContract(db, employeeId, startDate, endDate) {
  const emp = db.prepare('SELECT date_hired, date_ended FROM employees WHERE id = ?').get(employeeId);
  if (!emp) return;
  const newHired = (!emp.date_hired && startDate) ? startDate : emp.date_hired;
  let newEnded = emp.date_ended;
  if (endDate) {
    if (!newEnded || new Date(endDate) > new Date(newEnded)) {
      newEnded = endDate;
    }
  }
  if (newHired !== emp.date_hired || newEnded !== emp.date_ended) {
    db.prepare('UPDATE employees SET date_hired = ?, date_ended = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(newHired, newEnded, employeeId);
  }
}

router.get('/', verifyToken, (req, res) => {
  const db = getDB();
  const page = parseInt(req.query.page) || 1;
  const limit = 20;
  const offset = (page - 1) * limit;
  const search = req.query.search || '';
  const status = req.query.status || '';
  const bid = req.user?.branch_id;
  const bf = bid ? ` AND branch_id = ${parseInt(bid)}` : '';
  const bfMain = bid ? ` AND e.branch_id = ${parseInt(bid)}` : '';

  let whereClause = '1=1' + bfMain;
  let countWhereClause = '1=1' + bf;
  const params = [];
  const countParams = [];

  if (status && status !== 'all') {
    whereClause += ' AND e.status = ?';
    countWhereClause += ' AND status = ?';
    params.push(status);
    countParams.push(status);
  }
  if (search) {
    whereClause += " AND (e.full_name LIKE ? OR e.employee_id LIKE ? OR e.department LIKE ? OR e.position LIKE ?)";
    countWhereClause += " AND (full_name LIKE ? OR employee_id LIKE ? OR department LIKE ? OR position LIKE ?)";
    params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
    countParams.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
  }
  const employees = db.prepare(`SELECT e.*, c.id AS contract_id, c.status AS contract_status, c.end_date AS contract_end_date, c.contract_type AS contract_type_name FROM employees e LEFT JOIN contracts c ON c.employee_id = e.id AND c.id = (SELECT c2.id FROM contracts c2 WHERE c2.employee_id = e.id ORDER BY c2.id DESC LIMIT 1) WHERE ${whereClause} ORDER BY e.full_name ASC LIMIT ? OFFSET ?`).all(...params, limit, offset);
  const total = db.prepare(`SELECT COUNT(*) as count FROM employees WHERE ${countWhereClause}`).get(...countParams).count;

  const statusCounts = {
    active: bid
      ? db.prepare("SELECT COUNT(*) as c FROM employees WHERE status = 'Active' AND branch_id = ?").get(bid).c
      : db.prepare("SELECT COUNT(*) as c FROM employees WHERE status = 'Active'").get().c,
    inactive: bid
      ? db.prepare("SELECT COUNT(*) as c FROM employees WHERE status = 'Inactive' AND branch_id = ?").get(bid).c
      : db.prepare("SELECT COUNT(*) as c FROM employees WHERE status = 'Inactive'").get().c,
    resigned: bid
      ? db.prepare("SELECT COUNT(*) as c FROM employees WHERE status = 'Resigned' AND branch_id = ?").get(bid).c
      : db.prepare("SELECT COUNT(*) as c FROM employees WHERE status = 'Resigned'").get().c,
    terminated: bid
      ? db.prepare("SELECT COUNT(*) as c FROM employees WHERE status = 'Terminated' AND branch_id = ?").get(bid).c
      : db.prepare("SELECT COUNT(*) as c FROM employees WHERE status = 'Terminated'").get().c,
  };

  res.render('employees/index', { employees, total, page, limit, search, pages: Math.ceil(total / limit), statusCounts, currentStatus: status });
});

router.get('/add', verifyToken, (req, res) => {
  const db = getDB();
  const departments = db.prepare('SELECT DISTINCT department FROM employees').all().map(d => d.department);
  const branches = db.prepare('SELECT id, name, code FROM branches WHERE is_active = 1 ORDER BY name').all();
  if (departments.length === 0) departments.push('FIELD', 'ADMIN', 'SAFETY');
  res.render('employees/form', { employee: null, departments, branches });
});

router.post('/add', verifyToken, (req, res) => {
  const db = getDB();
  const { employee_id, last_name, first_name, middle_name, full_name, position, trade, department, project_site, classification, date_hired, date_ended, status, gender, birth_date, nationality, civil_status, religion, blood_type, height, weight, contact_number, email, address, sss_no, pagibig_no, philhealth_no, daily_rate, monthly_rate, emergency_contact, emergency_contact_no, branch_id } = req.body;
  const finalName = full_name || [last_name, first_name, middle_name].filter(Boolean).join(' ');
  const assignedBranchId = branch_id || req.user?.branch_id || null;
  try {
    const result = db.prepare(`INSERT INTO employees (employee_id, last_name, first_name, middle_name, full_name, position, trade, department, project_site, classification, date_hired, date_ended, status, gender, birth_date, nationality, civil_status, religion, blood_type, height, weight, contact_number, email, address, sss_no, pagibig_no, philhealth_no, daily_rate, monthly_rate, emergency_contact, emergency_contact_no, branch_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(employee_id, last_name||'', first_name||'', middle_name||'', finalName, position||'', trade||null, department||'FIELD', project_site||'Vail Land Development', classification||'Project-Based', date_hired||null, date_ended||null, status||'Active', gender||null, birth_date||null, nationality||'Filipino', civil_status||null, religion||null, blood_type||null, height||null, weight||null, contact_number||null, email||null, address||null, sss_no||null, pagibig_no||null, philhealth_no||null, daily_rate||null, monthly_rate||null, emergency_contact||null, emergency_contact_no||null, assignedBranchId);
    autoCreateContract(db, result.lastInsertRowid, date_hired, date_ended, classification, project_site, daily_rate, monthly_rate, assignedBranchId, req.user.id);
    logAudit(req, 'Add Employee', 'Employee', null, finalName);
    res.redirect('/employees');
  } catch (err) {
    const departments = db.prepare('SELECT DISTINCT department FROM employees').all().map(d => d.department);
    res.render('employees/form', { employee: null, departments, error: 'Employee ID already exists' });
  }
});

router.get('/edit/:id', verifyToken, (req, res) => {
  const db = getDB();
  const employee = db.prepare('SELECT * FROM employees WHERE id = ?').get(req.params.id);
  if (!employee) return res.redirect('/employees');
  const departments = db.prepare('SELECT DISTINCT department FROM employees').all().map(d => d.department);
  const branches = db.prepare('SELECT id, name, code FROM branches WHERE is_active = 1 ORDER BY name').all();
  res.render('employees/form', { employee, departments, branches });
});

router.post('/edit/:id', verifyToken, (req, res) => {
  const db = getDB();
  const { last_name, first_name, middle_name, full_name, position, trade, department, project_site, classification, date_hired, date_ended, status, gender, birth_date, nationality, civil_status, religion, blood_type, height, weight, contact_number, email, address, sss_no, pagibig_no, philhealth_no, daily_rate, monthly_rate, emergency_contact, emergency_contact_no, branch_id } = req.body;
  const finalName = full_name || [last_name, first_name, middle_name].filter(Boolean).join(' ');
  const assignedBranchId = branch_id || req.user?.branch_id || null;
  db.prepare(`UPDATE employees SET last_name=?, first_name=?, middle_name=?, full_name=?, position=?, trade=?, department=?, project_site=?, classification=?, date_hired=?, date_ended=?, status=?, gender=?, birth_date=?, nationality=?, civil_status=?, religion=?, blood_type=?, height=?, weight=?, contact_number=?, email=?, address=?, sss_no=?, pagibig_no=?, philhealth_no=?, daily_rate=?, monthly_rate=?, emergency_contact=?, emergency_contact_no=?, branch_id=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`)
    .run(last_name||'', first_name||'', middle_name||'', finalName, position||'', trade||null, department||'FIELD', project_site||'Vail Land Development', classification||'Project-Based', date_hired||null, date_ended||null, status||'Active', gender||null, birth_date||null, nationality||'Filipino', civil_status||null, religion||null, blood_type||null, height||null, weight||null, contact_number||null, email||null, address||null, sss_no||null, pagibig_no||null, philhealth_no||null, daily_rate||null, monthly_rate||null, emergency_contact||null, emergency_contact_no||null, assignedBranchId, req.params.id);
  autoCreateContract(db, parseInt(req.params.id), date_hired, date_ended, classification, project_site, daily_rate, monthly_rate, assignedBranchId, req.user.id);
  logAudit(req, 'Edit Employee', 'Employee', req.params.id, finalName);
  res.redirect('/employees');
});

router.get('/view/:id', verifyToken, (req, res) => {
  const db = getDB();
  const employee = db.prepare('SELECT * FROM employees WHERE id = ?').get(req.params.id);
  if (!employee) return res.redirect('/employees');

  const cases = db.prepare(`
    SELECT dc.*, oc.name as offense_name, oc.severity
    FROM disciplinary_cases dc LEFT JOIN offense_categories oc ON dc.offense_category_id = oc.id
    WHERE dc.employee_id = ? ORDER BY dc.created_at DESC
  `).all(req.params.id);

  const contracts = db.prepare('SELECT * FROM contracts WHERE employee_id = ? ORDER BY start_date DESC').all(req.params.id);
  const attendance = db.prepare("SELECT * FROM attendance_monthly_summary WHERE employee_id = ? ORDER BY year DESC, month DESC LIMIT 6").all(req.params.id);
  const atds = db.prepare("SELECT * FROM atd_records WHERE employee_id = ? AND status = 'Active'").all(req.params.id);

  let contractAlert = null;
  if (contracts.length === 0) {
    contractAlert = { type: 'danger', icon: 'exclamation-octagon', message: 'No contract record found. Employee has no active contract on file.' };
  } else {
    const active = contracts.find(c => c.status === 'Active');
    if (active && active.end_date) {
      const daysLeft = Math.ceil((new Date(active.end_date) - new Date()) / (1000 * 60 * 60 * 24));
      if (daysLeft < 0) {
        contractAlert = { type: 'danger', icon: 'x-octagon', message: `Contract expired ${Math.abs(daysLeft)} day(s) ago on ${new Date(active.end_date).toLocaleDateString()}.` };
      } else if (daysLeft <= 30) {
        contractAlert = { type: 'warning', icon: 'exclamation-triangle', message: `Contract expiring in ${daysLeft} day(s) on ${new Date(active.end_date).toLocaleDateString()}.` };
      }
    } else if (!active) {
      contractAlert = { type: 'warning', icon: 'exclamation-triangle', message: 'No active contract found. Latest contract is not active.' };
    }
  }

  res.render('employees/view', { employee, cases, contracts, attendance, atds, contractAlert });
});

router.get('/api/search', verifyToken, (req, res) => {
  const db = getDB();
  const search = req.query.q || '';
  const bf = branchFilter(req);
  const employees = db.prepare(`SELECT id, employee_id, full_name, department, position, trade FROM employees WHERE status = 'Active'${bf} AND (full_name LIKE ? OR employee_id LIKE ?) LIMIT 20`)
    .all(`%${search}%`, `%${search}%`);
  res.json(employees);
});

module.exports = router;
