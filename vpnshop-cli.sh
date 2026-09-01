#!/usr/bin/env bash
# ============================================================
# vpnshop — management CLI for the VPN Config Shop
# Installed to /usr/local/bin/vpnshop by INSTALL.sh
#
# Usage: vpnshop <command> [args]
# Run `vpnshop help` for the command list, or `vpnshop` alone
# for the interactive menu.
# ============================================================
set -euo pipefail

VERSION="1.1.0"
APP_DIR="${VPN_SHOP_APP_DIR:-/opt/vpnshop}"
SERVICE="vpnshop"
NGINX_SITE="/etc/nginx/sites-available/vpnshop"
NGINX_ENABLED="/etc/nginx/sites-enabled/vpnshop"

c_ok="\033[32m"; c_bad="\033[31m"; c_info="\033[36m"; c_dim="\033[2m"; c_off="\033[0m"
ok()   { echo -e " ${c_ok}✔${c_off} $*"; }
err()  { echo -e " ${c_bad}✘${c_off} $*" >&2; }
info() { echo -e " ${c_info}➜${c_off} $*"; }
dim()  { echo -e " ${c_dim}$*${c_off}"; }
confirm() {
  local q="$1" def="${2:-n}" a
  read -rp "$q [$([ "$def" = y ] && echo Y/n || echo y/N)]: " a
  a="${a:-$def}"; [[ "$a" =~ ^[Yy] ]]
}
need_root() {
  [ "$(id -u)" -eq 0 ] || { err "run as root: sudo vpnshop $*"; exit 1; }
}
get_domain() { grep -oP 'server_name\s+\K[^;]+' "$NGINX_SITE" 2>/dev/null | awk '{print $1}' || true; }
get_port()   { grep -oP 'Environment=PORT=\K\d+' /etc/systemd/system/${SERVICE}.service 2>/dev/null || echo 3000; }

# ---------------------------------------------------------------- service
cmd_status() {
  echo -e "${c_info}── Service ──${c_off}"
  systemctl is-active "$SERVICE" >/dev/null 2>&1 && ok "vpnshop: running" || err "vpnshop: NOT running"
  systemctl is-enabled "$SERVICE" >/dev/null 2>&1 && ok "vpnshop: enabled (starts on boot)" || dim "vpnshop: disabled"
  echo -e "\n${c_info}── Endpoints ──${c_off}"
  local port; port=$(get_port); local domain; domain=$(get_domain)
  dim " local:   http://127.0.0.1:${port}"
  [ -n "$domain" ] && dim " domain:  ${domain} (nginx)"
  echo -e "\n${c_info}── Disk ──${c_off}"
  du -sh "$APP_DIR/data" "$APP_DIR/public/uploads" 2>/dev/null | sed 's/^/ /' || true
}
cmd_start()    { need_root; systemctl start "$SERVICE"; ok "started"; }
cmd_stop()     { need_root; systemctl stop "$SERVICE"; ok "stopped"; }
cmd_restart()  { need_root; systemctl restart "$SERVICE"; ok "restarted"; }
cmd_logs()     { journalctl -u "$SERVICE" -n "${1:-50}" --no-pager; }

# ---------------------------------------------------------------- update
cmd_update() {
  need_root
  info "pulling latest code..."
  cd "$APP_DIR"
  # app dir is owned by www-data; root git commands need safe.directory
  git config --global --get-all safe.directory 2>/dev/null | grep -qx "$APP_DIR" || \
    git config --global --add safe.directory "$APP_DIR"
  git fetch origin main
  local behind; behind=$(git rev-list HEAD..origin/main --count)
  if [ "$behind" = "0" ]; then ok "already up to date"; else
    git reset --hard origin/main
    info "installing dependencies..."
    npm install --omit=dev --no-audit --no-fund
    systemctl restart "$SERVICE"
    ok "updated and restarted (${behind} new commit(s))"
  fi
  # keep the CLI itself current (self-heal for installs made before the CLI existed)
  install -m 0755 "$APP_DIR/vpnshop-cli.sh" /usr/local/bin/vpnshop
  ok "CLI refreshed: $(command -v vpnshop)"
}

# ---------------------------------------------------------------- backup / restore
cmd_backup() {
  need_root
  local out="${1:-${APP_DIR}-backup-$(date +%F-%H%M).tar.gz}"
  tar czf "$out" -C / "opt/vpnshop/data" "opt/vpnshop/public/uploads" \
    /etc/systemd/system/${SERVICE}.service "$NGINX_SITE" 2>/dev/null
  ok "backup saved: $out ($(du -h "$out" | cut -f1))"
  dim " includes: database, receipts, service file, nginx site"
}
cmd_restore() {
  need_root
  local f="${1:-}"; [ -f "$f" ] || { err "usage: vpnshop restore <backup.tar.gz>"; exit 1; }
  confirm "stop service and restore from $f?" || return 0
  systemctl stop "$SERVICE" || true
  tar xzf "$f" -C /
  systemctl daemon-reload; systemctl restart "$SERVICE"
  ok "restored and restarted"
}

