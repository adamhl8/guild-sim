import { describe, expect, it } from "bun:test"

import type { EnchantmentEntry } from "#lib/gems.ts"
import { groupGemsByColor, selectableGems } from "#lib/gems.ts"

// Trimmed from Raidbots' enchantments.json: two expansions, two crafting qualities, one non-socket row.
const entries: EnchantmentEntry[] = [
  {
    id: 8153,
    slot: "socket",
    expansion: 11,
    craftingQuality: 2,
    itemId: 240_908,
    displayName: "16 Crit & 7 Mast",
    itemName: "Flawless Masterful Garnet",
    algariColor: "garnet",
  },
  {
    id: 8152,
    slot: "socket",
    expansion: 11,
    craftingQuality: 1,
    itemId: 240_907,
    displayName: "14 Crit & 6 Mast",
    itemName: "Flawless Masterful Garnet",
    algariColor: "garnet",
  },
  {
    id: 8109,
    slot: "socket",
    expansion: 11,
    craftingQuality: 2,
    itemId: 240_800,
    displayName: "16 Vers & 7 Mast",
    itemName: "Flawless Masterful Lapis",
    algariColor: "lapis",
  },
  {
    id: 8552,
    slot: "socket",
    expansion: 11,
    craftingQuality: 2,
    itemId: 240_983,
    displayName: "32 Primary",
    itemName: "Indecipherable Eversong Diamond",
  },
  {
    id: 7150,
    slot: "socket",
    expansion: 10,
    craftingQuality: 3,
    itemId: 213_458,
    displayName: "old",
    itemName: "Masterful Ruby",
    algariColor: "ruby",
  },
  {
    id: 9001,
    slot: "finger",
    expansion: 11,
    craftingQuality: 2,
    itemId: 999,
    displayName: "not a gem",
    itemName: "Ring Enchant",
  },
]

describe("selectableGems", () => {
  // Raidbots writes this value straight into SimC's `gem_id=`, and an enchant id fails every profileset
  // with "No gem data for id". Verified against a live sim.
  it("keys on the item id, never the enchant id", () => {
    const gems = selectableGems(entries)
    expect(gems.map((gem) => gem.itemId)).toContain(240_908)
    expect(gems.map((gem) => gem.itemId)).not.toContain(8153)
  })

  it("keeps only the newest expansion", () => {
    expect(selectableGems(entries).map((gem) => gem.itemName)).not.toContain("Masterful Ruby")
  })

  it("keeps only the top crafting quality", () => {
    expect(selectableGems(entries).map((gem) => gem.itemId)).not.toContain(240_907)
  })

  it("ignores enchants that are not gems", () => {
    expect(selectableGems(entries).map((gem) => gem.itemId)).not.toContain(999)
  })

  it("sorts coloured gems together and uncoloured ones last", () => {
    expect(selectableGems(entries).map((gem) => gem.color)).toEqual(["garnet", "lapis", null])
  })

  it("returns nothing rather than throwing when the data has no gems", () => {
    expect(selectableGems([])).toEqual([])
  })
})

describe("groupGemsByColor", () => {
  it("groups for optgroups, labelling uncoloured gems", () => {
    const groups = groupGemsByColor(selectableGems(entries))
    expect(groups.map((group) => group.color)).toEqual(["garnet", "lapis", "other"])
    expect(groups[0]?.gems).toHaveLength(1)
  })
})
