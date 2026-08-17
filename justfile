import "node_modules/@adamhl8/configs/dist/configs/justfile.base.just"

bump-deps: _bump-deps
    just db-auth-schema
    bun prisma generate

clean:
    rm -rf dist .astro

lint: astro-sync _lint

build: _build build-site

build-site:
    ASTRO_BUILD=true bun astro build

astro-sync:
    bun astro sync

dev:
    bun astro dev

db-generate:
    bun prisma generate

# Merges Better Auth's own models in, leaving ours untouched. Follow with `just db-migrate`.
# npx rather than bunx: the Better Auth CLI segfaults under `--bun`.

# Sync Better Auth's models into prisma/schema.prisma
db-auth-schema:
    npx -y auth@rc generate --config src/lib/auth.ts --yes

# Migrate, then regenerate. The client is committed and shipped in the image, so a schema change
# without a regenerate produces a client that does not know its own columns.
db-migrate:
    bun prisma migrate dev
    bun prisma generate

db-studio:
    bun prisma studio

# Build and run the container locally on http://localhost:4321
docker-run:
    docker compose -f compose.local.yaml up --build

# Stop the local container and drop its database
docker-down:
    docker compose -f compose.local.yaml down
    rm -rf data/
