import type { Result } from "ts-explicit-errors"
import { err, isErr } from "ts-explicit-errors"

import { prisma } from "#lib/db.ts"
import { requestJson } from "#lib/http.ts"
import { getSettings } from "#lib/settings.ts"

interface ProfileCharacter {
  id?: number
  realm?: { id?: number }
}

interface ProfileSummary {
  wow_accounts?: { characters?: ProfileCharacter[] }[]
}

/**
 * Wowaudit stores `blizzard_id` as `{realmId}-{characterId}`, which is exactly how Blizzard keys a protected character.
 * Building the same string from the profile API is what proves ownership.
 */
export const blizzardId = (character: ProfileCharacter): string | undefined => {
  const realmId = character.realm?.id
  const characterId = character.id
  if (typeof realmId !== "number" || typeof characterId !== "number") return undefined
  return `${String(realmId)}-${String(characterId)}`
}

export const blizzardIdsFrom = (summary: ProfileSummary): string[] => {
  const characters = (summary.wow_accounts ?? []).flatMap((account) => account.characters ?? [])
  return characters.map((character) => blizzardId(character)).filter((id): id is string => id !== undefined)
}

const fetchOwnedBlizzardIds = async (accessToken: string, region: string): Promise<Result<string[]>> => {
  const url = `https://${region}.api.blizzard.com/profile/user/wow?namespace=profile-${region}&locale=en_US`
  const summary = await requestJson<ProfileSummary>(url, {
    headers: { authorization: `Bearer ${accessToken}` },
  })
  if (isErr(summary)) return err("could not read the battle.net wow profile", summary)

  return blizzardIdsFrom(summary)
}

/**
 * Records which roster characters a Battle.net account owns, returning how many were claimed. Re-run on every login, so
 * a roster change or a newly levelled alt is picked up without the raider doing anything.
 *
 * A failed lookup leaves the existing claims alone rather than wiping them, so a Battle.net outage cannot lock a raider
 * out of their own characters. Callers decide what to say about it: the refresh button reports it, the login hook
 * logs.
 *
 * The token is passed in rather than fetched here: this module is imported by the auth config, so reaching back into it
 * would be circular.
 */
export const claimCharacters = async (userId: string, accessToken: string): Promise<Result<number>> => {
  const settings = await getSettings()

  const owned = await fetchOwnedBlizzardIds(accessToken, settings.region)
  if (isErr(owned)) return err(`could not resolve characters for ${userId}`, owned)

  const characters = await prisma.rosterCharacter.findMany({ where: { blizzardId: { in: owned } } })

  await prisma.$transaction([
    prisma.characterClaim.deleteMany({ where: { userId } }),
    prisma.characterClaim.createMany({
      data: characters.map((character) => ({ userId, characterId: character.id })),
    }),
  ])

  return characters.length
}
