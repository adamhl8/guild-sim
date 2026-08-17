import type { Result } from "ts-explicit-errors"
import { err, isErr } from "ts-explicit-errors"

import type { WowauditClient } from "#lib/wowaudit/client.ts"

interface CharacterResponse {
  id: number
  name: string
  realm: string
  class: string
  role: string
  rank: string
  status: string
  blizzard_id: string | null
}

export interface Character {
  id: number
  name: string
  realm: string
  class: string
  role: string
  rank: string
  /** Blizzard's `{realmId}-{characterId}`. The join key to a Battle.net account's owned characters. */
  blizzardId: string
}

/** Wowaudit slugs realms for its own URLs, but Raidbots wants the armory form. */
export const realmSlug = (realm: string): string => realm.toLowerCase().replaceAll("'", "").replaceAll(/\s+/gv, "-")

export const getCharacters = async (client: WowauditClient): Promise<Result<Character[]>> => {
  const response = await client.get<CharacterResponse[]>("/characters")
  if (isErr(response)) return err("could not fetch wowaudit roster", response)
  if (!Array.isArray(response)) return err("unexpected wowaudit roster response: expected an array", undefined)

  return response
    .filter((character) => character.status === "tracking" && character.blizzard_id)
    .map((character) => ({
      id: character.id,
      name: character.name,
      realm: character.realm,
      class: character.class,
      role: character.role,
      rank: character.rank,
      blizzardId: character.blizzard_id ?? "",
    }))
}
