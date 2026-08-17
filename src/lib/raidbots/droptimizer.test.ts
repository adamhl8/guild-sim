import { describe, expect, it } from "bun:test"

import type { LoadedCharacter } from "#lib/raidbots/character.ts"
import { buildPayload } from "#lib/raidbots/droptimizer.ts"
import type { SimOptions } from "#lib/settings.ts"

const sim: SimOptions = {
  simcVersion: "weekly",
  iterations: "smart",
  fightStyle: "Patchwerk",
  fightLength: 300,
  enemyCount: 1,
}

const SIMC_TEXT = 'warlock="Isaaclock"\nlevel=90\nspec=affliction\n'

const character: LoadedCharacter = {
  name: "Isaaclock",
  spec: "Affliction",
  classId: 9,
  specId: 265,
  lootSpecId: 265,
  faction: "horde",
  profileCacheId: "cache-1",
}

const build = (overrides: { upgradeLevel?: number; gemItemId?: number } = {}) =>
  buildPayload({
    cookie: "raidsid=x",
    simcText: SIMC_TEXT,
    armory: { region: "us", realm: "illidan" },
    character,
    instanceId: 1308,
    difficulty: "mythic",
    sim,
    upgradeLevel: overrides.upgradeLevel ?? 12_806,
    ...(overrides.gemItemId === undefined ? {} : { gemItemId: overrides.gemItemId }),
    clientVersion: { frontendJsHash: "abc123", gameDataVersion: "def456" },
  })

describe("buildPayload", () => {
  it("omits droptimizerItems so the server computes the item list", () => {
    expect(build()).not.toHaveProperty("droptimizerItems")
  })

  it("omits encounter so the whole instance is simmed", () => {
    expect(build()["droptimizer"]).not.toHaveProperty("encounter")
  })

  it("enables upgradeEquipped, which wowaudit requires", () => {
    expect(build()["droptimizer"]).toMatchObject({ upgradeEquipped: true })
  })

  it("sends the resolved Myth 6/6 bonus id as upgradeLevel", () => {
    expect(build()["droptimizer"]).toMatchObject({ upgradeLevel: 12_806 })
    expect(build({ upgradeLevel: 12_854 })["droptimizer"]).toMatchObject({ upgradeLevel: 12_854 })
  })

  it("prefixes the difficulty for raidbots, so the friendly name never reaches the wire", () => {
    expect(build()["droptimizer"]).toMatchObject({ instance: 1308, difficulty: "raid-mythic" })
    expect(build()["reportName"]).toBe("Isaaclock - mythic")
  })

  it("carries identity resolved from the paste", () => {
    expect(build()["droptimizer"]).toMatchObject({ classId: 9, specId: 265, lootSpecId: 265, faction: "horde" })
    expect(build()["spec"]).toBe("Affliction")
  })

  // Raidbots treats these as mutually exclusive: a non-empty armory name would sim the armory profile
  // instead of the paste, silently ignoring the raider's gear.
  it("sends the simc text with an empty armory name", () => {
    expect(build()["text"]).toBe(SIMC_TEXT)
    expect(build()["armory"]).toEqual({ region: "us", realm: "illidan", name: "" })
  })

  it("stamps the client version from /api/status", () => {
    expect(build()).toMatchObject({
      frontendHost: "www.raidbots.com",
      frontendJsHash: "abc123",
      gameDataVersion: "def456",
    })
  })

  it("keeps includeConversions on, since omitting it drops catalyst conversions", () => {
    expect(build()["droptimizer"]).toMatchObject({ includeConversions: true })
  })

  // Omitting it sims correctly but uploads fail: wowaudit rejects a report where it cannot see this disabled.
  it("sends powerInfusion explicitly, which wowaudit requires", () => {
    expect(build()).toMatchObject({ powerInfusion: false })
  })

  // `gem` is Add Vault Socket. The site sends null when the box is unchecked and the gem id when it is
  // checked, so a preferred gem placed here would sim every eligible item with an added socket.
  it("keeps the vault socket off by sending a null gem", () => {
    expect(build({ gemItemId: 240_908 })["droptimizer"]).toMatchObject({ gem: null })
    expect(build()["droptimizer"]).toMatchObject({ gem: null })
  })

  // Only pastes stored before the picker existed, and an absent preference is not a vault socket.
  it("omits craftedGem when the submission has no gem", () => {
    expect(build()["droptimizer"]).not.toHaveProperty("craftedGem")
  })

  it("sends the preferred gem as craftedGem, not gem", () => {
    expect(build({ gemItemId: 240_908 })["droptimizer"]).toMatchObject({ craftedGem: "240908" })
  })

  it("leaves buffs and consumables to the server defaults", () => {
    const payload = build()
    const defaulted = [
      "bloodlust",
      "arcaneIntellect",
      "fortitude",
      "battleShout",
      "mysticTouch",
      "chaosBrand",
      "bleeding",
      "skyfury",
      "markOfTheWild",
      "huntersMark",
      "vantusRune",
      "potion",
      "food",
      "flask",
      "augmentation",
      "temporaryEnchant",
      "smartAggressive",
      "enemyType",
      "reportDetails",
      "apl",
      "ptr",
      "locale",
      "talents",
    ]
    for (const key of defaulted) expect(payload).not.toHaveProperty(key)
  })
})
