---
title: Configuration
sidebar_position: 5
---

# Snag — Configuration Reference

Snag is configured entirely through **environment variables** — there's no
config file to edit. This page is the complete reference: every variable, the
authentication model, and the HTTP API the frontend talks to.

## Environment variables

Copy `.env.example` to `.env` and fill in the values you need. The `.env` file
is git-ignored.

| Variable | Default | Required | What it does |
|----------|---------|----------|--------------|
| `PORT` | `6909` (dev) / `8000` (Docker) | no | The port the app listens on. |
| `DOWNLOAD_DIR` | `./downloads` (host) / `/data` (Docker) | no | Where finished files are saved. Created on startup if missing. |
| `SNAG_CONFIG_DIR` | `./data` (host) / `/config` (Docker) | no | Where the SQLite database (`snag.db`) lives. Stores credentials, session secret, and download history. |
| `GUNICORN_WORKERS` | `1` | no | Gunicorn worker count. **Must stay 1** — job state is in process memory, so more workers break `/api/status` and `/api/cancel` polling. |
| `SNAG_USER` | *(unset)* | no | Username for login. Set **both** this and `SNAG_PASSWORD` to enable env-based auth. |
| `SNAG_PASSWORD` | *(unset)* | no | Password for login. See [Authentication](#authentication). |
| `SNAG_SECRET` | *(auto-generated)* | no | The session signing key. If unset, it's generated on first start and stored in the SQLite database. |

### Notes

- **`DOWNLOAD_DIR` vs `SNAG_CONFIG_DIR`** — in Docker these are separate
  volumes (`/data` and `/config`), so downloads and auth data never mix. On a
  bare host they're separate folders (`downloads/` and `data/`) next to the app.
- **`SNAG_SECRET`** — if you wipe your config volume without setting this, the
  key is regenerated and everyone gets logged out. Set it explicitly if you
  want sessions to survive a config wipe.
- **`GUNICORN_WORKERS`** — the one variable that's easy to get wrong. Keep it
  at `1`. Concurrency comes from Gunicorn's threads, not workers.

## Authentication

Snag has built-in login so you can expose it to the internet without bolting
on a separate auth system. There are two ways credentials get set, and the app
decides which one is active at runtime.

### How the app decides

- If **both** `SNAG_USER` and `SNAG_PASSWORD` are set → **env-based auth** is
  active. Those credentials are used for login, and the first-visit setup page
  is skipped.
- Otherwise, if a user already exists in the SQLite database → **stored
  auth** is active (someone already ran the first-visit setup).
- Otherwise (no env creds, no stored user) → the app runs **open** and the
  first browser visit is redirected to the **"create account"** setup page.

### First-visit setup

On a fresh install with no env credentials, the first person to open the app
sees a "create account" form. They enter a username and password (minimum 4
characters), and that becomes the single account. The credentials are hashed
with **PBKDF2-SHA256 (200,000 iterations, per-user salt)** and stored in the
SQLite database. Every subsequent visit requires sign-in.

### Env-based auth

Setting `SNAG_USER` and `SNAG_PASSWORD` is the "fixed credentials" path —
useful for Docker deploys where you want known credentials without the
first-visit flow. When both are set they **override** any stored account.

### Session security

- Passwords are never stored in plaintext (PBKDF2-SHA256 + per-user salt).
- Verification uses constant-time comparison, and a dummy hash runs for
  unknown usernames so timing can't reveal which users exist.
- Session cookies are `HttpOnly` (not readable by JavaScript) and
  `SameSite=Lax` (CSRF protection), with a 7-day lifetime.
- The signing key is auto-generated and persisted in the SQLite database.

### Resetting credentials

From the web UI: go to **History** → click **reset credentials**. This deletes
the stored account and logs you out.

Or from the command line:

```bash
# Delete the auth database (first-visit setup path)
rm data/snag.db          # or: docker exec snag rm /config/snag.db
```

Then reopen the browser — the "create account" page appears again.

## Download history

Every completed, failed, or cancelled download is recorded in the SQLite
database. The **History** page in the web UI shows the full log with status,
file names, sizes, and timestamps.

- **Clear history** — deletes all history rows (files on disk are untouched).
- **Reset credentials** — deletes the stored account and logs you out.

## The HTTP API

The frontend is a thin client over this API. All endpoints except
`/api/auth-status` and `/health` require a valid session (they return `401`
otherwise). The in-app page at `/docs` lists these with copy-paste `curl`
examples.

### Authentication

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/auth-status` | Returns whether auth is enabled, whether setup is needed, and whether the current session is authenticated. No auth required. |
| `POST` | `/api/setup` | First-run account creation. Only works while no users exist. Body: `{username, password}`. |
| `POST` | `/api/login` | Verify credentials and start a session. Body: `{username, password}`. |
| `POST` | `/api/logout` | End the current session. |
| `POST` | `/api/auth/clear` | Delete all stored credentials (resets to first-run state). |

### Downloads

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/validate` | Check whether a string is a valid YouTube URL. Body: `{url}`. Returns `{valid, bulk}`. |
| `POST` | `/api/download` | Start a download. Validates the URL and all options, enforces the concurrency limit, registers a job, and returns `{job_id}`. |
| `GET` | `/api/status/<job_id>` | Poll a job's progress. Returns `{job: {progress, message, status, files, …}}`. |
| `POST` | `/api/cancel/<job_id>` | Flag a running job so its worker thread stops `yt-dlp`. |

The `/api/download` body accepts every option the UI exposes: `url`, `type`
(`single`/`bulk`), `format`, `audio_only`, `audio_format`, `audio_quality`,
`output_format`, `output_template`, `resume`, `fragments`, `metadata`,
`playlist_index`, `subtitles`, `sub_langs`, `sub_embed`, `trim_start`,
`trim_end`, `playlist_items`, `cookies`, and `thumbnails`. See the
[Code Reference](/code-reference#build_args--the-function-that-matters-most)
for how each maps to a `yt-dlp` flag.

### File management

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/downloads` | List every file in the downloads folder with size and mtime. |
| `GET` | `/downloads/<name>` | Serve a finished file as a download. |
| `POST` | `/api/delete/<name>` | Delete a file (after a path-traversal check). |

### History

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/history` | Return the download history (most recent first). |
| `POST` | `/api/history/clear` | Delete all download history entries. |

### Preview & health

| Method | Path | Purpose |
|--------|------|---------|
| `POST` / `GET` | `/api/preview` | Run `yt-dlp -J` (no download) and return the title, item count, available resolutions, and audio codecs. Body: `{url}`. |
| `GET` | `/health` | Liveness probe (no auth). Returns status, uptime, and active job count. |

### Example: start a download and poll it

```bash
# Start a download (returns a job_id)
curl -s -X POST http://localhost:8000/api/download \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://www.youtube.com/watch?v=…","format":"best"}'
# {"success":true,"job_id":"3f2c…"}

# Poll for progress
curl -s http://localhost:8000/api/status/3f2c…
# {"success":true,"job":{"progress":42,"message":"Downloading... 42%","status":"pending"}}
```

> The real frontend does exactly this: `POST /api/download`, then
> `GET /api/status/<id>` once per second until the job reaches a terminal
> state.

## Where the data lives

| Thing | Location |
|-------|----------|
| Finished downloads | `DOWNLOAD_DIR` (default `./downloads` or `/data`) |
| SQLite database (credentials + history + secret) | `SNAG_CONFIG_DIR/snag.db` (default `./data/snag.db` or `/config/snag.db`) |
| Running jobs | **process memory only** (lost on restart by design) |
