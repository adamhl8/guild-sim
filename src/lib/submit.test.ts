import { afterAll, beforeAll, describe, expect, it, mock } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import process from "node:process"

import type { Result } from "ts-explicit-errors"
import { isErr } from "ts-explicit-errors"

// A throwaway database. Set before any import that reads DATABASE_URL, which is why every import of
// application code below is dynamic.
const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-sim-test-"))
const dbPath = path.join(dbDir, "test.db")
process.env["DATABASE_URL"] = `file:${dbPath}`

const migrate = Bun.spawnSync(["bun", "prisma", "migrate", "deploy"], {
  env: { ...process.env, DATABASE_URL: `file:${dbPath}` },
  stdout: "pipe",
  stderr: "pipe",
})
if (migrate.exitCode !== 0) throw new Error(`migrations failed: ${migrate.stderr.toString()}`)

const LIVE_BUILD = "12.1.0.69299"
const NOW = new Date("2026-08-17T12:00:00.000Z")

interface LoadedShape {
  name: string
  realm: string
  spec: string
  addonInfo: { version?: string; wowVersion?: string; exportedAt?: string }
}

/**
 * Keyed by the pasted text so tests never share mutable state: bunfig runs test files concurrently, and a single
 * mutable "next response" would let one test clobber another's.
 */
const responses = new Map<string, LoadedShape>()

// The real modules are captured first and spread back in: replacing them wholesale would strip the
// other exports that sibling test files import.
const realSession = await import("#lib/raidbots/session.ts")
const realCharacter = await import("#lib/raidbots/character.ts")

await mock.module("#lib/raidbots/session.ts", () => ({
  ...realSession,
  // oxlint-disable-next-line typescript/require-await -- must match the real async signature
  getSession: async () => "raidsid=test",
}))
await mock.module("#lib/raidbots/character.ts", () => ({
  ...realCharacter,
  // oxlint-disable-next-line typescript/require-await -- must match the real async signature
  loadSimcCharacter: async (_cookie: string, text: string) => {
    const loaded = responses.get(text)
    if (!loaded) throw new Error("no stubbed response for the given paste")
    return {
      ...loaded,
      classId: 9,
      specId: 267,
      lootSpecId: 267,
      faction: "horde",
      profileCacheId: "cache-1",
      region: "us",
    }
  },
}))

const { prisma } = await import("#lib/db.ts")
const { submitPaste } = await import("#lib/submit.ts")

/** Keeps `if (isErr(...))` out of the test bodies, which the lint rules disallow. */
const errMessage = (result: unknown): string => {
  if (!isErr(result)) throw new Error("expected an error result")
  return result.message
}

const okResult = <T>(result: Result<T>): T => {
  if (isErr(result)) throw new Error(result.messageChain)
  return result
}

let seq = 0

interface Fixture {
  userId: string
  characterId: number
  simc: string
}

/** Every test gets its own user, character and paste, so concurrent tests cannot interfere. */
const fixture = async (overrides: Partial<LoadedShape> = {}): Promise<Fixture> => {
  seq += 1
  const id = seq
  const userId = `user-${String(id)}`
  const name = `Char${String(id)}`
  const simc = `# paste ${String(id)}\nwarlock="${name}"\n`

  // submitPaste trims before loading, so key on the trimmed form.
  responses.set(simc.trim(), {
    name,
    realm: "Illidan",
    spec: "Destruction",
    addonInfo: { version: "12.1.0", wowVersion: LIVE_BUILD, exportedAt: "2026-08-17 11:00" },
    ...overrides,
  })

  await prisma.user.create({
    data: {
      id: userId,
      name: `Tag#${String(id)}`,
      email: `${String(id)}@battlenet.invalid`,
      createdAt: NOW,
      updatedAt: NOW,
    },
  })
  await prisma.rosterCharacter.create({
    data: {
      id,
      name,
      realm: "Illidan",
      class: "Warlock",
      role: "Ranged",
      rank: "Raider",
      blizzardId: `57-${String(id)}`,
      syncedAt: NOW,
    },
  })
  await prisma.characterClaim.create({ data: { userId, characterId: id } })

  return { userId, characterId: id, simc }
}

