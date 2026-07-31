// Credits + usage tracking for Lite — OpenRouter balance lookups and a local,
// best-effort usage/cost ledger. Unlike the desktop app there is no server-side
// account to query for non-OpenRouter providers, so usage is estimated from the
// token counts each provider's response reports and accumulated in
// localStorage, scoped to this browser profile (same storage-guard style as
// keys.ts — every access is try/catch-guarded so a private-mode / disabled
// storage failure degrades silently instead of crashing the app).

import type { LiteProviderId } from './providersLite'

const USAGE_PREFIX = 'orbitpm.lite.usage.'
const USAGE_EVENT = 'orbitpm:ai-usage'
const USAGE_LOCK_PREFIX = 'orbitpm.lite.usage.lock.'
const USAGE_FALLBACK_SEGMENT = '.fallback.'
const USAGE_OVERFLOW_SUFFIX = '.fallback-overflow'
const USAGE_RESET_GENERATION_SUFFIX = '.reset-generation'
const USAGE_WRITER_SESSION_KEY = 'orbitpm.lite.usage.writer-id'
const LITE_PROVIDER_IDS: readonly LiteProviderId[] = ['openrouter', 'anthropic', 'gemini']
const sessionUsage = new Map<LiteProviderId, UsageTotals>()

/** Far above current provider context windows, while still excluding poison values. */
export const MAX_USAGE_TOKENS_PER_REQUEST = 10_000_000
/** Bounded lifetime ledger ceilings prevent repeated valid deltas overflowing JS numbers. */
export const MAX_USAGE_LEDGER_TOKENS = 1_000_000_000_000
export const MAX_USAGE_LEDGER_REQUESTS = 1_000_000_000
export const MAX_PROVIDER_COST_USD = 1_000_000
export const MAX_USAGE_LEDGER_COST_USD = 1_000_000_000
/** One fixed-size aggregate per fallback tab; never one localStorage item per request. */
export const MAX_USAGE_FALLBACK_SHARDS = 32
/** Bound work even when another script has filled localStorage with unrelated keys. */
const MAX_USAGE_STORAGE_KEYS_SCANNED = 4_096
/** Bound stored-record parsing and reset-marker snapshots from hostile same-origin storage. */
const MAX_USAGE_STORED_RECORD_CHARS = 128 * 1024
const MAX_USAGE_RESET_SNAPSHOT_RECORD_CHARS = 4 * 1024
const MAX_USAGE_RESET_SNAPSHOT_TOTAL_CHARS = 64 * 1024
const MAX_USAGE_RESET_MARKER_CHARS = 128 * 1024
/** Credit responses are tiny; this bound prevents an authenticated endpoint from streaming forever. */
export const MAX_OPENROUTER_CREDITS_RESPONSE_BYTES = 64 * 1024
export const MAX_OPENROUTER_CREDITS_RESPONSE_READS = 256

function isBoundedSafeInteger(value: unknown, max: number): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= max
}

function isBoundedMoney(value: unknown, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// --- OpenRouter credits lookup ---------------------------------------------

export type CreditsErrorKind = 'auth' | 'network' | 'timeout' | 'aborted' | 'unexpected'

export class CreditsError extends Error {
  kind: CreditsErrorKind
  constructor(kind: CreditsErrorKind, message: string) {
    super(message)
    this.name = 'CreditsError'
    this.kind = kind
  }
}

export interface OpenRouterCredits {
  totalCredits: number
  totalUsage: number
  /** max(0, totalCredits - totalUsage) — never negative. */
  remaining: number
}

const CREDITS_TIMEOUT_MS = 15_000

function cancelResponseBody(response: Response | undefined): void {
  try {
    const cancellation = response?.body?.cancel()
    void cancellation?.catch(() => undefined)
  } catch {
    // Best-effort cleanup must not replace the classified request error.
  }
}

function cancelResponseReader(reader: ReadableStreamDefaultReader<Uint8Array> | undefined): void {
  if (!reader) return
  try {
    const cancellation = reader.cancel()
    void cancellation.catch(() => undefined)
  } catch {
    // Best-effort cleanup must not replace the classified request error.
  }
}

/**
 * Fetch the OpenRouter account balance for the given API key. Throws
 * {@link CreditsError} on any failure: 401/403 -> "auth", an internal timer
 * abort -> "timeout", a caller-signal abort -> "aborted", a rejected fetch
 * (offline/CORS/DNS) -> "network", anything else (other non-2xx status,
 * missing/malformed fields) -> "unexpected".
 */
export async function fetchOpenRouterCredits(
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
  callerSignal?: AbortSignal
): Promise<OpenRouterCredits> {
  const ctrl = new AbortController()
  let timedOut = false
  let callerAborted = callerSignal?.aborted ?? false
  let response: Response | undefined
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  const abortRequest = (): void => {
    ctrl.abort()
    cancelResponseReader(reader)
  }
  const onCallerAbort = (): void => {
    callerAborted = true
    abortRequest()
  }
  callerSignal?.addEventListener('abort', onCallerAbort, { once: true })
  const timer = setTimeout(() => {
    timedOut = true
    abortRequest()
  }, CREDITS_TIMEOUT_MS)

  try {
    if (callerAborted) throw new Error('Request aborted')

    response = await fetchImpl('https://openrouter.ai/api/v1/credits', {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: ctrl.signal
    })
    if (ctrl.signal.aborted) throw new Error('Request aborted')

    if (response.status === 401 || response.status === 403) {
      cancelResponseBody(response)
      throw new CreditsError('auth', `Authentication failed (HTTP ${response.status})`)
    }
    if (!response.ok) {
      cancelResponseBody(response)
      throw new CreditsError('unexpected', `Unexpected response (HTTP ${response.status})`)
    }
    if (!response.body) {
      throw new CreditsError('unexpected', 'Response did not include a readable body')
    }

    reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let totalBytes = 0
    let readCount = 0
    while (true) {
      readCount += 1
      if (readCount > MAX_OPENROUTER_CREDITS_RESPONSE_READS) {
        cancelResponseReader(reader)
        throw new CreditsError('unexpected', 'Response body exceeded the allowed chunk count')
      }
      const next = await reader.read()
      if (ctrl.signal.aborted) throw new Error('Request aborted')
      if (next.done) break
      if (next.value.byteLength === 0) continue
      totalBytes += next.value.byteLength
      if (totalBytes > MAX_OPENROUTER_CREDITS_RESPONSE_BYTES) {
        cancelResponseReader(reader)
        throw new CreditsError('unexpected', 'Response body exceeded the allowed size')
      }
      chunks.push(next.value)
    }

    const bytes = new Uint8Array(totalBytes)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }

    let json: unknown
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      json = JSON.parse(text) as unknown
    } catch {
      throw new CreditsError('unexpected', 'Response was not valid JSON')
    }

    if (!isRecord(json) || !isRecord(json.data)) {
      throw new CreditsError('unexpected', 'Response was missing credits fields')
    }
    const totalCredits = json.data.total_credits
    const totalUsage = json.data.total_usage
    if (
      !isBoundedMoney(totalCredits, MAX_USAGE_LEDGER_COST_USD) ||
      !isBoundedMoney(totalUsage, MAX_USAGE_LEDGER_COST_USD)
    ) {
      throw new CreditsError('unexpected', 'Response was missing credits fields')
    }

    return {
      totalCredits,
      totalUsage,
      remaining: Math.max(0, totalCredits - totalUsage)
    }
  } catch (error) {
    if (timedOut) throw new CreditsError('timeout', 'Request timed out')
    if (callerAborted) throw new CreditsError('aborted', 'Request was aborted')
    if (error instanceof CreditsError) throw error
    const message = error instanceof Error ? error.message : String(error)
    throw new CreditsError('network', message)
  } finally {
    clearTimeout(timer)
    callerSignal?.removeEventListener('abort', onCallerAbort)
    if (ctrl.signal.aborted) {
      if (reader) cancelResponseReader(reader)
      else cancelResponseBody(response)
    }
    try {
      reader?.releaseLock()
    } catch {
      // The response body was already cancelled or released.
    }
  }
}

