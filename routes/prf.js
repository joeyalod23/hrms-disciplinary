const express = require('express');
const { getDB } = require('../db/schema');
const { verifyToken } = require('../middleware/auth');

const router = express.Router();

function isHired(status) {
  const s = (status || '').toUpperCase();
  return s.includes('HIRED') || s === 'ON BOARD';
}

function isPending(status) {
  const s = (status || '').toUpperCase();
  return s.includes('PROCESSING') || s.includes('WAITING FOR') ||
         s.includes('FOR TRADETEST') || s.includes('ON GOING');
}

// ── Page ─────────────────────────────────────────────────────────────────

router.get('/', verifyToken, (req, res) => {
  res.render('prf/index', { layout: 'layouts/main' });
});

// ── PRF Detail Page ───────────────────────────────────────────────────────

router.get('/view/:id', verifyToken, (req, res) => {
  const db = getDB();
  const prf = db.prepare(`
    SELECT pr.*, p.project_name, p.location
    FROM prf_requests pr
    JOIN projects p ON pr.project_id = p.id
    WHERE pr.id = ?
  `).get(Number(req.params.id));
  if (!prf) return res.status(404).send('PRF not found');
  const applicants = db.prepare('SELECT * FROM prf_applicants WHERE prf_request_id = ?').all(prf.id);
  const hired = applicants.filter(a => isHired(a.recruitment_status)).length;
  const pending = applicants.filter(a => isPending(a.recruitment_status)).length;
  res.render('prf/view', {
    layout: 'layouts/main',
    prf,
    applicants,
    total_hired: hired,
    total_pending: pending,
    total_qualified: hired + pending,
    remaining_needed: prf.total_manpower_requested - hired,
  });
});

// ── Dashboard API ─────────────────────────────────────────────────────────

router.get('/api/dashboard', verifyToken, (req, res) => {
  const db = getDB();
  const projects = db.prepare('SELECT * FROM projects').all();
  let totalRequested = 0, totalHired = 0, totalPending = 0, totalApplicants = 0;
  const projectList = [];

  for (const proj of projects) {
    const prfs = db.prepare('SELECT * FROM prf_requests WHERE project_id = ?').all(proj.id);
    const prfSummaries = prfs.map(prf => {
      const apps = db.prepare('SELECT recruitment_status FROM prf_applicants WHERE prf_request_id = ?').all(prf.id);
      const total = apps.length;
      const hired = apps.filter(a => isHired(a.recruitment_status)).length;
      const pending = apps.filter(a => isPending(a.recruitment_status)).length;
      return {
        id: prf.id,
        prf_no: prf.prf_no,
        trade_position: prf.trade_position,
        total_manpower_requested: prf.total_manpower_requested,
        total_applicants: total,
        total_hired: hired,
        total_pending: pending,
        total_qualified: hired + pending,
        remaining_needed: prf.total_manpower_requested - hired,
      };
    });
    const projRequested = prfSummaries.reduce((s, p) => s + p.total_manpower_requested, 0);
    const projHired = prfSummaries.reduce((s, p) => s + p.total_hired, 0);
    const projPending = prfSummaries.reduce((s, p) => s + p.total_pending, 0);

    projectList.push({
      id: proj.id,
      project_name: proj.project_name,
      location: proj.location,
      total_requested: projRequested,
      total_hired: projHired,
      total_pending: projPending,
      remaining_needed: projRequested - projHired,
      prfs: prfSummaries,
    });
    totalRequested += projRequested;
    totalHired += projHired;
    totalPending += projPending;
    totalApplicants += prfSummaries.reduce((s, p) => s + p.total_applicants, 0);
  }

  res.json({
    total_projects: projects.length,
    total_manpower_requested: totalRequested,
    total_hired: totalHired,
    total_pending: totalPending,
    total_remaining: totalRequested - totalHired,
    total_applicants: totalApplicants,
    projects: projectList,
  });
});

// ── PRFs API ──────────────────────────────────────────────────────────────

router.get('/api/prfs', verifyToken, (req, res) => {
  const db = getDB();
  let rows;
  if (req.query.project_id) {
    rows = db.prepare('SELECT * FROM prf_requests WHERE project_id = ?').all(Number(req.query.project_id));
  } else {
    rows = db.prepare('SELECT * FROM prf_requests').all();
  }
  res.json(rows.map(prf => {
    const apps = db.prepare('SELECT recruitment_status FROM prf_applicants WHERE prf_request_id = ?').all(prf.id);
    const hired = apps.filter(a => isHired(a.recruitment_status)).length;
    const pending = apps.filter(a => isPending(a.recruitment_status)).length;
    return {
      id: prf.id,
      prf_no: prf.prf_no,
      trade_position: prf.trade_position,
      total_manpower_requested: prf.total_manpower_requested,
      total_applicants: apps.length,
      total_hired: hired,
      total_pending: pending,
      total_qualified: hired + pending,
      remaining_needed: prf.total_manpower_requested - hired,
    };
  }));
});

router.post('/api/prfs', verifyToken, (req, res) => {
  const db = getDB();
  const { prf_no, project_id, trade_position, total_manpower_requested } = req.body;
  if (!prf_no || !project_id || !trade_position || !total_manpower_requested) {
    return res.status(400).json({ detail: 'All fields are required' });
  }
  const project = db.prepare('SELECT id FROM projects WHERE id = ?').get(project_id);
  if (!project) return res.status(404).json({ detail: 'Project not found' });
  const info = db.prepare(
    'INSERT INTO prf_requests (prf_no, project_id, trade_position, total_manpower_requested) VALUES (?, ?, ?, ?)'
  ).run(prf_no, project_id, trade_position.toUpperCase(), Number(total_manpower_requested));
  res.status(201).json({ id: info.lastInsertRowid, prf_no, project_id, trade_position, total_manpower_requested });
});

