import { describe, expect, it } from "bun:test"

import { parseSubmits, pruneSubmits, quotaDelayMs } from "#lib/quota.ts"

const HOUR_MS = 60 * 60 * 1000
const NOW = 1_700_000_000_000

describe("parseSubmits", () => {
  it("reads the stored list and drops junk", () => {
    expect(parseSubmits("100,200, 300 ,,abc")).toEqual([100, 200, 300])
  })

  it("handles an empty column", () => {
    expect(parseSubmits("")).toEqual([])
  })
})

describe("pruneSubmits", () => {
  it("keeps only the rolling hour", () => {
    expect(pruneSubmits([NOW - HOUR_MS - 1, NOW - 1000], NOW)).toEqual([NOW - 1000])
  })
})

describe("quotaDelayMs", () => {
  it("allows a submit while the bucket has room", () => {
    expect(quotaDelayMs({ submits: [NOW - 1000], quotaResetAt: undefined }, 40, NOW)).toBe(0)
  })

  it("waits out the oldest submit once the bucket is full", () => {
    const submits = [NOW - 60_000, NOW - 120_000, NOW - 180_000]
    expect(quotaDelayMs({ submits, quotaResetAt: undefined }, 3, NOW)).toBe(HOUR_MS - 180_000)
  })

  // The bucket only counts sims this app submitted, so a browser sim can exhaust the real quota while
  // the bucket still looks empty. Raidbots' own answer has to win.
  it("honours a server reset over an empty bucket", () => {
    expect(quotaDelayMs({ submits: [], quotaResetAt: NOW + 20 * 60_000 }, 40, NOW)).toBe(20 * 60_000)
  })

  it("takes the longer of the two", () => {
    const submits = [NOW - 59 * 60_000, NOW - 59 * 60_000]
    const bucket = quotaDelayMs({ submits, quotaResetAt: undefined }, 2, NOW)
    expect(quotaDelayMs({ submits, quotaResetAt: NOW + 1000 }, 2, NOW)).toBe(bucket)
    expect(quotaDelayMs({ submits, quotaResetAt: NOW + 2 * HOUR_MS }, 2, NOW)).toBe(2 * HOUR_MS)
  })

  it("treats an elapsed reset as spent", () => {
    expect(quotaDelayMs({ submits: [], quotaResetAt: NOW - 1000 }, 40, NOW)).toBe(0)
  })
})