# ---------------------------------------------------------------- admin
cmd_admin() {
  need_root
  [ $# -eq 2 ] || { err "usage: vpnshop admin <username> <new-password>"; exit 1; }
  cd "$APP_DIR" && node seed-admin.js "$1" "$2" && ok "admin '$1' set"
}

# ---------------------------------------------------------------- port
cmd_port() {
  need_root
  local p="${1:-}"; [[ "$p" =~ ^[0-9]+$ ]] || { err "usage: vpnshop port <new-port>"; exit 1; }
  sed -i "s/^Environment=PORT=.*/Environment=PORT=${p}/" /etc/systemd/system/${SERVICE}.service
  if [ -f "$NGINX_SITE" ]; then
    sed -i "s|proxy_pass http://127.0.0.1:[0-9]*;|proxy_pass http://127.0.0.1:${p};|" "$NGINX_SITE"
    nginx -t >/dev/null 2>&1 && systemctl reload nginx || { err "nginx config error — check manually"; }
  fi
  systemctl daemon-reload && systemctl restart "$SERVICE"
  ok "shop now runs on port $p"
}

# ---------------------------------------------------------------- ssl manager
ssl_status() {
  local domain; domain=$(get_domain)
  echo -e "${c_info}── SSL status ──${c_off}"
  if command -v certbot >/dev/null 2>&1; then certbot certificates 2>/dev/null || true; fi
  if [ -n "$domain" ] && grep -q "443 ssl" "$NGINX_SITE" 2>/dev/null; then
    ok "nginx: HTTPS enabled for ${domain}"
    echo | timeout 5 openssl s_client -connect "${domain}:443" -servername "$domain" 2>/dev/null \
      | openssl x509 -noout -dates -issuer 2>/dev/null | sed 's/^/ /' || dim " (cert not reachable from this host)"
  else
    dim "nginx: HTTP only (no SSL configured)"
  fi
  systemctl is-active certbot.timer >/dev/null 2>&1 && ok "auto-renew: certbot.timer active" || dim "auto-renew: timer not found"
}
ssl_renew() {
  need_root
  command -v certbot >/dev/null 2>&1 || { err "certbot not installed — use: vpnshop ssl letsencrypt <domain>"; exit 1; }
  info "renewing..."
  certbot renew --force-renewal && systemctl reload nginx && ok "renewed and nginx reloaded"
}
port80_holder() {  # prints the process name holding port 80, empty if free
  ss -tlnp "sport = :80" 2>/dev/null | grep -oP 'users:\(\("\K[^"]+' | head -1
}

write_ssl_vhost() {  # $1 = domain — rewrite vhost: 80 redirects to 443 ssl
  local domain="$1"
  cat >"$NGINX_SITE" <<EOF
server {
    listen 80;
    server_name ${domain};
    return 301 https://\$host\$request_uri;
}
server {
    listen 443 ssl;
    server_name ${domain};
    ssl_certificate /etc/letsencrypt/live/${domain}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${domain}/privkey.pem;
    client_max_body_size 12m;
    location / {
        proxy_pass http://127.0.0.1:$(get_port);
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF
}

ssl_letsencrypt() {
  need_root
  local domain="${1:-$(get_domain)}"
  [ -n "$domain" ] || { err "usage: vpnshop ssl letsencrypt <domain>"; exit 1; }
  command -v certbot >/dev/null 2>&1 || apt-get install -y certbot
  info "checking port 80 before issuing the certificate..."

  local stopped_nginx=0 holder
  if holder=$(port80_holder) && [ -n "$holder" ]; then
    if [ "$holder" = "nginx" ]; then
      echo "  port 80 is held by nginx — stopping it temporarily for the challenge..."
      systemctl stop nginx
      stopped_nginx=1
    else
      echo "!! port 80 is held by '$holder' (not nginx) — the challenge needs port 80."
      echo "   Free port 80 first, then retry:  vpnshop ssl letsencrypt $domain"
      exit 1
    fi
  else
    echo "  port 80 is free."
  fi

  local cert_ok=0
  if certbot certonly --standalone -d "$domain" --non-interactive --agree-tos \
       --keep-until-expiring -m "admin@${domain#*.}"; then
    cert_ok=1
  fi

  # always bring nginx back up, cert or no cert
  if [ "$stopped_nginx" = "1" ]; then
    systemctl start nginx && ok "nginx restarted"
  fi
  [ "$cert_ok" = "1" ] || { err "certificate issuance failed — check DNS points to this server"; return 1; }

  write_ssl_vhost "$domain"
  nginx -t >/dev/null 2>&1 && systemctl reload nginx && ok "HTTPS enabled for ${domain} (80 -> 443)"

  # standalone renewal needs port 80: stop/start nginx around each renewal
  mkdir -p /etc/letsencrypt/renewal-hooks/pre /etc/letsencrypt/renewal-hooks/post
  printf '#!/bin/sh\nsystemctl stop nginx\n'  > /etc/letsencrypt/renewal-hooks/pre/vpnshop-standalone
  printf '#!/bin/sh\nsystemctl start nginx\n' > /etc/letsencrypt/renewal-hooks/post/vpnshop-standalone
  chmod +x /etc/letsencrypt/renewal-hooks/pre/vpnshop-standalone /etc/letsencrypt/renewal-hooks/post/vpnshop-standalone
  systemctl enable --now certbot.timer >/dev/null 2>&1 || true
  ok "auto-renew timer active (hooks stop/start nginx around renewals)"
}
ssl_remove() {
  need_root
  local domain; domain=$(get_domain)
  [ -f "$NGINX_SITE" ] || { err "nginx site not found"; exit 1; }
  confirm "remove HTTPS and revert ${domain:-site} to plain HTTP?" || return 0
  cat >"$NGINX_SITE" <<EOF
server {
    listen 80;
    server_name ${domain:-_};
    client_max_body_size 12m;
    location / {
        proxy_pass http://127.0.0.1:$(get_port);
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF
  nginx -t >/dev/null 2>&1 && systemctl reload nginx && ok "reverted to HTTP"
  if command -v certbot >/dev/null 2>&1 && [ -n "$domain" ]; then
    confirm "also delete the certbot certificate for ${domain}?" && certbot delete --cert-name "$domain" --non-interactive || true
  fi
}
cmd_ssl() {
  need_root
  case "${1:-menu}" in
    status)      ssl_status ;;
    renew)       ssl_renew ;;
    letsencrypt) shift || true; ssl_letsencrypt "${1:-}" ;;
    remove)      ssl_remove ;;
    menu|"")
      while true; do
        echo ""
        echo -e "${c_info}═══ SSL Manager ═══${c_off}"
        echo " 1) status                      - show certificates & expiry"
        echo " 2) install/renew Let's Encrypt - enable HTTPS for a domain"
        echo " 3) force renew                 - renew all certificates now"
        echo " 4) remove SSL                  - revert to plain HTTP"
        echo " 0) back"
        read -rp "choice: " a
        case "$a" in
          1) ssl_status ;;
          2) read -rp "domain [$(get_domain)]: " d; ssl_letsencrypt "${d:-$(get_domain)}" ;;
          3) ssl_renew ;;
          4) ssl_remove ;;
          0) break ;;
        esac
      done ;;
    *) err "unknown ssl command: $1"; exit 1 ;;
  esac
}

