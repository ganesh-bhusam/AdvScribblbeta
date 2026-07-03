const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_FILE = path.join(DATA_DIR, 'skribbl.db');
const db = new DatabaseSync(DB_FILE);

// Initialize schema
db.exec(`
  PRAGMA journal_mode = WAL;
  
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    has_premium INTEGER DEFAULT 0,
    ad_free_until TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    razorpay_order_id TEXT NOT NULL,
    razorpay_payment_id TEXT,
    amount INTEGER NOT NULL,
    status TEXT NOT NULL,
    is_mock INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );
`);

const q = {
  findUserByUsername: db.prepare('SELECT * FROM users WHERE username = ?'),
  findUserByEmail: db.prepare('SELECT * FROM users WHERE email = ?'),
  findUserById: db.prepare('SELECT * FROM users WHERE id = ?'),
  insertUser: db.prepare('INSERT INTO users (name, username, email, password_hash) VALUES (?, ?, ?, ?)'),
  grantPremium: db.prepare('UPDATE users SET has_premium = 1, ad_free_until = ? WHERE id = ?'),
  insertPayment: db.prepare('INSERT INTO payments (user_id, razorpay_order_id, amount, status, is_mock) VALUES (?, ?, ?, ?, ?)'),
  completePayment: db.prepare('UPDATE payments SET razorpay_payment_id = ?, status = ? WHERE razorpay_order_id = ?')
};

module.exports = {
  db,
  q
};
