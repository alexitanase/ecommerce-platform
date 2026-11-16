#!/usr/bin/env bash
#
# Escribe el contenido de las seis páginas legales, preguntando lo que necesita.
#
# Envoltorio de `textos-legales.mjs`, por lo mismo que el de categorías: los
# datos de la empresa salen de los ajustes de la tienda, pero el correo de
# atención al cliente no está configurado en ninguna parte y las páginas no se
# pueden publicar sin él.
#
# Enseña los datos que va a usar ANTES de escribir nada. Es medio minuto de
# lectura que evita publicar seis documentos legales con el NIF equivocado en
# los tres idiomas.
#
# Uso:
#   ./scripts/importar-textos-legales.sh
#
set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$RAIZ"

IMPORTADOR="scripts/textos-legales.mjs"
API_POR_DEFECTO="https://api.chispaynoche.com"

log() { printf '\033[1;34m▸\033[0m %s\n' "$*"; }
ok() { printf '\033[1;32m✓\033[0m %s\n' "$*"; }
aviso() { printf '\033[1;33m!\033[0m %s\n' "$*"; }
error() {
  printf '\033[1;31m✗\033[0m %s\n' "$*" >&2
  exit 1
}

command -v node >/dev/null 2>&1 || error 'Hace falta Node.'
[[ -f "$IMPORTADOR" ]] || error "No se encuentra $IMPORTADOR"
[[ -t 0 ]] || error 'Esto pide datos por teclado; ejecútalo desde una terminal.'

printf '\n\033[1m  Contenido de las páginas legales\033[0m\n'
printf '  \033[90mAviso legal, privacidad, cookies, condiciones, envíos y devoluciones,\n'
printf '  en español, catalán e inglés. Solo cambia el texto: el título y la\n'
printf '  dirección de cada página se quedan como están.\033[0m\n\n'

printf '  \033[33mEsto no es asesoramiento jurídico.\033[0m Son textos estándar escritos\n'
printf '  para tu caso concreto. Que los revise un asesor antes de darlos por buenos.\n\n'

# ── Datos ──────────────────────────────────────────────────

read -r -p "  API [$API_POR_DEFECTO]: " API
API="${API:-$API_POR_DEFECTO}"
API="${API%/}"

log 'Comprobando que la API responde…'
codigo="$(curl -s -o /dev/null -m 15 -w '%{http_code}' "$API/health" || true)"
if [[ "$codigo" != "200" ]]; then
  if [[ "$codigo" == "000" || -z "$codigo" ]]; then
    error "No se ha podido conectar con $API (¿dirección correcta? ¿está levantada?)."
  fi
  error "La API responde $codigo en $API/health, y debería responder 200."
fi
ok "API viva en $API"

if [[ "$API" != *localhost* && "$API" != *127.0.0.1* ]]; then
  aviso "Vas a escribir en un entorno REMOTO: $API"
fi

# El correo tiene que existir de verdad: es la vía de contacto que la normativa
# de consumo obliga a ofrecer, y aparece en los seis documentos.
printf '\n'
read -r -p "  Correo de atención al cliente (sale en los textos): " EMAIL_CONTACTO
[[ -n "$EMAIL_CONTACTO" ]] || error 'Hace falta el correo de atención al cliente.'
[[ "$EMAIL_CONTACTO" == *@*.* ]] || error "«$EMAIL_CONTACTO» no parece un correo."
aviso "Asegúrate de que $EMAIL_CONTACTO recibe correo de verdad: irá publicado."

printf '\n'
read -r -p "  Correo del panel: " ADMIN_EMAIL
[[ -n "$ADMIN_EMAIL" ]] || error 'Hace falta el correo del panel.'

read -r -s -p "  Contraseña: " ADMIN_PASSWORD
printf '\n'
[[ -n "$ADMIN_PASSWORD" ]] || error 'Hace falta la contraseña.'

# ── Ensayo ─────────────────────────────────────────────────

printf '\n'
log 'Ensayo: con qué datos y qué se escribiría'
printf '\n'

API="$API" EMAIL_CONTACTO="$EMAIL_CONTACTO" \
  ADMIN_EMAIL="$ADMIN_EMAIL" ADMIN_PASSWORD="$ADMIN_PASSWORD" \
  node "$IMPORTADOR"

# ── Confirmación ───────────────────────────────────────────

printf '\n'
printf '  \033[1mRevisa los datos de arriba.\033[0m Van impresos en seis documentos legales.\n\n'
read -r -p "  ¿Escribir el contenido en $API? [s/N]: " respuesta
case "${respuesta,,}" in
  s | si | sí | y | yes) ;;
  *)
    aviso 'Cancelado. No se ha escrito nada.'
    exit 0
    ;;
esac

# Publicar es una decisión aparte: se puede querer escribir el texto y leerlo
# entero en el panel antes de que lo vea nadie.
printf '\n'
read -r -p "  ¿Publicarlas además, para que se vean en la tienda? [s/N]: " publicar
modo='--aplicar'
case "${publicar,,}" in
  s | si | sí | y | yes) modo='--publicar' ;;
esac

# ── Escritura ──────────────────────────────────────────────

printf '\n'
log 'Escribiendo…'
printf '\n'

API="$API" EMAIL_CONTACTO="$EMAIL_CONTACTO" \
  ADMIN_EMAIL="$ADMIN_EMAIL" ADMIN_PASSWORD="$ADMIN_PASSWORD" \
  node "$IMPORTADOR" "$modo"

unset ADMIN_PASSWORD

printf '\n'
ok 'Listo.'
if [[ "$modo" == '--aplicar' ]]; then
  printf '  \033[90mSiguen en borrador. Léelas en el panel (Contenido → Páginas) y\n'
  printf '  publícalas desde ahí cuando les des el visto bueno.\033[0m\n\n'
else
  printf '  \033[90mPublicadas y visibles en la tienda.\033[0m\n\n'
fi