# ---------------------------------------------------------------- doctor / ports
cmd_doctor() {
  # CLI installation sanity
  if command -v vpnshop >/dev/null 2>&1; then
    ok "CLI installed: $(command -v vpnshop) ($(vpnshop --version 2>/dev/null || echo '?'))"
    if grep -q $'\r' /usr/local/bin/vpnshop 2>/dev/null; then
      err "CLI file has Windows CRLF line endings — fixing now"
      sed -i 's/\r$//' /usr/local/bin/vpnshop && chmod +x /usr/local/bin/vpnshop && ok "CRLF stripped, try again"
    fi
  else
    err "CLI not installed at /usr/local/bin/vpnshop — install it with:"
    echo "      sudo install -m 0755 $APP_DIR/vpnshop-cli.sh /usr/local/bin/vpnshop"
  fi
  cd "$APP_DIR" && node scripts/doctor.js
}
cmd_ports() {
  echo -e "${c_info}── Listening ports ──${c_off}"
  if command -v ss >/dev/null 2>&1; then ss -tlnp | sed 's/^/ /'; else netstat -tlnp | sed 's/^/ /'; fi
  echo ""
  dim " shop port: $(get_port) | shop must NOT share a port with tunnel listeners"
}

# ---------------------------------------------------------------- uninstall
cmd_uninstall() {
  need_root
  local purge=false
  for a in "$@"; do [ "$a" = "--purge" ] && purge=true; done
  echo -e "${c_bad}This will remove the vpnshop service and nginx site.${c_off}"
  $purge && echo -e "${c_bad}--purge: database, receipts and /opt/vpnshop will be DELETED permanently.${c_off}"
  confirm "continue with uninstall?" || { dim "aborted"; return 0; }

  systemctl disable --now "$SERVICE" 2>/dev/null || true
  rm -f /etc/systemd/system/${SERVICE}.service && systemctl daemon-reload
  rm -f "$NGINX_ENABLED" "$NGINX_SITE" 2>/dev/null || true
  nginx -t >/dev/null 2>&1 && systemctl reload nginx || true
  ok "service and nginx site removed"

  if $purge; then
    if command -v certbot >/dev/null 2>&1; then
      local domain; domain=$(get_domain)
      [ -n "$domain" ] && confirm "delete Let's Encrypt cert for ${domain}?" && certbot delete --cert-name "$domain" --non-interactive || true
    fi
    confirm "delete /opt/vpnshop (database + receipts)?" && rm -rf "$APP_DIR" && ok "app directory deleted"
  else
    dim "kept: $APP_DIR (use --purge to delete)"
  fi
  ok "uninstall complete"
}