// --- local usage ledger ------------------------------------------------------

export interface UsageTotals {
  requests: number
  inputTokens: number
  outputTokens: number
  reasoningTokens: number
  /** Null means at least one request had an unknown cost. */
  costUsd: number | null
  costKind: 'provider' | 'estimated' | 'mixed' | 'unknown'
  since: number
  /** Present only when a bounded ledger cap/fallback was exceeded or became incomplete. */
  overflowed?: true
}

export interface UsageSnapshot {
  session: UsageTotals
  allTime: UsageTotals
}

function emptyUsage(since = Date.now()): UsageTotals {
  return {
    requests: 0,
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    costUsd: 0,
    costKind: 'estimated',
    since
  }
}

function usageKey(providerId: LiteProviderId): string {
  return USAGE_PREFIX + providerId
}

function resetGenerationKey(providerId: LiteProviderId): string {
  return usageKey(providerId) + USAGE_RESET_GENERATION_SUFFIX
}

function fallbackUsagePrefix(providerId: LiteProviderId): string {
  return usageKey(providerId) + USAGE_FALLBACK_SEGMENT
}

function fallbackOverflowKey(providerId: LiteProviderId): string {
  return usageKey(providerId) + USAGE_OVERFLOW_SUFFIX
}

function combineCostKind(
  existing: UsageTotals['costKind'] | undefined,
  next: UsageTotals['costKind']
): UsageTotals['costKind'] {
  if (!existing || existing === next) return next
  if (existing === 'unknown' || next === 'unknown') return 'unknown'
  return 'mixed'
}

function markUsageOverflow(totals: UsageTotals | null, since = Date.now()): UsageTotals {
  return {
    ...(totals ?? emptyUsage(since)),
    costUsd: null,
    costKind: 'unknown',
    overflowed: true
  }
}

function mergeUsageTotals(existing: UsageTotals | null, next: UsageTotals): UsageTotals {
  if (!existing) return next
  const rawRequests = existing.requests + next.requests
  const rawInputTokens = existing.inputTokens + next.inputTokens
  const rawOutputTokens = existing.outputTokens + next.outputTokens
  const rawReasoningTokens = existing.reasoningTokens + next.reasoningTokens
  const ledgerOverflow =
    existing.overflowed === true ||
    next.overflowed === true ||
    rawRequests > MAX_USAGE_LEDGER_REQUESTS ||
    rawInputTokens > MAX_USAGE_LEDGER_TOKENS ||
    rawOutputTokens > MAX_USAGE_LEDGER_TOKENS ||
    rawReasoningTokens > MAX_USAGE_LEDGER_TOKENS
  const rawCost =
    existing.costUsd === null || next.costUsd === null ? null : existing.costUsd + next.costUsd
  const costOverflow = rawCost !== null && rawCost > MAX_USAGE_LEDGER_COST_USD
  const overflowed = ledgerOverflow || costOverflow
  return {
    requests: Math.min(rawRequests, MAX_USAGE_LEDGER_REQUESTS),
    inputTokens: Math.min(rawInputTokens, MAX_USAGE_LEDGER_TOKENS),
    outputTokens: Math.min(rawOutputTokens, MAX_USAGE_LEDGER_TOKENS),
    reasoningTokens: Math.min(rawReasoningTokens, MAX_USAGE_LEDGER_TOKENS),
    costUsd: overflowed ? null : rawCost,
    costKind: overflowed ? 'unknown' : combineCostKind(existing.costKind, next.costKind),
    since: Math.min(existing.since, next.since),
    ...(overflowed ? { overflowed: true } : {})
  }
}

function parseUsageTotalsValue(parsed: unknown): UsageTotals | null {
  try {
    if (!isRecord(parsed)) return null
    if (
      !isBoundedSafeInteger(parsed.requests, MAX_USAGE_LEDGER_REQUESTS) ||
      !isBoundedSafeInteger(parsed.inputTokens, MAX_USAGE_LEDGER_TOKENS) ||
      !isBoundedSafeInteger(parsed.outputTokens, MAX_USAGE_LEDGER_TOKENS) ||
      !isBoundedSafeInteger(parsed.since, Number.MAX_SAFE_INTEGER)
    ) {
      return null
    }
    const reasoningTokens = parsed.reasoningTokens ?? 0
    if (!isBoundedSafeInteger(reasoningTokens, MAX_USAGE_LEDGER_TOKENS)) return null

    const hasLegacyCost = Object.hasOwn(parsed, 'estCostUsd')
    if (hasLegacyCost && !isBoundedMoney(parsed.estCostUsd, MAX_USAGE_LEDGER_COST_USD)) {
      return null
    }
    const hasCost = Object.hasOwn(parsed, 'costUsd')
    if (
      hasCost &&
      parsed.costUsd !== null &&
      !isBoundedMoney(parsed.costUsd, MAX_USAGE_LEDGER_COST_USD)
    ) {
      return null
    }
    if (
      hasCost &&
      hasLegacyCost &&
      (parsed.costUsd === null || parsed.costUsd !== parsed.estCostUsd)
    ) {
      return null
    }
    const legacyCost = hasLegacyCost ? (parsed.estCostUsd as number) : null
    const costUsd = hasCost ? (parsed.costUsd as number | null) : legacyCost
    const explicitCostKind =
      parsed.costKind === undefined
        ? undefined
        : parsed.costKind === 'provider' ||
            parsed.costKind === 'estimated' ||
            parsed.costKind === 'mixed' ||
            parsed.costKind === 'unknown'
          ? parsed.costKind
          : null
    if (explicitCostKind === null) return null
    if (costUsd === null && explicitCostKind !== undefined && explicitCostKind !== 'unknown') {
      return null
    }
    if (costUsd !== null && explicitCostKind === 'unknown') return null
    if (hasLegacyCost && explicitCostKind !== undefined && explicitCostKind !== 'estimated') {
      return null
    }
    const costKind: UsageTotals['costKind'] =
      explicitCostKind ?? (costUsd === null ? 'unknown' : 'estimated')
    const overflowed = parsed.overflowed === undefined ? false : parsed.overflowed === true
    if (parsed.overflowed !== undefined && !overflowed) return null
    if (overflowed && (costUsd !== null || costKind !== 'unknown')) return null

    return {
      requests: parsed.requests,
      inputTokens: parsed.inputTokens,
      outputTokens: parsed.outputTokens,
      reasoningTokens,
      costUsd,
      costKind,
      since: parsed.since,
      ...(overflowed ? { overflowed: true } : {})
    }
  } catch {
    return null
  }
}

