import { describe, expect, it } from "bun:test"

import { patchOf, stalenessRejection } from "#lib/staleness.ts"

const NOW = Date.parse("2026-08-17T12:00:00.000Z")
const LIVE = "12.1.0.69299"

const check = (overrides: Parameters<typeof stalenessRejection>[0] extends infer T ? Partial<T> : never = {}) =>
  stalenessRejection({
    addonInfo: { wowVersion: LIVE, exportedAt: "2026-08-17 11:00" },
    liveWowBuild: LIVE,
    buildCheck: "exact",
    maxPasteAgeDays: 3,
    now: NOW,
    ...overrides,
  })

describe("patchOf", () => {
  it("drops the build number", () => {
    expect(patchOf("12.1.0.69299")).toBe("12.1.0")
  })
})

describe("stalenessRejection", () => {
  it("accepts a current, fresh paste", () => {
    expect(check()).toBeUndefined()
  })

  // The strict default: a hotfix bumps only the last segment, and exact mode rejects that.
  it("rejects a hotfix-old build in exact mode", () => {
    const reason = check({ addonInfo: { wowVersion: "12.1.0.69214", exportedAt: "2026-08-17 11:00" } })
    expect(reason).toContain("12.1.0.69214")
    expect(reason).toContain(LIVE)
  })

  it("accepts the same hotfix-old build in patch mode", () => {
    expect(
      check({ buildCheck: "patch", addonInfo: { wowVersion: "12.1.0.69214", exportedAt: "2026-08-17 11:00" } }),
    ).toBeUndefined()
  })

  it("still rejects a previous patch in patch mode", () => {
    expect(
      check({ buildCheck: "patch", addonInfo: { wowVersion: "12.0.5.60000", exportedAt: "2026-08-17 11:00" } }),
    ).toContain("12.0.5")
  })

  it("skips the build check entirely when off", () => {
    expect(
      check({ buildCheck: "off", addonInfo: { wowVersion: "11.0.0.1", exportedAt: "2026-08-17 11:00" } }),
    ).toBeUndefined()
  })

  it("rejects a paste older than the limit", () => {
    expect(check({ addonInfo: { wowVersion: LIVE, exportedAt: "2026-08-10 11:00" } })).toContain("7 days old")
  })

  it("accepts a paste inside the limit", () => {
    expect(check({ addonInfo: { wowVersion: LIVE, exportedAt: "2026-08-15 11:00" } })).toBeUndefined()
  })

  // Before the first sync there is nothing to compare against; blocking every paste would be worse.
  it("does not reject when the live build is unknown", () => {
    expect(check({ liveWowBuild: undefined, addonInfo: { wowVersion: "1.0.0.1" } })).toBeUndefined()
  })

  it("does not reject when the paste carries no provenance", () => {
    expect(check({ addonInfo: {} })).toBeUndefined()
  })

  it("reports the build problem before the age problem", () => {
    expect(check({ addonInfo: { wowVersion: "12.1.0.1", exportedAt: "2026-01-01 11:00" } })).toContain("live build")
  })
})
