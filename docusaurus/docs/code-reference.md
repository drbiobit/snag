---
title: Code Reference
sidebar_position: 2
---

# Snag — Code Reference

This is a file-by-file tour of how Snag actually works. It's written the way
I'd explain it to a new contributor: what each file is *for*, how the pieces
fit together, and the non-obvious decisions hiding in the comments.

If you only read one thing, read the [request lifecycle](#the-request-lifecycle)
section first — it's the single most useful mental model for the whole app.

## The big picture

Snag is deliberately small. The entire backend is **one Python file**
(`snag.py`, ~1000 lines) that wraps the `yt-dlp` command-line tool behind a
Flask API. The frontend is **vanilla HTML/CSS/JS** with no build step, no
framework, and no bundler. Job state lives in process memory; a single
SQLite database (`snag.db`) stores credentials, download history, and the
session signing key.

That simplicity is the point. The whole thing is readable in an afternoon,
and every deployment option (Docker, systemd, PM2, a laptop) works because
there's nothing to configure beyond a port and a download folder.

```
Browser (frontend/)                snag.py (Flask)                yt-dlp (CLI)
   │                                   │                              │
   │  POST /api/download               │                              │
   │ ────────────────────────────────► │  spawns a thread            │
   │                                   │  ┌──────────────────────────►│
   │                                   │  │ reads yt-dlp stdout       │
   │  GET /api/status/<id> (1/s)      │  │ updates jobs[job_id]       │
   │ ◄────────────────────────────────│  └──────────────────────────►│
   │  {progress: 42, message: ...}    │                              │
```

## The request lifecycle

Understanding this one flow makes the rest of the code obvious:

1. **You paste a URL** on the main page. As you type, `app.js` calls
   `POST /api/validate` to check it looks like a YouTube link and colours the
   input green or red.
2. **You hit Download.** `app.js` collects every form field into a JSON body
   and calls `POST /api/download`.
3. **The backend validates** the URL and the user-supplied values (clip
   times, playlist items, cookie browser), then registers a new job in the
   in-memory `jobs` dict and spawns a **background thread** running
   `yt-dlp`. The HTTP request returns *immediately* with just a `job_id` —
   the download is not blocking the request.
4. **The browser polls** `GET /api/status/<job_id>` once per second. The
   worker thread has been parsing `yt-dlp`'s stdout line-by-line and writing
   `progress` / `message` back into the job dict, so each poll returns fresh
   numbers.
5. **When the job finishes**, the worker sets the status to `completed`,
   `error`, or `cancelled`. The next poll sees the terminal state, stops
   polling, and shows the result (the file(s) written) or the real `yt-dlp`
   error.

The key insight: **the download and the HTTP request are decoupled.** The
request just *starts* a job; the actual work happens in a thread, and the
browser learns about it by polling. This is why the app can show live
progress without any websockets.

## Repository layout

```
snag/
├── snag.py                 # the entire backend (Flask app)
├── gunicorn.conf.py        # production server config
├── requirements.txt        # Flask + gunicorn (yt-dlp is a CLI, not a dep)
├── Dockerfile              # Alpine + venv + yt-dlp + ffmpeg
├── .dockerignore           # keeps local artifacts out of the image
├── .env.example            # template for environment variables
├── deploy-with-systemd.sh  # Linux VPS deployment (recommended)
├── deploy-with-pm2.sh      # PM2-based deployment (no Docker/systemd)
├── deploy-for-win-mac.sh   # local run on macOS / Windows (WSL)
├── docker/
│   ├── docker-compose.yml  # compose deployment with a data volume
│   └── README.md           # Docker-specific guide
└── frontend/               # the whole UI (no build step)
    ├── index.html          # main download page
    ├── app.js              # main page logic (validate, download, poll)
    ├── login.html / .js    # first-run setup + sign-in
    ├── settings.html / .js # theme picker + saved defaults
    ├── downloads.html / .js# file manager (list / download / delete)
    ├── docs.html / .js     # in-app API reference page
    ├── style.css           # all styling + theme variables
    └── theme.js            # applies the saved theme before first paint
```

---

## `snag.py` — the backend

This is the heart of the app. I'll walk through it top to bottom in the order
the code appears, because the file is organised to match the runtime flow.

### Startup and configuration

The very top of the file sets up everything the rest of the app depends on.
There are no frameworks doing this for us, so it's all explicit:

- **`BASE`** — the absolute path of the folder `snag.py` lives in. Everything
  else is resolved relative to this, so the app works no matter what
  directory you launch it from.
- **`DOWNLOADS_DIR`** — where finished files go. It reads the `DOWNLOAD_DIR`
  environment variable first (Docker sets this to `/data`), and falls back to
  a `downloads/` folder next to the script. The directory is created on
  startup if it doesn't exist.
- **`app`** — the Flask instance. Note `static_folder` points at `frontend/`
  and `static_url_path` is `/static`, so the browser can grab
  `/static/app.js`, `/static/style.css`, etc.
- **`MAX_CONCURRENT = 2`** — at most two downloads run at once. Anything
  beyond that gets a `429 Too Many Requests`. This is a soft limit to keep a
  single user from forking off dozens of `yt-dlp` processes.
- **`jobs`** — an in-memory dictionary mapping `job_id → job info`. This is
  the *only* server-side state. It's deliberately not persisted: a download
  is either on disk (done) or it isn't (lost on restart), and there's no
  value in re-hydrating a half-finished job.
- **`jobs_lock`** — a `threading.Lock` guarding `jobs`. Because download
  threads and request handlers both read/write this dict, every access is
  wrapped in `with jobs_lock:`.
- **`MAX_PREVIEWS = 2`** and **`previews_active`** — the same idea for the
  preview endpoint, which also spawns a `yt-dlp` process. Without a cap, a
  malicious client could hammer `/api/preview` and fork unlimited processes.

### Authentication

Snag ships with built-in login so you can expose it to the internet without
bolting on an auth system. It's intentionally minimal but does the secure
things right:

- **`_load_secret()`** — the session signing key. It prefers the `SNAG_SECRET`
  env var; otherwise it generates a random key on first start and stores it in
  the SQLite database (`meta` table) so sessions survive a restart. If you wipe
  the config volume without setting `SNAG_SECRET`, you'll be logged out — that's
  expected.
- **`hash_password` / `verify_password`** — passwords are hashed with
  **PBKDF2-SHA256 at 200,000 iterations** and a per-user 16-byte salt.
  Verification uses `hmac.compare_digest` (constant-time) so a timing attack
  can't tell how many characters of a password matched.
- **`get_user` / `add_user` / `delete_user` / `clear_all_users`** — the user
  store is a SQLite table (`users`) in `SNAG_CONFIG_DIR/snag.db`.
- **`log_history` / `get_history` / `clear_history`** — download history is
  tracked in a SQLite table (`history`), recording URL, title, status, files,
  size, and timestamps for every job.
- **`auth_enabled()`** — true if either the `SNAG_USER`/`SNAG_PASSWORD` env
  vars are set *or* a user already exists in the store. This is what decides
  whether the app runs "open" (first-visit setup) or "locked" (sign-in).
- **`check_credentials()`** — tries the env-var credentials first, then the
  stored user. If the username doesn't exist it still runs a dummy hash
  before returning `False`, so an attacker can't distinguish "wrong user"
  from "wrong password" by timing.
- **`login_required`** — the decorator on every protected route. It's
  clever about *how* it rejects: API routes get a JSON `401`, while page
  routes get a redirect to `/login`. And when no credentials are configured
  yet, it redirects to the login page so first-time users land on the
  "create account" form instead of a raw 401.

> **Why env-var auth exists at all:** in a Docker deploy you often want fixed
> credentials baked in at deploy time, not a first-visit flow. Setting
> `SNAG_USER` + `SNAG_PASSWORD` skips the setup page entirely and uses those
> credentials.

### The yt-dlp option tables

These are lookup tables that translate the UI's friendly choices into actual
`yt-dlp` flags:

- **`FORMATS`** — the "quality" dropdown → a format selector string. Every
  video option asks for `bestvideo+bestaudio` (capped at a height) and lets
  `yt-dlp` merge them. `'audio'` and `'video'` are the raw single-stream
  cases.
- **`AUDIO_QUALITY`** — the bitrate dropdown → `--audio-quality`. The keys
  `0–4` map to `0` (highest/VBR) through `320k`.
- **`VIDEO_FORMATS` / `AUDIO_FORMATS`** — the set of containers the app will
  pass to `--merge-output-format` (mp4/webm/mkv/mov) or `--audio-format`
  (mp3/m4a/wav/ogg/flac). Anything outside these sets falls back to a default.
- **`YT_RE`** — a regex that recognises the common YouTube URL shapes
  (watch, playlist, shorts, channel, user, `@handle`, `youtu.be`). It's used
  to reject anything that isn't YouTube before it ever reaches `yt-dlp`.
- **`TIME_RE`** — validates clip timestamps (plain seconds, `MM:SS`, or
  `H:MM:SS`).
- **`PLAYLIST_ITEMS_RE`** — validates the playlist-item picker, e.g.
  `1,3,5-10`.
- **`COOKIE_BROWSERS`** — the list of browsers `--cookies-from-browser`
  accepts, kept in sync with `yt-dlp`'s own list.

### Validation helpers

A short cluster of pure functions that keep untrusted input out of the
`yt-dlp` command line:

- **`is_valid_url`** — does the string match `YT_RE`?
- **`is_valid_time`** — is it empty or a valid clip timestamp?
- **`is_valid_playlist_items`** — empty or a valid `1,3,5-10` picker?
- **`is_valid_cookies`** — empty or a recognised browser name?
- **`is_inside_downloads(path)`** — the path-traversal guard. It resolves the
  real path and checks it's *strictly inside* `DOWNLOADS_DIR` using
  `os.path.commonpath` rather than a naive `startswith`, so a sibling folder
  named `downloads-evil` can't slip past it.
- **`is_bulk(url)`** — true for collections (playlist/channel/user). Bulk
  downloads get `--yes-playlist` and the playlist-index/item-picker options;
  single videos get the custom output-template option instead.

### `build_args` — the function that matters most

`build_args(...)` takes every user choice and assembles the exact `yt-dlp`
command-line argument list. If you ever want to add a new option to the UI,
this is where it gets wired to a flag. A few things worth knowing about how
it behaves:

- **Thumbnail-only mode** is handled first and returns early: it builds a
  `--write-thumbnail --skip-download` command that grabs just each video's
  cover image. This is the fast way to collect a whole channel's thumbnails.
- **Audio vs video** branches next. Audio-only uses `-x --audio-format …
  --audio-quality …`; video uses the chosen `FORMATS` selector plus
  `--merge-output-format`.
- **Output path** — a custom `--output-template` is honoured *only* for single
  downloads *and* only if it passes `is_inside_downloads`. Otherwise it falls
  back to the default `downloads/%(title)s.%(ext)s`. This is a deliberate
  safety net: a crafted template can't write outside the downloads folder.
- **`--restrict-filenames`** is always added so filenames are safe on every
  OS (no `:`, `/`, etc.).
- The remaining options are added conditionally: `--yes-playlist` (bulk),
  `--playlist-index` / `--playlist-items` (bulk), `--embed-metadata`
  (opt-in), subtitles (`--write-subs --sub-langs …`, optionally
  `--embed-subs`), clip trimming (`--download-sections start-end`
  `--force-keyframes-at-cuts`), resume (`--continue --break-on-existing`),
  fragment threads (`-N`), and cookies (`--cookies-from-browser`).
- The URL is always appended last.

> **A subtle bug the code avoids:** there is no bare `--trim` flag — `yt-dlp`
> would parse it as the integer `--trim-filenames`. That's why trimming uses
> `--download-sections` with a `start-end` string.

### `run_job` — the worker thread

`run_job(job_id, …)` is the function that runs in the background thread. It:

1. Starts `yt-dlp` via `subprocess.Popen`, merging `stderr` into `stdout` so
   everything is captured in one stream.
2. **Reads output line by line** (live). For each line it:
   - checks the cancel flag and, if set, `terminate()`s the process (with a
     `kill()` fallback) and marks the job cancelled;
   - keeps a rolling tail of the last ~15 lines for error reporting;
   - for bulk downloads, counts `[info] Extracting URL:` lines to track which
     file is current, grabs the file's title, and records per-file progress;
   - captures `[info] Destination:` lines so the UI knows the exact file(s)
     the job produced;
   - parses `[download] 42.5% …` progress lines and updates
     `job['progress']` and `job['message']`.
3. When `yt-dlp` exits, it decides success vs failure from the exit code. On
   failure it stores the last few lines in `job['error']` so the UI can show
   the *real* reason the download failed, not a generic message.
4. In a `finally` block it removes the job from the `jobs` dict — finished and
   cancelled jobs are cleaned up so the dict only ever holds live jobs.

The three regexes at the top of the function (`NEW_ITEM_RE`, `DEST_RE`,
`INFO_TITLE_RE`) are what let the app turn `yt-dlp`'s human-readable output
into structured progress. `INFO_TITLE_RE` is the trickiest: it matches a bare
`[info] <title>` line but explicitly *excludes* the known status messages
(Extracting, Merging, Destination, etc.) so it only fires on the actual title.

### The routes

The endpoints, grouped by purpose:

**Auth**
- `GET /api/auth-status` — tells the login page whether to show setup or
  sign-in.
- `POST /api/setup` — first-run account creation. Only works while no users
  exist; enforces a minimum 4-character password.
- `POST /api/login` — verifies credentials and starts a session.
- `POST /api/logout` — clears the session.

**Pages** (all `@login_required`)
- `GET /` → `index.html`, `GET /docs` → `docs.html`, `GET /settings` →
  `settings.html`, `GET /downloads` → `downloads.html`, `GET /login` →
  `login.html`.

**Downloads**
- `POST /api/validate` — is this a valid YouTube URL? (also reports if it's
  bulk).
- `POST /api/download` — the main endpoint. Validates everything, checks the
  concurrency limit, registers the job, spawns the thread, returns `job_id`.
- `GET /api/status/<job_id>` — polled every second for progress.
- `POST /api/cancel/<job_id>` — flags the job so its worker thread stops
  `yt-dlp`.

**File management**
- `GET /api/downloads` — lists every file in the downloads folder with size
  and mtime.
- `GET /downloads/<name>` — serves a finished file as a download.
- `POST /api/delete/<name>` — deletes a file, after the `is_inside_downloads`
  path-traversal check.

**Preview & health**
- `POST|GET /api/preview` — runs `yt-dlp -J` (no download) and returns the
  title, item count, available resolutions, and audio codecs. For collections
  it uses `--flat-playlist` so it's fast. Capped at `MAX_PREVIEWS`.
- `GET /health` — the liveness probe (no auth). Reports status, uptime, and
  the number of active jobs. Docker's healthcheck hits this.

### Entry point

The `if __name__ == '__main__':` block runs the Flask **dev server** on
`PORT` (default `6909`). This is for local development only. In production
you run Gunicorn (`gunicorn -c gunicorn.conf.py snag:app`), which imports the
`app` object directly and skips this block entirely.

---

## `gunicorn.conf.py` — production server

Gunicorn is the WSGI server that actually runs the app in production. The
config is small but has one critical constraint:

- **`workers = 1`** (from the `GUNICORN_WORKERS` env var). This **must** stay
  1. The `jobs` dict lives in a single process's memory, so if you ran
  multiple workers, a `/api/status` poll could land on a different worker than
  the one that registered the job and get a 404. Concurrency comes from
  **threads** (`threads = 4`), not workers.
- **`bind = "0.0.0.0:8000"`** — listens on all interfaces.
- **`timeout = 120`** — fine because downloads run in background threads and
  the HTTP request returns fast.
- **Logging to stdout/stderr** (`-`) so a process manager (systemd, Docker)
  can capture it.
- **`proc_name = "snag"`** — shows up as `snag` in `ps`/`top`.

---

## `requirements.txt`

Just two pinned packages:

```
Flask==3.1.3
gunicorn==26.0.0
```

`yt-dlp` is *not* here on purpose — it's a command-line tool the app shells
out to, so the deploy scripts (and the Dockerfile) install it separately with
`pip install yt-dlp`. Pinning Flask and gunicorn keeps deploys reproducible.

---

## The frontend

Everything in `frontend/` is plain HTML/CSS/JS. There's no `package.json`, no
bundler, no framework. Flask serves these files directly from `/static`, and
the pages talk to the backend with `fetch`. This keeps the whole UI trivially
deployable and easy to hack on.

### `index.html` + `app.js` — the main page

`index.html` is the download form: a URL box, a type selector (single/bulk),
and a collapsible set of options (quality, format, audio, clip trimming,
subtitles, playlist picker, cookies, thumbnails, resume, metadata, fragment
threads, output template).

`app.js` is the logic. The important functions:

- **`validateUrl()`** — debounced-by-typing call to `/api/validate`. Colours
  the input, sets an `aria-invalid` attribute, and enables the Download button
  only when the URL is valid.
- **`toggleFormats()` / `toggleTemplate()` / `toggleSubs()` /
  `toggleThumbs()`** — show/hide option groups based on the current state.
  E.g. "audio only" reveals the audio format + bitrate and hides the video
  format; a bulk URL hides the output template and reveals the playlist
  picker; "thumbnails only" hides all the media-format controls.
- **`loadDefaults()`** — reads the user's saved defaults from
  `localStorage` (set on the Settings page) and pre-fills the form.
- **`startDownload()`** — collects the whole form into a JSON body, calls
  `/api/download`, stores the returned `job_id`, switches the UI into
  "downloading" mode, and starts a 1-second `setInterval` polling loop.
- **`poll()`** — one poll. Updates the progress bar and message, renders the
  per-file list for bulk downloads, and handles the terminal states
  (completed → show the file(s); error → show the real `yt-dlp` error;
  cancelled → reset). If the job is gone (server restarted) it stops polling
  without leaking the timer.
- **`renderFileList(job)`** — for bulk jobs, draws a row per file with its
  title and percent. It keeps a module-level cache of titles so a title
  persists across polls that don't carry one.
- **`preview()`** — calls `/api/preview` and shows the title, item count,
  resolutions, and audio codecs in a small panel before you commit to a
  download.
- **`cancelDownload()`** — calls `/api/cancel/<id>`.
- **Keyboard shortcuts** — `/` focuses the URL box, `Enter` starts (when the
  button is enabled), `Esc` cancels the running job.

`handle401(r)` is a tiny helper on every page: if a `fetch` comes back `401`,
the session expired, so redirect to `/login`.

### `login.html` + `login.js` — first-run setup + sign-in

On load, `login.js` calls `/api/auth-status`. If no account exists yet it
shows the **create account** form (first run); otherwise it shows the
**sign-in** form. The setup form posts to `/api/setup` and the login form to
`/api/login`; both redirect to `/` on success. This is how a fresh install
gets its first credentials without any config.

### `settings.html` + `settings.js` — themes + saved defaults

Two independent features on one page:

- **Theme swatches** — click a swatch and `window.snagSetTheme(name)` (from
  `theme.js`) applies and persists it. The active swatch is highlighted on
  load.
- **Default download options** — a form that saves your preferred quality,
  formats, fragment count, etc. to `localStorage` under the `snag-defaults`
  key. The main page's `loadDefaults()` reads that key and pre-fills the
  form, so you don't re-pick your settings every time. There's a "clear"
  button to fall back to the built-in defaults.

### `downloads.html` + `downloads.js` — file manager

Lists everything in the downloads folder (from `/api/downloads`), sorted by
size. Each row has a **download** link (`/downloads/<name>`) and a **delete**
button (which confirms, then posts to `/api/delete/<name>` and refreshes).
Delete buttons use event delegation because the rows are re-created on every
refresh.

### `docs.html` + `docs.js` — in-app API reference

A static page listing the HTTP endpoints with example `curl` commands.
`docs.js` does two things: it fills in the page's base URL with
`window.location.origin` (so the examples reflect where you're actually
running), and it wires up **click-to-copy** on every code block (with a
`textarea` + `execCommand` fallback for older browsers).

### `theme.js` — theme management

Loaded in the `<head>` so the theme is applied **before first paint** (no
flash of the default theme). It reads the saved theme from `localStorage` and
sets a `data-theme` attribute on `<html>`; the CSS defines each theme via
`[data-theme="…"]` selectors. It exposes two globals the other pages use:
`window.snagSetTheme(name)` (set + persist) and `window.snagGetTheme()`.
`"black"` is the default and needs no attribute.

### `style.css` — all the styling

A single ~830-line stylesheet. It defines the CSS custom properties
(`--accent`, `--bg`, `--muted`, etc.) that every theme overrides, plus all the
component styles (form fields, progress bar, file list, tags, buttons).
Because the themes are just different values for the same variables, adding a
new theme is a matter of adding one `[data-theme="…"]` block.

---

## The deployment scripts

These are the four ways to run Snag in the wild. Each is a self-contained bash
script that checks prerequisites, sets up a virtualenv, and starts the app.
See the [Deployment guide](/deployment) for when to use which.

- **`deploy-with-systemd.sh`** — the recommended option for a Linux VPS.
  Creates a venv, writes a `/etc/systemd/system/snag.service` unit (running as
  your non-root user, with `Restart=on-failure`), and enables it so the app
  survives reboots. Run with `sudo`.
- **`deploy-with-pm2.sh`** — for a single server where you want auto-restart
  and boot-start but don't have Docker or systemd. Uses PM2 to supervise
  Gunicorn.
- **`deploy-for-win-mac.sh`** — a lightweight local run for macOS or Windows
  (via WSL / Git Bash). It detects the OS, offers to install anything missing
  (Homebrew / winget / apt), sets up the venv, and starts the Flask dev
  server. Not for headless servers.

## Where to add a new feature

A quick map for the most common changes:

| You want to… | Edit |
|---|---|
| Add a new download option to the UI | `frontend/index.html` (the field), `frontend/app.js` (collect + send it), `snag.py` → `build_args` (turn it into a `yt-dlp` flag) |
| Add a new quality/format choice | the `FORMATS` / `AUDIO_QUALITY` / `*_FORMATS` tables in `snag.py`, plus the `<select>` in `index.html` |
| Change the port | `gunicorn.conf.py` (`bind`) or the `PORT` env var |
| Add a new theme | one `[data-theme="…"]` block in `frontend/style.css` + a swatch in `settings.html` |
| Change the concurrency limit | `MAX_CONCURRENT` / `MAX_PREVIEWS` in `snag.py` |
