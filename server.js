'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const QRCode = require('qrcode');

const { db, getSetting, setSetting } = require('./lib/db');
const { hashPassword, verifyPassword, makeSession, parseSession, randomToken } = require('./lib/auth');
const { SanayiClient } = require('./lib/sanayi');

const PORT = parseInt(process.env.PORT || '3000', 10);
const PUBLIC_DIR = path.join(__dirname, 'public');
const UPLOAD_DIR = path.join(PUBLIC_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

// ---------------------------------------------------------------- helpers
function send(res, status, body, headers = {}) {
  res.writeHead(status, headers);
  res.end(body);
}
function sendJSON(res, status, obj) {
  send(res, status, JSON.stringify(obj), { 'Content-Type': 'application/json' });
}
function redirect(res, to) {
  send(res, 302, '', { Location: to });
}
function readBody(req, limit = 15 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function fmtDate(d) { return d || '—'; }
function fmtToman(n) { return Number(n).toLocaleString('fa-IR'); }

// current user from session cookie (null if none)
function getUser(req) {
  const sess = parseSession(parseCookies(req).session);
  if (!sess) return null;
  return db.prepare('SELECT * FROM users WHERE id = ?').get(sess.userId) || null;
}

// ---------------------------------------------------------------- routing
const routes = [];
function route(method, pattern, handler) {
  // pattern like /admin/panels/:id/test
  const keys = [];
  const rx = new RegExp('^' + pattern.replace(/:[^/]+/g, (m) => { keys.push(m.slice(1)); return '([^/]+)'; }) + '$');
  routes.push({ method, rx, keys, handler });
}

// ---------------------------------------------------------------- views (tiny template helpers)
const layout = (title, body, user) => `<!doctype html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} | فروشگاه VPN</title>
<style>
:root{--bg:#0f1420;--card:#1a2233;--line:#2a3550;--txt:#e8ecf5;--mut:#8b98b5;--acc:#4f8cff;--ok:#2ecc71;--bad:#e74c3c}
*{box-sizing:border-box}body{margin:0;font-family:Tahoma,Vazirmatn,sans-serif;background:var(--bg);color:var(--txt);font-size:14px}
a{color:var(--acc);text-decoration:none}header{display:flex;justify-content:space-between;align-items:center;padding:12px 20px;background:var(--card);border-bottom:1px solid var(--line)}
header .brand{font-weight:bold;font-size:16px}header nav a{margin-inline-start:16px}
main{max-width:960px;margin:24px auto;padding:0 16px}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:18px;margin-bottom:16px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:14px}
h1,h2{margin:0 0 14px}h1{font-size:20px}h2{font-size:16px}
table{width:100%;border-collapse:collapse}th,td{padding:8px 10px;border-bottom:1px solid var(--line);text-align:right}
th{color:var(--mut);font-weight:normal}
input,select,textarea{width:100%;padding:9px 11px;background:#0f1420;border:1px solid var(--line);border-radius:8px;color:var(--txt);font-family:inherit;margin:4px 0 12px}
button,.btn{display:inline-block;padding:9px 18px;background:var(--acc);color:#fff;border:0;border-radius:8px;cursor:pointer;font-family:inherit;font-size:14px}
.btn.secondary{background:transparent;border:1px solid var(--line);color:var(--txt)}
.btn.ok{background:var(--ok)}.btn.bad{background:var(--bad)}
.badge{padding:3px 10px;border-radius:20px;font-size:12px}
.b-pending{background:#3a3320;color:#f1c40f}.b-review{background:#1e3a5f;color:#5dade2}
.b-approved,.b-delivered{background:#1e4620;color:#2ecc71}.b-rejected,.b-failed{background:#4a1f1f;color:#e74c3c}
label{color:var(--mut);font-size:12px;display:block}
.msg{padding:10px 14px;border-radius:8px;margin-bottom:14px}
.msg.ok{background:#1e4620;color:#a9dfbf}.msg.err{background:#4a1f1f;color:#f2b3b3}
.price{font-size:18px;font-weight:bold;color:var(--acc)}
.mut{color:var(--mut);font-size:12px}
code,.mono{direction:ltr;text-align:left;font-family:monospace;font-size:12px;word-break:break-all;background:#0f1420;padding:6px 10px;border-radius:6px;display:block}
img.qr{background:#fff;padding:8px;border-radius:8px}
.row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
</style>
</head>
<body>
<header>
  <div class="brand">🛒 فروشگاه VPN</div>
  <nav>
    ${user ? `<a href="/">پلن‌ها</a><a href="/orders">سفارش‌های من</a>${user.role === 'admin' ? '<a href="/admin">پنل مدیریت</a>' : ''}<a href="/logout">خروج (${esc(user.username)})</a>` : `<a href="/login">ورود</a><a href="/register">عضویت</a>`}
  </nav>
</header>
<main>${body}</main>
</body></html>`;

// ---------------------------------------------------------------- PUBLIC: plans & register/login
route('GET', '/', async (req, res, { user }) => {
  const plans = db.prepare('SELECT * FROM plans WHERE active = 1 ORDER BY sort, id').all();
  const body = `
  <h1>بسته‌های اینترنتی</h1>
  <div class="grid">
  ${plans.map((p) => `
    <div class="card">
      <h2>${esc(p.name)}</h2>
      <div class="mut">حجم: ${p.volume_gb == null ? 'نامحدود' : p.volume_gb + ' گیگابایت'}</div>
      <div class="mut">زمان: ${p.duration_days == null ? 'نامحدود' : p.duration_days + ' روز'}</div>
      <div class="mut">تعداد دستگاه: ${p.device_limit ?? 2}</div>
      <div class="price">${fmtToman(p.price_toman)} تومان</div>
      <a class="btn" href="/buy/${p.id}">خرید (کارت به کارت)</a>
    </div>`).join('') || '<p>هنوز پلنی تعریف نشده است.</p>'}
  </div>`;
  send(res, 200, layout('فروشگاه', body, user));
});

route('GET', '/register', async (req, res, { user, query }) => {
  if (user) return redirect(res, '/');
  send(res, 200, layout('عضویت', `
  <div class="card" style="max-width:420px;margin:0 auto">
    <h1>عضویت</h1>
    ${query.err ? `<div class="msg err">${esc(query.err)}</div>` : ''}
    <form method="post" action="/register">
      <label>نام کاربری</label><input name="username" required minlength="3">
      <label>رمز عبور</label><input name="password" type="password" required minlength="6">
      <button>ثبت‌نام</button>
      <p class="mut">قبلاً عضو هستید؟ <a href="/login">ورود</a></p>
    </form>
  </div>`, null));
});

route('POST', '/register', async (req, res) => {
  const b = new URLSearchParams((await readBody(req)).toString());
  const username = (b.get('username') || '').trim();
  const password = b.get('password') || '';
  if (username.length < 3 || password.length < 6) return redirect(res, '/register?err=' + encodeURIComponent('نام کاربری یا رمز عبور کوتاه است'));
  const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (exists) return redirect(res, '/register?err=' + encodeURIComponent('این نام کاربری قبلاً ثبت شده است'));
  const info = db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(username, hashPassword(password));
  const userId = Number(info.lastInsertRowid);
  // auto-login
  send(res, 302, '', { Location: '/', 'Set-Cookie': `session=${makeSession(userId)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=604800` });
});

route('GET', '/login', async (req, res, { user, query }) => {
  if (user) return redirect(res, '/');
  send(res, 200, layout('ورود', `
  <div class="card" style="max-width:420px;margin:0 auto">
    <h1>ورود</h1>
    ${query.err ? `<div class="msg err">${esc(query.err)}</div>` : ''}
    <form method="post" action="/login">
      <label>نام کاربری</label><input name="username" required>
      <label>رمز عبور</label><input name="password" type="password" required>
      <button>ورود</button>
      <p class="mut">عضو نیستید؟ <a href="/register">عضویت</a></p>
    </form>
  </div>`, null));
});

route('POST', '/login', async (req, res) => {
  const b = new URLSearchParams((await readBody(req)).toString());
  const u = db.prepare('SELECT * FROM users WHERE username = ?').get((b.get('username') || '').trim());
  if (!u || !verifyPassword(b.get('password') || '', u.password_hash)) {
    await new Promise((r) => setTimeout(r, 800)); // slow down brute force
    return redirect(res, '/login?err=' + encodeURIComponent('نام کاربری یا رمز عبور اشتباه است'));
  }
  send(res, 302, '', { Location: '/', 'Set-Cookie': `session=${makeSession(u.id)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=604800` });
});

route('GET', '/logout', async (req, res) => {
  send(res, 302, '', { Location: '/', 'Set-Cookie': 'session=; HttpOnly; Path=/; Max-Age=0' });
});

// ---------------------------------------------------------------- BUY FLOW
route('GET', '/buy/:planId', async (req, res, { user, params, query }) => {
  if (!user) return redirect(res, '/login');
  const plan = db.prepare('SELECT * FROM plans WHERE id = ? AND active = 1').get(params.planId);
  if (!plan) return send(res, 404, layout('یافت نشد', '<p>پلن یافت نشد.</p>', user));
  const cardNumber = getSetting('card_number', '');
  const cardHolder = getSetting('card_holder', '');
  send(res, 200, layout('خرید ' + plan.name, `
  <h1>خرید: ${esc(plan.name)}</h1>
  <div class="card">
    <div class="row">
      <div>حجم: <b>${plan.volume_gb == null ? 'نامحدود' : plan.volume_gb + ' GB'}</b></div>
      <div>زمان: <b>${plan.duration_days == null ? 'نامحدود' : plan.duration_days + ' روز'}</b></div>
      <div>قیمت: <b class="price">${fmtToman(plan.price_toman)} تومان</b></div>
    </div>
  </div>
  ${query.err ? `<div class="msg err">${esc(query.err)}</div>` : ''}
  <div class="card">
    <h2>مرحله ۱ — واریز کارت به کارت</h2>
    ${cardNumber ? `
      <p>مبلغ <b>${fmtToman(plan.price_toman)} تومان</b> را به کارت زیر واریز کنید:</p>
      <div class="card" style="background:#0f1420">
        <div class="mono" id="cardno">${esc(cardNumber)}</div>
        <p class="mut">به نام: ${esc(cardHolder || '—')}</p>
      </div>` : `
      <div class="msg err">شماره کارت توسط مدیر تنظیم نشده است. با پشتیبانی تماس بگیرید.</div>`}
  </div>
  <div class="card">
    <h2>مرحله ۲ — ارسال فیش واریزی</h2>
    <form method="post" action="/buy/${plan.id}" enctype="multipart/form-data">
      <label>تصویر فیش واریزی (jpg / png / webp — حداکثر ۸ مگابایت)</label>
      <input type="file" name="receipt" accept="image/*" required>
      <label>توضیح (اختیاری — مثلاً ۴ رقم آخر کارت واریزکننده)</label>
      <input name="note">
      <button>ثبت سفارش و ارسال فیش</button>
    </form>
  </div>`, user));
});

route('POST', '/buy/:planId', async (req, res, { user, params }) => {
  if (!user) return redirect(res, '/login');
  const plan = db.prepare('SELECT * FROM plans WHERE id = ? AND active = 1').get(params.planId);
  if (!plan) return send(res, 404, layout('یافت نشد', '<p>پلن یافت نشد.</p>', user));

  // parse multipart manually (boundary-based, small files only)
  const body = await readBody(req, 12 * 1024 * 1024);
  const ct = req.headers['content-type'] || '';
  const m = /boundary=(?:"([^"]+)"|([^;]+))/.exec(ct);
  if (!m) return redirect(res, `/buy/${plan.id}?err=` + encodeURIComponent('فرم نامعتبر است'));
  const boundary = '--' + (m[1] || m[2]);

  let receiptPath = null, note = '';
  const parts = body.toString('binary').split(boundary).slice(1, -1);
  for (const part of parts) {
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd < 0) continue;
    const headers = part.slice(0, headerEnd).toString('binary');
    const content = part.slice(headerEnd + 4);
    const nameMatch = /name="([^"]+)"/.exec(headers);
    if (!nameMatch) continue;
    const fieldName = nameMatch[1];
    if (fieldName === 'note') {
      note = Buffer.from(content.replace(/\r\n$/, ''), 'binary').toString('utf8');
    } else if (fieldName === 'receipt') {
      const fileMatch = /filename="([^"]*)"/.exec(headers);
      const ctypeMatch = /Content-Type:\s*([^\r\n]+)/i.exec(headers);
      if (!fileMatch || !fileMatch[1]) continue;
      const buf = Buffer.from(content.replace(/\r\n$/, ''), 'binary');
      const allowed = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
      const ext = allowed[(ctypeMatch?.[1] || '').toLowerCase().split(';')[0]];
      if (!ext) return redirect(res, `/buy/${plan.id}?err=` + encodeURIComponent('فقط تصویر jpg/png/webp پذیرفته می‌شود'));
      if (buf.length > 8 * 1024 * 1024) return redirect(res, `/buy/${plan.id}?err=` + encodeURIComponent('حجم فایل بیش از ۸ مگابایت است'));
      const fname = `receipt_${Date.now()}_${randomToken(6)}${ext}`;
      fs.writeFileSync(path.join(UPLOAD_DIR, fname), buf);
      receiptPath = '/uploads/' + fname;
    }
  }
  if (!receiptPath) return redirect(res, `/buy/${plan.id}?err=` + encodeURIComponent('تصویر فیش الزامی است'));

  db.prepare(`INSERT INTO orders (user_id, plan_id, status, receipt_path, receipt_note)
              VALUES (?, ?, 'awaiting_review', ?, ?)`).run(user.id, plan.id, receiptPath, note.trim() || null);
  redirect(res, '/orders?ok=' + encodeURIComponent('سفارش ثبت شد. پس از تأیید مدیر، کانفیگ‌ها تحویل داده می‌شود.'));
});

