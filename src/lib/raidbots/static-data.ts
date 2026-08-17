import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import type { Result } from "ts-explicit-errors"
import { attempt, err, isErr } from "ts-explicit-errors"

import { requestJson } from "#lib/http.ts"
import { RAIDBOTS_BASE } from "#lib/raidbots/session.ts"

/** Raidbots asks that static data be cached locally rather than refetched. */
const CACHE_DIR = path.join(os.homedir(), ".cache", "guild-sim", "static")

/** Shape of `instances.json`. Negative ids are pseudo-instances, including the `Season N Raids` aggregates. */
export interface Instance {
  id: number
  name: string
  type: string
  encounters?: { id: number }[]
}

/**
 * Static data is content-addressed by hash, and `/static/data/live/` is stale (it was missing `-102`), so the hash has
 * to come from `/api/status`. Memoized because every lookup would otherwise refetch it.
 */
let hashPromise: Promise<Result<string>> | undefined

const fetchHash = async (): Promise<Result<string>> => {
  const status = await requestJson<{ version?: { gameData?: string } }>(`${RAIDBOTS_BASE}/api/status`)
  if (isErr(status)) return err("could not read raidbots status", status)

  const hash = status.version?.gameData
  if (!hash) return err("raidbots status returned no gameData hash", undefined)
  return hash
}

const gameDataHash = async (): Promise<Result<string>> => {
  hashPromise ??= fetchHash()
  const hash = await hashPromise
  // A failed lookup should not poison the rest of the run.
  if (isErr(hash)) hashPromise = undefined
  return hash
}

export const staticData = async <T>(file: string): Promise<Result<T>> => {
  const hash = await gameDataHash()
  if (isErr(hash)) return hash

  const cached = path.join(CACHE_DIR, hash, `${file}.json`)
  // oxlint-disable-next-line typescript/no-unsafe-return -- cached json is untyped; T is the caller's contract
  const onDisk = await attempt(async (): Promise<T> => Bun.file(cached).json())
  if (!isErr(onDisk)) return onDisk

  const fetched = await requestJson<T>(`${RAIDBOTS_BASE}/static/data/${hash}/${file}.json`)
  if (isErr(fetched)) return err(`could not fetch raidbots static data: ${file}`, fetched)

  await attempt(async () => {
    await fs.mkdir(path.dirname(cached), { recursive: true })
    await Bun.write(cached, JSON.stringify(fetched))
  })
  return fetched
}
