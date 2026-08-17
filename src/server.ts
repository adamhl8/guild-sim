import { prisma } from "#lib/db.ts"
import { runSync } from "#lib/sync.ts"
import { startWorker } from "#worker/queue.ts"

// The adapter's standalone entry binds the HTTP listener on import, so the server is already up by the
// time anything below runs. Mapped in package.json `imports` because it is a build artifact.
// oxlint-disable-next-line clean-modules/require-import-extensions -- resolves to .mjs, which only exists after a build
import "#astro-entry"

const worker = startWorker()
const syncJob = Bun.cron("0 9 * * *", async () => {
  await runSync()
})

// Not awaited: blocking here would leave the listener serving nothing on a cold start. Until it lands
// the roster is empty, so an early sign-in sees "not on the roster" and works on a refresh.
void runSync()

let shuttingDown = false
const shutdown = async (signal: string): Promise<void> => {
  if (shuttingDown) return
  shuttingDown = true
  console.info(`received ${signal}, shutting down`)

  syncJob.stop()
  // The one thing worth draining. Aborting its sleep means a 30-minute rate-limit wait does not hold
  // the container open, and an in-flight sim finishes rather than being abandoned mid-upload.
  await worker.stop()
  await prisma.$disconnect()

  // The adapter discards its server handle when it autostarts, so there is nothing to close and the
  // listener would keep the event loop alive. In-flight requests are cut, which is safe: every write is
  // a single transaction, so it rolls back rather than tearing.
  process.exit(0)
}

process.on("SIGTERM", () => void shutdown("SIGTERM"))
process.on("SIGINT", () => void shutdown("SIGINT"))