route('GET', '/orders', async (req, res, { user, query }) => {
  if (!user) return redirect(res, '/login');
  const orders = db.prepare(`
    SELECT o.*, p.name AS plan_name, p.volume_gb, p.duration_days, d.sub_url, d.config_json, d.qr_data_url
    FROM orders o
    JOIN plans p ON p.id = o.plan_id
    LEFT JOIN deliveries d ON d.order_id = o.id
    WHERE o.user_id = ? ORDER BY o.id DESC`).all(user.id);
  const statusFa = {
    pending_payment: 'در انتظار پرداخت', awaiting_review: 'در انتظار تأیید مدیر',
    approved: 'تأیید شد', rejected: 'رد شد', provisioning: 'در حال ساخت',
    delivered: 'تحویل شده', failed: 'خطا در ساخت',
  };
  const body = `
  <h1>سفارش‌های من</h1>
  ${query.ok ? `<div class="msg ok">${esc(query.ok)}</div>` : ''}
  ${orders.map((o) => `
  <div class="card">
    <div class="row" style="justify-content:space-between">
      <div><b>سفارش #${o.id}</b> — ${esc(o.plan_name)} <span class="mut">(${o.volume_gb == null ? 'نامحدود' : o.volume_gb + 'GB'} / ${o.duration_days == null ? 'نامحدود' : o.duration_days + 'روز'})</span></div>
      <span class="badge b-${o.status}">${statusFa[o.status] || o.status}</span>
    </div>
    <div class="mut">ثبت: ${fmtDate(o.created_at)} ${o.reviewed_at ? '| بررسی: ' + fmtDate(o.reviewed_at) : ''}</div>
    ${o.status === 'rejected' && o.admin_note ? `<div class="msg err">دلیل رد: ${esc(o.admin_note)}</div>` : ''}
    ${o.sub_url ? `
      <h2 style="margin-top:14px">تحویل سفارش</h2>
      <img class="qr" src="${o.qr_data_url}" alt="QR" width="180" height="180">
      <label>لینک اشتراک (برای اپ‌های V2rayNG / Streisand / ...)</label>
      <div class="mono">${esc(o.sub_url)}</div>
      <label style="margin-top:10px">لینک کانفیگ‌ها</label>
      ${(JSON.parse(o.config_json || '[]')).map((l) => `<div class="mono">${esc(l)}</div>`).join('')}
    ` : ''}
  </div>`).join('') || '<p>سفارشی ثبت نشده است.</p>'}`;
  send(res, 200, layout('سفارش‌های من', body, user));
});

