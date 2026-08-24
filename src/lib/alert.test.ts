import { describe, expect, it } from "bun:test"

import { refreshAlert } from "#lib/alert.ts"

describe("refreshAlert", () => {
  it.each([
    ["ok", "success"],
    ["empty", "warning"],
    ["denied", "error"],
    ["stale", "error"],
    ["unreachable", "error"],
  ] as const)("maps %s to an %s alert", (status, kind) => {
    expect(refreshAlert(status)?.kind).toBe(kind)
  })

  it.each(["denied", "stale", "unreachable"])("names Battle.net in %p so the roster is not blamed", (status) => {
    expect(refreshAlert(status)?.message).toContain("Battle.net")
  })

  // "bnet" is the name this vocabulary used before it had to distinguish a refusal from an outage.
  it.each([null, "", "nonsense", "OK", "bnet"])("ignores %p", (status) => {
    expect(refreshAlert(status)).toBeUndefined()
  })
})
