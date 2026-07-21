const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { verifyToken } = require('../middleware/auth');
const { getDB } = require('../db/schema');
const { logAudit } = require('../middleware/audit');
const { generateNovPdf } = require('../services/nov-pdf-service');

function generateNoVNumber(db) {
  const year = new Date().getFullYear();
  const count = db.prepare("SELECT COUNT(*) as count FROM notice_of_violations WHERE strftime('%Y', created_at) = ?").get(String(year)).count + 1;
  return `NoV-${year}-${String(count).padStart(4, '0')}`;
}

router.get('/', verifyToken, (req, res) => {
  const db = getDB();
  const page = parseInt(req.query.page) || 1;
  const limit = 20;
  const offset = (page - 1) * limit;
  const status = req.query.status || '';
  const search = req.query.search || '';

  let query = `SELECT n.*, i.report_number as ir_number, i.alleged_violator_name, u.full_name as created_by_name
    FROM notice_of_violations n
    LEFT JOIN incident_reports i ON n.incident_report_id = i.id
    LEFT JOIN users u ON n.created_by = u.id WHERE 1=1`;
  let countQuery = `SELECT COUNT(*) as count FROM notice_of_violations n
    LEFT JOIN incident_reports i ON n.incident_report_id = i.id WHERE 1=1`;
  const params = [];
  const countParams = [];
  if (status) { query += ' AND n.status = ?'; countQuery += ' AND n.status = ?'; params.push(status); countParams.push(status); }
  if (search) { query += ' AND (i.report_number LIKE ? OR i.alleged_violator_name LIKE ? OR n.case_number LIKE ?)'; countQuery += ' AND (i.report_number LIKE ? OR i.alleged_violator_name LIKE ? OR n.case_number LIKE ?)'; const s = `%${search}%`; params.push(s, s, s); countParams.push(s, s, s); }

  const total = db.prepare(countQuery).get(...countParams).count;
  const list = db.prepare(query + ' ORDER BY COALESCE(i.alleged_violator_name, n.case_number) ASC LIMIT ? OFFSET ?').all(...params, limit, offset);

  res.render('nov/index', { reports: list, total, page, limit, status, search, pages: Math.ceil(total / limit) });
});

router.get('/add/:incident_id', verifyToken, (req, res) => {
  const db = getDB();
  const ir = db.prepare('SELECT * FROM incident_reports WHERE id = ?').get(req.params.incident_id);
  if (!ir) return res.redirect('/incidents');
  res.render('nov/form', { ir, nov: null });
});

router.post('/add', verifyToken, async (req, res) => {
  const db = getDB();
  const caseNumber = generateNoVNumber(db);
  const { incident_report_id, findings, recommended_action } = req.body;
  if (!incident_report_id) return res.redirect('/incidents');

  const ir = db.prepare('SELECT * FROM incident_reports WHERE id = ?').get(incident_report_id);
  if (!ir) return res.redirect('/incidents');

  const result = db.prepare(`INSERT INTO notice_of_violations (incident_report_id, case_number, findings, recommended_action, status, created_by) VALUES (?, ?, ?, ?, 'Draft', ?)`).run(incident_report_id, caseNumber, findings || '', recommended_action || '', req.user.id);
  db.prepare('UPDATE incident_reports SET nov_id = ?, nov_status = ? WHERE id = ?').run(result.lastInsertRowid, 'Draft', incident_report_id);

  const nov = db.prepare('SELECT * FROM notice_of_violations WHERE id = ?').get(result.lastInsertRowid);
  try {
    const pdf = await generateNovPdf(nov, ir);
    db.prepare('UPDATE notice_of_violations SET pdf_path = ? WHERE id = ?').run(pdf.relativePath, nov.id);
  } catch (e) {
    console.error('NOV PDF generation failed:', e.message);
  }

  logAudit(req, 'Create NOV', 'Notice of Violation', result.lastInsertRowid, `${caseNumber} for IR #${ir.report_number}`);
  res.redirect('/nov/view/' + result.lastInsertRowid);
});

