import type { Result } from "ts-explicit-errors"
import { err, isErr } from "ts-explicit-errors"

import { env } from "#env.ts"
import type { RosterCharacter, Submission } from "#generated/prisma/client.ts"
import { prisma } from "#lib/db.ts"
import { loadSimcCharacter } from "#lib/raidbots/character.ts"
import { getSession } from "#lib/raidbots/session.ts"
import { getSettings } from "#lib/settings.ts"
import type { ResolvedSettings } from "#lib/settings.ts"
import { contentHash } from "#lib/simc.ts"
import type { SimSource } from "#lib/source.ts"
import { resolveConfiguredSource } from "#lib/source.ts"
import { stalenessRejection } from "#lib/staleness.ts"
import { realmSlug } from "#lib/wowaudit/characters.ts"

export interface SubmitResult {
  submissionId: number
  characterName: string
  /** Zero when the paste was already covered, which the UI reports differently from a failure. */
  queued: number
}

/** A pair is covered while its job is pending or done. A failed or skipped job is not, so it can re-run. */
const COVERED_STATUSES = ["queued", "running", "uploading", "done"]

/** Difficulties with no covered job for this exact paste. Empty means there is nothing to do. */
const missingDifficulties = async (input: {
  characterId: number
  hash: string
  gemId: number
  source: SimSource
  settings: ResolvedSettings
}): Promise<string[]> => {
  const covered = await prisma.simJob.findMany({
    where: {
      status: { in: COVERED_STATUSES },
      sourceId: input.source.raidbotsId,
      // The gem is part of the identity of the work: the same gear with a different gem is a different
      // sim, so changing it must not be mistaken for a duplicate.
      submission: { characterId: input.characterId, contentHash: input.hash, gemId: input.gemId },
    },
    select: { difficulty: true },
  })

  const seen = new Set(covered.map((job) => job.difficulty))
  return input.settings.difficulties.filter((difficulty) => !seen.has(difficulty))
}

const queueJobs = async (submissionId: number, source: SimSource, difficulties: string[]): Promise<void> => {
  await prisma.simJob.createMany({
    data: difficulties.map((difficulty) => ({
      submissionId,
      sourceId: source.raidbotsId,
      sourceName: source.name,
      difficulty,
    })),
  })
}

const ALREADY_COVERED = "you have already submitted this export -> run /simc again after your gear changes"

interface ResubmitInput {
  previous: Submission & { character: RosterCharacter }
  hash: string
  gemId: number
  source: SimSource
  settings: ResolvedSettings
}

/**
 * The paste is one we have already stored, so the character is known without asking Raidbots and only the gaps need
 * queueing.
 */
const resubmit = async (input: ResubmitInput): Promise<Result<SubmitResult>> => {
  const { previous, source, settings } = input

  // Re-checked from the stored provenance rather than skipped: an export that has since aged out must
  // not slip back in to fill a newly added difficulty.
  const stale = stalenessRejection({
    addonInfo: { wowVersion: previous.wowVersion, exportedAt: previous.exportedAt?.toISOString() ?? null },
    liveWowBuild: settings.liveWowBuild,
    buildCheck: settings.buildCheck,
    maxPasteAgeDays: settings.maxPasteAgeDays,
    now: Date.now(),
  })
  if (stale) return err(stale, undefined)

  const missing = await missingDifficulties({
    characterId: previous.characterId,
    hash: input.hash,
    gemId: input.gemId,
    source,
    settings,
  })
  if (missing.length === 0) return err(ALREADY_COVERED, undefined)

  await queueJobs(previous.id, source, missing)
  return {
    submissionId: previous.id,
    characterName: `${previous.character.name}-${previous.character.realm}`,
    queued: missing.length,
  }
}

/**
 * Accepts a SimC paste for a character the signed-in user owns.
 *
 * Ownership is enforced here rather than at login: signing in proves which characters the account owns, but this is
 * where a paste is bound to one of them.
 */
export const submitPaste = async (
  userId: string,
  simcText: string,
  gemItemId: number,
): Promise<Result<SubmitResult>> => {
  const text = simcText.trim()
  if (!text) return err("paste your /simc output first", undefined)

  const settings = await getSettings()
  const hash = contentHash(text)
  const gemId = gemItemId

  const source = await resolveConfiguredSource(settings)
  if (isErr(source)) return err("the configured source is invalid -> tell an officer", source)

  // A refresh replays the same bytes, so recognising the paste here means a duplicate costs one indexed
  // query rather than a Raidbots round trip. The prior row also tells us the character.
  const previous = await prisma.submission.findFirst({
    where: { contentHash: hash, gemId, character: { claims: { some: { userId } } } },
    include: { character: true },
    orderBy: { createdAt: "desc" },
  })

  if (previous) return resubmit({ previous, hash, gemId, source, settings })

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

  const exportedAt = character.addonInfo.exportedAt ? new Date(character.addonInfo.exportedAt) : null
  const submission = await prisma.submission.create({
    data: {
      userId,
      characterId: match.characterId,
      simcText: text,
      contentHash: hash,
      gemId,
      spec: character.spec,
      addonVersion: character.addonInfo.version ?? null,
      wowVersion: character.addonInfo.wowVersion ?? null,
      exportedAt: exportedAt && !Number.isNaN(exportedAt.getTime()) ? exportedAt : null,
    },
  })

  // Remembered on the character so the picker pre-selects it next time and a requeue keeps it.
  if (gemId !== match.character.preferredGemId)
    await prisma.rosterCharacter.update({ where: { id: match.characterId }, data: { preferredGemId: gemId } })

  await queueJobs(submission.id, source, settings.difficulties)

  return {
    submissionId: submission.id,
    characterName: `${match.character.name}-${match.character.realm}`,
    queued: settings.difficulties.length,
  }
}
