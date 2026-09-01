#!/usr/bin/env bash
# ============================================================
# VPN Shop — one-line bootstrap installer
# Usage:
#   bash <(curl -fsSL https://raw.githubusercontent.com/<user>/<repo>/main/install.sh)
# Clones the repo to /opt/vpnshop and runs the interactive INSTALL.sh
# ============================================================
set -euo pipefail

REPO_URL="${VPN_SHOP_REPO:-https://github.com/amir12120/vpnshop.git}"
BRANCH="${VPN_SHOP_BRANCH:-main}"
APP_DIR="/opt/vpnshop"

if [ "$(id -u)" -ne 0 ]; then
  echo "!! با کاربر روت اجرا کنید:  sudo bash install.sh"
  exit 1
fi

if ! grep -qi ubuntu /etc/os-release; then
  echo "!! این اسکریپت برای Ubuntu 22.04 نوشته شده — روی توزیع دیگر دستی نصب کنید."
  exit 1
fi

echo ">> نصب git و curl در صورت نیاز..."
apt-get update -y
apt-get install -y git curl

if [ -d "$APP_DIR/.git" ]; then
  echo ">> نصب موجود است — بروزرسانی..."
  cd "$APP_DIR"
  git fetch origin "$BRANCH"
  git reset --hard "origin/$BRANCH"
else
  echo ">> دانلود مخزن..."
  rm -rf "$APP_DIR"
  git clone --depth 1 -b "$BRANCH" "$REPO_URL" "$APP_DIR"
  cd "$APP_DIR"
fi

echo ">> اجرای نصب تعاملی (دامنه / پورت / SSL / ادمین)..."
bash INSTALL.sh
