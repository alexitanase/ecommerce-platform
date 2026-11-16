#!/usr/bin/env bash
#
# Importa las categorías de la tienda, preguntando lo que necesita.
#
# Envoltorio de `categorias-iniciales.mjs`. Ese hace el trabajo y sirve para
# automatizar; este es para cuando lo lanza una persona contra producción, que
# es el caso en el que conviene ver antes lo que va a pasar.
#
# Tres cosas que hace y que justifican que exista:
#
#  · **La contraseña se pide en oscuro y va por entorno, nunca por argumento.**
#    Escrita en la línea de órdenes quedaría en el historial del intérprete y a
#    la vista de cualquier `ps` de la máquina, que la lista entera de argumentos
#    sí la enseña a todos los usuarios.
#
#  · **Ensayo primero, siempre.** Enseña qué categorías se crearían y pide
#    confirmación antes de escribir. Contra producción, un script que empieza a
#    escribir en cuanto lo lanzas es un script que da miedo usar.
#
#  · **Comprueba el resultado.** Al terminar vuelve a pedir el árbol y enseña lo
#    que hay de verdad, en vez de fiarse de que las peticiones dijeran que sí.
#
# Uso:
#   ./scripts/importar-categorias.sh
#
set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$RAIZ"

IMPORTADOR="scripts/categorias-iniciales.mjs"
API_POR_DEFECTO="https://api.chispaynoche.com"

log() { printf '\033[1;34m▸\033[0m %s\n' "$*"; }
ok() { printf '\033[1;32m✓\033[0m %s\n' "$*"; }
aviso() { printf '\033[1;33m!\033[0m %s\n' "$*"; }
error() {
  printf '\033[1;31m✗\033[0m %s\n' "$*" >&2
  exit 1
}

# ── Comprobaciones previas ─────────────────────────────────

command -v node >/dev/null 2>&1 || error 'Hace falta Node. Instálalo o entra al entorno del proyecto.'
[[ -f "$IMPORTADOR" ]] || error "No se encuentra $IMPORTADOR"

# El script pide la contraseña por teclado: sin terminal no hay forma, y es
# mejor decirlo aquí que fallar a la mitad con un mensaje raro.
[[ -t 0 ]] || error 'Esto pide datos por teclado; ejecútalo desde una terminal.'

printf '\n\033[1m  Importar categorías\033[0m\n'
printf '  \033[90mSe crean las que falten. Las que ya existan no se tocan.\033[0m\n\n'

# ── Datos ──────────────────────────────────────────────────

read -r -p "  API [$API_POR_DEFECTO]: " API
API="${API:-$API_POR_DEFECTO}"
# Sin la barra final: el importador ya la pone y "//api/v1" da un 404 que
# cuesta un rato entender.
API="${API%/}"

log "Comprobando que la API responde…"
codigo="$(curl -s -o /dev/null -m 15 -w '%{http_code}' "$API/health" || true)"
# curl devuelve 000 cuando no llegó a haber respuesta: DNS que no resuelve,
# puerto cerrado o tiempo agotado. Como código HTTP no significa nada.
if [[ "$codigo" != "200" ]]; then
  if [[ "$codigo" == "000" || -z "$codigo" ]]; then
    error "No se ha podido conectar con $API (¿dirección correcta? ¿está levantada?)."
  fi
  error "La API responde $codigo en $API/health, y debería responder 200."
fi
ok "API viva en $API"

# Producción se avisa por su nombre. Con dos entornos y una sola terminal, la
# equivocación fácil es lanzar contra el que no era.
if [[ "$API" != *localhost* && "$API" != *127.0.0.1* ]]; then
  aviso "Vas a escribir en un entorno REMOTO: $API"
fi

printf '\n'
read -r -p "  Correo del panel: " ADMIN_EMAIL
[[ -n "$ADMIN_EMAIL" ]] || error 'Hace falta el correo.'

# -s: no se ve al teclearla, y así tampoco queda en el historial.
read -r -s -p "  Contraseña: " ADMIN_PASSWORD
printf '\n'
[[ -n "$ADMIN_PASSWORD" ]] || error 'Hace falta la contraseña.'

# ── Ensayo ─────────────────────────────────────────────────

printf '\n'
log 'Ensayo: qué se crearía'
printf '\n'

# Se guarda además de enseñarlo: hace falta saber si había algo que crear para
# no pedir una confirmación que no confirma nada.
ensayo="$(API="$API" node "$IMPORTADOR")"
printf '%s\n' "$ensayo"

# La frase la escribe el importador cuando no falta ninguna categoría. Si algún
# día se reescribe ese mensaje, hay que cambiarla aquí también.
if grep -q 'Nada que hacer' <<<"$ensayo"; then
  printf '\n'
  ok 'Todas las categorías ya están. No hay nada que importar.'
  exit 0
fi

# ── Confirmación ───────────────────────────────────────────

printf '\n'
read -r -p "  ¿Crear estas categorías en $API? [s/N]: " respuesta
case "${respuesta,,}" in
  s | si | sí | y | yes) ;;
  *)
    aviso 'Cancelado. No se ha escrito nada.'
    exit 0
    ;;
esac

# ── Importación ────────────────────────────────────────────

printf '\n'
log 'Creando…'
printf '\n'

# Las credenciales van como entorno de este proceso concreto, no exportadas al
# intérprete: así no las heredan los comandos que se ejecuten después.
API="$API" ADMIN_EMAIL="$ADMIN_EMAIL" ADMIN_PASSWORD="$ADMIN_PASSWORD" \
  node "$IMPORTADOR" --aplicar

unset ADMIN_PASSWORD

# ── Comprobación ───────────────────────────────────────────

log 'Comprobando lo que ha quedado en la tienda…'
printf '\n'

curl -s -m 20 "$API/api/v1/catalog/categories/tree?locale=es" |
  node -e '
    let e = "";
    process.stdin.on("data", (d) => (e += d));
    process.stdin.on("end", () => {
      const arbol = JSON.parse(e || "[]");
      if (arbol.length === 0) {
        console.log("    (el árbol sigue vacío)");
        return;
      }
      const pintar = (nodos, sangria = "    ") => {
        for (const n of nodos) {
          const edad = n.isAdult ? " +18" : "";
          console.log(`${sangria}${n.name}  \x1b[90m/${n.slug}${edad}\x1b[0m`);
          pintar(n.children ?? [], sangria + "  ");
        }
      };
      pintar(arbol);
      console.log(`\n    ${arbol.length} categorías raíz.`);
    });
  '

printf '\n'
ok 'Listo.'
printf '  \033[90mEn el panel se ven al momento. La tienda cachea el árbol diez\n'
printf '  minutos, así que ahí pueden tardar ese rato en salir.\033[0m\n\n'
