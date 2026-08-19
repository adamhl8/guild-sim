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

/**
 * Wowaudit slugs realms for its own URLs, but Raidbots wants the armory form.
 *
 * Underscores count as separators alongside spaces: wowaudit stores "Area 52" while SimC writes "area_52", and both
 * have to reach "area-52" or ownership matching rejects the raider's own character. Apostrophes are removed rather than
 * folded into that class, because Blizzard drops them: "Zul'jin" is "zuljin", not "zul-jin".
 */
export const realmSlug = (realm: string): string =>
  realm
    .toLowerCase()
    .replaceAll("'", "")
    .replaceAll(/[\s_]+/gv, "-")

/**
 * `temporarily_unavailable` means wowaudit could not refresh the character from Blizzard, not that the team dropped
 * them: the row keeps its `blizzard_id` and `tracking_since`. Excluding it is not a display bug -- `sync.ts` deletes
 * every roster row missing from this list, cascading through the raider's claims into their stored pastes. An allowlist
 * rather than "anything with an id", because being on the roster is what authorises submitting.
 */
const ROSTERED_STATUSES: ReadonlySet<string> = new Set(["tracking", "temporarily_unavailable"])

/** On the team roster and joinable to a Battle.net account. `blizzardId` is that join key, so it is required. */
export const isRostered = (status: string, blizzardId: string | null): boolean =>
  ROSTERED_STATUSES.has(status) && Boolean(blizzardId)

export const getCharacters = async (client: WowauditClient): Promise<Result<Character[]>> => {
  const response = await client.get<CharacterResponse[]>("/characters")
  if (isErr(response)) return err("could not fetch wowaudit roster", response)
  if (!Array.isArray(response)) return err("unexpected wowaudit roster response: expected an array", undefined)

  return response
    .filter((character) => isRostered(character.status, character.blizzard_id))
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
