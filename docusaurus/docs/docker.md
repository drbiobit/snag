---
title: Docker Deep-Dive
sidebar_position: 4
---

# Snag — Docker Deep-Dive

Everything about running Snag in Docker: what's inside the image, how to build
and run it, how to configure it with environment variables, how to persist
your data, and how to use Docker Compose. If you just want the quick start,
jump to [Run it](#run-it); the rest is for when you want to understand or
customise the setup.

## What's inside the image

The `Dockerfile` builds an image from **Ubuntu 24.04** (noble). Here's what
each layer does, in order:

1. **System packages** — `python3`, `python3-venv`, `python3-pip`, `ffmpeg`,
   `curl`, and `ca-certificates`. `ffmpeg` is the one that matters: `yt-dlp`
   needs it to merge video+audio, convert audio, and embed metadata.
   `DEBIAN_FRONTEND=noninteractive` keeps `apt` from prompting during the
   build.
2. **A Python virtualenv** at `/opt/venv` — Flask and gunicorn are installed
   here (from `requirements.txt`), and **yt-dlp** is installed into the venv
   too (it's a CLI the app shells out to). The venv's `bin/` is put on
   `PATH`, so `python`, `gunicorn`, and `yt-dlp` all resolve without full
   paths.
3. **The application code** — `snag.py`, `gunicorn.conf.py`, and the whole
   `frontend/` folder are copied into `/app`.
4. **Runtime defaults** — `DOWNLOAD_DIR=/data`, `GUNICORN_WORKERS=1`,
   `PORT=8000`.
5. **A non-root user** — a `snag` user is created and the process runs as it
   (never root). `/data` and `/app` are owned by this user.
6. **A healthcheck** — `curl http://localhost:8000/health` every 30s.
7. **The command** — `gunicorn -c gunicorn.conf.py snag:app`.

The practical upshot: **you don't need Python, yt-dlp, or ffmpeg on the host
at all.** Everything the app needs is in the image.

## The environment variables

This is the "custom env" part. Every knob Snag exposes is an environment
variable, and in Docker you set them with `-e` (plain Docker) or the
`environment:` block (Compose).

| Variable | Default in image | What it does |
|----------|------------------|--------------|
| `DOWNLOAD_DIR` | `/data` | Where finished files are saved. Point this at a mounted volume. |
| `GUNICORN_WORKERS` | `1` | Gunicorn worker count. **Must stay 1** — job state is in process memory, so more workers break status/cancel polling. |
| `PORT` | `8000` | The port Gunicorn listens on *inside* the container. |
| `SNAG_USER` | *(unset)* | Username for login. Set both this and `SNAG_PASSWORD` to enable env-based auth. |
| `SNAG_PASSWORD` | *(unset)* | Password for login. See below. |
| `SNAG_SECRET` | *(auto-generated)* | The session signing key. If unset, it's generated on first start and written to `/data/secret`. |
| `DATA_DIR` | `/data` | Where auth data (`users.json`, `secret`) lives. |

### The single-worker rule

`GUNICORN_WORKERS` is the one variable that's easy to get wrong. Snag keeps
its running jobs in a dictionary in process memory. With two or more workers,
a `/api/status/<id>` request can be handled by a *different* worker than the
one that registered the job — and that worker has no idea the job exists, so
you get a 404 and the progress bar freezes. **Leave it at 1.** Concurrency
comes from Gunicorn's threads, not from workers.

## Authentication in Docker

There are two ways to set up login, and they map nicely to Docker:

### Option A — first-visit setup (no config)

Start the container with no auth variables. The first time you open it in a
browser you'll be redirected to a **"create account"** page. Enter a username
and password, and you're in. The credentials are stored in
`/data/users.json`, so they persist across restarts and image updates as long
as the data volume is kept.

This is the zero-config path and what most people want.

### Option B — fixed credentials via env vars

If you'd rather bake the credentials in at deploy time (common for a public
VPS), set both `SNAG_USER` and `SNAG_PASSWORD`. When both are present they
**override** any in-browser account — the setup page is skipped and login
uses those credentials.

```bash
docker run -d --name snag -p 8000:8000 \
  -e SNAG_USER=admin -e SNAG_PASSWORD=your-strong-password \
  -v snag-data:/data snag
```

Under the hood, passwords are hashed with PBKDF2-SHA256 (200k iterations,
per-user salt), and session cookies are `HttpOnly` + `SameSite=Lax` with a
7-day lifetime. The `/health` endpoint is always open (no auth) so the
container healthcheck works.

### Resetting credentials

```bash
# Wipe the stored account (Option A)
docker volume rm <compose>_snag-data     # or docker_snag-data

# Or delete just the users file from a running container
docker exec snag rm /data/users.json
```

Then reopen the browser — the "create account" page appears again.

## Run it

### Plain Docker (pre-built image)

```bash
docker pull ghcr.io/drbiobit/snag:latest
docker run -d --name snag -p 8000:8000 -v snag-data:/data ghcr.io/drbiobit/snag:latest
```

- `-p 8000:8000` maps the container's port 8000 to the host's 8000. Change
  the left side to remap (e.g. `-p 9000:8000` to use host port 9000).
- `-v snag-data:/data` creates a named volume for your downloads.

Open **http://localhost:8000**.

### Plain Docker (build from source)

```bash
docker build -t snag .          # from the project root
docker run -d --name snag -p 8000:8000 -v snag-data:/data snag
```

### Docker Compose

The `docker/docker-compose.yml` file is the recommended way to run it — it
declares the port, the volume, the environment, a restart policy, and a
healthcheck in one place:

```bash
docker compose -f docker/docker-compose.yml up -d
docker compose -f docker/docker-compose.yml logs -f     # follow logs
docker compose -f docker/docker-compose.yml down        # stop (data kept)
```

The compose file looks like this (abridged):

```yaml
services:
  snag:
    image: snag:latest
    container_name: snag
    ports:
      - "8000:8000"
    environment:
      DOWNLOAD_DIR: /data
      GUNICORN_WORKERS: "1"
      # SNAG_USER: admin            # uncomment + set to use env auth
      # SNAG_PASSWORD: change-me
    volumes:
      - snag-data:/data
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-fsS", "http://localhost:8000/health"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 10s
volumes:
  snag-data:
```

### Using a `.env` file

You can keep your secrets out of the compose file by using a `.env` file
(next to the compose file, or in the project root). Copy `.env.example` to
`.env` and fill it in:

```bash
cp .env.example .env
# edit .env, set SNAG_USER / SNAG_PASSWORD / SNAG_SECRET
```

Then reference the variables in the compose `environment:` block with `${VAR}`
syntax, or export them before running `docker compose up`. The `.env` file is
git-ignored, so your credentials never get committed.

## Persisting your data

Two things live on disk and you'll want to keep across restarts and image
updates:

- **Downloads** — everything in `DOWNLOAD_DIR` (default `/data`).
- **Auth data** — `users.json` and `secret` in `DATA_DIR` (default `/data`).

Both default to `/data`, so a single volume covers both. The options:

- **Named volume** (`-v snag-data:/data`) — Docker manages it; survives
  `down`/`up` and image rebuilds. The default in the compose file.
- **Host bind mount** (`-v /host/path:/data`) — the files live in a folder you
  can see and grab directly on the host. Handy for backing up or for pulling
  files off without `docker cp`.

If you don't mount a volume, downloads are written to the container's
writable layer and are **lost when the container is removed**.

## Health check and monitoring

The image's healthcheck calls `GET /health` every 30 seconds:

```bash
# See container health (shows "healthy" when up)
docker ps --filter name=snag --format '{{.Names}} {{.Status}}'

# Hit the endpoint directly
curl http://localhost:8000/health
# {"status":"ok","app":"snag","active_jobs":0,"uptime_seconds":...}
```

`active_jobs` tells you how many downloads are currently running — useful for
a monitoring dashboard or alert.

## Updating the image

```bash
# Pull the new image
docker pull ghcr.io/drbiobit/snag:latest

# Recreate the container (data volume is untouched)
docker compose -f docker/docker-compose.yml down
docker compose -f docker/docker-compose.yml up -d
```

Your downloads and credentials survive because they live in the volume, not in
the image.

## Putting it behind a reverse proxy

For a public HTTPS URL, run a reverse proxy (Caddy or Nginx) in front of the
container and point it at `localhost:8000`. With Caddy:

```
snag.example.com {
    reverse_proxy localhost:8000
}
```

Caddy handles TLS automatically. You can also run the proxy in the same
Compose file as a second service if you want everything in one stack.

## Troubleshooting

- **Container starts then the healthcheck fails** — check
  `docker compose … logs`. Usually the port is wrong or the app crashed on
  boot.
- **Downloads disappear after a restart** — you didn't mount a volume. Add
  `-v snag-data:/data` (or the compose volume) and restart.
- **Progress bar freezes / status 404** — `GUNICORN_WORKERS` is greater than
  1. Set it to `1`.
- **"yt-dlp not found" inside the container** — this shouldn't happen with the
  official image (yt-dlp is baked in). If you built a custom image, make sure
  the `Dockerfile` still installs yt-dlp into the venv.
- **Port conflict** — change the host port in `-p <host>:8000`.
