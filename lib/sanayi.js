'use strict';
// Sanayi / 3x-ui panel REST client.
//
// Supports BOTH API generations of MHSanaei/3x-ui:
//   v3 (current master):  auth via "Authorization: Bearer <API token>"
//     (API tokens are created inside the panel: Settings → API Tokens), or
//     session cookie login. Client ops live under /panel/api/clients/*:
//       POST /panel/api/clients/add        { client, inboundIds }
//       GET  /panel/api/clients/subLinks/:subId
//       GET  /panel/api/clients/links/:email
//   v2 (older releases):  cookie login (POST /login) then
//       POST /panel/api/inbounds/addClient (form: id + settings JSON)
//       GET  /panel/api/inbounds/list
//
// If an API token is configured we send it on every request (v3). Otherwise
// we fall back to username/password cookie login (works on both generations).
// Subscription links are built from the panel's PUBLIC sub URL when provided
// (the API base may be a local tunnel address that customers can't reach).

const PANEL_PATH = '/panel/api';

class SanayiClient {
  constructor({ baseUrl, username, password, apiToken, subUrl, timeoutMs = 8000 }) {
    this.baseUrl = String(baseUrl || '').replace(/\/+$/, '');
    this.username = username;
    this.password = password;
    this.apiToken = apiToken || '';
    // Public address customers use for subscription links (e.g. https://Domain:Port).
    // If unset we fall back to baseUrl — correct when the base is already public.
    this.subUrl = String(subUrl || '').replace(/\/+$/, '') || this.baseUrl;
    this.timeoutMs = timeoutMs;
    this.cookie = null;
  }

  async _fetch(path, { method = 'GET', body, headers = {}, json = false } = {}) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const h = { ...headers };
      if (this.apiToken) h.Authorization = `Bearer ${this.apiToken}`;
      if (this.cookie) h.Cookie = this.cookie;
      let payload;
      if (json) {
        h['Content-Type'] = 'application/json';
        payload = body ? JSON.stringify(body) : undefined;
      } else if (body) {
        h['Content-Type'] = 'application/x-www-form-urlencoded';
        payload = new URLSearchParams(body).toString();
      }
      const res = await fetch(this.baseUrl + path, {
        method, signal: ctrl.signal, headers: h, body: payload, redirect: 'manual',
      });
      const setCookie = res.headers.get('set-cookie');
      if (setCookie) this.cookie = setCookie.split(';')[0];
      const text = await res.text();
      let json2 = null;
      try { json2 = JSON.parse(text); } catch { /* non-json */ }
      return { ok: res.ok, status: res.status, json: json2, text };
    } finally {
      clearTimeout(t);
    }
  }

  async login() {
    if (this.apiToken) return true; // no session needed
    const res = await this._fetch('/login', {
      method: 'POST',
      body: { username: this.username, password: this.password },
    });
    if (!res.ok || (res.json && res.json.success === false)) {
      throw new Error(`panel login failed (HTTP ${res.status})`);
    }
    return true;
  }

  async _authed(path, opts = {}) {
    if (this.apiToken) return this._fetch(path, opts); // token auth, no session
    if (!this.cookie) await this.login();
    let res = await this._fetch(path, opts);
    // re-login once if session expired
    if (res.status === 401 || res.status === 302) {
      this.cookie = null;
      await this.login();
      res = await this._fetch(path, opts);
    }
    return res;
  }

  async testConnection() {
    try {
      const res = await this._authed(`${PANEL_PATH}/inbounds/list`);
      if (res.json && res.json.success) {
        const inbounds = (res.json.obj || []).map((i) => ({
          id: i.id, port: i.port, tag: i.remark || i.tag, protocol: i.protocol,
        }));
        return { ok: true, message: `connected, ${inbounds.length} inbound(s)`, inbounds };
      }
      return { ok: false, message: `unexpected response (HTTP ${res.status})`, inbounds: [] };
    } catch (e) {
      return { ok: false, message: e.message, inbounds: [] };
    }
  }

  async listInbounds() {
    const res = await this._authed(`${PANEL_PATH}/inbounds/list`);
    if (!res.json || !res.json.success) throw new Error('inbounds/list failed');
    return res.json.obj || [];
  }

  // Add a client. Tries the v3 JSON API first, falls back to the v2 form API.
  async addClient({ inboundId, email, uuid, totalGB, expiryTime, limitIp = 2 }) {
    const client = {
      id: uuid,                       // UUID — used by vless/vmess (v3 & v2)
      email,
      limitIp,
      totalGB: totalGB == null ? 0 : Math.round(totalGB), // 0 = unlimited; bytes
      expiryTime: expiryTime == null ? 0 : expiryTime,    // 0 = unlimited; epoch ms
      enable: true,
      tgId: '',
      subId: email,                   // subscription id — panel uses this for /sub/<subId>
      flow: '',
    };

    // v3: POST /panel/api/clients/add  (JSON)
    const v3 = await this._authed(`${PANEL_PATH}/clients/add`, {
      method: 'POST',
      json: true,
      body: { client, inboundIds: [Number(inboundId)] },
    });
    if (v3.status !== 404 && v3.status !== 405 && v3.status !== 501) {
      if (v3.json && v3.json.success) return true;
      throw new Error(`addClient failed (v3): ${v3.json && v3.json.msg ? v3.json.msg : `HTTP ${v3.status}`}`);
    }

    // v2 fallback: POST /panel/api/inbounds/addClient  (form: id + settings JSON)
    const settings = JSON.stringify({ clients: [client] });
    const v2 = await this._authed(`${PANEL_PATH}/inbounds/addClient`, {
      method: 'POST',
      body: { id: String(inboundId), settings },
    });
    if (!v2.json || !v2.json.success) {
      throw new Error(`addClient failed (v2): ${v2.json && v2.json.msg ? v2.json.msg : `HTTP ${v2.status}`}`);
    }
    return true;
  }

  // Build customer-facing delivery links: subscription URL, QR source, and the
  // per-protocol config links. The PUBLIC sub URL (subUrl config) always wins
  // over what the panel returns, because behind a tunnel the panel answers
  // with its internal host which customers cannot reach.
  async getClientLinks({ inboundId, email, subId }) {
    const sid = subId || email;
    // match the panel's own link format: raw subId, no percent-encoding
    const publicSub = `${this.subUrl}/sub/${sid}`;

    // v3: ask the panel for official subscription + client links (also verifies
    // the client exists); the returned sub link may be host-relative to the
    // tunnel, so we substitute the public base.
    const subRes = await this._authed(`${PANEL_PATH}/clients/subLinks/${encodeURIComponent(sid)}`);
    if (subRes.status !== 404 && subRes.json && subRes.json.success) {
      const officialSub = subRes.json.obj;
      if (Array.isArray(officialSub) && officialSub.length) {
        const linksRes = await this._authed(`${PANEL_PATH}/clients/links/${encodeURIComponent(email)}`);
        let links = [];
        if (linksRes.json && linksRes.json.success && Array.isArray(linksRes.json.obj)) {
          links = linksRes.json.obj;
        }
        if (!links.length) {
          const inbound = await this._findInbound(inboundId);
          links = buildShareLinks(inbound, { id: '', email, subId: sid });
        }
        return { subUrl: publicSub, links, client: { email, subId: sid } };
      }
    }

    // fallback: build links from the inbound definition (v2 or slim v3)
    const inbound = await this._findInbound(inboundId);
    let client = null;
    try { client = (JSON.parse(inbound.settings || '{}').clients || []).find((c) => c.email === email); } catch { /* ignore */ }
    const links = buildShareLinks(inbound, client || { id: '', email, subId: sid });
    return { subUrl: publicSub, links, client };
  }

  async _findInbound(inboundId) {
    const inbounds = await this.listInbounds();
    const inbound = inbounds.find((i) => i.id === Number(inboundId));
    if (!inbound) throw new Error(`inbound ${inboundId} not found`);
    return inbound;
  }
}

