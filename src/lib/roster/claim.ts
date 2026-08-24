import type { CtxError, Result } from "ts-explicit-errors"
import { err, isErr } from "ts-explicit-errors"

import { prisma } from "#lib/db.ts"
import { requestJson } from "#lib/http.ts"
import { getSettings } from "#lib/settings.ts"

/** What a claim attempt actually did, so the pages can stop guessing. Doubles as the `?refresh=` vocabulary. */
export type ClaimStatus = "ok" | "empty" | "denied" | "stale" | "unreachable"

const CLAIM_STATUSES = new Set<string>(["ok", "empty", "denied", "stale", "unreachable"] satisfies ClaimStatus[])

export const isClaimStatus = (value: string | null): value is ClaimStatus => value !== null && CLAIM_STATUSES.has(value)

/**
 * 403 is Blizzard refusing a token carrying no `wow.profile`, which is what a raider who never granted the permission
 * looks like. 401 is a token that has aged out. Anything else is Blizzard not answering, the only one worth retrying.
 */
export const claimFailureStatus = (error: CtxError): ClaimStatus => {
  const status = error.get<number>("status")
  if (status === 403) return "denied"
  if (status === 401) return "stale"
  return "unreachable"
}

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
 * out of their own characters. `claimAndRecord` below turns the result into something a caller can act on.
 *
 * The token is passed in rather than fetched here: this module is imported by the auth config, so reaching back into it
 * would be circular.
 */
const claimCharacters = async (userId: string, accessToken: string): Promise<Result<number>> => {
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

const outcomeOf = (claimed: Result<number>): ClaimStatus => {
  if (isErr(claimed)) return claimFailureStatus(claimed)
  return claimed > 0 ? "ok" : "empty"
}

/**
 * Claims, and reports what Blizzard actually said. Every caller goes through here so the outcome is recorded without
 * anyone having to remember to.
 *
 * `scope` is deliberately never consulted: it is only what one past token response reported, and has been observed
 * reading `openid` for a token that fetches characters fine. The live answer is the only authority.
 */
export const claimAndRecord = async (userId: string, accessToken: string): Promise<ClaimStatus> => {
  const claimed = await claimCharacters(userId, accessToken)
  if (isErr(claimed)) console.error(`claim failed -> ${claimed.messageChain}`)
  const status = outcomeOf(claimed)

  // Keyed on the user rather than the provider: account linking is disabled (`auth.ts`), so there is exactly one row,
  // and this module is imported by the auth config, so importing the provider id back would be circular.
  await prisma.account.updateMany({ where: { userId }, data: { lastClaimStatus: status, lastClaimAt: new Date() } })

  return status
}
