'use strict';
// Traffic meter for the customer dashboard.
//
// 3x-ui exposes only CUMULATIVE per-client counters (up/down since the client
// was created) — it keeps no usage history of its own. So the shop records
// periodic snapshots of every client it delivered (panel_id + email) into
// traffic_samples. Deltas between consecutive snapshots become the usage
// shown in the hourly / daily / monthly charts, and the latest snapshot is
// the source for "used" / "remaining" totals.
//
// Chart buckets: hour/day are fixed-size sliding windows; month aligns to the
// 12 real Jalaali calendar months (see lib/jalali.js).
//
// Sampling happens on a background timer (see server.js) and on dashboard
// visits. Only clients the shop itself created are sampled — the operator's
// pre-existing panel users are never touched.
const { db } = require('./db');
const { SanayiClient } = require('./sanayi');
const jal = require('./jalali');

const BUCKET_SECS = { hour: 3600, day: 86400 };
const BUCKET_POINTS = { hour: 24, day: 30, month: 12 };
const CONCURRENCY = 3;

// last-known live state: key `${panelId}\u0000${email}` -> traffic record
const stateCache = new Map();
let refreshing = false;

function keyOf(panelId, email) { return `${panelId}\u0000${email}`; }

function clientFor(panel) {
  return new SanayiClient({
    baseUrl: panel.base_url,
    username: panel.username,
    password: panel.password,
    apiToken: panel.api_token,
    subUrl: panel.sub_url,
    timeoutMs: 8000,
  });
}

// Every delivered order stores one row in `deliveries` with panel_id + email.
// A user may own several deliveries; the same (panel, email) can appear again
// for a renewal — sampling dedups by key and keeps the newest record.
function keysForUser(userId) {
  return db.prepare(`
    SELECT DISTINCT d.panel_id, d.email
    FROM deliveries d
    JOIN orders o ON o.id = d.order_id
    WHERE o.user_id = ? AND d.email IS NOT NULL AND d.email != ''
    ORDER BY d.panel_id, d.email`).all(userId);
}

// All delivered (panel, email) keys across the whole shop (for the timer).
function allKeys() {
  return db.prepare(`
    SELECT DISTINCT panel_id, email FROM deliveries
    WHERE email IS NOT NULL AND email != ''`).all();
}

function record(panelId, email, st) {
  const ts = Math.floor(Date.now() / 1000);
  db.prepare(`INSERT INTO traffic_samples (panel_id, email, ts, up, down)
              VALUES (?, ?, ?, ?, ?)`).run(panelId, email, ts, st.up, st.down);
  stateCache.set(keyOf(panelId, email), { ...st, panelId, email, ts });
}

// Last known usage state for a key — from the in-memory cache or, after a
// restart, the newest row in traffic_samples. null when never sampled.
function lastState(panelId, email) {
  const hit = stateCache.get(keyOf(panelId, email));
  if (hit) return hit;
  const row = db.prepare(
    `SELECT panel_id, email, ts, up, down FROM traffic_samples
     WHERE panel_id = ? AND email = ? ORDER BY ts DESC LIMIT 1`).get(panelId, email);
  if (!row) return null;
  return { email: row.email, up: row.up, down: row.down, total: 0, expiryTime: 0, enable: true, ts: row.ts };
}

async function refreshPanel(panel) {
  const keys = allKeys().filter((k) => k.panel_id === panel.id);
  const emails = [...new Set(keys.map((k) => k.email))];
  if (!emails.length) return 0;
  const client = clientFor(panel);
  const queue = emails.slice();
  let ok = 0;
  async function worker() {
    while (queue.length) {
      const email = queue.shift();
      try {
        const st = await client.getClientTraffic(email);
        record(panel.id, email, st);
        ok++;
      } catch { /* tunnel/panel hiccup — keep the last known sample */ }
    }
  }
  const workers = Array.from({ length: Math.min(CONCURRENCY, emails.length) }, () => worker());
  await Promise.all(workers);
  return ok;
}

