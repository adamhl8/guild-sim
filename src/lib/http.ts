import { setTimeout as sleep } from "node:timers/promises"

import type { CtxError, Result } from "ts-explicit-errors"
import { attempt, err, isErr } from "ts-explicit-errors"

/** Raidbots' DDoS protection answers 502 to requests without a custom User-Agent, so this is not optional. */
const USER_AGENT = "guild-sim/0.1 (+https://github.com/adamhl8/guild-sim)"

const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504])
const DEFAULT_RETRIES = 4
const DEFAULT_TIMEOUT_MS = 45_000
const BASE_BACKOFF_MS = 2000
const MAX_BACKOFF_MS = 120_000

export interface HttpResponse {
  status: number
  headers: Headers
  body: string
}

export interface RequestOptions {
  method?: string
  headers?: Record<string, string>
  body?: string
  timeoutMs?: number
  retries?: number
}

export const isOk = (response: HttpResponse): boolean => response.status >= 200 && response.status < 300

/**
 * Pulls the server's own explanation out of a failed {@link requestJson}. Both APIs return precise messages that the
 * status code alone hides.
 */
export const serverMessage = (error: CtxError): string => {
  const body = error.get<string>("body")
  if (!body) return ""
  // oxlint-disable-next-line typescript/no-unsafe-return -- error bodies are untyped json
  const parsed = attempt((): { message?: unknown; error?: unknown } => JSON.parse(body))
  if (isErr(parsed)) return `: ${body.slice(0, 200)}`
  const detail = parsed.message ?? parsed.error
  return typeof detail === "string" ? `: ${detail}` : ""
}

const sendOnce = async (url: string, options: RequestOptions): Promise<Result<HttpResponse>> =>
  attempt(async () => {
    // Annotated because @types/bun and Astro's DOM lib both declare fetch, and an inline literal leaves
    // the overload ambiguous.
    const init: RequestInit = {
      method: options.method ?? "GET",
      headers: { "user-agent": USER_AGENT, ...options.headers },
      body: options.body ?? null,
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    }
    const response = await fetch(url, init)
    return { status: response.status, headers: response.headers, body: await response.text() }
  })

/** Hourly quota exhaustion. Raidbots names it in the body rather than by status, and says how long to wait. */
const QUOTA_ERROR = "too_many_sims"

export interface ErrorBody {
  error?: string
  retryAfterMs?: number
}

/** Raidbots signals throttling in the body (`{"error":"too_many_sims","retryAfter":N}`) rather than a header. */
export const parseErrorBody = (body: string): ErrorBody => {
  const parsed = attempt((): unknown => JSON.parse(body))
  if (isErr(parsed) || typeof parsed !== "object" || parsed === null) return {}

  const error = "error" in parsed && typeof parsed.error === "string" ? parsed.error : undefined
  const retryAfter = "retryAfter" in parsed ? parsed.retryAfter : undefined
  const retryAfterMs = typeof retryAfter === "number" && Number.isFinite(retryAfter) ? retryAfter * 1000 : undefined

  return { ...(error === undefined ? {} : { error }), ...(retryAfterMs === undefined ? {} : { retryAfterMs }) }
}

/** How long the quota has left, or undefined when this is not a quota rejection. */
const quotaRetryAfterMs = (body: string): number | undefined => {
  const { error, retryAfterMs } = parseErrorBody(body)
  return error === QUOTA_ERROR ? (retryAfterMs ?? 0) : undefined
}

const serverRequestedDelayMs = (response: HttpResponse): number | undefined => {
  const header = Math.trunc(Number(response.headers.get("retry-after") ?? ""))
  if (Number.isFinite(header)) return header * 1000
  return parseErrorBody(response.body).retryAfterMs
}

const backoffMs = (response: HttpResponse, attemptNumber: number): number => {
  const requested = serverRequestedDelayMs(response)
  const fallback = Math.min(BASE_BACKOFF_MS * 2 ** attemptNumber, MAX_BACKOFF_MS)
  return Math.min(requested ?? fallback, MAX_BACKOFF_MS)
}

/** Retries 429/5xx with backoff. Does not treat a non-2xx status as an error -- callers decide. */
export const request = async (url: string, options: RequestOptions = {}): Promise<Result<HttpResponse>> => {
  const retries = options.retries ?? DEFAULT_RETRIES
  let last: Result<HttpResponse> = err(`no attempt was made for ${url}`, undefined)

  for (let attemptNumber = 0; attemptNumber <= retries; attemptNumber++) {
    last = await sendOnce(url, options)
    if (isErr(last)) {
      if (attemptNumber === retries) return err(`request to ${url} failed`, last)
      await sleep(Math.min(BASE_BACKOFF_MS * 2 ** attemptNumber, MAX_BACKOFF_MS))
      continue
    }

    if (!RETRYABLE_STATUSES.has(last.status) || attemptNumber === retries) return last
    // Retrying a quota rejection only hammers a service that already said no, and the wait it asks for is far longer
    // than MAX_BACKOFF_MS anyway. The caller decides how to sit it out.
    if (quotaRetryAfterMs(last.body) !== undefined) return last
    await sleep(backoffMs(last, attemptNumber))
  }

  return last
}

export const requestJson = async <T>(url: string, options: RequestOptions = {}): Promise<Result<T>> => {
  const response = await request(url, { ...options, headers: { accept: "application/json", ...options.headers } })
  if (isErr(response)) return response

  if (!isOk(response)) {
    const detail = { status: response.status, body: response.body.slice(0, 400) }
    // Set only for quota rejections, so callers can treat the key's presence as the signal.
    const quota = quotaRetryAfterMs(response.body)
    return err(`${options.method ?? "GET"} ${url} -> HTTP ${response.status}`, undefined).ctx(
      quota === undefined ? detail : { ...detail, quotaRetryAfterMs: quota },
    )
  }

  // oxlint-disable-next-line typescript/no-unsafe-return -- JSON is untyped by nature; T is the caller's contract
  const parsed = attempt((): T => JSON.parse(response.body))
  if (isErr(parsed)) return err(`could not parse json from ${url}`, parsed)
  return parsed
}
