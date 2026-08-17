import "node_modules/@adamhl8/configs/dist/configs/justfile.base.just"

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

db-migrate:
    bun prisma migrate dev

db-studio:
    bun prisma studio
