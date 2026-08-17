import { prisma } from "#lib/db.ts"

/** The names wowaudit uses. Raidbots wants them prefixed with `raid-`, which happens in the payload. */
export const DIFFICULTIES = ["lfr", "normal", "heroic", "mythic"] as const
export type Difficulty = (typeof DIFFICULTIES)[number]

/** How strictly a paste's WoW build must match the live one. */
export const BUILD_CHECKS = ["exact", "patch", "off"] as const
export type BuildCheck = (typeof BUILD_CHECKS)[number]

export interface SimOptions {
  simcVersion: "weekly" | "nightly" | "latest"
  iterations: "smart" | number
  fightStyle: string
  fightLength: number
  enemyCount: number
}

export interface ResolvedSettings {
  wowaudit: { configurationName: string; replaceManualEdits: boolean }
  ranks: string[]
  adminRanks: string[]
  source: string
  difficulties: Difficulty[]
  sim: SimOptions
  runner: { concurrency: number; submitsPerHour: number; pollIntervalMs: number }
  buildCheck: BuildCheck
  maxPasteAgeDays: number
  liveWowBuild: string | undefined
  region: string
  currentSeasonNumber: number | undefined
}

const DIFFICULTY_SET: ReadonlySet<string> = new Set(DIFFICULTIES)
const BUILD_CHECK_SET: ReadonlySet<string> = new Set(BUILD_CHECKS)

const splitList = (value: string): string[] =>
  value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)

export const isDifficulty = (value: string): value is Difficulty => DIFFICULTY_SET.has(value)
const isBuildCheck = (value: string): value is BuildCheck => BUILD_CHECK_SET.has(value)

const isSimcVersion = (value: string): value is SimOptions["simcVersion"] =>
  value === "weekly" || value === "nightly" || value === "latest"

/** Lazily creates the single settings row, so a fresh database boots with working defaults. */
export const getSettings = async (): Promise<ResolvedSettings> => {
  const row =
    (await prisma.settings.findUnique({ where: { id: 1 } })) ?? (await prisma.settings.create({ data: { id: 1 } }))

  const iterations = Number(row.iterations)

  return {
    wowaudit: {
      configurationName: row.wowauditConfigurationName,
      replaceManualEdits: row.replaceManualEdits,
    },
    ranks: splitList(row.ranks),
    adminRanks: splitList(row.adminRanks),
    source: row.source,
    difficulties: splitList(row.difficulties).filter(isDifficulty),
    sim: {
      simcVersion: isSimcVersion(row.simcVersion) ? row.simcVersion : "weekly",
      iterations: Number.isFinite(iterations) && iterations > 0 ? iterations : "smart",
      fightStyle: row.fightStyle,
      fightLength: row.fightLength,
      enemyCount: row.enemyCount,
    },
    runner: {
      concurrency: row.concurrency,
      submitsPerHour: row.submitsPerHour,
      pollIntervalMs: row.pollIntervalMs,
    },
    buildCheck: isBuildCheck(row.buildCheck) ? row.buildCheck : "exact",
    maxPasteAgeDays: row.maxPasteAgeDays,
    liveWowBuild: row.liveWowBuild ?? undefined,
    region: row.region,
    currentSeasonNumber: row.currentSeasonNumber ?? undefined,
  }
}

export const updateSettings = async (data: Record<string, unknown>): Promise<void> => {
  await prisma.settings.upsert({ where: { id: 1 }, update: data, create: { id: 1, ...data } })
}
