import type { Result } from "ts-explicit-errors"
import { err, isErr } from "ts-explicit-errors"

import { requestJson, serverMessage } from "#lib/http.ts"
import type { ArmoryRef, LoadedCharacter } from "#lib/raidbots/character.ts"
import { RAIDBOTS_BASE } from "#lib/raidbots/session.ts"
import type { Difficulty, SimOptions } from "#lib/settings.ts"

export interface SubmitInput {
  cookie: string
  /** The pasted `/simc` export. Sent in place of an armory reference. */
  simcText: string
  /** Region and realm still ride along; only `name` must be empty for a simc-sourced sim. */
  armory: Omit<ArmoryRef, "name">
  character: LoadedCharacter
  instanceId: number
  difficulty: Difficulty
  sim: SimOptions
  /** Myth 6/6 bonus id for the instance's season. wowaudit rejects reports simmed at anything else. */
  upgradeLevel: number
  clientVersion: { frontendJsHash: string; gameDataVersion: string }
}

interface SubmitResponse {
  simId?: string
  jobId?: string
  error?: string
}

export interface SubmittedSim {
  simId: string
  jobId: string | undefined
}

export const reportUrl = (simId: string): string => `${RAIDBOTS_BASE}/simbot/report/${simId}`

/**
 * Only fields that encode a decision. Raidbots defaults everything omitted to the same values its own form sends, so
 * raid buffs, consumables and the rest are left out rather than restated.
 */
export const buildPayload = (input: SubmitInput): Record<string, unknown> => {
  const { armory, character, sim, difficulty } = input

  return {
    type: "droptimizer",
    reportName: `${character.name} - ${difficulty}`,
    // `text` and `armory.name` are mutually exclusive in Raidbots' own form: setting the paste means
    // leaving the armory name empty, and the server then sims the pasted profile verbatim.
    text: input.simcText,
    armory: { region: armory.region, realm: armory.realm, name: "" },
    profileCacheId: character.profileCacheId,
    spec: character.spec,
    droptimizer: {
      // No `encounter` key: the browser omits it and the whole instance is simmed.
      instance: input.instanceId,
      // The only place the Raidbots wire form of a difficulty exists; everything else uses wowaudit's plain name.
      difficulty: `raid-${difficulty}`,
      upgradeLevel: input.upgradeLevel,
      // Required by wowaudit ("Upgrade All Equipped Gear to the Same Level").
      upgradeEquipped: true,
      classId: character.classId,
      specId: character.specId,
      lootSpecId: character.lootSpecId,
      faction: character.faction,
      // The one default worth overriding: omitting this drops catalyst conversions from the item list.
      includeConversions: true,
    },
    // Required by wowaudit, which rejects a report where it cannot see this explicitly disabled. Raidbots does not
    // echo the field back when it is omitted, so leaving it to the default fails upload even though the sim is right.
    powerInfusion: false,
    simcVersion: sim.simcVersion,
    iterations: sim.iterations,
    // Pins the precision of the numbers that end up on a wishlist.
    smartHighPrecision: true,
    fightStyle: sim.fightStyle,
    fightLength: sim.fightLength,
    enemyCount: sim.enemyCount,
    // Mandatory: a stale or missing snapshot is rejected with `400 stale_snapshot`.
    frontendHost: new URL(RAIDBOTS_BASE).host,
    frontendJsHash: input.clientVersion.frontendJsHash,
    gameDataVersion: input.clientVersion.gameDataVersion,
  }
}

export const submitSim = async (input: SubmitInput): Promise<Result<SubmittedSim>> => {
  const response = await requestJson<SubmitResponse>(`${RAIDBOTS_BASE}/sim`, {
    method: "POST",
    headers: {
      cookie: input.cookie,
      "content-type": "application/json",
      "x-raidbots-submit-id": crypto.randomUUID(),
    },
    body: JSON.stringify(buildPayload(input)),
  })
  if (isErr(response))
    return err(`raidbots rejected the sim for ${input.character.name}${serverMessage(response)}`, response)

  if (response.error) return err(`raidbots error submitting ${input.character.name}: ${response.error}`, undefined)
  if (!response.simId) return err(`raidbots returned no simId for ${input.character.name}`, undefined).ctx({ response })

  return { simId: response.simId, jobId: response.jobId }
}

/** Both values are echoed into the report and the frontend always sends them. */
export const getClientVersion = async (): Promise<Result<{ frontendJsHash: string; gameDataVersion: string }>> => {
  const status = await requestJson<{ version?: { version?: string; gameData?: string } }>(`${RAIDBOTS_BASE}/api/status`)
  if (isErr(status)) return err("could not read raidbots status", status)

  const { version, gameData } = status.version ?? {}
  if (!version || !gameData) return err("raidbots status returned no version info", undefined)
  return { frontendJsHash: version, gameDataVersion: gameData }
}
