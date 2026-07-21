const express = require('express');
const multer = require('multer');
const path = require('path');
const { getDB } = require('../db/schema');
const { verifyToken } = require('../middleware/auth');

const router = express.Router();

const storage = multer.diskStorage({
  destination: path.join(__dirname, '..', 'public', 'uploads'),
  filename: (req, file, cb) => {
    const uniqueName = Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname);
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /\.(pdf|doc|docx|jpg|jpeg|png|gif|xlsx|xls)$/i;
    if (!allowed.test(path.extname(file.originalname))) {
      return cb(new Error('Invalid file type'), false);
    }
    cb(null, true);
  }
});

router.post('/upload/:caseId', verifyToken, upload.single('document'), (req, res) => {
  const db = getDB();
  const { document_type } = req.body;
  const file = req.file;

  if (!file) {
    return res.redirect(`/cases/view/${req.params.caseId}`);
  }

  db.prepare(
    'INSERT INTO case_documents (case_id, document_type, file_name, original_name, file_path, uploaded_by) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(req.params.caseId, document_type, file.filename, file.originalname, '/uploads/' + file.filename, req.user.id);

  res.redirect(`/cases/view/${req.params.caseId}`);
});

router.get('/delete/:id', verifyToken, (req, res) => {
  const db = getDB();
  const doc = db.prepare('SELECT * FROM case_documents WHERE id = ?').get(req.params.id);
  if (doc) {
    const fs = require('fs');
    const filePath = path.join(__dirname, '..', 'public', doc.file_path);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    db.prepare('DELETE FROM case_documents WHERE id = ?').run(req.params.id);
    res.redirect(`/cases/view/${doc.case_id}`);
  } else {
    res.redirect('/cases');
  }
});

module.exports = router;