router.patch('/api/prfs/:id', verifyToken, (req, res) => {
  const db = getDB();
  const prf = db.prepare('SELECT * FROM prf_requests WHERE id = ?').get(Number(req.params.id));
  if (!prf) return res.status(404).json({ detail: 'PRF not found' });
  const updates = [];
  const params = [];
  for (const field of ['prf_no', 'trade_position', 'total_manpower_requested', 'project_id']) {
    if (req.body[field] !== undefined) {
      const val = field === 'trade_position' ? req.body[field].toUpperCase() : field === 'prf_no' ? req.body[field].toUpperCase() : field === 'total_manpower_requested' ? Number(req.body[field]) : Number(req.body[field]);
      updates.push(`${field} = ?`);
      params.push(val);
    }
  }
  if (updates.length === 0) return res.status(400).json({ detail: 'No fields to update' });
  params.push(prf.id);
  db.prepare(`UPDATE prf_requests SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  res.json(db.prepare('SELECT * FROM prf_requests WHERE id = ?').get(prf.id));
});

router.delete('/api/prfs/:id', verifyToken, (req, res) => {
  const db = getDB();
  const prf = db.prepare('SELECT id FROM prf_requests WHERE id = ?').get(Number(req.params.id));
  if (!prf) return res.status(404).json({ detail: 'PRF not found' });
  db.prepare('DELETE FROM prf_requests WHERE id = ?').run(prf.id);
  res.status(204).send();
});

// ── Hired Applicants API ──────────────────────────────────────────────────

router.get('/api/hired', verifyToken, (req, res) => {
  const db = getDB();
  const rows = db.prepare(`
    SELECT a.*, pr.prf_no, pr.trade_position, p.project_name, p.location
    FROM prf_applicants a
    JOIN prf_requests pr ON a.prf_request_id = pr.id
    JOIN projects p ON pr.project_id = p.id
    WHERE UPPER(a.recruitment_status) LIKE '%HIRED%' OR UPPER(a.recruitment_status) = 'ON BOARD'
    ORDER BY a.applicant_name
  `).all();
  res.json(rows);
});

// ── Applicants API ────────────────────────────────────────────────────────

router.get('/api/applicants', verifyToken, (req, res) => {
  const db = getDB();
  let rows;
  if (req.query.prf_id) {
    rows = db.prepare('SELECT * FROM prf_applicants WHERE prf_request_id = ?').all(Number(req.query.prf_id));
  } else {
    rows = db.prepare(`
      SELECT a.*, pr.prf_no, pr.trade_position, p.project_name, p.location
      FROM prf_applicants a
      JOIN prf_requests pr ON a.prf_request_id = pr.id
      JOIN projects p ON pr.project_id = p.id
      ORDER BY a.applicant_name
    `).all();
  }
  res.json(rows);
});

router.post('/api/applicants', verifyToken, (req, res) => {
  const db = getDB();
  const { prf_request_id, applicant_name, sourced_from, recruitment_status, remarks } = req.body;
  if (!prf_request_id || !applicant_name || !sourced_from) {
    return res.status(400).json({ detail: 'prf_request_id, applicant_name, and sourced_from are required' });
  }
  const status = recruitment_status || 'PROCESSING DOCUMENTS';
  const prf = db.prepare('SELECT id FROM prf_requests WHERE id = ?').get(prf_request_id);
  if (!prf) return res.status(404).json({ detail: 'PRF not found' });
  const info = db.prepare(
    'INSERT INTO prf_applicants (prf_request_id, applicant_name, sourced_from, recruitment_status, remarks) VALUES (?, ?, ?, ?, ?)'
  ).run(prf_request_id, applicant_name.toUpperCase(), sourced_from, status, remarks || '');
  res.status(201).json({
    id: info.lastInsertRowid, prf_request_id, applicant_name: applicant_name.toUpperCase(),
    sourced_from, recruitment_status: status, remarks: remarks || '',
  });
});

router.patch('/api/applicants/:id', verifyToken, (req, res) => {
  const db = getDB();
  const applicant = db.prepare('SELECT * FROM prf_applicants WHERE id = ?').get(Number(req.params.id));
  if (!applicant) return res.status(404).json({ detail: 'Applicant not found' });
  const updates = [];
  const params = [];
  for (const field of ['applicant_name', 'sourced_from', 'recruitment_status', 'remarks', 'prf_request_id']) {
    if (req.body[field] !== undefined) {
      const val = field === 'applicant_name' ? req.body[field].toUpperCase() : req.body[field];
      updates.push(`${field} = ?`);
      params.push(val);
    }
  }
  if (updates.length === 0) return res.status(400).json({ detail: 'No fields to update' });
  params.push(applicant.id);
  db.prepare(`UPDATE prf_applicants SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  res.json(db.prepare('SELECT * FROM prf_applicants WHERE id = ?').get(applicant.id));
});

router.delete('/api/applicants/:id', verifyToken, (req, res) => {
  const db = getDB();
  const app = db.prepare('SELECT id FROM prf_applicants WHERE id = ?').get(Number(req.params.id));
  if (!app) return res.status(404).json({ detail: 'Applicant not found' });
  db.prepare('DELETE FROM prf_applicants WHERE id = ?').run(app.id);
  res.status(204).send();
});

module.exports = router;
