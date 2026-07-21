process.on('uncaughtException', (err) => { console.error('Uncaught:', err.message); });
process.on('unhandledRejection', (err) => { console.error('Unhandled:', err.message); });

const express = require('express');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
if (!fs.existsSync(path.join(dataDir, 'db'))) fs.mkdirSync(path.join(dataDir, 'db'), { recursive: true });
if (!fs.existsSync(path.join(dataDir, 'uploads'))) fs.mkdirSync(path.join(dataDir, 'uploads'), { recursive: true });

const uploadsTarget = process.env.UPLOADS_DIR || null;
if (uploadsTarget) {
  const pubUploads = path.join(__dirname, 'public', 'uploads');
  try {
    if (fs.existsSync(pubUploads)) {
      const stat = fs.lstatSync(pubUploads);
      if (!stat.isSymbolicLink()) {
        fs.rmSync(pubUploads, { recursive: true, force: true });
        fs.symlinkSync(uploadsTarget, pubUploads);
      }
    } else {
      fs.mkdirSync(path.join(__dirname, 'public'), { recursive: true });
      fs.symlinkSync(uploadsTarget, pubUploads);
    }
  } catch (e) {
    console.error('Uploads symlink setup failed:', e.message);
  }
}
const cookieParser = require('cookie-parser');
const expressLayouts = require('express-ejs-layouts');
const { initializeDatabase } = require('./db/schema');

const { loadBranches } = require('./middleware/branch');

const authRoutes = require('./routes/auth');
const dashboardRoutes = require('./routes/dashboard');
const employeeRoutes = require('./routes/employees');
const caseRoutes = require('./routes/cases');
const incidentRoutes = require('./routes/incidents');
const novRoutes = require('./routes/nov');
const nteRoutes = require('./routes/nte');
const hearingRoutes = require('./routes/hearings');
const cdafRoutes = require('./routes/cdaf');
const investigationRoutes = require('./routes/investigations');
const reportRoutes = require('./routes/reports');
const documentRoutes = require('./routes/documents');
const attendanceRoutes = require('./routes/attendance');
const contractRoutes = require('./routes/contracts');
const recruitmentRoutes = require('./routes/recruitment');
const manpowerRoutes = require('./routes/manpower');
const fieldCheckRoutes = require('./routes/fieldchecking');
const bunkhouseRoutes = require('./routes/bunkhouse');
const atdRoutes = require('./routes/atd');
const complianceRoutes = require('./routes/compliance');
const auditRoutes = require('./routes/audit');
const vaultRoutes = require('./routes/vault');
const prfRoutes = require('./routes/prf');
const leaveRoutes = require('./routes/leaves');
const portalRoutes = require('./routes/portal');
const backupRoutes = require('./routes/backup');
const settingsRoutes = require('./routes/settings');
const pdfReportRoutes = require('./routes/pdfreports');
const subconRoutes = require('./routes/subcon');
const branchRoutes = require('./routes/branches');
const undertimeRoutes = require('./routes/undertime');

const app = express();
const PORT = process.env.PORT || 3000;

initializeDatabase();

app.use(express.urlencoded({ extended: true }));
app.use(express.json({ limit: '50mb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

app.use(expressLayouts);
app.set('view engine', 'ejs');
app.set('layout', 'layouts/main');
app.set('layout extractScripts', false);
app.set('layout extractStyles', false);

app.use((req, res, next) => {
  res.locals.currentPath = req.path;
  next();
});

app.use(loadBranches);

app.use('/', authRoutes);
app.use('/', dashboardRoutes);
app.use('/employees', employeeRoutes);
app.use('/incidents', incidentRoutes);
app.use('/nov', novRoutes);
app.use('/cases', caseRoutes);
app.use('/nte', nteRoutes);
app.use('/hearings', hearingRoutes);
app.use('/cdaf', cdafRoutes);
app.use('/investigations', investigationRoutes);
app.use('/reports', reportRoutes);
app.use('/documents', documentRoutes);
app.use('/attendance', attendanceRoutes);
app.use('/contracts', contractRoutes);
app.use('/recruitment', recruitmentRoutes);
app.use('/manpower', manpowerRoutes);
app.use('/fieldchecking', fieldCheckRoutes);
app.use('/bunkhouse', bunkhouseRoutes);
app.use('/atd', atdRoutes);
app.use('/compliance', complianceRoutes);
app.use('/audit', auditRoutes);
app.use('/vault', vaultRoutes);
app.use('/prf', prfRoutes);
app.use('/leaves', leaveRoutes);
app.use('/portal', portalRoutes);
app.use('/backup', backupRoutes);
app.use('/settings', settingsRoutes);
app.use('/reports/pdf', pdfReportRoutes);
app.use('/subcon', subconRoutes);
app.use('/branches', branchRoutes);
app.use('/undertime', undertimeRoutes);

app.use((req, res) => {
  res.status(404).render('error', { message: 'Page not found', layout: false });
});

app.listen(PORT, () => {
  console.log(`HRMS running on http://localhost:${PORT}`);
});
