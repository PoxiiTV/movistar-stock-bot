#!/bin/sh
# Instala el vigilante como servicio systemd. Ejecutar como root en el mini PC.
set -e
DESTINO=/opt/vigilante-movistar

if ! command -v node >/dev/null 2>&1; then
  echo "Node no encontrado, instalando desde los repos de Debian..."
  apt-get update -qq && apt-get install -y nodejs
fi
node -e 'if (typeof fetch !== "function") { console.error("Node demasiado antiguo: hace falta 18 o superior."); process.exit(1) }'

mkdir -p "$DESTINO"
cp index.js chat-id.js .env "$DESTINO/"
[ -f "$DESTINO/state.json" ] || echo '{"hayStock":false,"avisadoSinCoincidencias":false}' > "$DESTINO/state.json"
chmod 600 "$DESTINO/.env"

cp vigilante-movistar.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now vigilante-movistar
sleep 2
systemctl --no-pager status vigilante-movistar | head -12
echo
echo "Listo. Ver registro en vivo:  journalctl -u vigilante-movistar -f"
