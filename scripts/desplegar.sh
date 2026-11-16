#!/usr/bin/env bash
#
# Despliegue en el servidor de producción.
#
# Lo ejecuta el workflow de GitHub Actions por SSH, y también se puede lanzar a
# mano desde el servidor. El orden importa y no es negociable:
#
#   1. Descargar las imágenes nuevas ANTES de tocar nada. Si el registro falla
#      o una imagen no existe, el despliegue se aborta con la tienda intacta.
#   2. Migrar la base de datos. Va antes que el código nuevo porque las
#      migraciones son de tipo «expandir»: añaden lo que la versión nueva
#      necesita sin romper lo que la vieja sigue usando durante el minuto que
#      dura el relevo.
#   3. Relevar los contenedores de uno en uno, esperando a que el nuevo esté
#      sano antes de apagar el viejo.
#
# Uso:
#   ./desplegar.sh v2026.07.29-a1b2c3d     despliega esa versión
#   ./desplegar.sh v2026… --sembrar        además, siembra datos de referencia
#   ./desplegar.sh --rollback              vuelve a la anterior
#   ./desplegar.sh --estado                qué versión está sirviendo
#
set -euo pipefail

RAIZ="${RAIZ_TIENDA:-/opt/tienda}"
COMPOSE=(docker compose -f "$RAIZ/docker-compose.prod.yml" --env-file "$RAIZ/.env")
REGISTRO_VERSIONES="$RAIZ/.versiones"
SERVICIOS_WEB=(api storefront admin)
ESPERA_MAX=120

cd "$RAIZ"

log() { printf '\033[1;34m▸\033[0m %s\n' "$*"; }
error() { printf '\033[1;31m✗\033[0m %s\n' "$*" >&2; }

version_actual() { grep -E '^VERSION=' "$RAIZ/.env" | cut -d= -f2- || echo ''; }
registro() { grep -E '^REGISTRO=' "$RAIZ/.env" | cut -d= -f2- || echo ''; }

# ── Salud de un contenedor ────────────────────────────────────
#
# Se mira el healthcheck de Docker, no «¿está arrancado?». Un contenedor
# arrancado puede estar todavía conectando con Postgres, y mandarle tráfico en
# ese momento es servir errores a clientes reales.
esperar_sano() {
  local contenedor="$1" esperado="$2" transcurrido=0

  while ((transcurrido < ESPERA_MAX)); do
    local estado
    estado="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}sin-healthcheck{{end}}' "$contenedor" 2>/dev/null || echo 'ausente')"

    case "$estado" in
      healthy) return 0 ;;
      unhealthy)
        error "El contenedor nuevo de $esperado ha arrancado enfermo."
        docker logs --tail 50 "$contenedor" >&2 || true
        return 1
        ;;
      ausente)
        error "El contenedor nuevo de $esperado ha desaparecido."
        return 1
        ;;
    esac

    sleep 3
    transcurrido=$((transcurrido + 3))
  done

  error "$esperado no ha llegado a estar sano en ${ESPERA_MAX}s."
  docker logs --tail 50 "$contenedor" >&2 || true
  return 1
}

# ── Relevo sin caída de un servicio ───────────────────────────
#
# El truco está en el orden: se levanta un segundo contenedor con la imagen
# nueva, se espera a que esté sano, y solo entonces se apaga el viejo. Traefik
# reparte entre los dos mientras dura el solape y saca de rotación al que se
# apaga, así que ninguna petición cae.
#
# Cuidado con `--scale 1` a secas: Docker Compose elimina el contenedor con el
# número MÁS ALTO, que es justamente el nuevo. Por eso los viejos se apuntan
# antes y se paran por identificador, no por escala.
relevar() {
  local servicio="$1"
  local viejos nuevos

  viejos="$("${COMPOSE[@]}" ps -q "$servicio" || true)"

  if [[ -z "$viejos" ]]; then
    log "$servicio no estaba levantado: arranque normal."
    "${COMPOSE[@]}" up -d --no-deps "$servicio"
    return
  fi

  log "Levantando el relevo de $servicio…"
  "${COMPOSE[@]}" up -d --no-deps --no-recreate --scale "$servicio=2" "$servicio"

  nuevos="$("${COMPOSE[@]}" ps -q "$servicio" | grep -vF "$viejos" || true)"
  if [[ -z "$nuevos" ]]; then
    error "No se ha creado ningún contenedor nuevo para $servicio."
    return 1
  fi

  for c in $nuevos; do
    esperar_sano "$c" "$servicio" || return 1
  done

  log "$servicio sano; retirando la versión anterior."
  for c in $viejos; do
    # Margen para que Traefik lo saque de rotación y para que termine las
    # peticiones en curso antes de recibir el SIGKILL.
    docker stop --timeout 30 "$c" >/dev/null
    docker rm "$c" >/dev/null
  done

  "${COMPOSE[@]}" up -d --no-deps --no-recreate --scale "$servicio=1" "$servicio"
}

# ── Datos de referencia ───────────────────────────────────────
#
# Permisos, roles, ajustes que falten, páginas legales y zonas de envío. Es lo
# que las migraciones NO traen: son filas, no esquema.
#
# Va a petición y no en cada despliegue por una razón concreta: el seed
# reconstruye los permisos de cada rol de sistema, así que si alguien los ha
# ajustado a mano desde el panel, sembrar los devuelve a lo declarado en el
# código. Todo lo demás —ajustes de marca, textos legales— se crea solo si
# falta y nunca se pisa.
#
# Cuándo hace falta: cuando una versión trae permisos nuevos. Sin sembrar, el
# permiso no existe en la base, nadie lo tiene —ni el propietario— y la
# pantalla nueva devuelve 403 sin más explicación.
sembrar() {
  local version="$1"

  log "Sembrando datos de referencia…"
  if ! VERSION="$version" "${COMPOSE[@]}" run --rm --no-deps \
    -e NODE_ENV=production migrador node_modules/.bin/tsx prisma/seed.ts; then
    error 'El sembrado ha fallado.'
    return 1
  fi
}

