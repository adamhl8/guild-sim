export interface Alert {
  kind: "success" | "warning" | "error"
  message: string
}

/** Outcomes of the refresh button, carried back on the redirect because the work happens across an OAuth round trip. */
const REFRESH_ALERTS: Record<string, Alert> = {
  ok: { kind: "success", message: "Characters refreshed." },
  empty: {
    kind: "warning",
    message: "We rechecked your Battle.net account and found none of its characters on the roster.",
  },
  bnet: {
    kind: "error",
    message: "Could not reach Battle.net, so nothing was refreshed. Try again in a moment.",
  },
}

export const refreshAlert = (status: string | null): Alert | undefined =>
  status === null ? undefined : REFRESH_ALERTS[status]
