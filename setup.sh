set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="$SCRIPT_DIR/.env"
LOCK_FILE="/tmp/homelab_installer.lock"
BACKEND_URL="http://localhost:3001"

exec 200>"$LOCK_FILE"
flock -n 200 || { echo "Installer already running."; exit 1; }

# ── Docker checks ─────────────────────────────────────────────────────────────
command -v docker >/dev/null 2>&1 || { echo "Docker is not installed."; exit 1; }
if ! docker compose version >/dev/null 2>&1 && ! command -v docker-compose >/dev/null 2>&1; then
  echo "Docker Compose is not installed."; exit 1
fi

# ── JWT secret (idempotent) ───────────────────────────────────────────────────
[ ! -f "$ENV_FILE" ] && touch "$ENV_FILE"

if ! grep -q "^JWT_SECRET=" "$ENV_FILE"; then
  if command -v openssl >/dev/null 2>&1; then
    SECRET=$(openssl rand -hex 32)
  else
    SECRET=$(tr -dc 'A-Za-z0-9' </dev/urandom | head -c 64)
  fi
  echo "JWT_SECRET=$SECRET" >> "$ENV_FILE"
fi

# ── Admin input ───────────────────────────────────────────────────────────────
echo ""
echo "Create your admin account."
echo "  Name     : anything (e.g. Marios Konstantinou)"
echo "  Username : lowercase, no spaces"
echo "  Password : at least 6 characters"
echo ""

printf "Name:      "; read -r ADMIN_NAME
printf "Username:  "; read -r ADMIN_USER

while true; do
  printf "Password:  "; read -rs ADMIN_PASS; echo
  printf "Confirm:   "; read -rs ADMIN_PASS2; echo
  [ "$ADMIN_PASS" = "$ADMIN_PASS2" ] && break
  echo "Passwords do not match."
done

echo ""

# ── Frontend deps ─────────────────────────────────────────────────────────────
if [ -f "$SCRIPT_DIR/frontend/package.json" ] && command -v npm >/dev/null 2>&1; then
  (cd "$SCRIPT_DIR/frontend" && npm install --prefer-offline --no-audit --silent)
fi

# ── Build & start ─────────────────────────────────────────────────────────────
echo "Building containers..."
cd "$SCRIPT_DIR"

if docker compose version >/dev/null 2>&1; then
  docker compose --env-file .env up -d --build
else
  docker-compose --env-file .env up -d --build
fi

# ── Wait for backend ──────────────────────────────────────────────────────────
printf "Waiting for backend"
for i in $(seq 1 40); do
  if curl -sf "$BACKEND_URL/api/health" >/dev/null 2>&1; then break; fi
  printf "."; sleep 2
done
echo ""

if ! curl -sf "$BACKEND_URL/api/health" >/dev/null 2>&1; then
  echo "Backend failed to start. Check: docker compose logs backend"
  exit 1
fi

# ── Create admin (idempotent) ─────────────────────────────────────────────────
HTTP_CHECK=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST "$BACKEND_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"$ADMIN_USER\",\"password\":\"$ADMIN_PASS\"}" || true)

if [ "$HTTP_CHECK" = "200" ]; then
  echo "User '$ADMIN_USER' already exists, skipping."
else
  HTTP_STATUS=$(curl -s -o /tmp/register.json -w "%{http_code}" \
    -X POST "$BACKEND_URL/api/auth/register" \
    -H "Content-Type: application/json" \
    -d "{\"name\":\"$ADMIN_NAME\",\"username\":\"$ADMIN_USER\",\"password\":\"$ADMIN_PASS\"}")

  case "$HTTP_STATUS" in
    200) echo "Account created." ;;
    409) echo "User already exists, skipping." ;;
    *)   echo "Could not create account (HTTP $HTTP_STATUS)."; cat /tmp/register.json 2>/dev/null || true ;;
  esac
  rm -f /tmp/register.json
fi

# ── Done ──────────────────────────────────────────────────────────────────────
HOST_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "localhost")

echo ""
echo "Ready at http://$HOST_IP:8080"
echo "Username: $ADMIN_USER"
echo ""