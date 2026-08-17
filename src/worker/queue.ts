import { isErr } from "ts-explicit-errors"

import { env } from "#env.ts"
import type { RosterCharacter, SimJob, Submission } from "#generated/prisma/client.ts"
import { prisma } from "#lib/db.ts"
import { quotaDelayMs, readQuota, recordQuotaReset, recordSubmit } from "#lib/quota.ts"
import { loadSimcCharacter } from "#lib/raidbots/character.ts"
import { getClientVersion, reportUrl, submitSim } from "#lib/raidbots/droptimizer.ts"
import { waitForSim } from "#lib/raidbots/job.ts"
import { getSession } from "#lib/raidbots/session.ts"
import { createUpgradeResolver } from "#lib/raidbots/upgrade-track.ts"
import type { ResolvedSettings } from "#lib/settings.ts"
import { getSettings, isDifficulty } from "#lib/settings.ts"
import { realmSlug } from "#lib/wowaudit/characters.ts"
import { createWowauditClient } from "#lib/wowaudit/client.ts"
import { uploadWishlist } from "#lib/wowaudit/wishlists.ts"

const IDLE_POLL_MS = 5000

type SubmissionWithCharacter = Submission & { character: RosterCharacter }

/**
 * Resolves `false` when the wait was cut short by shutdown, so SIGTERM does not have to sit out a 30-minute rate-limit
 * sleep. Bun.sleep is not abortable, hence the hand-rolled timer.
 */
const sleep = async (ms: number, signal: AbortSignal): Promise<boolean> => {
  if (signal.aborted) return false

  /* oxlint-disable promise/avoid-new, promise/no-multiple-resolved --
     a cancellable timer has no async/await form, and the two paths are mutually exclusive: aborting
     clears the timer, firing removes the listener. */
  return new Promise<boolean>((resolve) => {
    const abort = new AbortController()

    const timer = setTimeout(() => {
      abort.abort()
      resolve(true)
    }, ms)

    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer)
        resolve(false)
      },
      { once: true, signal: abort.signal },
    )
  })
  /* oxlint-enable promise/avoid-new, promise/no-multiple-resolved */
}

/** Hands the job back to the queue untouched, so a shutdown mid-wait costs nothing. */
const requeue = async (job: SimJob): Promise<void> => {
  await prisma.simJob.update({ where: { id: job.id }, data: { status: "queued", startedAt: null } })
}

const fail = async (job: SimJob, message: string): Promise<void> => {
  await prisma.simJob.update({
    where: { id: job.id },
    data: { status: "failed", error: message, finishedAt: new Date() },
  })
  console.error(`job ${String(job.id)} failed: ${message}`)
}

interface FinishInput {
  cookie: string
  simId: string
  submission: SubmissionWithCharacter
  settings: ResolvedSettings
}

/** Poll then upload. Shared by a fresh submit and by a job resumed after a restart. */
const finish = async (job: SimJob, input: FinishInput): Promise<void> => {
  const { cookie, simId, submission, settings } = input

  const finished = await waitForSim({ cookie, simId, pollIntervalMs: settings.runner.pollIntervalMs })
  if (isErr(finished)) {
    await fail(job, finished.messageChain)
    return
  }

  await prisma.simJob.update({ where: { id: job.id }, data: { status: "uploading" } })

  const uploaded = await uploadWishlist(createWowauditClient(env.WOWAUDIT_API_KEY), {
    reportId: simId,
    configurationName: settings.wowaudit.configurationName,
    characterId: submission.characterId,
    characterName: submission.character.name,
    replaceManualEdits: settings.wowaudit.replaceManualEdits,
  })
  if (isErr(uploaded)) {
    await fail(job, uploaded.messageChain)
    return
  }

  await prisma.simJob.update({ where: { id: job.id }, data: { status: "done", finishedAt: new Date() } })
  console.info(`job ${String(job.id)} uploaded for ${submission.character.name}`)
}

