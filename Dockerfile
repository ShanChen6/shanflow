# syntax=docker/dockerfile:1
# Local-development images (IA-001): staging/production are not approved.
# Build context is the repository root:  docker compose --profile app build

FROM node:24-bookworm-slim AS build
ENV PNPM_HOME=/pnpm CI=true
RUN npm install -g pnpm@11.18.0
WORKDIR /repo
COPY . .
# The root "prepare" script builds @shanflow/contracts after install.
RUN pnpm install --frozen-lockfile
RUN pnpm --filter api db:generate && pnpm --filter api build

# NEXT_PUBLIC_API_URL is inlined into the browser bundle at build time and must be
# the API origin as the *browser* reaches it (not a Docker-internal host name).
ARG NEXT_PUBLIC_API_URL=http://localhost:3001
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter web build

# Avatars are written here; mount a volume so they survive container re-creation.
RUN mkdir -p /data/avatars && chown -R node:node /data /repo

FROM build AS api
ENV NODE_ENV=development AVATAR_STORAGE_DIR=/data/avatars
USER node
WORKDIR /repo/apps/api
EXPOSE 3001
CMD ["node", "/repo/docker/with-db-env.mjs", "node", "dist/main.js"]

FROM build AS web
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
USER node
WORKDIR /repo/apps/web
EXPOSE 3000
CMD ["pnpm", "start"]
