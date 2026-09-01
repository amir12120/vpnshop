#!/usr/bin/env bash
# ============================================================
# VPN Shop — all-in-one installer for Ubuntu 22.04 (root)
# Works both ways:
#   1) one-liner:  bash <(curl -fsSL https://raw.githubusercontent.com/amir12120/vpnshop/main/INSTALL.sh)
#   2) inside a checkout:  bash INSTALL.sh
# Prompts for: domain, port, SSL mode, admin username & password.
# ============================================================
set -euo pipefail

APP_DIR=/opt/vpnshop
REPO_URL="${VPN_SHOP_REPO:-https://github.com/amir12120/vpnshop.git}"
BRANCH="${VPN_SHOP_BRANCH:-main}"

# ---------- bootstrap: clone the repo if we're not inside a checkout ----------
if [ ! -f server.js ]; then
  if [ "$(id -u)" -ne 0 ]; then
    echo "!! با کاربر روت اجرا کنید:  sudo bash INSTALL.sh"
    exit 1
  fi
  if ! grep -qi ubuntu /etc/os-release; then
    echo "!! این اسکریپت برای Ubuntu 22.04 نوشته شده — روی توزیع دیگر دستی نصب کنید."
    exit 1
  fi
  echo ">> اجرا از راه دور — نصب git و دریافت مخزن..."
  apt-get update -y
  apt-get install -y git curl rsync
  if [ -d "$APP_DIR/.git" ]; then
    echo ">> نصب موجود است — بروزرسانی..."
    cd "$APP_DIR"
    git fetch origin "$BRANCH"
    git reset --hard "origin/$BRANCH"
  else
    rm -rf "$APP_DIR"
    git clone --depth 1 -b "$BRANCH" "$REPO_URL" "$APP_DIR"
    cd "$APP_DIR"
  fi
  exec bash INSTALL.sh   # ادامه از داخل مخزن
fi

# ---------- interactive prompts ----------
echo "=============================="
echo " VPN Shop — نصب فروشگاه"
echo "=============================="

read -rp "دامنه سایت (مثلاً shop.example.ir) [خالی = فقط IP:PORT]: " DOMAIN
read -rp "پورت اجرای سایت [3000]: " PORT
PORT=${PORT:-3000}
read -rp "نام کاربری ادمین: " ADMIN_USER
while [ -z "${ADMIN_USER}" ]; do read -rp "نام کاربری ادمین: " ADMIN_USER; done
read -rsp "رمز عبور ادمین (حداقل ۸ کاراکتر): " ADMIN_PASS
echo ""
while [ ${#ADMIN_PASS} -lt 8 ]; do read -rsp "رمز کوتاه است، دوباره: " ADMIN_PASS; echo ""; done

SSL_MODE=""
if [ -n "${DOMAIN}" ]; then
  echo "نوع SSL:"
  echo "  1) Let's Encrypt (رایگان — نیاز به DNS و پورت ۸۰ باز)"
  echo "  2) بدون SSL (فقط HTTP — مثلاً اگر CDN/پروکسی خودتان SSL می‌دهد)"
  read -rp "انتخاب [1/2]: " SSL_MODE
fi

# ---------- system deps ----------
echo ">> نصب پیش‌نیازها..."
apt-get update -y
apt-get install -y curl ca-certificates gnupg nginx rsync

if ! command -v node >/dev/null 2>&1 || [ "$(node -v | cut -c2- | cut -d. -f1)" -lt 18 ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
echo ">> node $(node -v)"

# ---------- app ----------
rsync -a --exclude node_modules --exclude data ./ "$APP_DIR/"
cd "$APP_DIR"
npm install --omit=dev --no-audit --no-fund

mkdir -p data public/uploads
chown -R www-data:www-data "$APP_DIR"

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
echo ">> سرویس روی پورت ${PORT} بالا آمد."

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
      echo "!! SSL صادر نشد — DNS را چک کنید (به این سرور اشاره می‌کند؟ پورت ۸۰ باز است؟). بعداً دستی: certbot --nginx -d ${DOMAIN}"
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
echo " نصب کامل شد"
if [ -n "${DOMAIN}" ]; then
  echo " آدرس:  http${SSL_MODE:+s}://${DOMAIN}/"
else
  echo " آدرس:  http://SERVER_IP:${PORT}/"
fi
echo " ورود ادمین:  /admin  (کاربر: ${ADMIN_USER})"
echo " مراحل بعدی:"
echo "   1. /admin/settings → شماره کارت واریز را ثبت کنید"
echo "   2. /admin/panels → پنل سنایی را اضافه و «تست اتصال» بزنید"
echo "   3. /admin/plans → پلن‌ها را تعریف کنید"
echo "=============================="
