/**
 * Authentication: signup + login with bcrypt hashing + JWT tokens.
 * Endpoints:
 *   POST /api/auth/signup
 *   POST /api/auth/login
 *   GET  /api/auth/me
 */
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { q } = require('../db');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET;
const TOKEN_TTL = '30d';

function signToken(user) {
  return jwt.sign(
    { uid: user.id, username: user.username, name: user.name },
    JWT_SECRET,
    { expiresIn: TOKEN_TTL }
  );
}

function userToPublic(user) {
  return {
    id: user.id,
    name: user.name,
    username: user.username,
    email: user.email,
    has_premium: !!user.has_premium,
    ad_free_until: user.ad_free_until,
  };
}

async function authMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing token' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = await q.findUserById(payload.uid);
    if (!user) return res.status(401).json({ error: 'User not found' });
    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// POST /api/auth/signup
router.post('/signup', async (req, res) => {
  try {
    const { name, username, email, password } = req.body || {};
    if (!name || !username || !email || !password) {
      return res.status(400).json({ error: 'All fields are required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    if (!/^[a-zA-Z0-9_.-]{3,21}$/.test(username)) {
      return res.status(400).json({ error: 'Username must be 3-21 chars (letters, numbers, _ . -)' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Invalid email address' });
    }

    if (await q.findUserByUsername(username)) {
      return res.status(409).json({ error: 'Username already taken' });
    }
    if (await q.findUserByEmail(email)) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const password_hash = bcrypt.hashSync(password, 10);
    const info = await q.insertUser(name, username, email, password_hash);
    const user = await q.findUserById(info.id);
    const token = signToken(user);
    return res.status(201).json({ token, user: userToPublic(user) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }
    const user = await q.findUserByUsername(username);
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    if (!bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const token = signToken(user);
    return res.json({ token, user: userToPublic(user) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/auth/me  (refreshes premium status etc.)
router.get('/me', authMiddleware, (req, res) => {
  return res.json({ user: userToPublic(req.user) });
});

module.exports = { router, authMiddleware, userToPublic };
