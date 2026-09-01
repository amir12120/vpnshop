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

read -rp "Domain (e.g. shop.example.ir) [empty = serve on IP:PORT only]: " DOMAIN
read -rp "Web port [3000]: " PORT
PORT=${PORT:-3000}
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

if ! command -v node >/dev/null 2>&1 || [ "$(node -v | cut -c2- | cut -d. -f1)" -lt 18 ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
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
echo ">> management CLI installed: vpnshop (run 'vpnshop help')"

# admin user
node seed-admin.js "$ADMIN_USER" "$ADMIN_PASS"

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
echo ">> service is up on port ${PORT}."

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
    apt-get install -y certbot python3-certbot-nginx
    certbot --nginx -d "${DOMAIN}" --non-interactive --agree-tos -m "admin@${DOMAIN#*.}" || \
      echo "!! SSL issuance failed — check DNS (does it point to this server? is port 80 open?). Retry later with: vpnshop ssl letsencrypt ${DOMAIN}"
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
