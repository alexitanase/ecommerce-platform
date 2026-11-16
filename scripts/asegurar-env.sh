#!/usr/bin/env bash
#
# Pone al día el .env de producción SIN tocar lo que ya hay.
#
# El problema que resuelve: `generar-env.sh` solo se ejecuta la primera vez, así
# que cada variable nueva que trae un despliegue hay que acordarse de añadirla a
# mano. Nadie se acuerda. El contenedor arranca igual y la funcionalidad
# simplemente no va —la puerta de edad reapareciendo eternamente por un
# `COOKIE_DOMAIN` que faltaba costó un rato averiguarlo—.
#
# Por qué no se reutiliza `generar-env.sh`: porque ACUÑA SECRETOS. Volver a
# ejecutarlo cambiaría `POSTGRES_PASSWORD` —y la base dejaría de aceptar la
# conexión—, los secretos de sesión —y se cerrarían todas las sesiones— y, lo
# irreparable, `ENCRYPTION_KEY`: las credenciales de AliExpress y de las
# pasarelas quedarían cifradas con una clave que ya no existe. Sin copia previa,
# eso no se recupera; hay que volver a configurarlo todo.
#
# La regla aquí es exactamente la contraria: **si una variable ya está, no se
# toca nunca**, tenga el valor que tenga, aunque esté vacía. Solo se añade lo
# que falta.
#
#   bash asegurar-env.sh            comprueba y añade lo que falte
#   bash asegurar-env.sh --revisar  solo dice qué falta, sin escribir
#
set -euo pipefail

RAIZ="${RAIZ_TIENDA:-/opt/tienda}"
ENV="$RAIZ/.env"
REVISAR=0
[[ "${1:-}" == '--revisar' ]] && REVISAR=1

log() { printf '\033[1;34m▸\033[0m %s\n' "$*"; }
ok() { printf '\033[1;32m✓\033[0m %s\n' "$*"; }
aviso() { printf '\033[1;33m!\033[0m %s\n' "$*"; }
error() {
  printf '\033[1;31m✗\033[0m %s\n' "$*" >&2
  exit 1
}

[[ -f "$ENV" ]] || error "No existe $ENV. Para crearlo la primera vez: generar-env.sh <dominio>"

# ── Lo que TIENE que estar ────────────────────────────────────
#
# Si falta una de estas, el .env está corrupto o incompleto, no desactualizado.
# Generar una nueva sería peor que parar: con `ENCRYPTION_KEY` la API arrancaría
# tan tranquila y las credenciales guardadas quedarían ilegibles sin que nadie
# se entere hasta el siguiente pedido.
EXIGIDAS=(
  DOMINIO
  DATABASE_URL
  REDIS_URL
  POSTGRES_PASSWORD
  ENCRYPTION_KEY
  JWT_ACCESS_SECRET
  JWT_REFRESH_SECRET
)

existe() { grep -qE "^${1}=" "$ENV"; }
valor_de() { grep -E "^${1}=" "$ENV" | head -1 | cut -d= -f2-; }

faltan_criticas=()
for clave in "${EXIGIDAS[@]}"; do
  existe "$clave" || faltan_criticas+=("$clave")
done

if ((${#faltan_criticas[@]} > 0)); then
  error "Faltan variables que no se pueden inventar: ${faltan_criticas[*]}
  Eso no es un .env viejo, es un .env roto. Restaura la copia de seguridad;
  generar secretos nuevos dejaría ilegible todo lo que hay cifrado."
fi

DOMINIO="$(valor_de DOMINIO)"
[[ -n "$DOMINIO" ]] || error 'DOMINIO está vacío en el .env y de él dependen otras variables.'

# ── Lo que se añade si falta ──────────────────────────────────
#
# Formato: CLAVE=valor. El valor puede usar $DOMINIO y se calcula al vuelo.
#
# Cuando un cambio necesite una variable nueva, se añade UNA LÍNEA aquí y el
# siguiente despliegue la pone sola en todos los entornos. Esa es la idea.
#
# Un secreto nuevo sí se puede acuñar aquí sin riesgo: si la variable no
# existía, no hay nada cifrado ni firmado con ella.
declare -A NUEVAS=(
  # El punto de delante es lo que hace que la cookie la compartan la tienda y
  # la API, que viven en dominios distintos. Sin él, verificar la edad no sirve
  # de nada: la tienda no ve la cookie al renderizar y la puerta vuelve a salir.
  [COOKIE_DOMAIN]=".$DOMINIO"

  # De aquí salen el canonical, los hreflang, el sitemap y las imágenes de Open
  # Graph. Sin ella salían en relativo y Google ignora los hreflang relativos.
  [SITE_URL]="https://$DOMINIO"

  # ── Correo saliente ──
  #
  # Estas seis nunca han estado en el .env de producción, y esa es exactamente
  # la razón por la que la tienda llevaba tiempo sin mandar un solo correo: sin
  # configuración, el envío se salta en silencio y no falla nada por fuera.
  #
  # Se añaden vacías a propósito. No sirven de nada por sí solas —las
  # credenciales las da el servicio de envío— pero ponen las claves delante de
  # quien abra el fichero, en vez de dejar que la ausencia pase inadvertida.
  [SMTP_HOST]=""
  [SMTP_PORT]="587"
  [SMTP_USER]=""
  [SMTP_PASSWORD]=""
  [SMTP_SECURE]="false"
  [MAIL_FROM]="Tienda <no-reply@$DOMINIO>"
)

# El orden de un diccionario de bash no es estable, y un .env que cambia de
# orden en cada ejecución es imposible de comparar entre despliegues.
ORDEN=(
  COOKIE_DOMAIN
  SITE_URL
  SMTP_HOST
  SMTP_PORT
  SMTP_USER
  SMTP_PASSWORD
  SMTP_SECURE
  MAIL_FROM
)

anadidas=()
for clave in "${ORDEN[@]}"; do
  existe "$clave" && continue
  anadidas+=("$clave")
done

if ((${#anadidas[@]} == 0)); then
  ok 'El .env ya tiene todas las variables que la aplicación necesita.'
  exit 0
fi

if ((REVISAR)); then
  aviso "Faltan ${#anadidas[@]}: ${anadidas[*]}"
  exit 1
fi

# Copia antes de escribir. Es el fichero con todos los secretos de la tienda:
# si algo sale mal a mitad, tiene que haber a dónde volver.
respaldo="$ENV.$(date -u +%Y%m%dT%H%M%SZ).bak"
cp -p "$ENV" "$respaldo"

{
  echo
  echo "# ── Añadido automáticamente el $(date -u +%Y-%m-%dT%H:%M:%SZ) ──"
} >>"$ENV"

for clave in "${anadidas[@]}"; do
  printf '%s=%s\n' "$clave" "${NUEVAS[$clave]}" >>"$ENV"
  log "Añadida $clave"
done

chmod 600 "$ENV"
ok "${#anadidas[@]} variable(s) añadidas. Copia previa en $(basename "$respaldo")."
