import type { Difficulty } from "#lib/settings.ts"
import { DIFFICULTIES, isDifficulty } from "#lib/settings.ts"

/** `none` is a difficulty that has no job on the latest paste, which is the whole point of a slot: a gap is visible. */
export type SlotStatus = "queued" | "running" | "uploading" | "done" | "failed" | "skipped" | "none"

/** The six the worker writes. Anything else means a job row we do not understand, so the slot reads as a gap. */
const JOB_STATUSES: ReadonlySet<string> = new Set(["queued", "running", "uploading", "done", "failed", "skipped"])

const isJobStatus = (value: string): value is Exclude<SlotStatus, "none"> => JOB_STATUSES.has(value)

export interface Slot {
  difficulty: Difficulty
  status: SlotStatus
  error: string | null
}

/**
 * Soft badges everywhere except `failed`, so a roster of ninety `done` slots stays quiet and the handful that need an
 * officer are the only solid blocks on the page. `queued` is deliberately colourless, and `none` is drawn rather than
 * coloured: a dashed box reads as a gap without spending a hue on it. Not `badge-ghost` for either -- it hard-codes
 * base-200, which is the page background.
 */
export const SLOT_CLASSES: Record<SlotStatus, string> = {
  queued: "badge-soft",
  running: "badge-info badge-soft",
  uploading: "badge-info badge-soft",
  done: "badge-success badge-soft",
  failed: "badge-error",
  skipped: "badge-warning badge-soft",
  // `badge-dash` colours its border from `currentColor`, so the text token mutes the outline with it.
  none: "badge-dash text-base-content/40",
}

interface JobLike {
  difficulty: string
  status: string
  error: string | null
  queuedAt: Date
}

/** Configured difficulties in canonical order. Both tables use this for their columns, so headers cannot drift. */
export const activeDifficulties = (configured: Difficulty[]): Difficulty[] => {
  const set = new Set<string>(configured)
  return DIFFICULTIES.filter((difficulty) => set.has(difficulty))
}

/**
 * One slot per configured difficulty, each carrying the newest job for it.
 *
 * Jobs come from a single submission, so a slot answers "is the current gear covered" rather than "did this ever run".
 * A requeue adds a row rather than replacing one, hence newest-wins.
 */
export const slotsFor = (jobs: JobLike[], difficulties: Difficulty[]): Slot[] =>
  activeDifficulties(difficulties).map((difficulty) => {
    const [latest] = jobs
      .filter((job) => job.difficulty === difficulty)
      .toSorted((a, b) => b.queuedAt.getTime() - a.queuedAt.getTime())

    if (!latest || !isJobStatus(latest.status)) return { difficulty, status: "none", error: null }
    return { difficulty, status: latest.status, error: latest.error }
  })

/** What a rerun button carries. One form wraps the whole roster table, so the pair has to ride in the button's value. */
export const formatSlotKey = (characterId: number, difficulty: Difficulty): string =>
  `${String(characterId)}:${difficulty}`

export const parseSlotKey = (value: string): { characterId: number; difficulty: Difficulty } | undefined => {
  const separator = value.indexOf(":")
  if (separator === -1) return undefined

  const characterId = Number(value.slice(0, separator))
  const difficulty = value.slice(separator + 1)
  if (!Number.isInteger(characterId) || characterId <= 0 || !isDifficulty(difficulty)) return undefined

  return { characterId, difficulty }
}
