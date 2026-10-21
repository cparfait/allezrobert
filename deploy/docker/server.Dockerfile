# syntax=docker/dockerfile:1.7
# Image du serveur Allez Robert ! (Colyseus + API + migrations), Node 22.
# Construite depuis la racine du dépôt :
#   docker build -f deploy/docker/server.Dockerfile -t allezrobert-server .
# Le serveur exécute directement les sources TypeScript avec tsx (paquets du monorepo
# distribués en sources, sans étape de compilation).

FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN npm install -g pnpm@10.33.0 && pnpm --version
WORKDIR /app

# Dépendances de production uniquement (cache Docker : seule la lockfile invalide cette couche).
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm fetch --prod
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --offline --frozen-lockfile --prod --filter "@allezrobert/server..."

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production PORT=2567 HOST=0.0.0.0 RENDERS_DIR=/data/renders \
    ROUTES_DIR=/app/apps/client/public/worlds/chevreuse/routes
WORKDIR /app
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --from=deps --chown=node:node /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=deps --chown=node:node /app/packages ./packages
COPY --from=deps --chown=node:node /app/apps/server ./apps/server
# Itinéraires (JSON RouteData) s'ils sont présents dans le contexte ; sinon boucle procédurale.
COPY --from=deps --chown=node:node /app/apps/client/public ./apps/client/public
RUN mkdir -p /data/renders && chown -R node:node /data
USER node
WORKDIR /app/apps/server
EXPOSE 2567
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||2567)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["./node_modules/.bin/tsx", "src/main.ts"]
