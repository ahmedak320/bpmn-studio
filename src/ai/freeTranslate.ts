// Free (no-API-key) translation chain backing the Lite "Translate" button
// when no AI provider key is stored: the unofficial Google Translate web
// endpoint (client=gtx) first, with a per-text fallback to MyMemory. The
// product is a `TranslateTextsFn` for ai/translate.ts's
// `translateDiagramWithTexts`, which owns the diagram sweep / validation /
// write — this module owns ONLY the network hop.
//
// Design constraints:
//  * ONE text per HTTP request on BOTH services. Batching texts behind a
//    separator is lossy (either service may translate, move or drop the
//    separator), so it is never attempted; per-text isolation also means one
//    bad text cannot poison its neighbours.
//  * Plain GET requests with no custom headers — no CORS preflight; both
//    services answer with `Access-Control-Allow-Origin: *`. Both hosts are
//    allow-listed in lite/index.html's CSP connect-src.
//  * Per-text failure degrades to an `undefined` result slot (the entry is
//    counted as skipped and a later re-run picks it up). Only when EVERY text
//    failed with ONE consistent classified cause does the chain throw a typed
//    FreeTranslateError, so the caller can show a truthful localized toast
//    (translate.free.rate / .offline / .down) instead of "0 translated".
//  * Error taxonomy: fetch rejection while `navigator.onLine === false` ⇒
//    'offline'; rejection while online (incl. per-request timeout aborts) ⇒
//    'service'; HTTP 429 or MyMemory's quota body ⇒ 'rate'; other non-OK
//    statuses and unparseable payloads ⇒ 'service'.
//  * fetch is injectable and nothing touches the DOM, so the node vitest
//    suite drives the whole chain with fakes — see
//    src/ai/__tests__/freeTranslate.test.ts.

import type { DiagramLang } from '../editor/langToggle'
import type { TranslateTextsFn } from './translate'

// --- typed failure -----------------------------------------------------------

export type FreeErrorCode = 'rate' | 'offline' | 'service'

/**
 * Whole-service failure of the free-translate chain (or of one hop, for the
 * parser-thrown MyMemory quota case). `code` maps 1:1 onto the
 * `translate.free.*` toast keys; `service` records which hop classified it.
 */
export class FreeTranslateError extends Error {
  readonly code: FreeErrorCode
  readonly service: 'google' | 'mymemory' | 'chain'

  constructor(code: FreeErrorCode, service: 'google' | 'mymemory' | 'chain', message?: string) {
    super(message ?? `free translation failed (${service}: ${code})`)
    this.name = 'FreeTranslateError'
    this.code = code
    this.service = service
  }
}

// --- endpoints ---------------------------------------------------------------

export const GOOGLE_FREE_URL = 'https://translate.googleapis.com/translate_a/single'
export const MYMEMORY_URL = 'https://api.mymemory.translated.net/get'

function googleUrl(text: string, from: DiagramLang, to: DiagramLang): string {
  return `${GOOGLE_FREE_URL}?client=gtx&sl=${from}&tl=${to}&dt=t&q=${encodeURIComponent(text)}`
}

function myMemoryUrl(text: string, from: DiagramLang, to: DiagramLang): string {
  // The langpair pipe is %7C-encoded — some proxies mangle a raw '|'.
  return `${MYMEMORY_URL}?q=${encodeURIComponent(text)}&langpair=${encodeURIComponent(`${from}|${to}`)}`
}

// --- payload parsers (pure, unit-tested) -------------------------------------

/**
 * Interpret a Google gtx payload: `[[["<seg>","<src>",...],["<seg2>",...],
 * ...], ...]` — the translation is `data[0]`, an array of per-sentence
 * segment arrays whose first item is the translated segment. Segments are
 * joined as-is (they carry their own trailing spaces); non-array entries
 * (trailing nulls) are skipped. Returns undefined on any unexpected shape,
 * including a payload with zero string segments.
 */
