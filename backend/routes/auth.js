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

function authMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing token' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = q.findUserById.get(payload.uid);
    if (!user) return res.status(401).json({ error: 'User not found' });
    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// POST /api/auth/signup
router.post('/signup', (req, res) => {
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

  if (q.findUserByUsername.get(username)) {
    return res.status(409).json({ error: 'Username already taken' });
  }
  if (q.findUserByEmail.get(email)) {
    return res.status(409).json({ error: 'Email already registered' });
  }

  const password_hash = bcrypt.hashSync(password, 10);
  const info = q.insertUser.run(name, username, email, password_hash);
  const user = q.findUserById.get(info.lastInsertRowid);
  const token = signToken(user);
  return res.status(201).json({ token, user: userToPublic(user) });
});

// POST /api/auth/login
router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }
  const user = q.findUserByUsername.get(username);
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });
  if (!bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const token = signToken(user);
  return res.json({ token, user: userToPublic(user) });
});

// GET /api/auth/me  (refreshes premium status etc.)
router.get('/me', authMiddleware, (req, res) => {
  return res.json({ user: userToPublic(req.user) });
});

module.exports = { router, authMiddleware, userToPublic };
