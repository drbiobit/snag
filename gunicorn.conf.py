"""
Gunicorn configuration for Snag.

Run in production with:
    gunicorn -c gunicorn.conf.py snag:app

Or override any value from the command line, e.g.:
    gunicorn -c gunicorn.conf.py -b 0.0.0.0:9000 -w 6 snag:app
"""

# --- Binding -------------------------------------------------------------
# Listen on all interfaces, port 8000.
bind = "0.0.0.0:8000"

# --- Workers -------------------------------------------------------------
# IMPORTANT: this app MUST run with a single worker process.
# Job state (the `jobs` dict in snag.py) lives in process memory. With
# multiple workers, a status/cancel poll can land on a different worker
# than the one that registered the job and get a 404.
# Concurrency comes from threads, not workers.
import os
workers = int(os.environ.get("GUNICORN_WORKERS", 1))

# Threads let the single worker serve several requests at once
# (useful while a download job is being polled AND a large file is being
# streamed to the browser). 8 threads handles: 1-2 active file downloads +
# 1-2 status polls + 1-2 API calls + headroom. AI pipeline requests
# (/api/ai/*) are synchronous and can occupy a thread for minutes - the
# 2 concurrent downloads + previews still run in background threads, so
# keep this at 8+ rather than lowering it.
threads = 8

# --- Timeouts ------------------------------------------------------------
# Downloads run as background threads and return quickly, but the AI
# summarize pipeline (/api/ai/transcript, /api/ai/summarize) is intentionally
# synchronous: transcript enumeration can take ~2 min, transcript fetching
# up to 90s per video, and summarizing can take the configured timeout (up
# to 30 min) plus 120s of grace. The hard cap is AI_SUBPROCESS_TIMEOUT
# (1800s) in snag.py, so give requests the same budget.
timeout = 1800
graceful_timeout = 30
keepalive = 5

# --- Logging -------------------------------------------------------------
# Log to stdout/stderr so a process manager (systemd, Docker, etc.) can
# capture them. Set accesslog/errorlog to file paths to write to disk.
accesslog = "-"
errorlog = "-"
loglevel = "info"

# --- Process name --------------------------------------------------------
# Shows up in `ps` / `top` as "snag" instead of the default gunicorn label.
proc_name = "snag"