export function parseGoogleResponse(data: unknown): string | undefined {
  if (!Array.isArray(data)) return undefined
  const segments = data[0]
  if (!Array.isArray(segments)) return undefined
  const parts: string[] = []
  for (const segment of segments) {
    if (Array.isArray(segment) && typeof segment[0] === 'string') parts.push(segment[0])
  }
  if (parts.length === 0) return undefined
  return parts.join('')
}

/** The tell-tale free-quota body MyMemory serves with a 200. */
const MYMEMORY_QUOTA_RE = /MYMEMORY WARNING[\s\S]*ALL AVAILABLE FREE TRANSLATIONS/i

/**
 * Interpret a MyMemory /get payload: `{responseStatus: 200, responseData:
 * {translatedText}}`. A quota-exhausted marker ("MYMEMORY WARNING: YOU USED
 * ALL AVAILABLE FREE TRANSLATIONS..." in translatedText or responseDetails)
 * or a responseStatus of 429 (number or string) THROWS
 * `FreeTranslateError('rate', 'mymemory')`; any other unexpected shape —
 * non-200 status, missing/empty text, some other warning body — returns
 * undefined.
 */
export function parseMyMemoryResponse(data: unknown): string | undefined {
  if (typeof data !== 'object' || data === null) return undefined
  const record = data as {
    responseStatus?: unknown
    responseData?: unknown
    responseDetails?: unknown
  }
  const status = Number(record.responseStatus)
  const responseData =
    typeof record.responseData === 'object' && record.responseData !== null
      ? (record.responseData as { translatedText?: unknown })
      : undefined
  const text =
    typeof responseData?.translatedText === 'string' ? responseData.translatedText : undefined
  const details = typeof record.responseDetails === 'string' ? record.responseDetails : ''

  if (
    status === 429 ||
    (text !== undefined && MYMEMORY_QUOTA_RE.test(text)) ||
    MYMEMORY_QUOTA_RE.test(details)
  ) {
    throw new FreeTranslateError('rate', 'mymemory')
  }
  if (status !== 200) return undefined
  if (text === undefined || text.trim() === '') return undefined
  // Any other MYMEMORY WARNING body is not a usable translation either.
  if (/^\s*MYMEMORY WARNING/i.test(text)) return undefined
  return text
}

// --- the chain ---------------------------------------------------------------

export interface FreeTranslateOpts {
  /** Injected fetch (tests); defaults to the global. */
  fetchImpl?: typeof fetch
  /** Parallel in-flight request cap (default 4). */
  concurrency?: number
  /**
   * Pause between one worker's consecutive requests (default 150ms) — a
   * light courtesy throttle against two rate-limited free services.
   */
  minDelayMs?: number
  /** Per-request abort budget, covering headers AND body (default 20000ms). */
  timeoutMs?: number
}

const DEFAULT_CONCURRENCY = 4
const DEFAULT_MIN_DELAY_MS = 150
const DEFAULT_TIMEOUT_MS = 20000

function isOffline(): boolean {
  try {
    return typeof navigator !== 'undefined' && navigator.onLine === false
  } catch {
    return false
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

type JsonOutcome = { ok: true; data: unknown } | { ok: false; code: FreeErrorCode }

/** One GET, classified: rejection ⇒ offline/service, 429 ⇒ rate, other
 *  non-OK / unparseable body ⇒ service. A single abort timer spans the whole
 *  request, body read included. */
async function requestJson(
  fetchImpl: typeof fetch,
  url: string,
  timeoutMs: number
): Promise<JsonOutcome> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    let response: Response
    try {
      response = await fetchImpl(url, { signal: controller.signal })
    } catch {
      return { ok: false, code: isOffline() ? 'offline' : 'service' }
    }
    if (response.status === 429) return { ok: false, code: 'rate' }
    if (!response.ok) return { ok: false, code: 'service' }
    try {
      return { ok: true, data: await response.json() }
    } catch {
      return { ok: false, code: isOffline() ? 'offline' : 'service' }
    }
  } finally {
    clearTimeout(timer)
  }
}

