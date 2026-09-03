'use strict';
// Mock Sanayi (3x-ui) panel for testing the shop without a real panel.
// v2 API:  POST /login (cookie), GET /panel/api/inbounds/list, POST /panel/api/inbounds/addClient
// v3 API:  Authorization: Bearer <apiToken>, POST /panel/api/clients/add (JSON),
//          GET /panel/api/clients/subLinks/:subId, GET /panel/api/clients/links/:email
const http = require('http');

const API_TOKEN = 'mock-api-token-123';
const clientsBySub = {};   // subId -> { email, uuid }

function freshInbound(id, port, remark) {
  return {
    id, port, protocol: 'vless', remark,
    listen: '', // '' = all interfaces
    settings: JSON.stringify({ clients: [] }),
    streamSettings: JSON.stringify({
      network: 'ws', security: 'tls',
      wsSettings: { path: '/wspath', settings: { headers: { Host: 'panel.example.com' } } },
      tlsSettings: { serverName: 'panel.example.com', settings: { allowInsecure: false } },
    }),
  };
}
const INBOUNDS = [freshInbound(1, 443, 'main-inbound'), freshInbound(2, 8443, 'second-inbound')];

const sessions = new Set();   // sid -> { csrf }  (v3 requires CSRF on POSTs)
const sessionMeta = new Map();
let csrfCounter = 0;
function newCsrf() { return 'csrf-token-' + (++csrfCounter); }

// POST endpoints require X-CSRF-Token unless authenticated via Bearer token
function csrfOk(req, sid) {
  if (req.headers.authorization === `Bearer ${API_TOKEN}`) return true;
  const meta = sessionMeta.get(sid);
  if (!meta || !meta.csrf) return false;
  return req.headers['x-csrf-token'] === meta.csrf;
}

function authed(req) {
  if (req.headers.authorization === `Bearer ${API_TOKEN}`) return true;
  return [...sessions].some((s) => (req.headers.cookie || '').includes(s));
}
function sendJSON(res, code, obj) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(obj));
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://localhost');
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const params = new URLSearchParams(body);
    let jbody = null;
    try { jbody = JSON.parse(body); } catch { /* ignore */ }

    if (u.pathname === '/csrf-token' && req.method === 'GET') {
      const sid = 'mocksession' + Math.random().toString(16).slice(2);
      sessions.add(sid);
      const csrf = newCsrf();
      sessionMeta.set(sid, { csrf });
      res.setHeader('Set-Cookie', `3x-ui=${sid}; Path=/`);
      return res.end(JSON.stringify({ success: true, msg: '', obj: csrf }));
    }

    if (u.pathname === '/login' && req.method === 'POST') {
      const sid = [...sessionMeta.keys()].find((s) => (req.headers.cookie || '').includes(s));
      if (!sid || !csrfOk(req, sid)) {
        return sendJSON(res, 403, { success: false, msg: 'csrf token required' });
      }
      if (params.get('username') === 'admin' && params.get('password') === 'panel123') {
        return res.end(JSON.stringify({ success: true, msg: 'login ok', obj: null }));
      }
      return sendJSON(res, 401, { success: false, msg: 'bad credentials' });
    }

    const sid = [...sessionMeta.keys()].find((s) => (req.headers.cookie || '').includes(s));
    if (!authed(req)) {
      return sendJSON(res, 401, { success: false, msg: 'unauthorized' });
    }
    if (req.method !== 'GET' && req.method !== 'HEAD' && !csrfOk(req, sid)) {
      return sendJSON(res, 403, { success: false, msg: 'csrf token required' });
    }

    // ---------- v3 ----------
    if (u.pathname === '/panel/api/clients/add' && req.method === 'POST') {
      const { client, inboundIds = [] } = jbody || {};
      if (!client || !inboundIds.length) {
        return sendJSON(res, 400, { success: false, msg: 'client/inboundIds required' });
      }
      const c = { ...client };
      clientsBySub[c.subId || c.email] = c;
      for (const id of inboundIds) {
        const ib = INBOUNDS.find((x) => x.id === id);
        if (!ib) return sendJSON(res, 404, { success: false, msg: `inbound ${id} not found` });
        ib.settings = JSON.stringify({
          clients: [...JSON.parse(ib.settings).clients, c],
        });
      }
      return sendJSON(res, 200, { success: true, msg: 'client added', obj: null });
    }
    if (u.pathname.startsWith('/panel/api/clients/subLinks/')) {
      const subId = decodeURIComponent(u.pathname.split('/').pop());
      const c = clientsBySub[subId];
      if (!c) return sendJSON(res, 404, { success: false, msg: 'not found' });
      return sendJSON(res, 200, { success: true, msg: '', obj: [`http://127.0.0.1:2053/sub/${subId}`] });
    }
    if (u.pathname.startsWith('/panel/api/clients/links/')) {
      const email = decodeURIComponent(u.pathname.split('/').pop());
      const c = Object.values(clientsBySub).find((x) => x.email === email);
      if (!c) return sendJSON(res, 404, { success: false, msg: 'not found' });
      const links = INBOUNDS
        .filter((ib) => (JSON.parse(ib.settings).clients || []).some((x) => x.email === email))
        .map((ib) => `vless://${c.id}@127.0.0.1:${ib.port}?type=ws&security=tls&path=%2Fwspath#${ib.remark}`);
      return sendJSON(res, 200, { success: true, msg: '', obj: links });
    }

    // ---------- v2 (fallback path) ----------
    if (u.pathname === '/panel/api/inbounds/list') {
      return res.end(JSON.stringify({ success: true, msg: '', obj: INBOUNDS }));
    }
    if (u.pathname === '/panel/api/inbounds/addClient' && req.method === 'POST') {
      const inboundId = params.get('id');
      const ib = INBOUNDS.find((x) => x.id === Number(inboundId));
      if (!ib) {
        return res.end(JSON.stringify({ success: false, msg: 'inbound not found' }));
      }
      const settings = JSON.parse(params.get('settings') || '{}');
      for (const c of settings.clients || []) {
        clientsBySub[c.subId || c.email] = c;
        ib.settings = JSON.stringify({ clients: [...JSON.parse(ib.settings).clients, c] });
      }
      return res.end(JSON.stringify({ success: true, msg: 'client added', obj: null }));
    }

    // mock subscription endpoint
    if (u.pathname.startsWith('/sub/')) {
      res.setHeader('Content-Type', 'text/plain');
      return res.end('vless://mock-subscription-content\n');
    }

    sendJSON(res, 404, { success: false, msg: 'not found' });
  });
});

const port = Number(process.env.MOCK_PORT || 2053);
server.listen(port, '127.0.0.1', () => console.log(`mock panel on 127.0.0.1:${port}`));