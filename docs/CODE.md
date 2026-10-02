# Snag — Code Reference

Function-by-function reference for `Main.py` and the frontend files.
Each entry explains what the function does, then lists the HTML/JS files
that call into it (directly or via the HTTP endpoints it serves).

---

## Main.py

### Setup constants

| Name | What it is |
|---|---|
| `STARTED_AT` | `time.time()` at import. Used by `/health` to report uptime. |
| `BASE` | Absolute path of the folder containing `Main.py`. |
| `DOWNLOADS_DIR` | Where finished files are saved. Env `DOWNLOAD_DIR` or `./downloads`. |
| `app` | The Flask instance. Static files served from `frontend/` at `/static`. |
| `MAX_CONCURRENT` | Max simultaneous downloads (2). |
| `jobs` | In-memory dict: `job_id → job info`. Lost on restart. |
| `jobs_lock` | `threading.Lock` guarding `jobs`. |
| `MAX_PREVIEWS` | Max simultaneous `/api/preview` calls (2). |
| `previews_active` | Current preview count (guarded by `previews_lock`). |
| `DATA_DIR` | Where auth data lives. Env `DATA_DIR` or `./data`. |
| `USERS_FILE` | `data/users.json` — the user store. |
| `SECRET_FILE` | `data/secret` — the session signing key. |
| `PBKDF2_ITERATIONS` | 200 000 — work factor for password hashing. |

### Lookup tables

| Name | Purpose |
|---|---|
| `FORMATS` | UI quality label → yt-dlp `-f` selector. |
| `AUDIO_QUALITY` | UI bitrate key (0–4) → yt-dlp `--audio-quality` value. |
| `VIDEO_FORMATS` | Allowed video containers: mp4, webm, mkv, mov. |
| `AUDIO_FORMATS` | Allowed audio codecs: mp3, m4a, wav, ogg, flac. |
| `YT_RE` | Regex matching YouTube URL shapes (watch, playlist, channel, etc.). |
| `TIME_RE` | Regex for clip timestamps: seconds, MM:SS, H:MM:SS. |
| `PLAYLIST_ITEMS_RE` | Regex for the playlist-item picker: `1,3,5-10`. |
| `COOKIE_BROWSERS` | Set of browser names yt-dlp accepts for `--cookies-from-browser`. |

### Auth

#### `_load_secret()`

Returns the Flask session signing key. Checks `SNAG_SECRET` env var first,
then `data/secret` on disk, then generates a new 32-byte URL-safe token and
persists it (chmod 600). Called once at import to set `app.secret_key`.

**Frontend:** no direct caller. The key signs the `session` cookie that all
authenticated requests carry.

#### `hash_password(password, salt=None) → (salt_hex, hash_hex)`

PBKDF2-SHA256 with 200k iterations. Generates a random 16-byte salt if none
is given. Returns the salt and derived key as hex strings.

**Frontend:** no direct caller. Used by `api_setup` and `check_credentials`.

#### `verify_password(password, salt_hex, hash_hex) → bool`

Re-derives the hash with the stored salt and compares in constant time
(`hmac.compare_digest`).

**Frontend:** no direct caller. Used by `check_credentials`.

#### `load_users() → dict`

Reads `data/users.json`. Returns `{}` if the file doesn't exist.
Shape: `{username: {salt, hash}}`.

**Frontend:** no direct caller. Used by `auth_enabled` and `check_credentials`.

#### `save_users(users)`

Writes the user store to `data/users.json` (chmod 600).

**Frontend:** no direct caller. Used by `api_setup`.

#### `auth_enabled() → bool`

True if credentials are configured: either both `SNAG_USER`/`SNAG_PASSWORD`
env vars are set, or `data/users.json` is non-empty.

**Frontend:** called by `login.js` via `GET /api/auth-status` (returns
`needs_setup: !auth_enabled()`).

#### `check_credentials(username, password) → bool`

Verifies login. Env vars take priority; falls back to the user store.
Burns a dummy PBKDF2 when the username is unknown (timing-attack defence).

**Frontend:** called by `login.js` via `POST /api/login`.

#### `login_required(f)` — decorator