# ---------------------------------------------------------------- help / menu
usage() {
  cat <<EOF
vpnshop — management CLI for VPN Config Shop

  vpnshop                      interactive menu
  vpnshop status               service, endpoints, disk usage
  vpnshop start|stop|restart   control the service
  vpnshop logs [n]             last n log lines (default 50)
  vpnshop update               pull latest code from GitHub & restart
  vpnshop port <port>          change the shop port (service + nginx)
  vpnshop admin <user> <pass>  create / reset an admin user
  vpnshop backup [file]        backup database + receipts + configs
  vpnshop restore <file>       restore from a backup
  vpnshop ssl                  interactive SSL manager
  vpnshop ssl status           show certificates & expiry
  vpnshop ssl letsencrypt <d>  enable HTTPS for domain (auto-renew on)
  vpnshop ssl renew            force renew certificates now
  vpnshop ssl remove           revert to plain HTTP
  vpnshop doctor               health check: DB, panels/tunnel reachability, uploads
  vpnshop ports                list all listening ports (tunnel conflict check)
  vpnshop uninstall [--purge]  remove service & nginx site
                               --purge also deletes data, receipts, certs
  vpnshop help                 this help
EOF
}
cmd_menu() {
  while true; do
    echo ""
    echo -e "${c_info}═══ VPN Shop Manager ═══${c_off}"
    echo " 1) status        5) backup         9)  ssl manager"
    echo " 2) restart       6) restore        10) change port"
    echo " 3) logs          7) update         11) reset admin password"
    echo " 4) info/help     8) admin user     12) doctor (tunnel/panel check)"
    echo "                                      13) ports         0) exit  (u = uninstall)"
    read -rp "choice: " a
    case "$a" in
      1) cmd_status ;;  2) cmd_restart ;; 3) read -rp "lines [50]: " n; cmd_logs "${n:-50}" ;;
      4) usage ;;       5) read -rp "output file [auto]: " f; cmd_backup "${f:-}" ;;
      6) read -rp "backup file: " f; cmd_restore "$f" ;;
      7) cmd_update ;;
      8) read -rp "username: " u; read -rsp "password: " p; echo; cmd_admin "$u" "$p" ;;
      9) cmd_ssl ;;
      10) read -rp "new port: " p; cmd_port "$p" ;;
      11) read -rp "username: " u; read -rsp "new password: " p; echo; cmd_admin "$u" "$p" ;;
      12) cmd_doctor ;;
      13) cmd_ports ;;
      u) cmd_uninstall ;;
      0) break ;;
    esac
  done
}

# ---------------------------------------------------------------- dispatch
case "${1:-menu}" in
  help|-h|--help) usage; exit 0 ;;
  --version|-v|version) echo "vpnshop CLI v${VERSION}"; exit 0 ;;
esac
[ -d "$APP_DIR" ] || { err "shop not installed at $APP_DIR — run INSTALL.sh first"; exit 1; }
case "${1:-menu}" in
  status)   cmd_status ;;
  start)    cmd_start ;;
  stop)     cmd_stop ;;
  restart)  cmd_restart ;;
  logs)     shift || true; cmd_logs "${1:-50}" ;;
  update)   cmd_update ;;
  port)     shift || true; cmd_port "${1:-}" ;;
  admin)    shift || true; cmd_admin "${1:-}" "${2:-}" ;;
  backup)   shift || true; cmd_backup "${1:-}" ;;
  restore)  shift || true; cmd_restore "${1:-}" ;;
  ssl)      shift || true; cmd_ssl "${1:-menu}" "${2:-}" ;;
  doctor)   cmd_doctor ;;
  ports)    cmd_ports ;;
  uninstall) shift || true; cmd_uninstall "$@" ;;
  *) err "unknown command: $1"; usage; exit 1 ;;
esac
