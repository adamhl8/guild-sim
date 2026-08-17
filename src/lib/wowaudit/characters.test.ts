import { describe, expect, it } from "bun:test"

import { realmSlug } from "#lib/wowaudit/characters.ts"

describe("realmSlug", () => {
  it.each([
    ["Illidan", "illidan"],
    ["Zul'jin", "zuljin"],
    ["Area 52", "area-52"],
    ["Mal'Ganis", "malganis"],
    ["Moon Guard", "moon-guard"],
  ])("slugs %s to %s", (realm, expected) => {
    expect(realmSlug(realm)).toBe(expected)
  })
})
