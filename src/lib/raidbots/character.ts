import type { Result } from "ts-explicit-errors"
import { err, isErr } from "ts-explicit-errors"

import { requestJson } from "#lib/http.ts"
import { RAIDBOTS_BASE } from "#lib/raidbots/session.ts"

interface Loadout {
  active?: boolean
  talents?: { specName?: string; className?: string }
}

interface LoadResponse {
  profileCacheId?: string
  profile?: {
    identity?: {
      name?: string
      realm?: string
      region?: string
      classId?: number
      specId?: number
      /** Numeric on the wire: 0 alliance, 1 horde. The sim payload wants the string form. */
      faction?: number
      level?: number
    }
    talents?: { loadouts?: Loadout[]; lootSpec?: LootSpec }
    provenance?: { addonInfo?: AddonInfo }
  }
  error?: string
}

/** Only present for a `simc` load. Raidbots parses it out of the addon export's header comments. */
export interface AddonInfo {
  version?: string | null
  wowVersion?: string | null
  exportedAt?: string | null
  invalidChecksum?: boolean | null
}

/** `{ id, name }` when the character has a loot spec set, null when it follows the active spec. */
interface LootSpec {
  id?: number
}

export interface LoadedCharacter {
  name: string
  /** Only obtainable here -- wowaudit exposes no spec, and the wishlist keys report ids by spec name. */
  spec: string
  classId: number
  specId: number
  lootSpecId: number
  faction: string
  profileCacheId: string | undefined
}

/** Region and realm still ride along in the sim payload even when the profile comes from a paste. */
export interface ArmoryRef {
  region: string
  realm: string
  name: string
}

export interface SimcCharacter extends LoadedCharacter {
  realm: string
  region: string
  addonInfo: AddonInfo
}

const FACTIONS: Record<number, string> = { 0: "alliance", 1: "horde" }

export const resolveLootSpecId = (lootSpec: LootSpec | null | undefined, activeSpecId: number): number =>
  typeof lootSpec?.id === "number" ? lootSpec.id : activeSpecId

const load = async (cookie: string, body: unknown, simcVersion: string): Promise<Result<LoadResponse>> => {
  const url = `${RAIDBOTS_BASE}/api/character/load?locale=en_US&tool=droptimizer`
  const response = await requestJson<LoadResponse>(url, {
    method: "POST",
    headers: { cookie, "content-type": "application/json", "x-simc-version": simcVersion },
    body: JSON.stringify(body),
  })
  if (isErr(response)) return response
  if (response.error) return err(`raidbots rejected the character load: ${response.error}`, undefined)
  return response
}

const toCharacter = (response: LoadResponse, fallbackName: string): Result<LoadedCharacter> => {
  const identity = response.profile?.identity
  const loadouts = response.profile?.talents?.loadouts ?? []
  const spec = (loadouts.find((loadout) => loadout.active) ?? loadouts[0])?.talents?.specName

  if (!identity || typeof identity.classId !== "number" || typeof identity.specId !== "number" || !spec)
    return err(`raidbots returned no usable profile for ${fallbackName}`, undefined)

  return {
    name: identity.name ?? fallbackName,
    spec,
    classId: identity.classId,
    specId: identity.specId,
    lootSpecId: resolveLootSpecId(response.profile?.talents?.lootSpec, identity.specId),
    faction: FACTIONS[identity.faction ?? 1] ?? "horde",
    profileCacheId: response.profileCacheId,
  }
}

/**
 * Loads a pasted `/simc` export. Raidbots parses it server-side and hands back the same profile shape as an armory
 * load, plus the addon provenance the staleness gate needs.
 */
export const loadSimcCharacter = async (
  cookie: string,
  text: string,
  simcVersion = "weekly",
): Promise<Result<SimcCharacter>> => {
  const response = await load(cookie, { source: "simc", text }, simcVersion)
  if (isErr(response)) return err("could not load the simc export from raidbots", response)

  const character = toCharacter(response, "the pasted character")
  if (isErr(character)) return character

  const identity = response.profile?.identity
  return {
    ...character,
    realm: identity?.realm ?? "",
    region: identity?.region ?? "",
    addonInfo: response.profile?.provenance?.addonInfo ?? {},
  }
}
