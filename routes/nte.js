const express = require('express');
const { getDB } = require('../db/schema');
const { verifyToken } = require('../middleware/auth');
const { notifyNteIssued } = require('../services/notification');
const { ocrImage } = require('../services/ocr');
const multer = require('multer');
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const router = express.Router();

const ocrUpload = multer({ dest: path.join(__dirname, '..', 'public', 'uploads', 'ocr_temp'), limits: { fileSize: 10 * 1024 * 1024 } });
const ocrDir = path.join(__dirname, '..', 'public', 'uploads', 'ocr_temp');
if (!fs.existsSync(ocrDir)) fs.mkdirSync(ocrDir, { recursive: true });

function generateMemoNumber(db) {
  const year = new Date().getFullYear();
  const count = db.prepare("SELECT COUNT(*) as count FROM nte_cases WHERE strftime('%Y', created_at) = ?").get(String(year)).count + 1;
  return `NTE-${year}-${String(count).padStart(4, '0')}`;
}

router.get('/', verifyToken, (req, res) => {
  const db = getDB();
  const page = parseInt(req.query.page) || 1;
  const limit = 20;
  const offset = (page - 1) * limit;
  const status = req.query.status || '';
  const search = req.query.search || '';

  let query = 'SELECT n.*, u.full_name as created_by_name FROM nte_cases n LEFT JOIN users u ON n.created_by = u.id WHERE 1=1';
  let countQuery = 'SELECT COUNT(*) as count FROM nte_cases n WHERE 1=1';
  const params = [];

  if (status) {
    query += ' AND n.status = ?';
    countQuery += ' AND n.status = ?';
    params.push(status);
  }
  if (search) {
    query += " AND (n.employee_name LIKE ? OR n.memo_number LIKE ?)";
    countQuery += " AND (n.employee_name LIKE ? OR n.memo_number LIKE ?)";
    params.push(`%${search}%`, `%${search}%`);
  }

  query += ' ORDER BY n.employee_name ASC LIMIT ? OFFSET ?';
  const totalParams = [...params];
  params.push(limit, offset);

  const cases = db.prepare(query).all(...params);
  const total = db.prepare(countQuery).get(...totalParams).count;

  res.render('nte/index', {
    cases, total, page, limit, search, status,
    pages: Math.ceil(total / limit)
  });
});

router.get('/add', verifyToken, (req, res) => {
  const db = getDB();
  const employees = db.prepare("SELECT id, employee_id, full_name, department, position, trade FROM employees WHERE status = 'Active' ORDER BY full_name ASC").all();
  res.render('nte/form', { caseData: null, employees });
});

router.post('/add', verifyToken, (req, res) => {
  const db = getDB();
  const {
    employee_id, employee_name, position, project_location,
    incident_date, nte_body, prepared_by,
    incident_report_id
  } = req.body;
  const memo_number = generateMemoNumber(db);
  const today = new Date().toISOString().split('T')[0];
  db.prepare(`
    INSERT INTO nte_cases (
      memo_number, employee_id, employee_name, position, project_location,
      classification, classification_group, incident_date, incident_description,
      nte_body, prepared_by, created_by, incident_report_id
    ) VALUES (?, ?, ?, ?, ?, '', '', ?, '', ?, ?, ?, ?)
  `).run(
    memo_number, employee_id, employee_name, position || null, project_location || null,
    incident_date || today, nte_body || null, prepared_by || null, req.user.id,
    incident_report_id || null
  );
  res.redirect('/nte');
});

