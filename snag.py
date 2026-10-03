"""
Snag
====

A small web app that wraps the `yt-dlp` command-line tool so you can
download YouTube videos, playlists, channels, user profiles and MP3s
from a browser.

How it works:
    1. The browser (frontend/) sends a download request to this Flask app.
    2. The app starts `yt-dlp` in a background thread.
    3. The browser polls /api/status/<job_id> to show live progress.

Run it:
    pip install -r requirements.txt
    python snag.py          # then open http://localhost:6909

Requires: yt-dlp and ffmpeg on your PATH.
"""

import os
import re
import sys
import json
import uuid
import hmac
import secrets
import hashlib
import subprocess
import threading
import time
from datetime import datetime
from functools import wraps

from flask import Flask, request, jsonify, send_from_directory, session, redirect, url_for

# When the app started (used by /health to report uptime).
STARTED_AT = time.time()

# ---------------------------------------------------------------------------
# Setup
# ---------------------------------------------------------------------------

# Absolute path of the folder this file lives in (so the app works from any CWD).
BASE = os.path.dirname(os.path.abspath(__file__))

# Where finished downloads are saved.
# Override with the DOWNLOAD_DIR environment variable (used by Docker to
# point at a mounted volume). Defaults to ./downloads next to this file.
DOWNLOADS_DIR = os.environ.get('DOWNLOAD_DIR') or os.path.join(BASE, 'downloads')
os.makedirs(DOWNLOADS_DIR, exist_ok=True)

# Flask app. Static files (HTML/CSS/JS) live in the frontend/ folder.
app = Flask(__name__, static_folder=os.path.join(BASE, 'frontend'), static_url_path='/static')

# How many downloads may run at the same time.
MAX_CONCURRENT = 2

# In-memory table of running downloads: job_id -> job info dict.
# (Lost on restart - that's fine, downloads live on disk.)
jobs = {}

# Lock so the jobs dict is only read/written by one thread at a time.
jobs_lock = threading.Lock()

# How long a finished/cancelled job stays in the table after it completes.
# The browser polls once a second; if it navigates away or refreshes right as
# a job finishes, its next status poll would otherwise hit a job that has
# already been deleted and report "Job not found". Keeping finished jobs for
# a short window lets a late or re-attached poll still read the final status.
FINISHED_JOB_TTL = 120

# How many /api/preview lookups may run at the same time (each one spawns
# its own yt-dlp process, so an unbounded number would be a cheap DoS).
MAX_PREVIEWS = 2
previews_active = 0
previews_lock = threading.Lock()

# ---------------------------------------------------------------------------
# Authentication (SQLite)
# ---------------------------------------------------------------------------

# All auth data (users + session secret) lives in a single SQLite database.
# This keeps it out of the downloads folder entirely — no visibility, no
# accidental download/delete, no permission dance.
#
# Location: $SNAG_CONFIG_DIR/snag.db
#   Docker:  /config/snag.db  (mounted volume, persists across rebuilds)
#   Local:   ./data/snag.db   (created automatically)
CONFIG_DIR = os.environ.get('SNAG_CONFIG_DIR') or os.path.join(BASE, 'data')
DB_PATH = os.path.join(CONFIG_DIR, 'snag.db')
try:
    os.makedirs(CONFIG_DIR, exist_ok=True)
    _probe = os.path.join(CONFIG_DIR, '.write_test')
    with open(_probe, 'w') as _f:
        _f.write('ok')
    os.remove(_probe)
except (PermissionError, OSError):
    _fallback = os.path.join(BASE, 'data')
    print(f"WARNING: {CONFIG_DIR} is not writable, falling back to {_fallback}", file=sys.stderr)
    CONFIG_DIR = _fallback
    os.makedirs(CONFIG_DIR, exist_ok=True)
    DB_PATH = os.path.join(CONFIG_DIR, 'snag.db')

import sqlite3

def _get_db():
    """Open a SQLite connection (one per call, closed after use)."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def _init_db():
    """Create tables if they don't exist."""
    conn = _get_db()
    conn.execute('''CREATE TABLE IF NOT EXISTS users (
        username TEXT PRIMARY KEY,
        salt     TEXT NOT NULL,
        hash     TEXT NOT NULL
    )''')
    conn.execute('''CREATE TABLE IF NOT EXISTS meta (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
    )''')
    conn.execute('''CREATE TABLE IF NOT EXISTS history (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        url        TEXT NOT NULL,
        title      TEXT,
        status     TEXT NOT NULL,
        files      TEXT,
        size_bytes INTEGER DEFAULT 0,
        created_at TEXT NOT NULL,
        finished_at TEXT
    )''')
    conn.commit()
    conn.close()

_init_db()

