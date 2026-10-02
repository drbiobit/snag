#!/usr/bin/env bash
#
# deploy-with-systemd.sh
# -----------------------
# Deploy Snag as a systemd service on a Linux host.
#
# This is the recommended "production" option for a single Linux VPS/server:
# the app runs under Gunicorn, is supervised by systemd, and restarts
# automatically on crash or reboot.
#
# What it does:
#   1. Detects the current user, uid/gid, and working directory.
#   2. Runs prerequisite checks (python3, ffmpeg, yt-dlp, systemd).
#   3. Creates a virtualenv and installs Python deps.
#   4. Writes /etc/systemd/system/snag.service with the detected values.
#   5. (Re)loads systemd, enables and starts the service.
#
# Usage:
#   sudo ./deploy-with-systemd.sh
#
# Optional environment variables:
#   PORT=8000        # port to bind (default 8000)
#   WORKERS=1        # gunicorn worker count (MUST stay 1 - job state is in process memory)
#   DOWNLOAD_DIR=... # where downloads are saved (default <app>/downloads)
#
# NOTE: run with sudo so it can write the unit file and talk to systemd.
#       The service itself runs as your (non-root) user, not as root.
#
set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration (overridable via environment)
# ---------------------------------------------------------------------------
PORT="${PORT:-8000}"
WORKERS="${WORKERS:-1}"
SERVICE_NAME="snag"

# Colours for nicer output.
if [ -t 1 ]; then
    G='\033[0;32m'; R='\033[0;31m'; Y='\033[0;33m'; N='\033[0m'
else
    G=''; R=''; Y=''; N=''
fi
ok()   { echo -e "${G}[ok]${N} $*"; }
warn() { echo -e "${Y}[warn]${N} $*"; }
die()  { echo -e "${R}[error]${N} $*" >&2; exit 1; }

# ---------------------------------------------------------------------------
# 0. Must run as root (to write the unit file + control systemd)
# ---------------------------------------------------------------------------
[ "$(id -u)" -eq 0 ] || die "Please run this script with sudo: sudo $0"

# ---------------------------------------------------------------------------
# 1. Detect the invoking (non-root) user, uid/gid, and working directory
# ---------------------------------------------------------------------------
# When run via sudo, SUDO_USER is the real user. The service should run as
# that user (not root). Fall back to the owner of the app directory.
if [ -n "${SUDO_USER:-}" ]; then
    RUN_USER="$SUDO_USER"
else
    RUN_USER="$(whoami)"
fi

# Resolve the app directory = where this script lives.
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Resolve uid/gid, group name, and home for the run user.
RUN_UID="$(id -u "$RUN_USER")"
RUN_GID="$(id -g "$RUN_USER")"
# systemd's Group= wants a group *name*, not a numeric gid.
RUN_GROUP="$(id -gn "$RUN_USER")"
# getent is the portable way on Linux; fall back to parsing /etc/passwd.
RUN_HOME="$(getent passwd "$RUN_USER" 2>/dev/null | cut -d: -f6)"
if [ -z "$RUN_HOME" ]; then
    RUN_HOME="$(grep "^$RUN_USER:" /etc/passwd 2>/dev/null | cut -d: -f6)"
fi
[ -n "$RUN_HOME" ] || RUN_HOME="/home/$RUN_USER"

# Download dir defaults to <app>/downloads.
DOWNLOAD_DIR="${DOWNLOAD_DIR:-$APP_DIR/downloads}"

# The venv + gunicorn live inside the app dir.
VENV_DIR="$APP_DIR/venv"
GUNICORN="$VENV_DIR/bin/gunicorn"

echo "==> Detected deployment target"
echo "    user          : $RUN_USER (uid=$RUN_UID gid=$RUN_GID group=$RUN_GROUP)"
echo "    home          : $RUN_HOME"
echo "    app dir       : $APP_DIR"
echo "    download dir  : $DOWNLOAD_DIR"
echo "    port          : $PORT"
echo "    workers       : $WORKERS"

# ---------------------------------------------------------------------------
# 2. Prerequisite checks
# ---------------------------------------------------------------------------
echo "==> Checking prerequisites"

