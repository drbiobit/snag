---
sidebar_position: 7
title: Changelog
---

# Changelog

Every release of Snag, newest first. Version numbers follow
[semantic versioning](https://semver.org/).

## v1.2.0 — UI Overhaul, System Prompt Controls & Fixes (2026-10-25)

The app gets a complete visual redesign, the system prompt is fully
editable from the UI, the concurrency cap only counts active jobs, and
the AI pipeline got more resilient.

- **Changed** — full UI redesign: a "precision instrument" design system
  with a shared sidebar navigation shell on every page, card-based
  layouts, consistent page headers, a new logo mark, and the original
  favicon restored.
- **Changed** — pure black is the default theme (no warm tint); the accent
  color switched from orange to mint green (`#3ddc84`); the charcoal
  theme was removed — two themes remain (black, light).
- **Changed** — typography: Space Grotesk (display), IBM Plex Sans (UI),
  IBM Plex Mono (data), loaded from Google Fonts with system fallbacks.
- **Added** — responsive layout (the sidebar collapses into a top bar on
  narrow screens), visible keyboard focus, ARIA labels, and
  `prefers-reduced-motion` support.
- **Added** — system prompt editor on the Summarize page (step 3): edit it
  where you summarize; it auto-saves to the database as you type and is
  sent with every summarize request.
- **Added** — first-run AI setup now asks for the system prompt alongside
  the endpoint, pre-filled with the default.
- **Changed** — AI requests that 404 are retried once with a `/v1` prefix
  (many local servers — Ollama, LM Studio, vLLM — serve the API under
  `/v1`); a persistent 404 now explains the likely causes (model not
  loaded, missing `/v1`).
- **Changed** — removed the home page "quick setup" card and the in-app
  changelog page (the changelog lives on this docs site).
- **Fixed** — the concurrency limit counted finished jobs, so completed
  downloads could block new ones with a 429. Only active jobs count now.
- **Fixed** — the "include timestamps" option on the Summarize page was
  ignored (always on); it now works.
- **Docs** — README: corrected stale auth references (`snag.db`, `/config`
  volume) and completed the API endpoint table.

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
