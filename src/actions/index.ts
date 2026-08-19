import { z } from "astro/zod"
import { ActionError, defineAction } from "astro:actions"
import { isErr } from "ts-explicit-errors"

import { prisma } from "#lib/db.ts"
import { DIFFICULTIES, getSettings, updateSettings } from "#lib/settings.ts"
import { parseSlotKey } from "#lib/slots.ts"
import { resolveConfiguredSource } from "#lib/source.ts"
import { submitPaste } from "#lib/submit.ts"
import { runSync } from "#lib/sync.ts"

const requireUser = (locals: App.Locals): string => {
  const userId = locals.user?.id
  if (!userId) throw new ActionError({ code: "UNAUTHORIZED", message: "sign in first" })
  return userId
}

const requireAdmin = (locals: App.Locals): void => {
  requireUser(locals)
  if (!locals.isAdmin) throw new ActionError({ code: "FORBIDDEN", message: "officers only" })
}

const plural = (count: number, noun: string): string => `${String(count)} ${noun}${count === 1 ? "" : "s"}`

/** Anything else is silently read back as "smart", so a typo would look saved without being it. */
const isIterations = (value: string): boolean => value === "smart" || /^[1-9]\d*$/v.test(value)

/**
 * Nobody can reach this page again once no admin rank matches a rank someone holds, and undoing that means editing
 * SQLite inside the container. Handing off is still fine: add the new rank before dropping your own.
 */
const requireStillAdmin = (locals: App.Locals, ranks: string[]): void => {
  const allowed = new Set(ranks.map((rank) => rank.toLowerCase()))
  if (locals.characters.some((character) => allowed.has(character.rank.toLowerCase()))) return

  throw new ActionError({
    code: "BAD_REQUEST",
    message: "that would remove your own admin access -- keep a rank one of your characters holds",
  })
}

/** A job in one of these states will produce the result on its own, so queueing another only spends quota twice. */
const ACTIVE_STATUSES = ["queued", "running", "uploading"]

const difficultyName = z.enum([...DIFFICULTIES])
const adminRanks = z.array(z.string().min(1)).min(1, "pick at least one rank")
const difficulties = z.array(difficultyName).min(1, "pick at least one difficulty")

export const server = {
  submitSimc: defineAction({
    accept: "form",
    input: z.object({ simc: z.string(), gem: z.coerce.number().int().positive() }),
    handler: async ({ simc, gem }, context) => {
      const userId = requireUser(context.locals)

      const result = await submitPaste(userId, simc, gem)
      // The message is written for the raider, so it is surfaced verbatim rather than swallowed.
      if (isErr(result)) throw new ActionError({ code: "BAD_REQUEST", message: result.message })

      return { message: `Queued ${plural(result.queued, "sim")} for ${result.characterName}.` }
    },
  }),

  updateSettings: defineAction({
    accept: "form",
    input: z.object({
      wowauditConfigurationName: z.string().min(1),
      adminRanks,
      source: z.string().min(1),
      difficulties,
      simcVersion: z.enum(["weekly", "nightly", "latest"]),
      iterations: z.string().refine(isIterations, "must be `smart` or a whole number"),
      fightStyle: z.string().min(1),
      fightLength: z.coerce.number().int().positive(),
      enemyCount: z.coerce.number().int().positive(),
      submitsPerHour: z.coerce.number().int().positive(),
      pollIntervalMs: z.coerce.number().int().positive(),
      buildCheck: z.enum(["exact", "patch", "off"]),
      maxPasteAgeDays: z.coerce.number().int().positive(),
      replaceManualEdits: z.coerce.boolean(),
    }),
    handler: async (input, context) => {
      requireAdmin(context.locals)
      requireStillAdmin(context.locals, input.adminRanks)

      // The row stores both as comma-separated text, and updateSettings writes these fields straight through.
      await updateSettings({
        ...input,
        adminRanks: input.adminRanks.join(","),
        difficulties: input.difficulties.join(","),
      })

      // Fail loudly here rather than at the next submit, when a raider would be the one to see it.
      const settings = await getSettings()
      const source = await resolveConfiguredSource(settings)
      if (isErr(source)) throw new ActionError({ code: "BAD_REQUEST", message: source.message })

      return { message: `Saved. Source resolves to ${source.name}.` }
    },
  }),

  requeueAll: defineAction({
    accept: "form",
    input: z.object({}),
    handler: async (_input, context) => {
      requireAdmin(context.locals)

      const settings = await getSettings()
      const source = await resolveConfiguredSource(settings)
      if (isErr(source)) throw new ActionError({ code: "BAD_REQUEST", message: source.message })

      // Latest paste per character: an older one would sim gear the raider has already replaced.
      const characters = await prisma.rosterCharacter.findMany({
        where: { unsupportedSpec: null },
        include: { submissions: { orderBy: { createdAt: "desc" }, take: 1 } },
      })

      const latest = characters.flatMap((character) => character.submissions)
      const active = await prisma.simJob.findMany({
        where: { submissionId: { in: latest.map((submission) => submission.id) }, status: { in: ACTIVE_STATUSES } },
        select: { submissionId: true, difficulty: true },
      })

      // Re-running a done slot is the point of this button; re-running one already in flight is not, so a
      // second click costs nothing.
      const inFlight = new Set(active.map((job) => `${String(job.submissionId)}:${job.difficulty}`))
      const data = latest.flatMap((submission) =>
        settings.difficulties
          .filter((difficulty) => !inFlight.has(`${String(submission.id)}:${difficulty}`))
          .map((difficulty) => ({
            submissionId: submission.id,
            sourceId: source.raidbotsId,
            sourceName: source.name,
            difficulty,
          })),
      )
      await prisma.simJob.createMany({ data })

      return { message: `Queued ${plural(data.length, "sim")}.` }
    },
  }),

  rerunSlot: defineAction({
    accept: "form",
    input: z.object({ slot: z.string() }),
    handler: async ({ slot }, context) => {
      requireAdmin(context.locals)

      const parsed = parseSlotKey(slot)
      if (!parsed) throw new ActionError({ code: "BAD_REQUEST", message: "that is not a slot" })

      // The latest paste, so a rerun sims the gear the raider is actually wearing.
      const submission = await prisma.submission.findFirst({
        where: { characterId: parsed.characterId },
        orderBy: { createdAt: "desc" },
        include: { character: true },
      })
      if (!submission) throw new ActionError({ code: "BAD_REQUEST", message: "that character has not pasted yet" })

      const name = `${submission.character.name}-${submission.character.realm}`
      const active = await prisma.simJob.count({
        where: { submissionId: submission.id, difficulty: parsed.difficulty, status: { in: ACTIVE_STATUSES } },
      })
      if (active > 0) return { message: `${parsed.difficulty} is already running for ${name}.` }

      const settings = await getSettings()
      const source = await resolveConfiguredSource(settings)
      if (isErr(source)) throw new ActionError({ code: "BAD_REQUEST", message: source.message })

      await prisma.simJob.create({
        data: {
          submissionId: submission.id,
          sourceId: source.raidbotsId,
          sourceName: source.name,
          difficulty: parsed.difficulty,
        },
      })

      return { message: `Queued ${parsed.difficulty} for ${name}.` }
    },
  }),

  syncNow: defineAction({
    accept: "form",
    input: z.object({}),
    handler: async (_input, context) => {
      requireAdmin(context.locals)
      await runSync()
      return { message: "Sync complete." }
    },
  }),
}
