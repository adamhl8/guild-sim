import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import type { Result } from "ts-explicit-errors"
import { attempt, err, isErr } from "ts-explicit-errors"

import { isOk, request } from "#lib/http.ts"

export const RAIDBOTS_BASE = "https://www.raidbots.com"

const COOKIE_NAME = "raidsid"
const CACHE_PATH = path.join(os.homedir(), ".cache", "guild-sim", "session.json")

export interface Credentials {
  email: string
  password: string
}

const readCachedCookie = async (): Promise<string | undefined> => {
  const cached = await attempt(async (): Promise<unknown> => Bun.file(CACHE_PATH).json())
  if (isErr(cached) || typeof cached !== "object" || cached === null || !("cookie" in cached)) return undefined
  return typeof cached.cookie === "string" ? cached.cookie : undefined
}

const writeCachedCookie = async (cookie: string): Promise<void> => {
  await attempt(async () => {
    await fs.mkdir(path.dirname(CACHE_PATH), { recursive: true })
    await fs.writeFile(CACHE_PATH, JSON.stringify({ cookie }), { mode: 0o600 })
  })
}

const extractCookie = (headers: Headers): string | undefined => {
  for (const entry of headers.getSetCookie()) {
    const match = /(?<value>^raidsid=[^;]+)/v.exec(entry)
    if (match?.groups?.["value"]) return match.groups["value"]
  }
  return undefined
}

const isCookieValid = async (cookie: string): Promise<boolean> => {
  const response = await request(`${RAIDBOTS_BASE}/api/me`, { headers: { cookie }, retries: 1 })
  return !isErr(response) && isOk(response)
}

/** Repeated bad logins lock the account out for 15 minutes, so this never retries. */
const login = async (credentials: Credentials): Promise<Result<string>> => {
  const response = await request(`${RAIDBOTS_BASE}/api/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(credentials),
    retries: 0,
  })
  if (isErr(response)) return err("raidbots login request failed", response)

  // Bun's dotenv interpolates `$` even inside single quotes, silently truncating a password at the first `$`.
  if (response.status === 401) {
    return err(
      "raidbots rejected the credentials -> check RAIDBOTS_EMAIL/RAIDBOTS_PASSWORD, and escape any `$` in the password as `\\$`",
      undefined,
    )
  }
  if (response.status === 429) return err("raidbots locked out login attempts -> wait 15 minutes", undefined)
  if (!isOk(response)) return err(`raidbots login returned HTTP ${response.status}`, undefined)

  const cookie = extractCookie(response.headers)
  if (!cookie) return err(`raidbots login succeeded but set no ${COOKIE_NAME} cookie`, undefined)
  return cookie
}

/** Reuses a cached cookie when it still works, so a normal run performs no login at all. */
export const getSession = async (credentials: Credentials): Promise<Result<string>> => {
  const cached = await readCachedCookie()
  if (cached && (await isCookieValid(cached))) return cached

  const cookie = await login(credentials)
  if (isErr(cookie)) return cookie

  await writeCachedCookie(cookie)
  return cookie
}
