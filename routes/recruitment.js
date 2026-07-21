const express = require('express');
const { getDB } = require('../db/schema');
const { verifyToken } = require('../middleware/auth');
const { logAudit } = require('../middleware/audit');

const router = express.Router();

router.get('/', verifyToken, (req, res) => {
  const db = getDB();
  const page = parseInt(req.query.page) || 1;
  const limit = 20;
  const offset = (page - 1) * limit;
  const status = req.query.status || '';
  const search = req.query.search || '';

  let query = `SELECT * FROM recruitment_requests WHERE 1=1`;
  let countQuery = `SELECT COUNT(*) as count FROM recruitment_requests WHERE 1=1`;
  const params = [];
  if (status) { query += ' AND status = ?'; countQuery += ' AND status = ?'; params.push(status); }
  if (search) { query += " AND (prf_number LIKE ? OR position LIKE ? OR department LIKE ?)"; countQuery += " AND (prf_number LIKE ? OR position LIKE ? OR department LIKE ?)"; params.push(`%${search}%`, `%${search}%`, `%${search}%`); }
  query += ' ORDER BY prf_number ASC LIMIT ? OFFSET ?';
  const totalParams = [...params];
  params.push(limit, offset);
  const requests = db.prepare(query).all(...params);
  const total = db.prepare(countQuery).get(...totalParams).count;

  res.render('recruitment/index', { requests, total, page, limit, status, search, pages: Math.ceil(total / limit) });
});

router.get('/add', verifyToken, (req, res) => {
  res.render('recruitment/form', { request: null });
});