// Poll every panel once. Used by the background timer; safe to call from a
// dashboard visit too — it never runs two rounds at the same time.
async function refreshAll() {
  if (refreshing) return 0;
  refreshing = true;
  try {
    const panels = db.prepare('SELECT * FROM panels').all();
    let total = 0;
    for (const p of panels) {
      try { total += await refreshPanel(p); } catch { /* per-panel isolation */ }
    }
    return total;
  } finally {
    refreshing = false;
  }
}

// Live refresh limited to ONE user's own delivered keys (dashboard visits).
async function refreshForUser(userId) {
  const keys = keysForUser(userId);
  if (!keys.length) return 0;
  const panelIds = [...new Set(keys.map((k) => k.panel_id))];
  const panelsById = new Map(db.prepare('SELECT * FROM panels').all().map((p) => [p.id, p]));
  let ok = 0;
  for (const pid of panelIds) {
    const panel = panelsById.get(pid);
    if (!panel) continue;
    const emails = [...new Set(keys.filter((k) => k.panel_id === pid).map((k) => k.email))];
    const client = clientFor(panel);
    const queue = emails.slice();
    async function worker() {
      while (queue.length) {
        const email = queue.shift();
        try { record(pid, email, await client.getClientTraffic(email)); ok++; }
        catch { /* keep last known */ }
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, emails.length) }, () => worker()));
  }
  return ok;
}

// ── usage series ───────────────────────────────────────────────────────────
// Deltas of the cumulative counters between consecutive snapshots, bucketed
// by the timestamp of the later snapshot. Returns BUCKET_POINTS[mode] values
// (bytes per bucket). Hour/day use fixed-size sliding windows; month uses the
// 12 real Jalaali calendar months ending with the current month, so labels
// never repeat or skip a month.
function seriesForUser(userId, mode) {
  const size = BUCKET_SECS[mode] || 3600;
  const points = BUCKET_POINTS[mode] || 24;
  const nowMs = Date.now();
  const now = Math.floor(nowMs / 1000);
  let windowStartSec, coordOf;
  if (mode === 'month') {
    const jNow = jal.dateToJalali(new Date(nowMs));
    const nowIdx = jal.monthIndexOf(jNow.jy, jNow.jm);
    const oldestIdx = nowIdx - (points - 1);
    const { jy, jm } = jal.yearMonthOf(oldestIdx);
    windowStartSec = Math.floor(jal.jalaliToDate(jy, jm, 1).getTime() / 1000);
    coordOf = (ts) => {
      const jj = jal.tsToJalali(ts);
      const c = jal.monthIndexOf(jj.jy, jj.jm) - oldestIdx;
      return (c >= 0 && c < points) ? c : -1;
    };
  } else {
    windowStartSec = now - size * points;
    coordOf = (ts) => {
      const c = Math.floor((ts - windowStartSec) / size);
      return (c >= 0 && c < points) ? c : -1;
    };
  }
  const out = new Array(points).fill(0);
  const keys = keysForUser(userId);
  if (!keys.length) return { size, points, start: windowStartSec, values: out, keys: 0 };

  const stmt = db.prepare(
    `SELECT ts, up, down FROM traffic_samples
     WHERE panel_id = ? AND email = ? AND ts >= ? ORDER BY ts`);
  for (const k of keys) {
    const rows = stmt.all(k.panel_id, k.email, windowStartSec);
    let pu = null, pd = null;
    for (const s of rows) {
      if (pu !== null && pd !== null) {
        const du = s.up - pu, dd = s.down - pd;
        if (du > 0 || dd > 0) {
          const idx = coordOf(s.ts);
          if (idx >= 0) out[idx] += du + dd;
        }
      }
      pu = s.up; pd = s.down;
    }
  }
  return { size, points, start: windowStartSec, values: out, keys: keys.length };
}

module.exports = { lastState, refreshPanel, refreshAll, refreshForUser, keysForUser, seriesForUser, record };
