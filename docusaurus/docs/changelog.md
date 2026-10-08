---
sidebar_position: 7
title: Changelog
---

# Changelog

Every release of Snag, newest first. Version numbers follow
[semantic versioning](https://semver.org/). The in-app version of this page is
at **Changelog** in the top navigation.

## v1.1.0 — AI Summarize

A new **Summarize** tab turns any YouTube video, playlist, or channel into a
clean Markdown article written by the AI endpoint you configure.

- **Added** — Summarize page: a 3-step pipeline (fetch transcript → review → AI
  article) with copy and download.
- **Added** — transcript support for single videos, playlists, and whole
  channels; collections are combined into one document.
- **Added** — AI settings (endpoint, model, API key, temperature, system
  prompt, timestamps) stored in the app database and editable in Settings.
- **Added** — one-time, skippable AI setup prompt on first launch.
- **Added** — `youtube-transcript-api` to requirements; new `/api/ai/*`
  endpoints (settings, models, transcript, summarize).
- **Changed** — collection transcripts now fetch **in parallel (4 workers)**,
  and videos with no captions (or that time out / fail) are skipped so one bad
  video never blocks the rest.
- **Fixed** — the Docker image now includes the `yt_summarize/` pipeline
  scripts (previously missing, which broke Summarize in Docker).

## v1.0.2 — SQLite auth, history, Alpine (2026-10-03)

Switched storage to SQLite, added a download history page, and moved the Docker
image to Alpine.

- **Added** — download history page with clear / reset controls.
- **Changed** — auth and settings migrated from `users.json` / `secret` to a
  single `snag.db` SQLite database.
- **Changed** — Docker base image switched from Ubuntu 24.04 to Alpine 3.20
  (smaller image).
- **Fixed** — Docker now fixes mounted-volume ownership on startup (no more
  permission denied).
- **Fixed** — progress parsing to match yt-dlp's actual `[download]` /
  `[ExtractAudio]` / `[Merger]` output; intermediate format files are deduped.
- **Fixed** — UI stall when opening a downloaded file.

## v1.0.1 — Docker auth persistence (2026-10-03)

Fixed a bug where Docker lost your account on every container restart.

- **Fixed** — auth data now persists on the `/data` volume across container
  rebuilds and restarts.
- **Docs** — README documents the upgrade procedure for affected users.
