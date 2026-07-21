const { getDB } = require('../db/schema');

function syncData() {
  const db = getDB();

  db.prepare("UPDATE contracts SET status = 'Expired' WHERE status = 'Active' AND end_date < date('now')").run();
  db.prepare("UPDATE contracts SET status = 'Active' WHERE status = 'Expired' AND end_date >= date('now')").run();

  db.prepare("UPDATE leave_applications SET status = 'Denied' WHERE status = 'Pending' AND date_to < date('now')").run();

  db.prepare("UPDATE incident_reports SET status = 'Closed' WHERE status = 'Open' AND resolution_date IS NOT NULL AND resolution_date < date('now')").run();

  db.prepare("UPDATE disciplinary_cases SET status = 'Resolved' WHERE status != 'Resolved' AND resolution_date IS NOT NULL AND resolution_date < date('now')").run();

  db.prepare("UPDATE attendance_exceptions SET status = 'Resolved' WHERE status = 'Open' AND end_date < date('now', '-30 days')").run();

  db.prepare("UPDATE compliance_calendar SET status = 'Overdue' WHERE status = 'Pending' AND due_date < date('now', 'localtime')").run();
}

let lastSync = 0;
function syncIfNeeded(intervalMs = 300000) {
  const now = Date.now();
  if (now - lastSync > intervalMs) {
    syncData();
    lastSync = now;
  }
}

module.exports = { syncData, syncIfNeeded };
