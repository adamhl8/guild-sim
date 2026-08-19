import { afterAll, describe, expect, it, mock } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import process from "node:process"

import type { Result } from "ts-explicit-errors"
import { isErr } from "ts-explicit-errors"

import type { Character } from "#lib/wowaudit/characters.ts"

// A throwaway database. Set before any import that reads DATABASE_URL, which is why every import of
// application code below is dynamic.
const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-sim-sync-test-"))
const dbPath = path.join(dbDir, "test.db")
process.env["DATABASE_URL"] = `file:${dbPath}`

const migrate = Bun.spawnSync(["bun", "prisma", "migrate", "deploy"], {
  env: { ...process.env, DATABASE_URL: `file:${dbPath}` },
  stdout: "pipe",
  stderr: "pipe",
})
if (migrate.exitCode !== 0) throw new Error(`migrations failed: ${migrate.stderr.toString()}`)

let rosterResponse: Character[] = []

// The real modules are captured first and spread back in: replacing them wholesale would strip the
// other exports that sibling test files import.
const realCharacters = await import("#lib/wowaudit/characters.ts")
const realTeam = await import("#lib/wowaudit/team.ts")

await mock.module("#lib/wowaudit/characters.ts", () => ({
  ...realCharacters,
  // oxlint-disable-next-line typescript/require-await -- must match the real async signature
  getCharacters: async () => rosterResponse,
}))
await mock.module("#lib/wowaudit/team.ts", () => ({
  ...realTeam,
  // oxlint-disable-next-line typescript/require-await -- must match the real async signature
  getTeam: async () => ({ id: 1, name: "Test", guildName: "Test", region: "us" }),
}))

// Its own client rather than `#lib/db.ts`'s global singleton: that singleton is cached on `globalThis`,
// so this file and `submit.test.ts` -- which run concurrently and each set DATABASE_URL at module scope --
// would otherwise share one connection and tear down each other's database.
const { PrismaClient } = await import("#generated/prisma/client.ts")
const { PrismaLibSql } = await import("@prisma/adapter-libsql")
const prisma = new PrismaClient({ adapter: new PrismaLibSql({ url: `file:${dbPath}` }) })

const realDb = await import("#lib/db.ts")
await mock.module("#lib/db.ts", () => ({ ...realDb, prisma }))

// The other three sub-syncs all read Raidbots through `staticData`, and `syncSources` also asks wowaudit
// for the season. Stubbing both keeps `runSync` offline so the aggregation assertion is not a network test.
const realStaticData = await import("#lib/raidbots/static-data.ts")
const realPeriod = await import("#lib/wowaudit/period.ts")
await mock.module("#lib/raidbots/static-data.ts", () => ({
  ...realStaticData,
  // oxlint-disable-next-line typescript/require-await -- must match the real async signature
  staticData: async (file: string) => (file === "metadata" ? {} : []),
}))
await mock.module("#lib/wowaudit/period.ts", () => ({
  ...realPeriod,
  // oxlint-disable-next-line typescript/require-await -- must match the real async signature
  getSeason: async () => ({ instances: [] }),
}))

const { runSync, syncRoster } = await import("#lib/sync.ts")

const character = (id: number, name: string): Character => ({
  id,
  name,
  realm: "Area 52",
  class: "Warlock",
  role: "Ranged",
  rank: "Trial",
  blizzardId: `1566-${String(id)}`,
})

const okResult = <T>(result: Result<T>): T => {
  if (isErr(result)) throw new Error(result.messageChain)
  return result
}

const errMessage = (result: unknown): string => {
  if (!isErr(result)) throw new Error("expected an error result")
  return result.message
}

/** A rostered character who has pasted, so the cascade has something to destroy. */
const seed = async (id: number, name: string): Promise<void> => {
  await prisma.rosterCharacter.create({
    data: { ...character(id, name), syncedAt: new Date(0) },
  })
  await prisma.user.create({
    data: { id: `user-${String(id)}`, name, email: `${String(id)}@battlenet.invalid` },
  })
  await prisma.characterClaim.create({ data: { userId: `user-${String(id)}`, characterId: id } })
  await prisma.submission.create({
    data: { userId: `user-${String(id)}`, characterId: id, simcText: "# paste", spec: "Destruction" },
  })
}

interface Counts {
  roster: number
  claims: number
  submissions: number
}

const counts = async (): Promise<Counts> => ({
  roster: await prisma.rosterCharacter.count(),
  claims: await prisma.characterClaim.count(),
  submissions: await prisma.submission.count(),
})

afterAll(async () => {
  await prisma.$disconnect()
  fs.rmSync(dbDir, { recursive: true, force: true })
})

/**
 * One sequential scenario rather than three cases: `bunfig.toml` runs tests concurrently, and `syncRoster` reconciles
 * the whole table, so parallel cases would delete each other's rows and race on the stubbed response.
 */
describe("syncRoster", () => {
  it("upserts, prunes a departure, but refuses an empty roster", async () => {
    // Two rostered raiders who have each pasted, so the cascade has something to destroy.
    await seed(1, "Kyprus")
    await seed(2, "Genshii")
    expect(await counts()).toEqual({ roster: 2, claims: 2, submissions: 2 })

    // A genuine departure still prunes, so the guard has not disabled reconciliation.
    rosterResponse = [character(1, "Kyprus")]
    expect(okResult(await syncRoster())).toBe(1)
    expect(await prisma.rosterCharacter.findMany({ select: { id: true } })).toEqual([{ id: 1 }])

    // The point of the guard. An empty response is a valid HTTP 200, and obeying it would delete every
    // remaining row and cascade through claims into the stored pastes, which nothing can bring back.
    const before = await counts()
    rosterResponse = []
    expect(errMessage(await syncRoster())).toBe("wowaudit returned an empty roster, so nothing was changed")
    expect(await counts()).toEqual(before)
    expect(before.submissions).toBeGreaterThan(0)

    // What the admin actually sees: `syncNow` renders `result.message`, so the refusal has to survive
    // `runSync` rather than stopping at a console line.
    rosterResponse = []
    expect(errMessage(await runSync())).toContain("wowaudit returned an empty roster")

    // And a healthy response still upserts normally, with nothing left over to report.
    rosterResponse = [character(1, "Kyprus"), character(3, "Thalrinn")]
    expect(isErr(await runSync())).toBe(false)
    expect(await prisma.rosterCharacter.count()).toBe(2)
  })
})
