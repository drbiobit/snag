# Snag — Docker deployment

Run **Snag** in Docker. The image is based on **Ubuntu 24.04** with the
system **Python 3** installed into a **virtualenv** (all pip packages live
there), plus **yt-dlp** and **ffmpeg**. The app runs under **Gunicorn** with
a configurable download location.

## Workflow

1. **Build** the image (named `snag`) from the project root.
2. **Deploy** it with Docker Compose.

```
docker build -t snag .          # step 1: build the image
docker compose ... up -d        # step 2: deploy it
```

## Files

| File                   | Where       | Purpose                                              |
|------------------------|-------------|------------------------------------------------------|
| `Dockerfile`           | project root| Builds the `snag` image (Ubuntu 24.04 + venv + yt-dlp + ffmpeg). |
| `.dockerignore`        | project root| Keeps local artifacts out of the build.              |
| `docker-compose.yml`   | `docker/`   | Deploys the `snag` image with a download volume.     |
| `README.md`            | `docker/`   | This guide.                                          |

---

## 1. Build the image

From the **project root** (the folder containing `Main.py`):

```bash
docker build -t snag .
```

This produces an image named **`snag`** (tagged `snag:latest`).

## 2. Deploy with Docker Compose

```bash
# Start the app in the background
docker compose -f docker/docker-compose.yml up -d

# Follow the logs
docker compose -f docker/docker-compose.yml logs -f

# Stop (the download data volume is kept)
docker compose -f docker/docker-compose.yml down
```

Then open **http://localhost:8000**.

> Compose uses the `snag:latest` image you built in step 1. If you rebuild
> the image, re-run `up -d` (or `down` then `up -d`) to pick up changes.

---

## 3. Custom download location

Downloads are written to the path in the `DOWNLOAD_DIR` environment
variable (default inside the image: `/data`).

- **Compose** — a named volume `snag-data` is mounted at `/data`, so
  downloads persist across restarts and rebuilds. To use a host folder
  instead, edit `docker/docker-compose.yml`:
  ```yaml
  volumes:
    - ./downloads:/data        # host folder instead of a named volume
  ```
- **Plain Docker** (no compose) — mount any host directory to `/data`:
  ```bash
  docker run -d --name snag -p 8000:8000 \
    -v /mnt/big-disk/snag:/data snag
  ```

The app creates the directory if it doesn't exist.

---

## 4. Authentication

Two ways to set a password. Pick one.

### Option A — first-visit setup (no config)

1. Start the container: `docker compose -f docker/docker-compose.yml up -d`
2. Open **http://localhost:8000** in a browser.
3. You'll be redirected to a **"create account"** page.
4. Enter a username and password, confirm, click **create**.
5. You're in. Every subsequent visit requires sign-in.

Credentials are stored in `data/users.json` inside the `snag-data` volume,
so they persist across `docker compose down` / `up` and image rebuilds.

### Option B — environment variables (fixed creds at deploy time)

Edit `docker/docker-compose.yml` and uncomment the auth lines:

```yaml
environment:
  DOWNLOAD_DIR: /data
  GUNICORN_WORKERS: "1"
  SNAG_USER: admin
  SNAG_PASSWORD: your-strong-password
```

Then `docker compose -f docker/docker-compose.yml up -d`.

Or with plain Docker:

```bash
docker run -d --name snag -p 8000:8000 \
  -e SNAG_USER=admin -e SNAG_PASSWORD=your-strong-password \
  -v snag-data:/data snag
```

When both `SNAG_USER` and `SNAG_PASSWORD` are set, they **override** any
in-browser account — the setup page is skipped and login uses those creds.

### Resetting credentials

```bash
# Wipe the stored account (Option A)
docker volume rm docker_snag-data

# Or just delete the users file from a running container
docker exec snag rm /data/users.json
```

Then reopen the browser — the "create account" page appears again.

### Security

- Passwords hashed with PBKDF2-SHA256 (200k iterations, per-user salt).
- Session cookies: `HttpOnly`, `SameSite=Lax`, 7-day lifetime.
- Signing key auto-generated on first start, persisted to `/data/secret`.
- `/health` is always open (no auth) for container healthchecks.

---

## 5. Configuration (environment variables)

| Variable           | Default      | Meaning                                   |
|--------------------|--------------|-------------------------------------------|
| `DOWNLOAD_DIR`     | `/data`      | Where finished files are saved.           |
| `GUNICORN_WORKERS` | `1`          | Number of Gunicorn worker processes. **Must stay 1** — job state is in process memory, so multiple workers break `/api/status` and `/api/cancel` polling. |
| `SNAG_USER`        | *(unset)*    | Username for login. Set both `SNAG_USER` and `SNAG_PASSWORD` to enable env-based auth. |
| `SNAG_PASSWORD`    | *(unset)*    | Password for login. See §4 Authentication. |
| `SNAG_SECRET`      | *(auto)*     | Session signing key. Auto-generated and stored in `/data/secret` if unset. |

---

## 6. Health check

The image has a built-in healthcheck that calls `GET /health` every 30s.

```bash
# See container health
docker ps --filter name=snag --format '{{.Names}} {{.Status}}'

# Hit the endpoint directly
curl http://localhost:8000/health
# {"status":"ok","app":"snag","active_jobs":0,"uptime_seconds":...}
```

---

## 7. Requirements

- Docker
- Docker Compose v2 (the `docker compose` subcommand)

`yt-dlp` and `ffmpeg` are installed inside the image — nothing else needed.

## 8. Notes

- The container runs as a non-root user (`snag`).
- The image is Ubuntu 24.04 based; Python packages live in a virtualenv at
  `/opt/venv` (on `PATH`), so the system Python stays clean.
- If a download fails, the in-app UI shows the real `yt-dlp` error message.
