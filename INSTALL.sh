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

# the repo is PUBLIC — git must never prompt for credentials. A 'Username for
# https://github.com' prompt means a transport/proxy problem, not real auth.
export GIT_TERMINAL_PROMPT=0
export GIT_ASKPASS=/bin/true

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
  # ---- step 1/3: prerequisites needed just to fetch the code ----
  echo ">> [1/3] Installing fetch prerequisites (git, curl, rsync, tar)..."
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y
  apt-get install -y --no-install-recommends git curl ca-certificates rsync tar

  # ---- step 2/3: pick the GitHub transport that actually works ----
  # 'RPC failed; HTTP 401' comes from git's smart-HTTP upload-pack RPC. It can
  # hit PUBLIC repos too when a stale credential.helper / proxy auth interferes.
  # We probe git first (credentials stripped), then fall back to a plain tarball.
  slug="$(printf '%s' "$REPO_URL" | sed -E 's#^https?://github\.com/##; s#\.git$##')"
  tarball_url="https://codeload.github.com/${slug}/tar.gz/refs/heads/${BRANCH}"
  echo ">> [2/3] Testing GitHub transport (this is where 'RPC failed; HTTP 401' comes from)..."
  FETCH_MODE=""
  if GIT_TERMINAL_PROMPT=0 git -c credential.helper= -c credential.helper='' \
       ls-remote --heads "$REPO_URL" "refs/heads/$BRANCH" >/dev/null 2>&1; then
    FETCH_MODE=git
    echo "   git transport OK — will clone normally"
  elif curl -fsSL --max-time 20 --retry 2 -o /dev/null "$tarball_url" 2>/dev/null; then
    FETCH_MODE=tarball
    echo "   git transport BLOCKED (the 'RPC failed; HTTP 401' you saw)"
    echo "   → switching to a plain tarball download — works on every public repo"
  else
    echo "!! GitHub is unreachable from this server (git AND tarball both failed)."
    echo "   Check the server's internet/DNS/proxy, then re-run the installer."
    exit 1
  fi

  tarball_fetch() {  # $1 = destination dir
    local tmp; tmp=$(mktemp -d)
    curl -fsSL --max-time 120 --retry 2 -o "$tmp/src.tar.gz" "$tarball_url" || { rm -rf "$tmp"; return 1; }
    mkdir -p "$1"
    tar -xzf "$tmp/src.tar.gz" -C "$1" --strip-components=1 || { rm -rf "$tmp"; return 1; }
    rm -rf "$tmp"
  }
  tarball_refresh() {  # refresh an existing tarball install in place, keep data/uploads
    local tmp; tmp=$(mktemp -d)
    curl -fsSL --max-time 120 --retry 2 -o "$tmp/src.tar.gz" "$tarball_url" || { rm -rf "$tmp"; return 1; }
    tar -xzf "$tmp/src.tar.gz" -C "$tmp" --strip-components=1 || { rm -rf "$tmp"; return 1; }
    rsync -a --delete --exclude data --exclude node_modules --exclude public/uploads \
      --exclude .repo-fetch-mode "$tmp/" "$APP_DIR/"
    rm -rf "$tmp"
  }

  # ---- step 3/3: fetch the repository ----
  echo ">> [3/3] Fetching the repository ($FETCH_MODE mode)..."
  if [ -d "$APP_DIR/.git" ]; then
    echo "   Existing installation found — updating via git..."
    git config --global --get-all safe.directory 2>/dev/null | grep -qx "$APP_DIR" || \
      git config --global --add safe.directory "$APP_DIR"
    if git -C "$APP_DIR" -c credential.helper= -c credential.helper='' fetch origin "$BRANCH" 2>/dev/null; then
      git -C "$APP_DIR" reset --hard "origin/$BRANCH"
    else
      echo "   git fetch failed — refreshing via tarball instead"
      tarball_refresh
    fi
  elif [ -f "$APP_DIR/server.js" ]; then
    echo "   Existing installation found — refreshing via tarball..."
    tarball_refresh
  elif [ "$FETCH_MODE" = "git" ]; then
    rm -rf "$APP_DIR"
    if ! git -c credential.helper= clone --depth 1 -b "$BRANCH" "$REPO_URL" "$APP_DIR"; then
      echo "   git clone failed — falling back to tarball"
      tarball_fetch "$APP_DIR" || { echo "!! could not fetch the repository"; exit 1; }
    fi
  else
    rm -rf "$APP_DIR"
    tarball_fetch "$APP_DIR" || { echo "!! could not download the repository tarball"; exit 1; }
  fi
  echo "$FETCH_MODE" > "$APP_DIR/.repo-fetch-mode"
  cd "$APP_DIR"
  exec bash INSTALL.sh   # continue from inside the checkout
