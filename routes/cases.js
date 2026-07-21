const express = require('express');
const { getDB } = require('../db/schema');
const { verifyToken } = require('../middleware/auth');
const { notifyPmAcknowledgement, notifyHrDeputyReview, notifyHrHeadApproval } = require('../services/notification');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const router = express.Router();

const novUpload = multer({ dest: path.join(__dirname, '..', 'public', 'uploads', 'case_docs'), limits: { fileSize: 10 * 1024 * 1024 } });

function generateCaseNumber(db) {
  const year = new Date().getFullYear();
  const count = db.prepare("SELECT COUNT(*) as count FROM disciplinary_cases WHERE strftime('%Y', created_at) = ?").get(String(year)).count + 1;
  return `DC-${year}-${String(count).padStart(4, '0')}`;
}

router.get('/', verifyToken, (req, res) => {
  const db = getDB();
  const page = parseInt(req.query.page) || 1;
  const limit = 20;
  const offset = (page - 1) * limit;
  const status = req.query.status || '';
  const search = req.query.search || '';

  let query = `
    SELECT dc.*, e.full_name as employee_name, e.employee_id as emp_id,
           oc.name as offense_name, oc.severity
    FROM disciplinary_cases dc
    JOIN employees e ON dc.employee_id = e.id
    LEFT JOIN offense_categories oc ON dc.offense_category_id = oc.id
    WHERE 1=1`;
  let countQuery = `
    SELECT COUNT(*) as count FROM disciplinary_cases dc
    JOIN employees e ON dc.employee_id = e.id
    WHERE 1=1`;
  const params = [];

  if (status) {
    query += ' AND dc.status = ?';
    countQuery += ' AND dc.status = ?';
    params.push(status);
  }
  if (search) {
    query += " AND (e.full_name LIKE ? OR dc.case_number LIKE ? OR dc.memo_number LIKE ?)";
    countQuery += " AND (e.full_name LIKE ? OR dc.case_number LIKE ? OR dc.memo_number LIKE ?)";
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }

  query += ' ORDER BY e.full_name ASC LIMIT ? OFFSET ?';
  const totalParams = [...params];
  params.push(limit, offset);

  const cases = db.prepare(query).all(...params);
  const total = db.prepare(countQuery).get(...totalParams).count;

  res.render('cases/index', {
    cases, total, page, limit, search, status,
    pages: Math.ceil(total / limit)
  });
});

router.get('/add', verifyToken, (req, res) => {
  const db = getDB();
  const offenses = db.prepare('SELECT * FROM offense_categories ORDER BY severity, name').all();
  const incidentReports = db.prepare("SELECT id, report_number, alleged_violator_name, incident_date, craft_position, department, immediate_supervisor, narrative_description FROM incident_reports WHERE status IN ('Open', 'Under Investigation') ORDER BY created_at DESC").all();
  const employees = db.prepare("SELECT id, employee_id, full_name, department, position FROM employees WHERE status = 'Active' ORDER BY full_name ASC").all();
  res.render('cases/form', { caseData: null, offenses, employees, incidentReports });
});

