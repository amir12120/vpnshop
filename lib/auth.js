'use strict';
const crypto = require('crypto');

// PBKDF2-SHA512 password hashing (no native deps needed)
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 120000, 64, 'sha512').toString('hex');
  return `pbkdf2$120000$${salt}$${hash}`;
}

function verifyPassword(password, stored) {
  try {
    const [algo, iter, salt, hash] = String(stored).split('$');
    if (algo !== 'pbkdf2') return false;
    const check = crypto.pbkdf2Sync(password, salt, parseInt(iter, 10), 64, 'sha512').toString('hex');
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(check, 'hex'));
  } catch {
    return false;
  }
}

// Simple signed session cookie: userId.expiry.signature
const SECRET = process.env.VPNSHOP_SECRET || crypto.randomBytes(32).toString('hex');

function sign(value) {
  return crypto.createHmac('sha256', SECRET).update(value).digest('hex');
}

function makeSession(userId) {
  const exp = Date.now() + 7 * 24 * 3600 * 1000; // 7 days
  const payload = `${userId}.${exp}`;
  return `${payload}.${sign(payload)}`;
}

function parseSession(cookieValue) {
  if (!cookieValue) return null;
  const parts = cookieValue.split('.');
  if (parts.length !== 3) return null;
  const [userId, exp, sig] = parts;
  if (sign(`${userId}.${exp}`) !== sig) return null;
  if (Date.now() > Number(exp)) return null;
  return { userId: Number(userId) };
}

function randomToken(bytes = 16) {
  return crypto.randomBytes(bytes).toString('hex');
}

module.exports = { hashPassword, verifyPassword, makeSession, parseSession, randomToken };
