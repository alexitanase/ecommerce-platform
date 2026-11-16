#!/usr/bin/env bash
#
# Despliegue a producción desde tu portátil, sin registro de imágenes.
#
# Mientras no haya CI/CD, esta es la vía: se construyen las cuatro imágenes
# aquí, se mandan por SSH y se lanza en el servidor el relevo de siempre
# —`desplegar.sh`—, que migra la base de datos y cambia los contenedores uno a
# uno esperando a que cada uno esté sano.
#
# No sustituye a `desplegar.sh`: lo llama. Toda la lógica delicada (orden de las
# migraciones, relevo sin caída, rollback) sigue viviendo en el servidor.
#
# Uso:
#   ./scripts/desplegar-desde-local.sh                     construye y despliega
#   ./scripts/desplegar-desde-local.sh v2026.07.30-10      esa versión concreta
#   ./scripts/desplegar-desde-local.sh --sin-construir v2026.07.30-10
#   ./scripts/desplegar-desde-local.sh --sin-pruebas
#   ./scripts/desplegar-desde-local.sh --sembrar           + datos de referencia
#   ./scripts/desplegar-desde-local.sh --estado            qué hay ahora mismo
#   ./scripts/desplegar-desde-local.sh --rollback          vuelve a la anterior
#
# Variables (con sus valores por defecto):
#   SERVIDOR_TIENDA=tienda@167.172.101.188
#   DOMINIO=chispaynoche.com
#
set -euo pipefail

SERVIDOR="${SERVIDOR_TIENDA:-tienda@167.172.101.188}"
DOMINIO="${DOMINIO:-chispaynoche.com}"
RAIZ_REMOTA="${RAIZ_REMOTA:-/opt/tienda}"

# La raíz del repositorio, se ejecute desde donde se ejecute.
RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$RAIZ"

IMAGENES=(api migrador storefront admin)
REGISTRO_LOCAL=tienda

construir=1
pruebas=1
# Siembra los datos de referencia —permisos, roles, ajustes que falten— después
# de migrar. Hace falta cuando la versión trae permisos nuevos: sin ellos el
# permiso no existe en la base, no lo tiene nadie —ni el propietario— y la
# pantalla nueva devuelve 403 sin decir por qué. No va por defecto porque el
# seed reconstruye los permisos de los roles de sistema, y eso deshace los
# ajustes que se hayan hecho a mano desde el panel.
sembrar=0
version=""

log() { printf '\033[1;34m▸\033[0m %s\n' "$*"; }
ok() { printf '\033[1;32m✓\033[0m %s\n' "$*"; }
error() {
  printf '\033[1;31m✗\033[0m %s\n' "$*" >&2
  exit 1
}

# ── Argumentos ────────────────────────────────────────────────

for arg in "$@"; do
  case "$arg" in
    --sin-construir) construir=0 ;;
    --sin-pruebas) pruebas=0 ;;
    --sembrar) sembrar=1 ;;
    --estado)
      ssh "$SERVIDOR" "RAIZ_TIENDA=$RAIZ_REMOTA bash $RAIZ_REMOTA/desplegar.sh --estado"
      exit 0
      ;;
    --rollback)
      log "Volviendo a la versión anterior…"
      ssh "$SERVIDOR" "RAIZ_TIENDA=$RAIZ_REMOTA bash $RAIZ_REMOTA/desplegar.sh --rollback"
      exit 0
      ;;
    -h | --help)
      sed -n '/^# Despliegue/,/^#   DOMINIO/p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    -*) error "Opción desconocida: $arg" ;;
    *) version="$arg" ;;
  esac
done

# Versión por defecto: fecha + número correlativo del día. Así dos despliegues
# el mismo día no comparten etiqueta, que es lo que impide saber qué está
# sirviendo de verdad.
if [[ -z "$version" ]]; then
  hoy="v$(date +%Y.%m.%d)"
  n=1
  while docker image inspect "$REGISTRO_LOCAL/api:$hoy-$(printf '%02d' "$n")" > /dev/null 2>&1; do
    n=$((n + 1))
  done
  version="$hoy-$(printf '%02d' "$n")"
fi

log "Versión: $version"
log "Servidor: $SERVIDOR"
if ((sembrar)); then log "Con sembrado de datos de referencia"; fi

# ── 1. Que no salga nada roto ─────────────────────────────────

if ((pruebas)); then
  log "Pruebas y comprobaciones (usa --sin-pruebas para saltarlas)…"
  pnpm turbo run lint typecheck test || error "Hay comprobaciones en rojo: no se despliega."
  ok "Todo en verde"
else
  printf '\033[1;33m!\033[0m %s\n' "Pruebas saltadas a petición."
fi