// ---------------------------------------------------------------- ADMIN
function requireAdmin(ctx) {
  if (!ctx.user) {
    // anonymous visitor: send them to the login page instead of a dead-end 403
    redirect(ctx.res, '/login');
    return false;
  }
  if (ctx.user.role !== 'admin') {
    send(ctx.res, 403, layout('دسترسی', '<p>فقط مدیر. اگر مدیر هستید، با حساب ادمین <a href="/login">وارد شوید</a>.</p>', ctx.user));
    return false;
  }
  return true;
}

route('GET', '/admin', async (req, res, ctx) => {
  if (!requireAdmin(ctx)) return;
  const { user } = ctx;
  const stats = {
    pending: db.prepare("SELECT COUNT(*) c FROM orders WHERE status='awaiting_review'").get().c,
    total: db.prepare('SELECT COUNT(*) c FROM orders').get().c,
    users: db.prepare('SELECT COUNT(*) c FROM users').get().c,
    panels: db.prepare('SELECT COUNT(*) c FROM panels').get().c,
  };
  const body = `
  <h1>پنل مدیریت</h1>
  <div class="grid">
    <div class="card"><h2>${stats.pending}</h2><div class="mut">سفارش در انتظار تأیید</div><a href="/admin/orders?status=awaiting_review">مشاهده</a></div>
    <div class="card"><h2>${stats.total}</h2><div class="mut">کل سفارش‌ها</div><a href="/admin/orders">مشاهده</a></div>
    <div class="card"><h2>${stats.users}</h2><div class="mut">کاربران</div></div>
    <div class="card"><h2>${stats.panels}</h2><div class="mut">پنل‌های سنایی متصل</div><a href="/admin/panels">مدیریت</a></div>
  </div>
  <div class="card"><a href="/admin/plans">مدیریت پلن‌ها</a> | <a href="/admin/settings">تنظیمات فروشگاه (شماره کارت و...)</a> | <a href="/admin/panels">پنل‌های سنایی</a></div>`;
  send(res, 200, layout('پنل مدیریت', body, user));
});

