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
# (useful while a download job is being polled).
threads = 4

# --- Timeouts ------------------------------------------------------------
# Downloads run as background threads and the HTTP request returns quickly,
# so the default request timeout is fine. Bump it if you ever add long
# synchronous endpoints.
timeout = 120
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
