import { prisma } from "#lib/db.ts"

/** Shape of a `slot: "socket"` entry in Raidbots' `enchantments.json`. */
export interface EnchantmentEntry {
  id?: number
  slot?: string
  socketType?: string
  expansion?: number
  craftingQuality?: number
  displayName?: string
  itemId?: number
  itemName?: string
  algariColor?: string | null
  quality?: number
}

export interface SelectableGem {
  itemId: number
  displayName: string
  itemName: string
  color: string
}

/**
 * The preferred-gem dropdown, derived from Raidbots' own enchantment data rather than a hardcoded list.
 *
 * Keyed on `itemId`, never `id`: Raidbots passes this value straight into SimC's `gem_id=`, and an enchant id fails the
 * whole sim with "No gem data for id".
 *
 * `algariColor` is the filter because it reproduces Raidbots' own list exactly. Their picker keys off a server-side
 * `dps` flag we cannot fetch, but every gem carrying a colour is flagged and every one without it (the unique-equipped
 * Eversong Diamonds and Heliotropes) is absent from their UI: 64 of the 75 current socket entries, ids identical.
 *
 * Narrowed further than Raidbots, to the newest expansion and the best rank of each gem: nobody raiding picks a
 * lower-quality gem, and 16 options browse better than 64. Taking the maxima rather than pinning numbers means an
 * expansion bump needs no code change.
 */
// Item quality dominates crafting quality: a Flawless rank 1 beats a plain rank 2.
const rank = (entry: EnchantmentEntry): number => (entry.quality ?? 0) * 10 + (entry.craftingQuality ?? 0)

export const selectableGems = (entries: EnchantmentEntry[]): SelectableGem[] => {
  const sockets = entries.filter(
    (entry) => entry.slot === "socket" && typeof entry.itemId === "number" && Boolean(entry.algariColor),
  )
  if (sockets.length === 0) return []

  const expansion = Math.max(...sockets.map((entry) => entry.expansion ?? 0))
  const current = sockets.filter((entry) => (entry.expansion ?? 0) === expansion)

  const best = Math.max(...current.map(rank))

  const gems = current
    .filter((entry) => rank(entry) === best)
    .map((entry) => ({
      itemId: entry.itemId ?? 0,
      displayName: entry.displayName ?? entry.itemName ?? "unknown gem",
      itemName: entry.itemName ?? "",
      color: entry.algariColor ?? "",
    }))

  return gems.toSorted((a, b) =>
    a.color === b.color ? a.displayName.localeCompare(b.displayName) : a.color.localeCompare(b.color),
  )
}

/** Grouped for `<optgroup>`, in the order {@link selectableGems} produced. */
export const groupGemsByColor = (gems: SelectableGem[]): { color: string; gems: SelectableGem[] }[] => {
  const groups = new Map<string, SelectableGem[]>()
  for (const gem of gems) groups.set(gem.color, [...(groups.get(gem.color) ?? []), gem])

  return [...groups].map(([color, entries]) => ({ color, gems: entries }))
}

export const listGems = async (): Promise<SelectableGem[]> => {
  const rows = await prisma.gem.findMany({ orderBy: { sortIndex: "asc" } })
  return rows.map((row) => ({
    itemId: row.itemId,
    displayName: row.displayName,
    itemName: row.itemName,
    color: row.color,
  }))
}
