#!/usr/bin/env bash
#
# Copia de seguridad de la base de datos.
#
# Formato `custom` (-Fc) y no SQL plano: permite restaurar tablas sueltas, va
# comprimido y se restaura en paralelo. Un volcado plano de una base grande
# tarda horas en volver, y una restauración lenta es una restauración que no se
# hace cuando hay que hacerla.
#
# Uso:
#   ./scripts/copia-seguridad.sh              copia completa
#   ./scripts/copia-seguridad.sh --verificar  copia + prueba de restauración
#
set -euo pipefail

# Dónde vive la instalación.
#
# En el repositorio este guion está en `scripts/`, así que el `.env` queda un
# nivel por encima. En el servidor está suelto en `/opt/tienda/`, y el `.env`
# está a su lado: mirar siempre un nivel por encima buscaba `/opt/.env`, que no
# existe, y la copia fallaba con «Falta DATABASE_URL».
#
# El fallo pasó desapercibido meses porque el cron escribe el error en un log
# que nadie abre: la tienda llevaba desde el primer día sin una sola copia.
if [[ -n "${RAIZ_TIENDA:-}" ]]; then
  RAIZ="$RAIZ_TIENDA"
elif [[ -f "$(dirname "${BASH_SOURCE[0]}")/.env" ]]; then
  RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
else
  RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fi

DESTINO="${BACKUP_DIR:-$RAIZ/copias}"
RETENCION_DIAS="${BACKUP_RETENTION_DAYS:-30}"
VERIFICAR=false
[[ "${1:-}" == "--verificar" ]] && VERIFICAR=true

# shellcheck disable=SC1091
[[ -f "$RAIZ/.env" ]] && set -a && source "$RAIZ/.env" && set +a

: "${DATABASE_URL:?Falta DATABASE_URL}"

# Prisma añade parámetros propios a la URL (?schema=public, connection_limit…)
# que libpq no entiende y hacen fallar a pg_dump con un error poco claro.
URL_LIMPIA="${DATABASE_URL%%\?*}"

# ¿Desde dónde se habla con la base?
#
# NO se decide por si hay `pg_dump` instalado en el host, que era el criterio
# anterior y estaba mal: en el servidor sí lo hay, pero la base corre en Docker
# en una red interna sin puerto publicado, así que `pg_dump` arrancaba y moría
# con «could not translate host name "postgres"».
#
# Lo que de verdad decide es a QUÉ MÁQUINA apunta la URL. Un nombre que no sea
# localhost es un servicio de Docker, y ahí solo se llega desde dentro de la
# red de contenedores.
ANFITRION="$(printf '%s' "$URL_LIMPIA" | sed -E 's#^[^@]+@##; s#[:/].*$##')"
DESDE_CONTENEDOR=true
case "$ANFITRION" in
  localhost | 127.0.0.1 | ::1) DESDE_CONTENEDOR=false ;;
esac

if [[ "$DESDE_CONTENEDOR" == false ]] && command -v pg_dump > /dev/null 2>&1; then
  pgd()  { pg_dump "$@"; }
  pgr()  { pg_restore "$@"; }
  psq()  { psql "$@"; }
  # El host ve la base en localhost, tal cual está en DATABASE_URL.
  URL_INTERNA="$URL_LIMPIA"
else
  echo "  (la base está en Docker: se usa el cliente del contenedor)"
  # Qué pila de contenedores.
  #
  # En el repositorio están los DOS ficheros, así que preferir el de producción
  # hacía que en el portátil se buscara la base en una pila que no está
  # levantada. En el servidor solo existe el de producción, que es lo que hace
  # que este orden funcione en los dos sitios.
  COMPOSE="$RAIZ/docker-compose.prod.yml"
  [[ -f "$RAIZ/docker-compose.yml" ]] && COMPOSE="$RAIZ/docker-compose.yml"
  DC=(docker compose -f "$COMPOSE")
  pgd()  { "${DC[@]}" exec -T postgres pg_dump "$@"; }
  pgr()  { "${DC[@]}" exec -T postgres pg_restore "$@"; }
  psq()  { "${DC[@]}" exec -T postgres psql "$@"; }
  # Dentro del contenedor la base es "localhost" respecto a sí misma, pero el
  # host puede tener otro puerto publicado: se normaliza a 5432.
  URL_INTERNA="$(printf '%s' "$URL_LIMPIA" | sed -E 's#@[^:/]+(:[0-9]+)?/#@localhost:5432/#')"