Wraps a route. Logic:

1. No credentials configured → API routes pass through; pages redirect to `/login`.
2. Session has `authed` → pass through.
3. Otherwise → API routes return 401; pages redirect to `/login`.

Applied to: `index`, `docs`, `settings`, `downloads_page`, `validate`,
`download`, `status`, `cancel`, `list_downloads`, `preview`, `download_file`,
`delete_file`.

**Frontend:** every `fetch()` in `app.js`, `downloads.js`, and `login.js`
checks for a 401 response and redirects to `/login` (`handle401` helper).

### Validators

#### `is_valid_url(url) → bool`

Matches the string against `YT_RE`.

**Frontend:** called server-side by `validate` and `download`. The client
calls `POST /api/validate` from `app.js:validateUrl()` to colour the URL
input and enable/disable the Download button.

#### `is_valid_time(s) → bool`

True if `s` is empty or matches `TIME_RE` (clip start/end).

**Frontend:** called server-side by `download`. The client sends the values
from the `trim-start` / `trim-end` inputs in `app.js:startDownload()`.

#### `is_valid_playlist_items(s) → bool`

True if `s` is empty or matches `PLAYLIST_ITEMS_RE`.

**Frontend:** called server-side by `download`. Client sends from the
`playlist-items` input in `app.js:startDownload()`.

#### `is_valid_cookies(s) → bool`

True if `s` is empty or a recognised browser name.

**Frontend:** called server-side by `download`. Client sends from the
`cookies` select in `app.js:startDownload()`.

#### `is_inside_downloads(path) → bool`

Path-traversal guard. Uses `os.path.commonpath` to ensure the resolved path
is strictly inside `DOWNLOADS_DIR`.

**Frontend:** no direct caller. Used server-side by `download` (output
template check) and `delete_file`.

#### `is_bulk(url) → bool`

True if the URL looks like a collection (playlist, channel, user profile).

**Frontend:** called server-side by `validate` (returned as `bulk` in the
response) and `download` / `preview`. Client uses `d.bulk` in
`app.js:validateUrl()` to toggle the template vs. playlist field groups,
and in `app.js:preview()` to decide which meta info to show.

### Core logic

#### `build_args(url, d, …) → list[str]`

Assembles the full `yt-dlp` command-line argument list from the user's
options. Handles:

- thumbnail-only mode (early return)
- audio-only vs. video format selection
- output path (custom template for single, default for bulk)
- bulk flags (`--yes-playlist`, `--playlist-index`, `--playlist-items`)
- metadata, subtitles, trimming, resume, fragments, cookies

**Frontend:** no direct caller. Called by `run_job` (background thread).
The user's options originate from the form fields in `index.html`, collected
in `app.js:startDownload()`, sent via `POST /api/download`.

#### `parse_progress(line) → float | None`

Extracts the percentage from a yt-dlp `[download] 42.5% …` line.

**Frontend:** no direct caller. Used by `run_job` to update `job['progress']`,
which `app.js:poll()` reads via `GET /api/status/<job_id>` and renders into
the progress bar.

#### `run_job(job_id, url, d, …)` — background thread

Runs one download. Steps:

1. Spawns `yt-dlp` via `subprocess.Popen` (args from `build_args`).
2. Reads stdout line-by-line. For each line:
   - checks the cancel flag (terminates the process if set)
   - keeps a 15-line rolling tail for error reporting
   - tracks bulk file index, current title, per-file progress
   - records output file paths (`Destination:` lines)
   - updates `job['progress']` and `job['message']`
3. On exit: sets `job['status']` to `completed` or `error` (with the tail).
4. `finally`: removes the job from the `jobs` dict.

**Frontend:** the browser polls `GET /api/status/<job_id>` once per second
(`app.js:poll()`). The job dict fields read by the frontend:

| Field | Used in |
|---|---|
| `progress` | progress bar width + percentage text |
| `message` | status line under the bar |
| `status` | terminal-state handling (completed / error / cancelled) |
| `error` | error box (last 10 lines of yt-dlp output) |
| `files` | results panel (file name + size) |
| `file_index` | bulk: "file N" counter |
| `current_file` | bulk: title of the file being downloaded |
| `file_progress` | bulk: per-file percentage list |