interface StoredUsageRecord {
  readonly generation: string
  readonly totals: UsageTotals
}

interface StoredUsageRead {
  readonly readable: boolean
  readonly present: boolean
  readonly raw: string | null
  /** Null only when the stored JSON/generation itself is malformed. */
  readonly generation: string | null
  readonly totals: UsageTotals | null
  readonly ownerId: string | null
  readonly closed: boolean
}

function isUsageGeneration(value: unknown): value is string {
  return value === '' || (typeof value === 'string' && /^[a-z0-9]{16,64}$/i.test(value))
}

function parseStoredUsage(raw: string): Omit<StoredUsageRead, 'readable' | 'present'> {
  if (raw.length > MAX_USAGE_STORED_RECORD_CHARS) {
    return {
      raw,
      generation: null,
      totals: null,
      ownerId: null,
      closed: false
    }
  }
  try {
    const parsed = JSON.parse(raw) as unknown
    if (
      isRecord(parsed) &&
      (Object.hasOwn(parsed, 'totals') ||
        Object.hasOwn(parsed, 'version') ||
        Object.hasOwn(parsed, 'generation'))
    ) {
      const generation = parsed.generation
      const ownerId = parsed.ownerId
      const closed = parsed.closed
      if (
        parsed.version !== 1 ||
        !isUsageGeneration(generation) ||
        !Object.hasOwn(parsed, 'totals') ||
        (ownerId !== undefined &&
          (typeof ownerId !== 'string' || ownerId.length === 0 || ownerId.length > 64)) ||
        (closed !== undefined && closed !== true)
      ) {
        return {
          raw,
          generation: null,
          totals: null,
          ownerId: null,
          closed: false
        }
      }
      return {
        raw,
        generation,
        totals: parseUsageTotalsValue(parsed.totals),
        ownerId: ownerId ?? null,
        closed: closed === true
      }
    }
    // Records written before reset generations were introduced belong to the
    // initial generation and remain readable until the first explicit reset.
    return {
      raw,
      generation: '',
      totals: parseUsageTotalsValue(parsed),
      ownerId: null,
      closed: false
    }
  } catch {
    return {
      raw,
      generation: null,
      totals: null,
      ownerId: null,
      closed: false
    }
  }
}

function readUsageAtKey(key: string): StoredUsageRead {
  try {
    const raw = localStorage.getItem(key)
    return raw === null
      ? {
          readable: true,
          present: false,
          raw: null,
          generation: null,
          totals: null,
          ownerId: null,
          closed: false
        }
      : { readable: true, present: true, ...parseStoredUsage(raw) }
  } catch {
    return {
      readable: false,
      present: false,
      raw: null,
      generation: null,
      totals: null,
      ownerId: null,
      closed: false
    }
  }
}

interface IgnoredUsageRecord {
  readonly key: string
  readonly raw: string
}

interface ValidUsageGeneration {
  readonly valid: true
  readonly generation: string
  readonly ignoredRecords: readonly IgnoredUsageRecord[]
  readonly incomplete: boolean
}

type UsageGenerationRead = ValidUsageGeneration | { readonly valid: false }

function readUsageGeneration(providerId: LiteProviderId): UsageGenerationRead {
  try {
    const raw = localStorage.getItem(resetGenerationKey(providerId))
    if (raw === null) {
      return { valid: true, generation: '', ignoredRecords: [], incomplete: false }
    }
    if (isUsageGeneration(raw) && raw !== '') {
      // Generation strings were used by the first durable-reset format.
      return { valid: true, generation: raw, ignoredRecords: [], incomplete: false }
    }
    if (raw.length > MAX_USAGE_RESET_MARKER_CHARS) return { valid: false }
    const parsed = JSON.parse(raw) as unknown
    if (
      !isRecord(parsed) ||
      parsed.version !== 1 ||
      !isUsageGeneration(parsed.generation) ||
      parsed.generation === '' ||
      (parsed.incomplete !== undefined && parsed.incomplete !== true) ||
      !Array.isArray(parsed.ignoredRecords) ||
      parsed.ignoredRecords.length > MAX_USAGE_FALLBACK_SHARDS + 2
    ) {
      return { valid: false }
    }
    const ignoredRecords: IgnoredUsageRecord[] = []
    const seen = new Set<string>()
    let totalChars = 0
    for (const entry of parsed.ignoredRecords) {
      if (!isRecord(entry) || typeof entry.key !== 'string' || typeof entry.raw !== 'string') {
        return { valid: false }
      }
      const allowedKey =
        entry.key === usageKey(providerId) ||
        entry.key === fallbackOverflowKey(providerId) ||
        entry.key.startsWith(fallbackUsagePrefix(providerId))
      totalChars += entry.key.length + entry.raw.length
      if (
        !allowedKey ||
        seen.has(entry.key) ||
        entry.key.length > 256 ||
        entry.raw.length > MAX_USAGE_RESET_SNAPSHOT_RECORD_CHARS ||
        totalChars > MAX_USAGE_RESET_SNAPSHOT_TOTAL_CHARS
      ) {
        return { valid: false }
      }
      seen.add(entry.key)
      ignoredRecords.push({ key: entry.key, raw: entry.raw })
    }
    return {
      valid: true,
      generation: parsed.generation,
      ignoredRecords,
      incomplete: parsed.incomplete === true
    }
  } catch {
    return { valid: false }
  }
}

function createUsageGeneration(previous?: string): string {
  const candidate = randomUsageWriterId().slice(0, 64)
  if (!previous || candidate !== previous) return candidate
  // Preserve reset semantics even under a deterministic/mocked randomness
  // source by forcing the new tombstone to differ from its predecessor.
  return `${candidate[0] === 'a' ? 'b' : 'a'}${candidate.slice(1)}`
}

interface UsageResetSnapshot {
  readonly ignoredRecords: readonly IgnoredUsageRecord[]
  readonly incomplete: boolean
}

function captureUsageResetSnapshot(providerId: LiteProviderId): UsageResetSnapshot {
  const ignoredRecords: IgnoredUsageRecord[] = []
  let incomplete = false
  let totalChars = 0
  const capture = (key: string): void => {
    const stored = readUsageAtKey(key)
    if (!stored.readable) {
      incomplete = true
      return
    }
    if (!stored.present || stored.raw === null) return
    const entryChars = key.length + stored.raw.length
    if (
      key.length > 256 ||
      stored.raw.length > MAX_USAGE_RESET_SNAPSHOT_RECORD_CHARS ||
      totalChars + entryChars > MAX_USAGE_RESET_SNAPSHOT_TOTAL_CHARS
    ) {
      incomplete = true
      return
    }
    totalChars += entryChars
    ignoredRecords.push({ key, raw: stored.raw })
  }

  capture(usageKey(providerId))
  capture(fallbackOverflowKey(providerId))
  const fallback = listFallbackUsageKeys(providerId)
  if (!fallback.complete || fallback.keys.length > MAX_USAGE_FALLBACK_SHARDS) incomplete = true
  for (const key of fallback.keys.slice(0, MAX_USAGE_FALLBACK_SHARDS)) capture(key)
  return { ignoredRecords, incomplete }
}

