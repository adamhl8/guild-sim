FROM oven/bun:latest AS base
LABEL org.opencontainers.image.source=https://github.com/adamhl8/guild-sim
WORKDIR /app
ENV NODE_ENV="production"

COPY package.json bun.lock bunfig.toml ./

FROM base AS build

COPY --from=ghcr.io/casey/just:latest /just /usr/local/bin/

RUN bun install --ignore-scripts

COPY prisma ./prisma
COPY src ./src
COPY astro.config.ts prisma.config.ts tsconfig.json justfile ./

ENV ASTRO_BUILD=true
RUN just build-site

FROM base

RUN bun install --ignore-scripts --production

COPY --from=build /app/dist ./dist
COPY prisma ./prisma
COPY src ./src
COPY prisma.config.ts tsconfig.json ./

ENV PORT=8080
ENV HOST=0.0.0.0
EXPOSE 8080

# `exec` so the app is PID 1 and receives SIGTERM, which is what drains the queue worker cleanly.
CMD ["sh", "-c", "bun prisma migrate deploy && exec bun ./src/server.ts"]
