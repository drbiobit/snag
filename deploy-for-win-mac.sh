#!/usr/bin/env bash
#
# deploy-for-win-mac.sh
# ---------------------
# Run Snag on macOS or Windows (via WSL / Git Bash).
#
# This is a lightweight, local "deployment" - it sets up everything the app
# needs and starts it. It is NOT for headless servers (use the Docker, PM2 or
# systemd scripts for that).
#
# What it does:
#   1. Detects the OS (macOS / Linux-WSL / Windows-Git-Bash).
#   2. Checks for prerequisites: python3, ffmpeg, yt-dlp.
#   3. Offers to install anything that's missing (Homebrew on macOS,
#      winget/choco on Windows, apt on WSL).
#   4. Creates a virtualenv and installs the Python dependencies.
#   5. Starts the app (Flask dev server) on the chosen port.
#
# Usage:
#   ./deploy-for-win-mac.sh
#
# Optional environment variables:
#   PORT=6909          # port to run on (default 6909)
#   DOWNLOAD_DIR=...   # where downloads are saved (default ./downloads)
#
set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
PORT="${PORT:-6909}"
DOWNLOAD_DIR="${DOWNLOAD_DIR:-$(pwd)/downloads}"
VENV_DIR="venv"

# Absolute path of this script's directory = the app directory.
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$APP_DIR"

# Colours for nicer output (disabled if not a TTY).
if [ -t 1 ]; then
    G='\033[0;32m'; R='\033[0;31m'; Y='\033[0;33m'; B='\033[0;34m'; N='\033[0m'
else
    G=''; R=''; Y=''; B=''; N=''
fi
ok()   { echo -e "${G}[ok]${N} $*"; }
warn() { echo -e "${Y}[warn]${N} $*"; }
info() { echo -e "${B}[..]${N} $*"; }
die()  { echo -e "${R}[error]${N} $*" >&2; exit 1; }

# ---------------------------------------------------------------------------
# 1. Detect the operating system
# ---------------------------------------------------------------------------
OS="$(uname -s)"
case "$OS" in
    Darwin)  PLATFORM="macos" ;;
    Linux)
        # WSL reports Linux; check if we're actually inside WSL.
        if grep -qiE '(microsoft|wsl)' /proc/version 2>/dev/null; then
            PLATFORM="wsl"
        else
            PLATFORM="linux"
        fi
        ;;
    MINGW*|MSYS*|CYGWIN*) PLATFORM="windows" ;;
    *) die "Unsupported OS: $OS" ;;
esac
info "detected platform: $PLATFORM"

# ---------------------------------------------------------------------------
# 2. Prerequisite checks + install helpers
# ---------------------------------------------------------------------------
# Ask the user whether to install a missing dependency using the right
# package manager for the platform.
install_dep() {
    local name="$1"
    case "$PLATFORM" in
        macos)
            command -v brew >/dev/null 2>&1 || die "Homebrew not found. Install it from https://brew.sh to auto-install '$name'."
            read -r -p "Install '$name' via Homebrew? [Y/n] " ans; ans="${ans:-Y}"
            [[ "$ans" =~ ^[Yy]$ ]] && brew install "$name" || warn "skipped '$name'"
            ;;
        windows)
            if command -v winget >/dev/null 2>&1; then
                read -r -p "Install '$name' via winget? [Y/n] " ans; ans="${ans:-Y}"
                [[ "$ans" =~ ^[Yy]$ ]] && winget install --id "$name" -e || warn "skipped '$name'"
            elif command -v choco >/dev/null 2>&1; then
                read -r -p "Install '$name' via Chocolatey? [Y/n] " ans; ans="${ans:-Y}"
                [[ "$ans" =~ ^[Yy]$ ]] && choco install "$name" -y || warn "skipped '$name'"
            else
                warn "No winget/choco found. Install '$name' manually and re-run."
            fi
            ;;
        wsl|linux)
            read -r -p "Install '$name' via apt (needs sudo)? [Y/n] " ans; ans="${ans:-Y}"
            [[ "$ans" =~ ^[Yy]$ ]] && sudo apt-get install -y "$name" || warn "skipped '$name'"
            ;;
    esac
}

echo "==> Checking prerequisites"

# python3
if command -v python3 >/dev/null 2>&1; then
    ok "python3: $(python3 --version 2>&1)"
else
    warn "python3 not found"
    install_dep "python"
    command -v python3 >/dev/null 2>&1 || die "python3 still not found after install step."
fi

# ffmpeg (required by yt-dlp to merge/convert media)
if command -v ffmpeg >/dev/null 2>&1; then
    ok "ffmpeg: $(ffmpeg -version 2>&1 | head -1)"
else
    warn "ffmpeg not found"
    case "$PLATFORM" in
        macos)   install_dep "ffmpeg" ;;
        windows) install_dep "Gyan.FFmpeg" ;;
        wsl|linux) install_dep "ffmpeg" ;;
    esac
    command -v ffmpeg >/dev/null 2>&1 || die "ffmpeg still not found. Install it and re-run."
fi

# yt-dlp (installed into the venv below if not already present globally)
if command -v yt-dlp >/dev/null 2>&1; then
    ok "yt-dlp: $(yt-dlp --version 2>&1)"
else
    info "yt-dlp not found globally - it will be installed into the venv."
fi

# ---------------------------------------------------------------------------
# 3. Python virtualenv + dependencies
# ---------------------------------------------------------------------------
echo "==> Setting up Python virtualenv at ${APP_DIR}/${VENV_DIR}"
if [ ! -d "$VENV_DIR" ]; then
    python3 -m venv "$VENV_DIR" || die "Could not create venv. On Debian/Ubuntu install 'python3-venv' first."
fi
# shellcheck disable=SC1091
source "${VENV_DIR}/bin/activate"
pip install --upgrade pip >/dev/null
pip install -r requirements.txt yt-dlp
ok "python dependencies installed"

# Make sure the download directory exists.
mkdir -p "$DOWNLOAD_DIR"

# ---------------------------------------------------------------------------
# 4. Start the app
# ---------------------------------------------------------------------------
echo ""
info "Starting Snag on port ${PORT}"
info "Downloads will be saved to: ${DOWNLOAD_DIR}"
echo ""
echo -e "${G}Snag -> http://localhost:${PORT}${N}"
echo "Press Ctrl+C to stop."
echo ""

# Run the Flask dev server (snag.py's __main__ block) with our port + dir.
# This is fine for local use; for a server use the Docker/PM2/systemd scripts.
export PORT="$PORT"
export DOWNLOAD_DIR="$DOWNLOAD_DIR"
exec python3 snag.py