function rotateUsageGeneration(
  providerId: LiteProviderId,
  mode: 'reset' | 'repair'
): {
  readonly generation: string
  readonly persisted: boolean
} {
  const previous = readUsageGeneration(providerId)
  const generation = createUsageGeneration(previous.valid ? previous.generation : undefined)
  const snapshot =
    mode === 'reset'
      ? captureUsageResetSnapshot(providerId)
      : { ignoredRecords: [], incomplete: true }
  try {
    localStorage.setItem(
      resetGenerationKey(providerId),
      JSON.stringify({
        version: 1,
        generation,
        ignoredRecords: snapshot.ignoredRecords,
        ...(snapshot.incomplete ? { incomplete: true } : {})
      })
    )
    return { generation, persisted: true }
  } catch {
    // Storage-disabled mode remains best effort; session totals still reset.
    return { generation, persisted: false }
  }
}

function ensureUsageGeneration(providerId: LiteProviderId): string {
  const current = readUsageGeneration(providerId)
  if (current.valid) return current.generation
  const rotated = rotateUsageGeneration(providerId, 'repair')
  // Repairing a malformed/unreadable tombstone is not a user-requested reset:
  // preserve the uncertainty explicitly while giving subsequent deltas a
  // valid generation in which they can be retained.
  return rotated.generation
}

function isIgnoredUsageRecord(
  generation: ValidUsageGeneration,
  key: string,
  stored: StoredUsageRead
): boolean {
  if (!stored.present || stored.raw === null) return false
  return generation.ignoredRecords.some((entry) => entry.key === key && entry.raw === stored.raw)
}

interface FallbackUsageKeyList {
  readonly keys: string[]
  /** False means some storage state could not be inspected and totals are only a lower bound. */
  readonly complete: boolean
}

function listFallbackUsageKeys(providerId: LiteProviderId): FallbackUsageKeyList {
  const prefix = fallbackUsagePrefix(providerId)
  const keys: string[] = []
  try {
    const storageLength = localStorage.length
    const scanLength = Math.min(storageLength, MAX_USAGE_STORAGE_KEYS_SCANNED)
    for (let index = 0; index < scanLength; index += 1) {
      const key = localStorage.key(index)
      if (!key?.startsWith(prefix)) continue
      keys.push(key)
      // One extra key is enough to make overflow explicit; never collect or
      // sort an attacker-controlled/unbounded matching-key set.
      if (keys.length > MAX_USAGE_FALLBACK_SHARDS) {
        return { keys: keys.sort(), complete: false }
      }
    }
    return { keys: keys.sort(), complete: scanLength === storageLength }
  } catch {
    // Preserve any keys already inspected, but disclose that more usage may
    // exist in the unreadable portion of storage.
    return { keys: keys.sort(), complete: false }
  }
}

/** Read the stored usage totals for a provider, including bounded fallback-tab shards. */
export function getUsage(providerId: LiteProviderId): UsageTotals | null {
  const current = readUsageGeneration(providerId)
  if (!current.valid) return markUsageOverflow(null)
  const generation = current.generation
  const baseKey = usageKey(providerId)
  const base = readUsageAtKey(baseKey)
  const ignoredBase = isIgnoredUsageRecord(current, baseKey, base)
  let aggregate = base.generation === generation ? base.totals : null
  // Malformed/unreadable stored state is explicit incomplete usage, never an
  // exact-looking empty/$0 ledger.
  let overflowed =
    current.incomplete ||
    !base.readable ||
    (base.present &&
      ((base.generation !== generation && !ignoredBase) ||
        (base.generation === generation && !base.totals)))
  const shardList = listFallbackUsageKeys(providerId)
  if (!shardList.complete || shardList.keys.length > MAX_USAGE_FALLBACK_SHARDS) overflowed = true
  let currentShardCount = 0
  for (const key of shardList.keys) {
    const shard = readUsageAtKey(key)
    if (!shard.readable) {
      overflowed = true
      continue
    }
    if (shard.generation !== generation) {
      if (!isIgnoredUsageRecord(current, key, shard)) overflowed = true
      continue
    }
    currentShardCount += 1
    if (currentShardCount > MAX_USAGE_FALLBACK_SHARDS) {
      overflowed = true
      continue
    }
    if (!shard.totals) {
      overflowed = true
      continue
    }
    aggregate = mergeUsageTotals(aggregate, shard.totals)
  }
  try {
    const markerKey = fallbackOverflowKey(providerId)
    const marker = localStorage.getItem(markerKey)
    if (marker !== null) {
      if (parseFallbackOverflowMarkerGeneration(marker) === generation) {
        overflowed = true
      } else if (
        !current.ignoredRecords.some((entry) => entry.key === markerKey && entry.raw === marker)
      ) {
        // Only the exact marker captured by the reset tombstone is safely
        // stale. A changed valid or malformed value may be a late writer.
        overflowed = true
      }
    }
  } catch {
    overflowed = true
  }
  const stored = overflowed ? markUsageOverflow(aggregate) : aggregate
  const volatile = volatileAllTimeUsage.get(providerId)
  return volatile?.generation === generation ? mergeUsageTotals(stored, volatile.totals) : stored
}

function writeUsageAtKey(
  key: string,
  totals: UsageTotals,
  generation: string,
  options: { ownerId?: string; closed?: true } = {}
): boolean {
  try {
    localStorage.setItem(
      key,
      JSON.stringify({
        version: 1,
        generation,
        totals,
        revision: nextUsageWriteRevision(),
        ...(options.ownerId ? { ownerId: options.ownerId } : {}),
        ...(options.closed ? { closed: true } : {})
      })
    )
    return true
  } catch {
    return false
  }
}

function writeUsage(providerId: LiteProviderId, totals: UsageTotals, generation: string): boolean {
  return writeUsageAtKey(usageKey(providerId), totals, generation)
}

export interface RecordUsageInput {
  inputTokens: number
  outputTokens: number
  reasoningTokens?: number
  /**
   * False when the provider accepted a request but omitted usable token
   * counters. The request is still counted, while its unknown cost prevents a
   * misleading partial dollar total.
   */
  usageKnown?: boolean
  /** Provider-reported request cost, preferred over local estimation. */
  providerCostUsd?: number
  modelId: string
}

function unknownRecordUsage(modelId: unknown): RecordUsageInput {
  return {
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    usageKnown: false,
    modelId: typeof modelId === 'string' ? modelId : ''
  }
}

function normalizeRecordUsage(input: RecordUsageInput): RecordUsageInput {
  if (input.usageKnown !== undefined && typeof input.usageKnown !== 'boolean') {
    return unknownRecordUsage(input.modelId)
  }
  if (input.usageKnown === false) return unknownRecordUsage(input.modelId)

  const reasoningTokens = input.reasoningTokens ?? 0
  if (
    !isBoundedSafeInteger(input.inputTokens, MAX_USAGE_TOKENS_PER_REQUEST) ||
    !isBoundedSafeInteger(input.outputTokens, MAX_USAGE_TOKENS_PER_REQUEST) ||
    !isBoundedSafeInteger(reasoningTokens, MAX_USAGE_TOKENS_PER_REQUEST)
  ) {
    return unknownRecordUsage(input.modelId)
  }
  if (
    input.providerCostUsd !== undefined &&
    !isBoundedMoney(input.providerCostUsd, MAX_PROVIDER_COST_USD)
  ) {
    return unknownRecordUsage(input.modelId)
  }

  return {
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    reasoningTokens,
    usageKnown: true,
    ...(input.providerCostUsd !== undefined ? { providerCostUsd: input.providerCostUsd } : {}),
    modelId: typeof input.modelId === 'string' ? input.modelId : ''
  }
}

