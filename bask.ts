import { task } from "@adamhl8/bask"
import { build, bumpDeps, lint } from "@adamhl8/configs/bask"

export * from "@adamhl8/configs/bask"

export const clean = task(async ({ sh }) => {
  await sh`rm -rf dist .astro`
})

export const buildSite = task(async ({ sh }) => {
  await sh`ASTRO_BUILD=true astro build`
})

export const astroSync = task(async ({ sh }) => {
  await sh`astro sync`
})

export const dev = task(async ({ sh }) => {
  await sh`astro dev`
})

export const dbGenerate = task(async ({ sh }) => {
  await sh`prisma generate`
})

// Merges Better Auth's own models in, leaving ours untouched. Follow with `bask db-migrate`.
// Run it under node because the Better Auth CLI segfaults under bun.
export const dbAuthSchema = task({ desc: "Sync Better Auth's models into prisma/schema.prisma" }, async ({ sh }) => {
  await sh`bunx auth generate --config src/lib/auth.ts --yes`.bun(false)
})

// Migrate, then regenerate. The client is committed and shipped in the image, so a schema change
// without a regenerate produces a client that does not know its own columns.
export const dbMigrate = task(async ({ sh }) => {
  await sh`prisma migrate dev`
  await dbGenerate()
})

export const dbStudio = task(async ({ sh }) => {
  await sh`prisma studio`
})

export const dockerRun = task(
  { desc: "Build and run the container locally on http://localhost:4321" },
  async ({ sh }) => {
    await sh`docker compose --file compose.local.yaml up --build`
  },
)

export const dockerDown = task({ desc: "Stop the local container and drop its database" }, async ({ sh }) => {
  await sh`docker compose --file compose.local.yaml down`
  await sh`rm -rf data/`
})

lint.before(astroSync)
build.after(buildSite)
bumpDeps.after(dbAuthSchema)
bumpDeps.after(dbGenerate)
