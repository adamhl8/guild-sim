import { describe, expect, it } from "bun:test"

import { classColorClass } from "#lib/wow-class.ts"

describe("classColorClass", () => {
  it("slugs a single-word class", () => {
    expect(classColorClass("Warlock")).toBe("class-warlock")
  })

  it("slugs a two-word class", () => {
    expect(classColorClass("Death Knight")).toBe("class-death-knight")
  })

  it("returns a class name with no matching rule for an unknown class", () => {
    expect(classColorClass("Tinker")).toBe("class-tinker")
  })
})
