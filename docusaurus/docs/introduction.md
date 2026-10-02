---
title: Introduction
sidebar_position: 0
slug: /
---

# Snag — Documentation

Welcome to the **Snag** docs. Snag is a minimal, self-hosted web interface for
[yt-dlp](https://github.com/yt-dlp/yt-dlp) — paste a link, pick your options,
and watch it download with live progress.

The whole backend is a single Python file and the frontend is plain
HTML/CSS/JS with no build step, so the project is easy to read, easy to hack
on, and easy to deploy.

## New here?

Start with the [Deployment guide](/deployment) to get it running somewhere you
can reach it, then use the [Code Reference](/code-reference) to understand how
it works under the hood.

## Guides

| Document | What's inside |
|----------|---------------|
| [Deployment](/deployment) | Run Snag in production — Docker, systemd, PM2, or Mac/Windows, plus HTTPS and troubleshooting. |
| [Docker Deep-Dive](/docker) | What's in the image, custom environment variables, volumes, Compose, and updates. |
| [Configuration](/configuration) | Every environment variable, the authentication model, and the full HTTP API. |
| [Code Reference](/code-reference) | A file-by-file, human-written walkthrough of `snag.py` and the frontend. |
| [yt-dlp Flags Reference](/yt-dlp-flags) | Every yt-dlp flag Snag exposes, and what each option does. |

## Quick links

- **Repository:** [github.com/drbiobit/snag](https://github.com/drbiobit/snag)
- **Docker image (ready to launch):** `ghcr.io/drbiobit/snag:latest`
- **Releases:** [github.com/drbiobit/snag/releases](https://github.com/drbiobit/snag/releases)

## Launch in 30 seconds

```bash
docker pull ghcr.io/drbiobit/snag:latest
docker run -d --name snag -p 8000:8000 -v ./downloads:/data ghcr.io/drbiobit/snag:latest
# open http://localhost:8000
```