# Session signing key: env var wins, otherwise generate once and store in DB
# so sessions survive container restarts.
def _load_secret():
    env = os.environ.get('SNAG_SECRET')
    if env:
        return env
    conn = _get_db()
    row = conn.execute("SELECT value FROM meta WHERE key='secret'").fetchone()
    conn.close()
    if row:
        return row['value']
    key = secrets.token_urlsafe(32)
    conn = _get_db()
    conn.execute("INSERT INTO meta (key, value) VALUES ('secret', ?)", (key,))
    conn.commit()
    conn.close()
    return key

app.secret_key = _load_secret()
app.config['SESSION_COOKIE_HTTPONLY'] = True
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'
app.config['PERMANENT_SESSION_LIFETIME'] = 86400 * 7  # 7 days

# PBKDF2 parameters for password hashing.
PBKDF2_ITERATIONS = 200_000

def hash_password(password, salt=None):
    """Hash a password with PBKDF2-SHA256. Returns (salt_hex, hash_hex)."""
    if salt is None:
        salt = secrets.token_bytes(16)
    dk = hashlib.pbkdf2_hmac('sha256', password.encode(), salt, PBKDF2_ITERATIONS)
    return salt.hex(), dk.hex()

def verify_password(password, salt_hex, hash_hex):
    """Constant-time check of a password against a stored salt+hash."""
    _, computed = hash_password(password, bytes.fromhex(salt_hex))
    return hmac.compare_digest(computed, hash_hex)

def get_user(username):
    """Fetch a user row from the DB. Returns None if not found."""
    conn = _get_db()
    row = conn.execute(
        "SELECT username, salt, hash FROM users WHERE username = ?",
        (username,)
    ).fetchone()
    conn.close()
    return dict(row) if row else None

def user_count():
    """Number of registered users."""
    conn = _get_db()
    n = conn.execute("SELECT COUNT(*) as n FROM users").fetchone()['n']
    conn.close()
    return n

def add_user(username, salt_hex, hash_hex):
    """Insert a new user."""
    conn = _get_db()
    conn.execute(
        "INSERT INTO users (username, salt, hash) VALUES (?, ?, ?)",
        (username, salt_hex, hash_hex)
    )
    conn.commit()
    conn.close()

def delete_user(username):
    """Remove a user."""
    conn = _get_db()
    conn.execute("DELETE FROM users WHERE username = ?", (username,))
    conn.commit()
    conn.close()

def clear_all_users():
    """Remove all users (resets auth to first-run state)."""
    conn = _get_db()
    conn.execute("DELETE FROM users")
    conn.commit()
    conn.close()

def log_history(url, title, status, files, size_bytes):
    """Insert a row into the download history table."""
    conn = _get_db()
    conn.execute(
        "INSERT INTO history (url, title, status, files, size_bytes, created_at, finished_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        (url, title, status, json.dumps(files), size_bytes,
         datetime.now().isoformat(), datetime.now().isoformat())
    )
    conn.commit()
    conn.close()

def get_history(limit=100):
    """Return the most recent download history entries."""
    conn = _get_db()
    rows = conn.execute(
        "SELECT id, url, title, status, files, size_bytes, created_at, finished_at "
        "FROM history ORDER BY id DESC LIMIT ?", (limit,)
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]

def clear_history():
    """Delete all download history rows."""
    conn = _get_db()
    conn.execute("DELETE FROM history")
    conn.commit()
    conn.close()

def auth_enabled():
    """True if credentials are configured (env var or saved user store)."""
    if os.environ.get('SNAG_USER') and os.environ.get('SNAG_PASSWORD'):
        return True
    return user_count() > 0

def check_credentials(username, password):
    """Verify credentials against env vars first, then the user store."""
    env_user = os.environ.get('SNAG_USER')
    env_pass = os.environ.get('SNAG_PASSWORD')
    if env_user and env_pass:
        return hmac.compare_digest(username, env_user) and hmac.compare_digest(password, env_pass)
    entry = get_user(username)
    if not entry:
        # Burn the same CPU time as a real check to prevent timing attacks.
        verify_password(password, '00' * 16, '00' * 64)
        return False
    return verify_password(password, entry['salt'], entry['hash'])

def login_required(f):
    """Decorator: require a valid session. 401 for APIs, redirect for pages.

    When no credentials are configured yet (first run), redirects to the
    login page so the user sees the "create account" setup form.
    """
    @wraps(f)
    def wrapper(*args, **kwargs):
        if not auth_enabled():
            if request.path.startswith('/api/'):
                return f(*args, **kwargs)
            return redirect(url_for('login_page'))
        if session.get('authed'):
            return f(*args, **kwargs)
        if request.path.startswith('/api/'):
            return jsonify(success=False, error='unauthorized'), 401
        return redirect(url_for('login_page'))
    return wrapper

# ---------------------------------------------------------------------------
# yt-dlp option lookup tables
# ---------------------------------------------------------------------------

# UI "quality" choice -> yt-dlp format selector.
# We ask for the best video + best audio stream and let yt-dlp merge them.
FORMATS = {
    'best': 'bestvideo+bestaudio/best',
    '1080': 'bestvideo[height<=1080]+bestaudio/best[height<=1080]',
    '720': 'bestvideo[height<=720]+bestaudio/best[height<=720]',
    '480': 'bestvideo[height<=480]+bestaudio/best[height<=480]',
    'audio': 'bestaudio',
    'video': 'bestvideo',
}

