import { describe, expect, it } from "bun:test"

import { absoluteTime, relativeTime } from "#lib/time.ts"

const NOW = Date.parse("2026-08-19T12:00:00Z")
const ago = (ms: number): Date => new Date(NOW - ms)

describe("relativeTime", () => {
  it.each([
    [ago(0), "just now"],
    [ago(59_000), "just now"],
    [ago(60_000), "1m ago"],
    [ago(59 * 60_000), "59m ago"],
    [ago(60 * 60_000), "1h ago"],
    [ago(23 * 60 * 60_000), "23h ago"],
    [ago(24 * 60 * 60_000), "1d ago"],
    [ago(90 * 24 * 60 * 60_000), "90d ago"],
  ] as const)("renders %s as %s", (at, expected) => {
    expect(relativeTime(at, NOW)).toBe(expected)
  })

  it("floors rather than rounds, so nothing reads fresher than it is", () => {
    expect(relativeTime(ago(47 * 60 * 60_000), NOW)).toBe("1d ago")
  })
})

describe("absoluteTime", () => {
  it("marks the zone, since a naive stamp reads as local time", () => {
    expect(absoluteTime(new Date(NOW))).toBe("2026-08-19 12:00 UTC")
  })
})