beforeAll(async () => {
  await prisma.settings.create({
    data: {
      id: 1,
      source: "season",
      difficulties: "mythic,heroic",
      currentSeasonNumber: 2,
      liveWowBuild: LIVE_BUILD,
      maxPasteAgeDays: 3,
      buildCheck: "exact",
    },
  })
  await prisma.source.create({
    data: { raidbotsId: -102, name: "Season 2 Raids", type: "raid", seasonNumber: 2, syncedAt: NOW },
  })
})

afterAll(async () => {
  await prisma.$disconnect()
  fs.rmSync(dbDir, { recursive: true, force: true })
})

// Two Flawless gems from the real list, so "different gem" means a choice a raider could actually make.
const GARNET = 240_908
const LAPIS = 240_918

describe("submitPaste", () => {
  it("stores the paste and fans out one job per configured difficulty", async () => {
    const { userId, characterId, simc } = await fixture()

    const result = okResult(await submitPaste(userId, simc, GARNET))
    expect(result.queued).toBe(2)

    const jobs = await prisma.simJob.findMany({
      where: { submission: { characterId } },
      orderBy: { difficulty: "asc" },
    })
    expect(jobs.map((job) => job.difficulty)).toEqual(["heroic", "mythic"])
    expect(jobs.every((job) => job.status === "queued")).toBe(true)
    // The season aggregate, resolved from the DB rather than the network.
    expect(jobs.every((job) => job.sourceId === -102)).toBe(true)
  })

  it("records the provenance the staleness gate relies on", async () => {
    const { userId, characterId, simc } = await fixture()
    await submitPaste(userId, simc, GARNET)

    const submission = await prisma.submission.findFirstOrThrow({ where: { characterId } })
    expect(submission.wowVersion).toBe(LIVE_BUILD)
    expect(submission.addonVersion).toBe("12.1.0")
    expect(submission.spec).toBe("Destruction")
  })

  // The load says who the paste is for; the claim says whether this user may submit it.
  it("refuses a paste for a character the user does not own", async () => {
    const owner = await fixture()
    const stranger = await fixture()

    const result = await submitPaste(stranger.userId, owner.simc, GARNET)
    expect(errMessage(result)).toContain("not one of your roster characters")
    expect(await prisma.simJob.count({ where: { submission: { characterId: owner.characterId } } })).toBe(0)
  })

  it("refuses a character that is not on the roster at all", async () => {
    const { userId, simc } = await fixture({ name: "Ghost" })
    const result = await submitPaste(userId, simc, GARNET)
    expect(errMessage(result)).toContain("Ghost-Illidan")
  })

  it("rejects a paste from an older build and queues nothing", async () => {
    const { userId, characterId, simc } = await fixture({
      addonInfo: { version: "12.1.0", wowVersion: "12.1.0.69214", exportedAt: "2026-08-17 11:00" },
    })
    const result = await submitPaste(userId, simc, GARNET)
    expect(errMessage(result)).toContain("12.1.0.69214")
    expect(await prisma.submission.count({ where: { characterId } })).toBe(0)
  })

  it("rejects a paste older than the age limit", async () => {
    const { userId, simc } = await fixture({
      addonInfo: { version: "12.1.0", wowVersion: LIVE_BUILD, exportedAt: "2026-08-01 11:00" },
    })
    const result = await submitPaste(userId, simc, GARNET)
    expect(errMessage(result)).toContain("days old")
  })

  it("refuses an empty paste before touching raidbots", async () => {
    const { userId, characterId } = await fixture()
    const result = await submitPaste(userId, "   ", GARNET)
    expect(isErr(result)).toBe(true)
    expect(await prisma.submission.count({ where: { characterId } })).toBe(0)
  })

  it("skips a spec raidbots cannot sim", async () => {
    const { userId, characterId, simc } = await fixture()
    await prisma.rosterCharacter.update({ where: { id: characterId }, data: { unsupportedSpec: "Destruction" } })

    const result = await submitPaste(userId, simc, GARNET)
    expect(errMessage(result)).toContain("cannot sim Destruction")
  })

  it("stores the chosen gem and remembers it on the character", async () => {
    const { userId, characterId, simc } = await fixture()
    okResult(await submitPaste(userId, simc, GARNET))

    const submission = await prisma.submission.findFirstOrThrow({ where: { characterId } })
    expect(submission.gemId).toBe(GARNET)
    const character = await prisma.rosterCharacter.findUniqueOrThrow({ where: { id: characterId } })
    expect(character.preferredGemId).toBe(GARNET)
  })

  // Same gear, different gem is a genuinely different sim, so it must not look like a duplicate.
  it("treats the same paste with a different gem as new work", async () => {
    const { userId, characterId, simc } = await fixture()
    okResult(await submitPaste(userId, simc, GARNET))

    const again = okResult(await submitPaste(userId, simc, LAPIS))
    expect(again.queued).toBe(2)
    expect(await prisma.submission.count({ where: { characterId } })).toBe(2)
  })

  it("still rejects the same paste with the same gem", async () => {
    const { userId, simc } = await fixture()
    okResult(await submitPaste(userId, simc, GARNET))
    expect(errMessage(await submitPaste(userId, simc, GARNET))).toContain("already submitted")
  })

  // The refresh case: the browser replays a byte-identical body, so this is what makes it free.
  it("rejects an identical paste and queues nothing", async () => {
    const { userId, characterId, simc } = await fixture()
    okResult(await submitPaste(userId, simc, GARNET))

    const again = await submitPaste(userId, simc, GARNET)
    expect(errMessage(again)).toContain("already submitted")
    expect(await prisma.simJob.count({ where: { submission: { characterId } } })).toBe(2)
    expect(await prisma.submission.count({ where: { characterId } })).toBe(1)
  })

  it("re-runs only the pair whose job failed", async () => {
    const { userId, characterId, simc } = await fixture()
    okResult(await submitPaste(userId, simc, GARNET))
    await prisma.simJob.updateMany({
      where: { submission: { characterId }, difficulty: "mythic" },
      data: { status: "failed" },
    })

    const again = okResult(await submitPaste(userId, simc, GARNET))
    expect(again.queued).toBe(1)

    const queued = await prisma.simJob.findMany({ where: { submission: { characterId }, status: "queued" } })
    expect(queued.map((job) => job.difficulty).toSorted()).toEqual(["heroic", "mythic"])
  })

  // An officer adding a difficulty should not require the whole roster to paste again.
  it("fills a difficulty added after the original paste", async () => {
    const { userId, characterId, simc } = await fixture()
    await prisma.settings.update({ where: { id: 1 }, data: { difficulties: "mythic" } })
    okResult(await submitPaste(userId, simc, GARNET))

    await prisma.settings.update({ where: { id: 1 }, data: { difficulties: "mythic,heroic" } })
    const again = okResult(await submitPaste(userId, simc, GARNET))

    expect(again.queued).toBe(1)
    const jobs = await prisma.simJob.findMany({ where: { submission: { characterId } } })
    expect(jobs.map((job) => job.difficulty).toSorted()).toEqual(["heroic", "mythic"])

    await prisma.settings.update({ where: { id: 1 }, data: { difficulties: "mythic,heroic" } })
  })

  it("reuses the stored paste rather than writing a second copy", async () => {
    const { userId, characterId, simc } = await fixture()
    okResult(await submitPaste(userId, simc, GARNET))
    await prisma.simJob.updateMany({ where: { submission: { characterId } }, data: { status: "failed" } })
    okResult(await submitPaste(userId, simc, GARNET))

    expect(await prisma.submission.count({ where: { characterId } })).toBe(1)
  })

  // Re-checked from the stored row, so an aged-out export cannot fill a newly added difficulty.
  it("rejects a duplicate whose stored export has since aged out", async () => {
    const { userId, characterId, simc } = await fixture()
    okResult(await submitPaste(userId, simc, GARNET))
    await prisma.simJob.updateMany({ where: { submission: { characterId } }, data: { status: "failed" } })
    await prisma.submission.updateMany({
      where: { characterId },
      data: { exportedAt: new Date("2026-01-01T00:00:00.000Z") },
    })

    expect(errMessage(await submitPaste(userId, simc, GARNET))).toContain("days old")
  })
})