// ---- admin: orders
route('GET', '/admin/orders', async (req, res, ctx) => {
  if (!requireAdmin(ctx)) return;
  const { user, query } = ctx;
  const status = query.status || '';
  const orders = db.prepare(`
    SELECT o.*, p.name AS plan_name, u.username, p.volume_gb, p.duration_days, p.price_toman, d.sub_url
    FROM orders o
    JOIN plans p ON p.id = o.plan_id
    JOIN users u ON u.id = o.user_id
    LEFT JOIN deliveries d ON d.order_id = o.id
    ${status ? 'WHERE o.status = ?' : ''}
    ORDER BY o.id DESC LIMIT 200`).all(...(status ? [status] : []));
  const statusFa = {
    pending_payment: 'در انتظار پرداخت', awaiting_review: 'در انتظار تأیید',
    approved: 'تأیید شد', rejected: 'رد شد', provisioning: 'در حال ساخت',
    delivered: 'تحویل شده', failed: 'خطا',
  };
  const body = `
  <h1>سفارش‌ها</h1>
  <div class="row mut" style="margin-bottom:12px">
    <a href="/admin/orders">همه</a> | <a href="/admin/orders?status=awaiting_review">در انتظار تأیید</a> | <a href="/admin/orders?status=delivered">تحویل‌شده</a> | <a href="/admin/orders?status=rejected">رد‌شده</a>
  </div>
  ${orders.map((o) => `
  <div class="card">
    <div class="row" style="justify-content:space-between">
      <div><b>#${o.id}</b> — ${esc(o.username)} — ${esc(o.plan_name)} — <b>${fmtToman(o.price_toman)} تومان</b></div>
      <span class="badge b-${o.status}">${statusFa[o.status] || o.status}</span>
    </div>
    <div class="mut">ثبت: ${fmtDate(o.created_at)}</div>
    ${o.receipt_path ? `<p><img src="${esc(o.receipt_path)}" alt="فیش" style="max-width:340px;max-height:340px;border-radius:8px;border:1px solid var(--line)"></p>
      ${o.receipt_note ? `<div class="mut">توضیح مشتری: ${esc(o.receipt_note)}</div>` : ''}` : '<p class="mut">فیشی بارگذاری نشده</p>'}
    ${o.sub_url ? `<label>لینک تحویل‌شده:</label><div class="mono">${esc(o.sub_url)}</div>` : ''}
    ${o.status === 'awaiting_review' ? `
    <form method="post" action="/admin/orders/${o.id}/approve" class="row">
      <div style="flex:1;min-width:220px">
        <label>پنل سنایی</label>
        <select name="panel_id">
          ${db.prepare('SELECT * FROM panels ORDER BY id').all().map((p) => `<option value="${p.id}">${esc(p.name)}${p.default_inbound_id ? ` (inbound ${p.default_inbound_id})` : ''}</option>`).join('') || '<option value="">— هیچ پنلی ثبت نشده —</option>'}
        </select>
        <label>Inbound ID (خالی = پیش‌فرض پنل)</label>
        <input name="inbound_id" placeholder="مثلاً ۱">
      </div>
      <div><button class="ok">✓ تأیید و تحویل خودکار</button></div>
    </form>
    <form method="post" action="/admin/orders/${o.id}/reject" class="row" style="margin-top:8px">
      <div style="flex:1;min-width:220px"><label>دلیل رد (به مشتری نمایش داده می‌شود)</label><input name="admin_note"></div>
      <div><button class="bad">✗ رد سفارش</button></div>
    </form>` : ''}
  </div>`).join('') || '<p>سفارشی نیست.</p>'}`;
  send(res, 200, layout('سفارش‌ها', body, user));
});