Cancel is triggered by `app.js:cancelDownload()` → `POST /api/cancel/<job_id>`,
which sets `job['cancelled'] = True`; the next line-read in `run_job` sees it
and terminates yt-dlp.

### Routes

#### `GET /api/auth-status` → `auth_status()`

Returns `{auth_enabled, needs_setup, authed}`. No auth required (the login
page needs it before a session exists).

**Frontend:** `login.js:init()` calls this on page load to decide whether to
show the setup panel or the sign-in panel.

#### `GET /login` → `login_page()`

Serves `login.html`. Redirects to `/` if already authed.

**Frontend:** `login.html` + `login.js`. Also the redirect target for all
401 responses in `app.js` and `downloads.js` (`handle401`).

#### `POST /api/setup` → `api_setup()`

First-run account creation. Rejects if credentials already exist. Validates
username + password (min 4 chars), hashes, saves to `data/users.json`, sets
the session.

**Frontend:** `login.js` setup-form submit handler.

#### `POST /api/login` → `api_login()`

Verifies credentials via `check_credentials`, sets the session.

**Frontend:** `login.js` login-form submit handler.

#### `POST /api/logout` → `api_logout()`

Clears the session (Flask sends an expired cookie).

**Frontend:** no current caller in the JS (no logout button in the UI yet).
Available for future use.

#### `GET /` → `index()`

Serves `index.html`. Protected by `@login_required`.

**Frontend:** `index.html` + `app.js` + `style.css` + `theme.js`.

#### `GET /docs` → `docs()`

Serves `docs.html`. Protected by `@login_required`.

**Frontend:** `docs.html` + `docs.js` + `style.css` + `theme.js`.

#### `GET /settings` → `settings()`

Serves `settings.html`. Protected by `@login_required`.

**Frontend:** `settings.html` + `settings.js` + `style.css` + `theme.js`.

#### `GET /downloads` → `downloads_page()`

Serves `downloads.html`. Protected by `@login_required`.

**Frontend:** `downloads.html` + `downloads.js` + `style.css` + `theme.js`.

#### `POST /api/validate` → `validate()`

Checks whether the submitted string is a valid YouTube URL. Returns
`{valid, url, bulk}`.

**Frontend:** `app.js:validateUrl()` — called on every `input` event on the
URL field. Colours the input green/red, enables/disables the Download button.

#### `POST /api/download` → `download()`

Starts a download. Validates URL + all user-supplied values, enforces the
concurrency limit, registers a job in `jobs`, spawns a `run_job` thread.
Returns `{success, job_id}`.

**Frontend:** `app.js:startDownload()` — collects all form fields from
`index.html`, sends the JSON body, then starts polling.

#### `GET /api/status/<job_id>` → `status()`

Returns the current job dict (or 404 if gone).

**Frontend:** `app.js:poll()` — called every 1 s via `setInterval`. Updates
the progress bar, status message, bulk file list, and handles terminal states.

#### `POST /api/cancel/<job_id>` → `cancel()`

Sets `job['cancelled'] = True`. The `run_job` thread picks it up on the next
line-read and terminates yt-dlp.

**Frontend:** `app.js:cancelDownload()` — triggered by the Cancel button or
the Escape key.

#### `GET /api/downloads` → `list_downloads()`

Walks `DOWNLOADS_DIR` and returns every file with name, size, mtime.

**Frontend:**
- `downloads.js:load()` — populates the file list on the downloads page.
- `app.js:poll()` — fallback when `job.files` is empty (older server).

#### `POST|GET /api/preview` → `preview()`

Runs `yt-dlp -J` (no download) and returns title, item count, available
resolutions and audio codecs. Uses `--flat-playlist` for collections (fast).
Enforces a 2-concurrent limit. 90 s timeout.

**Frontend:** `app.js:preview()` — triggered by the Preview button. Shows a
panel with the title, resolution tags, and audio codec tags.

#### `GET /downloads/<path:name>` → `download_file()`

