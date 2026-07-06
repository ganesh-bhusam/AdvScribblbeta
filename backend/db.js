const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/advscribbl',
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false }
});

const initDb = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      username VARCHAR(255) UNIQUE NOT NULL,
      email VARCHAR(255) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      has_premium INTEGER DEFAULT 0,
      ad_free_until VARCHAR(255),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS payments (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      razorpay_order_id VARCHAR(255) NOT NULL,
      razorpay_payment_id VARCHAR(255),
      amount INTEGER NOT NULL,
      status VARCHAR(50) NOT NULL,
      is_mock INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
};

// Start initialization (will run on boot)
initDb().catch(console.error);

const q = {
  findUserByUsername: async (username) => {
    const res = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    return res.rows[0];
  },
  findUserByEmail: async (email) => {
    const res = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    return res.rows[0];
  },
  findUserById: async (id) => {
    const res = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
    return res.rows[0];
  },
  insertUser: async (name, username, email, passwordHash) => {
    const res = await pool.query(
      'INSERT INTO users (name, username, email, password_hash) VALUES ($1, $2, $3, $4) RETURNING id',
      [name, username, email, passwordHash]
    );
    return res.rows[0];
  },
  grantPremium: async (adFreeUntil, userId) => {
    await pool.query('UPDATE users SET has_premium = 1, ad_free_until = $1 WHERE id = $2', [adFreeUntil, userId]);
  },
  insertPayment: async (userId, orderId, amount, status, isMock) => {
    await pool.query(
      'INSERT INTO payments (user_id, razorpay_order_id, amount, status, is_mock) VALUES ($1, $2, $3, $4, $5)',
      [userId, orderId, amount, status, isMock]
    );
  },
  completePayment: async (paymentId, status, orderId) => {
    await pool.query(
      'UPDATE payments SET razorpay_payment_id = $1, status = $2 WHERE razorpay_order_id = $3',
      [paymentId, status, orderId]
    );
  },
  statsTotalUsers: async () => {
    const res = await pool.query('SELECT COUNT(*) as count FROM users');
    return res.rows[0];
  },
  statsPremiumUsers: async () => {
    const res = await pool.query('SELECT COUNT(*) as count FROM users WHERE has_premium = 1');
    return res.rows[0];
  },
  statsTotalRevenue: async (status) => {
    const res = await pool.query('SELECT SUM(amount) as total FROM payments WHERE status = $1', [status]);
    return res.rows[0];
  }
};

module.exports = {
  pool,
  q
};
