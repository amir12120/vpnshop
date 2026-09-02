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

VERSION="1.4.0"
APP_DIR="${VPN_SHOP_APP_DIR:-/opt/vpnshop}"
SERVICE="vpnshop"
NGINX_SITE="/etc/nginx/sites-available/vpnshop"
NGINX_ENABLED="/etc/nginx/sites-enabled/vpnshop"

c_ok="\033[32m"; c_bad="\033[31m"; c_info="\033[36m"; c_dim="\033[2m"; c_off="\033[0m"
ok()   { echo -e " ${c_ok}✔${c_off} $*"; }
err()  { echo -e " ${c_bad}✘${c_off} $*" >&2; }
info() { echo -e " ${c_info}➜${c_off} $*"; }
dim()  { echo -e " ${c_dim}$*${c_off}"; }
warn() { echo -e " ${c_bad}⚠${c_off} $*"; }
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
get_public_port() {  # public port nginx listens on in domain mode (empty = IP:PORT mode)
  [ -f "$NGINX_SITE" ] || return 0
  local p
  p=$(grep -oP 'listen\s+\K\d+(?=\s+ssl)' "$NGINX_SITE" 2>/dev/null | head -1)
  if [ -z "$p" ]; then
    p=$(grep -oP 'listen\s+\K\d+' "$NGINX_SITE" 2>/dev/null | grep -v '^80$' | head -1)
  fi
  [ -n "$p" ] && echo "$p"
}

# ---------------------------------------------------------------- service
cmd_status() {
  echo -e "${c_info}── Service ──${c_off}"
  systemctl is-active "$SERVICE" >/dev/null 2>&1 && ok "vpnshop: running" || err "vpnshop: NOT running"
  systemctl is-enabled "$SERVICE" >/dev/null 2>&1 && ok "vpnshop: enabled (starts on boot)" || dim "vpnshop: disabled"
  echo -e "\n${c_info}── Endpoints ──${c_off}"
  local port; port=$(get_port); local domain; domain=$(get_domain)
  local pub; pub=$(get_public_port)
  dim " backend:  http://127.0.0.1:${port} (node, internal)"
  if [ -n "$domain" ] && [ -n "$pub" ]; then
    if grep -q "listen ${pub} ssl" "$NGINX_SITE" 2>/dev/null; then
      ok " public:   https://${domain}:${pub}"
    else
      dim " public:   http://${domain}:${pub}"
    fi
    dim " admin:    .../admin  |  register: .../register"
  elif [ -n "$domain" ]; then
    dim " domain:   ${domain} (nginx)"
  else
    dim " public:   http://SERVER_IP:${port} (no domain — node serves directly)"
  fi
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
  local mode; mode=$(cat "$APP_DIR/.repo-fetch-mode" 2>/dev/null || echo git)

  tarball_refresh() {
    local tmp; tmp=$(mktemp -d)
    curl -fsSL --max-time 120 --retry 2 -o "$tmp/src.tar.gz" \
      "https://codeload.github.com/amir12120/vpnshop/tar.gz/refs/heads/main" || { rm -rf "$tmp"; return 1; }
    tar -xzf "$tmp/src.tar.gz" -C "$tmp" --strip-components=1 || { rm -rf "$tmp"; return 1; }
    rsync -a --delete --exclude data --exclude node_modules --exclude public/uploads \
      --exclude .repo-fetch-mode "$tmp/" "$APP_DIR/"
    rm -rf "$tmp"
  }

  local updated=0
  if [ -d "$APP_DIR/.git" ]; then
    cd "$APP_DIR"
    # app dir is owned by www-data; root git commands need safe.directory
    git config --global --get-all safe.directory 2>/dev/null | grep -qx "$APP_DIR" || \
      git config --global --add safe.directory "$APP_DIR"
    if git -c credential.helper= -c credential.helper='' fetch origin main 2>/dev/null; then
      local behind; behind=$(git rev-list HEAD..origin/main --count)
      if [ "$behind" = "0" ]; then
        ok "already up to date"
      else
        git reset --hard origin/main
        updated=1
        ok "pulled ${behind} new commit(s)"
      fi
    else
      warn "git fetch failed (RPC 401 class) — falling back to tarball"
      tarball_refresh || { err "tarball download also failed — check server internet"; exit 1; }
      updated=1
    fi
  else
    # tarball-based install (no .git) — refresh in place, keep data/uploads
    info "tarball install — refreshing from GitHub..."
    tarball_refresh || { err "tarball download failed — check server internet"; exit 1; }
    updated=1
  fi

  if [ "$updated" = "1" ]; then
    info "installing dependencies..."
    (cd "$APP_DIR" && npm install --omit=dev --no-audit --no-fund)
    systemctl restart "$SERVICE"
    ok "updated and restarted"
  fi
  # keep the CLI itself current (self-heal for installs made before the CLI existed)
  install -m 0755 "$APP_DIR/vpnshop-cli.sh" /usr/local/bin/vpnshop
  sed -i 's/\r$//' /usr/local/bin/vpnshop
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
  local p="${1:-}"; [[ "$p" =~ ^[0-9]+$ ]] || { err "usage: vpnshop port <new-public-port>"; exit 1; }
  if [ -f "$NGINX_SITE" ] && [ -n "$(get_domain)" ]; then
    # domain mode: the user-chosen port is nginx's public listener
    local old; old=$(get_public_port)
    sed -i "s/^    listen [0-9]*\( ssl\)\?;/    listen ${p}\1;/" "$NGINX_SITE"
    nginx -t >/dev/null 2>&1 && systemctl reload nginx \
      || { err "nginx config error — reverting"; [ -n "$old" ] && sed -i "s/^    listen [0-9]*\( ssl\)\?;/    listen ${old}\1;/" "$NGINX_SITE" && systemctl reload nginx; exit 1; }
    ok "public port is now ${p} (backend stays internal)"
  else
    # IP:PORT mode: node serves the public port directly
    sed -i "s/^Environment=PORT=.*/Environment=PORT=${p}/" /etc/systemd/system/${SERVICE}.service
    systemctl daemon-reload && systemctl restart "$SERVICE"
    ok "shop now runs on port $p"
  fi
}