function addUsage(
  providerId: LiteProviderId,
  existing: UsageTotals | null,
  input: RecordUsageInput,
  now: number
): UsageTotals {
  const reasoningTokens = input.reasoningTokens ?? 0
  const estimated =
    input.usageKnown === false
      ? null
      : estimateProviderUsageCostUsd(
          providerId,
          input.modelId,
          input.inputTokens,
          input.outputTokens,
          reasoningTokens
        )
  const costDelta = typeof input.providerCostUsd === 'number' ? input.providerCostUsd : estimated
  const deltaKind: UsageTotals['costKind'] =
    typeof input.providerCostUsd === 'number'
      ? 'provider'
      : estimated === null
        ? 'unknown'
        : 'estimated'
  const delta: UsageTotals = {
    requests: 1,
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    reasoningTokens,
    costUsd: costDelta,
    costKind: deltaKind,
    since: now
  }
  return mergeUsageTotals(existing, delta)
}

function notifyUsage(providerId: LiteProviderId): void {
  if (typeof window !== 'undefined') {
    try {
      window.dispatchEvent(new CustomEvent(USAGE_EVENT, { detail: providerId }))
    } catch {
      // Usage persistence must not depend on DOM event availability.
    }
  }
}

interface UsageLockManager {
  request(name: string, callback: () => void): Promise<unknown>
}

interface PendingUsageOperation {
  readonly reset: boolean
  readonly delta: UsageTotals | null
  readonly writerId: string
  readonly generation: string
}

const pendingUsage = new Map<LiteProviderId, PendingUsageOperation>()
const usagePersistenceJobs = new Map<LiteProviderId, Promise<void>>()
const volatileAllTimeUsage = new Map<LiteProviderId, StoredUsageRecord>()
const fallbackShardIds = new Map<LiteProviderId, string>()
let usageWriterId: string | undefined
let usageDocumentId: string | undefined
let usageWriteSequence = 0
let usageCoordinatorEpoch = 0
let pagehideFlushInstalled = false

function getUsageLockManager(): UsageLockManager | undefined {
  if (typeof navigator === 'undefined') return undefined
  const locks = (navigator as Navigator & { locks?: UsageLockManager }).locks
  return locks && typeof locks.request === 'function' ? locks : undefined
}

