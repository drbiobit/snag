#!/bin/sh
# Fix ownership of mounted volumes before the app starts.
#
# Named volumes are initialized as root:root by Docker on first use (unlike
# bind mounts, which inherit image ownership). The app runs as the unprivileged
# `snag` user, so it cannot write to /data or /app until ownership is fixed.
# This script runs as root (the container's default user) and chowns the
# relevant directories to the snag user, then drops privileges and execs
# the real command.

set -e

# Only fix ownership if we're running as root. In local development
# (python snag.py) this script is never invoked, so it's a no-op there.
if [ "$(id -u)" = "0" ]; then
    # Find the uid/gid of the snag user (created in the Dockerfile).
    SNAG_UID=$(id -u snag 2>/dev/null || echo 999)
    SNAG_GID=$(id -g snag 2>/dev/null || echo 999)

    # Fix /data (downloads + auth data volume).
    if [ -d /data ]; then
        chown -R "${SNAG_UID}:${SNAG_GID}" /data
    fi

    # Fix /app (in case a bind mount or previous root run left files here).
    if [ -d /app ]; then
        chown -R "${SNAG_UID}:${SNAG_GID}" /app
    fi

    # Drop to the snag user for the rest of the container's life.
    exec gosu snag "$@"
fi

# Not root (e.g. local dev or already dropped) - just run the command.
exec "$@"
