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

# Dépendances de production du seul serveur : `pnpm deploy` produit un dossier autonome
# (paquets du monorepo shared / physics / fit copiés dans node_modules, rien d'autre).
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm fetch --prod
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm --filter @allezrobert/server --prod --config.inject-workspace-packages=true deploy /out

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production PORT=2567 HOST=0.0.0.0 RENDERS_DIR=/data/renders \
    ROUTES_DIR=/app/apps/client/public/worlds/chevreuse/routes
WORKDIR /app/apps/server
COPY --from=deps --chown=node:node /out ./
# Itinéraires (JSON RouteData) s'ils sont présents dans le contexte ; sinon boucle procédurale.
COPY --from=deps --chown=node:node /app/apps/client/public /app/apps/client/public
RUN mkdir -p /data/renders && chown -R node:node /data
USER node
EXPOSE 2567
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||2567)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["./node_modules/.bin/tsx", "src/main.ts"]