async function extractDocxText(filePath) {
  const psScript = `
    param($filePath)
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [System.IO.Compression.ZipFile]::OpenRead($filePath)
    $entry = $zip.GetEntry('word/document.xml')
    if (-not $entry) { $zip.Dispose(); throw 'Not a valid .docx file' }
    $stream = $entry.Open()
    $reader = New-Object System.IO.StreamReader($stream)
    $xml = $reader.ReadToEnd()
    $reader.Close()
    $stream.Close()
    $zip.Dispose()
    $matches = [regex]::Matches($xml, '<w:t[^>]*>([^<]+)<')
    $text = @()
    foreach ($m in $matches) { $text += $m.Groups[1].Value }
    Write-Output ($text -join '')
  `;
  const tmpFile = filePath + '.ps1';
  fs.writeFileSync(tmpFile, psScript, 'utf8');
  try {
    return execSync(`powershell -NoProfile -File "${tmpFile}" -filePath "${filePath}"`, { encoding: 'utf8', timeout: 30000 }).trim();
  } finally {
    try { fs.unlinkSync(tmpFile); } catch (e) {}
  }
}

router.post('/transcribe', verifyToken, ocrUpload.single('document'), async (req, res) => {
  if (!req.file) { return res.status(400).json({ error: 'No file uploaded' }); }
  const ext = path.extname(req.file.originalname).toLowerCase();
  const imgExts = ['.pdf', '.jpg', '.jpeg', '.png', '.bmp', '.tiff', '.tif'];
  try {
    let result;
    if (ext === '.docx') {
      const text = await extractDocxText(req.file.path);
      result = { text, fields: {}, confidence: null };
    } else if (imgExts.includes(ext)) {
      result = await ocrImage(req.file.path);
    } else {
      try { fs.unlinkSync(req.file.path); } catch (e) {}
      return res.status(400).json({ error: 'Unsupported file type "' + ext + '". Allowed: PDF, DOCX, JPG, PNG, BMP, TIFF' });
    }
    try { fs.unlinkSync(req.file.path); } catch (e) {}
    res.json(result);
  } catch (err) {
    try { fs.unlinkSync(req.file.path); } catch (e) {}
    res.status(500).json({ error: err.message });
  }
});

router.get('/view/:id', verifyToken, (req, res) => {
  const db = getDB();
  const caseData = db.prepare(`
    SELECT n.*, u.full_name as created_by_name,
      ir.report_number as ir_report_number
    FROM nte_cases n
    LEFT JOIN users u ON n.created_by = u.id
    LEFT JOIN incident_reports ir ON n.incident_report_id = ir.id
    WHERE n.id = ?
  `).get(req.params.id);
  if (!caseData) return res.redirect('/nte');
  res.render('nte/view', { caseData });
});

router.get('/print/:id', verifyToken, (req, res) => {
  const db = getDB();
  const caseData = db.prepare(`
    SELECT n.*, u.full_name as created_by_name,
      ir.report_number as ir_report_number
    FROM nte_cases n
    LEFT JOIN users u ON n.created_by = u.id
    LEFT JOIN incident_reports ir ON n.incident_report_id = ir.id
    WHERE n.id = ?
  `).get(req.params.id);
  if (!caseData) return res.redirect('/nte');
  res.render('nte/print', { caseData, layout: false });
});

router.get('/edit/:id', verifyToken, (req, res) => {
  const db = getDB();
  const caseData = db.prepare('SELECT * FROM nte_cases WHERE id = ?').get(req.params.id);
  if (!caseData) return res.redirect('/nte');
  const employees = db.prepare("SELECT id, employee_id, full_name, department, position, trade FROM employees WHERE status = 'Active' ORDER BY full_name ASC").all();
  res.render('nte/form', { caseData, employees });
});

router.post('/edit/:id', verifyToken, (req, res) => {
  const db = getDB();
  const {
    employee_id, employee_name, position, project_location,
    incident_date, nte_body, prepared_by
  } = req.body;
  const today = new Date().toISOString().split('T')[0];
  db.prepare(`
    UPDATE nte_cases SET
      employee_id=?, employee_name=?, position=?, project_location=?,
      incident_date=?, incident_description='', nte_body=?, prepared_by=?,
      updated_at=CURRENT_TIMESTAMP
    WHERE id=?
  `).run(
    employee_id, employee_name, position || null, project_location || null,
    incident_date || today, nte_body || null, prepared_by || null,
    req.params.id
  );
  res.redirect('/nte');
});

