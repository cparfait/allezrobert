# syntax=docker/dockerfile:1.7
# Image web : Caddy (HTTPS automatique) + build statique du jeu (apps/client) et de l'appli
# compagnon (apps/companion, servie sous /companion/).
#   docker build -f deploy/docker/web.Dockerfile -t allezrobert-web .

FROM node:22-bookworm-slim AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN npm install -g pnpm@10.33.0
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY patches ./patches
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm fetch
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --offline --frozen-lockfile --filter "@allezrobert/client..." --filter "@allezrobert/companion..."
RUN pnpm --filter @allezrobert/client build && pnpm --filter @allezrobert/companion build

FROM caddy:2-alpine
COPY --from=build /app/apps/client/dist /srv/client
COPY --from=build /app/apps/companion/dist /srv/companion
COPY deploy/Caddyfile /etc/caddy/Caddyfile
