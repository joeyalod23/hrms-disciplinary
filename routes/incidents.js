const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { verifyToken } = require('../middleware/auth');
const { getDB } = require('../db/schema');
const { ocrImage } = require('../services/ocr');
const { notifyPmAcknowledgement } = require('../services/notification');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const ocrUpload = multer({ dest: path.join(__dirname, '..', 'public', 'uploads', 'ocr_temp'), limits: { fileSize: 10 * 1024 * 1024 } });
const ocrDir = path.join(__dirname, '..', 'public', 'uploads', 'ocr_temp');
if (!fs.existsSync(ocrDir)) fs.mkdirSync(ocrDir, { recursive: true });
const NTE_DEADLINE_DAYS = 5;
const INCIDENT_SUBMISSION_SLA_DAYS = 3;
const NTE_ISSUANCE_SLA_DAYS = 2;

function generateReportNumber(db) {
  const year = new Date().getFullYear();
  const count = db.prepare("SELECT COUNT(*) as count FROM incident_reports WHERE strftime('%Y', created_at) = ?").get(String(year)).count + 1;
  return `IR-${year}-${String(count).padStart(4, '0')}`;
}

function calcNteDeadline(dateReported) {
  if (!dateReported) return null;
  const d = new Date(dateReported);
  d.setDate(d.getDate() + NTE_DEADLINE_DAYS);
  return d.toISOString().split('T')[0];
}

router.post('/ocr-upload', verifyToken, ocrUpload.single('document'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  try {
    const result = await ocrImage(req.file.path);
    try { fs.unlinkSync(req.file.path); } catch (e) {}
    res.json(result);
  } catch (err) {
    try { fs.unlinkSync(req.file.path); } catch (e) {}
    res.status(500).json({ error: err.message });
  }
});

router.get('/', verifyToken, (req, res) => {
  const db = getDB();
  const page = parseInt(req.query.page) || 1;
  const limit = 20;
  const offset = (page - 1) * limit;
  const status = req.query.status || '';
  const search = req.query.search || '';
  const nte_overdue = req.query.nte_overdue || '';

  let query = `SELECT i.*, u.full_name as created_by_name,
    CASE WHEN i.nte_deadline_date IS NOT NULL AND i.nte_issued_date IS NULL AND date(i.nte_deadline_date) < date('now') THEN 1 ELSE 0 END as nte_overdue_flag
    FROM incident_reports i LEFT JOIN users u ON i.created_by = u.id WHERE 1=1`;
  let countQuery = 'SELECT COUNT(*) as count FROM incident_reports i WHERE 1=1';
  const params = [];

  if (status) {
    query += ' AND i.status = ?';
    countQuery += ' AND i.status = ?';
    params.push(status);
  }
  if (nte_overdue === '1') {
    query += " AND i.nte_deadline_date IS NOT NULL AND i.nte_issued_date IS NULL AND date(i.nte_deadline_date) < date('now')";
    countQuery += " AND i.nte_deadline_date IS NOT NULL AND i.nte_issued_date IS NULL AND date(i.nte_deadline_date) < date('now')";
  }
  if (search) {
    query += " AND (i.alleged_violator_name LIKE ? OR i.report_number LIKE ? OR i.incident_type LIKE ?)";
    countQuery += " AND (i.alleged_violator_name LIKE ? OR i.report_number LIKE ? OR i.incident_type LIKE ?)";
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }

  const bf = req.user?.branch_id ? ` AND i.branch_id = ${parseInt(req.user.branch_id)}` : '';
  if (bf) {
    query += bf;
    countQuery += bf;
  }

  query += ' ORDER BY i.alleged_violator_name ASC LIMIT ? OFFSET ?';
  const totalParams = [...params];
  params.push(limit, offset);

  const reports = db.prepare(query).all(...params);
  const total = db.prepare(countQuery).get(...totalParams).count;

  res.render('incidents/index', {
    reports, total, page, limit, search, status, nte_overdue,
    pages: Math.ceil(total / limit)
  });
});

router.get('/add', verifyToken, (req, res) => {
  const db = getDB();
  const employees = db.prepare("SELECT id, employee_id, full_name, department, position FROM employees WHERE status = 'Active' ORDER BY full_name ASC").all();
  res.render('incidents/form', { report: null, employees, today: new Date().toISOString().split('T')[0] });
});