fi

# ---------- interactive prompts ----------
echo "=============================="
echo " VPN Shop — Installer"
echo "=============================="

# ---------- pre-flight: verify the server BEFORE touching anything ----------
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/scripts/preflight.sh"
pf_server_check   || exit 1
pf_install_prereqs || exit 1
# remember how THIS server fetches the repo — `vpnshop update` honors it
if [ ! -f .repo-fetch-mode ]; then
  pf_github_check "$REPO_URL" "$BRANCH" || true
  echo "${REPO_FETCH_MODE:-git}" > .repo-fetch-mode
fi
echo ">> update transport for this server: $(cat .repo-fetch-mode)"
echo ""

# ---------- prompts: Username / Password / Domain / Port ----------
port_busy() {  # true if something is listening on $1
  ss -tlnH "sport = :$1" 2>/dev/null | grep -q . || netstat -tln 2>/dev/null | grep -q ":$1 "
}

read -rp "Username : " ADMIN_USER
while [ -z "${ADMIN_USER}" ]; do read -rp "Username : " ADMIN_USER; done

read -rsp "Password : " ADMIN_PASS
echo ""
while [ ${#ADMIN_PASS} -lt 8 ]; do read -rsp "Password (min 8 chars) : " ADMIN_PASS; echo ""; done

read -rp "Domain : " DOMAIN
DOMAIN="$(printf '%s' "${DOMAIN:-}" | tr -d '[:space:]')"
DOMAIN="${DOMAIN#http://}"; DOMAIN="${DOMAIN#https://}"; DOMAIN="${DOMAIN%/}"

read -rp "Port : " PORT
PORT=${PORT:-8443}
while ! [[ "${PORT}" =~ ^[0-9]+$ ]] || [ "${PORT}" -lt 1 ] || [ "${PORT}" -gt 65535 ]; do
  read -rp "Port (1-65535) : " PORT; PORT=${PORT:-8443}
done
while port_busy "${PORT}"; do
  echo "!! Port ${PORT} is already in use on this server:"
  ss -tlnp "sport = :${PORT}" 2>/dev/null || netstat -tlnp 2>/dev/null | grep ":${PORT} "
  echo "   This server may host tunnel listeners. Pick a different port."
  read -rp "Port : " PORT
done

SSL_MODE=""
if [ -n "${DOMAIN}" ]; then
  echo "SSL mode:"
  echo "  1) Let's Encrypt (free — needs DNS pointing here; site becomes https://Domain:Port)"
  echo "  2) No SSL (site served as http://Domain:Port)"
  read -rp "Choice [1/2]: " SSL_MODE
  SSL_MODE=${SSL_MODE:-1}
  if [ "${SSL_MODE}" = "1" ] && port_busy 80; then
    echo "!! WARNING: port 80 is in use — the Let's Encrypt challenge needs it free during issuance."
    ss -tlnp "sport = :80" 2>/dev/null || true
    echo "   If a tunnel binds port 80 on this server, pick mode 2 or free port 80 later."
    read -rp "Continue anyway? [y/N]: " GO_ON
    [ "${GO_ON}" = "y" ] || exit 1
  fi
fi

# internal app port: node listens here; nginx (if domain) takes the public port
if [ -n "${DOMAIN}" ]; then
  NODE_PORT=$((PORT + 1))
  while [ "${NODE_PORT}" -le 65535 ] && port_busy "${NODE_PORT}"; do NODE_PORT=$((NODE_PORT + 1)); done
  [ "${NODE_PORT}" -le 65535 ] || { echo "!! no free internal port next to ${PORT}"; exit 1; }
else
  NODE_PORT=${PORT}
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
[ -d "$APP_DIR/.git" ] && git config --global --add safe.directory "$APP_DIR"

# admin user
node seed-admin.js "$ADMIN_USER" "$ADMIN_PASS"
chown -R www-data:www-data "$APP_DIR/data"   # db must be writable by the service user

# ---------- systemd service ----------
SECRET=$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')
# HOST: in domain mode the backend binds loopback only (nginx owns the public
# port); without a domain node serves the public port itself on all interfaces.
BIND_HOST=0.0.0.0
[ -n "${DOMAIN}" ] && BIND_HOST=127.0.0.1
cat >/etc/systemd/system/vpnshop.service <<EOF
[Unit]
Description=VPN Config Shop
After=network.target

[Service]
Type=simple
WorkingDirectory=${APP_DIR}
ExecStart=$(command -v node) ${APP_DIR}/server.js
Environment=PORT=${NODE_PORT}
Environment=HOST=${BIND_HOST}
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
echo ">> waiting for the shop to answer on internal port ${NODE_PORT}..."
SHOP_UP=""
for i in $(seq 1 20); do
  curl -sf "http://127.0.0.1:${NODE_PORT}/" >/dev/null 2>&1 && { SHOP_UP=1; break; }
  sleep 1
done
if [ -z "$SHOP_UP" ]; then
  echo "!! Backend did not come up — nginx would only serve 502. Recent service log:"
  journalctl -u vpnshop -n 25 --no-pager || true
  echo ""
  echo "   Common causes:"
  echo "   - 'No such built-in module: node:sqlite' -> Node too old (need 22.5+). Fix:"
  echo "       curl -fsSL https://deb.nodesource.com/setup_24.x | bash - && apt-get install -y nodejs && systemctl restart vpnshop"
  echo "   - 'port ${NODE_PORT} is already in use'    -> pick another port and reinstall"
  echo "   - permission errors on data/vpnshop.db   -> chown -R www-data:www-data ${APP_DIR}/data"
  exit 1
fi
echo ">> backend verified: answering HTTP on internal port ${NODE_PORT}."

# ---------- nginx: public port (TLS with cert, plain fallback without) ----------
if [ -n "${DOMAIN}" ]; then
  if [ "${SSL_MODE}" = "1" ]; then
    # issue the certificate FIRST (standalone, nginx stopped around it), then
    # serve TLS directly on the public port the user chose — https://Domain:Port
    ssl_issuance_error=""
    vpnshop ssl issue --port "${PORT}" "${DOMAIN}" || ssl_issuance_error=1
    if [ -n "${ssl_issuance_error}" ]; then
      echo "!! SSL issuance failed — falling back to plain HTTP on port ${PORT}."
      echo "   Check DNS (does ${DOMAIN} point to this server?), then retry:"
      echo "     vpnshop ssl letsencrypt ${DOMAIN}"
    fi
  else
    cat >/etc/nginx/sites-available/vpnshop <<EOF
server {
    listen ${PORT};
    server_name ${DOMAIN};
    client_max_body_size 12m;
    location / {
        proxy_pass http://127.0.0.1:${NODE_PORT};
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF
    ln -sf /etc/nginx/sites-available/vpnshop /etc/nginx/sites-enabled/vpnshop
    rm -f /etc/nginx/sites-enabled/default
    nginx -t && systemctl reload nginx
  fi
fi

# ---------- firewall ----------
if command -v ufw >/dev/null 2>&1; then
  ufw allow OpenSSH >/dev/null 2>&1 || true
  if [ -n "${DOMAIN}" ]; then
    ufw allow "${PORT}/tcp" >/dev/null 2>&1 || true      # public port (nginx; TLS if SSL)
    # internal node port stays firewalled OFF — reachable only via nginx/localhost
  else
    ufw allow "${PORT}/tcp" >/dev/null 2>&1 || true
  fi
fi

# ---------- final summary: entry links in the https://Domain:Port form ----------
echo ""
echo "=============================="
echo " Installation complete"
if [ -n "${DOMAIN}" ]; then
  if [ "${SSL_MODE}" = "1" ] && grep -q "listen ${PORT} ssl" /etc/nginx/sites-available/vpnshop 2>/dev/null; then
    SHOP_URL="https://${DOMAIN}:${PORT}"
  else
    SHOP_URL="http://${DOMAIN}:${PORT}"
  fi
else
  SHOP_URL="http://$(curl -s --max-time 3 ifconfig.me 2>/dev/null || echo SERVER_IP):${PORT}"
fi
echo ""
echo " Storefront (customers):  ${SHOP_URL}/"
echo " Register:                 ${SHOP_URL}/register"
echo " Login:                    ${SHOP_URL}/login"
echo ""
echo " Admin panel:              ${SHOP_URL}/admin"
echo " Admin username:           ${ADMIN_USER}"
echo " Admin password:           ${ADMIN_PASS}"
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
