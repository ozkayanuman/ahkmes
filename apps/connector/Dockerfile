# Build context: repo kökü (docker-compose.yml -> context: .)
FROM node:20-alpine

ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable

WORKDIR /app

# Önce manifestler — bağımlılık katmanı cache'lensin
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/connector/package.json apps/connector/
RUN pnpm install --frozen-lockfile --filter @ahkmes/connector...

COPY apps/connector apps/connector

WORKDIR /app/apps/connector
CMD ["pnpm", "start"]
