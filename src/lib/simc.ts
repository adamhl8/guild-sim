import { createHash } from "node:crypto"

/**
 * Identity of a paste, used to tell a genuine re-export from a duplicate submit.
 *
 * Deliberately hashes the exact bytes. A browser refresh replays a byte-identical body and a re-pasted clipboard is
 * byte-identical too, so both dedupe. A real `/simc` re-run carries a fresh timestamp in its header and so counts as
 * new, which is the intent: that is a deliberate act by the raider.
 */
export const contentHash = (text: string): string => createHash("sha256").update(text.trim()).digest("hex")