# ---------------------------------------------------------------- ssl manager
ssl_status() {
  local domain; domain=$(get_domain)
  local pub; pub=$(get_public_port)
  echo -e "${c_info}── SSL status ──${c_off}"
  if command -v certbot >/dev/null 2>&1; then certbot certificates 2>/dev/null || true; fi
  if [ -n "$domain" ] && [ -n "$pub" ] && grep -q "listen ${pub} ssl" "$NGINX_SITE" 2>/dev/null; then
    ok "shop address: https://${domain}:${pub}"
    echo | timeout 5 openssl s_client -connect "${domain}:${pub}" -servername "$domain" 2>/dev/null \
      | openssl x509 -noout -dates -issuer 2>/dev/null | sed 's/^/ /' || dim " (cert not reachable from this host)"
  elif [ -n "$domain" ]; then
    dim "HTTP only on port ${pub:-80} — enable with: vpnshop ssl letsencrypt ${domain}"
  else
    dim "no domain configured — SSL manager needs a domain"
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

write_ssl_vhost() {  # $1 = domain, $2 = public port — TLS on the user's port, proxy to node
  local domain="$1" pport="$2"
  cat >"$NGINX_SITE" <<EOF
server {
    listen ${pport} ssl;
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

issue_cert() {  # $1 = domain — standalone issuance, nginx stopped around the challenge
  local domain="$1" stopped_nginx=0 holder
  if holder=$(port80_holder) && [ -n "$holder" ]; then
    if [ "$holder" = "nginx" ]; then
      echo "  port 80 is held by nginx — stopping it temporarily for the challenge..."
      systemctl stop nginx
      stopped_nginx=1
    else
      echo "!! port 80 is held by '$holder' (not nginx) — the challenge needs port 80."
      echo "   Free port 80 first, then retry."
      return 1
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
  [ "$cert_ok" = "1" ]
}

install_renewal_hooks() {
  # standalone renewal needs port 80: stop/start nginx around each renewal
  mkdir -p /etc/letsencrypt/renewal-hooks/pre /etc/letsencrypt/renewal-hooks/post
  printf '#!/bin/sh\nsystemctl stop nginx\n'  > /etc/letsencrypt/renewal-hooks/pre/vpnshop-standalone
  printf '#!/bin/sh\nsystemctl start nginx\n' > /etc/letsencrypt/renewal-hooks/post/vpnshop-standalone
  chmod +x /etc/letsencrypt/renewal-hooks/pre/vpnshop-standalone /etc/letsencrypt/renewal-hooks/post/vpnshop-standalone
  systemctl enable --now certbot.timer >/dev/null 2>&1 || true
  ok "auto-renew timer active (hooks stop/start nginx around renewals)"
}

ssl_letsencrypt() {  # [--port N] [domain] — shop address becomes https://Domain:N
  need_root
  local domain="" pport=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --port) pport="$2"; shift 2 ;;
      *)      domain="$1"; shift ;;
    esac
  done
  domain="${domain:-$(get_domain)}"
  [ -n "$domain" ] || { err "usage: vpnshop ssl letsencrypt [--port N] <domain>"; exit 1; }
  command -v certbot >/dev/null 2>&1 || apt-get install -y certbot
  if [ -z "$pport" ]; then
    pport=$(get_public_port)
    if [ -z "$pport" ]; then
      read -rp "Public port for https://${domain}:PORT [8443]: " pport
      pport=${pport:-8443}
    fi
  fi

  info "checking port 80 before issuing the certificate..."
  issue_cert "$domain" || { err "certificate issuance failed — check DNS points to this server"; return 1; }

  write_ssl_vhost "$domain" "$pport"
  nginx -t >/dev/null 2>&1 && {
    systemctl enable --now nginx >/dev/null 2>&1 || true
    systemctl reload nginx 2>/dev/null || systemctl restart nginx
  } \
    && ok "HTTPS enabled: https://${domain}:${pport}"
  install_renewal_hooks
}

ssl_remove() {
  need_root
  local domain; domain=$(get_domain)
  local pub; pub=$(get_public_port)
  [ -f "$NGINX_SITE" ] || { err "nginx site not found"; exit 1; }
  confirm "remove HTTPS and revert ${domain:-site} to plain HTTP on port ${pub:-80}?" || return 0
  cat >"$NGINX_SITE" <<EOF
server {
    listen ${pub:-80};
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
  nginx -t >/dev/null 2>&1 && systemctl reload nginx && ok "reverted to HTTP on port ${pub:-80}"
  if command -v certbot >/dev/null 2>&1 && [ -n "$domain" ]; then
    confirm "also delete the certbot certificate for ${domain}?" && certbot delete --cert-name "$domain" --non-interactive || true
  fi
}
cmd_ssl() {
  need_root
  case "${1:-menu}" in
    status)      ssl_status ;;
    renew)       ssl_renew ;;
    letsencrypt|issue) shift || true; ssl_letsencrypt "$@" ;;
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
  if command -v ss >/dev/null 2>&1; then
    ss -tlnp | sed 's/^/ /'
  elif netstat -tlnp >/dev/null 2>&1; then
    netstat -tlnp | sed 's/^/ /'
  elif command -v netstat >/dev/null 2>&1; then
    netstat -an | grep -i listen | sed 's/^/ /'
  else
    dim "no ss/netstat found — can't list ports"
  fi
  echo ""
  dim " shop port: $(get_port) | shop must NOT share a port with tunnel listeners"
}

