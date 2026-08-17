import { describe, expect, it } from "bun:test"

import { contentHash } from "#lib/simc.ts"

const PASTE = 'warlock="Isaaclock"\nlevel=90\nhead=,id=266429\n'

describe("contentHash", () => {
  it("is stable for the same bytes", () => {
    expect(contentHash(PASTE)).toBe(contentHash(PASTE))
  })

  it("ignores surrounding whitespace, since the form trims", () => {
    expect(contentHash(`\n  ${PASTE}  \n`)).toBe(contentHash(PASTE))
  })

  it("changes when any gear byte changes", () => {
    expect(contentHash(PASTE.replace("266429", "266430"))).not.toBe(contentHash(PASTE))
  })

  // The header timestamp is why an actual /simc re-run counts as new work rather than a duplicate.
  it("changes when only the header timestamp differs", () => {
    const a = `# Isaaclock - 2026-08-17 11:22\n${PASTE}`
    const b = `# Isaaclock - 2026-08-17 11:23\n${PASTE}`
    expect(contentHash(a)).not.toBe(contentHash(b))
  })

  it("produces a hex sha-256", () => {
    expect(contentHash(PASTE)).toMatch(/^[\da-f]{64}$/v)
  })
})
