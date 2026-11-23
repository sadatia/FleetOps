// auth.js
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto'); // FIX: Added to generate unique User IDs
const db = require('./db');

// 1. USER REGISTRATION (SIGNUP)
router.post('/signup', async (req, res) => {
  // FIX: Extract 'phone' from the frontend payload and map it safely
  const { email, password, fullName, phone, phoneNumber, role } = req.body;
  const finalPhone = phone || phoneNumber || null;

  if (!email || !password || !fullName) {
    return res.status(400).json({ error: 'Missing required fields (email, password, fullName).' });
  }

  try {
    // Check if user already exists
    const userCheck = await db.query('SELECT id FROM users WHERE email = $1', [email]);
    if (userCheck.rows.length > 0) {
      return res.status(400).json({ error: 'A user with this email already exists.' });
    }

    // Hash the password
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    // FIX: Generate a secure UUID for the database
    const userId = crypto.randomUUID();

    // Insert user into database with the generated ID
    const newUser = await db.query(
      `INSERT INTO users (id, email, password_hash, full_name, phone_number, role)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, email, full_name, role`,
      [userId, email, passwordHash, fullName, finalPhone, role || 'field_engineer']
    );

    res.status(201).json({ success: true, user: newUser.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error during registration.' });
  }
});

// 2. USER LOGIN
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  try {
    // Find user by email
    const result = await db.query('SELECT * FROM users WHERE email = $1', [email]);
    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid email or password.' });
    }

    const user = result.rows[0];

    // Verify password match
    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(400).json({ error: 'Invalid email or password.' });
    }

    // Generate JWT token containing key user metrics
    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET || 'fo_secret_key', // FIX: Added a fallback in case .env is unreadable
      { expiresIn: '24h' } // Token lasts 1 day
    );

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.full_name,
        role: user.role
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error during login.' });
  }
});

module.exports = router;