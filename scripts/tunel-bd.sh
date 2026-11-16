#!/usr/bin/env bash
#
# Abre un túnel SSH hasta la base de datos de producción.
#
# Postgres no publica ningún puerto: vive en una red interna de Docker sin
# salida y sin entrada. Es deliberado —un 5432 abierto a internet recibe
# intentos de acceso a las pocas horas— pero deja la pregunta de cómo mirar los
# datos desde un cliente gráfico. Esto es la respuesta.
#
# El truco: el reenvío de puertos de SSH resuelve el destino EN EL SERVIDOR, y
# desde el servidor sí se llega a la IP del contenedor. Así no hace falta
# publicar el puerto ni cambiar la configuración de la pila.
#
#   ./scripts/tunel-bd.sh
#   → localhost:5433 apunta a la base de producción mientras no lo cierres
#
# Con el túnel abierto, en DBeaver / TablePlus / pgAdmin:
#
#   Servidor    localhost
#   Puerto      5433
#   Base        ecom
#   Usuario     ecom
#   Contraseña  la de POSTGRES_PASSWORD del .env del servidor
#
# La contraseña se lee del propio servidor, no se guarda aquí:
#
#   ssh tienda@SERVIDOR "grep '^POSTGRES_PASSWORD=' /opt/tienda/.env | cut -d= -f2-"
#
set -euo pipefail

SERVIDOR="${SERVIDOR_TIENDA:-tienda@167.172.101.188}"
PUERTO_LOCAL="${PUERTO_LOCAL:-5433}"
CONTENEDOR="${CONTENEDOR_BD:-tienda-postgres-1}"

if ss -ltn 2>/dev/null | grep -q ":$PUERTO_LOCAL "; then
  echo "El puerto $PUERTO_LOCAL ya está ocupado. Usa PUERTO_LOCAL=5434 $0" >&2
  exit 1
fi

# La IP del contenedor cambia cada vez que se recrea, así que se pregunta en el
# momento en lugar de fijarla en ningún sitio.
echo "▸ Buscando la base de datos en $SERVIDOR…"
IP="$(ssh -o BatchMode=yes "$SERVIDOR" \
  "docker inspect $CONTENEDOR --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}'" \
  | tr -d '[:space:]')"

if [[ -z "$IP" ]]; then
  echo "No se ha encontrado el contenedor $CONTENEDOR. ¿Está levantada la pila?" >&2
  exit 1
fi

cat <<AVISO

  Túnel abierto: localhost:$PUERTO_LOCAL → $IP:5432

    Servidor   localhost
    Puerto     $PUERTO_LOCAL
    Base       ecom
    Usuario    ecom
    Contraseña la de POSTGRES_PASSWORD en /opt/tienda/.env

  Esto es la base de PRODUCCIÓN. Un UPDATE sin WHERE aquí no se deshace:
  lo único que hay es la copia de las 4:15 de esta madrugada.

  Ctrl+C para cerrar el túnel.

AVISO

# -N: no ejecuta ninguna orden, solo mantiene el reenvío.
exec ssh -N -L "$PUERTO_LOCAL:$IP:5432" "$SERVIDOR"
