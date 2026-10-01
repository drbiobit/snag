# Snag — Docker deployment

Run **Snag** in Docker. The image is based on **Ubuntu 26.04** with the
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
| `Dockerfile`           | project root| Builds the `snag` image (Ubuntu 26.04 + venv + yt-dlp + ffmpeg). |
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

## 4. Configuration (environment variables)

| Variable           | Default      | Meaning                                   |
|--------------------|--------------|-------------------------------------------|
| `DOWNLOAD_DIR`     | `/data`      | Where finished files are saved.           |
| `GUNICORN_WORKERS` | `2`          | Number of Gunicorn worker processes.      |

Example — deploy with 4 workers:
```bash
docker compose -f docker/docker-compose.yml \
  --env-file <(echo GUNICORN_WORKERS=4) up -d
```
Or edit `GUNICORN_WORKERS` in `docker/docker-compose.yml`.

---

## 5. Health check

The image has a built-in healthcheck that calls `GET /health` every 30s.

```bash
# See container health
docker ps --filter name=snag --format '{{.Names}} {{.Status}}'

# Hit the endpoint directly
curl http://localhost:8000/health
# {"status":"ok","app":"snag","active_jobs":0,"uptime_seconds":...}
```

---

## 6. Requirements

- Docker
- Docker Compose v2 (the `docker compose` subcommand)

`yt-dlp` and `ffmpeg` are installed inside the image — nothing else needed.

## 7. Notes

- The container runs as a non-root user (`snag`).
- The image is Ubuntu 26.04 based; Python packages live in a virtualenv at
  `/opt/venv` (on `PATH`), so the system Python stays clean.
- If a download fails, the in-app UI shows the real `yt-dlp` error message.
