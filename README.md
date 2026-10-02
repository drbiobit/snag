# Snag

**Grab videos, playlists, channels and audio — from your browser.**

Snag is a minimal, self-hosted web interface for [yt-dlp](https://github.com/yt-dlp/yt-dlp).
Paste a link, pick your options, and watch it download with live progress.

## Features

- 🎬 **Single videos** — best / 1080p / 720p / 480p
- 📦 **Bulk downloads** — entire playlists, channels or user profiles in one go
- 🎵 **Audio extraction** — MP3, M4A, WAV, OGG, FLAC with selectable bitrate
- 🗂 **Output formats** — mp4 / webm / mkv / mov for video, 5 audio codecs
- 📝 **Metadata embedding** — opt-in tags, thumbnails & chapters per download
- ⏯ **Resume** — interruptible downloads that skip files already on disk
- 🧵 **Multithreaded fragments** — parallel DASH/HLS fragment downloads
- ✏️ **Output templating** — custom `%(title)s`-style naming for single downloads
- ⚡ Real-time progress, up to 2 concurrent downloads, cancel anytime

## Documentation

Full docs are published on GitHub Pages → **[drbiobit.github.io/snag](https://drbiobit.github.io/snag/)**

- [Deployment Guide](https://drbiobit.github.io/snag/DEPLOYMENT.md) — Docker, systemd, PM2, Mac/Windows
- [Code Reference](https://drbiobit.github.io/snag/CODE.md) — function-by-function walkthrough of `snag.py` + frontend
- [yt-dlp Flags Reference](https://drbiobit.github.io/snag/yt-dlp_flags_refrence.md) — every flag Snag exposes

## Requirements

- Python 3.10+
- [yt-dlp](https://github.com/yt-dlp/yt-dlp) on your PATH (`pip install yt-dlp` or `brew install yt-dlp`)
- ffmpeg (for merging, MP3 conversion & metadata embedding)

## Install & Run

```bash
pip install -r requirements.txt
python snag.py
```

Open http://localhost:6909 (override with the `PORT` env var).

## Docker (prebuilt image)

A ready-to-launch image is built on every push and published to GitHub
Container Registry — no need to clone or build anything:

```bash
# Pull the prebuilt image
docker pull ghcr.io/drbiobit/snag:latest

# Run it (downloads persist in a named volume, app on port 8000)
docker run -d --name snag \
  -p 8000:8000 \
  -v snag-data:/data \
  ghcr.io/drbiobit/snag:latest

# Then open http://localhost:8000
```

Pin a specific version instead of `latest` by using a tag, e.g.
`ghcr.io/drbiobit/snag:v1.0.0` (tags are cut from `v*` git tags).

> The image is public — `docker pull` works without logging in. If you ever
> get an "unauthorized" error, run `docker login ghcr.io` once.

## Authentication

The app supports two ways to set a password. Pick whichever fits your setup.

### Option A — create an account in the browser (no config)

Best for local use or when you don't want to touch any files.

1. Start the app (`python snag.py` or `docker compose up -d`).
2. Open http://localhost:6909 (or http://localhost:8000 for Docker).
3. You'll be redirected to a **"create account"** page.
4. Enter a username and password, confirm the password, click **create**.
5. You're logged in. From now on every visit requires sign-in.

The credentials are stored in `data/users.json` (on the `/data` volume in
Docker) and survive restarts and container rebuilds.

### Option B — set credentials via environment variables

Best for Docker / server deployments where you want fixed credentials set
once at deploy time.

**Local:**
```bash
SNAG_USER=admin SNAG_PASSWORD=your-strong-password python snag.py
```

**Docker Compose** — edit `docker/docker-compose.yml`:
```yaml
environment:
  SNAG_USER: admin
  SNAG_PASSWORD: your-strong-password
```

**Plain Docker:**
```bash
docker run -d --name snag -p 8000:8000 \
  -e SNAG_USER=admin -e SNAG_PASSWORD=your-strong-password \
  -v snag-data:/data snag
```

When both `SNAG_USER` and `SNAG_PASSWORD` are set, they **override** any
in-browser account — the setup page is skipped entirely.

### Resetting credentials

- **Option A:** delete `data/users.json` (or the `snag-data` volume) and
  reopen the app — the "create account" page appears again.
- **Option B:** unset the env vars, delete `data/users.json`, and restart.

### Security notes

- Passwords are hashed with **PBKDF2-SHA256** (200 000 iterations, random
  per-user salt). The plaintext is never stored.
- Sessions use signed Flask cookies (`HttpOnly`, `SameSite=Lax`, 7-day
  lifetime). The signing key is auto-generated on first start and persisted
  to `data/secret` so sessions survive restarts.
- `/health` is always open (no auth) so container healthchecks work.
- See `.env.example` for all available variables.

## Project Layout

```
snag.py                     # Flask app + yt-dlp job runner
frontend/index.html         # UI
frontend/login.html         # Login / first-setup page
frontend/app.js             # Frontend logic
frontend/style.css          # Styles (pure-black terminal theme)
.env.example                # Environment variable reference
data/                       # Users, session key (auto-created, git-ignored)
downloads/                  # Output files
```

## API

| Endpoint | Method | Description |
|---|---|---|
| `/api/setup` | POST | first-run: create the initial account |
| `/api/login` | POST | `{username, password}` → start session |
| `/api/logout` | POST | end the current session |
| `/api/validate` | POST | `{url}` → validate YouTube URL + detect bulk |
| `/api/download` | POST | start a download → `{job_id}` |
| `/api/status/<job_id>` | GET | job progress/status |
| `/api/cancel/<job_id>` | POST | cancel a running job |
| `/api/downloads` | GET | list downloaded files |

### Download request body

```json
{
  "url": "https://www.youtube.com/watch?v=...",
  "type": "video | bulk | mp3",
  "format": "best | 1080 | 720 | 480 | audio | video",
  "audio_only": false,
  "audio_format": "mp3",
  "audio_quality": 2,
  "output_format": "mp4",
  "output_template": "%(title)s.%(ext)s",
  "resume": true,
  "fragments": 4,
  "metadata": false
}
```

## Notes

- **Metadata** (tags, thumbnail, chapters) is only embedded when the "embed metadata" option is enabled.
- **Output templates** only apply to single downloads — bulk downloads always
  use the default per-file naming so each item in a collection is saved separately.
- **Multithreaded fragments** speed up DASH/HLS downloads; leave "off" for
  progressive (non-fragment) streams.

## License

MIT — see [LICENSE](LICENSE).
