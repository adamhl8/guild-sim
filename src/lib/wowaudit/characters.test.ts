import { describe, expect, it } from "bun:test"

import type { Character } from "#lib/wowaudit/characters.ts"
import { filterByRank, realmSlug } from "#lib/wowaudit/characters.ts"

const character = (name: string, rank: string, realm = "Illidan"): Character => ({
  id: name.length,
  name,
  realm,
  class: "Warlock",
  role: "Ranged",
  rank,
  blizzardId: `57-${String(name.length)}`,
})

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

describe("filterByRank", () => {
  const roster = [character("Raid", "Raider"), character("Tri", "Trial"), character("Boss", "GM")]

  it("keeps only allowed ranks", () => {
    expect(filterByRank(roster, ["GM", "Raider"]).map((c) => c.name)).toEqual(["Raid", "Boss"])
  })

  it("matches ranks case insensitively", () => {
    expect(filterByRank(roster, ["raider"]).map((c) => c.name)).toEqual(["Raid"])
  })

  it("returns nothing for an empty allowlist", () => {
    expect(filterByRank(roster, [])).toEqual([])
  })
})
