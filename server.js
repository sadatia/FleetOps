require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { Server } = require('socket.io');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const { z } = require('zod');
const db = require('./db');
const authRouter = require('./auth');
const { authenticateToken } = require('./middleware');

const app = express();

// Security headers (CSP disabled so inline Leaflet/Chart.js/QR scripts keep working)
app.use(helmet({
  contentSecurityPolicy: false,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
}));
app.use(cors());

// Safe JSON limit now that files use multipart/form-data
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ limit: '1mb', extended: true }));

// Rate limiters
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  message: { error: 'Too many requests. Please slow down.' }
});
app.use('/api/', apiLimiter);

const strictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Rate limit exceeded. Try again later.' }
});
app.use('/api/auth/login', strictLimiter);

// --- ZOD VALIDATION ---
const validate = (schema) => (req, res, next) => {
  const result = schema.safeParse(req.body);
  if (!result.success) {
    const msg = result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
    return res.status(400).json({ error: `Validation failed — ${msg}` });
  }
  req.body = result.data;
  next();
};

const assetSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  type: z.string().min(1, 'Type is required'),
  plateNumber: z.string().min(1, 'Plate number is required'),
  hourlyRate: z.coerce.number().min(0).default(0),
  location: z.string().optional().default('Moheshkhali Yard'),
  latitude: z.coerce.number().optional(),
  longitude: z.coerce.number().optional(),
  owner: z.string().optional().nullable(),
  brand: z.string().optional().nullable(),
  serialNo: z.string().optional().nullable(),
  engineNo: z.string().optional().nullable(),
  manufacturerYear: z.union([z.coerce.number().int().min(1950).max(2100), z.literal('')]).optional().nullable()
    .transform(v => (v === '' || v === undefined ? null : v))
});

const reservationSchema = z.object({
  assetId: z.string().min(1, 'Vehicle is required'),
  operatorName: z.string().min(1, 'Operator name is required'),
  phoneNumber: z.string().optional().nullable(),
  startTime: z.string().datetime({ message: 'Valid ISO start time required' }),
  endTime: z.string().datetime({ message: 'Valid ISO end time required' }),
  purpose: z.string().min(1, 'Purpose is required'),
  latitude: z.coerce.number().optional(),
  longitude: z.coerce.number().optional()
});

const statusSchema = z.object({
  status: z.enum(['available', 'maintenance'])
});

// --- MULTER UPLOADS ---
const uploadsDir = path.join(__dirname, 'public', 'uploads');
fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${file.fieldname}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max per file
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|webp|pdf/;
    const extOk = allowed.test(path.extname(file.originalname).toLowerCase());
    if (extOk) return cb(null, true);
    cb(new Error('Only JPG, PNG, WEBP, and PDF files are allowed.'));
  }
});

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

// --- HEALTH CHECK ---
app.get('/api/health', async (req, res) => {
  try {
    await db.query('SELECT 1');
    res.json({ status: 'ok', database: 'connected', uptime: Math.floor(process.uptime()) });
  } catch (err) {
    res.status(503).json({ status: 'error', database: 'disconnected' });
  }
});

const ASSET_STATUS_SQL = `
  CASE
    WHEN a.status = 'maintenance' THEN 'maintenance'
    WHEN EXISTS (
      SELECT 1 FROM reservations r
      WHERE r.asset_id = a.id AND NOW() BETWEEN r.start_time AND r.end_time
    ) THEN 'in-use'
    ELSE 'available'
  END AS status
`;