function randomUsageWriterId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID().replaceAll('-', '')
    }
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
      const values = crypto.getRandomValues(new Uint32Array(4))
      return [...values].map((value) => value.toString(36).padStart(7, '0')).join('')
    }
  } catch {
    // Fall through to a session-scoped non-secret identifier.
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`.padEnd(16, '0')
}

interface UsageWriterSessionState {
  readonly version: 1
  readonly id: string
  readonly closed: boolean
}

function parseUsageWriterSessionState(raw: string | null): UsageWriterSessionState | null {
  if (raw === null || raw.length > 512) return null
  try {
    const parsed = JSON.parse(raw) as unknown
    if (
      !isRecord(parsed) ||
      parsed.version !== 1 ||
      !isUsageGeneration(parsed.id) ||
      parsed.id === '' ||
      typeof parsed.closed !== 'boolean'
    ) {
      return null
    }
    return { version: 1, id: parsed.id, closed: parsed.closed }
  } catch {
    return null
  }
}

function writeUsageWriterSessionState(id: string, closed: boolean): void {
  try {
    sessionStorage.setItem(
      USAGE_WRITER_SESSION_KEY,
      JSON.stringify({ version: 1, id, closed } satisfies UsageWriterSessionState)
    )
  } catch {
    // A document-scoped ID remains safe but cannot be reused after reload.
  }
}

function getUsageWriterId(): string {
  if (usageWriterId) {
    writeUsageWriterSessionState(usageWriterId, false)
    return usageWriterId
  }
  try {
    const stored = parseUsageWriterSessionState(sessionStorage.getItem(USAGE_WRITER_SESSION_KEY))
    // A pagehide-closed writer belongs to the same tab's previous document and
    // can be reopened without consuming another shard. An active state may
    // have been copied into a duplicated/new tab, so that document gets a
    // fresh immutable shard ID before it can race the source tab.
    if (stored?.closed) {
      usageWriterId = stored.id
      writeUsageWriterSessionState(stored.id, false)
      return stored.id
    }
  } catch {
    // Fall through to a document-scoped identifier.
  }
  usageWriterId = randomUsageWriterId().slice(0, 64)
  writeUsageWriterSessionState(usageWriterId, false)
  return usageWriterId
}

function closeUsageWriterSession(): void {
  if (usageWriterId) writeUsageWriterSessionState(usageWriterId, true)
}

function getUsageDocumentId(): string {
  usageDocumentId ??= randomUsageWriterId().slice(0, 64)
  return usageDocumentId
}

function nextUsageWriteRevision(): string {
  usageWriteSequence += 1
  return `${getUsageDocumentId()}.${usageWriteSequence.toString(36)}`
}

function rememberVolatileUsage(
  providerId: LiteProviderId,
  generation: string,
  delta: UsageTotals
): void {
  const existing = volatileAllTimeUsage.get(providerId)
  volatileAllTimeUsage.set(providerId, {
    generation,
    totals: markUsageOverflow(
      mergeUsageTotals(existing?.generation === generation ? existing.totals : null, delta)
    )
  })
}

function markFallbackOverflow(providerId: LiteProviderId, generation: string): void {
  try {
    localStorage.setItem(
      fallbackOverflowKey(providerId),
      JSON.stringify({
        version: 1,
        generation,
        revision: nextUsageWriteRevision()
      })
    )
  } catch {
    // Volatile usage below still exposes an explicit incomplete state this session.
  }
}

function parseFallbackOverflowMarkerGeneration(raw: string): string | undefined {
  if (raw === '1') return ''
  if (isUsageGeneration(raw) && raw !== '') return raw
  if (raw.length > 512) return undefined
  try {
    const parsed = JSON.parse(raw) as unknown
    if (
      !isRecord(parsed) ||
      parsed.version !== 1 ||
      !isUsageGeneration(parsed.generation) ||
      typeof parsed.revision !== 'string' ||
      parsed.revision.length === 0 ||
      parsed.revision.length > 128
    ) {
      return undefined
    }
    return parsed.generation
  } catch {
    return undefined
  }
}

function isCurrentUsageGeneration(providerId: LiteProviderId, generation: string): boolean {
  const current = readUsageGeneration(providerId)
  return current.valid && current.generation === generation
}

function preserveCurrentOverflowAfterFallbackAttempt(
  providerId: LiteProviderId,
  attemptedGeneration: string
): boolean {
  const current = readUsageGeneration(providerId)
  if (!current.valid) return false
  if (current.generation === attemptedGeneration) return true
  // The attempt mutated shared fallback state after a reset linearized. Repair
  // the current generation's evidence even when the attempt exited before a
  // shard write (enumeration/read/write failure).
  markFallbackOverflow(providerId, current.generation)
  return false
}

function fallbackSlotKey(providerId: LiteProviderId, slot: number): string {
  return `${fallbackUsagePrefix(providerId)}slot-${slot.toString().padStart(2, '0')}`
}

function fallbackSlotIndex(providerId: LiteProviderId, key: string): number | null {
  const suffix = key.slice(fallbackUsagePrefix(providerId).length)
  const match = /^slot-(\d{2})$/.exec(suffix)
  if (!match) return null
  const slot = Number(match[1])
  return slot < MAX_USAGE_FALLBACK_SHARDS ? slot : null
}

function usageWriterSlotSeed(writerId: string): number {
  // FNV-1a is sufficient for distributing non-secret random writer IDs over
  // fixed registry slots; it is not used as a security boundary.
  let hash = 0x811c9dc5
  for (let index = 0; index < writerId.length; index += 1) {
    hash ^= writerId.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

function chooseFallbackUsageKey(
  providerId: LiteProviderId,
  generation: string,
  writerId: string
): string | null {
  const listed = listFallbackUsageKeys(providerId)
  if (!listed.complete || listed.keys.length > MAX_USAGE_FALLBACK_SHARDS) {
    return listed.keys[0] ?? null
  }

  const legacyCount = listed.keys.filter(
    (key) => fallbackSlotIndex(providerId, key) === null
  ).length
  const slotCount = MAX_USAGE_FALLBACK_SHARDS - legacyCount
  if (slotCount <= 0) {
    return listed.keys[usageWriterSlotSeed(writerId) % listed.keys.length] ?? null
  }
  // Old-format keys consume registry capacity permanently. If an unexpected
  // fixed slot sits outside the remaining namespace, do not grow storage.
  if (
    listed.keys.some((key) => {
      const slot = fallbackSlotIndex(providerId, key)
      return slot !== null && slot >= slotCount
    })
  ) {
    return listed.keys[usageWriterSlotSeed(writerId) % listed.keys.length] ?? null
  }

  const ownerId = getUsageDocumentId()
  const start = usageWriterSlotSeed(writerId) % slotCount
  const slots = Array.from({ length: slotCount }, (_, offset) => (start + offset) % slotCount)

  // Prefer the current document's active bucket so repeated writes remain a
  // single aggregate even when earlier probe slots have since closed.
  for (const slot of slots) {
    const key = fallbackSlotKey(providerId, slot)
    const stored = readUsageAtKey(key)
    if (
      stored.present &&
      stored.generation === generation &&
      stored.ownerId === ownerId &&
      stored.totals
    ) {
      fallbackShardIds.set(providerId, key)
      return key
    }
  }

  // The fixed namespace is the physical cap: concurrent claimants can race on
  // a slot, but they cannot create a 33rd fallback key. Prefer an empty, stale,
  // or pagehide-closed bucket and disclose any detected collision as overflow.
  for (const slot of slots) {
    const key = fallbackSlotKey(providerId, slot)
    const stored = readUsageAtKey(key)
    if (
      !stored.present ||
      stored.generation !== generation ||
      stored.closed ||
      stored.ownerId === ownerId
    ) {
      fallbackShardIds.set(providerId, key)
      return key
    }
  }
  // Every slot is actively owned. Reuse one deterministic bucket: the
  // lock-free write is stored as overflowed below, so a concurrent overwrite
  // remains an honest lower bound while the fixed namespace cannot grow.
  const key = fallbackSlotKey(providerId, start)
  fallbackShardIds.set(providerId, key)
  return key
}

function writeFallbackUsage(
  providerId: LiteProviderId,
  delta: UsageTotals,
  writerId: string,
  generation: string
): boolean {
  const current = readUsageGeneration(providerId)
  if (!current.valid || current.generation !== generation) return false

  const key = chooseFallbackUsageKey(providerId, generation, writerId)
  if (!key) {
    markFallbackOverflow(providerId, generation)
    rememberVolatileUsage(providerId, generation, delta)
    preserveCurrentOverflowAfterFallbackAttempt(providerId, generation)
    return false
  }
  // Without a working cross-realm transaction primitive, even a fixed-slot
  // read/modify/write can race another document. Persist the useful lower
  // bound, but never present fallback-mode totals as exact.
  const existing = readUsageAtKey(key)
  const existingTotals =
    existing.readable && existing.generation === generation ? existing.totals : null
  markFallbackOverflow(providerId, generation)
  const ownerId = getUsageDocumentId()
  const written = writeUsageAtKey(
    key,
    markUsageOverflow(mergeUsageTotals(existingTotals, delta)),
    generation,
    { ownerId }
  )
  if (!written) {
    markFallbackOverflow(providerId, generation)
    rememberVolatileUsage(providerId, generation, delta)
    preserveCurrentOverflowAfterFallbackAttempt(providerId, generation)
    return false
  }
  if (!preserveCurrentOverflowAfterFallbackAttempt(providerId, generation)) {
    // A reset can linearize between the pre-write generation check and this
    // setItem. If the stale write displaced a post-reset bucket, disclose the
    // current generation as incomplete rather than silently showing exact zero.
    return false
  }
  return true
}

function closeFallbackUsage(providerId: LiteProviderId): void {
  const key = fallbackShardIds.get(providerId)
  if (!key) return
  const current = readUsageGeneration(providerId)
  const stored = readUsageAtKey(key)
  if (
    !current.valid ||
    stored.generation !== current.generation ||
    stored.ownerId !== getUsageDocumentId() ||
    !stored.totals
  ) {
    return
  }
  writeUsageAtKey(key, stored.totals, current.generation, {
    ownerId: stored.ownerId,
    closed: true
  })
}

function persistOperationUnderLock(
  providerId: LiteProviderId,
  operation: PendingUsageOperation
): void {
  const current = readUsageGeneration(providerId)
  if (!current.valid || current.generation !== operation.generation) return
  if (!operation.delta) return

  const key = usageKey(providerId)
  const base = readUsageAtKey(key)
  const next =
    !base.readable ||
    (base.present &&
      base.generation !== operation.generation &&
      !isIgnoredUsageRecord(current, key, base)) ||
    (base.generation === operation.generation && !base.totals)
      ? markUsageOverflow(operation.delta)
      : mergeUsageTotals(
          base.generation === operation.generation ? base.totals : null,
          operation.delta
        )
  if (!writeUsage(providerId, next, operation.generation)) {
    writeFallbackUsage(providerId, operation.delta, operation.writerId, operation.generation)
  }
}

function persistOperationFallback(
  providerId: LiteProviderId,
  operation: PendingUsageOperation
): void {
  if (!isCurrentUsageGeneration(providerId, operation.generation)) return
  if (operation.delta) {
    writeFallbackUsage(providerId, operation.delta, operation.writerId, operation.generation)
  }
}

function flushPendingUsageFallback(providerId: LiteProviderId): void {
  const operation = pendingUsage.get(providerId)
  if (!operation) return
  pendingUsage.delete(providerId)
  persistOperationFallback(providerId, operation)
  notifyUsage(providerId)
}

function installPagehideUsageFlush(): void {
  if (pagehideFlushInstalled || typeof window === 'undefined') return
  pagehideFlushInstalled = true
  window.addEventListener('pagehide', () => {
    for (const providerId of LITE_PROVIDER_IDS) {
      flushPendingUsageFallback(providerId)
      closeFallbackUsage(providerId)
    }
    closeUsageWriterSession()
  })
  window.addEventListener('pageshow', () => {
    if (usageWriterId) writeUsageWriterSessionState(usageWriterId, false)
  })
}

function scheduleUsagePersistence(providerId: LiteProviderId): void {
  const locks = getUsageLockManager()
  if (!locks) {
    flushPendingUsageFallback(providerId)
    return
  }
  if (usagePersistenceJobs.has(providerId)) return

  const epoch = usageCoordinatorEpoch
  let lockCallbackRan = false
  let request: Promise<unknown>
  try {
    request = locks.request(`${USAGE_LOCK_PREFIX}${providerId}`, () => {
      lockCallbackRan = true
      if (epoch !== usageCoordinatorEpoch) return
      const operation = pendingUsage.get(providerId)
      if (!operation) return
      pendingUsage.delete(providerId)
      persistOperationUnderLock(providerId, operation)
      notifyUsage(providerId)
    })
  } catch {
    flushPendingUsageFallback(providerId)
    return
  }

  // Test/polyfill lock managers may invoke the callback synchronously. Its
  // operation is already fully persisted, so do not leave an artificial
  // microtask-sized job barrier that would defer the next synchronous delta.
  if (lockCallbackRan) {
    void Promise.resolve(request).catch(() => undefined)
    return
  }

  const job = Promise.resolve(request)
    .then(() => {
      if (!lockCallbackRan && epoch === usageCoordinatorEpoch) {
        flushPendingUsageFallback(providerId)
      }
    })
    .catch(() => {
      if (epoch === usageCoordinatorEpoch) flushPendingUsageFallback(providerId)
    })
    .finally(() => {
      if (usagePersistenceJobs.get(providerId) !== job) return
      usagePersistenceJobs.delete(providerId)
      if (epoch === usageCoordinatorEpoch && pendingUsage.has(providerId)) {
        scheduleUsagePersistence(providerId)
      }
    })
  usagePersistenceJobs.set(providerId, job)
}

function queueUsageDelta(providerId: LiteProviderId, delta: UsageTotals): void {
  const generation = ensureUsageGeneration(providerId)
  const current = pendingUsage.get(providerId)
  const sameGeneration = current?.generation === generation
  pendingUsage.set(providerId, {
    reset: sameGeneration ? current.reset : false,
    delta: mergeUsageTotals(sameGeneration ? current.delta : null, delta),
    writerId: sameGeneration ? current.writerId : getUsageWriterId(),
    generation
  })
  installPagehideUsageFlush()
  scheduleUsagePersistence(providerId)
}

/** Accumulate one request in separate session and all-time ledgers. */
export function recordUsage(providerId: LiteProviderId, input: RecordUsageInput): void {
  const now = Date.now()
  const normalized = normalizeRecordUsage(input)
  const delta = addUsage(providerId, null, normalized, now)
  sessionUsage.set(providerId, mergeUsageTotals(sessionUsage.get(providerId) ?? null, delta))
  queueUsageDelta(providerId, delta)
  notifyUsage(providerId)
}

export function getUsageSnapshot(providerId: LiteProviderId): UsageSnapshot {
  return {
    session: sessionUsage.get(providerId) ?? emptyUsage(),
    allTime: getUsage(providerId) ?? emptyUsage()
  }
}

/** Clear the stored usage ledger for a provider. */
export function resetUsage(providerId: LiteProviderId): void {
  sessionUsage.delete(providerId)
  volatileAllTimeUsage.delete(providerId)
  fallbackShardIds.delete(providerId)
  const rotated = rotateUsageGeneration(providerId, 'reset')
  if (!rotated.persisted) {
    pendingUsage.delete(providerId)
    const current = readUsageGeneration(providerId)
    if (current.valid) {
      volatileAllTimeUsage.set(providerId, {
        generation: current.generation,
        totals: markUsageOverflow(null)
      })
    }
    notifyUsage(providerId)
    return
  }
  const generation = rotated.generation
  const locks = getUsageLockManager()
  pendingUsage.set(providerId, {
    reset: true,
    delta: null,
    writerId: getUsageWriterId(),
    generation
  })
  if (locks) {
    installPagehideUsageFlush()
    scheduleUsagePersistence(providerId)
  } else {
    flushPendingUsageFallback(providerId)
  }
  notifyUsage(providerId)
}

export function subscribeUsage(listener: (providerId: LiteProviderId) => void): () => void {
  if (typeof window === 'undefined') return () => undefined
  const onUsage = (event: Event): void => {
    const providerId = (event as CustomEvent<unknown>).detail
    if (LITE_PROVIDER_IDS.includes(providerId as LiteProviderId)) {
      listener(providerId as LiteProviderId)
    }
  }
  const onStorage = (event: Event): void => {
    const key = (event as StorageEvent).key
    if (key === null) {
      for (const providerId of LITE_PROVIDER_IDS) listener(providerId)
      return
    }
    const providerId = LITE_PROVIDER_IDS.find((candidate) => {
      const base = usageKey(candidate)
      return (
        key === base || key === resetGenerationKey(candidate) || key.startsWith(`${base}.fallback`)
      )
    })
    if (providerId) listener(providerId)
  }
  window.addEventListener(USAGE_EVENT, onUsage)
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener(USAGE_EVENT, onUsage)
    window.removeEventListener('storage', onStorage)
  }
}

export function resetSessionUsageForTests(): void {
  sessionUsage.clear()
  pendingUsage.clear()
  usagePersistenceJobs.clear()
  volatileAllTimeUsage.clear()
  fallbackShardIds.clear()
  usageWriterId = undefined
  usageDocumentId = undefined
  usageWriteSequence = 0
  usageCoordinatorEpoch += 1
  pagehideFlushInstalled = false
}

// --- cost estimation ---------------------------------------------------------

interface ModelPrice {
  /** USD per 1M input tokens. */
  in: number
  /** USD per 1M output tokens. */
  out: number
  /** Optional official long-context tier above 200k input tokens. */
  above200k?: {
    in: number
    out: number
  }
}

/** Date on which the bundled fallback prices were last reviewed. */
export const ESTIMATED_PRICE_AS_OF = '2026-07-31'

// Best-effort public list prices (USD / 1M tokens) as of the date above. Not
// guaranteed to the cent — surfaced in the UI as an estimate only. Includes
// both the OpenRouter `provider/model` slugs (providersLite.ts) and the bare
// vendor ids used directly by the Anthropic/Gemini adapters
// (providerCatalog PROVIDERS.anthropic.models / PROVIDERS.gemini.models).
const PRICES: Record<string, ModelPrice> = {
  // OpenRouter slugs, independently reviewed against the route catalog; do
  // not inherit these values from direct-vendor API prices.
  // glm-5.2, gemini-3.5-flash-lite and qwen3-vl route prices live-verified
  // against GET https://openrouter.ai/api/v1/models on 2026-07-31.
  'z-ai/glm-5.2': { in: 1.12, out: 3.52 },
  'moonshotai/kimi-k3': { in: 3, out: 15 },
  'deepseek/deepseek-v4-pro': { in: 0.435, out: 0.87 },
  'deepseek/deepseek-v4-flash': { in: 0.14, out: 0.28 },
  'anthropic/claude-opus-4.8': { in: 5, out: 25 },
  'anthropic/claude-sonnet-5': { in: 2, out: 10 },
  'google/gemini-3.6-flash': { in: 1.5, out: 7.5 },
  // Wave 8 curated vision routes (Create-from-PDF/Picture A/B).
  'google/gemini-3.5-flash-lite': { in: 0.3, out: 2.5 },
  'qwen/qwen3-vl-235b-a22b-instruct': { in: 0.21, out: 1.9 },
  // Bare Anthropic ids (direct adapter)
  'claude-opus-4-8': { in: 5, out: 25 },
  // Current direct promotion through 2026-08-31; the documented standard
  // $3/$15 price requires a reviewed fallback update after this snapshot.
  'claude-sonnet-5': { in: 2, out: 10 },
  // Bare Gemini ids (direct adapter)
  'gemini-3.6-flash': { in: 1.5, out: 7.5 },
  'gemini-3.1-pro-preview': {
    in: 2,
    out: 12,
    above200k: { in: 4, out: 18 }
  }
}

function calculateKnownModelCostUsd(
  modelId: string,
  inputTokens: number,
  billableOutputTokens: number
): number | null {
  if (!Object.hasOwn(PRICES, modelId)) return null
  const configuredPrice = PRICES[modelId]
  const price =
    inputTokens > 200_000 && configuredPrice.above200k ? configuredPrice.above200k : configuredPrice
  return (inputTokens / 1_000_000) * price.in + (billableOutputTokens / 1_000_000) * price.out
}

function estimateProviderUsageCostUsd(
  providerId: LiteProviderId,
  modelId: string,
  inputTokens: number,
  outputTokens: number,
  reasoningTokens: number
): number | null {
  // Gemini reports visible candidate tokens and hidden thought tokens as
  // separate billable output categories. Add thoughts here exactly once;
  // OpenRouter/Anthropic completion counters retain their provider semantics.
  const billableOutputTokens =
    providerId === 'gemini' ? outputTokens + reasoningTokens : outputTokens
  if (
    !Number.isSafeInteger(billableOutputTokens) ||
    billableOutputTokens < 0 ||
    billableOutputTokens > MAX_USAGE_TOKENS_PER_REQUEST * 2
  ) {
    return null
  }
  return calculateKnownModelCostUsd(modelId, inputTokens, billableOutputTokens)
}

/** Estimate USD cost for a request, or null when the model id is unknown. */
export function estimateCostUsd(
  modelId: string,
  inputTokens: number,
  outputTokens: number
): number | null {
  if (
    typeof modelId !== 'string' ||
    !Object.hasOwn(PRICES, modelId) ||
    !isBoundedSafeInteger(inputTokens, MAX_USAGE_TOKENS_PER_REQUEST) ||
    !isBoundedSafeInteger(outputTokens, MAX_USAGE_TOKENS_PER_REQUEST)
  ) {
    return null
  }
  return calculateKnownModelCostUsd(modelId, inputTokens, outputTokens)
}

// --- usage extraction from provider responses --------------------------------

export interface ExtractedUsage {
  inputTokens: number
  outputTokens: number
  reasoningTokens: number
  providerCostUsd?: number
}

/**
 * Pull token counts out of a raw provider response body. Defensive by
 * design — never throws; returns null when the shape doesn't match what the
 * given provider is expected to send.
 */
export function extractUsage(
  providerId: LiteProviderId,
  responseJson: unknown
): ExtractedUsage | null {
  try {
    if (!isRecord(responseJson)) return null
    const obj = responseJson

    if (providerId === 'anthropic') {
      if (!isRecord(obj.usage)) return null
      const inputTokens = obj.usage.input_tokens
      const outputTokens = obj.usage.output_tokens
      if (
        !isBoundedSafeInteger(inputTokens, MAX_USAGE_TOKENS_PER_REQUEST) ||
        !isBoundedSafeInteger(outputTokens, MAX_USAGE_TOKENS_PER_REQUEST)
      ) {
        return null
      }
      const outputDetails = obj.usage.output_tokens_details
      if (outputDetails !== undefined && !isRecord(outputDetails)) return null
      const thinkingValue = outputDetails?.thinking_tokens
      const legacyReasoningValue = outputDetails?.reasoning_tokens
      if (
        (thinkingValue !== undefined &&
          !isBoundedSafeInteger(thinkingValue, MAX_USAGE_TOKENS_PER_REQUEST)) ||
        (legacyReasoningValue !== undefined &&
          !isBoundedSafeInteger(legacyReasoningValue, MAX_USAGE_TOKENS_PER_REQUEST))
      ) {
        return null
      }
      // Current Anthropic responses use thinking_tokens. Keep the former
      // reasoning_tokens spelling only as a compatibility fallback, never add
      // both, and never add thinking to output_tokens because Anthropic defines
      // output_tokens as the inclusive billed total.
      const reasoningTokens = thinkingValue ?? legacyReasoningValue ?? 0
      if (reasoningTokens > outputTokens) return null
      return { inputTokens, outputTokens, reasoningTokens }
    }

    if (providerId === 'gemini') {
      if (!isRecord(obj.usageMetadata)) return null
      const inputTokens = obj.usageMetadata.promptTokenCount
      const outputTokens = obj.usageMetadata.candidatesTokenCount
      const thoughts = obj.usageMetadata.thoughtsTokenCount ?? 0
      if (
        !isBoundedSafeInteger(inputTokens, MAX_USAGE_TOKENS_PER_REQUEST) ||
        !isBoundedSafeInteger(outputTokens, MAX_USAGE_TOKENS_PER_REQUEST) ||
        !isBoundedSafeInteger(thoughts, MAX_USAGE_TOKENS_PER_REQUEST)
      ) {
        return null
      }
      return {
        inputTokens,
        outputTokens,
        reasoningTokens: thoughts
      }
    }

    // OpenRouter uses the OpenAI-compatible usage shape.
    if (!isRecord(obj.usage)) return null
    const inputTokens = obj.usage.prompt_tokens
    const outputTokens = obj.usage.completion_tokens
    if (
      !isBoundedSafeInteger(inputTokens, MAX_USAGE_TOKENS_PER_REQUEST) ||
      !isBoundedSafeInteger(outputTokens, MAX_USAGE_TOKENS_PER_REQUEST)
    ) {
      return null
    }
    const details = obj.usage.completion_tokens_details
    if (details !== undefined && !isRecord(details)) return null
    const reasoning = details?.reasoning_tokens ?? 0
    if (!isBoundedSafeInteger(reasoning, MAX_USAGE_TOKENS_PER_REQUEST)) return null
    const providerCost = obj.usage.cost
    if (providerCost !== undefined && !isBoundedMoney(providerCost, MAX_PROVIDER_COST_USD)) {
      return null
    }
    return {
      inputTokens,
      outputTokens,
      reasoningTokens: reasoning,
      ...(providerCost !== undefined ? { providerCostUsd: providerCost } : {})
    }
  } catch {
    return null
  }
}
