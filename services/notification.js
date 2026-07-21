const nodemailer = require('nodemailer');
const { getDB } = require('../db/schema');

let transporter = null;

function dbSetting(key, def) {
  try {
    const db = getDB();
    const r = db.prepare('SELECT value FROM system_settings WHERE key = ?').get(key);
    return r ? r.value : def;
  } catch { return def; }
}

function getTransporter() {
  if (transporter) return transporter;
  const host = dbSetting('smtp_host', '') || process.env.SMTP_HOST || 'smtp.gmail.com';
  transporter = nodemailer.createTransport({
    host,
    port: Number(dbSetting('smtp_port', String(process.env.SMTP_PORT || 587))),
    secure: dbSetting('smtp_secure', process.env.SMTP_SECURE || 'false') === 'true',
    auth: {
      user: dbSetting('smtp_user', process.env.SMTP_USER || ''),
      pass: dbSetting('smtp_pass', process.env.SMTP_PASS || ''),
    },
  });
  return transporter;
}

const FROM = dbSetting('smtp_from', process.env.SMTP_FROM || 'hrms@lvledesma.com');

function logNotification(type, recipient, subject, status, error) {
  try {
    const db = getDB();
    db.prepare('INSERT INTO notification_log (type, recipient, subject, status, error) VALUES (?, ?, ?, ?, ?)').run(type, recipient || null, subject || null, status, error || null);
  } catch (e) {
    console.error('Notification log error:', e.message);
  }
}

async function sendEmail({ to, subject, html }) {
  try {
    const t = getTransporter();
    const from = dbSetting('smtp_from', process.env.SMTP_FROM || 'hrms@lvledesma.com');
    await t.sendMail({ from, to, subject, html });
    logNotification('email', to, subject, 'sent');
    return { ok: true };
  } catch (e) {
    console.error('Email send failed:', e.message);
    logNotification('email', to, subject, 'failed', e.message);
    return { ok: false, error: e.message };
  }
}

function notifyNteIssued(employee, nte) {
  if (!employee.email) {
    logNotification('nte', 'N/A', `NTE ${nte.memo_number}`, 'skipped', `Employee ${employee.full_name} has no email`);
    return Promise.resolve(false);
  }
  return sendEmail({
    to: employee.email,
    subject: `NTE Issued - ${nte.memo_number}`,
    html: `<p>Dear ${employee.full_name},</p>
<p>A Notice to Explain (NTE) has been issued against you:</p>
<p><b>NTE No.:</b> ${nte.memo_number}<br>
<b>Violation:</b> ${nte.specific_violation || 'See attached'}</p>
<p>Please submit your written explanation within 5 days.</p>
<p>— HRMS</p>`,
  });
}

function notifyHearingSchedule(employee, hearing, caseRef) {
  if (!employee.email) {
    logNotification('hearing', 'N/A', `Hearing ${caseRef.case_number}`, 'skipped', `Employee ${employee.full_name} has no email`);
    return Promise.resolve(false);
  }
  return sendEmail({
    to: employee.email,
    subject: `Hearing Scheduled - ${caseRef.case_number}`,
    html: `<p>Dear ${employee.full_name},</p>
<p>A hearing has been scheduled for your disciplinary case:</p>
<p><b>Case No.:</b> ${caseRef.case_number}<br>
<b>Date:</b> ${new Date(hearing.hearing_date).toLocaleDateString()}<br>
<b>Time:</b> ${hearing.start_time || 'TBD'}</p>
<p>Please attend as scheduled.</p>
<p>— HRMS</p>`,
  });
}

function notifyContractExpiry(employee, contract) {
  if (!employee.email) {
    logNotification('contract', 'N/A', `Contract expiry ${contract.end_date}`, 'skipped', `Employee ${employee.full_name} has no email`);
    return Promise.resolve(false);
  }
  return sendEmail({
    to: employee.email,
    subject: `Contract Expiring - ${contract.end_date}`,
    html: `<p>Dear ${employee.full_name},</p>
<p>Your employment contract is expiring on <b>${new Date(contract.end_date).toLocaleDateString()}</b>.</p>
<p>Please coordinate with HR for renewal or extension.</p>
<p>— HRMS</p>`,
  });
}

