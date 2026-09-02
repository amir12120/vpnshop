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

// Customer's chosen config username → client email on the Sanayi panel.
// 3x-ui forbids spaces, '/', '\' and control chars in emails. Empty input
// (or input that sanitizes to nothing) means "auto-generate".
function sanitizeClientName(s) {
  let v = String(s || '').trim().replace(/[\s/\\\x00-\x1f\x7f]/g, '');
  v = v.replace(/^[^a-zA-Z0-9]+/, '');
  return v.slice(0, 60);
}

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
:root{
  --bg:#0b0f1a;--card:#141b2e;--card2:#1a2340;--line:#26304e;
  --txt:#e9eefb;--mut:#8b98b8;--acc:#4f8cff;--acc2:#7c5cff;--cyan:#35d0d0;
  --ok:#2ecc71;--bad:#ff5c5c;--gold:#f5b942;
  --grad:linear-gradient(120deg,#4f8cff,#7c5cff 55%,#35d0d0);
}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
body{margin:0;font-family:Vazirmatn,Tahoma,'Segoe UI',sans-serif;background:
  radial-gradient(1200px 500px at 85% -100px,rgba(79,140,255,.14),transparent 60%),
  radial-gradient(900px 420px at 0% 0%,rgba(124,92,255,.12),transparent 55%),
  var(--bg);color:var(--txt);font-size:14.5px;line-height:1.7;min-height:100vh}
a{color:var(--acc);text-decoration:none}
.wrap{max-width:1060px;margin:0 auto;padding:0 18px}
header.top{position:sticky;top:0;z-index:50;background:rgba(11,15,26,.8);backdrop-filter:blur(12px);border-bottom:1px solid var(--line)}
.nav{display:flex;align-items:center;justify-content:space-between;padding:12px 18px}
.brand{font-size:18px;font-weight:800;letter-spacing:.3px}
.brand span{background:var(--grad);-webkit-background-clip:text;background-clip:text;color:transparent}
header nav a{margin-inline-start:18px;color:var(--txt);font-weight:600;font-size:13.5px;transition:color .15s}
header nav a:hover{color:var(--acc)}
main{max-width:1060px;margin:26px auto 40px;padding:0 18px}
h1{font-size:26px;margin:0 0 16px}h2{font-size:19px;margin:0 0 12px}h3{font-size:15px;margin:0 0 6px}
.hero{text-align:center;padding:42px 0 24px}
.hero h1{font-size:33px;line-height:1.45;font-weight:900}
.hero .grad{background:var(--grad);-webkit-background-clip:text;background-clip:text;color:transparent}
.hero p{color:var(--mut);max-width:660px;margin:10px auto 20px;font-size:15px}
.chips{display:flex;gap:10px;justify-content:center;flex-wrap:wrap}
.chips span{background:var(--card);border:1px solid var(--line);border-radius:30px;padding:6px 14px;font-size:13px;color:var(--mut)}
.card{background:linear-gradient(180deg,var(--card2),var(--card));border:1px solid var(--line);border-radius:14px;padding:20px;margin-bottom:16px;transition:transform .18s ease,border-color .18s ease,box-shadow .18s ease}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px}
.features{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:16px;margin:8px 0 26px}
.ic{width:46px;height:46px;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:22px;background:linear-gradient(135deg,rgba(79,140,255,.22),rgba(124,92,255,.22));border:1px solid var(--line);margin-bottom:12px}
.features .card p{color:var(--mut);font-size:13px;margin:0}
.plan{position:relative;display:flex;flex-direction:column;padding:24px 20px}
.plan:hover{transform:translateY(-4px);border-color:#3b4a7a;box-shadow:0 14px 34px rgba(0,0,0,.45)}
.plan.popular{border-color:rgba(245,185,66,.55)}
.plan.popular::before{content:'پرفروش';position:absolute;top:-11px;inset-inline-start:16px;background:var(--gold);color:#241a02;font-size:11px;font-weight:800;border-radius:20px;padding:2px 12px}
.p-ic{width:52px;height:52px;border-radius:14px;display:flex;align-items:center;justify-content:center;font-size:26px;background:linear-gradient(135deg,#1c2947,#232048);border:1px solid var(--line);margin-bottom:14px}
.p-feats{margin:8px 0 4px;color:var(--mut);font-size:13.5px}
.p-feats div{padding:3px 0}
.p-feats b{color:var(--txt)}
.price{margin:12px 0 16px;font-size:24px;font-weight:900;background:var(--grad);-webkit-background-clip:text;background-clip:text;color:transparent}
.steps .card{text-align:center;padding:22px 14px}
.steps .n{width:38px;height:38px;margin:0 auto 10px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:800;background:var(--grad);color:#fff}
.steps .card p{color:var(--mut);font-size:13px;margin:0}
button,.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:10px 20px;background:var(--grad);color:#fff;border:0;border-radius:10px;cursor:pointer;font-family:inherit;font-size:14px;font-weight:700;transition:filter .15s,transform .1s}
button:hover,.btn:hover{filter:brightness(1.12)}
button:active,.btn:active{transform:scale(.98)}
.btn.sm{padding:7px 14px;font-size:12.5px;border-radius:8px}
.btn.ghost{background:transparent;border:1px solid var(--line);color:var(--txt)}
.btn.buy{width:100%;margin-top:auto}
.btn.secondary{background:transparent;border:1px solid var(--line);color:var(--txt)}
.btn.ok{background:linear-gradient(120deg,#1f9d55,#2ecc71)}
.btn.bad{background:linear-gradient(120deg,#d64545,#ff5c5c)}
input,select,textarea{width:100%;padding:11px 13px;background:#0d1322;border:1px solid var(--line);border-radius:10px;color:var(--txt);font-family:inherit;font-size:14px;margin:5px 0 14px;outline:none;transition:border-color .15s}
input:focus,select:focus,textarea:focus{border-color:var(--acc)}
label{color:var(--mut);font-size:12.5px;display:block;font-weight:600}
table{width:100%;border-collapse:collapse}
th,td{padding:10px 12px;border-bottom:1px solid var(--line);text-align:right;font-size:13.5px}
th{color:var(--mut);font-weight:600;font-size:12.5px}
tr:hover td{background:rgba(79,140,255,.05)}
.badge{padding:4px 12px;border-radius:30px;font-size:12px;font-weight:700;white-space:nowrap}
.b-pending_payment,.b-awaiting_review{background:#3a3320;color:#f5c542}
.b-provisioning{background:#23395f;color:#7db2ff}
.b-approved,.b-delivered{background:#14432a;color:#45e08a}
.b-rejected,.b-failed{background:#4a1f22;color:#ff8a8a}
.msg{padding:12px 16px;border-radius:10px;margin-bottom:16px;font-size:13.5px;border:1px solid transparent}
.msg.ok{background:rgba(46,204,113,.12);border-color:rgba(46,204,113,.35);color:#8fe8b8}
.msg.err{background:rgba(255,92,92,.12);border-color:rgba(255,92,92,.35);color:#ffb3b3}
.mut{color:var(--mut);font-size:12.5px}
code,.mono{direction:ltr;text-align:left;font-family:'Cascadia Code',Consolas,monospace;font-size:12.5px;word-break:break-all;background:#0b111f;padding:9px 12px;border-radius:8px;display:block;border:1px solid var(--line);margin:4px 0 10px}
img.qr{background:#fff;padding:8px;border-radius:10px}
.row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
footer.foot{border-top:1px solid var(--line);padding:22px 0 30px;margin-top:40px;text-align:center;color:var(--mut);font-size:12.5px}
@media(max-width:640px){.hero h1{font-size:25px}.nav{flex-direction:column;gap:10px}}
</style>
</head>
<body>
<header class="top">
  <div class="wrap nav">
    <a class="brand" href="/">🛒 VPN<span>Shop</span></a>
    <nav>
      ${user ? `<a href="/">پلن‌ها</a><a href="/orders">سفارش‌های من</a>${user.role === 'admin' ? '<a href="/admin">پنل مدیریت</a>' : ''}<a href="/logout" class="btn ghost sm">خروج (${esc(user.username)})</a>` : `<a href="/login">ورود</a><a href="/register" class="btn sm">عضویت</a>`}
    </nav>
  </div>
</header>
<main>${body}</main>
<footer class="foot"><div class="wrap">🛒 فروشگاه VPN — پرداخت کارت به کارت · تحویل خودکار کانفیگ و لینک اشتراک</div></footer>
</body></html>`;

// ---------------------------------------------------------------- PUBLIC: plans & register/login
route('GET', '/', async (req, res, { user }) => {
  const plans = db.prepare('SELECT * FROM plans WHERE active = 1 ORDER BY sort, id').all();
  const body = `
  <section class="hero">
    <h1>اینترنت پرسرعت، <span class="grad">فقط با چند کلیک</span></h1>
    <p>خرید آنلاین کانفیگ VPN با پرداخت کارت به کارت؛ فیش واریزی را بارگذاری کنید و پس از تأیید مدیر، کانفیگ همراه با QR و لینک اشتراک تحویل بگیرید.</p>
    <div class="chips"><span>⚡ تحویل خودکار</span><span>🛡 امن و پایدار</span><span>📱 همه دستگاه‌ها</span><span>💳 کارت به کارت</span></div>
  </section>

  <section class="features">
    <div class="card"><div class="ic">💳</div><h3>پرداخت کارت به کارت</h3><p>مبلغ بسته را به کارت فروشگاه واریز و تصویر فیش را در سایت بارگذاری کنید.</p></div>
    <div class="card"><div class="ic">⚡</div><h3>تحویل خودکار</h3><p>بعد از تأیید مدیر، کاربر روی پنل سنایی ساخته و کانفیگ به‌صورت خودکار تحویل می‌شود.</p></div>
    <div class="card"><div class="ic">📲</div><h3>QR و لینک اشتراک</h3><p>با اسکن QR یا لینک اشتراک، روی هر اپ و هر دستگاهی وصل شوید.</p></div>
  </section>

  <section class="plans">
    <h2>بسته‌های اینترنتی</h2>
    <div class="grid">
    ${plans.map((p, idx) => `
      <div class="card plan${idx === 1 ? ' popular' : ''}">
        <div class="p-ic">📶</div>
        <h2>${esc(p.name)}</h2>
        <div class="p-feats">
          <div>حجم: <b>${p.volume_gb == null ? 'نامحدود' : p.volume_gb + ' گیگابایت'}</b></div>
          <div>زمان: <b>${p.duration_days == null ? 'نامحدود' : p.duration_days + ' روز'}</b></div>
          <div>تعداد دستگاه: <b>${p.device_limit ?? 2}</b></div>
        </div>
        <div class="price">${fmtToman(p.price_toman)} تومان</div>
        <a class="btn buy" href="/buy/${p.id}">خرید (کارت به کارت)</a>
      </div>`).join('') || '<p class="mut">هنوز پلنی تعریف نشده است — به‌زودی.</p>'}
    </div>
  </section>

  <section class="steps">
    <h2>نحوه خرید</h2>
    <div class="grid">
      <div class="card"><div class="n">۱</div><h3>انتخاب بسته</h3><p>بسته متناسب با حجم و زمان دلخواه را انتخاب کنید.</p></div>
      <div class="card"><div class="n">۲</div><h3>واریز و ارسال فیش</h3><p>مبلغ را کارت به کارت کنید و تصویر فیش را در سایت بارگذاری کنید.</p></div>
      <div class="card"><div class="n">۳</div><h3>تأیید مدیر</h3><p>پس از بررسی فیش، سفارش شما تأیید و کانفیگ ساخته می‌شود.</p></div>
      <div class="card"><div class="n">۴</div><h3>تحویل کانفیگ</h3><p>QR، لینک اشتراک و لینک کانفیگ‌ها را دریافت و وصل شوید.</p></div>
    </div>
  </section>`;
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
      <label>نام کاربری دلخواه برای کانفیگ (اختیاری — مثلاً alireza یا alireza@mail.com)</label>
      <input name="client_name" placeholder="اگر خالی بگذارید، خودکار ساخته می‌شود">
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

  let receiptPath = null, note = '', clientName = '';
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
    } else if (fieldName === 'client_name') {
      clientName = Buffer.from(content.replace(/\r\n$/, ''), 'binary').toString('utf8');
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

  const cleanName = sanitizeClientName(clientName);
  db.prepare(`INSERT INTO orders (user_id, plan_id, status, receipt_path, receipt_note, client_name)
              VALUES (?, ?, 'awaiting_review', ?, ?, ?)`).run(user.id, plan.id, receiptPath, note.trim() || null, cleanName || null);
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
      <div class="mut">نام کاربری کانفیگ: <b dir="ltr">${esc((o.sub_url || '').split('/').pop())}</b></div>
      <label style="margin-top:10px">لینک اشتراک (برای اپ‌های V2rayNG / Streisand / ...)</label>
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
  ${query.err ? `<div class="msg err">⚠ ${esc(query.err)}</div>` : ''}
  ${query.ok ? `<div class="msg ok">✓ ${esc(query.ok)}</div>` : ''}
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
    ${o.client_name ? `<div class="mut">نام کاربری دلخواه کانفیگ: <b dir="ltr">${esc(o.client_name)}</b></div>` : ''}
    ${o.admin_note ? `<div class="msg ${o.status === 'rejected' ? 'err' : 'err'}" style="margin:8px 0 0">${esc(o.admin_note)}</div>` : ''}
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
        <label>Inboundها (با ویرگول جدا کنید؛ خالی = پیش‌فرض پنل/پلن)</label>
        <input name="inbound_ids" placeholder="مثلاً 1,2,3 — چند اینباند مجاز است">
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

// resolve inbound ids: form value (comma/space separated) > plan default > panel default
function resolveInboundIds(raw, plan, panel) {
  const parse = (s) => String(s || '').split(/[,،\s]+/).map(Number).filter(Boolean);
  const fromRaw = parse(raw);
  if (fromRaw.length) return fromRaw;
  if (plan && parse(plan.inbound_id).length) return parse(plan.inbound_id);
  if (panel && panel.default_inbound_id) return [Number(panel.default_inbound_id)];
  return [];
}

// create client on Sanayi panel + store delivery (one or more inbounds)
async function provisionOrder(order, panelId, inboundIdsRaw) {
  const panel = db.prepare('SELECT * FROM panels WHERE id = ?').get(panelId);
  if (!panel) throw new Error('پنل انتخاب نشده است');
  const plan = db.prepare('SELECT * FROM plans WHERE id = ?').get(order.plan_id);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(order.user_id);
  const inbounds = resolveInboundIds(inboundIdsRaw, plan, panel);
  if (!inbounds.length) throw new Error('Inbound مشخص نشده است (در فرم بنویسید، مثلاً 1,2,3)');

  const client = new SanayiClient({ baseUrl: panel.base_url, username: panel.username, password: panel.password, apiToken: panel.api_token, subUrl: panel.sub_url });
  // Customer's chosen username is preferred; if the panel says it's taken we
  // retry with a suffix (ali → ali_2 → ali_3...) so delivery always succeeds.
  let email = order.client_name || '';
  if (!email) email = `u${user.id}o${order.id}_${randomToken(4)}`;
  const baseEmail = email;
  const uuid = crypto.randomUUID();
  const totalGB = plan.volume_gb == null ? 0 : Math.round(plan.volume_gb * 1024 * 1024 * 1024);
  const expiryTime = plan.duration_days == null ? 0 : Date.now() + plan.duration_days * 24 * 3600 * 1000;

  for (let attempt = 1; ; attempt++) {
    try {
      await client.addClient({ inboundIds: inbounds, email, uuid, totalGB, expiryTime, limitIp: plan.device_limit ?? 2 });
      break; // client created
    } catch (e) {
      const taken = /already in use|already exists|duplicate/i.test(e.message || '');
      if (!taken || attempt >= 5 || order.client_name == null) throw e;
      email = `${baseEmail}_${attempt + 1}`; // ali → ali_2
    }
  }
  const links = await client.getClientLinks({ inboundIds: inbounds, email });

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
    await provisionOrder(order, b.get('panel_id'), b.get('inbound_ids'));
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