router.post('/add', verifyToken, (req, res) => {
  const db = getDB();
  const {
    project_name, address, employee_id, alleged_violator_name, craft_position,
    department, immediate_supervisor, incident_date, incident_time, date_reported,
    location_of_incident, location_other, incident_type, type_other,
    others_involved, witnesses, narrative_description,
    reported_by, reported_date, noted_by, noted_date, reviewed_by, reviewed_date
  } = req.body;

  const locationVal = Array.isArray(location_of_incident) ? location_of_incident.join(', ') : (location_of_incident || '');
  const typeVal = Array.isArray(incident_type) ? incident_type.join(', ') : (incident_type || '');
  const nte_deadline_date = calcNteDeadline(date_reported || incident_date);

  let slaIncidentSubmission = 0;
  let slaIncidentNotes = null;
  if (incident_date && date_reported) {
    const dInc = new Date(incident_date);
    const dRep = new Date(date_reported || incident_date);
    const diffDays = Math.ceil((dRep - dInc) / (1000 * 60 * 60 * 24));
    if (diffDays > INCIDENT_SUBMISSION_SLA_DAYS) {
      slaIncidentSubmission = 1;
      slaIncidentNotes = `Reported ${diffDays} days after incident (SLA: ${INCIDENT_SUBMISSION_SLA_DAYS} days)`;
    }
  }

  const report_number = generateReportNumber(db);
  const branch_id = req.user?.branch_id || null;
  const result = db.prepare(`
    INSERT INTO incident_reports (
      report_number, project_name, address, employee_id, alleged_violator_name,
      craft_position, department, immediate_supervisor,
      incident_date, incident_time, date_reported,
      location_of_incident, location_other, incident_type, type_other,
      others_involved, witnesses, narrative_description,
      reported_by, reported_date, noted_by, noted_date, reviewed_by, reviewed_date,
      nte_deadline_date, sla_incident_submission, sla_incident_notes, created_by, branch_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    report_number, project_name || 'Vail Land Development', address || null, employee_id, alleged_violator_name,
    craft_position || null, department || null, immediate_supervisor || null,
    incident_date, incident_time || null, date_reported || incident_date,
    locationVal || null, location_other || null, typeVal || null, type_other || null,
    others_involved || null, witnesses || null, narrative_description,
    reported_by || null, reported_date || null, noted_by || null, noted_date || null,
    reviewed_by || null, reviewed_date || null,
    nte_deadline_date, slaIncidentSubmission, slaIncidentNotes, req.user.id, branch_id
  );
  try {
    notifyPmAcknowledgement(report_number, alleged_violator_name, narrative_description, result.lastInsertRowid);
  } catch (e) {
    console.error('PM notification failed:', e.message);
  }
  res.redirect('/incidents');
});

router.get('/print/:id', verifyToken, (req, res) => {
  const db = getDB();
  const report = db.prepare('SELECT * FROM incident_reports WHERE id = ?').get(req.params.id);
  if (!report) return res.redirect('/incidents');
  res.render('incidents/print', { report, layout: false });
});

router.get('/view/:id', verifyToken, (req, res) => {
  const db = getDB();
  const report = db.prepare(`
    SELECT i.*, u.full_name as created_by_name,
      CASE WHEN i.nte_deadline_date IS NOT NULL AND i.nte_issued_date IS NULL AND date(i.nte_deadline_date) < date('now') THEN 1 ELSE 0 END as nte_overdue_flag
    FROM incident_reports i
    LEFT JOIN users u ON i.created_by = u.id
    WHERE i.id = ?
  `).get(req.params.id);
  if (!report) return res.redirect('/incidents');
  res.render('incidents/view', { report });
});

router.get('/edit/:id', verifyToken, (req, res) => {
  const db = getDB();
  const report = db.prepare('SELECT * FROM incident_reports WHERE id = ?').get(req.params.id);
  if (!report) return res.redirect('/incidents');
  const employees = db.prepare("SELECT id, employee_id, full_name, department, position FROM employees WHERE status = 'Active' ORDER BY full_name ASC").all();
  res.render('incidents/form', { report, employees, today: '' });
});

router.post('/edit/:id', verifyToken, (req, res) => {
  const db = getDB();
  const {
    project_name, address, employee_id, alleged_violator_name, craft_position,
    department, immediate_supervisor, incident_date, incident_time, date_reported,
    location_of_incident, location_other, incident_type, type_other,
    others_involved, witnesses, narrative_description,
    reported_by, reported_date, noted_by, noted_date, reviewed_by, reviewed_date,
    status, resolution_date, resolution_notes
  } = req.body;

  const locationVal = Array.isArray(location_of_incident) ? location_of_incident.join(', ') : (location_of_incident || '');
  const typeVal = Array.isArray(incident_type) ? incident_type.join(', ') : (incident_type || '');
  const nte_deadline_date = calcNteDeadline(date_reported || incident_date);

  let slaIncidentSubmission = 0;
  let slaIncidentNotes = null;
  if (incident_date && date_reported) {
    const dInc = new Date(incident_date);
    const dRep = new Date(date_reported || incident_date);
    const diffDays = Math.ceil((dRep - dInc) / (1000 * 60 * 60 * 24));
    if (diffDays > INCIDENT_SUBMISSION_SLA_DAYS) {
      slaIncidentSubmission = 1;
      slaIncidentNotes = `Reported ${diffDays} days after incident (SLA: ${INCIDENT_SUBMISSION_SLA_DAYS} days)`;
    }
  }

  db.prepare(`
    UPDATE incident_reports SET
      project_name=?, address=?, employee_id=?, alleged_violator_name=?,
      craft_position=?, department=?, immediate_supervisor=?,
      incident_date=?, incident_time=?, date_reported=?,
      location_of_incident=?, location_other=?, incident_type=?, type_other=?,
      others_involved=?, witnesses=?, narrative_description=?,
      reported_by=?, reported_date=?, noted_by=?, noted_date=?, reviewed_by=?, reviewed_date=?,
      status=?, resolution_date=?, resolution_notes=?, nte_deadline_date=?,
      sla_incident_submission=?, sla_incident_notes=?, updated_at=CURRENT_TIMESTAMP
    WHERE id=?
  `).run(
    project_name || 'Vail Land Development', address || null, employee_id, alleged_violator_name,
    craft_position || null, department || null, immediate_supervisor || null,
    incident_date, incident_time || null, date_reported || incident_date,
    locationVal || null, location_other || null, typeVal || null, type_other || null,
    others_involved || null, witnesses || null, narrative_description,
    reported_by || null, reported_date || null, noted_by || null, noted_date || null,
    reviewed_by || null, reviewed_date || null,
    status || 'Open', resolution_date || null, resolution_notes || null,
    nte_deadline_date, slaIncidentSubmission, slaIncidentNotes, req.params.id
  );
  res.redirect('/incidents');
});

router.post('/issue-nte/:id', verifyToken, (req, res) => {
  const db = getDB();
  const { nte_issued_date, nte_notes } = req.body;
  const ir = db.prepare('SELECT * FROM incident_reports WHERE id = ?').get(req.params.id);
  if (!ir) return res.redirect('/incidents');

  let slaNteNotes = null;
  if (ir.date_reported && nte_issued_date) {
    const dateRep = new Date(ir.date_reported);
    const dateIssued = new Date(nte_issued_date);
    const diffDays = Math.ceil((dateIssued - dateRep) / (1000 * 60 * 60 * 24));
    if (diffDays > NTE_ISSUANCE_SLA_DAYS) {
      slaNteNotes = `NTE issued ${diffDays} day(s) after report (SLA: ${NTE_ISSUANCE_SLA_DAYS} working days)`;
    }
  }

  const combinedNotes = [nte_notes, slaNteNotes].filter(Boolean).join(' | ');
  db.prepare(`UPDATE incident_reports SET nte_issued_date=?, nte_notes=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`)
    .run(nte_issued_date || null, combinedNotes || null, req.params.id);
  const existingNte = db.prepare('SELECT id FROM nte_cases WHERE incident_report_id = ?').get(req.params.id);
  if (existingNte) return res.redirect(`/nte/view/${existingNte.id}`);
  const year = new Date().getFullYear();
  const count = db.prepare("SELECT COUNT(*) as count FROM nte_cases WHERE strftime('%Y', created_at) = ?").get(String(year)).count + 1;
  const memo_number = `NTE-${year}-${String(count).padStart(4, '0')}`;
  const nteBody = `You are hereby required to explain in writing within twenty-four (24) hours from receipt of this Notice why no disciplinary action should be taken against you for the incident described below:\n\nIncident Report Reference: ${ir.report_number}\nDate of Incident: ${ir.incident_date} ${ir.incident_time || ''}\nLocation: ${ir.incident_location || 'N/A'}\nType: ${ir.incident_type || 'N/A'}\n\nDetails of the Incident:\n${ir.narrative_description}\n\nYour written explanation must be submitted to the HR Department on or before the deadline indicated. Failure to submit your explanation within the prescribed period will be construed as a waiver of your right to be heard and the Company may proceed with the appropriate disciplinary action.`;
  const today = new Date().toISOString().split('T')[0];
  const result = db.prepare(`
    INSERT INTO nte_cases (memo_number, employee_id, employee_name, position, project_location, classification, classification_group, incident_date, incident_description, nte_body, incident_report_id, prepared_by, created_by)
    VALUES (?, ?, ?, ?, ?, '', '', ?, '', ?, ?, ?, ?)
  `).run(memo_number, ir.employee_id, ir.alleged_violator_name, ir.craft_position || null, ir.project_name || null, ir.incident_date || today, nteBody, ir.id, ir.reported_by || null, req.user.id);
  res.redirect(`/nte/view/${result.lastInsertRowid}`);
});

router.post('/resolve/:id', verifyToken, (req, res) => {
  const db = getDB();
  const { resolution_date, resolution_notes } = req.body;
  db.prepare(`
    UPDATE incident_reports SET status='Resolved', resolution_date=?, resolution_notes=?, updated_at=CURRENT_TIMESTAMP
    WHERE id=? AND status IN ('Open', 'Resolved')
  `).run(resolution_date || null, resolution_notes || null, req.params.id);
  res.redirect(`/incidents/view/${req.params.id}`);
});

router.post('/close/:id', verifyToken, (req, res) => {
  const db = getDB();
  db.prepare("UPDATE incident_reports SET status='Closed', updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='Resolved'").run(req.params.id);
  res.redirect(`/incidents/view/${req.params.id}`);
});

router.post('/delete/:id', verifyToken, (req, res) => {
  const db = getDB();
  db.prepare('DELETE FROM incident_reports WHERE id=?').run(req.params.id);
  res.redirect('/incidents');
});

module.exports = router;
