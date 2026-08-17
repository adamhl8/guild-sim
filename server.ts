import { prisma } from "#lib/db.ts"
import { runSync } from "#lib/sync.ts"
import { startWorker } from "#worker/queue.ts"

// Astro's node adapter autostarts the HTTP server on import, which would leave no window to start the
// worker or register the cron. Disabling it here means the import below must stay dynamic: a static
// import is hoisted above this assignment.
// oxlint-disable-next-line node/no-process-env -- the adapter reads this at import time; there is no other hook
process.env["ASTRO_NODE_AUTOSTART"] = "disabled"

// oxlint-disable-next-line clean-modules/require-subpath-imports -- a build artifact, not a source module
const { startServer } = await import("./dist/server/entry.mjs")

// Ranks decide who is an admin, so the roster has to exist before the first request.
await runSync()

const worker = startWorker()
const syncJob = Bun.cron("0 9 * * *", async () => {
  await runSync()
})

const { server } = startServer()
console.info(`guild-sim listening on ${server.host}:${String(server.port)}`)

let shuttingDown = false
const shutdown = async (signal: string): Promise<void> => {
  if (shuttingDown) return
  shuttingDown = true
  console.info(`received ${signal}, shutting down`)

  await server.stop()
  syncJob.stop()
  // Aborts the worker's sleep, so a 30-minute rate-limit wait does not hold the container open.
  await worker.stop()
  await prisma.$disconnect()
  process.exit(0)
}

process.on("SIGTERM", () => void shutdown("SIGTERM"))
process.on("SIGINT", () => void shutdown("SIGINT"))
