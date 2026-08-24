import { describe, expect, it } from "bun:test"

import type { CtxError } from "ts-explicit-errors"
import { err } from "ts-explicit-errors"

import { blizzardId, blizzardIdsFrom, claimFailureStatus } from "#lib/roster/claim.ts"

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

/** Shaped like the real thing: `claimCharacters` wraps the failure twice, so the status sits two causes down. */
const claimError = (status?: number): CtxError => {
  const request = err("GET https://us.api.blizzard.com/profile/user/wow -> HTTP", undefined)
  const profile = err(
    "could not read the battle.net wow profile",
    status === undefined ? request : request.ctx({ status }),
  )
  return err("could not resolve characters for u1", profile)
}

describe("claimFailureStatus", () => {
  it.each([
    [403, "denied"],
    [401, "stale"],
    [500, "unreachable"],
  ] as const)("reads %i off the cause chain as %s", (status, expected) => {
    expect(claimFailureStatus(claimError(status))).toBe(expected)
  })

  it("falls back to unreachable when the request never reached a status", () => {
    expect(claimFailureStatus(claimError())).toBe("unreachable")
  })
})
