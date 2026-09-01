'use strict';
// vpnshop doctor — health check for the shop and its Sanayi panel tunnels.
// Usage: node scripts/doctor.js
const fs = require('fs');
const path = require('path');
const { db } = require('../lib/db');
const { SanayiClient } = require('../lib/sanayi');

let bad = 0;
const ok = (m) => console.log(`  ✔ ${m}`);
const fail = (m) => { bad++; console.log(`  ✘ ${m}`); };
const info = (m) => console.log(`  ➜ ${m}`);

(async () => {
  console.log('── vpnshop doctor ──');

  // DB
  try {
    const n = db.prepare('SELECT COUNT(*) c FROM orders').get().c;
    ok(`database readable (${n} order(s))`);
  } catch (e) { fail(`database: ${e.message}`); }

  // uploads writable
  try {
    const up = path.join(__dirname, '..', 'public', 'uploads');
    const p = path.join(up, '.doctor-tmp');
    fs.writeFileSync(p, 'x'); fs.unlinkSync(p);
    ok(`uploads dir writable (${up})`);
  } catch (e) { fail(`uploads dir not writable: ${e.message}`); }

  // qrcode module
  try { require.resolve('qrcode'); ok('qrcode module present'); }
  catch { fail('qrcode module missing — run: npm install'); }

  // panels (tunnel reachability)
  const panels = db.prepare('SELECT * FROM panels ORDER BY id').all();
  if (!panels.length) {
    info('no Sanayi panels configured yet (add them in /admin/panels)');
  }
  for (const p of panels) {
    const client = new SanayiClient({ baseUrl: p.base_url, username: p.username, password: p.password, timeoutMs: 6000 });
    const r = await client.testConnection();
    if (r.ok) {
      ok(`panel "${p.name}" (${p.base_url}) reachable — ${r.message}`);
    } else {
      fail(`panel "${p.name}" (${p.base_url}) NOT reachable — ${r.message}`);
      info(`  check: is the tunnel up? from this server run: curl -i ${p.base_url}/login`);
    }
  }

  // orphan receipts
  try {
    const up = path.join(__dirname, '..', 'public', 'uploads');
    const orphans = fs.readdirSync(up).filter((f) =>
      f.startsWith('receipt_') && !db.prepare('SELECT 1 FROM orders WHERE receipt_path = ?').get('/uploads/' + f));
    if (orphans.length) info(`${orphans.length} orphaned receipt file(s) (blocked from public view, safe to delete)`);
    else ok('no orphaned receipt files');
  } catch { /* uploads dir missing is reported above */ }

  console.log(bad === 0 ? '\nALL CHECKS PASSED ✅' : `\n${bad} CHECK(S) FAILED ❌`);
  process.exit(bad === 0 ? 0 : 1);
})().catch((e) => { console.error('doctor crash:', e); process.exit(1); });
