# Contributing to Snag

Thanks for considering a contribution! Snag is deliberately small — one
Python file on the backend, plain HTML/CSS/JS on the frontend, no build
step. That makes it easy to read and easy to change, but it also means
there are a few conventions worth keeping so it stays that way.

## Ground rules

- **Keep the backend a single file.** `snag.py` is one file on purpose. Don't
  split it into a package or add modules unless there's a strong reason.
- **No frontend build step.** The frontend is vanilla HTML/CSS/JS served
  straight from `frontend/`. Don't introduce frameworks, bundlers, or
  transpilation.
- **Commit after each logical change.** One change = one commit, with a short
  message describing it. Don't batch unrelated changes.
- **Verify before you commit.** Run the app locally and confirm the affected
  page or endpoint still works.

## Development setup

Prerequisites:

- Python 3.10+
- [yt-dlp](https://github.com/yt-dlp/yt-dlp) on your `PATH`
  (`pip install yt-dlp` or `brew install yt-dlp`)
- [ffmpeg](https://ffmpeg.org/) on your `PATH`

Then:

```bash
pip install -r requirements.txt
python snag.py
```

Open http://localhost:6909. On first run you'll be asked to create an account
(see the [README](README.md#authentication) for details). Override the port
with the `PORT` env var if 6909 is taken.

There is no test suite or linter configured yet. Your verification is:
start the app, exercise the feature you touched in the browser, and make sure
nothing else broke.

## Making a change

1. Fork the repo and create a branch from `main`:
   `git checkout -b my-change`.
2. Make your change, keeping the ground rules above.
3. Run the app and verify it works.
4. Commit with a clear, short message.
5. Open a pull request against `main` and fill in the PR template.

## Good first issues

Look for issues labeled `good first issue` or `help wanted`. Typical
first-timer-friendly work:

- Adding or fixing a doc page under `docusaurus/docs/`.
- Improving copy, error messages, or the README.
- Small frontend polish in `frontend/` (no build step — just edit the file).
- Adding a new yt-dlp flag to the UI and the
  [flags reference](https://drbiobit.github.io/snag/yt-dlp-flags).

## Code of conduct

Interactions in this project are covered by our
[Code of Conduct](CODE_OF_CONDUCT.md). Be kind and assume good faith.

## Questions?

Open an issue or start a discussion on
[GitHub](https://github.com/drbiobit/snag). For security issues, see
[SECURITY.md](SECURITY.md) — don't open a public issue for those.
