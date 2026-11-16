FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends python3-pil \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY deploy/v3-server.mts deploy/v3-server.mts
COPY apps/client/scripts/v3Assets.ts apps/client/scripts/v3Assets.ts
COPY tools/v3_assets.py tools/v3_assets.py
ENV HOST=0.0.0.0 PORT=2570 PYTHONUNBUFFERED=1 AR_V3_PYTHON=python3
CMD ["node", "--experimental-strip-types", "deploy/v3-server.mts"]
