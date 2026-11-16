# syntax=docker/dockerfile:1.7

# ─────────────────────────────────────────────────────────────
#  Panel de administración
#
#  Es una SPA: el resultado del build son ficheros estáticos, así que la
#  imagen final no lleva Node. Nginx sirve los ficheros y devuelve
#  `index.html` en cualquier ruta desconocida, que es lo que necesita un
#  enrutador de cliente para que recargar en `/pedidos` no dé un 404.
# ─────────────────────────────────────────────────────────────

ARG NODE_VERSION=24-bookworm-slim

FROM node:${NODE_VERSION} AS build
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /repo

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc turbo.json ./
COPY apps/admin/package.json apps/admin/
COPY packages/shared/package.json packages/shared/

RUN pnpm install --frozen-lockfile --filter @ecom/admin...

COPY packages packages
COPY apps/admin apps/admin
COPY tsconfig.base.json ./

# Las VITE_* se incrustan en el bundle al compilar, igual que en la tienda.
ARG VITE_SENTRY_DSN
ARG VITE_SENTRY_RELEASE
ENV VITE_SENTRY_DSN=$VITE_SENTRY_DSN \
    VITE_SENTRY_RELEASE=$VITE_SENTRY_RELEASE

RUN pnpm --filter @ecom/admin... build

FROM nginx:1.29-alpine AS runtime
COPY apps/admin/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/admin/dist /usr/share/nginx/html

# Nginx escribe en /var/cache y /var/run; con un usuario sin privilegios hay
# que cederle esos directorios antes de cambiar de usuario.
RUN touch /var/run/nginx.pid \
 && chown -R nginx:nginx /var/cache/nginx /var/run/nginx.pid /usr/share/nginx/html

USER nginx
EXPOSE 8080

HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q --spider http://127.0.0.1:8080/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
