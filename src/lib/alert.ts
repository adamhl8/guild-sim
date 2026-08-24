import type { ClaimStatus } from "#lib/roster/claim.ts"
import { isClaimStatus } from "#lib/roster/claim.ts"

export interface Alert {
  kind: "success" | "warning" | "error"
  message: string
}

/**
 * Outcomes of the refresh button, carried back on the redirect because the work happens across an OAuth round trip.
 * Only /submit renders these: a raider with no characters lands on /no-roster, which explains each outcome in full
 * rather than in one line.
 */
const REFRESH_ALERTS: Record<ClaimStatus, Alert> = {
  ok: { kind: "success", message: "Characters refreshed." },
  empty: {
    kind: "warning",
    message: "We rechecked your Battle.net account and found none of its characters on the roster.",
  },
  denied: {
    kind: "error",
    message: "Battle.net did not give permission to read your characters, so nothing was refreshed.",
  },
  stale: {
    kind: "error",
    message: "Your Battle.net sign-in expired before we could check, so nothing was refreshed.",
  },
  unreachable: {
    kind: "error",
    message: "Could not reach Battle.net, so nothing was refreshed. Try again in a moment.",
  },
}

export const refreshAlert = (status: string | null): Alert | undefined =>
  isClaimStatus(status) ? REFRESH_ALERTS[status] : undefined
