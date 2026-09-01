'use strict';
// Mock Sanayi (3x-ui) panel for testing the shop without a real panel.
// Implements: POST /login, GET /panel/api/inbounds/list, POST /panel/api/inbounds/addClient
const http = require('http');

const INBOUND = {
  id: 1, port: 443, protocol: 'vless', remark: 'main-inbound',
  listen: '', // '' = all interfaces
  settings: JSON.stringify({ clients: [] }),
  streamSettings: JSON.stringify({
    network: 'ws', security: 'tls',
    wsSettings: { path: '/wspath', settings: { headers: { Host: 'panel.example.com' } } },
    tlsSettings: { serverName: 'panel.example.com', settings: { allowInsecure: false } },
  }),
};

const sessions = new Set();

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://localhost');
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const params = new URLSearchParams(body);

    if (u.pathname === '/login' && req.method === 'POST') {
      if (params.get('username') === 'admin' && params.get('password') === 'panel123') {
        const sid = 'mocksession' + Math.random().toString(16).slice(2);
        sessions.add(sid);
        res.setHeader('Set-Cookie', `3x-ui=${sid}; Path=/`);
        return res.end(JSON.stringify({ success: true, msg: 'login ok', obj: null }));
      }
      res.statusCode = 401;
      return res.end(JSON.stringify({ success: false, msg: 'bad credentials' }));
    }

    if (u.pathname === '/panel/api/inbounds/list') {
      if (![...sessions].some((s) => (req.headers.cookie || '').includes(s))) {
        res.statusCode = 401;
        return res.end(JSON.stringify({ success: false }));
      }
      return res.end(JSON.stringify({ success: true, msg: '', obj: [INBOUND] }));
    }

    if (u.pathname === '/panel/api/inbounds/addClient' && req.method === 'POST') {
      if (![...sessions].some((s) => (req.headers.cookie || '').includes(s))) {
        res.statusCode = 401;
        return res.end(JSON.stringify({ success: false }));
      }
      const inboundId = params.get('id');
      if (String(inboundId) !== String(INBOUND.id)) {
        return res.end(JSON.stringify({ success: false, msg: 'inbound not found' }));
      }
      const settings = JSON.parse(params.get('settings') || '{}');
      for (const c of settings.clients || []) {
        INBOUND.settings = JSON.stringify({
          clients: [...JSON.parse(INBOUND.settings).clients, c],
        });
      }
      return res.end(JSON.stringify({ success: true, msg: 'client added', obj: null }));
    }

    // mock subscription endpoint
    if (u.pathname.startsWith('/sub/')) {
      res.setHeader('Content-Type', 'text/plain');
      return res.end('vless://mock-subscription-content\n');
    }

    res.statusCode = 404;
    res.end(JSON.stringify({ success: false, msg: 'not found' }));
  });
});

const port = Number(process.env.MOCK_PORT || 2053);
server.listen(port, '127.0.0.1', () => console.log(`mock panel on 127.0.0.1:${port}`));
