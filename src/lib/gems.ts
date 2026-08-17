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
}

export interface SelectableGem {
  itemId: number
  displayName: string
  itemName: string
  color: string | null
}

/**
 * The preferred-gem dropdown, derived from Raidbots' own enchantment data rather than a hardcoded list.
 *
 * Keyed on `itemId`, never `id`: Raidbots passes this value straight into SimC's `gem_id=`, and an enchant id fails the
 * whole sim with "No gem data for id".
 *
 * Narrowed to the newest expansion and its top crafting quality, which is the list a geared raider would actually
 * socket. Taking the max rather than pinning a number means an expansion bump needs no code change.
 */
export const selectableGems = (entries: EnchantmentEntry[]): SelectableGem[] => {
  const sockets = entries.filter((entry) => entry.slot === "socket" && typeof entry.itemId === "number")
  if (sockets.length === 0) return []

  const expansion = Math.max(...sockets.map((entry) => entry.expansion ?? 0))
  const current = sockets.filter((entry) => (entry.expansion ?? 0) === expansion)

  const topQuality = Math.max(...current.map((entry) => entry.craftingQuality ?? 0))
  const best = current.filter((entry) => (entry.craftingQuality ?? 0) === topQuality)

  const gems = best.map((entry) => ({
    itemId: entry.itemId ?? 0,
    displayName: entry.displayName ?? entry.itemName ?? "unknown gem",
    itemName: entry.itemName ?? "",
    color: entry.algariColor ?? null,
  }))

  // Coloured gems first, grouped, then the uncoloured diamonds and heliotropes.
  return gems.toSorted((a, b) => {
    if ((a.color ?? "") !== (b.color ?? "")) return (a.color ?? "zzz").localeCompare(b.color ?? "zzz")
    return a.displayName.localeCompare(b.displayName)
  })
}

/** Grouped for `<optgroup>`, in the order {@link selectableGems} produced. */
export const groupGemsByColor = (gems: SelectableGem[]): { color: string; gems: SelectableGem[] }[] => {
  const groups = new Map<string, SelectableGem[]>()
  for (const gem of gems) {
    const key = gem.color ?? "other"
    groups.set(key, [...(groups.get(key) ?? []), gem])
  }
  return [...groups].map(([color, entries]) => ({ color, gems: entries }))
}

export const listGems = async (): Promise<SelectableGem[]> => {
  const rows = await prisma.gem.findMany({ orderBy: [{ color: "asc" }, { displayName: "asc" }] })
  return rows.map((row) => ({
    itemId: row.itemId,
    displayName: row.displayName,
    itemName: row.itemName,
    color: row.color,
  }))
}
