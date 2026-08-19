import { describe, expect, it } from "bun:test"

import { activeDifficulties, formatSlotKey, parseSlotKey, slotsFor } from "#lib/slots.ts"

interface JobInput {
  difficulty: string
  status: string
  at: string
  error?: string | null
}

const job = ({ difficulty, status, at, error = null }: JobInput) => ({
  difficulty,
  status,
  error,
  queuedAt: new Date(at),
})

describe("slotsFor", () => {
  it("returns one slot per configured difficulty", () => {
    const slots = slotsFor([], ["heroic", "mythic"])
    expect(slots.map((slot) => slot.difficulty)).toEqual(["heroic", "mythic"])
  })

  it("emits canonical order however the setting was stored", () => {
    const slots = slotsFor([], ["mythic", "lfr", "heroic"])
    expect(slots.map((slot) => slot.difficulty)).toEqual(["lfr", "heroic", "mythic"])
  })

  it("marks a difficulty with no job as a gap", () => {
    const [slot] = slotsFor([job({ difficulty: "heroic", status: "done", at: "2026-08-19T10:00:00Z" })], ["mythic"])
    expect(slot).toEqual({ difficulty: "mythic", status: "none", error: null })
  })

  // A requeue adds a row rather than replacing one, so the newest has to win.
  it("takes the newest job for a difficulty", () => {
    const [slot] = slotsFor(
      [
        job({ difficulty: "mythic", status: "failed", at: "2026-08-19T10:00:00Z", error: "boom" }),
        job({ difficulty: "mythic", status: "done", at: "2026-08-19T12:00:00Z" }),
      ],
      ["mythic"],
    )
    expect(slot?.status).toBe("done")
    expect(slot?.error).toBeNull()
  })

  it("is not fooled by input order", () => {
    const [slot] = slotsFor(
      [
        job({ difficulty: "mythic", status: "done", at: "2026-08-19T12:00:00Z" }),
        job({ difficulty: "mythic", status: "queued", at: "2026-08-19T09:00:00Z" }),
      ],
      ["mythic"],
    )
    expect(slot?.status).toBe("done")
  })

  it("carries the error through so a failed slot can explain itself", () => {
    const [slot] = slotsFor(
      [job({ difficulty: "mythic", status: "failed", at: "2026-08-19T10:00:00Z", error: "raidbots said no" })],
      ["mythic"],
    )
    expect(slot?.error).toBe("raidbots said no")
  })

  it("ignores jobs for difficulties that are no longer configured", () => {
    const slots = slotsFor([job({ difficulty: "lfr", status: "done", at: "2026-08-19T10:00:00Z" })], ["mythic"])
    expect(slots).toHaveLength(1)
    expect(slots[0]?.difficulty).toBe("mythic")
  })
})

describe("activeDifficulties", () => {
  it("orders canonically so table headers match their slots", () => {
    expect(activeDifficulties(["mythic", "lfr", "heroic"])).toEqual(["lfr", "heroic", "mythic"])
  })

  it("drops nothing and adds nothing", () => {
    expect(activeDifficulties(["mythic"])).toEqual(["mythic"])
    expect(activeDifficulties([])).toEqual([])
  })
})

describe("slot keys", () => {
  it("round-trips", () => {
    expect(parseSlotKey(formatSlotKey(42, "heroic"))).toEqual({ characterId: 42, difficulty: "heroic" })
  })

  it.each(["", "42", "42:", ":heroic", "42:elite", "abc:heroic", "0:heroic", "-1:heroic", "1.5:heroic"])(
    "rejects %p",
    (value) => {
      expect(parseSlotKey(value)).toBeUndefined()
    },
  )
})
