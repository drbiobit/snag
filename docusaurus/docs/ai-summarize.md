---
title: AI Summarize
sidebar_position: 6
---

# Snag — AI Summarize

Turn a YouTube video into a clean, structured Markdown article. The **Summarize**
page (the sparkles icon in the top bar) runs a three-step pipeline:

1. **Transcript** — fetch the video's subtitles/captions with
   `youtube-transcript-api`.
2. **Review** — read the raw transcript in the app.
3. **Summarize** — send it to an OpenAI-compatible endpoint, which returns a
   full article following a built-in system prompt.

Everything runs server-side as plain subprocesses. There is **no hardcoded
endpoint, port, or API key** anywhere in the code — all of it comes from the
settings you save.

> **Only local AI is encouraged.** You can still point the endpoint at an
> OpenAI-compatible cloud URL if you want, but the feature is designed around a
> local, self-hosted model server.

## How it works

Two plain Python scripts live in the `yt_summarize/` folder and are invoked by
the backend with `subprocess` — they are not imported into `snag.py`:

| Script | Job |
|--------|-----|
| `yt_summarize/yt-transcribe.py` | `YouTube URL → transcript.md` (via `youtube-transcript-api`) |
| `yt_summarize/summarize.py` | `transcript + system prompt → AI article` (via a `POST` to `/chat/completions`) |

`summarize.py` always receives `--endpoint` (required) and an optional
`--api-key`. When a key is set it is sent as an `Authorization: Bearer <key>`
header; when it's blank the request goes out with no auth — which is what a
local server expects.

The default system prompt is `yt_summarize/system-prompt.md`. It instructs the
model to produce a Markdown article with a title, summary, key points, a
sectioned breakdown, and a takeaway.

## Configuration

Settings are saved from **Settings → AI / summarize** (or from the first-run
card on the Summarize page) and stored in the SQLite database. See the
[Configuration reference](/configuration#ai--summarize-settings) for the full
table.

| Setting | Notes |
|---------|-------|
| **Endpoint** | Any OpenAI-compatible base URL, e.g. `http://localhost:8080/v1`. Required — there is no default. |
| **Model** | The model id. Leave blank to pick from the loaded model list on the Summarize page. |
| **API key** | Optional. Blank = no auth (local). Set it for a cloud endpoint that needs a `Bearer` token. |
| **Temperature** | Sampling temperature (default `0.4`). |
| **Timeout** | Seconds to wait for the summarize call (default `300`). |
| **Transcript languages** | Priority-ordered language codes (default `en`). |

### Pointing at a local model server

Any server that speaks the OpenAI chat-completions API works, for example:

- **Ollama** — `http://localhost:11434/v1`
- **llama.cpp** (`llama-server`) — `http://localhost:8080/v1`
- **vLLM** — `http://localhost:8000/v1`

Set the endpoint and model, then click **load models** to confirm the server
is reachable and to see what's available.

## Using the page

1. Open the **Summarize** page (sparkles icon).
2. Paste a YouTube URL or video id and click **get transcript**.
3. Review the transcript, pick a model, and click **summarize**.
4. The article renders in the app. Use **copy markdown** or **download .md**
   to take it with you.

Transcripts and summaries are **in-app only** — they are not written to the
downloads folder and do not appear on the Downloads page.

## API

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/ai/settings` | Read the saved AI settings. |
| `POST` | `/api/ai/settings` | Save AI settings. |
| `GET` | `/api/ai/models` | List models from the configured endpoint. |
| `POST` | `/api/ai/transcript` | Fetch a video's transcript. Body: `{url, languages?}`. |
| `POST` | `/api/ai/summarize` | Summarize a transcript. Body: `{transcript, model?, temperature?}`. |

## Troubleshooting

- **"No endpoint configured"** — set the endpoint in Settings first.
- **"No model selected"** — pick a model on the page or set `ai_model`.
- **Model list is empty** — the endpoint is unreachable or not an
  OpenAI-compatible `/models` endpoint. Check the URL and that the server is up.
- **Timeout** — large transcripts on a slow local model can take a while; raise
  the timeout in Settings.
- **Transcript not found** — the video has no captions in the requested
  languages. Try adding more language codes to the transcript languages.
