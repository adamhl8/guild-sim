import { describe, expect, it } from "bun:test"

import { parseErrorBody } from "#lib/http.ts"

describe("parseErrorBody", () => {
  it("reads the quota rejection Raidbots actually sends", () => {
    expect(parseErrorBody(`{"error":"too_many_sims","retryAfter":1800}`)).toEqual({
      error: "too_many_sims",
      retryAfterMs: 1_800_000,
    })
  })

  it("reads an error with no retryAfter", () => {
    expect(parseErrorBody(`{"error":"unsupported_spec"}`)).toEqual({ error: "unsupported_spec" })
  })

  it("omits keys rather than setting them undefined, so spreading stays clean", () => {
    expect(Object.keys(parseErrorBody(`{"message":"nope"}`))).toEqual([])
  })

  it("survives a non-json body", () => {
    expect(parseErrorBody("<html>502 Bad Gateway</html>")).toEqual({})
  })

  it("ignores a non-numeric retryAfter", () => {
    expect(parseErrorBody(`{"error":"too_many_sims","retryAfter":"soon"}`)).toEqual({ error: "too_many_sims" })
  })
})
