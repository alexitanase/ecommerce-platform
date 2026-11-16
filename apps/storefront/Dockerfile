# syntax=docker/dockerfile:1.7

# ─────────────────────────────────────────────────────────────
#  Tienda pública (Next.js)
#
#  Ojo con las variables: las `NEXT_PUBLIC_*` se incrustan en el bundle
#  DURANTE el build, no se leen al arrancar. Por eso entran como `ARG` y hay
#  que pasarlas al construir la imagen; ponerlas solo en el `docker compose`
#  de producción las dejaría vacías en el navegador y la tienda apuntaría a
#  `localhost` desde el móvil de un cliente.
# ─────────────────────────────────────────────────────────────

ARG NODE_VERSION=24-bookworm-slim

FROM node:${NODE_VERSION} AS deps
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /repo

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc turbo.json ./
COPY apps/storefront/package.json apps/storefront/
COPY packages/db/package.json packages/db/
COPY packages/shared/package.json packages/shared/
COPY packages/payments/package.json packages/payments/
COPY packages/suppliers/package.json packages/suppliers/

RUN pnpm install --frozen-lockfile --filter @ecom/storefront...

FROM deps AS build
WORKDIR /repo

# Lo que el navegador necesita saber en tiempo de compilación.
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_SITE_URL
ARG NEXT_PUBLIC_SENTRY_DSN
ARG SENTRY_ORG
ARG SENTRY_PROJECT
ARG SENTRY_AUTH_TOKEN
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL \
    NEXT_PUBLIC_SENTRY_DSN=$NEXT_PUBLIC_SENTRY_DSN \
    SENTRY_ORG=$SENTRY_ORG \
    SENTRY_PROJECT=$SENTRY_PROJECT \
    SENTRY_AUTH_TOKEN=$SENTRY_AUTH_TOKEN \
    NEXT_TELEMETRY_DISABLED=1

COPY packages packages
COPY apps/storefront apps/storefront
COPY tsconfig.base.json ./
# `next build` comprueba los tipos de TODO el proyecto, incluida la
# configuración de Vitest, y esa importa un fichero de la raíz del monorepo.
# Sin él aquí, el build falla por un error de tipos en un fichero que ni
# siquiera forma parte de la tienda.
COPY vitest.cobertura.mjs vitest.cobertura.d.mts ./

RUN pnpm --filter @ecom/storefront... build

FROM node:${NODE_VERSION} AS runtime
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
WORKDIR /app

# La salida autónoma ya trae dentro el `node_modules` mínimo y respeta la
# estructura del monorepo, así que las tres copias van a su sitio tal cual.
COPY --from=build --chown=node:node /repo/apps/storefront/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/storefront/.next/static ./apps/storefront/.next/static
COPY --from=build --chown=node:node /repo/apps/storefront/public ./apps/storefront/public

USER node
EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/salud').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "apps/storefront/server.js"]
