#!/usr/bin/env bash
# ============================================================
# preflight.sh — server check + prerequisites + GitHub test
# Sourced by INSTALL.sh (and usable standalone). On a GitHub
# failure, exposes REPO_FETCH_MODE=git|tarball so the caller
# can fall back to the transport that actually works.
# ============================================================

# ---- shell helpers -------------------------------------------------
PREFLIGHT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

pf_ok()   { echo "   [ok] $*"; }
pf_warn() { echo "   [!!] $*"; }
pf_fail() { echo "   [XX] $*" >&2; }

# ---------------------------------------------------------------------------
# 1) Server sanity check — OS, architecture, root, disk, memory, connectivity
# ---------------------------------------------------------------------------
pf_server_check() {
  echo ">> [1/4] Server check"

  if [ "$(id -u)" -ne 0 ]; then
    pf_fail "not running as root — re-run with: sudo bash $0"
    return 1
  fi
  pf_ok "root privileges"

  if ! grep -qi ubuntu /etc/os-release; then
    pf_warn "not Ubuntu — continuing anyway (target: Ubuntu 22.04)"
  else
    pf_ok "Ubuntu $(. /etc/os-release && echo "${VERSION_ID:-?}")"
  fi

  local arch
  arch=$(uname -m)
  case "$arch" in
    x86_64|aarch64|armv7l) pf_ok "architecture: $arch" ;;
    *) pf_warn "unusual architecture '$arch' — Node may need manual install" ;;
  esac

  # disk: need >= 2 GB free on /
  local avail_kb
  avail_kb=$(df -Pk / | awk 'NR==2 {print $4}')
  if [ "${avail_kb:-0}" -lt 2097152 ]; then
    pf_warn "less than 2 GB free on / ($(df -h / | awk 'NR==2 {print $4}') free) — install may be tight"
  else
    pf_ok "disk: $(df -h / | awk 'NR==2 {print $4}') free on /"
  fi

  # memory: warn below 512 MB total
  local mem_mb
  if [ -r /proc/meminfo ]; then
    mem_mb=$(awk '/^MemTotal:/ {print int($2/1024)}' /proc/meminfo)
    [ "${mem_mb:-0}" -lt 512 ] \
      && pf_warn "low memory: ${mem_mb} MB — nginx + node will still run, but expect tightness" \
      || pf_ok "memory: ${mem_mb} MB"
  fi

  # general internet connectivity
  if curl -fsS --max-time 8 -o /dev/null https://github.com 2>/dev/null; then
    pf_ok "outbound HTTPS works"
  else
    pf_fail "cannot reach https://github.com — check the server's internet/DNS"
    return 1
  fi
  return 0
}

# ---------------------------------------------------------------------------
# 2) Prerequisites — everything needed BEFORE the app is installed
# ---------------------------------------------------------------------------
pf_install_prereqs() {
  echo ">> [2/4] Prerequisites"
  local missing=()

  # binary name -> apt package name
  local bin pkg
  for bin in git curl rsync tar openssl; do
    command -v "$bin" >/dev/null 2>&1 && continue
    case "$bin" in
      openssl) pkg=openssl ;;
      *)       pkg="$bin" ;;
    esac
    missing+=("$pkg")
  done
  [ -f /etc/ssl/certs/ca-certificates.crt ] || missing+=(ca-certificates)

  if [ "${#missing[@]}" -gt 0 ]; then
    echo "   installing missing packages: ${missing[*]}"
    apt-get update -y
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "${missing[@]}"
  fi

  # re-verify
  local still_missing=()
  command -v git     >/dev/null 2>&1 || still_missing+=("git")
  command -v curl    >/dev/null 2>&1 || still_missing+=("curl")
  command -v rsync   >/dev/null 2>&1 || still_missing+=("rsync")
  command -v tar     >/dev/null 2>&1 || still_missing+=("tar")
  if [ "${#still_missing[@]}" -gt 0 ]; then
    pf_fail "could not install: ${still_missing[*]}"
    return 1
  fi

  pf_ok "git     $(git --version | awk '{print $3}')"
  pf_ok "curl    $(curl --version | awk '{print $2}')"
  pf_ok "rsync   $(rsync --version | awk 'NR==1 {print $3}')"
  return 0
}

