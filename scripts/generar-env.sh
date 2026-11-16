#!/usr/bin/env bash
#
# Genera el .env de producción CON LOS SECRETOS YA CREADOS.
#
# Se ejecuta EN EL SERVIDOR. Ningún valor sale de la máquina: no se imprimen,
# no viajan por un chat y no se guardan en el repositorio. Lo único que sale
# por pantalla es qué variables han quedado pendientes de rellenar a mano.
#
#   ssh tienda@servidor 'bash /opt/tienda/generar-env.sh tudominio.es'
#
# Es seguro repetirlo: si ya existe un .env, no lo toca. Regenerar los
# secretos de una tienda en marcha invalidaría todas las sesiones abiertas y
# dejaría ilegibles las credenciales que el panel guarda cifradas.
#
# ⚠ Al añadir aquí una variable, añádela TAMBIÉN a `asegurar-env.sh`. Este
# guion solo corre en instalaciones nuevas; el otro es el que pone al día los
# .env que ya existen, y corre en cada despliegue. Una variable que solo esté
# aquí no llegará nunca a la tienda que ya está en marcha.
#
set -euo pipefail

RAIZ="${RAIZ_TIENDA:-/opt/tienda}"
DESTINO="$RAIZ/.env"
DOMINIO="${1:-}"

if [[ -z "$DOMINIO" ]]; then
  echo 'Uso: generar-env.sh <dominio>   (por ejemplo: generar-env.sh mitienda.es)' >&2
  exit 1
fi

if [[ -f "$DESTINO" ]]; then
  echo "Ya existe $DESTINO; no se toca." >&2
  echo 'Si de verdad quieres regenerarlo, muévelo antes a un lado.' >&2
  exit 1
fi

# Dos generadores, y la diferencia importa.
#
# `base64` usa `+` y `/`, y una contraseña con `/` dentro de una URL de
# conexión la parte en dos: `postgresql://ecom:ab/cd@postgres:5432/ecom` deja
# de tener puerto válido y Prisma responde «invalid port number» sin decir que
# el problema es la contraseña. Todo lo que acabe dentro de una URL se genera
# en hexadecimal, que solo tiene 0-9 y a-f.
#
# Los secretos que NO viajan en una URL (los de sesión) siguen en base64: más
# entropía por carácter y el validador de la API exige 32 como mínimo.
secreto() { openssl rand -base64 48 | tr -d '\n='; }
secreto_url() { openssl rand -hex 32; }
clave_hex() { openssl rand -hex 32; }

umask 077

cat >"$DESTINO" <<ENV
# Generado en el servidor el $(date -u +%Y-%m-%dT%H:%M:%SZ).
# No copiar fuera de esta máquina. Permisos 600.

NODE_ENV=production
VERSION=latest
REGISTRO=RELLENAR_ghcr.io/usuario/repositorio

# ── Dominios ──────────────────────────────────────────────────
DOMINIO=$DOMINIO
DOMINIO_API=api.$DOMINIO
DOMINIO_ADMIN=admin.$DOMINIO
DOMINIO_MEDIA=media.$DOMINIO

API_URL=https://api.$DOMINIO
STOREFRONT_URL=https://$DOMINIO
ADMIN_URL=https://admin.$DOMINIO
CORS_ORIGINS=https://$DOMINIO,https://www.$DOMINIO,https://admin.$DOMINIO

# Dominio padre de las cookies que la TIENDA necesita leer en el servidor.
#
# La API vive en api.$DOMINIO y la tienda en $DOMINIO. Una cookie sin dominio se
# queda en el subdominio que la pone, así que la tienda no la vería al pintar
# sus páginas: quien verificaba su edad se encontraba la puerta otra vez en la
# página siguiente, para siempre.
#
# El punto delante es lo que la comparte entre los subdominios.
COOKIE_DOMAIN=.$DOMINIO

API_PORT=3001
API_HOST=0.0.0.0
TRUST_PROXY=true

# ── Base de datos ─────────────────────────────────────────────
POSTGRES_USER=ecom
POSTGRES_PASSWORD=$(secreto_url)
POSTGRES_DB=ecom
DATABASE_POOL_SIZE=10

# ── Redis ─────────────────────────────────────────────────────
REDIS_PASSWORD=$(secreto_url)

# ── Buscador ──────────────────────────────────────────────────
MEILI_HOST=http://meilisearch:7700
MEILI_MASTER_KEY=$(secreto_url)

