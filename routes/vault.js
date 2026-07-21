const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const mammoth = require('mammoth');
const { getDB } = require('../db/schema');
const { verifyToken } = require('../middleware/auth');
const { logAudit } = require('../middleware/audit');

const router = express.Router();

const storage = multer.diskStorage({
  destination: path.join(__dirname, '..', 'public', 'uploads', 'vault'),
  filename: (req, file, cb) => {
    cb(null, 'vault-' + Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname));
  }
});
const upload = multer({ storage, limits: { fileSize: 30 * 1024 * 1024 } });

router.get('/', verifyToken, (req, res) => {
  const db = getDB();
  const page = parseInt(req.query.page) || 1;
  const limit = 20;
  const offset = (page - 1) * limit;
  const docType = req.query.document_type || '';
  const search = req.query.search || '';

  let query = 'SELECT * FROM document_vault WHERE 1=1';
  let countQuery = 'SELECT COUNT(*) as count FROM document_vault WHERE 1=1';
  const params = [];
  if (docType) { query += ' AND document_type = ?'; countQuery += ' AND document_type = ?'; params.push(docType); }
  if (search) { query += ' AND (title LIKE ? OR description LIKE ? OR original_name LIKE ?)'; countQuery += ' AND (title LIKE ? OR description LIKE ? OR original_name LIKE ?)'; params.push(`%${search}%`, `%${search}%`, `%${search}%`); }
  query += ' ORDER BY title ASC LIMIT ? OFFSET ?';
  const totalParams = [...params];
  params.push(limit, offset);
  const docs = db.prepare(query).all(...params);
  const total = db.prepare(countQuery).get(...totalParams).count;

  res.render('vault/index', { docs, total, page, limit, docType, search, pages: Math.ceil(total / limit) });
});

router.get('/add', verifyToken, (req, res) => {
  res.render('vault/form', { doc: null });
});

router.post('/add', verifyToken, upload.single('file'), (req, res) => {
  const db = getDB();
  const { title, document_type, category, revision, description } = req.body;
  const file = req.file;
  if (!file) return res.redirect('/vault/add');
  db.prepare('INSERT INTO document_vault (title, document_type, category, file_name, original_name, file_path, revision, description, uploaded_by) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(title, document_type, category||null, file.filename, file.originalname, '/uploads/vault/' + file.filename, revision||null, description||null, req.user.id);
  logAudit(req, 'Upload Document', 'Vault', null, title);
  res.redirect('/vault');
});

router.get('/view/:id', verifyToken, async (req, res) => {
  const db = getDB();
  const doc = db.prepare('SELECT * FROM document_vault WHERE id = ?').get(req.params.id);
  if (!doc) return res.redirect('/vault');

  let htmlContent = null;
  const ext = doc.original_name ? doc.original_name.split('.').pop().toLowerCase() : '';
  const filePath = path.join(__dirname, '..', 'public', doc.file_path);

  if (fs.existsSync(filePath) && (ext === 'xlsx' || ext === 'xls')) {
    try {
      const workbook = XLSX.readFile(filePath);
      const sheets = [];
      workbook.SheetNames.forEach(name => {
        const sheet = workbook.Sheets[name];
        const html = XLSX.utils.sheet_to_html(sheet, { editable: false });
        sheets.push({ name, html });
      });
      htmlContent = { type: 'xlsx', sheets };
    } catch (e) { console.error('XLSX error:', e.message); }
  }

  if (fs.existsSync(filePath) && ext === 'docx') {
    try {
      const buf = fs.readFileSync(filePath);
      const result = await mammoth.convertToHtml({ buffer: buf });
      htmlContent = { type: 'docx', html: result.value };
    } catch (e) { console.error('DOCX error:', e.message); }
  }

  res.render('vault/view', { doc, htmlContent });
});

router.get('/delete/:id', verifyToken, (req, res) => {
  const db = getDB();
  const doc = db.prepare('SELECT * FROM document_vault WHERE id = ?').get(req.params.id);
  if (doc) {
    const fs = require('fs');
    const fp = path.join(__dirname, '..', 'public', doc.file_path);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
    db.prepare('DELETE FROM document_vault WHERE id = ?').run(req.params.id);
  }
  res.redirect('/vault');
});

module.exports = router;
