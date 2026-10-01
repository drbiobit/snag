"""
Gunicorn configuration for Snag.

Run in production with:
    gunicorn -c gunicorn.conf.py Main:app

Or override any value from the command line, e.g.:
    gunicorn -c gunicorn.conf.py -b 0.0.0.0:9000 -w 6 Main:app
"""

# --- Binding -------------------------------------------------------------
# Listen on all interfaces, port 8000.
bind = "0.0.0.0:8000"

# --- Workers -------------------------------------------------------------
# One worker per CPU core is a good starting point for a mostly-I/O-bound
# app (each download runs in its own thread inside the worker).
import os
workers = int(os.environ.get("GUNICORN_WORKERS", 4))

# Each worker is a separate process; threads let it serve a few requests
# concurrently (useful while a download job is being polled).
threads = 2

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
