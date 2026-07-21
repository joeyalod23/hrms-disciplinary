const express = require('express');
const { verifyToken } = require('../middleware/auth');

const router = express.Router();

router.get('/', verifyToken, (req, res) => {
  res.render('undertime/index');
});

module.exports = router;
