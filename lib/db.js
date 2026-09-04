'use strict';
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');

const DB_PATH = process.env.VPNSHOP_DB || path.join(__dirname, '..', 'data', 'vpnshop.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  volume_gb REAL,              -- NULL = unlimited volume
  duration_days INTEGER,       -- NULL = unlimited time
  price_toman INTEGER NOT NULL,
  device_limit INTEGER DEFAULT 2,
  inbound_id INTEGER,          -- Sanayi inbound to create clients in
  active INTEGER DEFAULT 1,
  sort INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  plan_id INTEGER NOT NULL REFERENCES plans(id),
  status TEXT NOT NULL DEFAULT 'pending_payment'
    -- pending_payment | awaiting_review | approved | rejected
    -- provisioning | delivered | failed
  ,
  receipt_path TEXT,           -- uploaded payment receipt image
  receipt_note TEXT,           -- optional note from customer
  client_name TEXT,            -- customer's chosen config username (client email on panel)
  admin_note TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  reviewed_at TEXT,
  delivered_at TEXT
);

CREATE TABLE IF NOT EXISTS deliveries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  panel_id INTEGER REFERENCES panels(id),
  sub_url TEXT,                -- subscription link
  config_json TEXT,            -- raw config links (array)
  qr_data_url TEXT,            -- QR PNG data-url of sub link
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS panels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  base_url TEXT NOT NULL,      -- e.g. http://127.0.0.1:2053 (tunnel) or https://panel...
  username TEXT,               -- optional — only needed for legacy v2 panels without an API token
  password TEXT,
  api_token TEXT,              -- 3x-ui v3 API token (Bearer) — preferred auth
  sub_url TEXT,                -- public subscription base URL for customer links
  default_inbound_id INTEGER,
  last_test_ok INTEGER,
  last_test_at TEXT,
  last_test_message TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'customer',  -- customer | admin
  telegram TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Cumulative usage snapshots of OUR delivered clients on the Sanayi panels.
-- The traffic meter samples up/down from the panel API on an interval and on
-- dashboard visits; charts aggregate the deltas between consecutive samples.
CREATE TABLE IF NOT EXISTS traffic_samples (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  panel_id INTEGER NOT NULL,
  email TEXT NOT NULL,
  ts INTEGER NOT NULL,          -- epoch seconds of the sample
  up INTEGER NOT NULL DEFAULT 0,
  down INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_traffic_samples ON traffic_samples(panel_id, email, ts);
`);

// ---------- migrate existing databases (ALTER TABLE for new panel columns) ----------
(() => {
  const cols = db.prepare("PRAGMA table_info(panels)").all().map((c) => c.name);
  if (!cols.includes('api_token')) {
    db.exec("ALTER TABLE panels ADD COLUMN api_token TEXT");  // 3x-ui v3 API token (Bearer)
  }
  if (!cols.includes('sub_url')) {
    db.exec("ALTER TABLE panels ADD COLUMN sub_url TEXT");    // public subscription URL base
  }
  const ocols = db.prepare("PRAGMA table_info(orders)").all().map((c) => c.name);
  if (!ocols.includes('client_name')) {
    db.exec("ALTER TABLE orders ADD COLUMN client_name TEXT"); // customer's chosen config username
  }
  const dcols = db.prepare("PRAGMA table_info(deliveries)").all().map((c) => c.name);
  if (!dcols.includes('email')) {
    db.exec("ALTER TABLE deliveries ADD COLUMN email TEXT");   // client account email on the panel
  }
  if (!dcols.includes('sub_id')) {
    db.exec("ALTER TABLE deliveries ADD COLUMN sub_id TEXT");  // random subscription path (not the email)
  }
})();
// ---------- settings helpers ----------
const getSetting = (key, fallback = null) => {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
};
const setSetting = (key, value) => {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, String(value));
};

module.exports = { db, getSetting, setSetting };
