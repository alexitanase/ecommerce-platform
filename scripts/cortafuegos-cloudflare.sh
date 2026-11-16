#!/usr/bin/env bash
#
# Cierra el puerto 80 a todo el mundo menos a Cloudflare.
#
# Es obligatorio cuando el sitio va detrás de Cloudflare en modo Flexible, y
# muy recomendable en cualquier modo. Sin esto la IP del servidor sigue
# respondiendo directamente, y quien la conozca —está en registros públicos de
# certificados, en cabeceras de correo antiguas y en cualquier escaneo— puede:
#
#   · saltarse Cloudflare entero: sin cifrado, sin WAF, sin límite de peticiones;
#   · falsificar `X-Forwarded-For` y hacerse pasar por cualquier IP, con lo que
#     el limitador y el control de riesgo de pedidos dejan de servir;
#   · atacar el origen sin que Cloudflare llegue a enterarse.
#
# Los rangos se descargan de Cloudflare en cada ejecución, así que conviene
# repetirlo cada pocos meses: cambian de vez en cuando, y una IP nueva suya
# bloqueada se ve como caída del sitio.
#
#   sudo bash scripts/cortafuegos-cloudflare.sh
#
set -euo pipefail

[[ $EUID -eq 0 ]] || { echo 'Necesita sudo: modifica el cortafuegos.' >&2; exit 1; }

log() { printf '\033[1;34m▸\033[0m %s\n' "$*"; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

log 'Descargando los rangos de Cloudflare'
curl -fsS --max-time 20 https://www.cloudflare.com/ips-v4 >"$TMP/v4"
curl -fsS --max-time 20 https://www.cloudflare.com/ips-v6 >"$TMP/v6"

# Comprobación de cordura: si la descarga devolviera una página de error, el
# fichero tendría pocas líneas y estaríamos a punto de dejar el 80 abierto solo
# a nada, es decir, tirar el sitio.
total="$(grep -c . "$TMP/v4" "$TMP/v6" | awk -F: '{s+=$2} END {print s}')"
if (( total < 15 )); then
  echo "Solo se han recibido $total rangos: parece un error de descarga. No se toca el cortafuegos." >&2
  exit 1
fi

log "Aplicando $total rangos"

# Se borran primero las reglas anteriores de Cloudflare para no acumular
# duplicados cada vez que se ejecuta.
while read -r numero; do
  ufw --force delete "$numero" >/dev/null
done < <(ufw status numbered | grep -i 'cloudflare' | grep -oE '^\[[ ]*[0-9]+' | grep -oE '[0-9]+' | sort -rn)

# El 80 deja de estar abierto a todos.
ufw --force delete allow 80/tcp >/dev/null 2>&1 || true

while read -r rango; do
  [[ -z "$rango" ]] && continue
  ufw allow from "$rango" to any port 80 proto tcp comment 'Cloudflare' >/dev/null
done < <(cat "$TMP/v4" "$TMP/v6")

ufw reload >/dev/null

log 'Hecho. Estado actual:'
ufw status | head -30

cat <<'AVISO'

  A partir de ahora, pedir directamente a la IP del servidor NO responde.
  Es lo correcto: todo el tráfico legítimo entra por Cloudflare.

  Si alguna vez el sitio deja de responder justo después de ejecutar esto,
  lo más probable es que Cloudflare haya añadido rangos nuevos: vuelve a
  lanzarlo para refrescarlos.

AVISO
