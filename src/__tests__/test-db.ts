import path from "node:path"
import process from "node:process"

import { createShell, makeTempDir } from "@adamhl8/configs/test"

// Point `DATABASE_URL` at a throwaway database before any test file loads.
// `env.ts` reads it only once, and every test file shares that module.
const dbPath = path.join(await makeTempDir("guild-sim-test-"), "test.db")
process.env["DATABASE_URL"] = `file:${dbPath}`

await createShell()`bun prisma migrate deploy`
