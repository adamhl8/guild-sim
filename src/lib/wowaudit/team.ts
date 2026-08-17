import type { Result } from "ts-explicit-errors"
import { err, isErr } from "ts-explicit-errors"

import type { WowauditClient } from "#lib/wowaudit/client.ts"

interface TeamResponse {
  id: number
  name: string
  guild_name: string
  url: string
}

export interface Team {
  id: number
  name: string
  guildName: string
  /** Roster characters carry no region of their own, so the team's is the only source. */
  region: string
}

const REGION_PATTERN = /\/guild\/(?<region>[a-z]{2})\//v

export const getTeam = async (client: WowauditClient): Promise<Result<Team>> => {
  const response = await client.get<TeamResponse>("/team")
  if (isErr(response)) return err("could not fetch wowaudit team", response)

  const region = REGION_PATTERN.exec(response.url)?.groups?.["region"]
  if (!region) return err(`could not read region from team url: ${response.url}`, undefined)

  return { id: response.id, name: response.name, guildName: response.guild_name, region }
}
