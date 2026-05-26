set -e

echo "========================================"
echo "  Server Dashboard Setup"
echo "========================================"

# Έλεγχος Docker
if ! command -v docker &> /dev/null; then
  echo "❌ Το Docker δεν είναι εγκατεστημένο."
  exit 1
fi
if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
  echo "❌ Το docker-compose δεν είναι εγκατεστημένο."
  exit 1
fi

# Build & start
echo ""
echo "▶ Building containers (μπορεί να πάρει 2-3 λεπτά την πρώτη φορά)..."
docker compose up -d --build

echo ""
echo "✅ Dashboard is running!"
echo ""


HOST_IP=$(hostname -I | awk '{print $1}')
echo "  Άνοιξε στον browser: http://${HOST_IP}:8080"
echo ""
echo "Useful commands:"
echo "  docker compose logs -f      # Live logs"
echo "  docker compose down         # Stop"
echo "  docker compose restart      # Restart"
