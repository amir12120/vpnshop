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
      api_token: 'mock-api-token-123', sub_url: `http://127.0.0.1:${MOCK_PORT}/sub`,
      default_inbound_id: '1',
    }),
  });
  check('panel added', r.res.status === 302);
  // find panel id
  const panelsPage = await (await api('/admin/panels', { cookie: adminCookie })).res.text();
  const panelId = (panelsPage.match(/\/admin\/panels\/(\d+)\/test/) || [])[1];
  check('panel listed with test button', !!panelId);
  r = await api(`/admin/panels/${panelId}/test`, { method: 'POST', cookie: adminCookie });
  const afterTest = await (await api('/admin/panels', { cookie: adminCookie })).res.text();
  check('connection test OK shown', /connected, \d+ inbound/.test(afterTest));

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

  r = await multipart(`/buy/${planId}`, custCookie, { note: 'کارت ۴۲۴۲', client_name: 'alireza' }, { field: 'receipt', buf: png });
  check('receipt upload accepted', r.status === 302);

  const ordersPage = await (await api('/orders', { cookie: custCookie })).res.text();
  check('order shows awaiting_review', ordersPage.includes('در انتظار تأیید مدیر'));
  check('order not delivered yet', !ordersPage.includes('لینک اشتراک (برای'));
  const custOrderId = (ordersPage.match(/سفارش #(\d+)/) || [])[1];
  check('customer order id found', !!custOrderId);

  console.log('— customer: clean plans page');
  const plansPage = await (await api('/plans')).res.text();
  check('/plans lists plan cards', plansPage.includes('۱۰ گیگ یک‌ماهه'));
  check('/plans shows no hero header', !plansPage.includes('اینترنت پرسرعت'));

  console.log('— admin: new-order polling API');
  const poll0 = JSON.parse(await (await api('/api/admin/orders/new?after=0', { cookie: adminCookie })).res.text());
  check('poll API lists the new order', poll0.orders.some((o) => o.id === Number(custOrderId)));
  check('poll API reports awaiting count', poll0.awaiting >= 1);
  const pollAnon = await api('/api/admin/orders/new?after=0');
  check('poll API requires admin login', pollAnon.res.status === 302);

  console.log('— admin: approve → auto-provision → delivery');
  const adminOrders = await (await api('/admin/orders', { cookie: adminCookie })).res.text();
  const orderId = (adminOrders.match(/\/admin\/orders\/(\d+)\/approve/) || [])[1];
  check('approve form rendered', !!orderId);
  check('requested client name shown to admin', adminOrders.includes('alireza'));
  const receiptVisible = adminOrders.includes('data:image/png') || adminOrders.includes('/uploads/receipt_');
  check('receipt image shown to admin', receiptVisible);

  const allIb = JSON.parse(await (await api(`/admin/panels/${panelId}/inbounds`, { cookie: adminCookie })).res.text());
  check('all-inbounds API returns every mock inbound', allIb.ok && allIb.ids.length === 2);

  r = await api(`/admin/orders/${orderId}/approve`, {
    method: 'POST', cookie: adminCookie,
    form: new URLSearchParams({ panel_id: panelId, inbound_ids: '1, 2' }),
  });
  check('approve POST ok', r.res.status === 302);

  const custOrders2 = await (await api('/orders', { cookie: custCookie })).res.text();
  check('order delivered', custOrders2.includes('تحویل شده'));
  check('QR code rendered', custOrders2.includes('data:image/png;base64,'));
  check('account email shown on delivery page', custOrders2.includes('alireza') && custOrders2.includes('نام اکانت کانفیگ'));
  check('subscription path is random (not the username)', !custOrders2.includes('/sub/alireza') && /\/sub\/[0-9a-f]{20}/.test(custOrders2));
  check('subscription link shown', /http:\/\/127\.0\.0\.1:\d+\/sub\/[A-Za-z0-9_@.-]+/.test(custOrders2));
  check('config link (vless) shown', custOrders2.includes('vless://'));
  check('per-link copy buttons rendered', custOrders2.includes('vpnCopyEl'));
  check('one config link per chosen inbound (2 links)', (custOrders2.match(/id="cfg_\d+_\d+"/g) || []).length === 2);
  check('copy-all button rendered', custOrders2.includes('کپی همه لینک‌ها'));
  const poll1 = JSON.parse(await (await api('/api/admin/orders/new?after=' + custOrderId, { cookie: adminCookie })).res.text());
  check('no new orders after approval', poll1.orders.length === 0 && poll1.awaiting === 0);

  console.log('— customer: dashboard + usage charts');
  const anonDash = await api('/dashboard');
  check('dashboard redirects anonymous (302)', anonDash.res.status === 302);
  const dash = await (await api('/dashboard', { cookie: custCookie })).res.text();
  check('dashboard renders (200 + title)', dash.includes('داشبورد مصرف'));
  check('sidebar with all sections', dash.includes('href="/dashboard"') && dash.includes('href="/orders"') &&
    dash.includes('href="/plans"') && dash.includes('href="/account"') && dash.includes('خروج از حساب'));
  check('dashboard is the active sidebar item', /class="snav on" href="\/dashboard"/.test(dash));
  check('config count stat = 1', dash.includes('id="vCfg">۱</div>'));
  check('purchased volume shows 10 گیگ', dash.includes('۱۰ گیگ'));
  check('config row lists the account email', dash.includes('alireza'));

  const anonApi = await api('/api/user/dashboard?mode=day&live=1');
  check('live API requires login (401)', anonApi.res.status === 401);
  const dJson = JSON.parse(await (await api('/api/user/dashboard?mode=day&live=1', { cookie: custCookie })).res.text());
  check('live API ok + one config', dJson.ok && dJson.stats.configs === 1);
  check('live row quota equals 10 GiB', dJson.rows.length === 1 && dJson.rows[0].quotaB === 10 * 1073741824);
  check('meter sampled usage from the panel', dJson.stats.usedB > 0 && dJson.stats.lastSampleTs > 0);
  check('daily chart has 30 buckets', dJson.chart.points.length === 30 && dJson.chart.mode === 'day');
  const hJson = JSON.parse(await (await api('/api/user/usage?mode=hour', { cookie: custCookie })).res.text());
  check('hourly chart has 24 buckets', hJson.ok && hJson.chart.points.length === 24);
  const mJson = JSON.parse(await (await api('/api/user/usage?mode=month', { cookie: custCookie })).res.text());
  check('monthly chart has 12 calendar buckets', mJson.ok && mJson.chart.points.length === 12);
  const mLabels = (mJson.chart.points || []).map((p) => p.label);
  check('monthly labels are unique (no duplicated month)', new Set(mLabels).size === mLabels.length);

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
