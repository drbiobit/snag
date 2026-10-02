# Snag — Code Documentation

A crisp reference for how the Snag codebase is put together. For deployment
steps, see [DEPLOYMENT.md](DEPLOYMENT.md). For the raw yt-dlp CLI flags, see
[../YT-DLP_FLAGS_REFERENCE.md](../YT-DLP_FLAGS_REFERENCE.md).

---

## 1. Architecture at a glance

Snag is a tiny **Flask** app that wraps the **yt-dlp** CLI. The browser talks
to Flask over HTTP; Flask shells out to `yt-dlp` in a background thread and
streams progress back.

```
┌────────────┐   HTTP (JSON)   ┌─────────────┐  subprocess   ┌─────────┐
│  Browser   │ ───────────────▶│  Flask app  │ ────────────▶ │ yt-dlp  │
│ (frontend) │ ◀───────────────│  (Main.py)  │ ◀──────────── │ (CLI)   │
└────────────┘   poll status   └─────────────┘   stdout      └─────────┘
                                            │
                                            ▼
                                     downloads/  (files on disk)
```

Key idea: the download **request returns immediately** with a `job_id`. The
actual download runs in a **daemon thread**. The browser then **polls**
`/api/status/<job_id>` to render live progress. This keeps the HTTP request
short and the UI responsive.

---

## 2. File map

| File | Role |
|------|------|
| `Main.py` | The entire backend: Flask routes, yt-dlp argument builder, job runner. |
| `frontend/index.html` | Main UI page (download form + live status). |
| `frontend/app.js` | Frontend logic: validate, start, poll, cancel, preview. |
| `frontend/style.css` | All styling + the 4 theme palettes (CSS variables). |
| `frontend/theme.js` | Applies + persists the chosen theme in `localStorage`. |
| `frontend/docs.html` / `docs.js` | In-app API documentation page. |
| `frontend/settings.html` / `settings.js` | Settings page (theme + default download options). |
| `frontend/downloads.html` / `downloads.js` | Downloads page (list / open / delete files). |
| `frontend/favicon.svg` | Browser tab icon. |
| `gunicorn.conf.py` | Gunicorn config for production. |
| `requirements.txt` | Python deps (`Flask`, `gunicorn`). |
| `downloads/` | Output folder (created at runtime). |

The backend is a **single file** (`Main.py`) on purpose — the whole server
fits in ~500 lines including comments.

---

## 3. Backend (`Main.py`)

### 3.1 Module-level state

| Name | Purpose |
|------|---------|
| `STARTED_AT` | Timestamp of process start; used by `/health` for uptime. |
| `BASE` | Absolute path of the app folder (so it runs from any CWD). |
| `DOWNLOADS_DIR` | Where files are saved. Honors the `DOWNLOAD_DIR` env var, else `./downloads`. |
| `app` | The Flask app. Static files are served from `frontend/` at `/static`. |
| `MAX_CONCURRENT` | Hard cap on simultaneous downloads (2). |
| `jobs` | In-memory dict: `job_id -> job info`. Lost on restart (fine — files persist on disk). |
| `jobs_lock` | A `threading.Lock` guarding all reads/writes of `jobs`. |

### 3.2 Lookup tables

- **`FORMATS`** — maps the UI quality choice (`best`, `1080`, `720`, `480`,
  `audio`, `video`) to a yt-dlp `-f` format selector. Video entries ask for
  `bestvideo+bestaudio` so yt-dlp merges the two streams.
- **`AUDIO_QUALITY`** — maps the UI bitrate choice (`0`–`4`) to a
  `--audio-quality` value (`0` = highest/VBR).
- **`VIDEO_FORMATS` / `AUDIO_FORMATS`** — the allowed output containers.
- **`YT_RE`** — a regex matching YouTube URL shapes (watch, playlist, shorts,
  channel, user, `@handle`, `youtu.be`).

### 3.3 Core functions

**`is_valid_url(url)`** — returns `True` if the string matches `YT_RE`.

**`is_bulk(url)`** — returns `True` for collections (playlist/channel/user).
Only *single* videos get the custom output-template option.

**`build_args(...)`** — the heart of the backend. Takes the request options
and returns the full `yt-dlp` argument list. Logic:

1. Pick the output format (audio codec if audio-only, else video container),
   falling back to `mp3`/`mp4` if unrecognised.
2. Decide audio-only vs video and build the `-f` selector + extra flags
   (`-x --audio-format … --audio-quality …` for audio;
   `--merge-output-format …` for video).
3. Choose the output path — a custom `-o` template for single downloads,
   else `downloads/%(title)s.%(ext)s`.
4. Append `--yes-playlist` for bulk, plus `--playlist-index` if the user chose
   to merge a bulk download into one file (`mkv`/`mp4`) or write an M3U.
5. Append opt-in flags: `--embed-metadata …` (metadata),
   `--continue --break-on-existing` (resume), `-N <n>` (fragment threads).
6. Append the URL and return.

**`parse_progress(line)`** — extracts the percentage from a yt-dlp
`[download] 42.5% …` line, or `None`.

**`run_job(job_id, ...)`** — runs in its own thread. It:
- Starts `yt-dlp` via `subprocess.Popen` with `stderr=STDOUT` so all output
  is captured in one stream.
