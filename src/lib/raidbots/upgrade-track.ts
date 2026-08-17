import type { Result } from "ts-explicit-errors"
import { err, isErr } from "ts-explicit-errors"

import type { Instance } from "#lib/raidbots/static-data.ts"
import { staticData } from "#lib/raidbots/static-data.ts"

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

interface MythTrack {
  bonusId: number
  itemLevel: number
  fullName: string
  seasonId: number
}

const SEASON_RAIDS_PATTERN = /^Season (?<n>\d+) Raids$/v

export const mythStepFor = (season: Season, sets: Record<string, UpgradeStep[]>): UpgradeStep | undefined => {
  for (const group of season.bonusListGroups ?? []) {
    const steps = sets[String(group)] ?? []
    const top = steps.find((step) => step.name === "Myth" && step.level === step.max)
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
  forInstance: (instanceId: number) => Promise<Result<MythTrack>>
}

/**
 * Wowaudit rejects any report not simmed at Myth 6/6, and that bonus id differs per season. Raidbots can be a season
 * ahead of wowaudit (it was on 2026-08-11), so the season is resolved from the instance rather than from what is
 * active.
 */
export const createUpgradeResolver = (): UpgradeResolver => {
  const cache = new Map<number, MythTrack>()

  const resolve = async (instanceId: number): Promise<Result<MythTrack>> => {
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
    const step = mythStepFor(season, sets)
    if (!step) {
      return err(`no Myth upgrade track for season ${season.id} (instance ${instanceId})`, undefined).ctx({
        instanceId,
      })
    }

    return { bonusId: step.bonusId, itemLevel: step.itemLevel, fullName: step.fullName, seasonId: season.id }
  }

  return {
    forInstance: async (instanceId) => {
      const cached = cache.get(instanceId)
      if (cached) return cached
      const resolved = await resolve(instanceId)
      if (isErr(resolved)) return resolved
      cache.set(instanceId, resolved)
      return resolved
    },
  }
}
