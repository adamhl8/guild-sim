import { describe, expect, it } from "bun:test"

import type { Instance } from "#lib/raidbots/static-data.ts"
import type { Season, UpgradeStep } from "#lib/raidbots/upgrade-track.ts"
import { mythStepFor, seasonByNumber, seasonNumberForInstance } from "#lib/raidbots/upgrade-track.ts"

const step = (group: number, name: string, s: { level: number; bonusId: number; itemLevel: number }): UpgradeStep => ({
  group,
  level: s.level,
  max: 6,
  name,
  fullName: `${name} ${s.level}/6`,
  bonusId: s.bonusId,
  itemLevel: s.itemLevel,
})

// Trimmed from live data: season 34 Myth = group 612, season 37 Myth = group 618.
const sets: Record<string, UpgradeStep[]> = {
  "611": [step(611, "Hero", { level: 6, bonusId: 12_798, itemLevel: 276 })],
  "612": [
    step(612, "Myth", { level: 1, bonusId: 12_801, itemLevel: 268 }),
    step(612, "Myth", { level: 6, bonusId: 12_806, itemLevel: 289 }),
  ],
  "617": [step(617, "Hero", { level: 6, bonusId: 12_846, itemLevel: 321 })],
  "618": [
    step(618, "Myth", { level: 1, bonusId: 12_849, itemLevel: 318 }),
    step(618, "Myth", { level: 6, bonusId: 12_854, itemLevel: 334 }),
  ],
}

const midnight1: Season = { id: 34, name: "Midnight Season 1", bonusListGroups: [611, 612] }
const midnight2: Season = { id: 37, name: "Midnight Season 2", active: true, bonusListGroups: [617, 618] }
const seasons = [midnight1, midnight2]

const instances: Instance[] = [
  { id: 1308, name: "March on Quel'Danas", type: "raid", encounters: [{ id: 2739 }, { id: 2740 }] },
  { id: 1320, name: "The Venomous Abyss", type: "raid", encounters: [{ id: 2800 }] },
  { id: 1305, name: "Sporefall", type: "raid", encounters: [{ id: 2999 }] },
  { id: -91, name: "Season 1 Raids", type: "raid", encounters: [{ id: 2739 }, { id: 2740 }] },
  { id: -102, name: "Season 2 Raids", type: "raid", encounters: [{ id: 2800 }] },
]

describe("mythStepFor", () => {
  it("picks the top Myth step for the season", () => {
    expect(mythStepFor(midnight1, sets)?.bonusId).toBe(12_806)
    expect(mythStepFor(midnight2, sets)?.bonusId).toBe(12_854)
  })

  it("ignores non-Myth tracks", () => {
    expect(mythStepFor({ id: 1, name: "x", bonusListGroups: [611] }, sets)).toBeUndefined()
  })
})

describe("seasonNumberForInstance", () => {
  it("maps a raid to the season whose raid group contains its encounters", () => {
    expect(seasonNumberForInstance(instances, 1308)).toBe(1)
    expect(seasonNumberForInstance(instances, 1320)).toBe(2)
  })

  it("returns undefined for a raid in no season group", () => {
    expect(seasonNumberForInstance(instances, 1305)).toBeUndefined()
  })

  // The aggregate is a real source: one sim covers the season and uploads to every raid's wishlist.
  it("maps a Season N Raids aggregate to its own season", () => {
    expect(seasonNumberForInstance(instances, -102)).toBe(2)
    expect(seasonNumberForInstance(instances, -91)).toBe(1)
  })
})

describe("seasonByNumber", () => {
  it("resolves within the active season's expansion", () => {
    expect(seasonByNumber(seasons, midnight2, 1)?.id).toBe(34)
    expect(seasonByNumber(seasons, midnight2, 2)?.id).toBe(37)
  })

  it("ignores seasons without upgrade groups", () => {
    const stale = [{ id: 9, name: "Midnight Season 1" }, midnight2]
    expect(seasonByNumber(stale, midnight2, 1)).toBeUndefined()
  })
})

// The bug the spike hit: Raidbots' active season was 2 while the target raid belonged to season 1.
describe("end-to-end resolution for a season-behind raid", () => {
  it("resolves March on Quel'Danas to season 34 Myth 6/6, not the active season's", () => {
    expect(seasonNumberForInstance(instances, 1308)).toBe(1)
    expect(seasonByNumber(seasons, midnight2, 1)).toEqual(midnight1)
    expect(mythStepFor(midnight1, sets)?.bonusId).toBe(12_806)
    expect(mythStepFor(midnight2, sets)?.bonusId).not.toBe(12_806)
  })
})
