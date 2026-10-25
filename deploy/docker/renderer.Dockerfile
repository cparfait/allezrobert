# syntax=docker/dockerfile:1.7
# Worker de rendu vidéo (HyperFrames) : Node 22 + FFmpeg + Chromium headless.
# Consomme la file `render_jobs` de PostgreSQL et délègue le rendu aux scripts de
# packages/sequences (render-summary.ts, hf.ts). Inspiré du Dockerfile officiel de la CLI
# HyperFrames (hyperframes/dist/docker/Dockerfile.render).
#   docker build -f deploy/docker/renderer.Dockerfile -t allezrobert-renderer .

FROM node:22-bookworm-slim
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true CONTAINER=true HYPERFRAMES_NO_TELEMETRY=1 \
    NODE_ENV=production RENDERS_DIR=/data/renders RENDER_PROJECT_DIR=/app/packages/sequences

# FFmpeg, bibliothèques de Chromium et polices de secours.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl ffmpeg \
      libgbm1 libnss3 libatk-bridge2.0-0 libdrm2 libxcomposite1 libxdamage1 libxrandr2 \
      libcups2 libasound2 libpangocairo-1.0-0 libxshmfence1 libgtk-3-0 \
      fonts-liberation fonts-dejavu-core fonts-noto-color-emoji fontconfig \
    && rm -rf /var/lib/apt/lists/* && fc-cache -f

RUN npm install -g pnpm@10.33.0
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY patches ./patches
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm fetch
COPY . .
# Serveur (worker, accès base) + séquences (CLI HyperFrames en dépendance de développement).
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --offline --frozen-lockfile --filter "@allezrobert/server..." --filter "@allezrobert/sequences..."

# Chrome épinglé par la CLI HyperFrames (chrome-headless-shell : capture déterministe).
WORKDIR /app/packages/sequences
RUN npx --no-install hyperframes browser ensure && (npx --no-install hyperframes doctor || true)

RUN mkdir -p /data/renders
WORKDIR /app/apps/server
CMD ["./node_modules/.bin/tsx", "src/worker/render-worker.ts"]