# UI "audio bitrate" choice -> yt-dlp --audio-quality value.
# '0' means "highest quality" (VBR), the rest are fixed bitrates.
AUDIO_QUALITY = {'0': '0', '1': '128k', '2': '192k', '3': '256k', '4': '320k'}

# Output formats the user can pick. For video we merge into a single file
# (mp4/webm/mkv/mov); for audio we re-encode to the chosen format.
VIDEO_FORMATS = {'mp4', 'webm', 'mkv', 'mov'}
AUDIO_FORMATS = {'mp3', 'm4a', 'wav', 'ogg', 'flac'}

# Matches common YouTube URL shapes (watch, playlist, channel, user, etc.).
YT_RE = re.compile(
    r'^(https?://)?(www\.|m\.|music\.)?'
    r'(youtube\.com/(watch|playlist|shorts|v|embed|live|channel|user|c|@)'
    r'|youtu\.be/)\S+',
    re.I,
)

# Matches a clip timestamp: plain seconds, MM:SS, or H:MM:SS. Minutes and
# seconds may be any length (yt-dlp accepts 90:00, 1:5, etc.), so we don't
# cap them at [0-5]d here - malformed values just fail inside yt-dlp.
TIME_RE = re.compile(r'^(?:\d+:)?\d{1,2}:\d{1,2}$|^\d{1,4}$')

# Matches the playlist-item picker, e.g. '1,3,5-10' (indices and ranges).
PLAYLIST_ITEMS_RE = re.compile(r'^\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*$')

# Browsers yt-dlp can import cookies from (keep in sync with yt-dlp's list).
COOKIE_BROWSERS = {'chrome', 'firefox', 'edge', 'safari', 'brave', 'chromium', 'vivaldi', 'whale', 'opera', 'samsunginternet', 'qutebrowser', 'falkon', 'shadowfox', 'midori', 'konqueror', 'librewolf', 'waterfox', 'floorp', 'floorpce', 'bat', 'ungoogled-chromium', 'google-chrome', 'brave-browser', 'microsoft-edge', 'tor'}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def is_valid_url(url):
    """Return True if the given string looks like a YouTube URL."""
    return bool(YT_RE.match(url.strip()))


def is_valid_time(s):
    """Return True if s is '' or a valid clip timestamp (seconds / MM:SS / H:MM:SS)."""
    s = (s or '').strip()
    return True if not s else bool(TIME_RE.match(s))


def is_valid_playlist_items(s):
    """Return True if s is '' or a valid playlist-item picker like '1,3,5-10'."""
    s = (s or '').strip()
    return True if not s else bool(PLAYLIST_ITEMS_RE.match(s))


def is_valid_cookies(s):
    """Return True if s is '' or a recognised browser name for --cookies-from-browser."""
    s = (s or '').strip().lower()
    return True if not s else s in COOKIE_BROWSERS


def is_inside_downloads(path):
    """Return True if the resolved path is strictly inside DOWNLOADS_DIR.

    Uses commonpath() rather than startswith() so a sibling directory named
    e.g. 'downloads-evil' can't slip past a naive prefix check.
    """
    base = os.path.realpath(DOWNLOADS_DIR)
    target = os.path.realpath(path)
    return os.path.commonpath([base, target]) == base and target != base


def is_bulk(url):
    """
    Return True if the URL points at a collection (playlist, channel or
    user profile) rather than a single video.

    Single-video URLs are the only ones that get the "output template"
    option - bulk downloads always use the default per-file naming.
    """
    u = url.strip().lower()
    return ('/playlist' in u) or ('/channel/' in u) or ('/user/' in u) \
        or ('/c/' in u) or ('/@' in u)


