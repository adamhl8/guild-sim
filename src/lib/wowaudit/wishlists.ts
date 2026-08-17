import type { Result } from "ts-explicit-errors"
import { err, isErr } from "ts-explicit-errors"

import { serverMessage } from "#lib/http.ts"
import type { WowauditClient } from "#lib/wowaudit/client.ts"

/**
 * The live response nests `characters[].instances[]` directly, while the docs show an extra `characters[].wishlists[]`
 * layer and a doubled `wishlist.wishlist`. The extra layer likely appears once a team has more than one droptimizer
 * configuration, so both shapes are walked.
 */
interface RawWishlist {
  report_id?: Record<string, string | null>
  updated_at?: Record<string, string | null>
  wishlist?: RawWishlist
}

interface RawDifficulty {
  difficulty?: string
  wishlist?: RawWishlist
}

interface RawContainer {
  instances?: { id?: number; difficulties?: RawDifficulty[] }[]
}

interface RawCharacter extends RawContainer {
  id?: number
  wishlists?: RawContainer[]
}

export interface WishlistsResponse {
  characters?: RawCharacter[]
}

interface WishlistEntry {
  reportId: string
  updatedAt: string | undefined
}

/** A character holds one droptimizer per (instance, difficulty, spec), so all four identify an entry. */
interface WishlistKey {
  characterId: number
  instanceId: number
  difficulty: string
  spec: string
}

const entryKey = (key: WishlistKey): string =>
  `${key.characterId}|${key.instanceId}|${key.difficulty.toLowerCase()}|${key.spec.toLowerCase()}`

export interface WishlistIndex {
  find: (key: WishlistKey) => WishlistEntry | undefined
  size: number
}

type Entries = Map<string, WishlistEntry>

const readDifficulty = (
  entries: Entries,
  ids: Pick<WishlistKey, "characterId" | "instanceId">,
  raw: RawDifficulty,
): void => {
  const wishlist = raw.wishlist?.wishlist ?? raw.wishlist
  if (!raw.difficulty || !wishlist?.report_id) return

  for (const [spec, reportId] of Object.entries(wishlist.report_id)) {
    if (!reportId) continue
    entries.set(entryKey({ ...ids, difficulty: raw.difficulty, spec }), {
      reportId,
      updatedAt: wishlist.updated_at?.[spec] ?? undefined,
    })
  }
}

const readContainer = (entries: Entries, characterId: number, container: RawContainer): void => {
  for (const instance of container.instances ?? []) {
    const instanceId = instance.id
    if (typeof instanceId !== "number") continue
    for (const difficulty of instance.difficulties ?? [])
      readDifficulty(entries, { characterId, instanceId }, difficulty)
  }
}

export const buildWishlistIndex = (response: WishlistsResponse): WishlistIndex => {
  const entries: Entries = new Map()

  for (const character of response.characters ?? []) {
    const characterId = character.id
    if (typeof characterId !== "number") continue
    for (const container of character.wishlists ?? [character]) readContainer(entries, characterId, container)
  }

  return { find: (key) => entries.get(entryKey(key)), size: entries.size }
}

export interface WishlistUpload {
  reportId: string
  configurationName: string
  characterId: number
  characterName: string
  replaceManualEdits: boolean
}

/** Wowaudit fetches the report from Raidbots itself, so only the bare report id is sent. */
export const uploadWishlist = async (client: WowauditClient, upload: WishlistUpload): Promise<Result> => {
  const response = await client.post<{ created?: boolean }>("/wishlists", {
    report_id: upload.reportId,
    configuration_name: upload.configurationName,
    character_id: upload.characterId,
    character_name: upload.characterName,
    replace_manual_edits: upload.replaceManualEdits,
  })
  if (isErr(response)) {
    return err(
      `wowaudit rejected report ${upload.reportId} for ${upload.characterName}${serverMessage(response)}`,
      response,
    )
  }

  if (response.created !== true)
    return err(`wowaudit rejected report ${upload.reportId} for ${upload.characterName}`, undefined).ctx({ response })

  return undefined
}
