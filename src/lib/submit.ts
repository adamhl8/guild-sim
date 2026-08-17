import type { Result } from "ts-explicit-errors"
import { err, isErr } from "ts-explicit-errors"

import { env } from "#env.ts"
import { prisma } from "#lib/db.ts"
import { loadSimcCharacter } from "#lib/raidbots/character.ts"
import { getSession } from "#lib/raidbots/session.ts"
import { getSettings } from "#lib/settings.ts"
import { resolveConfiguredSource } from "#lib/source.ts"
import { stalenessRejection } from "#lib/staleness.ts"
import { realmSlug } from "#lib/wowaudit/characters.ts"

export interface SubmitResult {
  submissionId: number
  characterName: string
  jobCount: number
}

/**
 * Accepts a SimC paste for a character the signed-in user owns.
 *
 * Ownership is enforced here rather than at login: signing in proves which characters the account owns, but this is
 * where a paste is bound to one of them.
 */
export const submitPaste = async (userId: string, simcText: string): Promise<Result<SubmitResult>> => {
  const text = simcText.trim()
  if (!text) return err("paste your /simc output first", undefined)

  const settings = await getSettings()

  const cookie = await getSession({ email: env.RAIDBOTS_EMAIL, password: env.RAIDBOTS_PASSWORD })
  if (isErr(cookie)) return err("could not reach raidbots -> tell an officer", cookie)

  const character = await loadSimcCharacter(cookie, text, settings.sim.simcVersion)
  if (isErr(character))
    return err("raidbots could not read that paste -> make sure you copied the whole /simc output", character)

  const stale = stalenessRejection({
    addonInfo: character.addonInfo,
    liveWowBuild: settings.liveWowBuild,
    buildCheck: settings.buildCheck,
    maxPasteAgeDays: settings.maxPasteAgeDays,
    now: Date.now(),
  })
  if (stale) return err(stale, undefined)

  const claims = await prisma.characterClaim.findMany({
    where: { userId },
    include: { character: true },
  })

  const slug = realmSlug(character.realm)
  const match = claims.find(
    (claim) =>
      claim.character.name.toLowerCase() === character.name.toLowerCase() && realmSlug(claim.character.realm) === slug,
  )
  if (!match) {
    const owned = claims.map((claim) => `${claim.character.name}-${claim.character.realm}`).join(", ")
    return err(
      owned
        ? `${character.name}-${character.realm} is not one of your roster characters (${owned})`
        : `${character.name}-${character.realm} is not on the roster`,
      undefined,
    )
  }

  if (match.character.unsupportedSpec === character.spec)
    return err(`raidbots cannot sim ${character.spec}, so there is nothing to upload`, undefined)

  const source = await resolveConfiguredSource(settings)
  if (isErr(source)) return err("the configured source is invalid -> tell an officer", source)

  const exportedAt = character.addonInfo.exportedAt ? new Date(character.addonInfo.exportedAt) : null
  const submission = await prisma.submission.create({
    data: {
      userId,
      characterId: match.characterId,
      simcText: text,
      spec: character.spec,
      addonVersion: character.addonInfo.version ?? null,
      wowVersion: character.addonInfo.wowVersion ?? null,
      exportedAt: exportedAt && !Number.isNaN(exportedAt.getTime()) ? exportedAt : null,
      jobs: {
        create: settings.difficulties.map((difficulty) => ({
          sourceId: source.raidbotsId,
          sourceName: source.name,
          difficulty,
        })),
      },
    },
    include: { jobs: true },
  })

  return {
    submissionId: submission.id,
    characterName: `${match.character.name}-${match.character.realm}`,
    jobCount: submission.jobs.length,
  }
}