function notifyComplianceTask(userEmail, task) {
  if (!userEmail) {
    logNotification('compliance', 'N/A', `Task ${task.title}`, 'skipped', 'No recipient email');
    return Promise.resolve(false);
  }
  return sendEmail({
    to: userEmail,
    subject: `Compliance Task Due - ${task.title}`,
    html: `<p>A compliance task requires attention:</p>
<p><b>Task:</b> ${task.title}<br>
<b>Module:</b> ${task.module}<br>
<b>Due Date:</b> ${new Date(task.due_date).toLocaleDateString()}<br>
<b>Priority:</b> ${task.priority}</p>
<p>— HRMS</p>`,
  });
}

function notifyPmAcknowledgement(reportNumber, employeeName, narrative, irId) {
  const pmEmail = dbSetting('notify_pm_email', '');
  if (!pmEmail) {
    logNotification('pm_acknowledgement', 'N/A', `IR ${reportNumber}`, 'skipped', 'PM email not configured');
    return Promise.resolve(false);
  }
  return sendEmail({
    to: pmEmail,
    subject: `[ACKNOWLEDGEMENT] Incident Report - ${reportNumber}`,
    html: `<h3>Incident Report Acknowledgement</h3>
<p>An incident report has been filed for your acknowledgement:</p>
<p><b>Report No.:</b> ${reportNumber}<br>
<b>Employee:</b> ${employeeName || 'N/A'}<br>
<b>Narrative:</b> ${(narrative || '').substring(0, 500)}</p>
<p><a href="${process.env.BASE_URL || 'http://localhost:3000'}/incidents/view/${irId}">View Report</a></p>
<p>— HRMS Notification</p>`,
  });
}

function notifyHrDeputyReview(reportNumber, caseNumber, employeeName, caseId) {
  const hrDeputyEmail = dbSetting('notify_hr_deputy_email', '');
  if (!hrDeputyEmail) {
    logNotification('hr_deputy_review', 'N/A', `Case ${caseNumber || reportNumber}`, 'skipped', 'HR Deputy email not configured');
    return Promise.resolve(false);
  }
  return sendEmail({
    to: hrDeputyEmail,
    subject: `[FOR REVIEW] Disciplinary Case - ${caseNumber || reportNumber}`,
    html: `<h3>Case Ready for Review</h3>
<p>A disciplinary case is ready for your review. Please issue the final memo:</p>
<p><b>Case No.:</b> ${caseNumber || 'N/A'}<br>
<b>Employee:</b> ${employeeName || 'N/A'}<br></p>
<p><b>Action Required:</b> Review case, issue Memo Number, Findings, and Verdict.</p>
<p><a href="${process.env.BASE_URL || 'http://localhost:3000'}/cases/view/${caseId}">View Case</a></p>
<p>— HRMS Notification</p>`,
  });
}

function notifyHrHeadApproval(reportNumber, caseNumber, employeeName, caseId) {
  const hrHeadEmail = dbSetting('notify_hr_head_email', '');
  if (!hrHeadEmail) {
    logNotification('hr_head_approval', 'N/A', `Case ${caseNumber || reportNumber}`, 'skipped', 'HR Head email not configured');
    return Promise.resolve(false);
  }
  return sendEmail({
    to: hrHeadEmail,
    subject: `[FOR APPROVAL] Final Verdict - ${caseNumber || reportNumber}`,
    html: `<h3>Final Verdict Ready for Approval</h3>
<p>A disciplinary case verdict is ready for your approval:</p>
<p><b>Case No.:</b> ${caseNumber || 'N/A'}<br>
<b>Employee:</b> ${employeeName || 'N/A'}<br></p>
<p><b>Action Required:</b> Approve the findings and verdict for implementation.</p>
<p><a href="${process.env.BASE_URL || 'http://localhost:3000'}/cases/view/${caseId}">View Case</a></p>
<p>— HRMS Notification</p>`,
  });
}

function resetTransporter() {
  transporter = null;
}

module.exports = {
  sendEmail,
  resetTransporter,
  notifyNteIssued,
  notifyHearingSchedule,
  notifyContractExpiry,
  notifyComplianceTask,
  notifyPmAcknowledgement,
  notifyHrDeputyReview,
  notifyHrHeadApproval,
};
