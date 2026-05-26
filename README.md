# Server Dashboard

View all your Docker containers, RAM, CPU, and disk usage, and control containers (start/stop/restart) from the browser.

## How to set up (one-time)

### 1. Download the project to your server

```bash
# Copy the project folder to the server (from your local machine):
scp -r dashboard/ user@SERVER_IP:~/dashboard

# Or, if you are already on the server, place the files in a directory like ~/dashboard
```

### 2. Run the setup

```bash
cd ~/dashboard
chmod +x setup.sh
./setup.sh
```

This runs `docker compose up -d --build` and prints the URL.

### 3. Open in your browser

```
http://SERVER_IP:8080
```

The server IP is detected automatically — you don't need to change anything in the code.

---

## How it works

```text
Browser  →  :8080 (nginx/frontend)
                ↓
           /api/*  →  backend:3001 (Node.js)
                           ↓
                   /var/run/docker.sock  (Docker API)
                   systeminformation    (CPU/RAM/Disk)
```

Nginx proxies `/api` calls to the backend — so the frontend doesn't need to know the server IP.

---

## Ports

| Port | Purpose |
|------|---------|
| 8080 | Frontend (browser) |
| 3001 | Backend API (internal) |

If port 8080 is already in use, change it in `docker-compose.yml`:
```yaml
ports:
  - "9090:80"   # use 9090 instead
```

---

## Update

```bash
cd ~/dashboard
docker compose down
docker compose up -d --build
```

## Logs

```bash
docker compose logs -f backend    # Backend logs
docker compose logs -f frontend   # Nginx logs
```
