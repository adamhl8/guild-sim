import type { Result } from "ts-explicit-errors"
import { err, isErr } from "ts-explicit-errors"

import type { WowauditClient } from "#lib/wowaudit/client.ts"

interface PeriodResponse {
  current_period: number
  current_season?: {
    id: number
    name: string
    metadata?: {
      instances?: {
        id: number
        name: string
        droptimizerId: number
        raidSize: number
        encounters?: { id: number; name: string }[]
      }[]
    }
  }
}

interface Instance {
  /** Wowaudit's own instance id, used when reading wishlist state. */
  wowauditId: number
  /** Wowaudit's `droptimizerId` is the Raidbots instance id verbatim. */
  raidbotsId: number
  name: string
  encounters: { id: number; name: string }[]
}

export interface Season {
  id: number
  name: string
  instances: Instance[]
}

/** Driving the raid list off the current season means new tiers appear without a code change. */
export const getSeason = async (client: WowauditClient): Promise<Result<Season>> => {
  const response = await client.get<PeriodResponse>("/period")
  if (isErr(response)) return err("could not fetch wowaudit period", response)

  const season = response.current_season
  const instances = season?.metadata?.instances
  if (!season || !instances || instances.length === 0)
    return err("wowaudit returned no instances for the current season", undefined)

  return {
    id: season.id,
    name: season.name,
    instances: instances.map((instance) => ({
      wowauditId: instance.id,
      raidbotsId: instance.droptimizerId,
      name: instance.name,
      encounters: instance.encounters ?? [],
    })),
  }
}
