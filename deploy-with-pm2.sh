#!/usr/bin/env bash
#
# deploy-with-pm2.sh
# -------------------
# Deploy Snag using PM2 (a Node.js process manager).
#
# This is good for a single server (VPS, Raspberry Pi, home box) where you
# want the app to auto-restart and survive reboots, but don't want Docker or
# systemd.
#
# What it does:
#   1. Checks prerequisites (node, npm, pm2, python3, ffmpeg, yt-dlp).
#   2. Creates a virtualenv and installs Python deps (Flask, gunicorn, yt-dlp).
#   3. Starts the app under Gunicorn via PM2.
#   4. Saves the PM2 process list and (optionally) sets it up to start at boot.
#
# Usage:
#   ./deploy-with-pm2.sh
#
# Optional environment variables:
#   PORT=8000            # port to bind (default 8000)
#   WORKERS=2            # gunicorn worker count (default 2)
#   DOWNLOAD_DIR=...     # where downloads are saved (default ./downloads)
#   APP_NAME=snag        # PM2 process name (default "snag")
#
set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration (overridable via environment)
# ---------------------------------------------------------------------------
PORT="${PORT:-8000}"
WORKERS="${WORKERS:-2}"
DOWNLOAD_DIR="${DOWNLOAD_DIR:-$(pwd)/downloads}"
APP_NAME="${APP_NAME:-snag}"
VENV_DIR="venv"

# Absolute path of this script's directory = the app directory.
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$APP_DIR"

# Colours for nicer output (disabled if not a TTY).
if [ -t 1 ]; then
    G='\033[0;32m'; R='\033[0;31m'; Y='\033[0;33m'; N='\033[0m'
else
    G=''; R=''; Y=''; N=''
fi
ok()   { echo -e "${G}[ok]${N} $*"; }
warn() { echo -e "${Y}[warn]${N} $*"; }
die()  { echo -e "${R}[error]${N} $*" >&2; exit 1; }

# ---------------------------------------------------------------------------
# 1. Prerequisite checks
# ---------------------------------------------------------------------------
echo "==> Checking prerequisites"

command -v node    >/dev/null 2>&1 || die "node not found. Install Node.js first."
command -v npm     >/dev/null 2>&1 || die "npm not found. Install Node.js first."
command -v python3 >/dev/null 2>&1 || die "python3 not found."
command -v ffmpeg  >/dev/null 2>&1 || die "ffmpeg not found. Install it (needed by yt-dlp)."

# yt-dlp: use the CLI if present, otherwise it will be pip-installed below.
if ! command -v yt-dlp >/dev/null 2>&1; then
    warn "yt-dlp CLI not found globally - it will be installed into the venv."
fi

# PM2: install globally if missing.
if ! command -v pm2 >/dev/null 2>&1; then
    warn "pm2 not found - installing globally via npm..."
    npm install -g pm2 || die "Failed to install pm2."
fi
ok "prerequisites satisfied"

# ---------------------------------------------------------------------------
# 2. Python virtualenv + dependencies
# ---------------------------------------------------------------------------
echo "==> Setting up Python virtualenv at ${APP_DIR}/${VENV_DIR}"
if [ ! -d "$VENV_DIR" ]; then
    python3 -m venv "$VENV_DIR" || die "Could not create venv."
fi
# shellcheck disable=SC1091
source "${VENV_DIR}/bin/activate"
pip install --upgrade pip >/dev/null
pip install -r requirements.txt yt-dlp
ok "python dependencies installed"

GUNICORN="${APP_DIR}/${VENV_DIR}/bin/gunicorn"
[ -x "$GUNICORN" ] || die "gunicorn not found in venv after install."

# Make sure the download directory exists.
mkdir -p "$DOWNLOAD_DIR"

# ---------------------------------------------------------------------------
# 3. Start under PM2
# ---------------------------------------------------------------------------
echo "==> Starting Snag under PM2 (name: ${APP_NAME}, port: ${PORT})"

# Delete any existing process with the same name so we can re-run this script.
pm2 delete "$APP_NAME" >/dev/null 2>&1 || true

pm2 start "$GUNICORN" \
    --name "$APP_NAME" \
    -- -c "${APP_DIR}/gunicorn.conf.py" \
         --bind "0.0.0.0:${PORT}" \
         --workers "$WORKERS" \
         "${APP_DIR}/Main:app"

ok "started"

# ---------------------------------------------------------------------------
# 4. Persist across reboots
# ---------------------------------------------------------------------------
echo "==> Saving PM2 process list"
pm2 save >/dev/null

# Ask whether to enable startup (skipped on non-interactive runs).
if [ -t 0 ]; then
    read -r -p "Enable Snag to start automatically at boot? [Y/n] " ans
    ans="${ans:-Y}"
    if [[ "$ans" =~ ^[Yy]$ ]]; then
        pm2 startup systemd -u "$(whoami)" --hp "$HOME" >/dev/null 2>&1 \
            || warn "pm2 startup failed - set up boot start manually if needed."
        ok "boot start configured"
    fi
fi

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------
echo ""
pm2 status "$APP_NAME"
echo ""
echo -e "${G}Snag is running -> http://localhost:${PORT}${N}"
echo "Useful PM2 commands:"
echo "  pm2 logs $APP_NAME      # follow logs"
echo "  pm2 restart $APP_NAME   # restart"
echo "  pm2 stop $APP_NAME      # stop"
echo "  pm2 delete $APP_NAME    # remove"
