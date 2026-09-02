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
      // v3 panels require X-CSRF-Token on unsafe methods (unless Bearer API
      // token auth, which short-circuits the CSRF middleware).
      if (this.csrf && !['GET', 'HEAD', 'OPTIONS'].includes(method)) {
        h['X-CSRF-Token'] = this.csrf;
      }
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

  // v3 panels protect even POST /login with CSRF: first GET /csrf-token
  // (public — mints the session + token), then send X-CSRF-Token. v2 panels
  // lack that endpoint; plain cookie login is used there.
  async login() {
    if (this.apiToken) return true; // Bearer auth, no session/CSRF needed
    this.csrf = null;
    const tokRes = await this._fetch('/csrf-token');
    if (tokRes.status === 200 && tokRes.json && tokRes.json.obj) {
      this.csrf = tokRes.json.obj;   // session cookie captured in this.cookie
    }
    const res = await this._fetch('/login', {
      method: 'POST',
      body: { username: this.username, password: this.password },
      headers: this.csrf ? { 'X-CSRF-Token': this.csrf } : {},
    });
    if (!res.ok || (res.json && res.json.success === false)) {
      throw new Error(`panel login failed (HTTP ${res.status}${this.csrf ? ' — on 3x-ui v3 create an API token and use it instead of username/password' : ''})`);
    }
    return true;
  }

  async _authed(path, opts = {}) {
    if (this.apiToken) return this._fetch(path, opts); // token auth, no session
    if (!this.cookie) await this.login();
    let res = await this._fetch(path, opts);
    // re-login once if the session expired or the CSRF token rotated
    if (res.status === 401 || res.status === 302 || (res.status === 403 && this.csrf)) {
      this.cookie = null;
      this.csrf = null;
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

  // Add a client to ONE or MORE inbounds. Tries the v3 JSON API first
  // (supports several inboundIds in one call), falls back to the v2 form API
  // (one call per inbound).
  async addClient({ inboundIds, email, uuid, totalGB, expiryTime, limitIp = 2 }) {
    const ids = [].concat(inboundIds).map(Number).filter(Boolean);
    if (!ids.length) throw new Error('at least one inbound is required');
    const client = {
      id: uuid,                       // UUID — used by vless/vmess (v3 & v2)
      email,
      limitIp,
      totalGB: totalGB == null ? 0 : Math.round(totalGB), // 0 = unlimited; bytes
      expiryTime: expiryTime == null ? 0 : expiryTime,    // 0 = unlimited; epoch ms
      enable: true,
      tgId: 0,                        // int64 on the panel — a string breaks v3 JSON unmarshal
      subId: email,                   // subscription id — panel uses this for /sub/<subId>
      flow: '',
    };

    // v3: POST /panel/api/clients/add  (JSON, one call for all inbounds)
    const v3 = await this._authed(`${PANEL_PATH}/clients/add`, {
      method: 'POST',
      json: true,
      body: { client, inboundIds: ids },
    });
    if (v3.status !== 404 && v3.status !== 405 && v3.status !== 501) {
      if (v3.json && v3.json.success) return true;
      throw new Error(`addClient failed (v3): ${v3.json && v3.json.msg ? v3.json.msg : `HTTP ${v3.status}`}`);
    }

    // v2 fallback: POST /panel/api/inbounds/addClient per inbound
    const settings = JSON.stringify({ clients: [client] });
    for (const id of ids) {
      const v2 = await this._authed(`${PANEL_PATH}/inbounds/addClient`, {
        method: 'POST',
        body: { id: String(id), settings },
      });
      if (!v2.json || !v2.json.success) {
        throw new Error(`addClient failed (v2) on inbound ${id}: ${v2.json && v2.json.msg ? v2.json.msg : `HTTP ${v2.status}`}`);
      }
    }
    return true;
  }

  // Build customer-facing delivery links: subscription URL, QR source, and the
  // per-protocol config links across ALL inbounds the client was attached to.
  // The PUBLIC sub URL (subUrl config) always wins over what the panel returns,
  // because behind a tunnel the panel answers with its internal host which
  // customers cannot reach.
  async getClientLinks({ inboundIds, email, subId }) {
    const ids = [].concat(inboundIds).map(Number).filter(Boolean);
    const sid = subId || email;
    // Sub link = public sub base + subId. The base ALREADY includes the panel's
    // subscription path (e.g. https://host:2096/amirr/ or https://host/sub/),
    // so we just append the subId — the /sub/ segment is part of subPath on
    // 3x-ui and must not be hardcoded here.
    const publicSub = `${this.subUrl}/${sid}`;

    // v3: ask the panel for official subscription + client links (also verifies
    // the client exists); links/:email already spans every attached inbound.
    const subRes = await this._authed(`${PANEL_PATH}/clients/subLinks/${encodeURIComponent(sid)}`);
    if (subRes.status !== 404 && subRes.json && subRes.json.success) {
      const linksRes = await this._authed(`${PANEL_PATH}/clients/links/${encodeURIComponent(email)}`);
      let links = [];
      if (linksRes.json && linksRes.json.success && Array.isArray(linksRes.json.obj)) {
        links = linksRes.json.obj;
      }
      if (!links.length) {
        const inbounds = await this.listInbounds();
        for (const id of ids) {
          const ib = inbounds.find((i) => i.id === id);
          if (ib) links = links.concat(buildShareLinks(ib, { id: '', email, subId: sid }));
        }
      }
      return { subUrl: publicSub, links, client: { email, subId: sid } };
    }

    // fallback (v2 / slim v3): build links from each inbound's definition
    const inbounds = await this.listInbounds();
    let links = [];
    for (const id of ids) {
      const inbound = inbounds.find((i) => i.id === id);
      if (!inbound) throw new Error(`inbound ${id} not found`);
      let client = null;
      try { client = (JSON.parse(inbound.settings || '{}').clients || []).find((c) => c.email === email); } catch { /* ignore */ }
      links = links.concat(buildShareLinks(inbound, client || { id: '', email, subId: sid }));
    }
    return { subUrl: publicSub, links, client: null };
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