import { describe, expect, it } from "bun:test"

import { isRostered, realmSlug } from "#lib/wowaudit/characters.ts"

describe("realmSlug", () => {
  it.each([
    ["Illidan", "illidan"],
    ["Zul'jin", "zuljin"],
    ["Area 52", "area-52"],
    ["Mal'Ganis", "malganis"],
    ["Moon Guard", "moon-guard"],
    ["area_52", "area-52"],
    ["moon_guard", "moon-guard"],
  ])("slugs %s to %s", (realm, expected) => {
    expect(realmSlug(realm)).toBe(expected)
  })

  // The property the Area 52 bug violated: wowaudit spells realms with spaces, SimC with underscores,
  // and ownership matching compares the two through this function.
  it.each([
    ["Area 52", "area_52"],
    ["Moon Guard", "moon_guard"],
    ["Mal'Ganis", "malganis"],
  ])("agrees on %s and its simc form %s", (wowaudit, simc) => {
    expect(realmSlug(wowaudit)).toBe(realmSlug(simc))
  })
})

describe("isRostered", () => {
  it.each([
    ["tracking", true],
    // The status that emptied the roster: wowaudit could not refresh the character, but the team still has them.
    ["temporarily_unavailable", true],
    ["not_tracking", false],
    ["", false],
  ] as const)("treats %s as rostered: %s", (status, expected) => {
    expect(isRostered(status, "1566-248158570")).toBe(expected)
  })

  it.each([
    [null, "missing"],
    ["", "empty"],
  ] as const)("rejects a %s blizzard id, which is the join key to a Battle.net account", (blizzardId) => {
    expect(isRostered("tracking", blizzardId)).toBe(false)
  })
})