def build_args(url, d, audio_only, audio_format, audio_quality,
               output_format, output_template, resume, fragments, metadata,
               playlist_index='', subtitles=False, sub_langs='en',
               sub_embed=False, trim_start='', trim_end='',
               playlist_items='', cookies='', thumbnails=False):
    """
    Build the full `yt-dlp` command-line argument list for a download.

    Args:
        url:             the YouTube URL to download
        d:               the raw request body (has 'type' and 'format')
        audio_only:      True if the user wants audio extraction (mp3, etc.)
        audio_format:    target audio format, e.g. 'mp3'
        audio_quality:   audio quality key into AUDIO_QUALITY (0-4)
        output_format:   target video container, e.g. 'mp4'
        output_template: custom -o template (single downloads only)
        resume:          True to resume/interruptible + skip finished files
        fragments:       number of concurrent fragment downloads (0 = off)
        metadata:        True to embed tags/thumbnail/chapters (off by default)
        playlist_index:  output mode for bulk downloads ('' | 'm3u' | 'mkv' | 'mp4')
        subtitles:       True to download subtitles
        sub_langs:       subtitle language list, e.g. 'en' or 'en,fr' ('all' = every lang)
        sub_embed:       True to embed the subtitles into the media file
        trim_start:      clip start timestamp, e.g. '00:00:30' ('' = off)
        trim_end:        clip end timestamp, e.g. '00:01:15' ('' = off)
        playlist_items:  which playlist items to grab, e.g. '1,3,5-10' ('' = all)
        cookies:         cookie source, e.g. 'chrome' / 'firefox' ('' = off)
        thumbnails:      True to grab only each video's thumbnail (no media)

    Returns:
        list of strings, ready to pass to subprocess.Popen.
    """
    # Pick the audio format (for audio-only) or video container (for video),
    # falling back to sensible defaults if the value isn't recognised.
    if audio_only:
        out_fmt = audio_format if audio_format in AUDIO_FORMATS else 'mp3'
    else:
        out_fmt = output_format if output_format in VIDEO_FORMATS else 'mp4'

    # Bulk = playlist / channel / user profile. Single videos allow a custom
    # output template; bulk downloads always use the default per-file name.
    bulk = d.get('type') == 'bulk' or is_bulk(url)

    # Thumbnail-only mode: grab just each video's thumbnail image, no media.
    # This is the fast way to collect covers for a whole channel/playlist.
    # We skip the normal format selection and let yt-dlp fetch only the thumb.
    if thumbnails:
        # %s = the thumbnail's own extension (jpg/png). Name each file after
        # the video title so a channel's thumbs are easy to tell apart.
        out_path = os.path.join(DOWNLOADS_DIR, '%(title)s.%(ext)s')
        args = ['yt-dlp', '--write-thumbnail', '--skip-download',
                '-o', out_path, '--restrict-filenames']
        if bulk:
            args += ['--yes-playlist']
            if playlist_items:
                args += ['--playlist-items', playlist_items]
        args.append(url)
        return args

    if audio_only:
        # Audio-only: grab the best audio stream and convert to the chosen format.
        fmt = 'bestaudio'
        extra = ['-x', '--audio-format', out_fmt,
                 '--audio-quality', AUDIO_QUALITY.get(str(audio_quality), '192k')]
    else:
        # Video: pick the chosen quality and merge video+audio into a single
        # file of the chosen container.
        quality = FORMATS.get(d.get('format', 'best'), 'best')
        fmt = f'{quality}/best'
        extra = ['--merge-output-format', out_fmt]

    # Output path. Single downloads may use a custom template; bulk and the
    # default both save into downloads/ named by title. A custom template is
    # only honoured if it stays inside the downloads folder - otherwise we
    # fall back to the default so a crafted template can't write elsewhere.
    if (not bulk) and output_template and is_inside_downloads(output_template):
        out_path = output_template
    else:
        out_path = os.path.join(DOWNLOADS_DIR, '%(title)s.%(ext)s')

    # Assemble the base command: yt-dlp -f <fmt> -o <output>
    args = ['yt-dlp', '-f', fmt, '-o', out_path]

    # Always keep filenames safe on every OS (no ':', '/', etc.).
    args += ['--restrict-filenames']

    # Bulk: download every item in the collection.
    if bulk:
        args += ['--yes-playlist']

        # Playlist index - let the user merge a bulk download into one file
        # or write an M3U playlist. Only meaningful for bulk downloads.
        if playlist_index == 'm3u':
            args += ['--playlist-index', 'm3u']
        elif playlist_index in ('mkv', 'mp4'):
            args += ['--playlist-index', playlist_index]

        # Playlist item picker - grab only specific items (e.g. '1,3,5-10').
        if playlist_items:
            args += ['--playlist-items', playlist_items]

    # Metadata embedding - opt-in. Only added when the user asks for it.
    if metadata:
        args += ['--embed-metadata', '--embed-thumbnail', '--embed-chapters']

    # Subtitles - opt-in. Download (and optionally embed) captions.
    if subtitles:
        langs = 'all' if sub_langs in ('', 'all') else sub_langs
        args += ['--write-subs', '--sub-langs', langs]
        if sub_embed:
            args += ['--embed-subs']

    # Clip trimming - download only a [start, end] section of the video.
    # Both ends are optional: 'start', 'end', or 'start-end'.
    if trim_start or trim_end:
        section = f'{trim_start or "0"}-{trim_end or ""}'.strip('-')
        # --download-sections <start-end> grabs just that slice; --force-
        # keyframes-at-cuts gives clean cut points. (There is no bare --trim
        # flag - it would be parsed as --trim-filenames, an integer option.)
        args += ['--download-sections', section, '--force-keyframes-at-cuts']

    # Resume: make downloads interruptible and skip files already on disk.
    if resume:
        args += ['--continue', '--break-on-existing']

    # Multithreaded fragment downloads (DASH/HLS only; 0/None = off).
    if fragments and int(fragments) > 1:
        args += ['-N', str(int(fragments))]

    # Cookies - import from a browser for age-restricted / members-only content.
    if cookies:
        args += ['--cookies-from-browser', cookies]

    args += extra
    args.append(url)
    return args


