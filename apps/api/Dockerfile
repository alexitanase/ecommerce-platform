# syntax=docker/dockerfile:1.7

# ─────────────────────────────────────────────────────────────
#  API y workers
#
#  El mismo binario sirve para los dos: la API arranca `main.js` y los
#  workers `main.workers.js`. Son procesos distintos a propósito —un proceso
#  que sirve HTTP y a la vez sincroniza mil productos reparte el bucle de
#  eventos entre ambos, y quien paga la latencia es el cliente que está
#  pagando— pero comparten código, así que comparten imagen.
#
#  Base Debian slim y no Alpine: `argon2` y `sharp` son módulos nativos.
#  En musl hay que compilarlos o traer variantes específicas, y un fallo de
#  ese tipo no aparece en el build sino en la primera petición que hashea una
#  contraseña. Los ~40 MB extra de Debian salen baratos comparados con eso.
# ─────────────────────────────────────────────────────────────

ARG NODE_VERSION=24-bookworm-slim

# ── Dependencias ──────────────────────────────────────────────
FROM node:${NODE_VERSION} AS deps
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable

# OpenSSL ANTES de instalar dependencias, y el orden es lo que importa.
#
# Prisma elige qué binario de su motor descargar según la versión de OpenSSL
# que detecte. Sin el paquete instalado no detecta ninguna, se queda con
# `openssl-1.1.x` por defecto, y ese binario acaba dentro de la imagen. Luego,
# en el contenedor final —donde OpenSSL sí está y es 3.0— Prisma pide el
# binario de 3.0, no lo encuentra e intenta bajarlo por internet desde la red
# de la base de datos, que no tiene salida. El síntoma es un despliegue que
# falla en las migraciones con un error de DNS que no menciona a OpenSSL.
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Y además se le dice a Prisma QUÉ binario queremos, sin dejarlo a su
# autodetección: con `openssl` instalado seguía trayéndose el de la 1.1, que en
# esta imagen no sirve. Declarado aquí, el binario correcto entra en
# `node_modules` durante la instalación y viaja dentro de la imagen.
ENV PRISMA_CLI_BINARY_TARGETS=debian-openssl-3.0.x

WORKDIR /repo

# Primero solo los manifiestos: mientras no cambien, esta capa se reutiliza y
# el `pnpm install` no se repite en cada commit de código.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc turbo.json ./
COPY apps/api/package.json apps/api/
COPY packages/db/package.json packages/db/
COPY packages/shared/package.json packages/shared/
COPY packages/payments/package.json packages/payments/
COPY packages/suppliers/package.json packages/suppliers/

RUN pnpm install --frozen-lockfile --filter @ecom/api... --filter @ecom/db...

# ── Compilación ───────────────────────────────────────────────
FROM deps AS build
WORKDIR /repo

COPY packages packages
COPY apps/api apps/api
COPY tsconfig.base.json ./

# `@ecom/api...` arrastra sus dependencias del workspace, así que esto compila
# también db, shared, payments y suppliers en el orden correcto.
RUN pnpm --filter @ecom/api... build

# Árbol de producción podado: node_modules solo con lo que la API declara.
# Sin esto la imagen final arrastraría el compilador de TypeScript, Nest CLI y
# Vitest, que no pintan nada en un servidor.
RUN pnpm deploy --filter @ecom/api --prod --legacy /produccion

# ── Migraciones ───────────────────────────────────────────────
#
# Objetivo aparte porque necesita lo contrario que el runtime: la CLI de
# Prisma, el esquema y la carpeta de migraciones, que en la imagen de la API
# serían peso muerto. Se ejecuta como contenedor de un solo uso antes de
# levantar la versión nueva.
FROM node:${NODE_VERSION} AS migrador
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
# El motor de migraciones de Prisma es un binario nativo que enlaza con
# OpenSSL. Sin él avisa de que no detecta la versión y tira con una por
# defecto: hoy funciona, pero es un fallo esperando a una actualización de la
# imagen base.
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /repo

COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/packages/db ./packages/db
COPY --from=build /repo/package.json ./package.json
COPY --from=build /repo/pnpm-workspace.yaml ./pnpm-workspace.yaml

WORKDIR /repo/packages/db

CMD ["node_modules/.bin/prisma", "migrate", "deploy"]

# ── Runtime ───────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS runtime
ENV NODE_ENV=production
# Node no conoce los límites de memoria del contenedor: sin este techo, el
# recolector de basura cree que dispone de toda la RAM del host y el kernel
# mata el proceso antes de que Node decida limpiar.
ENV NODE_OPTIONS=--max-old-space-size=768

WORKDIR /app

# Dos capas y no una, y en este orden concreto.
#
# `node_modules` son ~590 MB que cambian cuando cambia una dependencia, o sea
# casi nunca. `dist` son 6 MB que cambian en cada commit. Copiándolos por
# separado, un despliegue normal transfiere seis megas en vez de seiscientos:
# la diferencia entre desplegar en veinte segundos o en cinco minutos.
#
# Y se copia lo justo: `pnpm deploy` arrastra también `src`, `test` y las
# configuraciones de vitest, que en un servidor no pintan nada.
#
# Usuario sin privilegios. La imagen de Node ya trae `node` (uid 1000): un
# proceso de aplicación no tiene ningún motivo para ser root dentro de su
# contenedor, y si alguien encuentra una ejecución remota, la diferencia entre
# root y no-root es la diferencia entre un contenedor comprometido y un host
# comprometido.
COPY --from=build --chown=node:node /produccion/node_modules ./node_modules
COPY --from=build --chown=node:node /produccion/package.json ./package.json
COPY --from=build --chown=node:node /produccion/dist ./dist

USER node
EXPOSE 3001

# El healthcheck lo consume Traefik y el despliegue sin caída: hasta que este
# endpoint responde, el contenedor nuevo no recibe tráfico y el viejo no se
# apaga.
HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3001/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/main.js"]
