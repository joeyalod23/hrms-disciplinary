const express = require('express');
const { getDB } = require('../db/schema');
const { verifyToken } = require('../middleware/auth');
const { logAudit } = require('../middleware/audit');

const router = express.Router();

router.get('/', verifyToken, (req, res) => {
  const db = getDB();
  const rooms = db.prepare(`
    SELECT r.*,
      (SELECT COUNT(*) FROM bunkhouse_occupants o WHERE o.room_id = r.id AND o.is_active = 1) as occupant_count
    FROM bunkhouse_rooms r WHERE r.is_active = 1 ORDER BY r.bunkhouse_name, r.room_number
  `).all();
  const activeOccupants = db.prepare(`
    SELECT o.*, r.room_number, r.bunkhouse_name, e.full_name as emp_name
    FROM bunkhouse_occupants o
    JOIN bunkhouse_rooms r ON o.room_id = r.id
    LEFT JOIN employees e ON o.employee_id = e.id
    WHERE o.is_active = 1
    ORDER BY r.bunkhouse_name, r.room_number, o.occupant_name
  `).all();
  const totalBeds = rooms.reduce((s, r) => s + r.capacity, 0);
  const totalOccupied = activeOccupants.length;
  const totalVacant = totalBeds - totalOccupied;

  res.render('bunkhouse/index', { rooms, activeOccupants, totalBeds, totalOccupied, totalVacant });
});

router.get('/rooms/add', verifyToken, (req, res) => {
  res.render('bunkhouse/room_form', { room: null });
});

router.post('/rooms/add', verifyToken, (req, res) => {
  const db = getDB();
  const { room_number, bunkhouse_name, capacity, project_site } = req.body;
  db.prepare('INSERT INTO bunkhouse_rooms (room_number, bunkhouse_name, capacity, project_site) VALUES (?,?,?,?)')
    .run(room_number, bunkhouse_name||'LVLCI Bunkhouse', capacity||4, project_site||'Vail Land Development');
  logAudit(req, 'Add Bunkhouse Room', 'Bunkhouse', null, room_number);
  res.redirect('/bunkhouse');
});

router.get('/occupants/add', verifyToken, (req, res) => {
  const db = getDB();
  const rooms = db.prepare("SELECT id, room_number, bunkhouse_name FROM bunkhouse_rooms WHERE is_active = 1 ORDER BY bunkhouse_name, room_number").all();
  const employees = db.prepare("SELECT id, employee_id, full_name, position FROM employees WHERE status = 'Active' ORDER BY full_name").all();
  res.render('bunkhouse/occupant_form', { occupant: null, rooms, employees, today: new Date().toISOString().split('T')[0] });
});

router.post('/occupants/add', verifyToken, (req, res) => {
  const db = getDB();
  const { room_id, employee_id, occupant_name, designation, start_date, rental_rate, rental_frequency, remarks } = req.body;
  db.prepare(`INSERT INTO bunkhouse_occupants (room_id, employee_id, occupant_name, designation, start_date, rental_rate, rental_frequency, remarks, created_by) VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(room_id, employee_id||null, occupant_name, designation||null, start_date, rental_rate||100, rental_frequency||'Weekly', remarks||null, req.user.id);
  db.prepare('UPDATE bunkhouse_rooms SET current_occupants = (SELECT COUNT(*) FROM bunkhouse_occupants WHERE room_id = ? AND is_active = 1) WHERE id = ?').run(room_id, room_id);
  logAudit(req, 'Add Bunkhouse Occupant', 'Bunkhouse', null, occupant_name);
  res.redirect('/bunkhouse');
});

router.get('/occupants/edit/:id', verifyToken, (req, res) => {
  const db = getDB();
  const occupant = db.prepare('SELECT * FROM bunkhouse_occupants WHERE id = ?').get(req.params.id);
  if (!occupant) return res.redirect('/bunkhouse');
  const rooms = db.prepare("SELECT id, room_number, bunkhouse_name FROM bunkhouse_rooms WHERE is_active = 1 ORDER BY bunkhouse_name, room_number").all();
  const employees = db.prepare("SELECT id, employee_id, full_name, position FROM employees WHERE status = 'Active' ORDER BY full_name").all();
  res.render('bunkhouse/occupant_form', { occupant, rooms, employees, today: '' });
});

router.post('/occupants/edit/:id', verifyToken, (req, res) => {
  const db = getDB();
  const { room_id, occupant_name, designation, end_date, rental_rate, rental_frequency, is_active, remarks } = req.body;
  db.prepare(`UPDATE bunkhouse_occupants SET room_id=?, occupant_name=?, designation=?, end_date=?, rental_rate=?, rental_frequency=?, is_active=?, remarks=? WHERE id=?`)
    .run(room_id, occupant_name, designation||null, end_date||null, rental_rate||100, rental_frequency||'Weekly', is_active ? 1 : 0, remarks||null, req.params.id);
  db.prepare('UPDATE bunkhouse_rooms SET current_occupants = (SELECT COUNT(*) FROM bunkhouse_occupants WHERE room_id = ? AND is_active = 1) WHERE id = ?').run(room_id, room_id);
  res.redirect('/bunkhouse');
});

router.get('/occupants/checkout/:id', verifyToken, (req, res) => {
  const db = getDB();
  const occupant = db.prepare('SELECT * FROM bunkhouse_occupants WHERE id = ?').get(req.params.id);
  if (occupant) {
    db.prepare(`UPDATE bunkhouse_occupants SET is_active = 0, end_date = date('now') WHERE id = ?`).run(req.params.id);
    db.prepare('UPDATE bunkhouse_rooms SET current_occupants = (SELECT COUNT(*) FROM bunkhouse_occupants WHERE room_id = ? AND is_active = 1) WHERE id = ?').run(occupant.room_id, occupant.room_id);
  }
  res.redirect('/bunkhouse');
});

module.exports = router;