Serves a file from `DOWNLOADS_DIR` as an attachment.

**Frontend:**
- `downloads.js:row()` — the "download" link on each file row.
- `app.js` open-btn — `window.open('/downloads/<name>')` in the results panel.

#### `POST /api/delete/<path:name>` → `delete_file()`

Deletes a file after verifying the path is inside `DOWNLOADS_DIR`.

**Frontend:** `downloads.js:del()` — the "delete" button on each file row
(with a `confirm()` dialog).

#### `GET /health` → `health()`

Liveness probe. Returns app name, timestamp, uptime, active job count.
**Not** behind `@login_required` (container healthchecks need it open).

**Frontend:** no frontend caller. Used by the Docker healthcheck
(`curl /health` in `docker-compose.yml`).

### Entry point

```python
if __name__ == '__main__':
    port = int(os.environ.get('PORT', 6909))
    app.run(host='0.0.0.0', port=port, debug=False)
```

Local development only. In production, Gunicorn imports `Main:app` and this
block is skipped.

---

## Frontend files

### `frontend/index.html`

The main UI page. Single-page form with:

- URL input + type selector (video / bulk / mp3)
- Quality, format, bitrate, and advanced options (resume, fragments,
  metadata, subtitles, trimming, playlist picker, cookies, thumbnails)
- Download / Cancel / Preview buttons
- Progress bar + status section (shown during a download)
- Bulk file-list (per-file progress)
- Results section (file name, size, open / show-path buttons)
- Error box

**JS:** `app.js` (all form logic, API calls, polling).
**CSS:** `style.css`.
**Theme:** `theme.js` (loaded in `<head>`).

### `frontend/login.html`

Login / first-setup page. Two panels:

- **Setup panel** (visible by default): username + password + confirm.
  Shown on first run when no account exists.
- **Sign-in panel** (hidden by default): username + password.
  Shown when an account already exists.

**JS:** `login.js` (fetches `/api/auth-status` to pick the panel, handles
both form submits).
**CSS:** `style.css` (`.login-*` classes).
**Theme:** `theme.js`.

### `frontend/downloads.html`

File manager page. Shows a list of files in the downloads folder with
name, size, download link, and delete button.

**JS:** `downloads.js` (loads the list, handles delete).
**CSS:** `style.css`.
**Theme:** `theme.js`.

### `frontend/settings.html`

Settings page. Two sections:

- **Theme swatches** (black / charcoal / light) — click to apply + persist.
- **Default download options** — form fields saved to `localStorage` so the
  main page pre-fills them.

**JS:** `settings.js` (theme swatch clicks, save / reset defaults).
**CSS:** `style.css`.
**Theme:** `theme.js` (provides `snagSetTheme` / `snagGetTheme`).

### `frontend/docs.html`

In-app API documentation. Static HTML with code blocks and copy buttons.

**JS:** `docs.js` (click-to-copy on code blocks, shows the origin URL).
**CSS:** `style.css`.
**Theme:** `theme.js`.

### `frontend/app.js`

Main page logic. Key functions:

| Function | What it does | Backend endpoint |
|---|---|---|
| `handle401(r)` | Redirects to `/login` on 401. | — |
| `validateUrl()` | Validates the URL as the user types. | `POST /api/validate` |
| `startDownload()` | Collects form fields, starts a download. | `POST /api/download` |
| `poll()` | Fetches job status once per second. | `GET /api/status/<id>` |
| `cancelDownload()` | Cancels the running job. | `POST /api/cancel/<id>` |
| `preview()` | Shows available formats for the URL. | `POST /api/preview` |
| `renderFileList(job)` | Renders the bulk per-file progress list. | — (reads poll data) |
| `reset()` | Resets the UI to idle state. | — |
| `loadDefaults()` | Pre-fills the form from `localStorage`. | — |
| `toggleFormats()` | Shows/hides audio vs. video format controls. | — |
| `toggleTemplate()` | Shows/hides output template vs. playlist fields. | — |
| `toggleSubs()` | Shows/hides subtitle language + embed options. | — |
| `toggleThumbs()` | Hides media controls when "thumbnails only" is on. | — |
| `formatSize(bytes)` | Human-readable byte count. | — |