- Reads stdout line by line, updating `job['progress']` / `job['message']`.
- Keeps a rolling tail of the last ~15 lines so the **real error** can be
  surfaced on failure (`job['error']`).
- Checks the `cancelled` flag each line and kills the process if set.
- Sets final status to `completed` (exit 0) or `error` (non-zero), then
  removes the job from the table.

### 3.4 Routes

| Route | Method | What it does |
|-------|--------|--------------|
| `/` | GET | Serves `index.html`. |
| `/docs` | GET | Serves `docs.html`. |
| `/settings` | GET | Serves `settings.html`. |
| `/downloads` | GET | Serves `downloads.html`. |
| `/api/validate` | POST | `{url}` → `{valid, bulk}`. |
| `/api/download` | POST | Validates, enforces the concurrency cap, registers a job, spawns the thread, returns `{job_id}`. |
| `/api/status/<job_id>` | GET | Returns the current job dict (polled by the browser). |
| `/api/cancel/<job_id>` | POST | Sets the job's `cancelled` flag. |
| `/api/downloads` | GET | Lists files in `DOWNLOADS_DIR` with sizes. |
| `/api/preview` | POST | Runs `yt-dlp --flat-playlist -J` (no download) and returns title + available resolutions/audio codecs. |
| `/downloads/<name>` | GET | Serves a finished file as an attachment. |
| `/api/delete/<name>` | POST | Deletes a file (with a path-traversal guard). |
| `/health` | GET | Liveness: `{status, app, time, uptime_seconds, active_jobs}`. |

### 3.5 Security notes

- **Path traversal guard** — `/api/delete` and `/downloads/<name>` resolve the
  real path and refuse anything that escapes `DOWNLOADS_DIR`.
- **Concurrency** — the `jobs_lock` serialises all mutations of the shared
  `jobs` dict.
- **Non-root in Docker** — the image runs as a dedicated `snag` user.

### 3.6 Entry point

```python
if __name__ == '__main__':
    port = int(os.environ.get('PORT', 6909))
    app.run(host='0.0.0.0', port=port, debug=False)
```

This block only runs when you execute `python Main.py` directly (local dev,
port **6909**). Under Gunicorn the module is *imported* instead, so this block
is skipped and Gunicorn serves the `app` object on **8000** (see
`gunicorn.conf.py`). There is no port proxying — they're two separate servers.

---

## 4. Frontend

### 4.1 Pages

All pages share the same **top header** (`.topbar`) with the app name and nav
icons (app / downloads / docs / settings). Content is full-width with fluid
gutters — no sidebar.

- **App** (`index.html` / `app.js`) — the download form and live status.
- **Downloads** (`downloads.html` / `downloads.js`) — file manager.
- **Docs** (`docs.html` / `docs.js`) — in-app API reference with copy buttons.
- **Settings** (`settings.html` / `settings.js`) — theme picker + saved
  download defaults.

### 4.2 `app.js` flow

1. **Load defaults** — reads `snag-defaults` from `localStorage` (set on the
   Settings page) and pre-fills the form.
2. **Validate** — as the user types, POSTs to `/api/validate` to enable the
   download button and detect bulk vs single (toggles the output-template vs
   playlist-index fields).
3. **Start** — POSTs to `/api/download`, stores the `job_id`, and begins polling.
4. **Poll** — every ~800 ms GETs `/api/status/<job_id>` and updates the
   progress bar. On `completed` it shows the newest file; on `error` it shows
   the real yt-dlp error from `job.error`.
5. **Cancel** — POSTs to `/api/cancel/<job_id>`.
6. **Preview** — POSTs to `/api/preview` and renders title + resolution/codec
   tags without downloading.

**Keyboard shortcuts:** `Enter` starts, `Esc` cancels, `/` focuses the URL box.

### 4.3 Theming (`theme.js` + `style.css`)

Themes are plain CSS variables. `theme.js` reads `snag-theme` from
`localStorage` and sets `document.documentElement.dataset.theme` **before
paint** (to avoid a flash). Three themes: `black` (default), `charcoal`,
`light`. The font is always Ubuntu Mono (no picker).

### 4.4 Settings persistence

The Settings page stores two things in `localStorage`:
- `snag-theme` — the chosen theme (applied app-wide by `theme.js`).
- `snag-defaults` — default download options, pre-filled into the app form on
  load.

---

## 5. Data flow for one download

```
user clicks download
        │
        ▼
POST /api/download  ──▶  validate URL
        │                 register job (id = timestamp ms)
        │                 start daemon thread → run_job
        ▼
returns {job_id}
        │
        ▼
browser polls GET /api/status/<job_id>  (every 800 ms)
        │                 thread: yt-dlp stdout → job.progress
        ▼
job.status == "completed"  →  show newest file
job.status == "error"      →  show job.error (real yt-dlp message)
```

---

## 6. Environment variables

| Variable | Default | Meaning |
|----------|---------|---------|
| `PORT` | `6909` | Port for `python Main.py` (dev only). |
| `DOWNLOAD_DIR` | `./downloads` | Where finished files are saved. |
| `GUNICORN_WORKERS` | `4` | Gunicorn worker count (production). |
