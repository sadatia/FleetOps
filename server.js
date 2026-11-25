require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const db = require('./db');
const authRouter = require('./auth');
const { authenticateToken } = require('./middleware');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*", methods: ["GET", "POST"] } });
const PORT = process.env.PORT || 5055;

app.use(express.static(path.join(__dirname, 'public')));
app.use('/api/auth', authRouter);

io.on('connection', (socket) => { console.log(`📡 Device linked: ${socket.id}`); });

async function logActivity(req, action, details) {
  if (!req.user) return;
  try {
    const uName = req.user.full_name || req.user.fullName || 'System';
    await db.query(
      'INSERT INTO activity_logs (user_name, role, action, details) VALUES ($1, $2, $3, $4)',
      [uName, req.user.role, action, details]
    );
    io.emit('logUpdate');
  } catch (e) {
    console.error('Log error', e);
  }
}

function requireSiteManager(req, res, next) {
  if (req.user.role !== 'site_manager') return res.status(403).json({ error: 'Access Denied: Site Manager clearance required.' });
  next();
}
function requireReservationAccess(req, res, next) {
  if (req.user.role !== 'site_manager' && req.user.role !== 'field_engineer') return res.status(403).json({ error: 'Access Denied: Engineering clearance required.' });
  next();
}
function requireSafetyAccess(req, res, next) {
  if (req.user.role !== 'site_manager' && req.user.role !== 'safety_team') return res.status(403).json({ error: 'Access Denied: Safety Team clearance required.' });
  next();
}

