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

## Requirements

- Python 3.10+
- [yt-dlp](https://github.com/yt-dlp/yt-dlp) on your PATH (`pip install yt-dlp` or `brew install yt-dlp`)
- ffmpeg (for merging, MP3 conversion & metadata embedding)

## Install & Run

```bash
pip install -r requirements.txt
python Main.py
```

Open http://localhost:6909 (override with the `PORT` env var).

## Authentication

By default the app runs **open** (no login) — fine for a local machine or a
trusted LAN. To enable login:

**Option A — first-visit setup (no config needed):**
Open the app in a browser. On first visit you'll see a "create account" page.
Set a username and password; it's saved to `data/users.json` (on the `/data`
volume in Docker). From then on, every visit requires sign-in.

**Option B — environment variables (Docker / server):**
```bash
SNAG_USER=admin SNAG_PASSWORD=your-password python Main.py
```
or in `docker-compose.yml`:
```yaml
environment:
  SNAG_USER: admin
  SNAG_PASSWORD: your-password
```
Env vars take priority over the in-browser setup.

To reset credentials: delete `data/users.json` (and unset the env vars) and
reopen the app — the setup page appears again.

See `.env.example` for all available variables.

## Project Layout

```
Main.py                     # Flask app + yt-dlp job runner
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
