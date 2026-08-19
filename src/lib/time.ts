const MINUTE_MS = 60 * 1000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

/**
 * How stale a paste is, at the coarsest useful resolution. `now` is a parameter rather than `Date.now()` so it is
 * deterministic under test, matching `staleness.ts`.
 */
export const relativeTime = (at: Date, now: number): string => {
  const elapsed = now - at.getTime()
  if (elapsed < MINUTE_MS) return "just now"
  if (elapsed < HOUR_MS) return `${String(Math.floor(elapsed / MINUTE_MS))}m ago`
  if (elapsed < DAY_MS) return `${String(Math.floor(elapsed / HOUR_MS))}h ago`
  return `${String(Math.floor(elapsed / DAY_MS))}d ago`
}

/** The unambiguous form, for the `title` behind the relative one. Naive UTC reads as local and misleads. */
export const absoluteTime = (at: Date): string => `${at.toISOString().slice(0, 16).replace("T", " ")} UTC`
