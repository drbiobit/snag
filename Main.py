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
    python Main.py          # then open http://localhost:6909

Requires: yt-dlp and ffmpeg on your PATH.
"""

import os
import re
import json
import subprocess
import threading
import time
from datetime import datetime

from flask import Flask, request, jsonify, send_from_directory, send_file

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


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def is_valid_url(url):
    """Return True if the given string looks like a YouTube URL."""
    return bool(YT_RE.match(url.strip()))


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
    # default both save into downloads/ named by title.
    if (not bulk) and output_template:
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
# A bare "[info] <title>" line (not a known sub-status message).
INFO_TITLE_RE = re.compile(    '^\\[info\\]\\s+(?!Extracting URL|Downloading|Starting download|Merging|Destination|has already|Writing|Converting|Embedding|Building|Post-processing|already|Downloading subtitles)[^\\[]+$'
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
            # If the user hit cancel, kill yt-dlp and stop.
            with jobs_lock:
                if jobs.get(job_id, {}).get('cancelled'):
                    proc.kill()
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
        # Clean up: finished/cancelled jobs are removed from the table.
        with jobs_lock:
            jobs.pop(job_id, None)


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.route('/')
def index():
    """Serve the main UI page."""
    return send_from_directory(app.static_folder, 'index.html')


@app.route('/docs')
def docs():
    """Serve the in-app API documentation page."""
    return send_from_directory(app.static_folder, 'docs.html')


@app.route('/settings')
def settings():
    """Serve the settings page (theme options)."""
    return send_from_directory(app.static_folder, 'settings.html')


@app.route('/downloads')
def downloads_page():
    """Serve the downloads page (file manager)."""
    return send_from_directory(app.static_folder, 'downloads.html')


@app.route('/api/validate', methods=['POST'])
def validate():
    """Check whether the submitted string is a valid YouTube URL."""
    url = (request.get_json(silent=True) or {}).get('url', '').strip()
    return jsonify(valid=is_valid_url(url), url=url, bulk=is_bulk(url))


@app.route('/api/download', methods=['POST'])
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

    # Register the job (and check the limit) under the lock.
    with jobs_lock:
        if len(jobs) >= MAX_CONCURRENT:
            return jsonify(success=False, error='Too many concurrent downloads'), 429

        job_id = str(int(time.time() * 1000))
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
def status(job_id):
    """Return the current progress/status of a job (polled by the browser)."""
    job = jobs.get(job_id)
    if not job:
        return jsonify(success=False, error='Job not found'), 404
    return jsonify(success=True, job=job)


@app.route('/api/cancel/<job_id>', methods=['POST'])
def cancel(job_id):
    """Flag a running job so its worker thread stops yt-dlp."""
    with jobs_lock:
        job = jobs.get(job_id)
        if not job:
            return jsonify(success=False, error='Job not found'), 404
        job['cancelled'] = True
    return jsonify(success=True, job_id=job_id)


@app.route('/api/downloads')
def list_downloads():
    """List all files currently in the downloads folder (with sizes)."""
    files = []
    for root, _, names in os.walk(DOWNLOADS_DIR):
        for name in names:
            path = os.path.join(root, name)
            files.append({
                'name': os.path.relpath(path, DOWNLOADS_DIR),
                'size': os.path.getsize(path),
            })
    return jsonify(success=True, downloads=files)


@app.route('/api/preview', methods=['POST', 'GET'])
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

    # Collections are large; read them flat (fast, no per-item formats).
    # Single videos get the full (slower) format dump.
    flat = is_bulk(url)
    cmd = ['yt-dlp', '-J', url] + (['--flat-playlist'] if flat else [])

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


@app.route('/downloads/<path:name>')
def download_file(name):
    """Serve a finished file from the downloads folder."""
    try:
        return send_from_directory(DOWNLOADS_DIR, name, as_attachment=True)
    except Exception:
        return jsonify(success=False, error='File not found'), 404


@app.route('/api/delete/<path:name>', methods=['POST'])
def delete_file(name):
    """Delete a file from the downloads folder."""
    # Resolve the real path and make sure it's inside DOWNLOADS_DIR so a
    # crafted name can't delete files elsewhere on disk.
    target = os.path.realpath(os.path.join(DOWNLOADS_DIR, name))
    if not target.startswith(os.path.realpath(DOWNLOADS_DIR)):
        return jsonify(success=False, error='Invalid path'), 400
    if os.path.isfile(target):
        os.remove(target)
        return jsonify(success=True)
    return jsonify(success=False, error='File not found'), 404


@app.route('/health')
def health():
    """Liveness probe: reports that the app is up and how many jobs are running."""
    with jobs_lock:
        running = sum(1 for j in jobs.values() if j['status'] == 'pending')
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
    #   gunicorn -c gunicorn.conf.py Main:app
    # (This block is skipped when Gunicorn imports the module.)
    port = int(os.environ.get('PORT', 6909))
    print(f"Snag -> http://localhost:{port}")
    app.run(host='0.0.0.0', port=port, debug=False)
