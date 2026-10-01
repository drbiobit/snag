# Snag — Deployment Guide

How to run Snag in production. Pick the option that matches your target.

| Option | Best for | File |
|--------|----------|------|
| **Docker** | Portable, isolated, a shareable link | `Dockerfile` + `docker/docker-compose.yml` |
| **systemd** | A Linux VPS you own (recommended) | `deploy-with-systemd.sh` |
| **PM2** | A single server without Docker/systemd | `deploy-with-pm2.sh` |
| **Mac / Windows** | Local use on your own machine | `deploy-for-win-mac.sh` |

All options run the app under **Gunicorn** except the local Mac/Windows
script, which uses the Flask dev server (fine for personal use).

---

## Prerequisites (every option)

- **Python 3.10+**
- **yt-dlp** on your PATH (`pip install yt-dlp` or `brew install yt-dlp`)
- **ffmpeg** (required to merge video+audio, convert audio, embed metadata)

---

## 1. Docker (recommended for a public link)

The image is **Ubuntu 26.04** based, with the system **Python 3** installed
into a **virtualenv** (all pip packages live there) plus **yt-dlp** and
**ffmpeg**. It runs Gunicorn and stores downloads in a persistent volume.

### Build the image

From the project root:

```bash
docker build -t snag .
```

### Deploy with Docker Compose

```bash
docker compose -f docker/docker-compose.yml up -d
docker compose -f docker/docker-compose.yml logs -f     # follow logs
docker compose -f docker/docker-compose.yml down        # stop (data kept)
```

Open **http://localhost:8000**.

### Custom download location

Downloads go to the path in `DOWNLOAD_DIR` (default `/data` in the image).
The compose file mounts a named volume `snag-data` at `/data` so files survive
rebuilds. To use a host folder instead, edit `docker/docker-compose.yml`:

```yaml
volumes:
  - ./downloads:/data        # host folder instead of a named volume
```

### Plain Docker (no compose)

```bash
docker run -d --name snag -p 8000:8000 \
  -v "$(pwd)/downloads:/data" snag
```

Full details: [`docker/README.md`](docker/README.md).

---

## 2. systemd (recommended for a Linux VPS)

A one-shot script that detects your user, uid/gid and working directory,
sets up a venv, writes `/etc/systemd/system/snag.service`, and starts the
service (auto-restarts on crash, starts at boot).

```bash
sudo ./deploy-with-systemd.sh
```

Optional:

```bash
sudo PORT=8080 WORKERS=4 ./deploy-with-systemd.sh
```

Manage it afterwards:

```bash
systemctl status snag
journalctl -u snag -f          # follow logs
systemctl restart snag
systemctl stop snag
```

The service runs as your (non-root) user, not root.

---

## 3. PM2 (single server, no Docker/systemd)

A one-shot script that checks prerequisites, sets up a venv, starts Gunicorn
under PM2, and (optionally) configures boot-start.

```bash
./deploy-with-pm2.sh
```

Optional:

```bash
PORT=8080 WORKERS=4 ./deploy-with-pm2.sh
```

Manage it afterwards:

```bash
pm2 logs snag
pm2 restart snag
pm2 stop snag
pm2 delete snag
```

---

## 4. macOS / Windows (local use)

A one-shot script that detects your OS, offers to install missing deps
(Homebrew / winget / apt), sets up a venv, and starts the app.

```bash
./deploy-for-win-mac.sh
```

On Windows, run this from **Git Bash** or **WSL**. Open
**http://localhost:6909**.

---

## 5. Configuration (all options)

| Variable | Default | Meaning |
|----------|---------|---------|
| `PORT` | `6909` (dev) / `8000` (Docker) | Port to bind. |
| `DOWNLOAD_DIR` | `./downloads` | Where finished files are saved. |
| `GUNICORN_WORKERS` | `2`–`4` | Gunicorn worker count. |

---

## 6. Health check

Every deployment exposes `GET /health`:

```bash
curl http://localhost:8000/health
# {"status":"ok","app":"snag","active_jobs":0,"uptime_seconds":...}
```

The Docker image has a built-in healthcheck that calls this endpoint.

---

## 7. Quick decision guide

- **Want a public URL with HTTPS?** → Docker on a VPS + a reverse proxy
  (Caddy/Nginx) in front for TLS.
- **Just a server you control?** → systemd (option 2).
- **No systemd, no Docker?** → PM2 (option 3).
- **Just using it on your laptop?** → Mac/Windows script (option 4).

> **Note on storage:** any platform with an ephemeral filesystem (e.g. some
> PaaS) will lose downloads on restart — point `DOWNLOAD_DIR` at a persistent
> volume or object storage.