router.post('/add', verifyToken, (req, res) => {
  try {
    const db = getDB();
    const { prf_number, department, position, trade, skilled_required, non_skilled_required, project_site, date_requested, prepared_by, noted_by } = req.body;
    const total = (parseInt(skilled_required)||0) + (parseInt(non_skilled_required)||0);
    db.prepare(`INSERT INTO recruitment_requests (prf_number, department, position, trade, skilled_required, non_skilled_required, total_required, project_site, date_requested, prepared_by, noted_by, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(prf_number, department, position, trade||null, skilled_required||0, non_skilled_required||0, total, project_site||'Vail Land Development', date_requested, prepared_by||null, noted_by||null, req.user.id);
    logAudit(req, 'Add Recruitment Request', 'Recruitment', null, prf_number);
    res.redirect('/recruitment');
  } catch (err) {
    console.error('Add PRF error:', err);
    res.status(500).render('recruitment/form', { request: null, error: 'Failed to add PRF request' });
  }
});

router.post('/update-status/:id', verifyToken, (req, res) => {
  try {
    const db = getDB();
    const { status, date_filled } = req.body;
    db.prepare('UPDATE recruitment_requests SET status=?, date_filled=? WHERE id=?').run(status, date_filled||null, req.params.id);
    logAudit(req, 'Update Recruitment Status', 'Recruitment', req.params.id, status);
    res.redirect(`/recruitment`);
  } catch (err) {
    console.error('Update status error:', err);
    res.redirect(`/recruitment`);
  }
});

router.get('/applicants', verifyToken, (req, res) => {
  res.redirect('/recruitment');
});

router.get('/applicants/add', verifyToken, (req, res) => {
  const db = getDB();
  const requests = db.prepare("SELECT id, prf_number, position, total_required FROM recruitment_requests WHERE status IN ('Open','In Progress') ORDER BY prf_number DESC").all();
  res.render('recruitment/applicant_form', { applicant: null, requests, today: new Date().toISOString().split('T')[0] });
});

router.post('/applicants/add', verifyToken, (req, res) => {
  try {
    const db = getDB();
    const { request_id, full_name, position, trade, classification, date_applied, remarks } = req.body;
    const result = db.prepare(`INSERT INTO recruitment_applicants (request_id, full_name, position, trade, classification, date_applied, remarks, created_by) VALUES (?,?,?,?,?,?,?,?)`)
      .run(request_id||null, full_name, position||null, trade||null, classification||'Non-Skilled', date_applied, remarks||null, req.user.id);
    db.prepare('INSERT INTO applicant_status_history (applicant_id, old_status, new_status, changed_by) VALUES (?,NULL,?,?)')
      .run(result.lastInsertRowid, 'For Screening', req.user.id);
    if (request_id) {
      db.prepare(`UPDATE recruitment_requests SET status = 'In Progress' WHERE id = ? AND status = 'Open'`).run(request_id);
    }
    logAudit(req, 'Add Applicant', 'Recruitment', result.lastInsertRowid, full_name);
    res.redirect('/recruitment');
  } catch (err) {
    console.error('Add applicant error:', err);
    const db = getDB();
    const requests = db.prepare("SELECT id, prf_number, position, total_required FROM recruitment_requests WHERE status IN ('Open','In Progress') ORDER BY prf_number DESC").all();
    res.status(500).render('recruitment/applicant_form', { applicant: null, requests, today: new Date().toISOString().split('T')[0], error: 'Failed to add applicant' });
  }
});

router.get('/applicants/view/:id', verifyToken, (req, res) => {
  const db = getDB();
  const applicant = db.prepare('SELECT a.*, r.prf_number, r.position as req_position FROM recruitment_applicants a LEFT JOIN recruitment_requests r ON a.request_id = r.id WHERE a.id = ?').get(req.params.id);
  if (!applicant) return res.redirect('/recruitment');
  const history = db.prepare(`
    SELECT h.*, u.username as changed_by_name
    FROM applicant_status_history h
    LEFT JOIN users u ON h.changed_by = u.id
    WHERE h.applicant_id = ?
    ORDER BY h.changed_at DESC
  `).all(req.params.id);
  res.render('recruitment/applicant_view', { applicant, history });
});

router.get('/applicants/edit/:id', verifyToken, (req, res) => {
  const db = getDB();
  const applicant = db.prepare('SELECT * FROM recruitment_applicants WHERE id = ?').get(req.params.id);
  if (!applicant) return res.redirect('/recruitment');
  const requests = db.prepare("SELECT id, prf_number, position FROM recruitment_requests ORDER BY prf_number DESC").all();
  res.render('recruitment/applicant_form', { applicant, requests, today: '' });
});

router.post('/applicants/edit/:id', verifyToken, (req, res) => {
  try {
    const db = getDB();
    const old = db.prepare('SELECT * FROM recruitment_applicants WHERE id = ?').get(req.params.id);
    if (!old) return res.redirect('/recruitment');
    const { request_id, full_name, position, trade, classification, status, date_hired, medical_status, documents_complete, remarks } = req.body;
    db.prepare(`UPDATE recruitment_applicants SET request_id=?, full_name=?, position=?, trade=?, classification=?, status=?, date_hired=?, medical_status=?, documents_complete=?, remarks=? WHERE id=?`)
      .run(request_id||null, full_name, position||null, trade||null, classification, status, date_hired||null, medical_status||null, documents_complete ? 1 : 0, remarks||null, req.params.id);
    if (status !== old.status) {
      db.prepare('INSERT INTO applicant_status_history (applicant_id, old_status, new_status, changed_by) VALUES (?,?,?,?)')
        .run(req.params.id, old.status, status, req.user.id);
    }
    if (status === 'Hired' && date_hired) {
      const a = db.prepare('SELECT * FROM recruitment_applicants WHERE id = ?').get(req.params.id);
      const name = (full_name || a.full_name || '').trim();
      const nameParts = name.split(' ');
      const lastName = nameParts.pop() || name;
      const firstName = nameParts.join(' ') || name;
      const nextId = (db.prepare("SELECT COALESCE(MAX(id), 0) + 1 FROM employees").get()['COALESCE(MAX(id), 0) + 1']);
      const empId = 'LVL-' + String(nextId).padStart(6, '0');
      db.prepare(`INSERT OR IGNORE INTO employees (employee_id, full_name, last_name, first_name, position, trade, department, date_hired, status) VALUES (?,?,?,?,?,?,?,?,'Active')`)
        .run(empId, full_name||a.full_name, lastName, firstName, position||a.position, trade||null, 'FIELD', date_hired);
      if (a.request_id) {
        db.prepare(`UPDATE recruitment_requests SET status='Filled' WHERE id=? AND (SELECT COUNT(*) FROM recruitment_applicants WHERE request_id=? AND status='Hired') >= total_required`).run(a.request_id, a.request_id);
      }
    }
    logAudit(req, 'Update Applicant', 'Recruitment', req.params.id, `${full_name} -> ${status}`);
    res.redirect('/recruitment');
  } catch (err) {
    console.error('Edit applicant error:', err);
    res.redirect('/recruitment');
  }
});

router.post('/applicants/delete/:id', verifyToken, (req, res) => {
  try {
    const db = getDB();
    const applicant = db.prepare('SELECT full_name FROM recruitment_applicants WHERE id = ?').get(req.params.id);
    if (!applicant) return res.redirect('/recruitment');
    db.prepare('DELETE FROM applicant_status_history WHERE applicant_id = ?').run(req.params.id);
    db.prepare('DELETE FROM recruitment_applicants WHERE id = ?').run(req.params.id);
    logAudit(req, 'Delete Applicant', 'Recruitment', req.params.id, applicant.full_name);
    res.redirect('/recruitment');
  } catch (err) {
    console.error('Delete applicant error:', err);
    res.redirect('/recruitment');
  }
});

router.get('/applicants/history/:id', verifyToken, (req, res) => {
  const db = getDB();
  const applicant = db.prepare('SELECT full_name FROM recruitment_applicants WHERE id = ?').get(req.params.id);
  if (!applicant) return res.status(404).json({ error: 'Applicant not found' });
  const history = db.prepare(`
    SELECT h.*, u.username as changed_by_name
    FROM applicant_status_history h
    LEFT JOIN users u ON h.changed_by = u.id
    WHERE h.applicant_id = ?
    ORDER BY h.changed_at DESC
  `).all(req.params.id);
  res.json({ name: applicant.full_name, history });
});

module.exports = router;
