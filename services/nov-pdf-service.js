const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs');

const PDF_DIR = path.join(__dirname, '..', 'public', 'uploads', 'nov_pdfs');
if (!fs.existsSync(PDF_DIR)) fs.mkdirSync(PDF_DIR, { recursive: true });

const COLORS = {
  primary: '#0b1a3a',
  accent: '#c0392b',
  text: '#1a1a1a',
  muted: '#555555',
  border: '#cccccc',
  lightBg: '#f8f8f8'
};

function generateNovPdf(nov, ir) {
  return new Promise((resolve, reject) => {
    try {
      const filename = `NoV-${nov.case_number.replace(/[^a-zA-Z0-9-]/g, '_')}.pdf`;
      const filePath = path.join(PDF_DIR, filename);

      const doc = new PDFDocument({ size: 'A4', margin: 60 });
      const stream = fs.createWriteStream(filePath);
      doc.pipe(stream);

      const pageWidth = doc.page.width - 120;
      let y = doc.y;

      function headerLine(text, opts = {}) {
        doc.fontSize(opts.size || 10).font(opts.bold ? 'Helvetica-Bold' : 'Helvetica')
          .fillColor(opts.color || COLORS.text);
        if (opts.align) doc.text(text, { align: opts.align });
        else doc.text(text);
        return doc.y;
      }

      function sectionTitle(text, yPos) {
        doc.rect(60, yPos, pageWidth, 22).fill(COLORS.primary);
        doc.fill('#fff').fontSize(10).font('Helvetica-Bold')
          .text(text, 70, yPos + 5, { width: pageWidth - 20 });
        return yPos + 28;
      }

      function fieldRow(label, value, yPos, opts = {}) {
        doc.rect(60, yPos, pageWidth, opts.h || 20).fill(opts.bg || '#fff');
        doc.fillColor(COLORS.muted).fontSize(8).font('Helvetica-Bold')
          .text(label, 65, yPos + 2, { width: 150 });
        doc.fillColor(COLORS.text).fontSize(9).font('Helvetica')
          .text(String(value || '_________________'), 215, yPos + 2, { width: pageWidth - 165 });
        return yPos + (opts.h || 20);
      }

      function divider(yPos) {
        doc.strokeColor(COLORS.border).lineWidth(0.5).moveTo(60, yPos).lineTo(60 + pageWidth, yPos).stroke();
        return yPos + 1;
      }

      const logoPath = path.join(__dirname, '..', 'public', 'images', 'lv-logo.svg');
      if (fs.existsSync(logoPath)) {
        try { doc.image(logoPath, 60, 40, { width: 60 }); } catch (e) {}
      }

      doc.fontSize(10).font('Helvetica');
      headerLine('L.V. LEDESMA CONSTRUCTION, INC.', { align: 'center', size: 14, bold: true, color: COLORS.primary });
      headerLine('Transformer Yard, San Isidro, General Santos City', { align: 'center', size: 8, color: COLORS.muted });
      headerLine('Telephone: (083) 552-XXXX | Email: hr@lvledesma.com', { align: 'center', size: 7, color: COLORS.muted });

      y = doc.y + 5;
      divider(y);
      y = doc.y + 10;

      doc.fontSize(16).font('Helvetica-Bold').fillColor(COLORS.accent)
        .text('NOTICE OF VIOLATION', { align: 'center' });
  y = doc.y + 2;
  headerLine(nov.case_number, { align: 'center', size: 11, color: COLORS.primary });
      y = doc.y + 8;
      divider(y);
      y = doc.y + 10;

      y = sectionTitle('VIOLATOR INFORMATION', y);
      y = fieldRow('Case Number:', nov.case_number || 'N/A', y);
      y = fieldRow('Date Issued:', new Date().toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' }), y);
      y = fieldRow('Employee Name:', ir.alleged_violator_name || 'N/A', y);
      y = fieldRow('Position:', ir.craft_position || 'N/A', y);
      y = fieldRow('Department:', ir.department || 'N/A', y);
      y = fieldRow('Immediate Supervisor:', ir.immediate_supervisor || 'N/A', y);
      y = fieldRow('Project Site:', ir.project_name || 'N/A', y);

      y += 5;
      y = sectionTitle('INCIDENT DETAILS', y);
      y = fieldRow('Incident Report #:', ir.report_number || 'N/A', y);
      y = fieldRow('Date of Incident:', ir.incident_date ? new Date(ir.incident_date).toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' }) : 'N/A', y);
      y = fieldRow('Time of Incident:', ir.incident_time || 'N/A', y);
      y = fieldRow('Date Reported:', ir.date_reported ? new Date(ir.date_reported).toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' }) : 'N/A', y);
      y = fieldRow('Location:', ir.location_of_incident || 'N/A', y);
      y = fieldRow('Incident Type:', ir.incident_type || 'N/A', y);

      y += 3;
      doc.rect(60, y, pageWidth, Math.max(80, 30 + (ir.narrative_description || '').split('\n').length * 14)).fill(COLORS.lightBg);
      doc.fillColor(COLORS.primary).fontSize(9).font('Helvetica-Bold').text('NARRATIVE DESCRIPTION', 65, y + 5, { width: pageWidth - 10 });
      doc.fillColor(COLORS.text).fontSize(8.5).font('Helvetica').text(ir.narrative_description || 'N/A', 65, y + 20, { width: pageWidth - 10, align: 'justify' });
      y = y + 20 + Math.max(80, 30 + (ir.narrative_description || '').split('\n').length * 14) + 8;

      y = sectionTitle('FINDINGS & RECOMMENDATIONS', y);
      y = fieldRow('Findings (Site HR Assessment):', '', y);
      doc.rect(60, y, pageWidth, 60).fill(COLORS.lightBg);
      doc.fillColor(COLORS.text).fontSize(8.5).font('Helvetica').text(nov.findings || 'No findings recorded.', 65, y + 5, { width: pageWidth - 10, align: 'justify' });
      y += 66;

      doc.fillColor(COLORS.primary).fontSize(9).font('Helvetica-Bold').text('Recommended Action:', 60, y, { width: pageWidth });
      y += 14;
      doc.rect(60, y, pageWidth, 40).fill(COLORS.lightBg);
      doc.fillColor(COLORS.text).fontSize(8.5).font('Helvetica').text(nov.recommended_action || 'No recommendation recorded.', 65, y + 5, { width: pageWidth - 10, align: 'justify' });
      y += 46;

      if (y > doc.page.height - 150) {
        doc.addPage();
        y = 60;
      }

      y = sectionTitle('CERTIFICATION', y);
      const sigY = y + 5;
      doc.fontSize(8.5).font('Helvetica').fillColor(COLORS.text)
        .text('I hereby certify that the above findings are based on the incident report and supporting documents submitted.', 60, sigY, { width: pageWidth, align: 'justify' });
      y = sigY + 25;

      const sigBlocks = [
        { label: 'PREPARED BY:', name: ir.reported_by || 'Site HR Personnel', title: 'Site HR' },
        { label: 'NOTED BY:', name: ir.noted_by || 'Project Manager', title: 'Project Manager' },
        { label: 'REVIEWED BY:', name: ir.reviewed_by || 'HR Department Head', title: 'HR Head' }
      ];

      const sigWidth = pageWidth / 3 - 10;
      sigBlocks.forEach((sb, i) => {
        const sx = 60 + i * (sigWidth + 15);
        doc.rect(sx, y, sigWidth, 70).fill(COLORS.lightBg);
        doc.fillColor(COLORS.primary).fontSize(8).font('Helvetica-Bold').text(sb.label, sx + 5, y + 5, { width: sigWidth - 10 });
        doc.fillColor(COLORS.text).fontSize(9).font('Helvetica')
          .text(sb.name, sx + 5, y + 25, { width: sigWidth - 10 });
        doc.fontSize(7.5).fillColor(COLORS.muted)
          .text(sb.title, sx + 5, y + 40, { width: sigWidth - 10 });
      });

      y += 80;
      divider(y);
      y += 5;
      doc.fontSize(6.5).font('Helvetica').fillColor(COLORS.muted)
        .text(`This document was automatically generated from the HR Management System. Original incident report: ${ir.report_number || 'N/A'}. Printed on ${new Date().toLocaleString()}.`, 60, y, { width: pageWidth, align: 'center' });

      doc.end();
      stream.on('finish', () => resolve({ filename, filePath, relativePath: `/uploads/nov_pdfs/${filename}` }));
      stream.on('error', reject);
    } catch (e) {
      reject(e);
    }
  });
}

module.exports = { generateNovPdf };
