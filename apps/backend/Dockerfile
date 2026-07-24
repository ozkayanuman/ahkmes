# Build context: repo kökü (docker-compose.yml -> context: .)
FROM node:20-alpine

# Prisma engine'leri Alpine'de libssl ister
RUN apk add --no-cache openssl

ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable

WORKDIR /app

# Önce manifestler — bağımlılık katmanı cache'lensin
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/shared-types/package.json packages/shared-types/
COPY apps/backend/package.json apps/backend/
RUN pnpm install --frozen-lockfile --filter @ahkmes/backend...

COPY packages/shared-types packages/shared-types
COPY apps/backend apps/backend

RUN pnpm --filter @ahkmes/shared-types build \
  && pnpm --filter @ahkmes/backend exec prisma generate \
  && pnpm --filter @ahkmes/backend build

WORKDIR /app/apps/backend
EXPOSE 3000

# Açılışta migration + seed (idempotent upsert), sonra uygulama
CMD ["sh", "-c", "pnpm exec prisma migrate deploy && pnpm exec prisma db seed && node dist/main.js"]