# ---------------------------------------------------------------------------
# 3) GitHub reachability test — decides REPO_FETCH_MODE=git|tarball
#    Returns 0 when git-clone transport works, 1 when only tarball works,
#    2 when GitHub is unreachable at all (caller should abort).
# ---------------------------------------------------------------------------
pf_github_check() {  # args: <repo-url> <branch>
  local repo="$1" branch="$2"
  echo ">> [3/4] GitHub reachability test"

  local tarball_ok=0
  # a) raw HTTP reachability of codeload (this is what the tarball fallback uses)
  local probe
  probe=$(printf '%s' "$repo" | sed -E 's#^https?://github\.com/##; s#\.git$##')
  if curl -fsS --max-time 12 -o /dev/null \
       "https://codeload.github.com/${probe}/tar.gz/refs/heads/${branch}" 2>/dev/null; then
    tarball_ok=1
    pf_ok "codeload tarball reachable (fallback available)"
  else
    pf_warn "codeload tarball probe failed — will still try both transports"
  fi

  # b) git smart-HTTP probe (this is what fails with 'RPC failed; HTTP 401')
  #    Use ls-remote: it performs the same auth/protocol handshake as clone,
  #    but fetches nothing.
  pf_probe_git() {
    GIT_TERMINAL_PROMPT=0 GIT_ASKPASS=/bin/true \
    GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=credential.helper \
    GIT_CONFIG_VALUE_0= \
      git ls-remote --heads "$repo" "refs/heads/$branch" >/dev/null 2>&1
  }

  if pf_probe_git; then
    REPO_FETCH_MODE=git
    pf_ok "git transport OK — clone will be used"
    return 0
  fi

  # c) git failed — retry with credentials fully stripped (stale helper 401 fix)
  if git config --global --get-all credential.helper >/dev/null 2>&1; then
    pf_warn "git probe failed — a stored credential.helper may be sending stale auth; retrying without it"
    if git -c credential.helper= -c credential.helper='' \
         GIT_TERMINAL_PROMPT=0 ls-remote --heads "$repo" "refs/heads/$branch" >/dev/null 2>&1; then
      REPO_FETCH_MODE=git
      pf_ok "git transport OK once credential.helper was disabled"
      return 0
    fi
  fi

  # d) fall back to tarball (works on any public repo, no git protocol involved)
  if [ "$tarball_ok" = "1" ]; then
    REPO_FETCH_MODE=tarball
    pf_warn "git transport failed (RPC 401 class error) — will download a tarball instead"
    return 1
  fi
  pf_fail "GitHub is unreachable (both git and tarball transports failed)"
  return 2
}

# ---------------------------------------------------------------------------
# 4) Repo fetch — honors REPO_FETCH_MODE, with auto-retry on the other mode
#    Usage: pf_repo_fetch <repo-url> <branch> <dest-dir>
# ---------------------------------------------------------------------------
pf_repo_fetch() {
  local repo="$1" branch="$2" dest="$3" mode="${REPO_FETCH_MODE:-git}"

  pf_fetch_tarball() {
    local slug; slug=$(printf '%s' "$repo" | sed -E 's#^https?://github\.com/##; s#\.git$##')
    local tmp; tmp=$(mktemp -d)
    echo "   downloading tarball: ${slug}@${branch}"
    curl -fsSL --max-time 120 --retry 2 \
      "https://codeload.github.com/${slug}/tar.gz/refs/heads/${branch}" \
      -o "$tmp/src.tar.gz" || return 1
    mkdir -p "$dest"
    tar -xzf "$tmp/src.tar.gz" -C "$dest" --strip-components=1 \
      || { rm -rf "$dest"; return 1; }
    rm -rf "$tmp"
    return 0
  }

  case "$mode" in
    git)
      if git clone --depth 1 -b "$branch" "$repo" "$dest" 2>/dev/null; then
        echo "   cloned via git"
        return 0
      fi
      pf_warn "git clone failed — falling back to tarball"
      ;;
  esac

  # tarball path (also the retry path after a failed clone)
  if pf_fetch_tarball; then
    REPO_FETCH_MODE=tarball
    echo "   fetched via tarball"
    return 0
  fi

  pf_fail "could not fetch the repository (git AND tarball both failed)"
  return 1
}

# ---------------------------------------------------------------------------
# standalone mode:  bash preflight.sh <repo-url> <branch>
# runs all checks and prints REPO_FETCH_MODE — useful for debugging a server
# ---------------------------------------------------------------------------
if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  REPO_URL="${1:-https://github.com/amir12120/vpnshop.git}"
  BRANCH="${2:-main}"
  pf_server_check || exit 1
  pf_install_prereqs || exit 1
  pf_github_check "$REPO_URL" "$BRANCH"; gh_rc=$?
  echo ""
  echo "REPO_FETCH_MODE=${REPO_FETCH_MODE:-git}  (github-check exit: $gh_rc)"
  exit "$gh_rc"
fi
