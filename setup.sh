set -e

echo "========================================"
echo "  Server Dashboard Setup"
echo "========================================"

if ! command -v docker &> /dev/null; then
  echo "❌ Docker is not installed."
  exit 1
fi
if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
  echo "❌ docker-compose is not installed."
  exit 1
fi

echo ""
echo "▶ Installing frontend dependencies (fixes Tracking Prevention icon issue)..."
if command -v npm &> /dev/null; then
  cd frontend && npm install && cd ..
  echo "✅ Dependencies installed."
else
  echo "⚠️  npm not found — skipping local install (Docker build will handle it)."
fi

# Build & start
echo ""
echo "▶ Building containers (may take 2-3 minutes on first run)..."
docker compose up -d --build

echo ""
echo "✅ Dashboard is running!"
echo ""

HOST_IP=$(hostname -I | awk '{print $1}')
echo "  Open in your browser: http://${HOST_IP}:8080"
echo ""
echo "Useful commands:"
echo "  docker compose logs -f      # Live logs"
echo "  docker compose down         # Stop"
echo "  docker compose restart      # Restart"