// --- PUBLIC QR SCAN ENDPOINT (Read-Only, Zero PII) ---
app.get('/api/public/assets/:id', async (req, res) => {
  try {
    const assetRes = await db.query(
      `SELECT a.id, a.name, a.type, a.plate_number, ${ASSET_STATUS_SQL},
              a.current_location, a.image_data, a.owner, a.brand, a.serial_no, a.engine_no, a.manufacturer_year
       FROM assets a WHERE a.id = $1`,
      [req.params.id]
    );
    if (assetRes.rows.length === 0) return res.status(404).json({ error: 'Vehicle not found.' });

    const inspRes = await db.query(
      `SELECT inspection_date, next_annual_due, inspected_by, status, remarks
       FROM inspections WHERE asset_id = $1 ORDER BY inspection_date DESC LIMIT 1`,
      [req.params.id]
    );
    res.json({ asset: assetRes.rows[0], latestInspection: inspRes.rows[0] || null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

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
app.get('/api/assets', authenticateToken, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT a.id, a.name, a.type, a.plate_number, a.hourly_rate, ${ASSET_STATUS_SQL},
              a.current_location, a.latitude, a.longitude, a.image_data,
              a.owner, a.brand, a.serial_no, a.engine_no, a.manufacturer_year
       FROM assets a ORDER BY a.id ASC`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/assets', authenticateToken, requireSiteManager, upload.single('image'), validate(assetSchema), async (req, res) => {
  const { name, type, plateNumber, hourlyRate, location, latitude, longitude, owner, brand, serialNo, engineNo, manufacturerYear } = req.body;
  const imageUrl = req.file ? `/uploads/${req.file.filename}` : null;
  try {
    const assetId = 'A-' + crypto.randomUUID().split('-')[0].toUpperCase();
    const result = await db.query(
      `INSERT INTO assets (id, name, type, plate_number, hourly_rate, status, current_location, latitude, longitude, image_data, owner, brand, serial_no, engine_no, manufacturer_year)
       VALUES ($1, $2, $3, $4, $5, 'available', $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING *`,
      [
        assetId, name, type, plateNumber, hourlyRate,
        location || 'Moheshkhali Yard', latitude || 21.692153, longitude || 91.867748,
        imageUrl, owner || null, brand || null, serialNo || null, engineNo || null, manufacturerYear
      ]
    );
    await logActivity(req, 'REGISTERED VEHICLE', `Added ${name} [${plateNumber}]`);
    io.emit('fleetUpdate');
    res.status(201).json({ success: true, asset: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/assets/:id', authenticateToken, requireSiteManager, upload.single('image'), validate(assetSchema), async (req, res) => {
  const { name, type, plateNumber, hourlyRate, location, owner, brand, serialNo, engineNo, manufacturerYear } = req.body;
  const imageUrl = req.file ? `/uploads/${req.file.filename}` : null;
  try {
    if (imageUrl) {
      await db.query(
        `UPDATE assets SET name=$1, type=$2, plate_number=$3, hourly_rate=$4, current_location=$5, owner=$6, brand=$7, serial_no=$8, engine_no=$9, manufacturer_year=$10, image_data=$11 WHERE id=$12`,
        [name, type, plateNumber, hourlyRate, location, owner || null, brand || null, serialNo || null, engineNo || null, manufacturerYear, imageUrl, req.params.id]
      );
    } else {
      await db.query(
        `UPDATE assets SET name=$1, type=$2, plate_number=$3, hourly_rate=$4, current_location=$5, owner=$6, brand=$7, serial_no=$8, engine_no=$9, manufacturer_year=$10 WHERE id=$11`,
        [name, type, plateNumber, hourlyRate, location, owner || null, brand || null, serialNo || null, engineNo || null, manufacturerYear, req.params.id]
      );
    }
    await logActivity(req, 'UPDATED VEHICLE', `Modified profile specs for asset ID ${req.params.id}`);
    io.emit('fleetUpdate');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/assets/:id/status', authenticateToken, requireSiteManager, validate(statusSchema), async (req, res) => {
  const { status } = req.body;
  try {
    await db.query(`UPDATE assets SET status = $1 WHERE id = $2`, [status, req.params.id]);
    await logActivity(req, 'STATUS UPDATE', `Marked vehicle ${req.params.id} as ${status}`);
    io.emit('fleetUpdate');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/assets/:id/location', strictLimiter, authenticateToken, async (req, res) => {
  const { latitude, longitude, locationName } = req.body;
  if (!latitude || !longitude) return res.status(400).json({ error: 'Missing GPS data' });
  try {
    if (locationName) {
      await db.query(`UPDATE assets SET latitude = $1, longitude = $2, current_location = $3 WHERE id = $4`, [latitude, longitude, locationName, req.params.id]);
    } else {
      await db.query(`UPDATE assets SET latitude = $1, longitude = $2 WHERE id = $3`, [latitude, longitude, req.params.id]);
    }
    await logActivity(req, 'GPS SYNC', `Vehicle ${req.params.id} pinged live coordinates at ${locationName || 'Unknown Zone'}.`);
    io.emit('fleetUpdate');
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
    io.emit('fleetUpdate');
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

app.get('/api/reservations', authenticateToken, async (req, res) => {
  try {
    const result = await db.query(RES_SELECT);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/reservations', authenticateToken, requireReservationAccess, validate(reservationSchema), async (req, res) => {
  const { assetId, operatorName, phoneNumber, startTime, endTime, purpose, latitude, longitude } = req.body;
  if (new Date(endTime) <= new Date(startTime)) return res.status(400).json({ error: 'End time must be after start time.' });
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const assetCheck = await client.query('SELECT status FROM assets WHERE id = $1', [assetId]);
    if (assetCheck.rows.length === 0) throw new Error('Vehicle not found.');
    if (assetCheck.rows[0].status === 'maintenance') throw new Error('Cannot reserve a vehicle currently under maintenance.');

    const overlap = await client.query(
      'SELECT id FROM reservations WHERE asset_id = $1 AND (start_time, end_time) OVERLAPS ($2::timestamp, $3::timestamp)',
      [assetId, startTime, endTime]
    );
    if (overlap.rows.length > 0) throw new Error('Double-booking conflict!');

    await client.query(
      'INSERT INTO reservations (asset_id, user_id, operator_name, phone_number, start_time, end_time, purpose) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [assetId, req.user.id, operatorName, phoneNumber || null, startTime, endTime, purpose]
    );

    // Only update live location if the reservation is active right now
    const now = Date.now();
    if (now >= new Date(startTime).getTime() && now <= new Date(endTime).getTime()) {
      await client.query(
        'UPDATE assets SET current_location = $1, latitude = $2, longitude = $3 WHERE id = $4',
        [purpose, latitude || 21.692153, longitude || 91.867748, assetId]
      );
    }

    await client.query('COMMIT');
    await logActivity(req, 'CREATED RESERVATION', `Allocated vehicle ${assetId} to ${operatorName}`);
    io.emit('fleetUpdate');
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
  if (new Date(endTime) <= new Date(startTime)) return res.status(400).json({ error: 'End time must be after start time.' });
  try {
    await db.query(
      'UPDATE reservations SET operator_name = $1, phone_number = $2, start_time = $3, end_time = $4, purpose = $5 WHERE id = $6',
      [operatorName, phoneNumber || null, startTime, endTime, purpose, req.params.id]
    );
    await logActivity(req, 'UPDATED RESERVATION', `Modified allocation settings for Record #${req.params.id}`);
    io.emit('fleetUpdate');
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
    await client.query("UPDATE assets SET current_location = 'Moheshkhali Base Yard' WHERE id = $1", [resCheck.rows[0].asset_id]);
    await client.query('COMMIT');
    await logActivity(req, 'DELETED RESERVATION', `Cancelled and released allocation #${req.params.id}`);
    io.emit('fleetUpdate');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// --- INSPECTIONS ---
app.get('/api/inspections', authenticateToken, async (req, res) => {
  try {
    const result = await db.query(
      'SELECT i.*, a.name AS "assetName", a.plate_number AS "plateNumber", a.type AS "assetType" FROM inspections i JOIN assets a ON i.asset_id = a.id ORDER BY i.next_annual_due ASC'
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/inspections', authenticateToken, requireSafetyAccess, upload.single('reportDoc'), async (req, res) => {
  const { assetId, owner, brand, model, serialNo, engineNo, manufacturerYear, inspectionLocation, inspectionDate, inspectedBy, status, remarks } = req.body;
  const reportUrl = req.file ? `/uploads/${req.file.filename}` : null;
  try {
    const nextDueObj = new Date(inspectionDate);
    nextDueObj.setFullYear(nextDueObj.getFullYear() + 1);
    const nextAnnualDue = nextDueObj.toISOString().split('T')[0];
    const result = await db.query(
      `INSERT INTO inspections (asset_id, owner, brand, model, serial_no, engine_no, manufacturer_year, inspection_location, inspection_date, next_annual_due, inspected_by, status, remarks, report_doc)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING *`,
      [assetId, owner, brand, model, serialNo, engineNo, parseInt(manufacturerYear), inspectionLocation, inspectionDate, nextAnnualDue, inspectedBy, status || 'Cleared', remarks || null, reportUrl]
    );
    await logActivity(req, 'LOGGED INSPECTION', `Submitted safety audit for ${assetId} -> Status: ${status}`);
    io.emit('inspectionUpdate');
    res.status(201).json({ success: true, inspection: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Clean JSON error handler for Multer & unexpected errors
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError || err.message?.includes('Only JPG')) {
    return res.status(400).json({ error: err.message });
  }
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error.' });
});

app.get(/.*/, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

server.listen(PORT, () => console.log(`🚀 FleetOps Running securely on port ${PORT}`));