const runJob = async (job: SimJob, signal: AbortSignal): Promise<void> => {
  const settings = await getSettings()

  const submission = await prisma.submission.findUnique({
    where: { id: job.submissionId },
    include: { character: true },
  })
  if (!submission) {
    await fail(job, "the submission was deleted")
    return
  }

  await prisma.simJob.update({ where: { id: job.id }, data: { status: "running", startedAt: new Date() } })

  const cookie = await getSession({ email: env.RAIDBOTS_EMAIL, password: env.RAIDBOTS_PASSWORD })
  if (isErr(cookie)) {
    await fail(job, `could not authenticate with raidbots: ${cookie.messageChain}`)
    return
  }

  // Already submitted before a restart interrupted it: poll that sim rather than paying for a new one.
  // Checked before the load, since a resume needs neither the profile nor the upgrade track.
  if (job.simId) {
    await finish(job, { cookie, simId: job.simId, submission, settings })
    return
  }

  const character = await loadSimcCharacter(cookie, submission.simcText, settings.sim.simcVersion)
  if (isErr(character)) {
    await fail(job, `raidbots could not load the paste: ${character.messageChain}`)
    return
  }

  const clientVersion = await getClientVersion()
  if (isErr(clientVersion)) {
    await fail(job, `could not read the raidbots client version: ${clientVersion.messageChain}`)
    return
  }

  if (!isDifficulty(job.difficulty)) {
    await fail(job, `unknown difficulty "${job.difficulty}"`)
    return
  }

  const upgrade = await createUpgradeResolver().forInstance(job.sourceId, job.difficulty)
  if (isErr(upgrade)) {
    await fail(job, `could not resolve the upgrade track: ${upgrade.messageChain}`)
    return
  }

  const submitInput = {
    cookie,
    simcText: submission.simcText,
    armory: { region: settings.region, realm: realmSlug(submission.character.realm) },
    character,
    instanceId: job.sourceId,
    difficulty: job.difficulty,
    sim: settings.sim,
    upgradeLevel: upgrade.bonusId,
    gemItemId: submission.gemId ?? undefined,
    clientVersion,
  }

  // The local bucket cannot see sims run from the browser, so it only avoids obviously-doomed requests.
  const quota = await readQuota()
  const delay = quotaDelayMs(quota, settings.runner.submitsPerHour, Date.now())
  if (delay > 0) {
    console.info(`quota reached, waiting ${String(Math.ceil(delay / 60_000))}m`)
    // Shutting down mid-wait must not fall through into a submit: it would spend quota on a process
    // that is about to exit. Requeue instead and let the next boot pick it up.
    if (!(await sleep(delay, signal))) return requeue(job)
  }

  let submitted = await submitSim(submitInput)

  if (isErr(submitted)) {
    // Permanent for this spec, so record it rather than burning a submit on every future paste.
    if (submitted.messageChain.includes("unsupported_spec")) {
      await prisma.rosterCharacter.update({
        where: { id: submission.characterId },
        data: { unsupportedSpec: character.spec },
      })
      await prisma.simJob.update({
        where: { id: job.id },
        data: { status: "skipped", error: `raidbots cannot sim ${character.spec}`, finishedAt: new Date() },
      })
      return
    }

    // Raidbots is the authority on the hourly limit; wait exactly what it asks and retry once.
    const retryAfterMs = submitted.get<number>("quotaRetryAfterMs")
    if (retryAfterMs === undefined || retryAfterMs <= 0) {
      await fail(job, `submit rejected: ${submitted.messageChain}`)
      return
    }

    await recordQuotaReset(Date.now() + retryAfterMs)
    console.info(`raidbots reports the hourly limit is spent, waiting ${String(Math.ceil(retryAfterMs / 60_000))}m`)
    if (!(await sleep(retryAfterMs, signal))) return requeue(job)

    submitted = await submitSim(submitInput)
    if (isErr(submitted)) {
      await fail(job, `submit rejected after waiting out the quota: ${submitted.messageChain}`)
      return
    }
  }

  await recordSubmit(Date.now())
  await prisma.simJob.update({ where: { id: job.id }, data: { simId: submitted.simId } })
  console.info(`job ${String(job.id)} submitted -> ${reportUrl(submitted.simId)}`)

  await finish(job, { cookie, simId: submitted.simId, submission, settings })
}

export interface Worker {
  stop: () => Promise<void>
}

/**
 * Drains queued jobs one at a time. Sequential by design: Raidbots allows at most 2 concurrent sims and the hourly
 * submit budget is the real constraint, so there is nothing to gain from parallelism here.
 */
export const startWorker = (): Worker => {
  const controller = new AbortController()
  const { signal } = controller

  const loop = async (): Promise<void> => {
    // Anything left mid-flight by a killed process would otherwise sit in `running` forever. Jobs that
    // already have a simId resume against that sim rather than paying for a new one.
    const reclaimed = await prisma.simJob.updateMany({
      where: { status: { in: ["running", "uploading"] } },
      data: { status: "queued", startedAt: null },
    })
    if (reclaimed.count > 0) console.info(`requeued ${String(reclaimed.count)} job(s) interrupted by a restart`)

    while (!signal.aborted) {
      const job = await prisma.simJob.findFirst({ where: { status: "queued" }, orderBy: { queuedAt: "asc" } })

      await (job ? runJob(job, signal) : sleep(IDLE_POLL_MS, signal))
    }
  }

  // The Astro adapter installs a process-wide unhandledRejection listener, so an unguarded throw here
  // would be logged as a render error and silently stop the queue.
  const finished = (async (): Promise<void> => {
    try {
      await loop()
    } catch (error: unknown) {
      if (!signal.aborted) console.error("worker stopped unexpectedly:", error)
    }
  })()

  return {
    stop: async () => {
      controller.abort()
      await finished
    },
  }
}