fi

mkdir -p "$DESTINO"
MARCA="$(date +%Y%m%d-%H%M%S)"
FICHERO="$DESTINO/ecom-$MARCA.dump"

# Un volcado a medias no puede quedarse en el directorio de copias: un fichero
# de cero bytes junto a las copias buenas se confunde con una copia el día que
# hay prisa. Si algo falla a partir de aquí, se borra.
limpiar_incompleto() { [[ -s "$FICHERO" ]] || rm -f "$FICHERO"; }
trap limpiar_incompleto EXIT

echo "→ Volcando la base de datos…"
# --no-owner y --no-acl: el destino de una restauración (un servidor nuevo, el
# portátil de alguien) rara vez tiene los mismos roles, y sin esto la
# restauración falla justo cuando más prisa hay.
# El volcado sale por la salida estándar para que funcione igual dentro del
# contenedor, que no comparte el sistema de ficheros del host.
pgd "$URL_INTERNA" --format=custom --compress=9 --no-owner --no-acl > "$FICHERO"

TAMANO="$(du -h "$FICHERO" | cut -f1)"
echo "  copia creada: $FICHERO ($TAMANO)"

# Una copia que no se puede leer no es una copia. Comprobarlo cuesta segundos.
echo "→ Comprobando que el fichero es legible…"
if ! pgr --list < "$FICHERO" > /dev/null 2>&1; then
  echo "  ERROR: la copia está corrupta y no se puede leer" >&2
  exit 1
fi
TABLAS="$(pgr --list < "$FICHERO" | grep -c 'TABLE DATA' || true)"
echo "  legible · $TABLAS tablas con datos"

# La suma de control detecta corrupción en reposo: un disco puede degradar un
# fichero durante meses sin que nadie se entere hasta el día de la restauración.
sha256sum "$FICHERO" > "$FICHERO.sha256"

if [[ "$VERIFICAR" == true ]]; then
  echo "→ Restaurando en una base temporal para verificarla de verdad…"
  BASE_PRUEBA="verificacion_copia_$MARCA"
  SERVIDOR="${URL_INTERNA%/*}"

  psq "$SERVIDOR/postgres" -c "CREATE DATABASE \"$BASE_PRUEBA\";" > /dev/null
  limpiar() {
    psq "$SERVIDOR/postgres" -c "DROP DATABASE IF EXISTS \"$BASE_PRUEBA\";" > /dev/null 2>&1 || true
  }
  trap limpiar EXIT

  # Aquí va en serie porque el fichero entra por la entrada estándar y
  # pg_restore necesita un fichero real para paralelizar. En una restauración
  # de verdad conviene copiar el dump al servidor y usar --jobs=4: en una base
  # grande es la diferencia entre veinte minutos de caída y dos horas. Está
  # explicado en RECUPERACION.md.
  pgr --dbname="$SERVIDOR/$BASE_PRUEBA" --no-owner --no-acl < "$FICHERO" > /dev/null 2>&1

  # Se cuentan filas de las tablas que de verdad importan: un esquema restaurado
  # sin datos pasaría cualquier comprobación que solo mire si hay tablas.
  for tabla in orders products users invoices; do
    ORIGEN="$(psq "$URL_INTERNA" -tAc "SELECT count(*) FROM \"$tabla\";" 2>/dev/null | tr -d '\r' || echo '-')"
    COPIA="$(psq "$SERVIDOR/$BASE_PRUEBA" -tAc "SELECT count(*) FROM \"$tabla\";" 2>/dev/null | tr -d '\r' || echo '-')"
    if [[ "$ORIGEN" != "$COPIA" ]]; then
      echo "  ERROR en $tabla: origen $ORIGEN filas, copia $COPIA" >&2
      exit 1
    fi
    echo "  $tabla: $COPIA filas ✓"
  done

  echo "  restauración verificada"
fi

echo "→ Retirando copias de más de $RETENCION_DIAS días…"
BORRADAS="$(find "$DESTINO" -name 'ecom-*.dump*' -mtime "+$RETENCION_DIAS" -print -delete | wc -l)"
echo "  $BORRADAS ficheros retirados"

echo
echo "Copia completada: $FICHERO"