# ── 2. Construir ──────────────────────────────────────────────

if ((construir)); then
  log "Construyendo las cuatro imágenes…"

  docker build -q -f apps/api/Dockerfile --target runtime -t "$REGISTRO_LOCAL/api:$version" . > /dev/null
  ok "api"

  docker build -q -f apps/api/Dockerfile --target migrador -t "$REGISTRO_LOCAL/migrador:$version" . > /dev/null
  ok "migrador"

  # Las variables NEXT_PUBLIC_* se hornean en el build: cambiarlas después no
  # sirve de nada, la tienda ya lleva dentro la URL con la que se construyó.
  docker build -q -f apps/storefront/Dockerfile --target runtime \
    --build-arg "NEXT_PUBLIC_API_URL=https://api.$DOMINIO" \
    --build-arg "NEXT_PUBLIC_SITE_URL=https://$DOMINIO" \
    -t "$REGISTRO_LOCAL/storefront:$version" . > /dev/null
  ok "storefront"

  docker build -q -f apps/admin/Dockerfile --target runtime -t "$REGISTRO_LOCAL/admin:$version" . > /dev/null
  ok "admin"
fi

# Estén construidas ahora o de antes, las cuatro tienen que existir: mandar tres
# deja el servidor con una imagen que no encuentra y el despliegue abortado a
# medias.
faltan=()
for imagen in "${IMAGENES[@]}"; do
  docker image inspect "$REGISTRO_LOCAL/$imagen:$version" > /dev/null 2>&1 || faltan+=("$imagen")
done
((${#faltan[@]} == 0)) || error "No existen localmente: ${faltan[*]}. Quita --sin-construir."

# ── 3. Mandarlas ──────────────────────────────────────────────

etiquetas=()
for imagen in "${IMAGENES[@]}"; do etiquetas+=("$REGISTRO_LOCAL/$imagen:$version"); done

log "Enviando ~600 MB comprimidos. Esto tarda varios minutos; no cierres la terminal."

# `pv` si está instalado, para ver que la cosa avanza. Sin él, funciona igual.
if command -v pv > /dev/null 2>&1; then
  docker save "${etiquetas[@]}" | gzip -1 | pv -pterb | ssh "$SERVIDOR" 'gunzip | docker load'
else
  docker save "${etiquetas[@]}" | gzip -1 | ssh "$SERVIDOR" 'gunzip | docker load'
fi
ok "Imágenes cargadas en el servidor"

# ── 4. La configuración de la pila ────────────────────────────
#
# SIN `--delete`: en esa carpeta vive el `.env` de producción, que no está en el
# repositorio. Un borrado por sincronización se llevaría todos los secretos.
log "Sincronizando configuración…"
rsync -az \
  docker-compose.prod.yml \
  scripts/desplegar.sh \
  scripts/copia-seguridad.sh \
  scripts/generar-env.sh \
  scripts/asegurar-env.sh \
  "$SERVIDOR:$RAIZ_REMOTA/"
ssh "$SERVIDOR" "chmod +x $RAIZ_REMOTA/*.sh"
ok "Configuración al día"

# ── 5. El relevo, en el servidor ──────────────────────────────

log "Desplegando en el servidor…"
opciones=""
if ((sembrar)); then opciones=" --sembrar"; fi
ssh "$SERVIDOR" "RAIZ_TIENDA=$RAIZ_REMOTA bash $RAIZ_REMOTA/desplegar.sh '$version'$opciones"

# ── 6. Comprobar desde fuera ──────────────────────────────────
#
# Desde fuera y no desde el servidor: lo que importa es que responda a un
# cliente, con Cloudflare y Traefik por medio, no que el contenedor esté vivo.
log "Comprobando…"
fallos=0
for url in \
  "https://$DOMINIO/es" \
  "https://admin.$DOMINIO" \
  "https://api.$DOMINIO/health" \
  "https://media.$DOMINIO/minio/health/live"; do
  codigo="$(curl -s -o /dev/null -w '%{http_code}' --max-time 25 "$url" || echo 000)"
  if [[ "$codigo" == "200" ]]; then
    ok "$url"
  else
    printf '\033[1;31m✗\033[0m %s → %s\n' "$url" "$codigo"
    fallos=$((fallos + 1))
  fi
done

sirviendo="$(ssh "$SERVIDOR" "grep '^VERSION=' $RAIZ_REMOTA/.env | cut -d= -f2-")"

if ((fallos > 0)); then
  error "Algo no responde. Para volver atrás: $0 --rollback"
fi

if [[ "$sirviendo" != "$version" ]]; then
  error "El servidor dice estar sirviendo '$sirviendo' y no '$version'."
fi

ok "Desplegado $version"
