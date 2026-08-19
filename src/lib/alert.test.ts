import { describe, expect, it } from "bun:test"

import { refreshAlert } from "#lib/alert.ts"

describe("refreshAlert", () => {
  it.each([
    ["ok", "success"],
    ["empty", "warning"],
    ["bnet", "error"],
  ] as const)("maps %s to an %s alert", (status, kind) => {
    expect(refreshAlert(status)?.kind).toBe(kind)
  })

  it("names Battle.net so the raider knows it is not their roster at fault", () => {
    expect(refreshAlert("bnet")?.message).toContain("Battle.net")
  })

  it.each([null, "", "nonsense", "OK"])("ignores %p", (status) => {
    expect(refreshAlert(status)).toBeUndefined()
  })
})