// --- ACTIVITY LOGS ---
app.get('/api/logs', authenticateToken, requireSiteManager, async (req, res) => {
  try {
    const r = await db.query('SELECT * FROM activity_logs ORDER BY timestamp DESC LIMIT 200');
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- USERS ---
app.get('/api/users', authenticateToken, requireSiteManager, async (req, res) => {
  try {
    const result = await db.query('SELECT id, email, full_name, role FROM users');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/users', authenticateToken, requireSiteManager, async (req, res) => {
  const { fullName, email, role, password } = req.body;
  try {
    const hash = await bcrypt.hash(password, 10);
    const userId = crypto.randomUUID();
    await db.query(
      'INSERT INTO users (id, full_name, email, role, password_hash) VALUES ($1, $2, $3, $4, $5)',
      [userId, fullName, email, role, hash]
    );
    await logActivity(req, 'CREATED USER', `Created ${role} account for ${email}`);
    res.json({ success: true, message: 'User created.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/users/:id', authenticateToken, requireSiteManager, async (req, res) => {
  const { fullName, email, role } = req.body;
  try {
    await db.query(
      'UPDATE users SET full_name = $1, email = $2, role = $3 WHERE id = $4',
      [fullName, email, role, req.params.id]
    );
    await logActivity(req, 'UPDATED USER', `Modified profile for ${email}`);
    res.json({ success: true, message: 'User updated.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/users/:id/password', authenticateToken, requireSiteManager, async (req, res) => {
  const { password } = req.body;
  try {
    const hash = await bcrypt.hash(password, 10);
    await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, req.params.id]);
    await logActivity(req, 'CHANGED PASSWORD', `Forced password reset for user ID ${req.params.id}`);
    res.json({ success: true, message: 'Password changed.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/users/:id', authenticateToken, requireSiteManager, async (req, res) => {
  try {
    await db.query('DELETE FROM users WHERE id = $1', [req.params.id]);
    await logActivity(req, 'DELETED USER', `Removed user ID ${req.params.id}`);
    res.json({ success: true, message: 'User removed.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- ASSETS ---
app.get('/api/assets', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM assets ORDER BY id ASC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/assets', authenticateToken, requireSiteManager, async (req, res) => {
  const { name, type, plateNumber, hourlyRate, location, latitude, longitude, imageData, owner, brand, serialNo, engineNo, manufacturerYear } = req.body;
  if (!name || !type || !plateNumber) return res.status(400).json({ error: 'Missing specifications.' });
  try {
    const assetId = 'A' + Date.now().toString().slice(-3);
    const result = await db.query(
      `INSERT INTO assets (id, name, type, plate_number, hourly_rate, status, current_location, latitude, longitude, image_data, owner, brand, serial_no, engine_no, manufacturer_year)
       VALUES ($1, $2, $3, $4, $5, 'available', $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING *`,
      [
        assetId, name, type, plateNumber, parseFloat(hourlyRate || 0),
        location || 'Moheshkhali Yard', parseFloat(latitude) || 21.692153, parseFloat(longitude) || 91.867748,
        imageData || null, owner, brand, serialNo, engineNo, manufacturerYear ? parseInt(manufacturerYear) : null
      ]
    );
    await logActivity(req, 'REGISTERED VEHICLE', `Added ${name} [${plateNumber}]`);
    const freshAssets = await db.query('SELECT * FROM assets ORDER BY id ASC');
    io.emit('fleetUpdate', { assets: freshAssets.rows, reservations: (await db.query('SELECT * FROM reservations')).rows });
    res.status(201).json({ success: true, asset: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/assets/:id', authenticateToken, requireSiteManager, async (req, res) => {
  const { name, type, plateNumber, hourlyRate, location, imageData, owner, brand, serialNo, engineNo, manufacturerYear } = req.body;
  try {
    if (imageData) {
      await db.query(
        `UPDATE assets SET name=$1, type=$2, plate_number=$3, hourly_rate=$4, current_location=$5, owner=$6, brand=$7, serial_no=$8, engine_no=$9, manufacturer_year=$10, image_data=$11 WHERE id=$12`,
        [name, type, plateNumber, parseFloat(hourlyRate || 0), location, owner, brand, serialNo, engineNo, manufacturerYear ? parseInt(manufacturerYear) : null, imageData, req.params.id]
      );
    } else {
      await db.query(
        `UPDATE assets SET name=$1, type=$2, plate_number=$3, hourly_rate=$4, current_location=$5, owner=$6, brand=$7, serial_no=$8, engine_no=$9, manufacturer_year=$10 WHERE id=$11`,
        [name, type, plateNumber, parseFloat(hourlyRate || 0), location, owner, brand, serialNo, engineNo, manufacturerYear ? parseInt(manufacturerYear) : null, req.params.id]
      );
    }
    await logActivity(req, 'UPDATED VEHICLE', `Modified profile specs for asset ID ${req.params.id}`);
    const freshAssets = await db.query('SELECT * FROM assets ORDER BY id ASC');
    io.emit('fleetUpdate', { assets: freshAssets.rows, reservations: (await db.query('SELECT * FROM reservations')).rows });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/assets/:id/status', authenticateToken, requireSiteManager, async (req, res) => {
  const { status } = req.body;
  try {
    await db.query(`UPDATE assets SET status = $1 WHERE id = $2`, [status, req.params.id]);
    await logActivity(req, 'STATUS UPDATE', `Marked vehicle ${req.params.id} as ${status}`);
    const freshAssets = await db.query('SELECT * FROM assets ORDER BY id ASC');
    io.emit('fleetUpdate', { assets: freshAssets.rows, reservations: (await db.query('SELECT * FROM reservations')).rows });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/assets/:id/location', async (req, res) => {
  const { latitude, longitude, locationName } = req.body;
  if (!latitude || !longitude) return res.status(400).json({ error: 'Missing GPS data' });
  try {
    if (locationName) {
      await db.query(`UPDATE assets SET latitude = $1, longitude = $2, current_location = $3 WHERE id = $4`, [latitude, longitude, locationName, req.params.id]);
    } else {
      await db.query(`UPDATE assets SET latitude = $1, longitude = $2 WHERE id = $3`, [latitude, longitude, req.params.id]);
    }
    await db.query(
      'INSERT INTO activity_logs (user_name, role, action, details) VALUES ($1, $2, $3, $4)',
      ['Field Scanner', 'guest', 'GPS SYNC', `Vehicle ${req.params.id} pinged live coordinates at ${locationName || 'Unknown Zone'}.`]
    );
    io.emit('logUpdate');
    const freshAssets = await db.query('SELECT * FROM assets ORDER BY id ASC');
    io.emit('fleetUpdate', { assets: freshAssets.rows, reservations: (await db.query('SELECT * FROM reservations')).rows });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/assets/:id', authenticateToken, requireSiteManager, async (req, res) => {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM inspections WHERE asset_id = $1', [req.params.id]);
    await client.query('DELETE FROM reservations WHERE asset_id = $1', [req.params.id]);
    const delRes = await client.query('DELETE FROM assets WHERE id = $1 RETURNING plate_number', [req.params.id]);
    if (delRes.rows.length === 0) throw new Error('Asset not found.');
    await client.query('COMMIT');
    await logActivity(req, 'DELETED VEHICLE', `Permanently deleted vehicle [${delRes.rows[0].plate_number}]`);
    const freshAssets = await db.query('SELECT * FROM assets ORDER BY id ASC');
    io.emit('fleetUpdate', { assets: freshAssets.rows, reservations: (await db.query('SELECT * FROM reservations')).rows });
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// --- RESERVATIONS ---
const RES_SELECT = `SELECT id, asset_id AS "assetId", user_id AS "userId", operator_name AS "operatorName", phone_number AS "phoneNumber", start_time AS "startTime", end_time AS "endTime", purpose FROM reservations ORDER BY start_time ASC`;

app.get('/api/reservations', async (req, res) => {
  try {
    const result = await db.query(RES_SELECT);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/reservations', authenticateToken, requireReservationAccess, async (req, res) => {
  const { assetId, operatorName, phoneNumber, startTime, endTime, purpose, latitude, longitude } = req.body;
  if (new Date(endTime) <= new Date(startTime)) return res.status(400).json({ error: 'End time must be after start time.' });
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const overlap = await client.query(
      'SELECT id FROM reservations WHERE asset_id = $1 AND (start_time, end_time) OVERLAPS ($2::timestamp, $3::timestamp)',
      [assetId, startTime, endTime]
    );
    if (overlap.rows.length > 0) throw new Error('Double-booking conflict!');
    await client.query(
      'INSERT INTO reservations (asset_id, user_id, operator_name, phone_number, start_time, end_time, purpose) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [assetId, req.user.id, operatorName, phoneNumber, startTime, endTime, purpose]
    );
    await client.query(
      "UPDATE assets SET status = 'in-use', current_location = $1, latitude = $2, longitude = $3 WHERE id = $4",
      [purpose, latitude || 21.692153, longitude || 91.867748, assetId]
    );
    await client.query('COMMIT');
    await logActivity(req, 'CREATED RESERVATION', `Allocated vehicle ${assetId} to ${operatorName}`);
    const freshAssets = await db.query('SELECT * FROM assets ORDER BY id ASC');
    const freshRes = await db.query(RES_SELECT);
    io.emit('fleetUpdate', { assets: freshAssets.rows, reservations: freshRes.rows });
    res.status(201).json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
});

app.put('/api/reservations/:id', authenticateToken, requireReservationAccess, async (req, res) => {
  const { operatorName, phoneNumber, startTime, endTime, purpose } = req.body;
  try {
    await db.query(
      'UPDATE reservations SET operator_name = $1, phone_number = $2, start_time = $3, end_time = $4, purpose = $5 WHERE id = $6',
      [operatorName, phoneNumber, startTime, endTime, purpose, req.params.id]
    );
    await logActivity(req, 'UPDATED RESERVATION', `Modified allocation settings for Record #${req.params.id}`);
    const freshAssets = await db.query('SELECT * FROM assets ORDER BY id ASC');
    const freshRes = await db.query(RES_SELECT);
    io.emit('fleetUpdate', { assets: freshAssets.rows, reservations: freshRes.rows });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/reservations/:id', authenticateToken, requireReservationAccess, async (req, res) => {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const resCheck = await client.query('SELECT asset_id FROM reservations WHERE id = $1', [req.params.id]);
    if (resCheck.rows.length === 0) return res.status(404).json({ error: 'Record not found.' });
    await client.query('DELETE FROM reservations WHERE id = $1', [req.params.id]);
    await client.query("UPDATE assets SET status = 'available', current_location = 'Moheshkhali Base Yard' WHERE id = $1", [resCheck.rows[0].asset_id]);
    await client.query('COMMIT');
    await logActivity(req, 'DELETED RESERVATION', `Cancelled and released allocation #${req.params.id}`);
    const freshAssets = await db.query('SELECT * FROM assets ORDER BY id ASC');
    const freshRes = await db.query(RES_SELECT);
    io.emit('fleetUpdate', { assets: freshAssets.rows, reservations: freshRes.rows });
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// --- INSPECTIONS ---
app.get('/api/inspections', async (req, res) => {
  try {
    const result = await db.query(
      'SELECT i.*, a.name AS "assetName", a.plate_number AS "plateNumber", a.type AS "assetType" FROM inspections i JOIN assets a ON i.asset_id = a.id ORDER BY i.next_annual_due ASC'
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/inspections', authenticateToken, requireSafetyAccess, async (req, res) => {
  const { assetId, owner, brand, model, serialNo, engineNo, manufacturerYear, inspectionLocation, inspectionDate, inspectedBy, status, remarks, reportDoc } = req.body;
  try {
    const nextDueObj = new Date(inspectionDate);
    nextDueObj.setFullYear(nextDueObj.getFullYear() + 1);
    const nextAnnualDue = nextDueObj.toISOString().split('T')[0];
    const result = await db.query(
      `INSERT INTO inspections (asset_id, owner, brand, model, serial_no, engine_no, manufacturer_year, inspection_location, inspection_date, next_annual_due, inspected_by, status, remarks, report_doc)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING *`,
      [assetId, owner, brand, model, serialNo, engineNo, parseInt(manufacturerYear), inspectionLocation, inspectionDate, nextAnnualDue, inspectedBy, status || 'Cleared', remarks || null, reportDoc || null]
    );
    await logActivity(req, 'LOGGED INSPECTION', `Submitted safety audit for ${assetId} -> Status: ${status}`);
    io.emit('inspectionUpdate');
    res.status(201).json({ success: true, inspection: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get(/.*/, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

server.listen(PORT, () => console.log(`🚀 FleetOps Running securely on port ${PORT}`));