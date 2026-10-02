# Snag — Documentation

Welcome to the **Snag** docs. Snag is a minimal, self-hosted web interface for
[yt-dlp](https://github.com/yt-dlp/yt-dlp) — paste a link, pick your options,
and watch it download with live progress.

## Guides

| Document | What's inside |
|----------|---------------|
| [Deployment Guide](DEPLOYMENT.md) | Run Snag in production — Docker, systemd, PM2, or Mac/Windows. |
| [Code Reference](CODE.md) | Function-by-function walkthrough of `snag.py` and the frontend files. |
| [yt-dlp Flags Reference](yt-dlp_flags_refrence.md) | Every yt-dlp flag Snag exposes, and what each option does. |

## Quick links

- **Repository:** [github.com/drbiobit/snag](https://github.com/drbiobit/snag)
- **Docker image (ready to launch):** `ghcr.io/drbiobit/snag:latest`
- **Releases:** [github.com/drbiobit/snag/releases](https://github.com/drbiobit/snag/releases)

## Launch in 30 seconds

```bash
docker pull ghcr.io/drbiobit/snag:latest
docker run -d --name snag -p 8000:8000 -v snag-data:/data ghcr.io/drbiobit/snag:latest
# open http://localhost:8000
```
