import { prisma } from "#lib/db.ts"

const HOUR_MS = 60 * 60 * 1000

export interface QuotaSnapshot {
  submits: number[]
  quotaResetAt: number | undefined
}

export const parseSubmits = (raw: string): number[] =>
  raw
    .split(",")
    .map((entry) => Number(entry.trim()))
    .filter((value) => Number.isFinite(value) && value > 0)

export const pruneSubmits = (submits: number[], now: number): number[] =>
  submits.filter((timestamp) => now - timestamp < HOUR_MS)

/**
 * Milliseconds to wait before another submit fits. The bucket is only a local guess: it cannot see sims run from the
 * browser, so a server-reported reset always wins.
 */
export const quotaDelayMs = (state: QuotaSnapshot, limit: number, now: number): number => {
  const recent = pruneSubmits(state.submits, now)
  const bucket = recent.length < limit ? 0 : Math.max(0, HOUR_MS - (now - Math.min(...recent)))
  const server = state.quotaResetAt === undefined ? 0 : Math.max(0, state.quotaResetAt - now)
  return Math.max(bucket, server)
}

export const readQuota = async (): Promise<QuotaSnapshot> => {
  const row = await prisma.quotaState.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } })
  return {
    submits: parseSubmits(row.submits),
    quotaResetAt: row.quotaResetAt?.getTime(),
  }
}

export const recordSubmit = async (now: number): Promise<void> => {
  const state = await readQuota()
  const submits = [...pruneSubmits(state.submits, now), now]
  await prisma.quotaState.update({ where: { id: 1 }, data: { submits: submits.join(",") } })
}

export const recordQuotaReset = async (resetAt: number): Promise<void> => {
  await prisma.quotaState.upsert({
    where: { id: 1 },
    update: { quotaResetAt: new Date(resetAt) },
    create: { id: 1, quotaResetAt: new Date(resetAt) },
  })
}