def parse_progress(line):
    """
    Parse one line of yt-dlp output.

    yt-dlp prints progress like:
        [download]  42.5% of  9.42MiB at 5.72MiB/s ETA 00:01

    Returns the progress percentage for progress lines, or None otherwise.
    """
    m = re.match(r'\[download\]\s+([\d.]+)%', line)
    return float(m.group(1)) if m else None


# Matches the line yt-dlp prints when it starts a new file in a bulk download:
#   [info] Extracting URL: https://...
# Each such line marks the start of a new item, so counting them gives the
# current file index. The item's title is the next bare "[info] <title>" line.
NEW_ITEM_RE = re.compile(r'\[info\]\s+Extracting URL:')
# The line yt-dlp prints with the file it is about to write:
#   [info] Destination: /path/to/file.mp4
# Capturing these lets the UI show the exact file(s) a job produced.
DEST_RE = re.compile(r'\[info\]\s+Destination:\s+(.+)$')
# A bare "[info] <title>" line (not a known sub-status message).
INFO_TITLE_RE = re.compile(
    r'^\[info\]\s+'
    r'(?!Extracting URL|Downloading|Starting download|Merging|Destination'
    r'|has already|Writing|Converting|Embedding|Building|Post-processing'
    r'|already|Downloading subtitles)'
    r'[^\[]+$'
)


def run_job(job_id, url, d, audio_only, audio_format, audio_quality,
            output_format, output_template, resume, fragments, metadata,
            playlist_index='', subtitles=False, sub_langs='en',
            sub_embed=False, trim_start='', trim_end='',
            playlist_items='', cookies='', thumbnails=False):
    """
    Run one download in the background (called in its own thread).

    Starts yt-dlp, streams its output line by line, updates the job's
    progress as it goes, and records the final status. On failure the last
    few lines of yt-dlp output are kept in job['error'] so the UI can show
    the real reason the download failed.
    """
    job = jobs[job_id]
    # Keep a short rolling tail of yt-dlp output to surface on failure.
    tail = []
    # Output files this job has written (paths relative to DOWNLOADS_DIR).
    files = []
    # Bulk-download tracking: how many files we've seen start, the current
    # file's title, and the latest per-file progress (index -> percent).
    file_index = 0          # 1-based count of files that have started
    current_title = None    # title of the file currently downloading
    file_progress = {}      # file_index -> last seen percent
    try:
        # Start yt-dlp. stderr is merged into stdout so we see everything.
        proc = subprocess.Popen(
            build_args(url, d, audio_only, audio_format, audio_quality,
                       output_format, output_template, resume, fragments,
                       metadata, playlist_index, subtitles, sub_langs,
                       sub_embed, trim_start, trim_end, playlist_items,
                       cookies, thumbnails),
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
        )

        # Read output line by line (live, as the download happens).
        for line in proc.stdout:
            # If the user hit cancel, stop yt-dlp and stop. terminate() lets
            # yt-dlp clean up (and take its ffmpeg child with it); kill() is
            # the fallback if it ignores the first signal.
            with jobs_lock:
                if jobs.get(job_id, {}).get('cancelled'):
                    proc.terminate()
                    try:
                        proc.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        proc.kill()
                        proc.wait()
                    job['status'], job['message'] = 'cancelled', 'Cancelled by user'
                    return

            line = line.rstrip('\n')
            if line.strip():
                # Keep the last ~15 non-empty lines for error reporting.
                tail.append(line.strip())
                if len(tail) > 15:
                    tail.pop(0)

            # Bulk: a new "Extracting URL" line means a new file has started.
            if NEW_ITEM_RE.search(line):
                file_index += 1
                current_title = None  # the title line follows next

            # Bulk: a bare "[info] <title>" line right after a new item is the
            # file's title. Record it for the current file index.
            if current_title is None and file_index > 0:
                m = INFO_TITLE_RE.match(line)
                if m:
                    current_title = m.group(0)[len('[info] '):].strip()

            # Remember the file yt-dlp is writing so the UI can show the
            # exact result after completion.
            m = DEST_RE.search(line)
            if m:
                path = os.path.abspath(m.group(1).strip())
                files.append(os.path.relpath(path, DOWNLOADS_DIR))
                job['files'] = list(files)

            # Update progress if this line carries progress info.
            progress = parse_progress(line)
            if progress is not None:
                job['progress'] = progress
                # Remember this file's latest percent for the bulk list.
                if file_index > 0:
                    file_progress[file_index] = progress
                job['message'] = f"Downloading... {progress:.0f}%"
            elif line.strip():
                # Otherwise show the most recent yt-dlp message (truncated).
                job['message'] = line.strip()[-120:]

            # Publish bulk progress so the UI can show "file 1, file 2, ...".
            if file_index > 0:
                job['file_index'] = file_index
                if current_title:
                    job['current_file'] = current_title
                job['file_progress'] = dict(file_progress)

        # yt-dlp finished. Decide success vs failure from its exit code.
        proc.wait()
        if proc.returncode == 0:
            job['status'] = 'completed'
            job['progress'] = 100
            job['message'] = 'Download completed!'
        else:
            job['status'] = 'error'
            job['progress'] = job.get('progress', 0)
            # Surface the real yt-dlp error (the meaningful lines are usually
            # near the end: ERROR: ..., unable to download, etc.).
            job['message'] = 'Download failed'
            job['error'] = '\n'.join(tail[-10:])

    except FileNotFoundError:
        # The yt-dlp executable isn't on PATH.
        job['status'], job['message'] = 'error', 'yt-dlp not found. Install it first.'
        job['error'] = 'The yt-dlp executable is not on your PATH.'
    except Exception as e:
        # Any other unexpected failure.
        job['status'], job['message'] = 'error', str(e)
        job['error'] = str(e)
    finally:
        # Mark the job finished but keep it in the table for FINISHED_JOB_TTL
        # seconds so a late or re-attached poll can still read its final
        # status (a refresh or page change right at completion would otherwise
        # race the cleanup and see "Job not found"). prune_finished_jobs()
        # drops it once the window has passed.
        job['finished_at'] = time.time()
        # Record this job in the persistent download history.
        try:
            status = job.get('status', 'error')
            files = job.get('files', [])
            # Sum up the sizes of the files this job produced.
            total_size = 0
            for f in files:
                p = os.path.join(DOWNLOADS_DIR, f)
                if os.path.isfile(p):
                    total_size += os.path.getsize(p)
            log_history(url, job.get('current_file') or '', status, files, total_size)
        except Exception:
            pass  # never let a history write break the job


