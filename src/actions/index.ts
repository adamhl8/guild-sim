import { z } from "astro/zod"
import { ActionError, defineAction } from "astro:actions"
import { isErr } from "ts-explicit-errors"

import { prisma } from "#lib/db.ts"
import { getSettings, updateSettings } from "#lib/settings.ts"
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

export const server = {
  submitSimc: defineAction({
    accept: "form",
    input: z.object({ simc: z.string() }),
    handler: async ({ simc }, context) => {
      const userId = requireUser(context.locals)

      const result = await submitPaste(userId, simc)
      // The message is written for the raider, so it is surfaced verbatim rather than swallowed.
      if (isErr(result)) throw new ActionError({ code: "BAD_REQUEST", message: result.message })

      return result
    },
  }),

  updateSettings: defineAction({
    accept: "form",
    input: z.object({
      wowauditConfigurationName: z.string().min(1),
      ranks: z.string(),
      adminRanks: z.string().min(1),
      source: z.string().min(1),
      difficulties: z.string().min(1),
      simcVersion: z.enum(["weekly", "nightly", "latest"]),
      iterations: z.string(),
      fightStyle: z.string().min(1),
      fightLength: z.coerce.number().int().positive(),
      enemyCount: z.coerce.number().int().positive(),
      concurrency: z.coerce.number().int().min(1).max(2),
      submitsPerHour: z.coerce.number().int().positive(),
      pollIntervalMs: z.coerce.number().int().positive(),
      buildCheck: z.enum(["exact", "patch", "off"]),
      maxPasteAgeDays: z.coerce.number().int().positive(),
      replaceManualEdits: z.coerce.boolean(),
    }),
    handler: async (input, context) => {
      requireAdmin(context.locals)
      await updateSettings(input)

      // Fail loudly here rather than at the next submit, when a raider would be the one to see it.
      const settings = await getSettings()
      const source = await resolveConfiguredSource(settings)
      if (isErr(source)) throw new ActionError({ code: "BAD_REQUEST", message: source.message })

      return { source: source.name }
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
      await prisma.simJob.createMany({
        data: latest.flatMap((submission) =>
          settings.difficulties.map((difficulty) => ({
            submissionId: submission.id,
            sourceId: source.raidbotsId,
            sourceName: source.name,
            difficulty,
          })),
        ),
      })

      return { queued: latest.length * settings.difficulties.length }
    },
  }),

  retryJob: defineAction({
    accept: "form",
    input: z.object({ jobId: z.coerce.number().int() }),
    handler: async ({ jobId }, context) => {
      requireAdmin(context.locals)
      await prisma.simJob.update({
        where: { id: jobId },
        data: { status: "queued", error: null, simId: null, startedAt: null, finishedAt: null },
      })
      return { jobId }
    },
  }),

  syncNow: defineAction({
    accept: "form",
    input: z.object({}),
    handler: async (_input, context) => {
      requireAdmin(context.locals)
      await runSync()
      return { ok: true }
    },
  }),
}
