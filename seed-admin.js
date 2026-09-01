'use strict';
// Creates (or resets) the admin user from CLI args:
//   node seed-admin.js <username> <password>
const { db } = require('./lib/db');
const { hashPassword } = require('./lib/auth');

const [username, password] = process.argv.slice(2);
if (!username || !password) {
  console.error('usage: node seed-admin.js <username> <password>');
  process.exit(1);
}
if (password.length < 8) {
  console.error('admin password must be at least 8 characters');
  process.exit(1);
}
const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
if (existing) {
  db.prepare("UPDATE users SET password_hash = ?, role = 'admin' WHERE id = ?").run(hashPassword(password), existing.id);
  console.log(`admin '${username}' password updated`);
} else {
  db.prepare("INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'admin')").run(username, hashPassword(password));
  console.log(`admin '${username}' created`);
}