def prune_finished_jobs():
    """Drop finished/cancelled jobs that are older than FINISHED_JOB_TTL.

    Called on every status poll so the in-memory table doesn't grow without
    bound. Running jobs (no 'finished_at') are left alone.
    """
    now = time.time()
    with jobs_lock:
        stale = [jid for jid, j in jobs.items()
                 if j.get('finished_at') and now - j['finished_at'] > FINISHED_JOB_TTL]
        for jid in stale:
            jobs.pop(jid, None)


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.route('/api/auth-status')
def auth_status():
    """Tell the login page whether to show setup or sign-in."""
    return jsonify(
        auth_enabled=auth_enabled(),
        needs_setup=not auth_enabled(),
        authed=bool(session.get('authed')),
    )


@app.route('/login')
def login_page():
    """Serve the login / first-setup page."""
    if session.get('authed'):
        return redirect(url_for('index'))
    return send_from_directory(app.static_folder, 'login.html')


@app.route('/api/setup', methods=['POST'])
def api_setup():
    """First-run: create the initial account. Only works when no users exist."""
    if auth_enabled():
        return jsonify(success=False, error='account already exists'), 400
    d = request.get_json(silent=True) or {}
    username = (d.get('username') or '').strip()
    password = d.get('password') or ''
    if not username or not password:
        return jsonify(success=False, error='username and password required'), 400
    if len(password) < 4:
        return jsonify(success=False, error='password must be at least 4 characters'), 400
    salt, h = hash_password(password)
    add_user(username, salt, h)
    session['authed'] = True
    session['user'] = username
    session.permanent = True
    return jsonify(success=True)


@app.route('/api/login', methods=['POST'])
def api_login():
    """Verify credentials and start a session."""
    d = request.get_json(silent=True) or {}
    username = (d.get('username') or '').strip()
    password = d.get('password') or ''
    if not username or not password:
        return jsonify(success=False, error='username and password required'), 400
    if not check_credentials(username, password):
        return jsonify(success=False, error='invalid credentials'), 401
    session['authed'] = True
    session['user'] = username
    session.permanent = True
    return jsonify(success=True)


@app.route('/api/logout', methods=['POST'])
def api_logout():
    """End the current session."""
    session.clear()
    return jsonify(success=True)


@app.route('/')
@login_required
def index():
    """Serve the main UI page."""
    return send_from_directory(app.static_folder, 'index.html')


@app.route('/docs')
@login_required
def docs():
    """Serve the in-app API documentation page."""
    return send_from_directory(app.static_folder, 'docs.html')


@app.route('/settings')
@login_required
def settings():
    """Serve the settings page (theme options)."""
    return send_from_directory(app.static_folder, 'settings.html')


@app.route('/downloads')
@login_required
def downloads_page():
    """Serve the downloads page (file manager)."""
    return send_from_directory(app.static_folder, 'downloads.html')


@app.route('/history')
@login_required
def history_page():
    """Serve the download history page."""
    return send_from_directory(app.static_folder, 'history.html')


@app.route('/api/validate', methods=['POST'])
@login_required
def validate():
    """Check whether the submitted string is a valid YouTube URL."""
    url = (request.get_json(silent=True) or {}).get('url', '').strip()
    return jsonify(valid=is_valid_url(url), url=url, bulk=is_bulk(url))


