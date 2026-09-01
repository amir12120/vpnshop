'use strict';
// Negative-path / edge-case tests against a running shop + mock panel.
// Usage: node test/e2e-negative.js [shopPort] [mockPort]
const SHOP = `http://127.0.0.1:${process.argv[2] || 3000}`;

let failures = 0;
function check(name, cond, extra = '') {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.log(`  ✗ ${name} ${extra}`); }
}

async function form(path, body, cookie) {
  const res = await fetch(SHOP + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...(cookie ? { Cookie: cookie } : {}) },
    body: new URLSearchParams(body),
    redirect: 'manual',
  });
  return { res, cookie: (res.headers.get('set-cookie') || '').split(';')[0] };
}
const get = (path, cookie) => fetch(SHOP + path, { redirect: 'manual', headers: cookie ? { Cookie: cookie } : {} });

(async () => {
  // ---- registration validation
  let r = await form('/register', { username: 'ab', password: 'longenough1' });
  check('register rejects short username', r.res.status === 302 && r.res.headers.get('location').includes('err='));

  r = await form('/register', { username: 'validuser1', password: 'short' });
  check('register rejects short password', r.res.status === 302 && r.res.headers.get('location').includes('err='));

  r = await form('/register', { username: 'validuser1', password: 'goodpass123' });
  const cust = r.cookie;
  check('valid registration works', !!cust);

  r = await form('/register', { username: 'validuser1', password: 'goodpass123' });
  check('duplicate username rejected', r.res.status === 302 && r.res.headers.get('location').includes('err='));

  // ---- login failures
  r = await form('/login', { username: 'validuser1', password: 'wrongpass' });
  check('wrong password rejected', r.res.status === 302 && r.res.headers.get('location').includes('err='));
  check('failed login sets no session', !r.cookie);

  r = await form('/login', { username: 'nosuchuser', password: 'whatever123' });
  check('unknown user rejected', r.res.status === 302 && r.res.headers.get('location').includes('err='));

  // ---- session security
  r = await get('/orders', 'session=1.9999999999999.deadbeef');
  check('forged session rejected (redirect to login)', r.status === 302 && r.headers.get('location') === '/login');

  r = await get('/orders', 'session=garbage');
  check('garbage session rejected', r.status === 302);

  // ---- permission checks
  const admin = (await form('/login', { username: 'admin', password: 'adminpass123' })).cookie;
  r = await get('/admin', cust);
  check('customer blocked from /admin (403)', r.status === 403);
  r = await get('/admin/orders', cust);
  check('customer blocked from /admin/orders (403)', r.status === 403);
  r = await form('/admin/settings', { card_number: 'hax' }, cust);
  check('customer blocked from admin POST (403)', r.res.status === 403);
  r = await get('/admin', undefined);
  check('anonymous /admin redirects to login', r.status === 302 && r.headers.get('location') === '/login');

  // ---- admin can still work
  r = await get('/admin', admin);
  check('admin panel loads for admin', r.status === 200);

  // ---- anonymous buy redirect
  r = await get('/buy/1');
  check('anonymous /buy redirects to login', r.status === 302 && r.headers.get('location') === '/login');

  // ---- 404s
  r = await get('/no/such/page');
  check('unknown page -> 404', r.status === 404);
  r = await get('/uploads/../../server.js');
  check('path traversal in /uploads blocked', r.status === 404 || r.status === 403);
  r = await get('/uploads/nonexistent.png');
  check('unknown receipt -> 404', r.status === 404);

  // ---- orphan receipt file (uploaded file with no order row) must not be public
  //     (upload dir may contain leftovers; any /uploads/*.png without an order must 403/404)
  const orphan = await get('/uploads/receipt_orphan_test.png');
  check('orphan/unknown receipt not served publicly', orphan.status === 403 || orphan.status === 404);

  // ---- buy with plan id that doesn't exist
  r = await get('/buy/9999', cust);
  check('buy with invalid plan -> 404', r.status === 404);

  // ---- multipart without file
  {
    const boundary = '----neg' + Date.now();
    const res = await fetch(SHOP + '/buy/1', {
      method: 'POST',
      headers: { Cookie: cust, 'Content-Type': `multipart/form-data; boundary=${boundary}` },
      body: `--${boundary}\r\nContent-Disposition: form-data; name="note"\r\n\r\nno file\r\n--${boundary}--\r\n`,
      redirect: 'manual',
    });
    check('order without receipt rejected (redirect with error)', res.status === 302 && res.headers.get('location').includes('err='));
  }

  // ---- non-image upload rejected
  {
    const boundary = '----neg' + Date.now();
    const body = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="note"', '', 'x', '',
      `--${boundary}`,
      'Content-Disposition: form-data; name="receipt"; filename="evil.html"',
      'Content-Type: text/html', '', '<script>alert(1)</script>', '',
      `--${boundary}--`, '',
    ].join('\r\n');
    const res = await fetch(SHOP + '/buy/1', {
      method: 'POST',
      headers: { Cookie: cust, 'Content-Type': `multipart/form-data; boundary=${boundary}` },
      body,
      redirect: 'manual',
    });
    check('non-image upload rejected', res.status === 302 && res.headers.get('location').includes('err='));
  }

  // ---- body size limit (17MB POST -> server destroys the socket)
  {
    let rejected = false;
    try {
      const res = await fetch(SHOP + '/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'username=x&password=' + 'a'.repeat(17 * 1024 * 1024),
      });
      rejected = res.status >= 400;   // or any 4xx/5xx error response
    } catch { rejected = true; }      // connection reset = also fine
    check('oversized body rejected', rejected);
  }

  // ---- malformed panel URL doesn't crash the server
  {
    await form('/admin/panels/new', { name: 'bad', base_url: '::::not-a-url::::', username: 'u', password: 'p' }, admin);
    const panels = await (await get('/admin/panels', admin)).text();
    check('server survives invalid panel URL', panels.includes('پنل‌های سنایی'));
    // clean it up: find its id and delete
    const m = panels.match(/\/admin\/panels\/(\d+)\/delete(?![\s\S]*\/admin\/panels\/\d+\/delete)/);
    if (m) await form(`/admin/panels/${m[1]}/delete`, {}, admin);
  }

  // ---- panel test with wrong credentials reports failure, server stays up
  {
    await form('/admin/panels/new', { name: 'wrongcreds', base_url: `http://127.0.0.1:${process.argv[3] || 2053}`, username: 'admin', password: 'WRONG', default_inbound_id: '1' }, admin);
    const panels = await (await get('/admin/panels', admin)).text();
    const id = (panels.match(/\/admin\/panels\/(\d+)\/test(?![\s\S]*\/admin\/panels\/\d+\/test)/) || [])[1];
    if (id) {
      await form(`/admin/panels/${id}/test`, {}, admin);
      const after = await (await get('/admin/panels', admin)).text();
      check('wrong panel creds -> test reports failure', /login failed/.test(after));
      await form(`/admin/panels/${id}/delete`, {}, admin);
    } else {
      check('wrong-creds panel created for test', false);
    }
  }

  // ---- server still healthy after all abuse
  const home = await get('/');
  check('server still healthy at the end', home.status === 200);

  console.log(failures === 0 ? '\nALL NEGATIVE TESTS PASSED ✅' : `\n${failures} NEGATIVE TEST(S) FAILED ❌`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error('crash:', e); process.exit(1); });
