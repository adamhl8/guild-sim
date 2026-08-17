import type { Result } from "ts-explicit-errors"

import { requestJson } from "#lib/http.ts"

const BASE_URL = "https://wowaudit.com/v1"

export interface WowauditClient {
  get: <T>(path: string) => Promise<Result<T>>
  post: <T>(path: string, body: unknown) => Promise<Result<T>>
}

/** The API key is scoped to a single wowaudit team, so it implicitly selects the roster. */
export const createWowauditClient = (apiKey: string): WowauditClient => {
  const headers = { authorization: `Bearer ${apiKey}` }

  return {
    get: async <T>(path: string) => requestJson<T>(`${BASE_URL}${path}`, { headers }),
    post: async <T>(path: string, body: unknown) =>
      requestJson<T>(`${BASE_URL}${path}`, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
  }
}