@app.route('/api/download', methods=['POST'])
@login_required
def download():
    """
    Start a download.

    Validates the URL, enforces the concurrency limit, registers a new job,
    kicks off a background thread to run yt-dlp, and returns the job id.
    """
    d = request.get_json(silent=True) or {}
    url = d.get('url', '').strip()

    # Reject anything that isn't a YouTube URL.
    if not is_valid_url(url):
        return jsonify(success=False, error='Invalid YouTube URL'), 400

    # Reject malformed user-supplied values before they reach yt-dlp.
    if not (is_valid_time(d.get('trim_start', '')) and is_valid_time(d.get('trim_end', ''))):
        return jsonify(success=False, error='Invalid clip start/end (use seconds, MM:SS or HH:MM:SS)'), 400
    if not is_valid_playlist_items(d.get('playlist_items', '')):
        return jsonify(success=False, error='Invalid playlist items (use e.g. 1,3,5-10)'), 400
    if not is_valid_cookies(d.get('cookies', '')):
        return jsonify(success=False, error='Invalid cookie browser (e.g. chrome, firefox, edge)'), 400

    # Register the job (and check the limit) under the lock.
    with jobs_lock:
        if len(jobs) >= MAX_CONCURRENT:
            return jsonify(success=False, error='Too many concurrent downloads'), 429

        job_id = uuid.uuid4().hex
        jobs[job_id] = {
            'id': job_id,
            'url': url,
            'status': 'pending',
            'progress': 0,
            'message': 'Starting download...',
            'started_at': datetime.now().isoformat(),
            'cancelled': False,
        }

    # Do the actual downloading in a background thread so this request returns fast.
    threading.Thread(
        target=run_job,
        args=(job_id, url, d,
              d.get('audio_only', False),
              d.get('audio_format', 'mp3'),
              d.get('audio_quality', 2),
              d.get('output_format', 'mp4'),
              d.get('output_template', ''),
              d.get('resume', True),
              d.get('fragments', 0),
              d.get('metadata', False),
              d.get('playlist_index', ''),
              d.get('subtitles', False),
              d.get('sub_langs', 'en'),
              d.get('sub_embed', False),
              d.get('trim_start', ''),
              d.get('trim_end', ''),
              d.get('playlist_items', ''),
              d.get('cookies', ''),
              d.get('thumbnails', False)),
        daemon=True,
    ).start()

    return jsonify(success=True, job_id=job_id)


@app.route('/api/status/<job_id>')
@login_required
def status(job_id):
    """Return the current progress/status of a job (polled by the browser)."""
    prune_finished_jobs()
    job = jobs.get(job_id)
    if not job:
        return jsonify(success=False, error='Job not found'), 404
    return jsonify(success=True, job=job)


@app.route('/api/cancel/<job_id>', methods=['POST'])
@login_required
def cancel(job_id):
    """Flag a running job so its worker thread stops yt-dlp."""
    with jobs_lock:
        job = jobs.get(job_id)
        if not job:
            return jsonify(success=False, error='Job not found'), 404
        job['cancelled'] = True
    return jsonify(success=True, job_id=job_id)


@app.route('/api/downloads')
@login_required
def list_downloads():
    """List all files currently in the downloads folder (with sizes + mtime)."""
    files = []
    for root, _, names in os.walk(DOWNLOADS_DIR):
        for name in names:
            path = os.path.join(root, name)
            st = os.stat(path)
            files.append({
                'name': os.path.relpath(path, DOWNLOADS_DIR),
                'size': st.st_size,
                'mtime': st.st_mtime,
            })
    return jsonify(success=True, downloads=files)


