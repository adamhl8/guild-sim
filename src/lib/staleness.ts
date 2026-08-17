import type { AddonInfo } from "#lib/raidbots/character.ts"
import type { BuildCheck } from "#lib/settings.ts"

export interface StalenessInput {
  addonInfo: AddonInfo
  liveWowBuild: string | undefined
  buildCheck: BuildCheck
  maxPasteAgeDays: number
  now: number
}

const DAY_MS = 24 * 60 * 60 * 1000

/** `12.1.0.69299` -> `12.1.0`. A hotfix bumps only the build number, leaving item and talent data alone. */
export const patchOf = (build: string): string => build.split(".").slice(0, 3).join(".")

const buildRejection = (input: StalenessInput): string | undefined => {
  const { buildCheck, liveWowBuild } = input
  if (buildCheck === "off") return undefined

  const pasted = input.addonInfo.wowVersion
  // Nothing to compare against: a paste with no build, or before the first sync populated the live one.
  if (!pasted || !liveWowBuild) return undefined

  if (buildCheck === "exact" && pasted !== liveWowBuild)
    return `this export is from WoW build ${pasted}, but the live build is ${liveWowBuild}. Run /simc again and paste the new output.`

  if (buildCheck === "patch" && patchOf(pasted) !== patchOf(liveWowBuild))
    return `this export is from patch ${patchOf(pasted)}, but the live patch is ${patchOf(liveWowBuild)}. Run /simc again and paste the new output.`

  return undefined
}

const ageRejection = (input: StalenessInput): string | undefined => {
  const { exportedAt } = input.addonInfo
  if (!exportedAt) return undefined

  const exported = Date.parse(exportedAt)
  if (Number.isNaN(exported)) return undefined

  const ageDays = (input.now - exported) / DAY_MS
  if (ageDays <= input.maxPasteAgeDays) return undefined

  return `this export is ${String(Math.floor(ageDays))} days old and the limit is ${String(input.maxPasteAgeDays)}. Run /simc again and paste the new output.`
}

/** The reason a paste is too stale to sim, or undefined when it is acceptable. */
export const stalenessRejection = (input: StalenessInput): string | undefined =>
  buildRejection(input) ?? ageRejection(input)
