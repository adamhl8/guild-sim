import type { Result } from "ts-explicit-errors"
import { err, isErr } from "ts-explicit-errors"

import type { Instance } from "#lib/raidbots/static-data.ts"
import { staticData } from "#lib/raidbots/static-data.ts"
import type { Difficulty } from "#lib/settings.ts"

export interface UpgradeStep {
  group: number
  level: number
  max: number
  name: string
  fullName: string
  bonusId: number
  itemLevel: number
  seasonId?: number
}

export interface Season {
  id: number
  name: string
  active?: boolean
  bonusListGroups?: number[]
}

/**
 * The gear track each raid difficulty drops. wowaudit validates the report against this and rejects a mismatch
 * ("Uploaded reports must be set to Champion 6/6 upgrades"), so it is not a preference.
 *
 * Exhaustive over Difficulty on purpose: a new difficulty should fail to compile rather than silently inherit whichever
 * track happened to be last.
 */
const TRACK_FOR: Record<Difficulty, string> = {
  lfr: "Veteran",
  normal: "Champion",
  heroic: "Hero",
  mythic: "Myth",
}

interface UpgradeTrack {
  bonusId: number
  itemLevel: number
  fullName: string
  seasonId: number
}

const SEASON_RAIDS_PATTERN = /^Season (?<n>\d+) Raids$/v

/** Each track has its own bonus list group, holding exactly one step at `level === max`. */
export const topStepFor = (
  season: Season,
  sets: Record<string, UpgradeStep[]>,
  track: string,
): UpgradeStep | undefined => {
  for (const group of season.bonusListGroups ?? []) {
    const steps = sets[String(group)] ?? []
    const top = steps.find((step) => step.name === track && step.level === step.max)
    if (top) return top
  }
  return undefined
}

/** `-91 "Season 1 Raids"` / `-102 "Season 2 Raids"` enumerate each season's raid encounters. */
export const seasonNumberForInstance = (instances: Instance[], instanceId: number): number | undefined => {
  const target = instances.find((instance) => instance.id === instanceId)
  const encounters = (target?.encounters ?? []).map((encounter) => encounter.id)
  if (encounters.length === 0) return undefined

  for (const pseudo of instances) {
    const match = SEASON_RAIDS_PATTERN.exec(pseudo.name)
    if (pseudo.id >= 0 || !match?.groups?.["n"]) continue
    const members = new Set((pseudo.encounters ?? []).map((encounter) => encounter.id))
    if (encounters.every((id) => members.has(id))) return Number(match.groups["n"])
  }
  return undefined
}

/** Season names are `<Expansion> Season <n>`, so the active season supplies the expansion prefix. */
export const seasonByNumber = (seasons: Season[], active: Season, n: number): Season | undefined => {
  const prefix = active.name.replace(/\s*Season \d+$/v, "")
  return seasons.find((season) => season.name === `${prefix} Season ${n}` && (season.bonusListGroups?.length ?? 0) > 0)
}

export interface UpgradeResolver {
  forInstance: (instanceId: number, difficulty: Difficulty) => Promise<Result<UpgradeTrack>>
}

/**
 * Wowaudit rejects any report whose upgrade track does not match its difficulty, and the bonus id for a track differs
 * per season. Raidbots can be a season ahead of wowaudit (it was on 2026-08-11), so the season is resolved from the
 * instance rather than from what is active.
 */
export const createUpgradeResolver = (): UpgradeResolver => {
  const cache = new Map<string, UpgradeTrack>()

  const resolve = async (instanceId: number, difficulty: Difficulty): Promise<Result<UpgradeTrack>> => {
    const instances = await staticData<Instance[]>("instances")
    if (isErr(instances)) return instances
    const seasonsRaw = await staticData<Season[] | { seasons?: Season[] }>("seasons")
    if (isErr(seasonsRaw)) return seasonsRaw
    const sets = await staticData<Record<string, UpgradeStep[]>>("bonus-upgrade-sets")
    if (isErr(sets)) return sets

    const seasons = Array.isArray(seasonsRaw) ? seasonsRaw : (seasonsRaw.seasons ?? [])
    const active = seasons.find((season) => season.active)
    if (!active) return err("raidbots reported no active season", undefined)

    const n = seasonNumberForInstance(instances, instanceId)
    const season = (n === undefined ? undefined : seasonByNumber(seasons, active, n)) ?? active
    const track = TRACK_FOR[difficulty]
    const step = topStepFor(season, sets, track)
    if (!step) {
      return err(`no ${track} upgrade track for season ${season.id} (instance ${instanceId})`, undefined).ctx({
        instanceId,
        difficulty,
      })
    }

    return { bonusId: step.bonusId, itemLevel: step.itemLevel, fullName: step.fullName, seasonId: season.id }
  }

  return {
    forInstance: async (instanceId, difficulty) => {
      const key = `${String(instanceId)}:${difficulty}`
      const cached = cache.get(key)
      if (cached) return cached
      const resolved = await resolve(instanceId, difficulty)
      if (isErr(resolved)) return resolved
      cache.set(key, resolved)
      return resolved
    },
  }
}
