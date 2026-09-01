#!/usr/bin/env bash
# ============================================================
# VPN Shop — all-in-one installer for Ubuntu 22.04 (root)
# Works both ways:
#   1) one-liner:  bash <(curl -fsSL https://raw.githubusercontent.com/amir12120/vpnshop/main/INSTALL.sh)
#   2) inside a checkout:  bash INSTALL.sh
# Prompts for: domain, port, SSL mode, admin username & password.
# Also installs the `vpnshop` management CLI (/usr/local/bin/vpnshop).
# ============================================================
set -euo pipefail

APP_DIR=/opt/vpnshop
REPO_URL="${VPN_SHOP_REPO:-https://github.com/amir12120/vpnshop.git}"
BRANCH="${VPN_SHOP_BRANCH:-main}"

# ---------- bootstrap: clone the repo if we're not inside a checkout ----------
if [ ! -f server.js ]; then
  if [ "$(id -u)" -ne 0 ]; then
    echo "!! Please run as root:  sudo bash INSTALL.sh"
    exit 1
  fi
  if ! grep -qi ubuntu /etc/os-release; then
    echo "!! This installer targets Ubuntu 22.04 — install manually on other distros."
    exit 1
  fi
  echo ">> Running remotely — installing git and fetching the repository..."
  apt-get update -y
  apt-get install -y git curl rsync
  if [ -d "$APP_DIR/.git" ]; then
    echo ">> Existing installation found — updating..."
    cd "$APP_DIR"
    git fetch origin "$BRANCH"
    git reset --hard "origin/$BRANCH"
  else
    rm -rf "$APP_DIR"
    git clone --depth 1 -b "$BRANCH" "$REPO_URL" "$APP_DIR"
    cd "$APP_DIR"
  fi
  exec bash INSTALL.sh   # continue from inside the checkout
fi

# ---------- interactive prompts ----------
echo "=============================="
echo " VPN Shop — Installer"
echo "=============================="

# ---------- port conflict check (tunnel-safe) ----------
port_busy() {  # true if something is listening on $1
  ss -tlnH "sport = :$1" 2>/dev/null | grep -q . || netstat -tln 2>/dev/null | grep -q ":$1 "
}

read -rp "Web port [3000]: " PORT
PORT=${PORT:-3000}
while port_busy "$PORT"; do
  echo "!! Port ${PORT} is already in use on this server:"
  ss -tlnp "sport = :${PORT}" 2>/dev/null || netstat -tlnp 2>/dev/null | grep ":${PORT} "
  echo "   This server may host tunnel listeners. Pick a different port."
  read -rp "Web port: " PORT
done

read -rp "Domain (e.g. shop.example.ir) [empty = serve on IP:PORT only]: " DOMAIN

if [ -n "${DOMAIN}" ]; then
  if port_busy 80; then
    echo "!! WARNING: port 80 is already in use — nginx (needed for domain + SSL) may fail to start."
    echo "   If your reverse/direct tunnel binds port 80 or 443 on this server, either:"
    echo "     - install without a domain (shop served on IP:PORT), or"
    echo "     - free ports 80/443 for nginx first."
    ss -tlnp "sport = :80" 2>/dev/null || true
    read -rp "Continue anyway? [y/N]: " GO_ON
    [ "${GO_ON}" = "y" ] || exit 1
  fi
