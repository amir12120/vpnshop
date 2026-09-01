'use strict';
// Sanayi / 3x-ui panel REST client.
// Uses the cookie-based login flow (POST /login) then calls panel APIs.

const PANEL_PATH = '/panel/api/inbounds';

class SanayiClient {
  constructor({ baseUrl, username, password, timeoutMs = 8000 }) {
    this.baseUrl = String(baseUrl || '').replace(/\/+$/, '');
    this.username = username;
    this.password = password;
    this.timeoutMs = timeoutMs;
    this.cookie = null;
  }

  async _fetch(path, { method = 'GET', body, headers = {} } = {}) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const res = await fetch(this.baseUrl + path, {
        method,
        signal: ctrl.signal,
        headers: {
          ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
          ...(this.cookie ? { Cookie: this.cookie } : {}),
          ...headers,
        },
        body: body ? new URLSearchParams(body).toString() : undefined,
        redirect: 'manual',
      });
      const setCookie = res.headers.get('set-cookie');
      if (setCookie) this.cookie = setCookie.split(';')[0];
      const text = await res.text();
      let json = null;
      try { json = JSON.parse(text); } catch { /* non-json */ }
      return { ok: res.ok, status: res.status, json, text };
    } finally {
      clearTimeout(t);
    }
  }

  async login() {
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
      const res = await this._authed(`${PANEL_PATH}/list`);
      if (res.json && res.json.success) {
        const inbounds = (res.json.obj || []).map((i) => ({
          id: i.id, port: i.port, tag: i.remark || i.tag,
        }));
        return { ok: true, message: `connected, ${inbounds.length} inbound(s)`, inbounds };
      }
      return { ok: false, message: `unexpected response (HTTP ${res.status})`, inbounds: [] };
    } catch (e) {
      return { ok: false, message: e.message, inbounds: [] };
    }
  }

  async listInbounds() {
    const res = await this._authed(`${PANEL_PATH}/list`);
    if (!res.json || !res.json.success) throw new Error('inbounds/list failed');
    return res.json.obj || [];
  }

  // Add a client to an inbound. settings JSON must be sent as string in form body.
  async addClient({ inboundId, email, uuid, totalGB, expiryTime, limitIp = 2 }) {
    const client = {
      id: uuid,
      email,
      limitIp,
      totalGB: totalGB == null ? 0 : Math.round(totalGB), // 0 = unlimited; bytes
      expiryTime: expiryTime == null ? 0 : expiryTime,    // 0 = unlimited; epoch ms
      enable: true,
      tgId: '', subId: email,
      flow: '',
    };
    const settings = JSON.stringify({ clients: [client] });
    const res = await this._authed(`${PANEL_PATH}/addClient`, {
      method: 'POST',
      body: { id: String(inboundId), settings },
    });
    if (!res.json || !res.json.success) {
      throw new Error(`addClient failed: ${res.json ? res.json.msg : `HTTP ${res.status}`}`);
    }
    return true;
  }

  // Fetch an inbound and extract the client's share/subscription links.
  async getClientLinks({ inboundId, email }) {
    const inbounds = await this.listInbounds();
    const inbound = inbounds.find((i) => i.id === Number(inboundId));
    if (!inbound) throw new Error(`inbound ${inboundId} not found`);

    let clients = [];
    try { clients = JSON.parse(inbound.settings || '{}').clients || []; } catch { /* ignore */ }
    const client = clients.find((c) => c.email === email);
    if (!client) throw new Error(`client ${email} not found in inbound ${inboundId}`);

    // subscription link: <baseUrl>/sub/<subId> (3x-ui default sub path)
    const subBase = this.baseUrl.replace(/\/+$/, '');
    const subUrl = `${subBase}/sub/${client.subId || email}`;

    // per-protocol share links built from inbound + client uuid
    const links = buildShareLinks(inbound, client);
    return { subUrl, links, client };
  }
}

// Build vless/vmess/trojan share links from an inbound definition.
function buildShareLinks(inbound, client) {
  const links = [];
  let stream = {};
  try { stream = JSON.parse(inbound.streamSettings || '{}'); } catch { /* ignore */ }
  const net = stream.network || 'tcp';
  const security = stream.security || 'none';
  const host = stream.tls?.settings?.servers?.[0]?.certificate || [];
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
  // reality public key / short id
  if (security === 'reality' && stream.realitySettings) {
    if (stream.realitySettings.publicKey) params.set('pbk', stream.realitySettings.publicKey);
    if (stream.realitySettings.shortIds?.[0]) params.set('sid', stream.realitySettings.shortIds[0]);
    if (stream.realitySettings.serverNames?.[0]) params.set('sni', stream.realitySettings.serverNames[0]);
    params.set('fp', stream.realitySettings.fingerprint || 'chrome');
  }

  const query = params.toString();
  const port = inbound.port;
  // NOTE: the address a client should connect to is usually the *public* address,
  // not what this API host is. We use inbound.listen if set to a public IP,
  // otherwise the panel host. Operators can edit the panel's baseUrl to a public
  // address so links are correct for end users.
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