# ── Almacenamiento ────────────────────────────────────────────
S3_ENDPOINT=http://minio:9000
S3_REGION=eu-west-1
S3_ACCESS_KEY=$(openssl rand -hex 12)
S3_SECRET_KEY=$(secreto_url)
S3_BUCKET=ecom-media
S3_BUCKET_PRIVATE=ecom-private
S3_FORCE_PATH_STYLE=true
S3_PUBLIC_URL=https://media.$DOMINIO/ecom-media

# ── Secretos de sesión ────────────────────────────────────────
JWT_ACCESS_SECRET=$(secreto)
JWT_REFRESH_SECRET=$(secreto)
JWT_ACCESS_SECRET_PREVIOUS=
JWT_ACCESS_TTL=15m
JWT_REFRESH_TTL=30d

# Cifra las credenciales que se guardan desde el panel. Si se pierde, hay que
# volver a configurar TODAS las integraciones. Guarda una copia fuera de aquí.
ENCRYPTION_KEY=$(clave_hex)

REVALIDATE_SECRET=$(secreto)
METRICS_TOKEN=$(secreto)

# ── Tienda ────────────────────────────────────────────────────
DEFAULT_LOCALE=es
SUPPORTED_LOCALES=es,ca,en
DEFAULT_CURRENCY=EUR
DEFAULT_COUNTRY=ES
SITE_URL=https://$DOMINIO

# ── Correo saliente ───────────────────────────────────────────
#
# Se deja vacío a propósito: hacen falta las credenciales del servicio de envío
# (Resend, Brevo, Postmark…), que no se pueden inventar aquí. Mientras esté
# así, la tienda NO manda ningún correo: ni confirmación de pedido, ni aviso de
# envío, ni recuperación de contraseña. No falla nada por fuera, que es lo que
# lo hace peligroso.
#
# Se rellena aquí o en el panel (Ajustes → Integraciones → Correo saliente).
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASSWORD=
SMTP_SECURE=false
MAIL_FROM=Tienda <no-reply@$DOMINIO>

# ── Observabilidad ────────────────────────────────────────────
LOG_LEVEL=info
SENTRY_DSN=
SENTRY_TRACES_SAMPLE_RATE=0.1
GRAFANA_PASSWORD=$(openssl rand -base64 24 | tr -d '\n=')

THROTTLE_LIMIT=100
THROTTLE_TTL_MS=60000
ENV

# Las URL de conexión se componen aparte para no repetir la contraseña dos
# veces en el heredoc y arriesgarse a que no coincidan.
PG_PASS="$(grep '^POSTGRES_PASSWORD=' "$DESTINO" | cut -d= -f2-)"
REDIS_PASS="$(grep '^REDIS_PASSWORD=' "$DESTINO" | cut -d= -f2-)"
{
  echo
  echo '# ── Cadenas de conexión (compuestas de lo anterior) ───────────'
  echo "DATABASE_URL=postgresql://ecom:${PG_PASS}@postgres:5432/ecom?schema=public"
  echo "REDIS_URL=redis://:${REDIS_PASS}@redis:6379"
} >>"$DESTINO"

chmod 600 "$DESTINO"

echo "Creado $DESTINO con permisos $(stat -c '%a' "$DESTINO")."
echo
echo 'Pendiente de rellenar a mano (no son secretos):'
grep -n 'RELLENAR_' "$DESTINO" | sed 's/^/  /'
echo

# El correo se avisa aparte y con nombre y apellidos.
#
# Es la única variable cuya ausencia no rompe nada visible: la tienda arranca,
# cobra y sirve pedidos igual, y el cliente no recibe ni una confirmación.
# Pasó en producción y nadie se enteró hasta echarlo de menos, así que aquí se
# dice en voz alta en lugar de dejarlo en la lista de arriba.
if ! grep -qE '^SMTP_HOST=.+' "$DESTINO"; then
  echo '⚠  SMTP_HOST está vacío: la tienda NO enviará ningún correo.'
  echo '   Ni confirmación de pedido, ni aviso de envío, ni recuperar contraseña.'
  echo '   Rellena SMTP_* y MAIL_FROM aquí, o en el panel: Ajustes → Integraciones.'
  echo
fi
echo 'Secretos generados:' "$(grep -cE '^(POSTGRES_PASSWORD|REDIS_PASSWORD|MEILI_MASTER_KEY|S3_SECRET_KEY|JWT_ACCESS_SECRET|JWT_REFRESH_SECRET|ENCRYPTION_KEY|REVALIDATE_SECRET|METRICS_TOKEN|GRAFANA_PASSWORD)=.+' "$DESTINO")" 'de 10'
