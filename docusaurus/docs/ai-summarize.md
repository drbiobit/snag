---
title: AI Summarize
sidebar_position: 6
---

# Snag — AI Summarize

Turn a YouTube video — or a whole playlist / channel — into a clean, structured
Markdown article. The **Summarize** page (the document-with-sparkle icon in the
top bar) runs a three-step pipeline:

1. **Transcript** — fetch the subtitles/captions with `youtube-transcript-api`
   (a single video, or every video in a playlist / channel, combined into one
   document).
2. **Review** — read the raw transcript in the app, or download it as `.md`.
3. **Summarize** — send it to an OpenAI-compatible endpoint, which returns a
   full article following a system prompt you can edit.

Everything runs server-side as plain subprocesses. There is **no hardcoded
endpoint, port, or API key** anywhere in the code — all of it comes from the
settings you save.

> **Only local AI is encouraged.** You can still point the endpoint at an
> OpenAI-compatible cloud URL if you want, but the feature is designed around a
> local, self-hosted model server.

## First run

After you create your account, the **home page** shows a one-time, **optional**
popup asking for your AI endpoint, model, and (optionally) an API key. It is
**skippable** — click **set up later** and the app is fully usable without AI.
The decision is remembered, so it never appears again; you can configure AI any
time from **Settings → AI / summarize**.

## How it works

Two plain Python scripts live in the `yt_summarize/` folder and are invoked by
the backend with `subprocess` — they are not imported into `snag.py`:

| Script | Job |
|--------|-----|
| `yt_summarize/yt-transcribe.py` | `YouTube URL → transcript.md` (via `youtube-transcript-api`) |
| `yt_summarize/summarize.py` | `transcript + system prompt → AI article` (via a `POST` to `/chat/completions`) |

`summarize.py` always receives `--endpoint` (required), `--system-prompt`
(the prompt text, passed in from the database), and an optional `--api-key`.
When a key is set it is sent as an `Authorization: Bearer <key>` header; when
it's blank the request goes out with no auth — which is what a local server
expects.

### System prompt

The system prompt is **stored in the database**, not in a file. On first start
the app seeds it with a sensible default (title, summary, key points, a
sectioned breakdown, and a takeaway). You can edit it any time from
**Settings → AI / summarize → system prompt** to steer the article's structure
and tone.

### Playlists and channels

The transcript step accepts a **type** — *auto-detect*, *video*, *playlist*, or
*channel / user*. For a collection the app enumerates the videos with
`yt-dlp -J --flat-playlist`, fetches each transcript, and combines them into a
single Markdown document (one `##` section per video, with a header showing the
source, how many videos were included, and how many were skipped for lacking
captions).

- **How many videos** is up to you: leave the **videos** field blank to fetch
  **all**, or enter a number to fetch only the first *N*. There is no
  per-video picker yet.
- Fetches run **sequentially**, so large channels can take a while. Videos with
  no captions in the requested languages are skipped and counted.

## Configuration

Settings are saved from **Settings → AI / summarize** (or from the one-time
popup on the home page) and stored in the SQLite database.

| Setting | Notes |
|---------|-------|
| **Endpoint** | Any OpenAI-compatible base URL, e.g. `http://localhost:8080/v1`. Required — there is no default. |
| **Model** | The model id. Leave blank to pick from the loaded model list on the Summarize page. |
| **API key** | Optional. Blank = no auth (local). Set it for a cloud endpoint that needs a `Bearer` token. |
| **Temperature** | Sampling temperature (default `0.4`). |
| **Timeout** | Seconds to wait for the summarize call (default `300`). |
| **Transcript languages** | Priority-ordered language codes (default `en`). |
| **Include timestamps** | Default for the transcript's timestamped section (on by default). |
| **System prompt** | The instructions given to the model. Seeded with a default on first run; fully editable. |

### Pointing at a local model server

Any server that speaks the OpenAI chat-completions API works, for example:

- **Ollama** — `http://localhost:11434/v1`
- **llama.cpp** (`llama-server`) — `http://localhost:8080/v1`
- **vLLM** — `http://localhost:8000/v1`

Set the endpoint and model, then click **load models** to confirm the server
is reachable and to see what's available.

## Using the page

1. Open the **Summarize** page (document-with-sparkle icon).
2. Paste a YouTube URL (video, playlist, or channel) and set the options:
   type, how many videos, languages, and whether to include timestamps.
3. Click **get transcript**. Review it, or click **download transcript .md**.
4. Pick a model and click **summarize**.
5. The article renders in the app. Use **copy markdown** or **download .md**
   to take it with you.

**Your work survives a refresh.** The URL, transcript, article, and options are
kept in your browser's `localStorage`, so reloading the page (or navigating
away and back) does not lose anything. Click **clear** to start over.

Transcripts and summaries are **in-app only** — they are not written to the
downloads folder and do not appear on the Downloads page.

## API

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/ai/settings` | Read the saved AI settings (plus `has_endpoint` and `setup_done`). |
| `POST` | `/api/ai/settings` | Save AI settings. Body: the setting keys. |
| `POST` | `/api/ai/setup-done` | Mark the one-time AI setup prompt as handled. |
| `GET` | `/api/ai/models` | List models from the configured endpoint. |
| `POST` | `/api/ai/transcript` | Fetch a transcript. Body: `{url, type?, count?, languages?, timestamps?}`. |
| `POST` | `/api/ai/summarize` | Summarize a transcript. Body: `{transcript, model?, temperature?, system_prompt?}`. |

## Troubleshooting

- **"No endpoint configured"** — set the endpoint in Settings first.
- **"No model selected"** — pick a model on the page or set `ai_model`.
- **Model list is empty** — the endpoint is unreachable or not an
  OpenAI-compatible `/models` endpoint. Check the URL and that the server is up.
- **Timeout** — large transcripts (especially whole channels) on a slow local
  model can take a while; raise the timeout in Settings.
- **Transcript not found** — the video has no captions in the requested
  languages. Try adding more language codes to the transcript languages.
- **Collection returns "No videos found"** — the URL didn't resolve to a
  playlist/channel, or it's empty. Check the link.
- **Many videos skipped** — those videos have no captions in the requested
  languages. Add more language codes or accept the partial result.