Also wires up keyboard shortcuts (Enter = download, Esc = cancel, `/` = focus URL)
and the result-panel buttons (open file → `GET /downloads/<name>`, show path).

### `frontend/login.js`

Login page logic. Key functions:

| Function | What it does | Backend endpoint |
|---|---|---|
| `init()` | Decides which panel to show. | `GET /api/auth-status` |
| setup-form submit | Creates the first account. | `POST /api/setup` |
| login-form submit | Signs in. | `POST /api/login` |

### `frontend/downloads.js`

Downloads page logic. Key functions:

| Function | What it does | Backend endpoint |
|---|---|---|
| `load()` | Fetches the file list and renders rows. | `GET /api/downloads` |
| `del(name)` | Deletes a file (with confirm). | `POST /api/delete/<name>` |
| `row(f)` | Builds one file row (name, size, download link, delete btn). | — |
| `formatSize(bytes)` | Human-readable byte count. | — |
| `handle401(r)` | Redirects to `/login` on 401. | — |

### `frontend/settings.js`

Settings page logic (IIFE, no globals):

| Function | What it does |
|---|---|
| `refresh()` | Marks the active theme swatch. |
| swatch click handler | Calls `snagSetTheme(name)` from `theme.js`. |
| `loadDefaults()` | Pre-fills the defaults form from `localStorage`. |
| `saveDefaults()` | Saves the form to `localStorage` (`snag-defaults` key). |
| `resetDefaults()` | Clears `localStorage` and re-fills the form. |

### `frontend/docs.js`

Docs page logic:

| Function | What it does |
|---|---|
| `copyText(text)` | Clipboard write with `execCommand` fallback. |
| `flash(btn)` | Briefly shows "copied" on the button. |
| copy-btn click handler | Copies the adjacent `<pre>` block. |

Also sets the `#base-url` text to `window.location.origin`.

### `frontend/theme.js`

Theme management (IIFE, loaded in `<head>` of every page):

| Function | What it does |
|---|---|
| `apply(name)` | Sets / removes `data-theme` on `<html>`. |
| `snagSetTheme(name)` | Persists to `localStorage` + applies. |
| `snagGetTheme()` | Returns the saved theme name. |

Themes are defined in `style.css` via `[data-theme="…"]` selectors.
"black" is the default (no attribute needed).

### `frontend/style.css`

All styles. Organised in sections:

1. **CSS custom properties** — colour tokens per theme (`:root`,
   `[data-theme="charcoal"]`, `[data-theme="light"]`).
2. **Base** — reset, body, scrollbar.
3. **Layout** — sidebar, main, responsive breakpoints.
4. **Components** — buttons, inputs, fields, progress bar, tags, file rows,
   error box, preview box, results section.
5. **Page-specific** — docs, settings swatches, downloads list.
6. **Login page** — `.login-body`, `.login-card`, `.login-panel`, `.login-error`.
7. **Accessibility** — `prefers-reduced-motion` override.

---

## Request flow (end-to-end)

```
Browser (index.html + app.js)
  │
  ├─ POST /api/validate ──────────► validate() ──► is_valid_url(), is_bulk()
  │
  ├─ POST /api/download ──────────► download()
  │     │                            validates all fields
  │     │                            registers job in jobs{}
  │     │                            spawns thread ──► run_job()
  │     │                                              │
  │     │                                              ├─ build_args() ──► yt-dlp process
  │     │                                              ├─ reads stdout line-by-line
  │     │                                              ├─ parse_progress()
  │     │                                              └─ updates job{} fields
  │     │
  │     └─ returns {job_id}
  │
  ├─ GET /api/status/<id> (1 s) ──► status() ──► returns job{}
  │     │
  │     └─ app.js:poll() updates progress bar, file list, handles terminal states
  │
  ├─ POST /api/cancel/<id> ───────► cancel() ──► sets job['cancelled']=True
  │
  ├─ POST /api/preview ───────────► preview() ──► yt-dlp -J (no download)
  │
  └─ GET /downloads/<name> ───────► download_file() ──► serves the file
```
