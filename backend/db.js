const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/advscribbl',
  ssl: (process.env.DATABASE_URL && !process.env.DATABASE_URL.includes('localhost') && !process.env.DATABASE_URL.includes('127.0.0.1')) ? { rejectUnauthorized: false } : false
});

const initDb = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS locked_usernames (
      id SERIAL PRIMARY KEY,
      username VARCHAR(100) UNIQUE NOT NULL,
      utr_number VARCHAR(20) NOT NULL,
      status VARCHAR(20) DEFAULT 'pending',
      approved_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
};

// Start initialization (will run on boot)
initDb().catch(console.error);

const q = {
  // Check if a username has approved premium
  isUsernamePremium: async (username) => {
    const res = await pool.query(
      'SELECT id FROM locked_usernames WHERE LOWER(username) = LOWER($1) AND status = $2',
      [username, 'approved']
    );
    return res.rows.length > 0;
  },

  // Check if username is already locked/pending (taken)
  isUsernameLocked: async (username) => {
    const res = await pool.query(
      'SELECT id, status FROM locked_usernames WHERE LOWER(username) = LOWER($1)',
      [username]
    );
    return res.rows[0] || null;
  },

  // Check if UTR already used by someone else
  findUTRDuplicate: async (utr) => {
    const res = await pool.query(
      'SELECT username FROM locked_usernames WHERE utr_number = $1',
      [utr]
    );
    return res.rows[0] || null;
  },

  // Submit UTR for a username (creates pending entry)
  submitUTR: async (username, utrNumber) => {
    await pool.query(
      'INSERT INTO locked_usernames (username, utr_number, status) VALUES (LOWER($1), $2, $3)',
      [username, utrNumber, 'pending']
    );
  },

  // Admin: approve a username
  approveUsername: async (username) => {
    const res = await pool.query(
      "UPDATE locked_usernames SET status = 'approved', approved_at = NOW() WHERE LOWER(username) = LOWER($1) RETURNING *",
      [username]
    );
    return res.rows[0];
  },

  // Admin: get all pending UTRs
  getAllPending: async () => {
    const res = await pool.query(
      "SELECT username, utr_number, created_at FROM locked_usernames WHERE status = 'pending' ORDER BY created_at DESC"
    );
    return res.rows;
  },

  // Admin: get all approved usernames
  getAllApproved: async () => {
    const res = await pool.query(
      "SELECT username, utr_number, approved_at FROM locked_usernames WHERE status = 'approved' ORDER BY approved_at DESC"
    );
    return res.rows;
  },

  // Stats
  statsTotalLocked: async () => {
    const res = await pool.query('SELECT COUNT(*) as count FROM locked_usernames');
    return res.rows[0];
  },
  statsPremiumUsers: async () => {
    const res = await pool.query("SELECT COUNT(*) as count FROM locked_usernames WHERE status = 'approved'");
    return res.rows[0];
  },
  statsTotalRevenue: async () => {
    const res = await pool.query("SELECT COUNT(*) * 20 as total FROM locked_usernames WHERE status = 'approved'");
    return res.rows[0];
  }
};

module.exports = { pool, q };