router.get('/view/:id', verifyToken, (req, res) => {
  const db = getDB();
  const nov = db.prepare(`SELECT n.*, i.report_number as ir_number, i.alleged_violator_name, i.incident_date, i.incident_time, i.date_reported, i.location_of_incident, i.incident_type, i.narrative_description, i.craft_position, i.department, i.immediate_supervisor, i.project_name, i.address, u.full_name as created_by_name FROM notice_of_violations n LEFT JOIN incident_reports i ON n.incident_report_id = i.id LEFT JOIN users u ON n.created_by = u.id WHERE n.id = ?`).get(req.params.id);
  if (!nov) return res.redirect('/nov');
  const ir = db.prepare('SELECT * FROM incident_reports WHERE id = ?').get(nov.incident_report_id);
  res.render('nov/view', { nov, ir });
});

router.get('/pdf/:id', verifyToken, (req, res) => {
  const db = getDB();
  const nov = db.prepare('SELECT * FROM notice_of_violations WHERE id = ?').get(req.params.id);
  if (!nov) return res.status(404).send('NOV not found');

  if (nov.pdf_path) {
    const filePath = path.join(__dirname, '..', 'public', nov.pdf_path);
    if (fs.existsSync(filePath)) {
      return res.download(filePath, `Notice_of_Violation_${nov.case_number}.pdf`);
    }
  }

  const ir = db.prepare('SELECT * FROM incident_reports WHERE id = ?').get(nov.incident_report_id);
  if (!ir) return res.status(404).send('Linked incident report not found');

  generateNovPdf(nov, ir).then(pdf => {
    db.prepare('UPDATE notice_of_violations SET pdf_path = ? WHERE id = ?').run(pdf.relativePath, nov.id);
    res.download(pdf.filePath, `Notice_of_Violation_${nov.case_number}.pdf`);
  }).catch(err => {
    console.error('PDF generation failed:', err);
    res.status(500).send('Failed to generate PDF');
  });
});

router.post('/submit/:id', verifyToken, (req, res) => {
  const db = getDB();
  const nov = db.prepare('SELECT * FROM notice_of_violations WHERE id = ?').get(req.params.id);
  if (!nov || nov.status !== 'Draft') return res.redirect('/nov');
  db.prepare(`UPDATE notice_of_violations SET status = 'Submitted to Main Office', submitted_to_main_office_date = date('now'), updated_at = datetime('now') WHERE id = ?`).run(req.params.id);
  db.prepare('UPDATE incident_reports SET nov_status = ? WHERE id = ?').run('Submitted to Main Office', nov.incident_report_id);
  logAudit(req, 'Submit NOV', 'Notice of Violation', req.params.id, nov.case_number);
  res.redirect('/nov/view/' + req.params.id);
});

router.post('/review/:id', verifyToken, (req, res) => {
  const db = getDB();
  const nov = db.prepare('SELECT * FROM notice_of_violations WHERE id = ?').get(req.params.id);
  if (!nov || nov.status !== 'Submitted to Main Office') return res.redirect('/nov');
  const { main_office_notes } = req.body;
  db.prepare(`UPDATE notice_of_violations SET status = 'Reviewed', main_office_notes = ?, reviewed_by_main_office_date = date('now'), updated_at = datetime('now') WHERE id = ?`).run(main_office_notes || '', req.params.id);
  db.prepare('UPDATE incident_reports SET nov_status = ? WHERE id = ?').run('Reviewed', nov.incident_report_id);
  logAudit(req, 'Review NOV', 'Notice of Violation', req.params.id, nov.case_number);
  res.redirect('/nov/view/' + req.params.id);
});

router.post('/return/:id', verifyToken, (req, res) => {
  const db = getDB();
  const nov = db.prepare('SELECT * FROM notice_of_violations WHERE id = ?').get(req.params.id);
  if (!nov || nov.status !== 'Reviewed') return res.redirect('/nov');
  db.prepare(`UPDATE notice_of_violations SET status = 'Returned to Site', returned_to_site_date = date('now'), updated_at = datetime('now') WHERE id = ?`).run(req.params.id);
  db.prepare('UPDATE incident_reports SET nov_status = ? WHERE id = ?').run('Returned to Site', nov.incident_report_id);
  logAudit(req, 'Return NOV', 'Notice of Violation', req.params.id, nov.case_number);
  res.redirect('/nov/view/' + req.params.id);
});

module.exports = router;
