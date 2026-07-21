const express = require('express');
const bcrypt = require('bcryptjs');
const { getDB } = require('../db/schema');
const { generateToken, verifyToken } = require('../middleware/auth');

const router = express.Router();

router.get('/login', (req, res) => {
  if (req.cookies.token) {
    return res.redirect('/');
  }
  res.render('login', { layout: false });
});

router.post('/login', (req, res) => {
  const { username, password } = req.body;
  const db = getDB();
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.render('login', { layout: false, error: 'Invalid username or password' });
  }
  const token = generateToken(user);
  res.cookie('token', token, { httpOnly: true, maxAge: 86400000 });
  res.redirect('/');
});

router.get('/logout', (req, res) => {
  res.clearCookie('token');
  res.redirect('/login');
});

module.exports = router;
