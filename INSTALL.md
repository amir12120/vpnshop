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

The installer asks for:

1. **Domain** — e.g. `shop.example.ir`. Leave empty to run on `IP:PORT` only.
2. **Port** — default `3000` (internal app port; nginx proxies it).
3. **SSL mode** — `1` Let's Encrypt (needs DNS + port 80 open) or `2` none.
4. **Admin username & password** (min 8 chars).

It installs Node 20, nginx, a systemd unit, sets up the firewall, and prints the final URL.

## 3. Verify the service

```bash
systemctl status vpnshop          # active (running)
journalctl -u vpnshop -f          # live logs (Ctrl+C to exit)
curl -I http://127.0.0.1:3000    # should return HTTP 200
```

Open `https://DOMAIN` (or `http://IP:3000`) in a browser — you should see the plan list page.

## 4. Post-install configuration (admin panel)

Log in at `/admin` with the credentials you set.

1. **Shop settings** → deposit card number + holder name.
2. **Sanayi panels** → add a panel:
   - **Name**: any label.
   - **Base URL**: if the panel is reachable via tunnel, use the tunnel address, e.g. `http://127.0.0.1:PORT` (a local forward of the foreign panel). Never expose the panel publicly.
   - **Username / password**: panel admin credentials.
   - **Default inbound**: pre-selects the inbound; leave empty if unsure.
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
| Order approved but no QR | page cached / missing delivery row | refresh; check `journalctl` |