# systemd must be available (PID 1 is systemd).
if [ ! -d /run/systemd/system ]; then
    die "systemd not detected. This script is for Linux hosts running systemd."
fi
ok "systemd present"

# ffmpeg is required by yt-dlp for merging/converting.
command -v ffmpeg >/dev/null 2>&1 || die "ffmpeg not found. Install it first."
ok "ffmpeg present"

# python3 must exist for the run user.
command -v python3 >/dev/null 2>&1 || die "python3 not found."
ok "python3 present"

# ---------------------------------------------------------------------------
# 3. Create venv + install deps (as the run user, so files are owned by them)
# ---------------------------------------------------------------------------
echo "==> Setting up Python virtualenv at $VENV_DIR"

# Run the setup steps as the non-root user so the venv is owned by them.
run_as() {
    # Run a command as RUN_USER with their environment.
    runuser -u "$RUN_USER" -- bash -c "$1"
}

run_as "cd '$APP_DIR' && python3 -m venv '$VENV_DIR'" \
    || die "Could not create venv (is python3-venv installed?)."
run_as "cd '$APP_DIR' && '$VENV_DIR/bin/pip' install --upgrade pip" >/dev/null
run_as "cd '$APP_DIR' && '$VENV_DIR/bin/pip' install -r requirements.txt yt-dlp" \
    || die "Failed to install python dependencies."
ok "python dependencies installed"

[ -x "$GUNICORN" ] || die "gunicorn not found in venv after install."

# Make sure the download directory exists and is owned by the run user.
mkdir -p "$DOWNLOAD_DIR"
chown "$RUN_UID:$RUN_GID" "$DOWNLOAD_DIR"

# ---------------------------------------------------------------------------
# 4. Write the systemd unit file
# ---------------------------------------------------------------------------
UNIT_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
echo "==> Writing $UNIT_FILE"

cat > "$UNIT_FILE" <<EOF
# Snag - systemd service
# Generated by deploy-with-systemd.sh on $(date '+%Y-%m-%d %H:%M:%S')
#
# Serves the Snag (yt-dlp web UI) app under Gunicorn.
# Managed by systemd: auto-restarts on crash, starts at boot.

[Unit]
Description=Snag - yt-dlp web UI (Gunicorn)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
# Run as the invoking (non-root) user, not root.
User=$RUN_USER
Group=$RUN_GROUP
# Where the app lives.
WorkingDirectory=$APP_DIR
# Environment the app needs.
Environment=PATH=$VENV_DIR/bin:/usr/local/bin:/usr/bin:/bin
Environment=DOWNLOAD_DIR=$DOWNLOAD_DIR
Environment=GUNICORN_WORKERS=$WORKERS
# Start Gunicorn using the project's config file, bound to the chosen port.
# The app module MUST be a dotted name ("Main:app"), not an absolute path -
# gunicorn resolves it relative to WorkingDirectory (set above).
ExecStart=$GUNICORN -c $APP_DIR/gunicorn.conf.py --bind 0.0.0.0:$PORT --workers $WORKERS Main:app
# Restart policy: always restart on failure, with a short backoff.
Restart=on-failure
RestartSec=3
# Basic hardening.
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

ok "unit file written"

# ---------------------------------------------------------------------------
# 5. Reload systemd, enable and start the service
# ---------------------------------------------------------------------------
echo "==> Reloading systemd and starting the service"
systemctl daemon-reload
systemctl enable "$SERVICE_NAME" >/dev/null
systemctl restart "$SERVICE_NAME"
ok "service started"

# Show a short status snapshot.
sleep 1
systemctl status "$SERVICE_NAME" --no-pager || true

echo ""
echo -e "${G}Snag is running -> http://localhost:${PORT}${N}"
echo "Useful commands:"
echo "  systemctl status $SERVICE_NAME    # status"
echo "  journalctl -u $SERVICE_NAME -f    # follow logs"
echo "  systemctl restart $SERVICE_NAME   # restart"
echo "  systemctl stop $SERVICE_NAME      # stop"
echo "  systemctl disable $SERVICE_NAME   # disable boot start"