// create client on Sanayi panel + store delivery
async function provisionOrder(order, panelId, inboundId) {
  const panel = db.prepare('SELECT * FROM panels WHERE id = ?').get(panelId);
  if (!panel) throw new Error('پنل انتخاب نشده است');
  const inbound = inboundId ? Number(inboundId) : panel.default_inbound_id;
  if (!inbound) throw new Error('Inbound مشخص نشده است (نه در فرم نه به‌عنوان پیش‌فرض پنل)');

  const plan = db.prepare('SELECT * FROM plans WHERE id = ?').get(order.plan_id);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(order.user_id);

  const client = new SanayiClient({ baseUrl: panel.base_url, username: panel.username, password: panel.password, apiToken: panel.api_token, subUrl: panel.sub_url });
  const email = `u${user.id}o${order.id}_${randomToken(4)}`;
  const uuid = crypto.randomUUID();
  const totalGB = plan.volume_gb == null ? 0 : Math.round(plan.volume_gb * 1024 * 1024 * 1024);
  const expiryTime = plan.duration_days == null ? 0 : Date.now() + plan.duration_days * 24 * 3600 * 1000;

  await client.addClient({ inboundId: inbound, email, uuid, totalGB, expiryTime, limitIp: plan.device_limit ?? 2 });
  const links = await client.getClientLinks({ inboundId: inbound, email });

  db.prepare(`INSERT INTO deliveries (order_id, panel_id, sub_url, config_json, qr_data_url)
              VALUES (?, ?, ?, ?, ?)`).run(
    order.id, panel.id, links.subUrl, JSON.stringify(links.links),
    await QRCode.toDataURL(links.subUrl, { width: 360, margin: 1 }));
  db.prepare("UPDATE orders SET status='delivered', reviewed_at=datetime('now'), delivered_at=datetime('now') WHERE id=?").run(order.id);
}

route('POST', '/admin/orders/:id/approve', async (req, res, ctx) => {
  if (!requireAdmin(ctx)) return;
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(ctx.params.id);
  if (!order || order.status !== 'awaiting_review') return redirect(res, '/admin/orders');
  const b = new URLSearchParams((await readBody(req)).toString());
  db.prepare("UPDATE orders SET status='provisioning' WHERE id=?").run(order.id);
  try {
    await provisionOrder(order, b.get('panel_id'), b.get('inbound_id'));
  } catch (e) {
    db.prepare("UPDATE orders SET status='awaiting_review', admin_note=? WHERE id=?").run('خطا در ساخت: ' + e.message, order.id);
    return redirect(res, '/admin/orders?err=' + encodeURIComponent('خطا در اتصال به پنل: ' + e.message));
  }
  redirect(res, '/admin/orders?ok=' + encodeURIComponent(`سفارش #${order.id} تأیید و تحویل شد`));
});

route('POST', '/admin/orders/:id/reject', async (req, res, ctx) => {
  if (!requireAdmin(ctx)) return;
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(ctx.params.id);
  if (!order || order.status !== 'awaiting_review') return redirect(res, '/admin/orders');
  const b = new URLSearchParams((await readBody(req)).toString());
  db.prepare("UPDATE orders SET status='rejected', reviewed_at=datetime('now'), admin_note=? WHERE id=?")
    .run(b.get('admin_note') || null, order.id);
  redirect(res, '/admin/orders?ok=' + encodeURIComponent(`سفارش #${order.id} رد شد`));
});

