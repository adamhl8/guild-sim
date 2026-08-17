import { describe, expect, it } from "bun:test"

import { blizzardId, blizzardIdsFrom } from "#lib/roster/claim.ts"

describe("blizzardId", () => {
  // wowaudit stores exactly this composite, which is what makes the join possible at all.
  it("builds wowaudit's `{realmId}-{characterId}` form", () => {
    expect(blizzardId({ id: 222_707_887, realm: { id: 57 } })).toBe("57-222707887")
  })

  it("returns undefined when either id is missing", () => {
    expect(blizzardId({ id: 1 })).toBeUndefined()
    expect(blizzardId({ realm: { id: 57 } })).toBeUndefined()
    expect(blizzardId({})).toBeUndefined()
  })
})

describe("blizzardIdsFrom", () => {
  it("flattens every character across every wow account", () => {
    expect(
      blizzardIdsFrom({
        wow_accounts: [
          {
            characters: [
              { id: 1, realm: { id: 57 } },
              { id: 2, realm: { id: 61 } },
            ],
          },
          { characters: [{ id: 3, realm: { id: 57 } }] },
        ],
      }),
    ).toEqual(["57-1", "61-2", "57-3"])
  })

  it("skips characters with incomplete ids rather than emitting a broken key", () => {
    expect(blizzardIdsFrom({ wow_accounts: [{ characters: [{ id: 1 }, { id: 2, realm: { id: 57 } }] }] })).toEqual([
      "57-2",
    ])
  })

  it("handles an account with no characters", () => {
    expect(blizzardIdsFrom({})).toEqual([])
    expect(blizzardIdsFrom({ wow_accounts: [{}] })).toEqual([])
  })
})