fi
read -rp "Admin username: " ADMIN_USER
while [ -z "${ADMIN_USER}" ]; do read -rp "Admin username: " ADMIN_USER; done
read -rsp "Admin password (min 8 chars): " ADMIN_PASS
echo ""
while [ ${#ADMIN_PASS} -lt 8 ]; do read -rsp "Too short, try again: " ADMIN_PASS; echo ""; done

SSL_MODE=""
if [ -n "${DOMAIN}" ]; then
  echo "SSL mode:"
  echo "  1) Let's Encrypt (free — needs DNS pointing here and port 80 open)"
  echo "  2) No SSL (plain HTTP — e.g. if your CDN/proxy terminates SSL)"
  read -rp "Choice [1/2]: " SSL_MODE
fi

# ---------- system dependencies ----------
echo ">> Installing dependencies..."
apt-get update -y
apt-get install -y curl ca-certificates gnupg nginx rsync

if ! command -v node >/dev/null 2>&1 || [ "$(node -v | cut -c2- | cut -d. -f1)" -lt 22 ]; then
  # node:sqlite requires Node 22.5+; we install 24 (current LTS)
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  apt-get install -y nodejs
fi
echo ">> node $(node -v)"

# ---------- application ----------
rsync -a --exclude node_modules --exclude data ./ "$APP_DIR/"
cd "$APP_DIR"
npm install --omit=dev --no-audit --no-fund

mkdir -p data public/uploads
chown -R www-data:www-data "$APP_DIR"

# management CLI
install -m 0755 vpnshop-cli.sh /usr/local/bin/vpnshop
sed -i 's/\r$//' /usr/local/bin/vpnshop   # strip CRLF if any survived (Windows checkouts)
chmod +x /usr/local/bin/vpnshop
if vpnshop --version >/dev/null 2>&1; then
  echo ">> management CLI installed: $(vpnshop --version) — type 'vpnshop' for the menu"
else
  echo "!! CLI installed but not runnable — check:  head -1 /usr/local/bin/vpnshop | cat -A"
fi

# the app dir is owned by www-data but git commands (vpnshop update) run as
# root — mark it safe so git never refuses with "dubious ownership"
git config --global --add safe.directory "$APP_DIR"

# admin user
node seed-admin.js "$ADMIN_USER" "$ADMIN_PASS"
chown -R www-data:www-data "$APP_DIR/data"   # db must be writable by the service user

# ---------- systemd service ----------
SECRET=$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')
cat >/etc/systemd/system/vpnshop.service <<EOF
[Unit]
Description=VPN Config Shop
After=network.target

[Service]
Type=simple
WorkingDirectory=${APP_DIR}
ExecStart=$(command -v node) ${APP_DIR}/server.js
Environment=PORT=${PORT}
Environment=NODE_ENV=production
Environment=VPNSHOP_SECRET=${SECRET}
Restart=always
RestartSec=3
User=www-data

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now vpnshop

# ---------- verify the backend actually serves (avoid silent 502) ----------
echo ">> waiting for the shop to answer on port ${PORT}..."
SHOP_UP=""
for i in $(seq 1 20); do
  curl -sf "http://127.0.0.1:${PORT}/" >/dev/null 2>&1 && { SHOP_UP=1; break; }
  sleep 1
done
if [ -z "$SHOP_UP" ]; then
  echo "!! Backend did not come up — nginx would only serve 502. Recent service log:"
  journalctl -u vpnshop -n 25 --no-pager || true
  echo ""
  echo "   Common causes:"
  echo "   - 'No such built-in module: node:sqlite' -> Node too old (need 22.5+). Fix:"
  echo "       curl -fsSL https://deb.nodesource.com/setup_24.x | bash - && apt-get install -y nodejs && systemctl restart vpnshop"
  echo "   - 'port ${PORT} is already in use'       -> pick another port and reinstall"
  echo "   - permission errors on data/vpnshop.db   -> chown -R www-data:www-data ${APP_DIR}/data"
  exit 1
fi
echo ">> backend verified: answering HTTP on port ${PORT}."

# ---------- nginx + ssl ----------
if [ -n "${DOMAIN}" ]; then
  cat >/etc/nginx/sites-available/vpnshop <<EOF
server {
    listen 80;
    server_name ${DOMAIN};
    client_max_body_size 12m;
    location / {
        proxy_pass http://127.0.0.1:${PORT};
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF
  ln -sf /etc/nginx/sites-available/vpnshop /etc/nginx/sites-enabled/vpnshop
  rm -f /etc/nginx/sites-enabled/default
  nginx -t && systemctl reload nginx

  if [ "${SSL_MODE}" = "1" ]; then
    # handles port-80 conflicts itself: stops nginx temporarily if it holds 80,
    # issues the cert standalone, restarts nginx and configures the 443 block
    vpnshop ssl letsencrypt "${DOMAIN}" || \
      echo "!! SSL issuance failed — check DNS (does it point to this server?). Retry later with: vpnshop ssl letsencrypt ${DOMAIN}"
  fi
fi

# ---------- firewall ----------
if command -v ufw >/dev/null 2>&1; then
  ufw allow OpenSSH >/dev/null 2>&1 || true
  ufw allow 80,443/tcp >/dev/null 2>&1 || true
  if [ -z "${DOMAIN}" ]; then ufw allow "${PORT}/tcp" >/dev/null 2>&1 || true; fi
fi

echo ""
echo "=============================="
echo " Installation complete"
if [ -n "${DOMAIN}" ]; then
  SHOP_URL="http${SSL_MODE:+s}://${DOMAIN}"
else
  SHOP_URL="http://$(curl -s --max-time 3 ifconfig.me 2>/dev/null || echo SERVER_IP):${PORT}"
fi
echo " Shop URL:        ${SHOP_URL}/"
echo ""
echo " Admin panel URL: ${SHOP_URL}/admin"
echo " Admin username:  ${ADMIN_USER}"
echo " Admin password:  ${ADMIN_PASS}"
echo " (keep these credentials safe — they grant full shop control)"
echo ""
echo " Manage anytime with:  vpnshop"
echo "   vpnshop help        - all commands"
echo "   vpnshop ssl         - SSL manager"
echo "   vpnshop uninstall   - remove the shop"
echo ""
echo " Next steps:"
echo "   1. ${SHOP_URL}/admin/settings  -> set your deposit card number"
echo "   2. ${SHOP_URL}/admin/panels    -> add your Sanayi panel, hit 'test connection'"
echo "   3. ${SHOP_URL}/admin/plans     -> define your plans"
echo "=============================="
