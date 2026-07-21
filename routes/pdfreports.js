const express = require('express');
const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs');
const { getDB } = require('../db/schema');
const { verifyToken } = require('../middleware/auth');

const PDF_DIR = path.join(__dirname, '..', 'public', 'uploads', 'employee_pdfs');
if (!fs.existsSync(PDF_DIR)) fs.mkdirSync(PDF_DIR, { recursive: true });

const router = express.Router();

router.get('/cases', verifyToken, (req, res) => {
  const db = getDB();
  const cases = db.prepare(`
    SELECT dc.*, e.full_name as employee_name, e.employee_id, oc.name as offense_name, oc.severity
    FROM disciplinary_cases dc
    LEFT JOIN employees e ON dc.employee_id = e.id
    LEFT JOIN offense_categories oc ON dc.offense_category_id = oc.id
    ORDER BY dc.created_at DESC
  `).all();

  const doc = new PDFDocument({ margin: 50, size: 'A4', layout: 'landscape' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename=disciplinary-cases.pdf');
  doc.pipe(res);

  doc.fontSize(18).font('Helvetica-Bold').text('Disciplinary Cases Report', { align: 'center' });
  doc.fontSize(10).font('Helvetica').text(`Generated: ${new Date().toLocaleString()}`, { align: 'center' });
  doc.moveDown(1);

  const headers = ['Case #', 'Employee', 'Offense', 'Severity', 'Status', 'Date Filed'];
  const widths = [90, 140, 140, 80, 100, 100];
  let y = doc.y;

  doc.font('Helvetica-Bold').fontSize(8);
  let x = 50;
  headers.forEach((h, i) => {
    doc.rect(x, y, widths[i], 18).fill('#0d3b66');
    doc.fill('#fff').text(h, x + 3, y + 4, { width: widths[i] - 6, align: 'left' });
    x += widths[i];
  });
  doc.fill('#000');
  y += 18;

  doc.font('Helvetica').fontSize(7.5);
  cases.forEach((c, idx) => {
    if (y > 520) {
      doc.addPage();
      y = 50;
      x = 50;
      doc.font('Helvetica-Bold').fontSize(8);
      headers.forEach((h, i) => {
        doc.rect(x, y, widths[i], 18).fill('#0d3b66');
        doc.fill('#fff').text(h, x + 3, y + 4, { width: widths[i] - 6, align: 'left' });
        x += widths[i];
      });
      doc.fill('#000');
      y += 18;
      doc.font('Helvetica').fontSize(7.5);
    }
    if (idx % 2 === 0) doc.rect(50, y, 550, 16).fill('#f5f5f5');
    x = 50;
    const vals = [c.case_number, c.employee_name, c.offense_name || '-', c.severity || '-', c.status, c.created_at ? new Date(c.created_at).toLocaleDateString() : '-'];
    vals.forEach((v, i) => {
      doc.fill('#000').text(String(v), x + 3, y + 3, { width: widths[i] - 6 });
      x += widths[i];
    });
    y += 16;
  });

  doc.end();
});

router.get('/employees', verifyToken, (req, res) => {
  const db = getDB();
  const employees = db.prepare('SELECT * FROM employees ORDER BY full_name').all();
  const doc = new PDFDocument({ margin: 50, size: 'A4', layout: 'landscape' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename=employee-list.pdf');
  doc.pipe(res);

  doc.fontSize(18).font('Helvetica-Bold').text('Employee List', { align: 'center' });
  doc.fontSize(10).font('Helvetica').text(`Generated: ${new Date().toLocaleString()}`, { align: 'center' });
  doc.moveDown(1);

  const headers = ['ID', 'Full Name', 'Position', 'Department', 'Project Site', 'Status'];
  const widths = [80, 140, 110, 100, 120, 70];
  let y = doc.y;
  let x = 50;

  doc.font('Helvetica-Bold').fontSize(8);
  headers.forEach((h, i) => {
    doc.rect(x, y, widths[i], 18).fill('#0d3b66');
    doc.fill('#fff').text(h, x + 3, y + 4, { width: widths[i] - 6 });
    x += widths[i];
  });
  doc.fill('#000');
  y += 18;

  doc.font('Helvetica').fontSize(7.5);
  employees.forEach((e, idx) => {
    if (y > 520) { doc.addPage(); y = 50; }
    if (idx % 2 === 0) doc.rect(50, y, 620, 16).fill('#f5f5f5');
    x = 50;
    const vals = [e.employee_id, e.full_name, e.position, e.department, e.project_site, e.status];
    vals.forEach((v, i) => {
      doc.fill('#000').text(String(v), x + 3, y + 3, { width: widths[i] - 6 });
      x += widths[i];
    });
    y += 16;
  });

  doc.end();
});

router.get('/employees/detailed', verifyToken, (req, res) => {
  const db = getDB();
  const search = req.query.search || '';
  const presentOnly = req.query.present === '1' || req.query.present === 'true';

  let query = 'SELECT DISTINCT e.* FROM employees e';
  const params = [];
  const conditions = [];

  if (presentOnly) {
    query += ' JOIN attendance_records ar ON ar.employee_id = e.id';
    conditions.push("ar.date = date('now')");
    conditions.push("ar.status = 'Present'");
  }

  if (search) {
    conditions.push("(e.full_name LIKE ? OR e.employee_id LIKE ? OR e.department LIKE ? OR e.position LIKE ?)");
    params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
  }

  if (conditions.length > 0) {
    query += ' WHERE ' + conditions.join(' AND ');
  }

  query += ' ORDER BY e.full_name ASC';
  const employees = db.prepare(query).all(...params);

  if (employees.length === 0) {
    return res.status(404).send('No employee records found.');
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `employee-records-${timestamp}.pdf`;
  const filePath = path.join(PDF_DIR, filename);

  const doc = new PDFDocument({ margin: 50, size: 'A4' });
  const fileStream = fs.createWriteStream(filePath);
  doc.pipe(fileStream);

  fileStream.on('finish', () => {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
    fs.createReadStream(filePath).pipe(res);
  });

  const pageWidth = doc.page.width - 100;
  let pageNum = 1;

  function addHeader() {
    doc.fontSize(16).font('Helvetica-Bold').fillColor('#0d3b66')
      .text('EMPLOYEE RECORDS', { align: 'center' });
    doc.fontSize(8).font('Helvetica').fillColor('#666')
      .text('L.V. LEDESMA CONSTRUCTION, INC. - Human Resource Management System', { align: 'center' });
    doc.fontSize(7).font('Helvetica').fillColor('#888')
      .text(`Generated: ${new Date().toLocaleString()}`, { align: 'center' });
    doc.moveDown(0.5);
    doc.strokeColor('#0d3b66').lineWidth(1).moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y).stroke();
    doc.moveDown(0.5);
  }

  function addFooter() {
    doc.fontSize(7).font('Helvetica').fillColor('#888')
      .text(`Page ${pageNum}`, 50, doc.page.height - 40, { align: 'center' });
    doc.fontSize(6).font('Helvetica').fillColor('#aaa')
      .text('This document is confidential and intended for internal HR use only.', 50, doc.page.height - 30, { align: 'center' });
  }

  function sectionTitle(text, y) {
    doc.rect(50, y, pageWidth + 50, 20).fill('#0d3b66');
    doc.fill('#fff').fontSize(9).font('Helvetica-Bold')
      .text(text, 55, y + 4, { width: pageWidth + 40 });
    return y + 24;
  }

  function fieldRow(label, value, y, opts = {}) {
    const bg = opts.bg || '#f9f9f9';
    const h = opts.h || 18;
    doc.rect(50, y, pageWidth + 50, h).fill(bg);
    doc.fillColor('#333').fontSize(7.5).font('Helvetica-Bold')
      .text(label, 55, y + 4, { width: 120 });
    doc.fillColor('#000').fontSize(8).font('Helvetica')
      .text(value || '-', 180, y + 4, { width: pageWidth - 140 });
    return y + h;
  }

  addHeader();
  let y = doc.y + 5;

  employees.forEach((e, idx) => {
    if (y > doc.page.height - 120) {
      addFooter();
      doc.addPage();
      pageNum++;
      addHeader();
      y = doc.y + 5;
    }

    if (idx > 0) {
      addFooter();
      doc.addPage();
      pageNum++;
      addHeader();
      y = doc.y + 5;
    }

    doc.fontSize(11).font('Helvetica-Bold').fillColor('#c0392b')
      .text(`${e.full_name || `${e.last_name}, ${e.first_name}`}`, 50, y, { width: pageWidth + 50 });
    y += 16;

    y = sectionTitle('EMPLOYMENT INFORMATION', y);
    y = fieldRow('Employee ID:', e.employee_id, y);
    y = fieldRow('Position:', e.position, y);
    y = fieldRow('Trade:', e.trade, y);
    y = fieldRow('Department:', e.department, y);
    y = fieldRow('Project Site:', e.project_site, y);
    y = fieldRow('Classification:', e.classification, y);
    y = fieldRow('Status:', e.status, y, { bg: '#fff' });
    y = fieldRow('Date Hired:', e.date_hired || '-', y);
    y = fieldRow('Date Ended:', e.date_ended || '-', y, { bg: '#fff' });
    y = fieldRow('Daily Rate:', e.daily_rate ? `₱${parseFloat(e.daily_rate).toLocaleString()}` : '-', y);
    y = fieldRow('Monthly Rate:', e.monthly_rate ? `₱${parseFloat(e.monthly_rate).toLocaleString()}` : '-', y, { bg: '#fff' });

    y += 4;
    y = sectionTitle('PERSONAL INFORMATION', y);
    y = fieldRow('Gender:', e.gender || '-', y);
    y = fieldRow('Birth Date:', e.birth_date || '-', y, { bg: '#fff' });
    y = fieldRow('Nationality:', e.nationality || '-', y);
    y = fieldRow('Civil Status:', e.civil_status || '-', y, { bg: '#fff' });
    y = fieldRow('Religion:', e.religion || '-', y);
    y = fieldRow('Blood Type:', e.blood_type || '-', y, { bg: '#fff' });
    y = fieldRow('Height:', e.height || '-', y);
    y = fieldRow('Weight:', e.weight || '-', y, { bg: '#fff' });
    y = fieldRow('Contact No.:', e.contact_number || '-', y);
    y = fieldRow('Email:', e.email || '-', y, { bg: '#fff' });
    y = fieldRow('Address:', e.address || '-', y);

    y += 4;
    y = sectionTitle('GOVERNMENT NUMBERS', y);
    y = fieldRow('SSS No.:', e.sss_no || '-', y);
    y = fieldRow('Pag-IBIG No.:', e.pagibig_no || '-', y, { bg: '#fff' });
    y = fieldRow('PhilHealth No.:', e.philhealth_no || '-', y);

    y += 4;
    y = sectionTitle('EMERGENCY CONTACT', y);
    y = fieldRow('Contact Person:', e.emergency_contact || '-', y);
    y = fieldRow('Contact No.:', e.emergency_contact_no || '-', y, { bg: '#fff' });

    y += 8;
    doc.strokeColor('#ddd').lineWidth(0.5).moveTo(50, y).lineTo(doc.page.width - 50, y).stroke();
    y += 8;
  });

  addFooter();
  doc.end();
});

module.exports = router;
