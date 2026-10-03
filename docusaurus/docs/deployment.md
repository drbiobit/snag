---
title: Deployment
sidebar_position: 1
---

# Snag — Deployment Guide

How to run Snag somewhere you can reach it. There are four supported ways,
and the right one depends on where you're putting it and how much you want to
think about it. This page walks through each one in detail, then covers the
configuration that's shared across all of them.

## Which option should I use?

| Option | Best for | What you need | File |
|--------|----------|---------------|------|
| **Docker** | A public link, a VPS, or "I want it isolated and portable" | Docker | `Dockerfile` + `docker/docker-compose.yml` |
| **systemd** | A Linux VPS you own (the recommended "real server" path) | Python 3, ffmpeg, yt-dlp | `deploy-with-systemd.sh` |
| **PM2** | A single server where you don't have Docker or systemd | Node.js, Python 3, ffmpeg, yt-dlp | `deploy-with-pm2.sh` |
| **Mac / Windows** | Local use on your own machine | Python 3, ffmpeg, yt-dlp | `deploy-for-win-mac.sh` |

A quick rule of thumb:

- **Exposing it to the internet** → Docker (option 1), put a reverse proxy in
  front for HTTPS.
- **A Linux box you control and want to forget about** → systemd (option 2).
- **A server without systemd or Docker** → PM2 (option 3).
- **Just your laptop** → the Mac/Windows script (option 4).

All four run the app under **Gunicorn** (a production WSGI server) except the
local Mac/Windows script, which uses the built-in Flask dev server — fine for
personal use, not for a server.

---

## Prerequisites (every option)

The deploy scripts check these for you, but here's what Snag actually needs:

- **Python 3.10+** — the runtime.
- **ffmpeg** — required by `yt-dlp` to merge video+audio streams, convert
  audio, and embed metadata. Without it, most downloads fail.
- **yt-dlp** — the downloader itself. It's a CLI the app shells out to, so it
  must be on your `PATH`.
- **Docker** — only for option 1 (Docker installs yt-dlp and ffmpeg for you
  inside the image, so you don't need them on the host).

If you're unsure what's installed, the scripts tell you exactly what's missing
and, on macOS/Windows, offer to install it for you.

---

## 1. Docker (recommended for a public link)

Docker is the most portable option: one image, works on any host that runs
Docker, and the app is fully isolated from the rest of the system. It's also
the easiest to put behind a reverse proxy for a public HTTPS URL.

The image is **Alpine** based. Inside it, the system **Python 3** is
installed into a **virtualenv** (so the app's packages don't clash with the
system Python), and **yt-dlp** and **ffmpeg** are installed at the system
level. The app runs under Gunicorn and stores downloads in a persistent
volume. A full breakdown of the image is in the
[Docker deep-dive](/docker).

### The published image

You can pull the pre-built, multi-arch image (amd64 + arm64) straight from
GitHub Container Registry — no build step:

```bash
docker pull ghcr.io/drbiobit/snag:latest
docker run -d --name snag -p 8000:8000 -v snag-data:/data ghcr.io/drbiobit/snag:latest
```

Then open **http://localhost:8000**. The `snag-data` named volume keeps your
downloads (and your login credentials) across restarts and image updates.

### Build it yourself

If you'd rather build from source (e.g. you've changed the code), do it from
the project root — the folder containing `snag.py`:

```bash
docker build -t snag .
```

This produces an image named `snag` (tagged `snag:latest`).

### Deploy with Docker Compose

The compose file in `docker/` wires up the port, the download volume, and a
healthcheck:

```bash
docker compose -f docker/docker-compose.yml up -d
docker compose -f docker/docker-compose.yml logs -f     # follow logs
docker compose -f docker/docker-compose.yml down        # stop (data kept)
```

Open **http://localhost:8000**.

> Compose uses the `snag:latest` image you built (or pulled). If you rebuild
> the image, run `down` then `up -d` again to pick up the changes.

### Custom download location

Downloads go to the path in the `DOWNLOAD_DIR` environment variable (default
`/data` inside the image). The compose file mounts a **named volume**
`snag-data` at `/data`, so files survive container rebuilds and restarts.

To use a **host folder** instead of a named volume (handy if you want to grab
files off the host without `docker cp`), edit `docker/docker-compose.yml`:

```yaml
volumes:
  - ./downloads:/data        # host folder instead of a named volume
```

Or with plain Docker (no compose), mount any host directory to `/data`:

```bash
docker run -d --name snag -p 8000:8000 \
  -v /mnt/big-disk/snag:/data snag
```

The app creates the directory if it doesn't exist.

### Putting it behind HTTPS (Caddy)

For a public URL you'll want TLS. Caddy is the lowest-effort option — it
automatically obtains and renews a certificate. A minimal `Caddyfile`:

```
snag.example.com {
    reverse_proxy localhost:8000
}
```

Point `snag.example.com` at the server's IP, run Caddy, and you're on HTTPS
with no manual certificate management. Nginx works too if you prefer it; the
key is just a `proxy_pass` to `localhost:8000` plus a TLS certificate.

---

## 2. systemd (recommended for a Linux VPS)