# ---------------------------------------------------------------- uninstall
# DEFAULT: FULL removal — service, unit, nginx site, certificates and the app
# directory INCLUDING the database + receipts are deleted, so a fresh install
# starts clean. Two confirmation prompts guard it.
#   --keep-data  only stops the service; every file (DB, receipts, nginx) stays
#   --purge      alias for the default full removal (kept for older habits)
cmd_uninstall() {
  need_root
  local keep=false full=false
  for a in "$@"; do
    [ "$a" = "--keep-data" ] && keep=true
    [ "$a" = "--purge" ] && full=true
  done
  $keep && full=false

  if $full; then
    echo -e "${c_bad}FULL uninstall: service, nginx site, certificates and /opt/vpnshop (database + receipts) will be DELETED.${c_off}"
    confirm "delete the whole installation, including the database?" || { dim "aborted"; return 0; }
  else
    echo -e "${c_bad}This stops the shop service.${c_off}"
    dim "Your data is NOT touched: database, receipts, app files and nginx config stay."
    dim "To bring the shop back later, run:  vpnshop install"
    confirm "stop the vpnshop service?" || { dim "aborted"; return 0; }
  fi

  systemctl disable --now "$SERVICE" 2>/dev/null || true
  ok "service vpnshop stopped and disabled (starts on boot: off)"

  if $full; then
    rm -f /etc/systemd/system/${SERVICE}.service && systemctl daemon-reload
    rm -f "$NGINX_ENABLED" "$NGINX_SITE" 2>/dev/null || true
    nginx -t >/dev/null 2>&1 && systemctl reload nginx || true
    ok "service unit and nginx site removed"
    if command -v certbot >/dev/null 2>&1; then
      local domain; domain=$(get_domain)
      [ -n "$domain" ] && confirm "delete Let's Encrypt cert for ${domain}?" && certbot delete --cert-name "$domain" --non-interactive || true
    fi
    confirm "delete /opt/vpnshop (database + receipts)?" && rm -rf "$APP_DIR" && ok "app directory deleted"
    ok "uninstall complete — nothing remains. A fresh install starts with an empty database"
  else
    dim "kept: ${APP_DIR} (app + data), nginx site, certificates"
    ok "uninstall (keep-data) complete — data preserved. Full wipe: vpnshop uninstall"
  fi
}

