# VPN Shop — Server Install & Test Guide (English)

Deploy `vpnshop/` to an Ubuntu 22.04 server (Iran box, reachable by customers), then configure and test the full order flow.

## 1. Transfer the code to the server

From your workstation:

```bash
ssh root@IRAN_SERVER_IP "apt update && apt install -y git"
git clone https://github.com/amir12120/vpnshop.git /opt/vpnshop
cd /opt/vpnshop
```

## 2. Run the installer

```bash
bash INSTALL.sh
```

The installer starts with a **pre-flight phase** (server check → prerequisites → GitHub transport probe) before touching anything, then asks — in exactly this order:

1. **Username** — admin username (default label `Username :`)
2. **Password** — admin password, min 8 chars, hidden while typing
3. **Domain** — e.g. `shop.example.ir`. Leave empty to run on `IP:PORT` only.
4. **Port** — the **public** port the shop is served on (default `8443`). With a domain, nginx terminates traffic on this port; the node backend runs on an internal port (port+1).
5. **SSL mode** (only if a domain was given) — `1` Let's Encrypt → the shop is served at **`https://Domain:Port`**; `2` none → `http://Domain:Port`.

When installation finishes, the summary shows every entry link in exactly that form, with the credentials you entered:

```
 Storefront (customers):  https://shop.example.ir:8443/
 Register:                 https://shop.example.ir:8443/register
 Login:                    https://shop.example.ir:8443/login
 Admin panel:              https://shop.example.ir:8443/admin
 Admin username:           admin
 Admin password:           ********
```

It installs Node 24, nginx, a systemd unit, sets up the firewall, verifies the backend actually answers (no silent 502), and prints the final URL + admin credentials.

### If you ever see `RPC failed; HTTP 401` while cloning

That error comes from git's smart-HTTP transport being blocked or polluted by stale credentials on the server — it happens on **public** repos too. The installer now probes the git transport first (with credential helpers disabled) and **automatically falls back to a plain tarball download** if git fails. To diagnose a server manually:

```bash
bash /opt/vpnshop/scripts/preflight.sh   # standalone: server + prereqs + GitHub test
# prints REPO_FETCH_MODE=git|tarball
```

## 3. Verify the service

```bash
systemctl status vpnshop          # active (running)
journalctl -u vpnshop -f          # live logs (Ctrl+C to exit)
curl -I http://127.0.0.1:3000    # should return HTTP 200
```

Open `https://DOMAIN` (or `http://IP:3000`) in a browser — you should see the plan list page.

## 4. Post-install configuration (admin panel)

Panels page (`/admin/panels`) — each panel row takes:

- **Base URL** — the tunnel address, e.g. `http://127.0.0.1:PORT`.
- **API Token** (optional, recommended) — create a token in the panel under
  **API Tokens** (3x-ui v3). The shop sends `Authorization: Bearer <token>`.
  Leave empty to use username/password cookie login (v2 panels).
- **Username / Password** — panel admin credentials (v2 fallback).
- **Public sub URL** — the address customers reach the subscription at, e.g.
  `https://Domain:Port`. Required when the Base URL is a local tunnel address;
  leave empty only when the Base URL is already public.
- **Default inbound** — the inbound ID clients are added to.

Click **Test Connection** to verify auth + reachability before saving.

## 4b. Delivery contents

Log in at `/admin` with the credentials you set.

1. **Shop settings** → deposit card number + holder name.
2. **Sanayi panels** → add a panel (see the field list in section 4 above — use an **API token** for v3 panels, or panel username/password for v2; set the **public sub URL** so subscription links work for customers).
3. Click **“Test connection”** — success shows `connected, N inbound(s)`, failure explains the error.
4. **Plans** → create plans with volume (GB), duration (days), price (Toman), device limit.

## 5. End-to-end test with a real order

1. **Customer side** (incognito window): register → choose a plan → the page shows the deposit card → upload a receipt image (screenshot is fine).
2. Check the order appears in **My Orders** with status *awaiting_review* and no delivery.
3. **Admin side** (normal window): `/admin/orders` → the order with receipt image appears.
4. Select the panel + inbound, click **“Approve & auto-deliver”**.
5. Expect `Order #N approved and delivered`, and a new client on the Sanayi inbound with plan quota/expiry.
6. **Customer side**: **My Orders** → status *delivered* + **QR code** + subscription link + config links.
7. Scan the QR with a client app (V2rayNG / Streisand / Hiddify) and connect.

## 6. Maintenance

```bash
systemctl restart vpnshop          # restart after changes
journalctl -u vpnshop -n 50        # last 50 log lines
node /opt/vpnshop/seed-admin.js admin NEW_PASS   # reset admin password
tar czf /root/shop-backup-$(date +%F).tar.gz /opt/vpnshop/data /opt/vpnshop/public/uploads
```

Common issues:

| Symptom | Cause | Fix |
|---|---|---|
| Site not reachable | port taken / service stopped | `journalctl -u vpnshop -n 30` |
| “Failed to connect to panel” on approve | tunnel down or wrong panel creds | re-run Test Connection on `/admin/panels` |
| SSL issuance fails | DNS / port 80 | run `vpnshop ssl letsencrypt DOMAIN` (it handles nginx on port 80 automatically) |
| `RPC failed; HTTP 401` on clone/update | git smart-HTTP blocked or stale credentials on the server | installer/update auto-fall back to tarball; diagnose with `bash scripts/preflight.sh` |
| Order approved but no QR | page cached / missing delivery row | refresh; check `journalctl` |
