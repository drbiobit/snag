---
sidebar_position: 7
title: Changelog
---

# Changelog

Every release of Snag, newest first. Version numbers follow
[semantic versioning](https://semver.org/).

## v1.3.0 — Security hardening, template/mp3 fixes, robustness (2026-11-23)

A security and correctness pass over the whole app: every response now ships
strict security headers, user-controlled data is rendered via DOM APIs or
sanitized HTML (no raw `innerHTML` anywhere), the frontend is fully
self-contained (no third-party CDNs), and several silently-ignored options
now actually work.

- **Added** — strict Content-Security-Policy and security headers on every
  response (`X-Content-Type-Options`, `X-Frame-Options: DENY`,
  `Referrer-Policy`, `Permissions-Policy`).
- **Added** — `GET /api/preview?url=…` (the `?url=` query parameter, in
  addition to the JSON body).
- **Added** — background thread prunes finished jobs every minute (previously
  only pruned when status polls happened).
- **Added** — frontend renders AI-generated articles through vendored
  DOMPurify with a strict allowlist (no images, forms, iframes, or scripts);
  `marked` and `DOMPurify` are vendored locally, so the app no longer loads
  third-party scripts.
- **Fixed** — XSS everywhere user-controlled data reached the page: history
  rows (craftable URLs), download rows, bulk file lists, preview tags,
  status messages, and the Summarize article. All render via DOM APIs or
  sanitized HTML now.
- **Fixed** — the URL validator accepted crafted URLs (e.g. `"><img onerror>`)
  that could be stored in history and injected into pages. The regex is now
  anchored and excludes markup-carrying characters.
- **Fixed** — relative `output_template` values (e.g. `%(title)s.%(ext)s`) were
  silently ignored; they now resolve against the downloads folder.
- **Fixed** — `type: "mp3"` was a dead option (it downloaded video with an
  mp4 merge). It now forces audio-only output, and the UI locks the audio
  checkbox on in that mode.
- **Fixed** — history `created_at` was identical to `finished_at` (both were
  the time the job was logged); `created_at` now records the job's actual
  start time.
- **Fixed** — unhandled 500s from the AI endpoints: `timeout` values like
  `"banana"` now coerce and clamp (10–1800s) instead of crashing; non-http(s)
  endpoints (SSRF) are rejected; collection transcript fetches are capped at
  50 videos.
- **Fixed** — clip timestamp validation now rejects impossible values
  (`1:00:60`, `1:2:3:4`) — plain seconds and `MM:SS`/`H:MM:SS` with seconds < 60.
- **Fixed** — `is_inside_downloads` no longer raises on cross-drive/exception
  paths; it returns False.
- **Changed** — gunicorn `timeout` raised from 120s to 1800s so synchronous
  AI endpoints don't get killed mid-pipeline; threads documented (8).
- **Docs** — README, SECURITY.md, and the docs site updated to match the new
  behavior (security headers, relative templates, mp3, preview GET, cap).

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