@app.route('/api/preview', methods=['POST', 'GET'])
@login_required
def preview():
    """
    Show what's available for a URL before downloading.

    Runs `yt-dlp -J` (no download) and returns the title plus the distinct
    video resolutions and audio codecs yt-dlp can see.

    - Single video: full format list is available, so we report the real
      resolutions and codecs.
    - Collection (playlist / channel / user): we use --flat-playlist so it is
      fast; entries don't carry per-item formats, so we report the item count
      and the collection title instead.
    """
    url = (request.get_json(silent=True) or {}).get('url', '').strip()
    if not url:
        return jsonify(success=False, error='No URL provided'), 400
    if not is_valid_url(url):
        return jsonify(success=False, error='Invalid YouTube URL'), 400

    # Enforce the preview concurrency limit (each preview spawns a yt-dlp
    # process, so an unbounded number of them would be a cheap DoS).
    global previews_active
    with previews_lock:
        if previews_active >= MAX_PREVIEWS:
            return jsonify(success=False, error='Too many previews running, try again shortly'), 429
        previews_active += 1

    # Collections are large; read them flat (fast, no per-item formats).
    # Single videos get the full (slower) format dump.
    flat = is_bulk(url)
    cmd = ['yt-dlp', '-J', url] + (['--flat-playlist'] if flat else [])

    # Wrap everything after the counter is taken so it is always released,
    # even when we return early on an error.
    try:
        try:
            # stderr goes to its own pipe (discarded) so stdout stays pure JSON -
            # yt-dlp writes warnings to stderr and merging them would break parsing.
            proc = subprocess.run(
                cmd,
                stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                timeout=90,
            )
        except subprocess.TimeoutExpired:
            return jsonify(success=False, error='Timed out reading this URL'), 400
        except FileNotFoundError:
            return jsonify(success=False, error='yt-dlp not found. Install it first.'), 500
        except Exception as e:
            return jsonify(success=False, error=f'Could not read this URL: {e}'), 500

        if proc.returncode != 0:
            # yt-dlp printed the real reason to stderr - surface it.
            return jsonify(success=False, error=(proc.stderr or 'Could not read this URL').strip()[-300:]), 400

        try:
            data = json.loads(proc.stdout)
        except json.JSONDecodeError:
            return jsonify(success=False, error='Could not parse this URL'), 400
        if not data:
            return jsonify(success=False, error='Could not read this URL'), 400

        # Collect the distinct resolutions and audio codecs we can offer.
        heights, formats = set(), set()
        entries = data.get('entries') or []
        # For a single video the top-level object holds the formats; for a flat
        # collection the entries hold them (usually empty).
        nodes = [data] if not entries else entries
        for e in nodes:
            for f in (e.get('formats') or []):
                if f.get('height'):
                    heights.add(int(f['height']))
                if f.get('acodec') not in (None, 'none'):
                    formats.add(f['acodec'])

        return jsonify(
            success=True,
            title=data.get('title', ''),
            count=len(entries) or 1,
            bulk=flat,
            heights=sorted(heights, reverse=True),
            formats=sorted(formats),
        )
    finally:
        # Release the preview slot no matter how we got here.
        with previews_lock:
            previews_active -= 1


@app.route('/downloads/<path:name>')
@login_required
def download_file(name):
    """Serve a finished file from the downloads folder.

    Streams the file in chunks so large downloads don't hold a thread for
    the entire transfer or load the whole file into memory.
    """
    # Block access to the .config/ folder (auth data) even if it somehow
    # ends up inside DOWNLOADS_DIR.
    if name.startswith('.config') or '/.config/' in name:
        return jsonify(success=False, error='File not found'), 404
    try:
        response = send_from_directory(DOWNLOADS_DIR, name, as_attachment=True)
        # Prevent reverse proxies (nginx, etc.) from buffering the entire
        # response before forwarding it to the client.
        response.headers['X-Accel-Buffering'] = 'no'
        return response
    except Exception:
        return jsonify(success=False, error='File not found'), 404


@app.route('/api/delete/<path:name>', methods=['POST'])
@login_required
def delete_file(name):
    """Delete a file from the downloads folder."""
    # Block deletion of the .config/ folder (auth data).
    if name.startswith('.config') or '/.config/' in name:
        return jsonify(success=False, error='Invalid path'), 400
    # Resolve the real path and make sure it's strictly inside DOWNLOADS_DIR
    # so a crafted name can't delete files elsewhere on disk.
    target = os.path.realpath(os.path.join(DOWNLOADS_DIR, name))
    if not is_inside_downloads(target):
        return jsonify(success=False, error='Invalid path'), 400
    if os.path.isfile(target):
        os.remove(target)
        return jsonify(success=True)
    return jsonify(success=False, error='File not found'), 404


@app.route('/api/history')
@login_required
def api_history():
    """Return the download history (most recent first)."""
    return jsonify(success=True, history=get_history())


@app.route('/api/history/clear', methods=['POST'])
@login_required
def api_history_clear():
    """Delete all download history entries."""
    clear_history()
    return jsonify(success=True)


@app.route('/api/auth/clear', methods=['POST'])
@login_required
def api_auth_clear():
    """Delete all stored credentials (resets to first-run state)."""
    clear_all_users()
    session.clear()
    return jsonify(success=True)


@app.route('/health')
def health():
    """Liveness probe: reports that the app is up and how many jobs are running."""
    # Finished jobs linger in the table for FINISHED_JOB_TTL (so a late poll
    # can still read their status), so count only the ones still running.
    with jobs_lock:
        running = sum(1 for j in jobs.values() if not j.get('finished_at'))
    return jsonify(
        status='ok',
        app='snag',
        time=datetime.now().isoformat(),
        uptime_seconds=round(time.time() - STARTED_AT, 1),
        active_jobs=running,
    )


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == '__main__':
    # Local development only. In production, run with Gunicorn instead:
    #   gunicorn -c gunicorn.conf.py snag:app
    # (This block is skipped when Gunicorn imports the module.)
    port = int(os.environ.get('PORT', 6909))
    print(f"Snag -> http://localhost:{port}")
    app.run(host='0.0.0.0', port=port, debug=False)
