# ===========================================================================
# Snag - Docker image
#
# Base: Alpine 3.20 with python3, a virtualenv, and all pip packages
# installed into it. yt-dlp and ffmpeg (needed to merge video/audio and
# re-encode audio) are installed at the system level, then the app runs
# under Gunicorn from inside the venv.
#
# Alpine keeps the image small (~312 MB vs ~906 MB for the old Ubuntu base).
#
# Build from the project root:
#     docker build -t snag .
# ===========================================================================

FROM alpine:latest

# --- System packages -------------------------------------------------------
#   python3               : the interpreter (pip comes via ensurepip)
#   ffmpeg                : required by yt-dlp to merge/convert media
#   curl + ca-certificates: healthcheck + TLS certs for outbound HTTPS
#   libcrypto3            : OpenSSL 3 shared libs (Alpine splits them out)
#   shadow                : provides `id` for the entrypoint script
# Note: gosu is not packaged for Alpine; the entrypoint uses `setpriv`
# (util-linux, built in) for the privilege drop instead.
RUN apk add --no-cache \
        python3 \
        ffmpeg \
        curl \
        ca-certificates \
        libcrypto3 \
        shadow

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
COPY snag.py gunicorn.conf.py docker-entrypoint.sh ./
COPY frontend ./frontend
# The AI summarize pipeline: two plain scripts (yt-transcribe.py, summarize.py)
# that snag.py shells out to. Must live in the image or /api/ai/* fails.
COPY yt_summarize ./yt_summarize
RUN chmod +x docker-entrypoint.sh

# --- Runtime configuration -------------------------------------------------
# DOWNLOAD_DIR: where downloaded media files are stored.
# SNAG_CONFIG_DIR: where the SQLite auth database (snag.db) lives.
# Both are overridable at run time, e.g.
#     docker run -e DOWNLOAD_DIR=/data -e SNAG_CONFIG_DIR=/config \
#         -v snag-data:/data -v snag-config:/config snag
# GUNICORN_WORKERS must stay 1: job state lives in process memory (see
# gunicorn.conf.py), so multiple workers would break status polling.
ENV DOWNLOAD_DIR=/data \
    SNAG_CONFIG_DIR=/config \
    GUNICORN_WORKERS=1 \
    PORT=8000

# Create the default data/config directories and a non-root user to run as.
# The container starts as root so docker-entrypoint.sh can chown the mounted
# volumes (named volumes are initialized as root:root by Docker on first use,
# which would otherwise make them unwritable by the snag user). The entrypoint
# then drops privileges to snag via setpriv before exec'ing the app.
RUN mkdir -p /data /config \
    && addgroup -S snag && adduser -S -G snag -h /app -s /bin/sh snag \
    && chown -R snag:snag /data /config /app

# The port Gunicorn listens on (see gunicorn.conf.py).
EXPOSE 8000

# Healthcheck: hit the /health endpoint from inside the container.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -fsS http://localhost:8000/health || exit 1

# Entrypoint fixes volume ownership (root -> snag) then drops privileges.
# CMD is the default command the entrypoint execs after dropping to snag.
ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["gunicorn", "-c", "gunicorn.conf.py", "snag:app"]
