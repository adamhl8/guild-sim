import { prisma } from "#lib/db.ts"

/** The names wowaudit uses. Raidbots wants them prefixed with `raid-`, which happens in the payload. */
export const DIFFICULTIES = ["lfr", "normal", "heroic", "mythic"] as const
export type Difficulty = (typeof DIFFICULTIES)[number]

/**
 * Display only. The lowercase token is a wire value everywhere else: slot keys, the job column, this setting's stored
 * CSV, and the Raidbots payload.
 */
export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  lfr: "LFR",
  normal: "Normal",
  heroic: "Heroic",
  mythic: "Mythic",
}

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
  adminRanks: string[]
  source: string
  difficulties: Difficulty[]
  sim: SimOptions
  runner: { submitsPerHour: number; pollIntervalMs: number }
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
  // upsert rather than find-then-create: the sync and an early request can reach this concurrently.
  const row = await prisma.settings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } })

  const iterations = Number(row.iterations)

  return {
    wowaudit: {
      configurationName: row.wowauditConfigurationName,
      replaceManualEdits: row.replaceManualEdits,
    },
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
