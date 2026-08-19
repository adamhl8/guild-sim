import type { Result } from "ts-explicit-errors"
import { err, isErr } from "ts-explicit-errors"

import { env } from "#env.ts"
import { prisma } from "#lib/db.ts"
import type { EnchantmentEntry } from "#lib/gems.ts"
import { selectableGems } from "#lib/gems.ts"
import type { Instance } from "#lib/raidbots/static-data.ts"
import { staticData } from "#lib/raidbots/static-data.ts"
import { seasonNumberForInstance } from "#lib/raidbots/upgrade-track.ts"
import { updateSettings } from "#lib/settings.ts"
import { getCharacters } from "#lib/wowaudit/characters.ts"
import { createWowauditClient } from "#lib/wowaudit/client.ts"
import { getSeason } from "#lib/wowaudit/period.ts"
import { getTeam } from "#lib/wowaudit/team.ts"

interface Metadata {
  wowBuild?: string
}

export const syncRoster = async (): Promise<Result<number>> => {
  const client = createWowauditClient(env.WOWAUDIT_API_KEY)

  const team = await getTeam(client)
  if (isErr(team)) return err("could not read the wowaudit team", team)

  const roster = await getCharacters(client)
  if (isErr(roster)) return err("could not read the wowaudit roster", roster)

  // An empty roster is a valid HTTP response but never a plausible team, and the prune below would read it
  // as "everyone left": every row deleted, cascading through claims into the stored pastes, unrecoverably.
  // So refuse it rather than reconcile against it, the way claim.ts refuses to wipe claims it cannot verify.
  if (roster.length === 0) return err("wowaudit returned an empty roster, so nothing was changed", undefined)

  const syncedAt = new Date()
  for (const character of roster) {
    await prisma.rosterCharacter.upsert({
      where: { id: character.id },
      update: {
        name: character.name,
        realm: character.realm,
        class: character.class,
        role: character.role,
        rank: character.rank,
        blizzardId: character.blizzardId,
        syncedAt,
      },
      create: {
        id: character.id,
        name: character.name,
        realm: character.realm,
        class: character.class,
        role: character.role,
        rank: character.rank,
        blizzardId: character.blizzardId,
        syncedAt,
      },
    })
  }

  // Anyone no longer tracked in wowaudit loses their claims along with the row.
  await prisma.rosterCharacter.deleteMany({ where: { syncedAt: { lt: syncedAt } } })
  await updateSettings({ region: team.region })

  return roster.length
}

const syncSources = async (): Promise<Result<number>> => {
  const instances = await staticData<Instance[]>("instances")
  if (isErr(instances)) return instances

  const raids = instances.filter((instance) => instance.type === "raid")
  const syncedAt = new Date()

  for (const raid of raids) {
    const seasonNumber = seasonNumberForInstance(instances, raid.id)
    const data = {
      name: raid.name,
      type: raid.type,
      seasonNumber: seasonNumber ?? null,
      syncedAt,
    }
    await prisma.source.upsert({
      where: { raidbotsId: raid.id },
      update: data,
      create: { raidbotsId: raid.id, ...data },
    })
  }

  await prisma.source.deleteMany({ where: { syncedAt: { lt: syncedAt } } })

  // wowaudit's current raids pin which season the aggregate source should resolve to. Raidbots can be a
  // season ahead, so this is derived from wowaudit rather than from whatever Raidbots calls active.
  const client = createWowauditClient(env.WOWAUDIT_API_KEY)
  const season = await getSeason(client)
  if (!isErr(season)) {
    const [first] = season.instances
    const seasonNumber = first ? seasonNumberForInstance(instances, first.raidbotsId) : undefined
    if (seasonNumber !== undefined) await updateSettings({ currentSeasonNumber: seasonNumber })
  }

  return raids.length
}

const syncGems = async (): Promise<Result<number>> => {
  const entries = await staticData<EnchantmentEntry[]>("enchantments")
  if (isErr(entries)) return entries

  const gems = selectableGems(entries)
  const syncedAt = new Date()

  for (const [sortIndex, gem] of gems.entries()) {
    const data = { displayName: gem.displayName, itemName: gem.itemName, color: gem.color, sortIndex, syncedAt }
    await prisma.gem.upsert({ where: { itemId: gem.itemId }, update: data, create: { itemId: gem.itemId, ...data } })
  }

  await prisma.gem.deleteMany({ where: { syncedAt: { lt: syncedAt } } })
  return gems.length
}

const syncBuild = async (): Promise<Result> => {
  const metadata = await staticData<Metadata>("metadata")
  if (isErr(metadata)) return metadata
  if (metadata.wowBuild) await updateSettings({ liveWowBuild: metadata.wowBuild })
  return undefined
}

/**
 * Refreshes everything the UI and the staleness gate read, so neither needs a redeploy to stay current.
 *
 * Every sub-sync runs regardless of its siblings, so the return value collects their failures rather than
 * short-circuiting. The console keeps the full `messageChain`; the returned message is the short form the admin sees
 * when they press Sync now.
 */
export const runSync = async (): Promise<Result> => {
  const failures: string[] = []

  const roster = await syncRoster()
  if (isErr(roster)) {
    console.error(`sync: roster failed -> ${roster.messageChain}`)
    failures.push(roster.message)
  } else console.info(`sync: ${String(roster)} roster characters`)

  const sources = await syncSources()
  if (isErr(sources)) {
    console.error(`sync: sources failed -> ${sources.messageChain}`)
    failures.push(sources.message)
  } else console.info(`sync: ${String(sources)} raid sources`)

  const gems = await syncGems()
  if (isErr(gems)) {
    console.error(`sync: gems failed -> ${gems.messageChain}`)
    failures.push(gems.message)
  } else console.info(`sync: ${String(gems)} selectable gems`)

  const build = await syncBuild()
  if (isErr(build)) {
    console.error(`sync: wow build failed -> ${build.messageChain}`)
    failures.push(build.message)
  }

  return failures.length > 0 ? err(failures.join("; "), undefined) : undefined
}