# ---------------------------------------------------------------- (re)install in place
cmd_install() {
  need_root
  [ -f "$APP_DIR/INSTALL.sh" ] || { err "INSTALL.sh not found at $APP_DIR — re-run the one-liner:"; echo "  bash <(curl -fsSL https://raw.githubusercontent.com/amir12120/vpnshop/main/cli.sh)"; exit 1; }
  confirm "run the installer now (existing data in $APP_DIR will be kept)?" || { dim "aborted"; return 0; }
  cd "$APP_DIR" && bash INSTALL.sh
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
  vpnshop ssl letsencrypt [--port N] <d>
                               enable HTTPS — shop becomes https://Domain:Port
                               (default port: the one already configured)
  vpnshop ssl renew            force renew certificates now
  vpnshop ssl remove           revert to plain HTTP
  vpnshop doctor               health check: DB, panels/tunnel reachability, uploads
  vpnshop ports                list all listening ports (tunnel conflict check)
  vpnshop install              re-run the installer (keeps existing data)
  vpnshop uninstall            FULL removal — service, nginx, certs and the
                               database are deleted (asks for confirmation)
  vpnshop uninstall --keep-data  stop the service only, keep all data/files
  vpnshop help                 this help
EOF
}
cmd_menu() {
  while true; do
    echo ""
    echo -e "${c_info}═══ VPN Shop Manager ═══${c_off}"
    echo " 1) status         5) backup         9)  ssl manager    13) ports"
    echo " 2) restart        6) restore        10) change port"
    echo " 3) logs           7) update         11) reset admin password"
    echo " 4) info/help      8) admin user     12) doctor (tunnel/panel check)"
    echo " 14) re-install (keeps data)            0) exit  (u = uninstall, full removal)"
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
      14) cmd_install ;;
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
  install)  cmd_install ;;
  uninstall) shift || true; cmd_uninstall "$@" ;;
  menu|"")  cmd_menu ;;   # `vpnshop` alone opens the interactive menu
  *) err "unknown command: $1"; usage; exit 1 ;;
esac
