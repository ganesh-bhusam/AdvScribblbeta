/**
 * Razorpay payment integration — premium unlock (₹25 lifetime + 6 months ad-free).
 * Supports MOCK MODE when PAYMENT_MOCK_MODE=1 or keys are placeholders.
 *
 * Endpoints:
 *   POST /api/payment/order   (auth)
 *   POST /api/payment/verify  (auth)
 *   GET  /api/payment/config  (returns public key id + mock flag)
 */
const express = require('express');
const crypto = require('crypto');
let Razorpay = null;
try {
  Razorpay = require('razorpay');
} catch (_) {}

const { authMiddleware } = require('./auth');
const { q } = require('../db');

const router = express.Router();
const KEY_ID = process.env.RAZORPAY_KEY_ID || '';
const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || '';
const MOCK = process.env.PAYMENT_MOCK_MODE === '1' || KEY_ID.includes('PLACEHOLDER');
const AMOUNT = 2500; // ₹25.00 in paise

let razorpayClient = null;
if (!MOCK && Razorpay) {
  razorpayClient = new Razorpay({ key_id: KEY_ID, key_secret: KEY_SECRET });
}

// GET /api/payment/config
router.get('/config', (req, res) => {
  res.json({
    keyId: MOCK ? 'rzp_mock_dev' : KEY_ID,
    mock: MOCK,
    amount: AMOUNT,
    currency: 'INR',
    productName: 'AdvScribbl Premium (Lifetime + 6 months Ad-Free)',
  });
});

// POST /api/payment/order
router.post('/order', authMiddleware, async (req, res) => {
  try {
    if (req.user.has_premium) {
      return res.status(400).json({ error: 'You already own Premium' });
    }

    if (MOCK) {
      const orderId = 'order_mock_' + crypto.randomBytes(10).toString('hex');
      q.insertPayment.run(req.user.id, orderId, AMOUNT, 'created', 1);
      return res.json({
        success: true,
        orderId,
        amount: AMOUNT,
        currency: 'INR',
        mock: true,
      });
    }

    const order = await razorpayClient.orders.create({
      amount: AMOUNT,
      currency: 'INR',
      receipt: `rcpt_${req.user.id}_${Date.now()}`.slice(0, 40),
    });
    q.insertPayment.run(req.user.id, order.id, AMOUNT, 'created', 0);
    res.json({
      success: true,
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      mock: false,
    });
  } catch (err) {
    console.error('[payment/order]', err);
    res.status(500).json({ error: 'Failed to create order' });
  }
});

// POST /api/payment/verify
router.post('/verify', authMiddleware, (req, res) => {
  const { razorpay_payment_id, razorpay_order_id, razorpay_signature } = req.body || {};
  if (!razorpay_order_id) {
    return res.status(400).json({ error: 'Missing order id' });
  }

  if (MOCK) {
    // In mock mode, accept any verify and grant premium.
    grantPremium(req.user.id, razorpay_order_id, razorpay_payment_id || 'pay_mock_' + Date.now());
    return res.json({ success: true, message: 'Premium unlocked! (mock mode)' });
  }

  if (!razorpay_payment_id || !razorpay_signature) {
    return res.status(400).json({ error: 'Missing payment fields' });
  }
  const hmac = crypto.createHmac('sha256', KEY_SECRET);
  hmac.update(`${razorpay_order_id}|${razorpay_payment_id}`);
  const expected = hmac.digest('hex');
  if (expected !== razorpay_signature) {
    return res.status(400).json({ error: 'Signature verification failed' });
  }
  grantPremium(req.user.id, razorpay_order_id, razorpay_payment_id);
  res.json({ success: true, message: 'Premium unlocked!' });
});

function grantPremium(userId, orderId, paymentId) {
  const adFreeUntil = new Date(Date.now() + 6 * 30 * 24 * 60 * 60 * 1000).toISOString();
  q.grantPremium.run(adFreeUntil, userId);
  q.completePayment.run(paymentId, 'paid', orderId);
}

module.exports = { router };