type TextOutcome = { ok: true; text: string } | { ok: false; code: FreeErrorCode }

/** Google first, MyMemory fallback — both hops for ONE text. When both fail,
 *  the text's single cause folds as offline > rate > service (offline
 *  dominates because nothing else can succeed; rate is the actionable one). */
async function translateOne(
  fetchImpl: typeof fetch,
  text: string,
  from: DiagramLang,
  to: DiagramLang,
  timeoutMs: number
): Promise<TextOutcome> {
  let googleCode: FreeErrorCode
  const google = await requestJson(fetchImpl, googleUrl(text, from, to), timeoutMs)
  if (google.ok) {
    const parsed = parseGoogleResponse(google.data)
    if (parsed !== undefined) return { ok: true, text: parsed }
    googleCode = 'service'
  } else {
    googleCode = google.code
  }

  let myMemoryCode: FreeErrorCode
  const myMemory = await requestJson(fetchImpl, myMemoryUrl(text, from, to), timeoutMs)
  if (myMemory.ok) {
    try {
      const parsed = parseMyMemoryResponse(myMemory.data)
      if (parsed !== undefined) return { ok: true, text: parsed }
      myMemoryCode = 'service'
    } catch (err) {
      myMemoryCode = err instanceof FreeTranslateError ? err.code : 'service'
    }
  } else {
    myMemoryCode = myMemory.code
  }

  const codes: FreeErrorCode[] = [googleCode, myMemoryCode]
  const code: FreeErrorCode = codes.includes('offline')
    ? 'offline'
    : codes.includes('rate')
      ? 'rate'
      : 'service'
  return { ok: false, code }
}

/**
 * Build the chain as a {@link TranslateTextsFn}: per-text Google-gtx →
 * MyMemory fallback, an index-claiming worker pool capped at `concurrency`,
 * a per-request abort timeout, and `minDelayMs` pacing between one worker's
 * consecutive requests. Per-text failures come back as positional
 * `undefined`s; when EVERY text failed with the same classified cause the
 * whole call throws `FreeTranslateError(code, 'chain')`.
 */
export function makeFreeTranslateTexts(opts: FreeTranslateOpts = {}): TranslateTextsFn {
  // Never call an extracted global fetch directly (illegal-invocation traps
  // in some engines) — go through a wrapper unless one was injected.
  const fetchImpl: typeof fetch = opts.fetchImpl ?? ((input, init) => fetch(input, init))
  const concurrency = Math.max(1, Math.floor(opts.concurrency ?? DEFAULT_CONCURRENCY))
  const minDelayMs = Math.max(0, opts.minDelayMs ?? DEFAULT_MIN_DELAY_MS)
  const timeoutMs = Math.max(1, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS)

  return async (texts, from, to) => {
    const results: Array<string | undefined> = new Array(texts.length).fill(undefined)
    if (texts.length === 0) return results
    const failures: Array<FreeErrorCode | undefined> = new Array(texts.length).fill(undefined)

    let nextIndex = 0
    const worker = async (): Promise<void> => {
      let first = true
      for (;;) {
        const index = nextIndex
        nextIndex += 1
        if (index >= texts.length) return
        if (!first && minDelayMs > 0) await sleep(minDelayMs)
        first = false
        const outcome = await translateOne(fetchImpl, texts[index], from, to, timeoutMs)
        if (outcome.ok) results[index] = outcome.text
        else failures[index] = outcome.code
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(concurrency, texts.length) }, () => worker())
    )

    // Whole-service failure: every text failed AND every failure classified
    // to one consistent cause. Mixed causes stay a quiet all-skipped result —
    // there is no single truthful toast for them, and a re-run is harmless.
    if (results.every((value) => value === undefined)) {
      const firstCode = failures[0]
      if (firstCode !== undefined && failures.every((code) => code === firstCode)) {
        throw new FreeTranslateError(firstCode, 'chain')
      }
    }
    return results
  }
}
