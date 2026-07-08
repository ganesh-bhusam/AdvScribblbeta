/**
 * UPI Direct Payment — Premium username locking system.
 *
 * Endpoints:
 *   GET  /api/payment/check-username?username=xxx
 *   POST /api/payment/submit-utr      { username, utr }
 *   POST /api/payment/admin-approve   { secret, username }
 *   GET  /api/payment/admin-pending?secret=xxx
 *   GET  /api/payment/admin-approved?secret=xxx
 */
const express = require('express');
const nodemailer = require('nodemailer');
const { q } = require('../db');

const router = express.Router();

const UPI_ID   = process.env.UPI_ID   || 'advscribbl@ybl';
const UPI_NAME = process.env.UPI_NAME || 'Bhusam Ganesh';
const AMOUNT   = 20; // ₹20
const ADMIN_SECRET = process.env.ADMIN_SECRET || '';
const ADMIN_EMAIL  = process.env.ADMIN_EMAIL  || '';

// ── Email transporter ──────────────────────────────────────────────────────
let transporter = null;
if (process.env.SMTP_USER && process.env.SMTP_PASS) {
  transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
}

async function sendAdminAlert(username, utr) {
  if (!transporter || !ADMIN_EMAIL) return;
  try {
    await transporter.sendMail({
      from: `"AdvScribbl Payments" <${process.env.SMTP_USER}>`,
      to: ADMIN_EMAIL,
      subject: `💰 New UTR Submitted — @${username}`,
      html: `
        <div style="font-family:sans-serif;max-width:500px;margin:auto;background:#1a1a2e;color:#fff;padding:32px;border-radius:16px;">
          <h2 style="color:#FFD700;margin:0 0 16px">New Premium Payment</h2>
          <table style="width:100%;border-collapse:collapse;">
            <tr><td style="padding:8px;color:#aaa">Username</td><td style="padding:8px;font-weight:bold;color:#6366F1">@${username}</td></tr>
            <tr><td style="padding:8px;color:#aaa">UTR Number</td><td style="padding:8px;font-weight:bold;font-family:monospace;color:#22c55e">${utr}</td></tr>
            <tr><td style="padding:8px;color:#aaa">Amount</td><td style="padding:8px;font-weight:bold">₹${AMOUNT}</td></tr>
            <tr><td style="padding:8px;color:#aaa">Submitted At</td><td style="padding:8px">${new Date().toLocaleString('en-IN')}</td></tr>
          </table>
          <p style="margin-top:24px;color:#aaa">Verify ₹${AMOUNT} received in your UPI app, then approve:</p>
          <a href="${process.env.ALLOWED_ORIGINS?.split(',')[0]}/admin.html" 
             style="display:inline-block;background:#6366F1;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;margin-top:8px;">
            Open Admin Panel →
          </a>
        </div>
      `,
    });
  } catch (err) {
    console.error('[payment] Email send failed:', err.message);
  }
}

// ── GET /api/payment/check-username ────────────────────────────────────────
router.get('/check-username', async (req, res) => {
  const username = (req.query.username || '').trim().toLowerCase();
  if (!username || username.length < 2) {
    return res.status(400).json({ available: false, reason: 'Username too short (min 2 characters)' });
  }
  if (username.length > 21) {
    return res.status(400).json({ available: false, reason: 'Username too long (max 21 characters)' });
  }
  if (!/^[a-z0-9_\-\.]+$/.test(username)) {
    return res.status(400).json({ available: false, reason: 'Only letters, numbers, _ - . allowed' });
  }
  try {
    const existing = await q.isUsernameLocked(username);
    if (!existing) return res.json({ available: true });
    if (existing.status === 'approved') {
      return res.json({ available: false, reason: 'This username is already locked by someone else.' });
    }
    return res.json({ available: false, reason: 'This username has a pending payment. Try another.' });
  } catch (err) {
    console.error('[check-username]', err);
    res.status(500).json({ available: false, reason: 'Server error' });
  }
});

// ── POST /api/payment/submit-utr ───────────────────────────────────────────
router.post('/submit-utr', async (req, res) => {
  const { username, utr } = req.body || {};

  // Validate username
  const cleanUsername = (username || '').trim().toLowerCase();
  if (!cleanUsername || cleanUsername.length < 2 || cleanUsername.length > 21) {
    return res.status(400).json({ error: 'Invalid username' });
  }
  if (!/^[a-z0-9_\-\.]+$/.test(cleanUsername)) {
    return res.status(400).json({ error: 'Invalid username characters' });
  }

  // Validate UTR — must be exactly 12 digits
  const cleanUTR = (utr || '').trim().replace(/\s+/g, '');
  if (!/^\d{12}$/.test(cleanUTR)) {
    return res.status(400).json({ error: 'UTR must be exactly 12 digits' });
  }

  try {
    // Check if username is already locked
    const existing = await q.isUsernameLocked(cleanUsername);
    if (existing) {
      if (existing.status === 'approved') {
        return res.status(400).json({ error: 'This username is already locked by someone else.' });
      }
      return res.status(400).json({ error: 'This username already has a pending request. Contact support.' });
    }

    // Check UTR duplicate
    const duplicate = await q.findUTRDuplicate(cleanUTR);
    if (duplicate) {
      return res.status(400).json({ error: `This UTR was already used for username @${duplicate.username}` });
    }

    // Save pending
    await q.submitUTR(cleanUsername, cleanUTR);

    // Send admin email
    sendAdminAlert(cleanUsername, cleanUTR);

    res.json({ success: true, status: 'pending', username: cleanUsername });
  } catch (err) {
    console.error('[submit-utr]', err);
    res.status(500).json({ error: 'Server error. Please try again.' });
  }
});

// ── POST /api/payment/admin-approve ───────────────────────────────────────
router.post('/admin-approve', async (req, res) => {
  const { secret, username } = req.body || {};
  if (!ADMIN_SECRET || secret !== ADMIN_SECRET) {
    return res.status(403).json({ error: 'Invalid admin secret' });
  }
  const cleanUsername = (username || '').trim().toLowerCase();
  if (!cleanUsername) return res.status(400).json({ error: 'Username required' });
  try {
    const row = await q.approveUsername(cleanUsername);
    if (!row) return res.status(404).json({ error: 'Username not found or already approved' });
    console.log(`[admin] Approved premium for @${cleanUsername}`);
    res.json({ success: true, username: row.username });
  } catch (err) {
    console.error('[admin-approve]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /api/payment/admin-pending ────────────────────────────────────────
router.get('/admin-pending', async (req, res) => {
  if (!ADMIN_SECRET || req.query.secret !== ADMIN_SECRET) {
    return res.status(403).json({ error: 'Invalid admin secret' });
  }
  try {
    const rows = await q.getAllPending();
    res.json({ pending: rows });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /api/payment/admin-approved ───────────────────────────────────────
router.get('/admin-approved', async (req, res) => {
  if (!ADMIN_SECRET || req.query.secret !== ADMIN_SECRET) {
    return res.status(403).json({ error: 'Invalid admin secret' });
  }
  try {
    const rows = await q.getAllApproved();
    res.json({ approved: rows });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /api/payment/upi-config ───────────────────────────────────────────
router.get('/upi-config', (req, res) => {
  res.json({ upiId: UPI_ID, upiName: UPI_NAME, amount: AMOUNT });
});

module.exports = { router };
