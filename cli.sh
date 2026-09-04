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

VERSION="1.4.0"
REPO_OWNER="amir12120"
REPO_NAME="vpnshop"
BRANCH="${VPN_SHOP_BRANCH:-main}"
RAW="https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${BRANCH}"
APP_DIR="${VPN_SHOP_APP_DIR:-/opt/vpnshop}"

c_ok="\033[32m"; c_bad="\033[31m"; c_acc="\033[36m"; c_acc2="\033[35m"
c_dim="\033[2m"; c_bold="\033[1m"; c_off="\033[0m"
c_box="\033[1;36m"   # box frame color for the graphical menu

ok()    { echo -e " ${c_ok}✔${c_off} $*"; }
err()   { echo -e " ${c_bad}✘${c_off} $*" >&2; }
info()  { echo -e " ${c_acc}➜${c_off} $*"; }
warn()  { echo -e " ${c_bad}⚠${c_off} $*"; }
dim()   { echo -e " ${c_dim}$*${c_off}"; }
hr()    { echo -e "${c_dim}──────────────────────────────────────────────${c_off}"; }

# ---------------------------------------------------------------- boxed menu helpers
twidth() {
  local w=80
  if command -v tput >/dev/null 2>&1; then
    w=$(tput cols 2>/dev/null || echo 80)
  fi
  case "$w" in
    ''|*[!0-9]*) w=80 ;;
  esac
  [ "$w" -lt 76 ] && w=76
  [ "$w" -gt 140 ] && w=140
  if [ $((w % 2)) -ne 0 ]; then w=$((w - 1)); fi
  echo "$w"
}
fill() {  # fill <count> <char> — locale-safe repetition
  local n="$1" ch="${2:-═}" out="" i=0
  while [ "$i" -lt "$n" ]; do out="${out}${ch}"; i=$((i + 1)); done
  printf '%s' "$out"
}
center_in() {  # center <text> <width> — pads both sides with spaces
  local t="$1" w="$2" l r
  l=$(( (w - ${#t}) / 2 )); [ "$l" -lt 0 ] && l=0
  r=$(( w - ${#t} - l ));   [ "$r" -lt 0 ] && r=0
  printf '%*s%s%*s' "$l" '' "$t" "$r" ''
}
box_top() {
  local w; w=$(twidth)
  printf "${c_box}╔%s╗${c_off}\n" "$(fill $((w - 2)) ═)"
}
box_bottom() {
  local w; w=$(twidth)
  printf "${c_box}╚%s╝${c_off}\n" "$(fill $((w - 2)) ═)"
}
box_sep() {
  local w; w=$(twidth)
  printf "${c_box}╠%s╣${c_off}\n" "$(fill $((w - 2)) ─)"
}
box_title() {  # box_title <text> [color]
  local w; w=$(twidth)
  local t="$1" col="${2:-$c_acc}" pad
  pad=$(( (w - 2 - ${#t}) / 2 )); [ "$pad" -lt 0 ] && pad=0
  printf "${c_box}║${c_off}%*s" "$pad" ''
  printf "${c_bold}${col}%s${c_off}" "$t"
  printf "%*s${c_box}║${c_off}\n" "$((w - 2 - pad - ${#t}))" ''
}
box_row2() {  # two centered cells: box_row2 <left> <right> [<lcolor> <rcolor>]
  local w; w=$(twidth)
  local l="$1" r="$2" lc="${3:-$c_acc}" rc="${4:-$c_ok}" C cl cr
  C=$(( (w - 6) / 2 ))
  cl=$(center_in "$l" "$C"); cr=$(center_in "$r" "$C")
  printf "${c_box}║${c_off} ${c_bold}${lc}%s${c_off}  ${c_bold}${rc}%s${c_off} ${c_box}║${c_off}\n" "$cl" "$cr"
}

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
    box_top
    box_title "VPN Shop Installer & Manager"
    box_sep
    box_row2 "1) Install"           "6) Ports"
    box_row2 "2) Update"            "7) Backup / Restore"
    box_row2 "3) SSL manager"       "8) Admin user"
    box_row2 "4) Status"            "9) Uninstall (FULL)" "$c_acc" "$c_bad"
    box_row2 "5) Doctor"            "0) Exit" "$c_acc" "$c_dim"
    box_bottom
    dim "  1 installs the shop · type a number and press Enter · 0 = exit"
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