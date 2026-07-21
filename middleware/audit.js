const { getDB } = require('../db/schema');

function logAudit(req, action, module, referenceId = null, details = null) {
  try {
    const db = getDB();
    db.prepare(
      'INSERT INTO audit_logs (user_id, username, action, module, reference_id, details, ip_address) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(
      req.user?.id || null,
      req.user?.username || 'system',
      action,
      module,
      referenceId,
      details ? (typeof details === 'string' ? details : JSON.stringify(details)) : null,
      req.ip || null
    );
  } catch (e) {
    console.error('Audit log error:', e.message);
  }
}

module.exports = { logAudit };
