import { sleep } from "bun"
import type { Result } from "ts-explicit-errors"
import { err, isErr } from "ts-explicit-errors"

import { isOk, request, requestJson } from "#lib/http.ts"
import { RAIDBOTS_BASE } from "#lib/raidbots/session.ts"

/** Raidbots can take ~30s to publish a report after the job reports complete. */
const REPORT_PROPAGATION_TRIES = 8
const REPORT_PROPAGATION_DELAY_MS = 5000
const MAX_POLLS = 900

interface JobResponse {
  job?: {
    state?: string
    progress?: string | number
  }
  queue?: { position?: number; total?: number }
  retriesRemaining?: number
}

interface JobProgress {
  state: string
  progress: number
  queuePosition: number | undefined
}

const toProgress = (response: JobResponse): JobProgress => ({
  state: response.job?.state ?? "unknown",
  progress: Number(response.job?.progress ?? 0),
  queuePosition: response.queue?.position,
})

export interface WaitOptions {
  cookie: string
  simId: string
  pollIntervalMs: number
  onProgress?: (progress: JobProgress) => void
}

interface ReportData {
  error?: { code?: number; type?: string; soft?: boolean }
  sim?: { profilesets?: { results?: unknown[] } }
}

/** SimC prints `Error: ...` to output.txt; that line says far more than the numeric code. */
const simcErrorLine = async (simId: string): Promise<string> => {
  const output = await request(`${RAIDBOTS_BASE}/reports/${simId}/output.txt`, { retries: 0 })
  if (isErr(output) || !isOk(output)) return ""
  const line = output.body.split("\n").find((text) => text.startsWith("Error:"))
  return line ? ` -> ${line.trim()}` : ""
}

/**
 * A job reaches `complete` even when the sim itself errored, so the report has to be inspected. Uploading such a report
 * gets a confusing rejection from wowaudit rather than a useful message.
 */
const waitForReport = async (simId: string): Promise<Result> => {
  for (let attemptNumber = 0; attemptNumber < REPORT_PROPAGATION_TRIES; attemptNumber++) {
    const report = await requestJson<ReportData>(`${RAIDBOTS_BASE}/reports/${simId}/data.json`, { retries: 0 })
    if (isErr(report)) {
      await sleep(REPORT_PROPAGATION_DELAY_MS)
      continue
    }

    if (report.error) {
      const detail = await simcErrorLine(simId)
      const { code, type } = report.error
      return err(`sim ${simId} failed in simc (code ${code}, ${type})${detail}`, undefined).ctx({ simId })
    }

    const results = report.sim?.profilesets?.results ?? []
    if (results.length === 0) return err(`sim ${simId} produced no droptimizer results`, undefined).ctx({ simId })
    return undefined
  }

  return err(`sim ${simId} completed but its report never became available`, undefined)
}

/**
 * Progress can move backwards and `active` can revert to `inactive` when Raidbots rescales workers, so neither is
 * treated as failure. `failed` is only terminal once the server has no retries left.
 */
export const waitForSim = async (options: WaitOptions): Promise<Result> => {
  const { cookie, simId, pollIntervalMs, onProgress } = options

  for (let poll = 0; poll < MAX_POLLS; poll++) {
    const response = await requestJson<JobResponse>(`${RAIDBOTS_BASE}/api/job/${simId}`, { headers: { cookie } })
    if (isErr(response)) return err(`could not poll sim ${simId}`, response)

    const progress = toProgress(response)
    onProgress?.(progress)

    if (progress.state === "complete") return waitForReport(simId)
    if (progress.state === "cancelled") return err(`sim ${simId} was cancelled`, undefined)
    if (progress.state === "failed" && (response.retriesRemaining ?? 0) <= 0)
      return err(`sim ${simId} failed`, undefined).ctx({ simId })

    await sleep(pollIntervalMs)
  }

  return err(`sim ${simId} did not finish after ${MAX_POLLS} polls`, undefined)
}