// Build vless/vmess/trojan share links from an inbound definition.
function buildShareLinks(inbound, client) {
  const links = [];
  let stream = {};
  try { stream = JSON.parse(inbound.streamSettings || '{}'); } catch { /* ignore */ }
  const net = stream.network || 'tcp';
  const security = stream.security || 'none';
  const sni = stream.tls?.serverName || stream.realitySettings?.serverNames?.[0] || '';

  const params = new URLSearchParams();
  params.set('type', net);
  if (security !== 'none') params.set('security', security);
  if (sni) params.set('sni', sni);
  if (stream.tls?.settings?.allowInsecure || stream.reality?.settings?.allowInsecure) {
    params.set('allowInsecure', '1');
  }
  // ws path/host
  if (net === 'ws' && stream.wsSettings) {
    if (stream.wsSettings.path) params.set('path', stream.wsSettings.path);
    if (stream.wsSettings.settings?.headers?.Host) {
      params.set('host', stream.wsSettings.settings.headers.Host);
    }
  }
  // grpc service name
  if (net === 'grpc' && stream.grpcSettings) {
    if (stream.grpcSettings.serviceName) params.set('serviceName', stream.grpcSettings.serviceName);
    if (stream.grpcSettings.multiMode) params.set('mode', 'multi');
  }
  // reality public key / short id
  if (security === 'reality' && stream.realitySettings) {
    if (stream.realitySettings.publicKey) params.set('pbk', stream.realitySettings.publicKey);
    if (stream.realitySettings.shortIds?.[0]) params.set('sid', stream.realitySettings.shortIds[0]);
    if (stream.realitySettings.serverNames?.[0]) params.set('sni', stream.realitySettings.serverNames[0]);
    params.set('fp', stream.realitySettings.fingerprint || 'chrome');
  }

  const query = params.toString();
  const port = inbound.port;
  // The address a client should connect to: the inbound's public listen IP if
  // set, otherwise the panel host. When the panel is behind a tunnel the
  // operator should set the shop panel's "sub URL / public address" so links
  // carry the real public host.
  let address = '';
  try { address = new URL(inbound._baseUrl || '').hostname; } catch { /* ignore */ }
  address = address || (inbound.listen && inbound.listen !== '0.0.0.0' && !isPrivateIp(inbound.listen)
    ? inbound.listen : '');

  const tag = inbound.remark || inbound.tag || `in-${inbound.id}`;

  if (inbound.protocol === 'vless') {
    links.push(`vless://${client.id}@${address || 'SERVER'}:${port}?${query}#${encodeURIComponent(tag)}`);
  } else if (inbound.protocol === 'vmess') {
    const vm = { v: '2', ps: tag, add: address || 'SERVER', port, id: client.id,
      aid: client.alterId ?? 0, net, type: 'none', host: '', path: '',
      tls: security === 'tls' ? 'tls' : '' };
    if (net === 'ws') { vm.path = stream.wsSettings?.path || ''; vm.host = stream.wsSettings?.settings?.headers?.Host || ''; }
    links.push(`vmess://${Buffer.from(JSON.stringify(vm)).toString('base64')}`);
  } else if (inbound.protocol === 'trojan') {
    links.push(`trojan://${client.id}@${address || 'SERVER'}:${port}?${query}#${encodeURIComponent(tag)}`);
  }
  return links;
}

function isPrivateIp(ip) {
  return /^(10\.|127\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(ip);
}

module.exports = { SanayiClient, buildShareLinks };