This is the path I'd pick for a VPS you own. A single script does the whole
job: it detects your user, uid/gid and working directory, creates a
virtualenv, writes a `/etc/systemd/system/snag.service` unit file, and starts
the service. Once it's running, systemd keeps it alive — it restarts on crash
and starts automatically at boot.

```bash
sudo ./deploy-with-systemd.sh
```

Run it with `sudo` (it needs to write the unit file and talk to systemd), but
**the service itself runs as your normal non-root user**, not root.

Optional overrides:

```bash
sudo PORT=8080 ./deploy-with-systemd.sh
sudo DOWNLOAD_DIR=/var/lib/snag ./deploy-with-systemd.sh
```

> **Keep `WORKERS` at `1`.** Job state lives in a single process's memory, so
> multiple Gunicorn workers would break `/api/status` and `/api/cancel`
> polling (a poll could land on a different worker than the one that started
> the job). Concurrency comes from threads, not workers.

Managing it afterwards:

```bash
systemctl status snag            # is it running?
journalctl -u snag -f            # follow the logs
systemctl restart snag           # restart (e.g. after a code update)
systemctl stop snag              # stop
systemctl disable snag           # stop it starting at boot
```

To update the code, pull the new version and `systemctl restart snag`.

---

## 3. PM2 (single server, no Docker/systemd)

PM2 is a process manager (from the Node.js world) that can supervise any
process. This option is for a single server where you want auto-restart and
boot-start but don't have Docker or systemd (some minimal distros, or a box
you manage differently).

```bash
./deploy-with-pm2.sh
```

It checks prerequisites (node, npm, pm2, python3, ffmpeg, yt-dlp), sets up a
venv, starts Gunicorn under PM2, saves the process list, and can configure
boot-start.

Optional:

```bash
PORT=8080 ./deploy-with-pm2.sh
```

> Same as above — keep `WORKERS` at `1`.

Managing it afterwards:

```bash
pm2 logs snag        # follow logs
pm2 restart snag     # restart
pm2 stop snag        # stop
pm2 delete snag      # remove the process
pm2 save             # persist the process list
```

---

## 4. macOS / Windows (local use)

For running Snag on your own machine. The script detects the OS, offers to
install anything that's missing (Homebrew on macOS, winget/choco on Windows,
apt on WSL), sets up a virtualenv, and starts the app on the Flask dev server.

```bash
./deploy-for-win-mac.sh
```

On Windows, run this from **Git Bash** or **WSL**. Then open
**http://localhost:6909**.

This is a "local" deployment — it's great for personal use but not meant for a
headless server (use Docker, systemd, or PM2 for that).

---

## 5. Configuration (all options)

Every option is configured the same way: environment variables. The full
reference, including the authentication variables, is in the
[Configuration reference](/configuration). The short version:

| Variable | Default | Meaning |
|----------|---------|---------|
| `PORT` | `6909` (dev) / `8000` (Docker) | Port to bind. |
| `DOWNLOAD_DIR` | `./downloads` | Where finished files are saved. |
| `GUNICORN_WORKERS` | `1` | Gunicorn worker count. **Must stay 1** — job state is in process memory, so multiple workers break status/cancel polling. |
| `SNAG_USER` / `SNAG_PASSWORD` | *(unset)* | Set both to enable env-based login. |
| `SNAG_SECRET` | *(auto)* | Session signing key; auto-generated and stored in `data/secret` if unset. |

---

## 6. Health check

Every deployment exposes `GET /health` (no auth required):

```bash
curl http://localhost:8000/health
# {"status":"ok","app":"snag","active_jobs":0,"uptime_seconds":...}
```

The Docker image has a built-in healthcheck that calls this endpoint every 30
seconds, so `docker ps` will show the container as `healthy` while it's up.
It's also the endpoint to point a reverse proxy or load balancer at for
liveness checks.

---

## 7. Updating Snag

- **Docker:** pull the new image (`docker pull ghcr.io/drbiobit/snag:latest`)
  and `docker compose … down && up -d`. Your data volume is untouched, so
  downloads and credentials persist.
- **systemd / PM2:** pull the new code, then `systemctl restart snag` or
  `pm2 restart snag`.
- **Mac/Windows:** re-run the script (it reuses the existing venv).

---

## 8. Troubleshooting

- **"yt-dlp not found"** — `yt-dlp` isn't on the server's `PATH`. Install it
  (`pip install yt-dlp` or `brew install yt-dlp`) and restart the service. In
  Docker this can't happen because yt-dlp is baked into the image.
- **Downloads fail to merge / convert** — `ffmpeg` is missing. Install it and
  restart.
- **Status polling returns 404** — you're almost certainly running more than
  one Gunicorn worker. Set `GUNICORN_WORKERS=1` and restart.
- **I'm logged out after a restart** — the session signing key was regenerated
  (the `data/secret` file was lost). Set `SNAG_SECRET` explicitly if you want
  sessions to survive a data volume wipe.
- **Port already in use** — change `PORT` and restart.

> **Note on storage:** any platform with an ephemeral filesystem (some PaaS
> offerings) will lose downloads on restart — point `DOWNLOAD_DIR` at a
> persistent volume.
