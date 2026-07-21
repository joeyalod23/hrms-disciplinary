const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'disciplinary-monitoring-secret-key-2024';

function generateToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, full_name: user.full_name, role: user.role, branch_id: user.branch_id || null },
    JWT_SECRET,
    { expiresIn: '24h' }
  );
}

function verifyToken(req, res, next) {
  const token = req.cookies.token;
  if (!token) {
    return res.redirect('/login');
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    res.locals.user = decoded;
    next();
  } catch (err) {
    res.clearCookie('token');
    return res.redirect('/login');
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).render('error', { message: 'Access denied. Insufficient permissions.' });
    }
    next();
  };
}

module.exports = { generateToken, verifyToken, requireRole, JWT_SECRET };
