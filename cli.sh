#!/usr/bin/env bash
# ============================================================
# vpnshop — bootstrap CLI (works BEFORE the shop is installed)
#
# Run it anywhere with:
#   bash <(curl -fsSL https://raw.githubusercontent.com/amir12120/vpnshop/main/cli.sh)
#
# Opens the interactive manager immediately. "Install" is one of the
# menu options; every other option (SSL manager, uninstall, doctor,
# ports, backup, ...) is available right after installation too.
#
# This file is self-contained on purpose: it works when piped through
# curl on a fresh server that has nothing installed yet.
# ============================================================
set -euo pipefail

VERSION="1.3.0"
REPO_OWNER="amir12120"
REPO_NAME="vpnshop"
BRANCH="${VPN_SHOP_BRANCH:-main}"
RAW="https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${BRANCH}"
APP_DIR="${VPN_SHOP_APP_DIR:-/opt/vpnshop}"

c_ok="\033[32m"; c_bad="\033[31m"; c_acc="\033[36m"; c_acc2="\033[35m"
c_dim="\033[2m"; c_bold="\033[1m"; c_off="\033[0m"

ok()    { echo -e " ${c_ok}✔${c_off} $*"; }
err()   { echo -e " ${c_bad}✘${c_off} $*" >&2; }
info()  { echo -e " ${c_acc}➜${c_off} $*"; }
warn()  { echo -e " ${c_bad}⚠${c_off} $*"; }
dim()   { echo -e " ${c_dim}$*${c_off}"; }
hr()    { echo -e "${c_dim}──────────────────────────────────────────────${c_off}"; }

cli_installed() { command -v vpnshop >/dev/null 2>&1; }

# ---------------------------------------------------------------- install
# Downloads INSTALL.sh and executes it (stdin passes through, so
# `printf 'answers' | bash cli.sh install` works non-interactively).
run_install() {
  echo ""
  echo -e "${c_bold}${c_acc}==> VPN Shop Installer${c_off}"
  echo "    downloading INSTALL.sh from GitHub (${BRANCH})..."
  local tmp
  tmp=$(mktemp /tmp/vpnshop-install.XXXXXX.sh)
  if ! curl -fsSL --max-time 120 --retry 2 -o "$tmp" "${RAW}/INSTALL.sh"; then
    rm -f "$tmp"
    err "could not download INSTALL.sh — check internet/DNS on this server"
    exit 1
  fi
  bash "$tmp"
  local rc=$?
  rm -f "$tmp"
  exit $rc
}

# ---------------------------------------------------------------- delegate to installed CLI
run_cli_cmd() {
  if ! cli_installed; then
    err "the vpnshop CLI is not installed yet on this server."
    echo ""
    echo "   Choose  1) Install   to set up the shop first —"
    echo "  after installation every option here works from the menu."
    return 1
  fi
  shift
  vpnshop "$@"
}

# ---------------------------------------------------------------- menu
banner() {
  clear 2>/dev/null || true
  echo ""
  echo -e "${c_acc}   ██╗   ██╗██████╗ ███╗   ██╗███████╗██╗  ██╗ ██████╗ ██████╗ ${c_off}"
  echo -e "${c_acc2}   ██║   ██║██╔══██╗████╗  ██║██╔════╝██║  ██║██╔═══██╗██╔══██╗${c_off}"
  echo -e "${c_acc}   ██║   ██║██████╔╝██╔██╗ ██║███████╗███████║██║   ██║██████╔╝${c_off}"
  echo -e "${c_acc2}   ╚██╗ ██╔╝██╔═══╝ ██║╚██╗██║╚════██║██╔══██║██║   ██║██╔═══╝ ${c_off}"
  echo -e "${c_acc}    ╚████╔╝ ██║     ██║ ╚████║███████║██║  ██║╚██████╔╝██║     ${c_off}"
  echo -e "${c_acc2}     ╚═══╝  ╚═╝     ╚═╝  ╚═══╝╚══════╝╚═╝  ╚═╝ ╚═════╝ ╚═╝     ${c_off}"
  echo ""
  echo -e "${c_dim}   VPN config shop manager — v${VERSION}${c_off}"
  if cli_installed; then
    local v; v=$(vpnshop --version 2>/dev/null || echo '?')
    ok "CLI installed: ${v}  |  app: ${APP_DIR}"
  else
    warn "shop NOT installed yet — choose 1) Install to set it up"
  fi
  hr
}

menu() {
  while true; do
    banner
    echo -e " ${c_bold}1)${c_off}  ${c_acc}Install${c_off}            install the shop on this server (domain / port / admin)"
    echo -e " ${c_bold}2)${c_off}  Update               pull the latest version from GitHub & restart"
    echo -e " ${c_bold}3)${c_off}  ${c_acc}SSL manager${c_off}        Let's Encrypt, renewal, status, remove"
    echo -e " ${c_bold}4)${c_off}  Status               service, endpoints (https://Domain:Port), disk"
    echo -e " ${c_bold}5)${c_off}  Doctor               health check: DB, panels/tunnel, uploads, CLI"
    echo -e " ${c_bold}6)${c_off}  Ports                list listening ports (tunnel conflict check)"
    echo -e " ${c_bold}7)${c_off}  Backup / Restore     database + receipts + configs"
    echo -e " ${c_bold}8)${c_off}  Admin user           create / reset admin username & password"
    echo -e " ${c_bold}9)${c_off}  ${c_bad}Uninstall${c_off}          stop & remove service — data is KEPT (--purge deletes it)"
    echo -e " ${c_bold}0)${c_off}  Exit"
    hr
    read -rp "  choice: " a
    case "$a" in
      1|i|install)          run_install ;;
      2|u|update)           run_cli_cmd update ;;
      3|s|ssl)              run_cli_cmd ssl ;;
      4|st|status)          run_cli_cmd status ;;
      5|d|doctor)           run_cli_cmd doctor ;;
      6|p|ports)            run_cli_cmd ports ;;
      7|b|backup)           run_cli_cmd backup ;;
      8|a|admin)            read -rp "  username: " cu; read -rsp "  password: " cp; echo; run_cli_cmd admin "$cu" "$cp" ;;
      9|uninstall)          run_cli_cmd uninstall ;;
      0|q|quit|exit)        echo -e "${c_dim}bye 👋${c_off}"; exit 0 ;;
      *)                    warn "unknown option: $a" ;;
    esac
    read -rp "  [press Enter to continue] " _ 2>/dev/null || true
  done
}

# ---------------------------------------------------------------- subcommand dispatch
case "${1:-}" in
  install|-i)        run_install ;;
  help|-h|--help)    echo "vpnshop bootstrap CLI v${VERSION} — run \`vpnshop help\` after installing for the full command list"; exit 0 ;;
  --version|-v|version) echo "vpnshop bootstrap CLI v${VERSION}"; exit 0 ;;
  update|ssl|status|doctor|ports|backup|restore|admin|uninstall|port|logs|start|stop|restart)
    run_cli_cmd "$@" ;;
  *) menu ;;
esac