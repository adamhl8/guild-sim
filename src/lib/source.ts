import type { Result } from "ts-explicit-errors"
import { err } from "ts-explicit-errors"

import { prisma } from "#lib/db.ts"
import type { ResolvedSettings } from "#lib/settings.ts"

const SEASON_SOURCE = "season"

export interface SimSource {
  raidbotsId: number
  name: string
}

/**
 * Resolves the configured source name against the synced `Source` table rather than the network, so a page render or a
 * submit never waits on Raidbots.
 */
export const resolveConfiguredSource = async (settings: ResolvedSettings): Promise<Result<SimSource>> => {
  const wanted = settings.source.trim().toLowerCase()

  const seasonTarget =
    settings.currentSeasonNumber === undefined ? undefined : `season ${String(settings.currentSeasonNumber)} raids`
  const target = wanted === SEASON_SOURCE ? seasonTarget : wanted

  if (target === undefined)
    return err(`no current season is known yet -> run a sync, or name a raid instead of "${SEASON_SOURCE}"`, undefined)

  const sources = await prisma.source.findMany({ orderBy: { name: "asc" } })
  const found = sources.find((source) => source.name.toLowerCase() === target)
  if (found) return { raidbotsId: found.raidbotsId, name: found.name }

  const available = sources.map((source) => `"${source.name}"`).join(", ")
  return err(`unknown source "${settings.source}" -> expected "${SEASON_SOURCE}" or one of ${available}`, undefined)
}
