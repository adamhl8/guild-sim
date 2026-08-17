import { describe, expect, it } from "bun:test"

import { buildWishlistIndex } from "#lib/wowaudit/wishlists.ts"

const CHARACTER_ID = 4_618_601

const liveShape = {
  characters: [
    {
      id: CHARACTER_ID,
      instances: [
        {
          id: 73,
          difficulties: [
            {
              difficulty: "mythic",
              wishlist: {
                report_id: { Affliction: "abc123", Demonology: null, Destruction: null },
                updated_at: { Affliction: "2026-08-11T00:00:00Z", Demonology: null, Destruction: null },
              },
            },
            { difficulty: "heroic", wishlist: { report_id: { Affliction: null } } },
          ],
        },
      ],
    },
  ],
}

// The documented shape wraps instances in `wishlists[]` and doubles `wishlist`.
const documentedShape = {
  characters: [
    {
      id: 42,
      wishlists: [
        {
          instances: [
            {
              id: 74,
              difficulties: [{ difficulty: "Heroic", wishlist: { wishlist: { report_id: { Frost: "xyz789" } } } }],
            },
          ],
        },
      ],
    },
  ],
}

describe("buildWishlistIndex", () => {
  it("indexes the live response shape", () => {
    const index = buildWishlistIndex(liveShape)
    expect(index.size).toBe(1)
    expect(index.find({ characterId: CHARACTER_ID, instanceId: 73, difficulty: "mythic", spec: "Affliction" })).toEqual(
      {
        reportId: "abc123",
        updatedAt: "2026-08-11T00:00:00Z",
      },
    )
  })

  it("indexes the documented nested shape", () => {
    const index = buildWishlistIndex(documentedShape)
    expect(index.find({ characterId: 42, instanceId: 74, difficulty: "heroic", spec: "Frost" })?.reportId).toBe(
      "xyz789",
    )
  })

  it("ignores null report ids so they are not treated as uploaded", () => {
    const index = buildWishlistIndex(liveShape)
    expect(
      index.find({ characterId: CHARACTER_ID, instanceId: 73, difficulty: "mythic", spec: "Demonology" }),
    ).toBeUndefined()
    expect(
      index.find({ characterId: CHARACTER_ID, instanceId: 73, difficulty: "heroic", spec: "Affliction" }),
    ).toBeUndefined()
  })

  it("matches difficulty and spec case insensitively", () => {
    const index = buildWishlistIndex(liveShape)
    expect(
      index.find({ characterId: CHARACTER_ID, instanceId: 73, difficulty: "Mythic", spec: "affliction" })?.reportId,
    ).toBe("abc123")
  })

  it("returns an empty index for a roster with no uploads", () => {
    expect(buildWishlistIndex({ characters: [] }).size).toBe(0)
    expect(buildWishlistIndex({}).size).toBe(0)
  })
})