// ---- admin: plans
route('GET', '/admin/plans', async (req, res, ctx) => {
  if (!requireAdmin(ctx)) return;
  const plans = db.prepare('SELECT * FROM plans ORDER BY sort, id').all();
  const body = `
  <h1>پلن‌ها</h1>
  ${plans.map((p) => `
  <div class="card">
    <form method="post" action="/admin/plans/${p.id}">
      <div class="row">
        <div style="flex:2"><label>نام</label><input name="name" value="${esc(p.name)}"></div>
        <div style="flex:1"><label>حجم (GB — خالی=نامحدود)</label><input name="volume_gb" value="${p.volume_gb ?? ''}"></div>
        <div style="flex:1"><label>زمان (روز — خالی=نامحدود)</label><input name="duration_days" value="${p.duration_days ?? ''}"></div>
        <div style="flex:1"><label>قیمت (تومان)</label><input name="price_toman" value="${p.price_toman}"></div>
        <div style="flex:1"><label>دستگاه</label><input name="device_limit" value="${p.device_limit ?? 2}"></div>
        <div style="flex:1"><label>Inbound پیش‌فرض (خالی=پنل)</label><input name="inbound_id" value="${p.inbound_id ?? ''}"></div>
        <div><label>فعال</label><select name="active"><option value="1" ${p.active ? 'selected' : ''}>بله</option><option value="0" ${!p.active ? 'selected' : ''}>خیر</option></select></div>
      </div>
      <button>ذخیره</button>
    </form>
  </div>`).join('')}
  <div class="card">
    <h2>پلن جدید</h2>
    <form method="post" action="/admin/plans/new">
      <div class="row">
        <div style="flex:2"><label>نام</label><input name="name" required></div>
        <div style="flex:1"><label>حجم (GB)</label><input name="volume_gb"></div>
        <div style="flex:1"><label>زمان (روز)</label><input name="duration_days"></div>
        <div style="flex:1"><label>قیمت (تومان)</label><input name="price_toman" required></div>
        <div style="flex:1"><label>دستگاه</label><input name="device_limit" value="2"></div>
      </div>
      <button>افزودن</button>
    </form>
  </div>`;
  send(res, 200, layout('پلن‌ها', body, ctx.user));
});

function planFields(b) {
  const num = (v) => (v === '' || v == null ? null : Number(v));
  return {
    name: (b.get('name') || '').trim(),
    volume_gb: num(b.get('volume_gb')),
    duration_days: num(b.get('duration_days')),
    price_toman: num(b.get('price_toman')) ?? 0,
    device_limit: num(b.get('device_limit')) ?? 2,
    inbound_id: num(b.get('inbound_id')),
    active: b.get('active') === '0' ? 0 : 1,
  };
}
route('POST', '/admin/plans/new', async (req, res, ctx) => {
  if (!requireAdmin(ctx)) return;
  const f = planFields(new URLSearchParams((await readBody(req)).toString()));
  db.prepare('INSERT INTO plans (name, volume_gb, duration_days, price_toman, device_limit, inbound_id, active) VALUES (?,?,?,?,?,?,?)')
    .run(f.name, f.volume_gb, f.duration_days, f.price_toman, f.device_limit, f.inbound_id, f.active);
  redirect(res, '/admin/plans');
});
route('POST', '/admin/plans/:id', async (req, res, ctx) => {
  if (!requireAdmin(ctx)) return;
  const f = planFields(new URLSearchParams((await readBody(req)).toString()));
  db.prepare('UPDATE plans SET name=?, volume_gb=?, duration_days=?, price_toman=?, device_limit=?, inbound_id=?, active=? WHERE id=?')
    .run(f.name, f.volume_gb, f.duration_days, f.price_toman, f.device_limit, f.inbound_id, f.active, ctx.params.id);
  redirect(res, '/admin/plans');
});