desplegar() {
  local version="$1"
  local sembrado="${2:-0}"

  log "Desplegando $version"
  local anterior
  anterior="$(version_actual)"

  # 1 · El .env, al día
  #
  # Antes que nada: si el despliegue trae una variable nueva y no está, el
  # contenedor arranca igual y la funcionalidad no va, sin error y sin aviso.
  # Solo AÑADE lo que falte; nunca toca lo que ya hay —regenerar secretos
  # dejaría ilegibles las credenciales cifradas del panel—.
  if [[ -x "$RAIZ/asegurar-env.sh" ]]; then
    if ! RAIZ_TIENDA="$RAIZ" bash "$RAIZ/asegurar-env.sh"; then
      error 'El .env no ha podido ponerse al día. Nada tocado.'
      exit 1
    fi
  fi

  # 2 · Imágenes
  #
  # Con registro se descargan. Sin él —despliegue manual, con las imágenes
  # transferidas por `docker save | ssh docker load`— ya están en la máquina.
  #
  # No basta con dejar pasar el fallo del `pull`: hay que comprobar que las
  # cuatro están, una por una. Seguir sin comprobarlo dejaba el relevo a medias
  # con una imagen que no existe, y eso es la tienda caída a mitad de despliegue.
  log "Comprobando imágenes…"
  if ! VERSION="$version" "${COMPOSE[@]}" pull --quiet api storefront admin migrador 2>/dev/null; then
    local faltan=() reg
    reg="$(registro)"
    for imagen in api storefront admin migrador; do
      docker image inspect "$reg/$imagen:$version" >/dev/null 2>&1 || faltan+=("$imagen")
    done

    if ((${#faltan[@]} > 0)); then
      error "No se han podido descargar las imágenes y faltan en la máquina: ${faltan[*]}"
      error 'Nada tocado: la tienda sigue sirviendo la versión anterior.'
      exit 1
    fi

    log 'Sin registro: se usan las cuatro imágenes ya cargadas en la máquina.'
  fi

  # 3 · Migraciones
  log "Aplicando migraciones…"
  if ! VERSION="$version" "${COMPOSE[@]}" run --rm --no-deps migrador; then
    error 'Las migraciones han fallado. No se ha tocado ningún contenedor en servicio.'
    exit 1
  fi

  # 3 bis · Datos de referencia, si se han pedido.
  #
  # Después de migrar —necesita las tablas nuevas— y antes de relevar, para que
  # el código nuevo no llegue a arrancar sin los permisos que espera. Si falla,
  # se aborta con la tienda sirviendo todavía la versión anterior.
  if ((sembrado)); then
    if ! sembrar "$version"; then
      error 'Nada relevado: la tienda sigue sirviendo la versión anterior.'
      exit 1
    fi
  fi

  # 4 · La versión pasa a ser la nueva para todo lo que venga después.
  sed -i "s|^VERSION=.*|VERSION=$version|" "$RAIZ/.env"

  # 5 · Relevo
  for servicio in "${SERVICIOS_WEB[@]}"; do
    if ! relevar "$servicio"; then
      error "Fallo relevando $servicio."
      if [[ -n "$anterior" ]]; then
        error "Volviendo a $anterior…"
        sed -i "s|^VERSION=.*|VERSION=$anterior|" "$RAIZ/.env"
        for s in "${SERVICIOS_WEB[@]}"; do relevar "$s" || true; done
      fi
      exit 1
    fi
  done

  # Los workers no atienden peticiones: se reinician sin ceremonia. Bull vuelve
  # a poner en la cola lo que quedara a medias.
  log 'Reiniciando workers…'
  "${COMPOSE[@]}" up -d --no-deps workers

  # 6 · Registro y limpieza
  [[ -n "$anterior" ]] && echo "$anterior" >>"$REGISTRO_VERSIONES"
  # Sin esto, el disco se llena de imágenes viejas en unas semanas: cada
  # despliegue deja tres capas de varios cientos de megas.
  docker image prune -af --filter 'until=168h' >/dev/null 2>&1 || true

  log "Desplegado $version"
  "${COMPOSE[@]}" ps
}

rollback() {
  if [[ ! -s "$REGISTRO_VERSIONES" ]]; then
    error 'No hay ninguna versión anterior registrada.'
    exit 1
  fi

  local anterior
  anterior="$(tail -n 1 "$REGISTRO_VERSIONES")"

  # Aviso honesto: el código vuelve atrás, el esquema no. Es la razón por la
  # que las migraciones tienen que ser compatibles hacia atrás.
  log "Volviendo a $anterior. Las migraciones aplicadas NO se deshacen."
  desplegar "$anterior"
}

# `--sembrar` puede venir en cualquier orden; lo que quede es la versión.
sembrado=0
argumentos=()
for arg in "$@"; do
  case "$arg" in
    --sembrar) sembrado=1 ;;
    *) argumentos+=("$arg") ;;
  esac
done

case "${argumentos[0]:-}" in
  --rollback) rollback ;;
  --estado)
    echo "Versión: $(version_actual)"
    "${COMPOSE[@]}" ps
    ;;
  '' | -h | --help)
    sed -n '2,26p' "$0" | sed 's/^# \{0,1\}//'
    ;;
  *) desplegar "${argumentos[0]}" "$sembrado" ;;
esac