router.post('/add', verifyToken, (req, res) => {
  const db = getDB();
  const { employee_id, offense_category_id, incident_date, report_date, description, incident_report_id, memo_number, violation_classification, violation_details } = req.body;
  const case_number = generateCaseNumber(db);
  const result = db.prepare(
    `INSERT INTO disciplinary_cases (case_number, employee_id, offense_category_id, incident_date, report_date, description, incident_report_id, memo_number, violation_classification, violation_details, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(case_number, employee_id, offense_category_id || null, incident_date, report_date, description, incident_report_id || null, memo_number || null, violation_classification || null, violation_details || null, req.user.id);
  try {
    const emp = db.prepare('SELECT full_name FROM employees WHERE id = ?').get(employee_id);
    notifyPmAcknowledgement(case_number, emp ? emp.full_name : 'N/A', description, result.lastInsertRowid);
  } catch (e) {
    console.error('PM notification failed:', e.message);
  }
  res.redirect('/cases');
});

router.get('/edit/:id', verifyToken, (req, res) => {
  const db = getDB();
  const caseData = db.prepare(`
    SELECT dc.*, e.full_name as employee_name
    FROM disciplinary_cases dc
    LEFT JOIN employees e ON dc.employee_id = e.id
    WHERE dc.id = ?
  `).get(req.params.id);
  if (!caseData) return res.redirect('/cases');
  const offenses = db.prepare('SELECT * FROM offense_categories ORDER BY severity, name').all();
  const incidentReports = db.prepare("SELECT id, report_number, alleged_violator_name, incident_date FROM incident_reports ORDER BY created_at DESC").all();
  const employees = db.prepare("SELECT id, employee_id, full_name, department, position FROM employees WHERE status = 'Active' ORDER BY full_name ASC").all();
  res.render('cases/form', { caseData, offenses, employees, incidentReports, nteCases: [] });
});

router.post('/edit/:id', verifyToken, (req, res) => {
  const db = getDB();
  const { employee_id, offense_category_id, incident_date, report_date, description, status, penalty, resolution_date, verdict_decided_by, verdict_served_by, verdict_received_by, verdict_received_date, memo_number, violation_classification, violation_details, closed_date } = req.body;
  db.prepare(`
    UPDATE disciplinary_cases SET
      employee_id=?, offense_category_id=?, incident_date=?, report_date=?, description=?,
      status=?, penalty=?, resolution_date=?,
      verdict_decided_by=?, verdict_served_by=?, verdict_received_by=?, verdict_received_date=?,
      memo_number=?, violation_classification=?, violation_details=?, closed_date=?,
      updated_at=CURRENT_TIMESTAMP
    WHERE id=?
  `).run(employee_id, offense_category_id || null, incident_date, report_date, description, status, penalty, resolution_date || null, verdict_decided_by || null, verdict_served_by || null, verdict_received_by || null, verdict_received_date || null, memo_number || null, violation_classification || null, violation_details || null, closed_date || null, req.params.id);
  res.redirect('/cases');
});

router.get('/view/:id', verifyToken, (req, res) => {
  const db = getDB();
  const caseData = db.prepare(`
    SELECT dc.*, e.full_name as employee_name, e.employee_id as emp_id, e.department,
           e.position, oc.name as offense_name, oc.severity, oc.weight, u.full_name as created_by_name
    FROM disciplinary_cases dc
    JOIN employees e ON dc.employee_id = e.id
    LEFT JOIN offense_categories oc ON dc.offense_category_id = oc.id
    LEFT JOIN users u ON dc.created_by = u.id
    WHERE dc.id = ?
  `).get(req.params.id);
  if (!caseData) return res.redirect('/cases');

  const documents = db.prepare('SELECT * FROM case_documents WHERE case_id = ? ORDER BY created_at DESC').all(req.params.id);
  const hearings = db.prepare('SELECT * FROM hearings WHERE case_id = ? ORDER BY hearing_date ASC').all(req.params.id);
  const notes = db.prepare(`
    SELECT cn.*, u.full_name as author
    FROM case_notes cn
    LEFT JOIN users u ON cn.created_by = u.id
    WHERE cn.case_id = ? ORDER BY cn.created_at DESC
  `).all(req.params.id);
  const investigation = db.prepare('SELECT * FROM investigation_reports WHERE case_id = ? ORDER BY created_at DESC LIMIT 1').all(req.params.id);
  const appeals = db.prepare(`
    SELECT a.*, u.full_name as decided_by_name
    FROM case_appeals a
    LEFT JOIN users u ON a.decided_by = u.id
    WHERE a.case_id = ? ORDER BY a.created_at DESC
  `).all(req.params.id);

  const empId = caseData.employee_id;
  const threeStrikeWarning = db.prepare(`
    SELECT COUNT(*) as cnt FROM disciplinary_cases
    WHERE employee_id = ? AND id != ? AND status NOT IN ('Dismissed')
  `).get(empId, req.params.id);

  const cdafCount = db.prepare("SELECT COUNT(*) as cnt FROM cdaf_records WHERE employee_id = ? AND id NOT IN (SELECT COALESCE((SELECT id FROM cdaf_records WHERE id = 0), 0))").get(empId);

  let slaViolations = [];
  if (caseData.report_date && caseData.incident_date) {
    const d1 = new Date(caseData.incident_date);
    const d2 = new Date(caseData.report_date);
    const diffDays = Math.ceil((d2 - d1) / (1000 * 60 * 60 * 24));
    if (diffDays > 3) slaViolations.push(`Incident report submitted ${diffDays} days after incident (SLA: 3 days)`);
  }

  res.render('cases/view', { caseData, documents, hearings, notes, investigation, appeals, threeStrikeWarning, cdafCount, slaViolations });
});

router.post('/upload-nov/:id', verifyToken, novUpload.single('nov_nte_document'), (req, res) => {
  const db = getDB();
  if (!req.file) return res.redirect(`/cases/view/${req.params.id}`);
  const filePath = '/uploads/case_docs/' + req.file.filename;
  db.prepare('UPDATE disciplinary_cases SET nov_nte_document = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(filePath, req.params.id);
  res.redirect(`/cases/view/${req.params.id}`);
});

router.post('/serve/:id', verifyToken, (req, res) => {
  const db = getDB();
  const { notice_served_date, notice_received_by, notice_received_date } = req.body;
  db.prepare(`
    UPDATE disciplinary_cases SET notice_served_date=?, notice_received_by=?, notice_received_date=?, status='Under Investigation', updated_at=CURRENT_TIMESTAMP WHERE id=?
  `).run(notice_served_date || null, notice_received_by || null, notice_received_date || null, req.params.id);
  res.redirect(`/cases/view/${req.params.id}`);
});

router.post('/close/:id', verifyToken, (req, res) => {
  const db = getDB();
  db.prepare("UPDATE disciplinary_cases SET status='Closed', closed_date=date('now'), updated_at=CURRENT_TIMESTAMP WHERE id=?").run(req.params.id);
  res.redirect(`/cases/view/${req.params.id}`);
});

router.post('/note/:id', verifyToken, (req, res) => {
  const db = getDB();
  db.prepare('INSERT INTO case_notes (case_id, note, created_by) VALUES (?, ?, ?)')
    .run(req.params.id, req.body.note, req.user.id);
  res.redirect(`/cases/view/${req.params.id}`);
});

router.post('/decision-gate/:id', verifyToken, (req, res) => {
  const db = getDB();
  const { needs_investigation, decision_date, decision_notes } = req.body;
  const prevStatus = db.prepare('SELECT status FROM disciplinary_cases WHERE id = ?').get(req.params.id);
  if (!prevStatus) return res.redirect('/cases');

  const newStatus = parseInt(needs_investigation) === 1 ? 'Under Investigation' : 'Resolved';
  const newVerdict = parseInt(needs_investigation) === 1 ? null : 'Not Guilty';

  db.prepare(`
    UPDATE disciplinary_cases SET
      needs_investigation=?, status=?, verdict=?,
      decision_date=?, description=CASE WHEN ? IS NOT NULL AND ? != '' THEN description || '\n[Decision Notes]: ' || ? ELSE description END,
      updated_at=CURRENT_TIMESTAMP
    WHERE id=?
  `).run(
    needs_investigation ? 1 : 0,
    newStatus,
    newVerdict,
    decision_date || null,
    decision_notes, decision_notes, decision_notes || null,
    req.params.id
  );

  if (parseInt(needs_investigation) === 1 && decision_notes && decision_notes.trim()) {
    db.prepare('INSERT INTO case_notes (case_id, note, created_by) VALUES (?, ?, ?)')
      .run(req.params.id, `[Decision Gateway] Needs Investigation: ${decision_notes}`, req.user.id);
  }
  res.redirect(`/cases/view/${req.params.id}`);
});

router.post('/verdict/:id', verifyToken, (req, res) => {
  const db = getDB();
  const { penalty, verdict_decided_by, verdict_served_by, verdict_received_by, verdict_received_date } = req.body;
  db.prepare(`
    UPDATE disciplinary_cases SET
      penalty=?, verdict_decided_by=?, verdict_served_by=?,
      verdict_received_by=?, verdict_received_date=?, verdict_status='Pending Top Mgmt Approval',
      status='Resolved',
      resolution_date=date('now'),
      updated_at=CURRENT_TIMESTAMP
    WHERE id=?
  `).run(
    penalty || null, verdict_decided_by || null, verdict_served_by || null,
    verdict_received_by || null, verdict_received_date || null,
    req.params.id
  );
  try {
    const caseData = db.prepare(`
      SELECT dc.case_number, e.full_name as employee_name
      FROM disciplinary_cases dc JOIN employees e ON dc.employee_id = e.id
      WHERE dc.id = ?
    `).get(req.params.id);
    if (caseData) {
      notifyHrHeadApproval(null, caseData.case_number, caseData.employee_name, req.params.id);
    }
  } catch (e) {
    console.error('HR Head notification failed:', e.message);
  }
  res.redirect(`/cases/view/${req.params.id}`);
});

router.post('/approve-verdict/:id', verifyToken, (req, res) => {
  const db = getDB();
  const { verdict_approved_by, verdict_approved_date } = req.body;
  db.prepare(`
    UPDATE disciplinary_cases SET
      verdict_status='Approved',
      verdict_approved_by=?, verdict_approved_date=?,
      updated_at=CURRENT_TIMESTAMP
    WHERE id=?
  `).run(verdict_approved_by || null, verdict_approved_date || null, req.params.id);
  res.redirect(`/cases/view/${req.params.id}`);
});

router.post('/reject-verdict/:id', verifyToken, (req, res) => {
  const db = getDB();
  const { verdict_rejection_reason } = req.body;
  db.prepare(`
    UPDATE disciplinary_cases SET
      verdict_status='Rejected',
      verdict_rejection_reason=?, status='Under Investigation',
      updated_at=CURRENT_TIMESTAMP
    WHERE id=?
  `).run(verdict_rejection_reason || null, req.params.id);
  res.redirect(`/cases/view/${req.params.id}`);
});

router.post('/appeal/:id', verifyToken, (req, res) => {
  const db = getDB();
  const { appeal_date, appeal_reason } = req.body;
  db.prepare(`
    INSERT INTO case_appeals (case_id, appeal_date, appeal_reason, status)
    VALUES (?, ?, ?, 'Pending')
  `).run(req.params.id, appeal_date || null, appeal_reason || null);
  db.prepare("UPDATE disciplinary_cases SET status='Appealed', updated_at=CURRENT_TIMESTAMP WHERE id=?").run(req.params.id);
  res.redirect(`/cases/view/${req.params.id}`);
});

router.post('/resolve-appeal/:id', verifyToken, (req, res) => {
  const db = getDB();
  const { appeal_id, status, decision } = req.body;
  if (!appeal_id) return res.redirect(`/cases/view/${req.params.id}`);
  db.prepare(`
    UPDATE case_appeals SET status=?, decision=?, decided_by=?, decided_date=date('now')
    WHERE id=? AND status='Pending'
  `).run(status, decision || null, req.user.id, appeal_id);
  if (status === 'Denied') {
    db.prepare("UPDATE disciplinary_cases SET status='Resolved', updated_at=CURRENT_TIMESTAMP WHERE id=?").run(req.params.id);
  }
  res.redirect(`/cases/view/${req.params.id}`);
});

module.exports = router;