router.post('/issue/:id', verifyToken, (req, res) => {
  const db = getDB();
  const { date_received, employee_signed, date_signed, refused_to_sign, witness_name, witness_position } = req.body;
  const explanation_deadline = date_received ? new Date(new Date(date_received).getTime() + 5 * 24 * 60 * 60 * 1000).toISOString().split('T')[0] : null;
  db.prepare(`
    UPDATE nte_cases SET
      status='Issued/Served',
      date_received=?,
      explanation_deadline=?,
      employee_signed=?,
      date_signed=?,
      refused_to_sign=?,
      witness_name=?,
      witness_position=?,
      updated_at=CURRENT_TIMESTAMP
    WHERE id=? AND status='Draft'
  `  ).run(
    date_received || null,
    explanation_deadline,
    employee_signed ? 1 : 0,
    date_signed || null,
    refused_to_sign ? 1 : 0,
    refused_to_sign ? (witness_name || null) : null,
    refused_to_sign ? (witness_position || null) : null,
    req.params.id
  );
  try {
    const nteRecord = db.prepare('SELECT * FROM nte_cases WHERE id = ?').get(req.params.id);
    const employee = db.prepare('SELECT * FROM employees WHERE id = ?').get(nteRecord.employee_id);
    if (employee) notifyNteIssued(employee, nteRecord);
  } catch (err) {
    console.error('Failed to send NTE notification:', err);
  }
  res.redirect(`/nte/view/${req.params.id}`);
});

router.post('/reply/:id', verifyToken, (req, res) => {
  const db = getDB();
  const { date_explanation_submitted, employee_explanation } = req.body;
  db.prepare(`
    UPDATE nte_cases SET
      status='Replied',
      date_explanation_submitted=?,
      employee_explanation=?,
      updated_at=CURRENT_TIMESTAMP
    WHERE id=? AND status='Issued/Served'
  `).run(date_explanation_submitted || null, employee_explanation || null, req.params.id);
  res.redirect(`/nte/view/${req.params.id}`);
});

router.post('/resolve/:id', verifyToken, (req, res) => {
  const db = getDB();
  const { final_decision, resolution_date, remarks } = req.body;
  db.prepare(`
    UPDATE nte_cases SET
      status='Resolved',
      final_decision=?,
      resolution_date=?,
      remarks=?,
      updated_at=CURRENT_TIMESTAMP
    WHERE id=? AND status IN ('Issued/Served', 'Replied')
  `).run(final_decision, resolution_date || null, remarks || null, req.params.id);
  res.redirect(`/nte/view/${req.params.id}`);
});

router.post('/suspend/:id', verifyToken, (req, res) => {
  const db = getDB();
  const { preventive_suspension, suspension_days, suspension_effective_date, suspension_return_date } = req.body;
  db.prepare(`
    UPDATE nte_cases SET
      preventive_suspension=?,
      suspension_days=?,
      suspension_effective_date=?,
      suspension_return_date=?,
      updated_at=CURRENT_TIMESTAMP
    WHERE id=?
  `).run(
    preventive_suspension ? 1 : 0,
    preventive_suspension ? (suspension_days || null) : null,
    preventive_suspension ? (suspension_effective_date || null) : null,
    preventive_suspension ? (suspension_return_date || null) : null,
    req.params.id
  );
  res.redirect(`/nte/view/${req.params.id}`);
});

router.post('/close/:id', verifyToken, (req, res) => {
  const db = getDB();
  db.prepare("UPDATE nte_cases SET status='Closed', updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='Resolved'").run(req.params.id);
  res.redirect(`/nte/view/${req.params.id}`);
});

router.post('/delete/:id', verifyToken, (req, res) => {
  const db = getDB();
  db.prepare('DELETE FROM nte_cases WHERE id=?').run(req.params.id);
  res.redirect('/nte');
});

module.exports = router;
