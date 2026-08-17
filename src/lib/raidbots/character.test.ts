import { describe, expect, it } from "bun:test"

import { resolveLootSpecId } from "#lib/raidbots/character.ts"

describe("resolveLootSpecId", () => {
  it("falls back to the active spec when no loot spec is set", () => {
    expect(resolveLootSpecId(null, 267)).toBe(267)
    expect(resolveLootSpecId(undefined, 267)).toBe(267)
  })

  it("uses the loot spec when the character has one", () => {
    expect(resolveLootSpecId({ id: 265 }, 267)).toBe(265)
  })

  it("falls back when the loot spec carries no usable id", () => {
    expect(resolveLootSpecId({}, 267)).toBe(267)
  })
})
