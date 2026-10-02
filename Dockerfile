# ===========================================================================
# Snag - Docker image
#
# Base: Ubuntu 24.04 (noble) with the system Python 3, a virtualenv, and all
# pip packages installed into it. yt-dlp and ffmpeg (needed to merge
# video/audio and re-encode audio) are installed at the system level, then
# the app runs under Gunicorn from inside the venv.
#
# Build from the project root:
#     docker build -t snag .
# ===========================================================================

FROM ubuntu:24.04

# --- System packages -------------------------------------------------------
#   python3 + python3-venv : the interpreter and the venv module
#   ffmpeg                 : required by yt-dlp to merge/convert media
#   curl + ca-certificates : healthcheck + TLS certs for outbound HTTPS
# DEBIAN_FRONTEND keeps apt non-interactive inside the build.
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
        python3 \
        python3-venv \
        python3-pip \
        ffmpeg \
        curl \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# --- Python virtualenv + dependencies --------------------------------------
# Create a dedicated venv so the app's packages don't clash with the system
# Python. Copying requirements first keeps this layer cached across code
# changes.
WORKDIR /app
COPY requirements.txt .
RUN python3 -m venv /opt/venv \
    && /opt/venv/bin/pip install --no-cache-dir --upgrade pip \
    && /opt/venv/bin/pip install --no-cache-dir -r requirements.txt \
    # yt-dlp is a CLI the app shells out to - install it into the venv too.
    && /opt/venv/bin/pip install --no-cache-dir yt-dlp

# Put the venv's binaries (python, gunicorn, yt-dlp, pip) on PATH so the
# healthcheck, CMD and yt-dlp calls all resolve without full paths.
ENV PATH="/opt/venv/bin:$PATH"

# --- Application code ------------------------------------------------------
COPY snag.py gunicorn.conf.py ./
COPY frontend ./frontend

# --- Runtime configuration -------------------------------------------------
# Where downloads are stored. Overridable at run time, e.g.
#     docker run -e DOWNLOAD_DIR=/data -v snag-data:/data snag
# GUNICORN_WORKERS must stay 1: job state lives in process memory (see
# gunicorn.conf.py), so multiple workers would break status polling.
ENV DOWNLOAD_DIR=/data \
    GUNICORN_WORKERS=1 \
    PORT=8000

# Create the default download directory and a non-root user to run as.
RUN mkdir -p /data \
    && groupadd -r snag && useradd -r -g snag -d /app -s /sbin/nologin snag \
    && chown -R snag:snag /data /app
USER snag

# The port Gunicorn listens on (see gunicorn.conf.py).
EXPOSE 8000

# Healthcheck: hit the /health endpoint from inside the container.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -fsS http://localhost:8000/health || exit 1

# Run under Gunicorn using our config file (resolved from the venv on PATH).
CMD ["gunicorn", "-c", "gunicorn.conf.py", "snag:app"]