// ---- admin: panels (Sanayi connection + test)
route('GET', '/admin/panels', async (req, res, ctx) => {
  if (!requireAdmin(ctx)) return;
  const panels = db.prepare('SELECT * FROM panels ORDER BY id').all();
  const body = `
  <h1>پنل‌های سنایی</h1>
  ${panels.map((p) => `
  <div class="card">
    <form method="post" action="/admin/panels/${p.id}">
      <div class="row">
        <div style="flex:1"><label>نام</label><input name="name" value="${esc(p.name)}"></div>
        <div style="flex:2"><label>آدرس پنل (Base URL — از طریق تونل: http://127.0.0.1:PORT)</label><input name="base_url" value="${esc(p.base_url)}" dir="ltr"></div>
        <div style="flex:1"><label>API Token (v3، اختیاری)</label><input name="api_token" value="${esc(p.api_token || '')}" dir="ltr" placeholder="توکن ساخته‌شده در پنل"></div>
        <div style="flex:1"><label>نام کاربری</label><input name="username" value="${esc(p.username)}" dir="ltr"></div>
        <div style="flex:1"><label>رمز عبور</label><input name="password" type="password" placeholder="(تغییر ندهید = بدون تغییر)" dir="ltr"></div>
        <div style="flex:1"><label>Inbound پیش‌فرض</label><input name="default_inbound_id" value="${p.default_inbound_id ?? ''}"></div>
      </div>
      <div class="row">
        <div style="flex:3"><label>آدرس عمومی لینک اشتراک (sub) — برای مشتری‌ها</label><input name="sub_url" value="${esc(p.sub_url || '')}" dir="ltr" placeholder="مثل https://Domain:Port (خالی = آدرس پنل)"></div>
      </div>
      <div class="row">
        <button>ذخیره</button>
        <button class="secondary" formaction="/admin/panels/${p.id}/test">تست اتصال</button>
        <button class="bad" formaction="/admin/panels/${p.id}/delete">حذف</button>
      </div>
    </form>
    ${p.last_test_at ? `<div class="msg ${p.last_test_ok ? 'ok' : 'err'}">آخرین تست (${fmtDate(p.last_test_at)}): ${esc(p.last_test_message)}</div>` : ''}
  </div>`).join('')}
  <div class="card">
    <h2>اتصال پنل سنایی جدید</h2>
    <form method="post" action="/admin/panels/new">
      <div class="row">
        <div style="flex:1"><label>نام</label><input name="name" required placeholder="مثلاً سرور خارج"></div>
        <div style="flex:2"><label>آدرس پنل (از طریق تونل: http://127.0.0.1:PORT)</label><input name="base_url" required dir="ltr" placeholder="http://127.0.0.1:2053"></div>
        <div style="flex:1"><label>API Token (v3، اختیاری)</label><input name="api_token" dir="ltr" placeholder="توکن ساخته‌شده در پنل (توصیه می‌شود)"></div>
        <div style="flex:1"><label>نام کاربری مدیر پنل</label><input name="username" required dir="ltr"></div>
        <div style="flex:1"><label>رمز عبور مدیر پنل</label><input name="password" required type="password" dir="ltr"></div>
        <div style="flex:1"><label>Inbound پیش‌فرض</label><input name="default_inbound_id" placeholder="مثلاً ۱"></div>
      </div>
      <div class="row">
        <div style="flex:3"><label>آدرس عمومی لینک اشتراک (sub) — برای مشتری‌ها</label><input name="sub_url" dir="ltr" placeholder="مثل https://Domain:Port (خالی = آدرس پنل)"></div>
      </div>
      <button>افزودن پنل</button>
    </form>
  </div>
  <p class="mut">نکته: اگر پنل سنایی فقط از طریق تونل در دسترس است، آدرس را به شکل <span class="mono" style="display:inline">http://127.0.0.1:PORT</span> وارد کنید (پورتِ فورواردشده روی همین سرور).</p>`;
  send(res, 200, layout('پنل‌های سنایی', body, ctx.user));
});

async function panelFromForm(req, { requirePassword = true } = {}) {
  const b = new URLSearchParams((await readBody(req)).toString());
  const p = {
    name: (b.get('name') || '').trim(),
    base_url: (b.get('base_url') || '').trim().replace(/\/+$/, ''),
    api_token: (b.get('api_token') || '').trim(),
    username: (b.get('username') || '').trim(),
    sub_url: (b.get('sub_url') || '').trim().replace(/\/+$/, '') || null,
    default_inbound_id: b.get('default_inbound_id') ? Number(b.get('default_inbound_id')) : null,
  };
  const pw = b.get('password') || '';
  if (requirePassword && !pw) throw new Error('رمز عبور الزامی است');
  if (pw) p.password = pw;
  if (!p.name || !p.base_url || !p.username) throw new Error('نام، آدرس و نام کاربری الزامی است');
  return p;
}

route('POST', '/admin/panels/new', async (req, res, ctx) => {
  if (!requireAdmin(ctx)) return;
  try {
    const p = await panelFromForm(req);
    db.prepare('INSERT INTO panels (name, base_url, username, password, api_token, sub_url, default_inbound_id) VALUES (?,?,?,?,?,?,?)')
      .run(p.name, p.base_url, p.username, p.password, p.api_token || null, p.sub_url, p.default_inbound_id);
  } catch (e) { return redirect(res, '/admin/panels?err=' + encodeURIComponent(e.message)); }
  redirect(res, '/admin/panels');
});

route('POST', '/admin/panels/:id', async (req, res, ctx) => {
  if (!requireAdmin(ctx)) return;
  try {
    const p = await panelFromForm(req, { requirePassword: false });
    const base = 'UPDATE panels SET name=?, base_url=?, username=?, api_token=?, sub_url=?, default_inbound_id=?';
    if (p.password) {
      db.prepare(base + ', password=? WHERE id=?')
        .run(p.name, p.base_url, p.username, p.api_token || null, p.sub_url, p.default_inbound_id, p.password, ctx.params.id);
    } else {
      db.prepare(base + ' WHERE id=?')
        .run(p.name, p.base_url, p.username, p.api_token || null, p.sub_url, p.default_inbound_id, ctx.params.id);
    }
  } catch (e) { return redirect(res, '/admin/panels?err=' + encodeURIComponent(e.message)); }
  redirect(res, '/admin/panels');
});

route('POST', '/admin/panels/:id/test', async (req, res, ctx) => {
  if (!requireAdmin(ctx)) return;
  const panel = db.prepare('SELECT * FROM panels WHERE id = ?').get(ctx.params.id);
  if (!panel) return redirect(res, '/admin/panels');
  const client = new SanayiClient({ baseUrl: panel.base_url, username: panel.username, password: panel.password, apiToken: panel.api_token });
  const result = await client.testConnection();
  db.prepare('UPDATE panels SET last_test_ok=?, last_test_at=datetime(\'now\'), last_test_message=? WHERE id=?')
    .run(result.ok ? 1 : 0, result.message + (result.ok && result.inbounds.length ? ` — inboundها: ${result.inbounds.map((i) => `#${i.id} (${i.tag}:${i.port})`).join(', ')}` : ''), panel.id);
  redirect(res, '/admin/panels');
});

route('POST', '/admin/panels/:id/delete', async (req, res, ctx) => {
  if (!requireAdmin(ctx)) return;
  db.prepare('DELETE FROM panels WHERE id = ?').run(ctx.params.id);
  redirect(res, '/admin/panels');
});

// ---- admin: shop settings (card number etc.)
route('GET', '/admin/settings', async (req, res, ctx) => {
  if (!requireAdmin(ctx)) return;
  const body = `
  <h1>تنظیمات فروشگاه</h1>
  <div class="card">
    <form method="post" action="/admin/settings">
      <label>شماره کارت برای واریز کارت به کارت</label>
      <input name="card_number" value="${esc(getSetting('card_number', ''))}" dir="ltr" placeholder="6037-9911-XXXX-XXXX">
      <label>به نامِ صاحب کارت</label>
      <input name="card_holder" value="${esc(getSetting('card_holder', ''))}">
      <label>پیام در صفحه خرید (اختیاری)</label>
      <textarea name="shop_notice">${esc(getSetting('shop_notice', ''))}</textarea>
      <button>ذخیره</button>
    </form>
  </div>`;
  send(res, 200, layout('تنظیمات', body, ctx.user));
});

route('POST', '/admin/settings', async (req, res, ctx) => {
  if (!requireAdmin(ctx)) return;
  const b = new URLSearchParams((await readBody(req)).toString());
  setSetting('card_number', (b.get('card_number') || '').trim());
  setSetting('card_holder', (b.get('card_holder') || '').trim());
  setSetting('shop_notice', (b.get('shop_notice') || '').trim());
  redirect(res, '/admin/settings?ok=1');
});

// ---------------------------------------------------------------- static files
route('GET', '/uploads/:name', async (req, res, ctx) => {
  const name = path.basename(ctx.params.name);
  const file = path.join(UPLOAD_DIR, name);
  if (!fs.existsSync(file)) return send(res, 404, 'not found');
  const ext = path.extname(name).toLowerCase();
  if (!MIME[ext]) return send(res, 403, 'forbidden');
  // receipts are private: only owner or admin may view; files with no
  // matching order (orphans) are never served publicly
  const order = db.prepare('SELECT o.*, u.id AS uid FROM orders o JOIN users u ON u.id = o.user_id WHERE o.receipt_path = ?').get('/uploads/' + name);
  if (!order) return send(res, 404, 'not found');
  if (ctx.user?.role !== 'admin' && ctx.user?.id !== order.uid) {
    return send(res, 403, 'forbidden');
  }
  send(res, 200, fs.readFileSync(file), { 'Content-Type': MIME[ext], 'Cache-Control': 'private, max-age=3600' });
});

route('GET', '/assets/:name', async (req, res, ctx) => {
  const name = path.basename(ctx.params.name);
  const file = path.join(PUBLIC_DIR, name);
  if (!fs.existsSync(file) || !MIME[path.extname(name).toLowerCase()]) return send(res, 404, 'not found');
  send(res, 200, fs.readFileSync(file), { 'Content-Type': MIME[path.extname(name).toLowerCase()] });
});

// ---------------------------------------------------------------- server
const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, 'http://localhost');
    const qs = Object.fromEntries(u.searchParams);
    const ctx = { user: getUser(req), params: {}, query: qs, req, res };

    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = r.rx.exec(u.pathname);
      if (!m) continue;
      r.keys.forEach((k, i) => { ctx.params[k] = decodeURIComponent(m[i + 1]); });
      await r.handler(req, res, ctx);
      return;
    }
    send(res, 404, layout('۴۰۴', '<p>صفحه یافت نشد.</p>', ctx.user));
  } catch (e) {
    console.error('[server]', e);
    try { sendJSON(res, 500, { error: e.message }); } catch { /* headers sent */ }
  }
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`[fatal] port ${PORT} is already in use (tunnel listener or another app?).` +
      ' Change PORT env or free the port, then restart.');
  } else {
    console.error('[fatal] server error:', e);
  }
  process.exit(1);
});

// HOST env is optional: installers behind nginx set HOST=127.0.0.1 so the
// backend is reachable only locally (the public port is nginx's).
const HOST = process.env.HOST || '0.0.0.0';
server.listen(PORT, HOST, () => {
  console.log(`VPN shop listening on ${HOST}:${PORT}`);
});
