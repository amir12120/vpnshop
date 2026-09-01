'use strict';
// End-to-end test against a running shop (server.js) + mock panel.
// Usage: node test/e2e.js [shopPort] [mockPort]
const fs = require('fs');
const path = require('path');

const SHOP = `http://127.0.0.1:${process.argv[2] || 3000}`;
const MOCK_PORT = process.argv[3] || 2053;

let failures = 0;
function check(name, cond, extra = '') {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.log(`  ✗ ${name} ${extra}`); }
}

function cookieFrom(res) {
  const sc = res.headers.get('set-cookie') || '';
  return sc.split(';')[0];
}

async function api(path, { method = 'GET', body, cookie, form } = {}) {
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  let payload;
  if (form) {
    payload = form;
  } else if (body) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(SHOP + path, { method, headers, body: payload, redirect: 'manual' });
  return { res, cookie: cookieFrom(res) };
}

async function multipart(path, cookie, fields, file) {
  const boundary = '----testboundary' + Date.now();
  const parts = [];
  for (const [k, v] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }
  if (file) {
    parts.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${file.field}"; filename="receipt.png"\r\nContent-Type: image/png\r\n\r\n`));
    parts.push(file.buf);
    parts.push(Buffer.from('\r\n'));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  const res = await fetch(SHOP + path, {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': `multipart/form-data; boundary=${boundary}` },
    body: Buffer.concat(parts),
    redirect: 'manual',
  });
  return res;
}

(async () => {
  const png = Buffer.from(
    '89504e470d0a1a0a0000000d4948445200000001000000010806000000' +
    '1f15c4890000000d4944415478da63fcffff3f030005fe02fea72d1e' +
    '0000000049454e44ae426082', 'hex');

  console.log('— health');
  const home = await fetch(SHOP + '/');
  check('GET / returns 200', home.status === 200);
  check('homepage lists no plans yet', !(await home.text()).includes('خرید (کارت به کارت)'));

  console.log('— admin bootstrap (created by test setup)');
  // admin is created via seed-admin.js before running this test
  let r = await api('/login', { method: 'POST', form: new URLSearchParams({ username: 'admin', password: 'adminpass123' }) });
  const adminCookie = r.cookie;
  check('admin login', adminCookie && r.res.status === 302);

  console.log('— admin: connect mock panel + test');
  r = await api('/admin/panels/new', {
    method: 'POST', cookie: adminCookie,
    form: new URLSearchParams({
      name: 'mock', base_url: `http://127.0.0.1:${MOCK_PORT}`,
      username: 'admin', password: 'panel123', default_inbound_id: '1',
    }),
  });
  check('panel added', r.res.status === 302);
  // find panel id
  const panelsPage = await (await api('/admin/panels', { cookie: adminCookie })).res.text();
  const panelId = (panelsPage.match(/\/admin\/panels\/(\d+)\/test/) || [])[1];
  check('panel listed with test button', !!panelId);
  r = await api(`/admin/panels/${panelId}/test`, { method: 'POST', cookie: adminCookie });
  const afterTest = await (await api('/admin/panels', { cookie: adminCookie })).res.text();
  check('connection test OK shown', afterTest.includes('connected, 1 inbound'));

  console.log('— admin: create plan + card number');
  await api('/admin/plans/new', {
    method: 'POST', cookie: adminCookie,
    form: new URLSearchParams({ name: '۱۰ گیگ یک‌ماهه', volume_gb: '10', duration_days: '30', price_toman: '150000', device_limit: '2' }),
  });
  const home2 = await (await api('/')).res.text();
  check('plan visible on homepage', home2.includes('۱۰ گیگ یک‌ماهه'));
  const planId = (home2.match(/\/buy\/(\d+)/) || [])[1];
  check('buy link present', !!planId);
  await api('/admin/settings', {
    method: 'POST', cookie: adminCookie,
    form: new URLSearchParams({ card_number: '6037-9911-1234-5678', card_holder: 'تست فروشگاه', shop_notice: '' }),
  });

  console.log('— customer: register → buy → upload receipt');
  r = await api('/register', { method: 'POST', form: new URLSearchParams({ username: 'cust1', password: 'custpass123' }) });
  const custCookie = r.cookie;
  check('customer registered & logged in', !!custCookie);

  const buyPage = await (await api(`/buy/${planId}`, { cookie: custCookie })).res.text();
  check('buy page shows card number', buyPage.includes('6037-9911-1234-5678'));

  r = await multipart(`/buy/${planId}`, custCookie, { note: 'کارت ۴۲۴۲' }, { field: 'receipt', buf: png });
  check('receipt upload accepted', r.status === 302);

  const ordersPage = await (await api('/orders', { cookie: custCookie })).res.text();
  check('order shows awaiting_review', ordersPage.includes('در انتظار تأیید مدیر'));
  check('order not delivered yet', !ordersPage.includes('لینک اشتراک'));

  console.log('— admin: approve → auto-provision → delivery');
  const adminOrders = await (await api('/admin/orders', { cookie: adminCookie })).res.text();
  const orderId = (adminOrders.match(/\/admin\/orders\/(\d+)\/approve/) || [])[1];
  check('approve form rendered', !!orderId);
  const receiptVisible = adminOrders.includes('data:image/png') || adminOrders.includes('/uploads/receipt_');
  check('receipt image shown to admin', receiptVisible);

  r = await api(`/admin/orders/${orderId}/approve`, {
    method: 'POST', cookie: adminCookie,
    form: new URLSearchParams({ panel_id: panelId, inbound_id: '1' }),
  });
  check('approve POST ok', r.res.status === 302);

  const custOrders2 = await (await api('/orders', { cookie: custCookie })).res.text();
  check('order delivered', custOrders2.includes('تحویل شده'));
  check('QR code rendered', custOrders2.includes('data:image/png;base64,'));
  check('subscription link shown', /http:\/\/127\.0\.0\.1:\d+\/sub\/u\d+o\d+/.test(custOrders2));
  check('config link (vless) shown', custOrders2.includes('vless://'));

  console.log('— security: private receipt');
  const receiptPath = (custOrders2.match(/\/uploads\/receipt_[a-z0-9_]+\.png/) || adminOrders.match(/\/uploads\/receipt_[a-z0-9_]+\.png/) || [])[0];
  if (receiptPath) {
    const stranger = await fetch(SHOP + receiptPath);
    check('receipt blocked for strangers (403)', stranger.status === 403);
    const adminView = await fetch(SHOP + receiptPath, { headers: { Cookie: adminCookie } });
    check('receipt visible to admin (200)', adminView.status === 200);
  } else {
    check('receipt path found', false);
  }

  console.log(failures === 0 ? '\nALL TESTS PASSED ✅' : `\n${failures} TEST(S) FAILED ❌`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error('test crash:', e); process.exit(1); });
