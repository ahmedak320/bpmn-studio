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
const sessionUsage = new Map<LiteProviderId, UsageTotals>()

// --- OpenRouter credits lookup ---------------------------------------------

export type CreditsErrorKind = 'auth' | 'network' | 'timeout' | 'unexpected'

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

/**
 * Fetch the OpenRouter account balance for the given API key. Throws
 * {@link CreditsError} on any failure: 401/403 -> "auth", an aborted (timed
 * out) request -> "timeout", a rejected fetch (offline/CORS/DNS) -> "network",
 * anything else (other non-2xx status, missing/malformed fields) ->
 * "unexpected".
 */
export async function fetchOpenRouterCredits(
  apiKey: string,
  fetchImpl: typeof fetch = fetch
): Promise<OpenRouterCredits> {
  const ctrl = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    ctrl.abort()
  }, CREDITS_TIMEOUT_MS)

  let res: Response
  try {
    res = await fetchImpl('https://openrouter.ai/api/v1/credits', {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: ctrl.signal
    })
  } catch (error) {
    clearTimeout(timer)
    if (timedOut) throw new CreditsError('timeout', 'Request timed out')
    const msg = error instanceof Error ? error.message : String(error)
    throw new CreditsError('network', msg)
  }
  clearTimeout(timer)

  if (res.status === 401 || res.status === 403) {
    throw new CreditsError('auth', `Authentication failed (HTTP ${res.status})`)
  }
  if (!res.ok) {
    throw new CreditsError('unexpected', `Unexpected response (HTTP ${res.status})`)
  }

  let json: unknown
  try {
    json = await res.json()
  } catch {
    throw new CreditsError('unexpected', 'Response was not valid JSON')
  }

  const data = (json as { data?: unknown } | null)?.data as
    { total_credits?: unknown; total_usage?: unknown } | undefined
  const totalCredits = data?.total_credits
  const totalUsage = data?.total_usage
  if (typeof totalCredits !== 'number' || typeof totalUsage !== 'number') {
    throw new CreditsError('unexpected', 'Response was missing credits fields')
  }

  return {
    totalCredits,
    totalUsage,
    remaining: Math.max(0, totalCredits - totalUsage)
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

/** Read the stored usage totals for a provider, or null if none/corrupted. */
export function getUsage(providerId: LiteProviderId): UsageTotals | null {
  try {
    const raw = localStorage.getItem(usageKey(providerId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<UsageTotals>
    if (
      typeof parsed.requests !== 'number' ||
      typeof parsed.inputTokens !== 'number' ||
      typeof parsed.outputTokens !== 'number' ||
      typeof parsed.since !== 'number'
    ) {
      return null
    }
    const legacyCost =
      typeof (parsed as Partial<UsageTotals> & { estCostUsd?: unknown }).estCostUsd === 'number'
        ? (parsed as Partial<UsageTotals> & { estCostUsd: number }).estCostUsd
        : null
    const costUsd =
      typeof parsed.costUsd === 'number'
        ? parsed.costUsd
        : parsed.costUsd === null
          ? null
          : legacyCost
    const costKind: UsageTotals['costKind'] =
      parsed.costKind === 'provider' ||
      parsed.costKind === 'estimated' ||
      parsed.costKind === 'mixed' ||
      parsed.costKind === 'unknown'
        ? parsed.costKind
        : costUsd === null
          ? 'unknown'
          : 'estimated'
    return {
      requests: parsed.requests,
      inputTokens: parsed.inputTokens,
      outputTokens: parsed.outputTokens,
      reasoningTokens: typeof parsed.reasoningTokens === 'number' ? parsed.reasoningTokens : 0,
      costUsd,
      costKind,
      since: parsed.since
    }
  } catch {
    return null
  }
}

function writeUsage(providerId: LiteProviderId, totals: UsageTotals): void {
  try {
    localStorage.setItem(usageKey(providerId), JSON.stringify(totals))
  } catch {
    /* ignore — private mode / disabled storage */
  }
}

export interface RecordUsageInput {
  inputTokens: number
  outputTokens: number
  reasoningTokens?: number
  /** Provider-reported request cost, preferred over local estimation. */
  providerCostUsd?: number
  modelId: string
}

function combineCostKind(
  existing: UsageTotals['costKind'] | undefined,
  next: UsageTotals['costKind']
): UsageTotals['costKind'] {
  if (!existing || existing === next) return next
  if (existing === 'unknown' || next === 'unknown') return 'unknown'
  return 'mixed'
}

function addUsage(existing: UsageTotals | null, input: RecordUsageInput, now: number): UsageTotals {
  const estimated = estimateCostUsd(input.modelId, input.inputTokens, input.outputTokens)
  const costDelta = typeof input.providerCostUsd === 'number' ? input.providerCostUsd : estimated
  const deltaKind: UsageTotals['costKind'] =
    typeof input.providerCostUsd === 'number'
      ? 'provider'
      : estimated === null
        ? 'unknown'
        : 'estimated'
  return {
    requests: (existing?.requests ?? 0) + 1,
    inputTokens: (existing?.inputTokens ?? 0) + input.inputTokens,
    outputTokens: (existing?.outputTokens ?? 0) + input.outputTokens,
    reasoningTokens: (existing?.reasoningTokens ?? 0) + (input.reasoningTokens ?? 0),
    // Once any component is unknown, the aggregate is unknown; never display a
    // misleading partial dollar sum.
    costUsd:
      costDelta === null || existing?.costUsd === null
        ? null
        : (existing?.costUsd ?? 0) + costDelta,
    costKind: combineCostKind(existing?.costKind, deltaKind),
    since: existing?.since ?? now
  }
}

function notifyUsage(providerId: LiteProviderId): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(USAGE_EVENT, { detail: providerId }))
  }
}

/** Accumulate one request in separate session and all-time ledgers. */
export function recordUsage(providerId: LiteProviderId, input: RecordUsageInput): void {
  const now = Date.now()
  const allTime = addUsage(getUsage(providerId), input, now)
  const session = addUsage(sessionUsage.get(providerId) ?? null, input, now)
  writeUsage(providerId, allTime)
  sessionUsage.set(providerId, session)
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
  try {
    localStorage.removeItem(usageKey(providerId))
  } catch {
    /* ignore */
  }
  notifyUsage(providerId)
}

export function subscribeUsage(listener: (providerId: LiteProviderId) => void): () => void {
  if (typeof window === 'undefined') return () => undefined
  const onUsage = (event: Event): void => listener((event as CustomEvent<LiteProviderId>).detail)
  window.addEventListener(USAGE_EVENT, onUsage)
  return () => window.removeEventListener(USAGE_EVENT, onUsage)
}

export function resetSessionUsageForTests(): void {
  sessionUsage.clear()
}

// --- cost estimation ---------------------------------------------------------

interface ModelPrice {
  /** USD per 1M input tokens. */
  in: number
  /** USD per 1M output tokens. */
  out: number
}

/** Date on which the bundled fallback prices were last reviewed. */
export const ESTIMATED_PRICE_AS_OF = '2026-07-26'

// Best-effort public list prices (USD / 1M tokens) as of the date above. Not
// guaranteed to the cent — surfaced in the UI as an estimate only. Includes
// both the OpenRouter `provider/model` slugs (providersLite.ts) and the bare
// vendor ids used directly by the Anthropic/Gemini adapters
// (providerCatalog PROVIDERS.anthropic.models / PROVIDERS.gemini.models).
const PRICES: Record<string, ModelPrice> = {
  // OpenRouter slugs
  'z-ai/glm-5.2': { in: 0.6, out: 2.2 },
  'moonshotai/kimi-k3': { in: 0.6, out: 2.5 },
  'deepseek/deepseek-v4-pro': { in: 0.55, out: 2.19 },
  'deepseek/deepseek-v4-flash': { in: 0.14, out: 0.28 },
  'anthropic/claude-opus-4.8': { in: 15, out: 75 },
  'anthropic/claude-sonnet-5': { in: 3, out: 15 },
  'google/gemini-3.6-flash': { in: 0.3, out: 2.5 },
  // Bare Anthropic ids (direct adapter)
  'claude-opus-4-8': { in: 15, out: 75 },
  'claude-sonnet-5': { in: 3, out: 15 },
  // Bare Gemini ids (direct adapter)
  'gemini-flash-latest': { in: 0.3, out: 2.5 },
  'gemini-3-pro-preview': { in: 1.25, out: 10 }
}

/** Estimate USD cost for a request, or null when the model id is unknown. */
export function estimateCostUsd(
  modelId: string,
  inputTokens: number,
  outputTokens: number
): number | null {
  const price = PRICES[modelId]
  if (!price) return null
  return (inputTokens / 1_000_000) * price.in + (outputTokens / 1_000_000) * price.out
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
    if (!responseJson || typeof responseJson !== 'object') return null
    const obj = responseJson as Record<string, unknown>

    if (providerId === 'anthropic') {
      const usage = obj.usage as Record<string, unknown> | undefined
      const inputTokens = usage?.input_tokens
      const outputTokens = usage?.output_tokens
      if (typeof inputTokens !== 'number' || typeof outputTokens !== 'number') return null
      const outputDetails = usage?.output_tokens_details as Record<string, unknown> | undefined
      const reasoningTokens =
        typeof outputDetails?.reasoning_tokens === 'number' ? outputDetails.reasoning_tokens : 0
      return { inputTokens, outputTokens, reasoningTokens }
    }

    if (providerId === 'gemini') {
      const usageMetadata = obj.usageMetadata as Record<string, unknown> | undefined
      const inputTokens = usageMetadata?.promptTokenCount
      const outputTokens = usageMetadata?.candidatesTokenCount
      if (typeof inputTokens !== 'number' || typeof outputTokens !== 'number') return null
      const thoughts = usageMetadata?.thoughtsTokenCount
      return {
        inputTokens,
        outputTokens,
        reasoningTokens: typeof thoughts === 'number' ? thoughts : 0
      }
    }

    // OpenRouter uses the OpenAI-compatible usage shape.
    const usage = obj.usage as Record<string, unknown> | undefined
    const inputTokens = usage?.prompt_tokens
    const outputTokens = usage?.completion_tokens
    if (typeof inputTokens !== 'number' || typeof outputTokens !== 'number') return null
    const details = usage?.completion_tokens_details as Record<string, unknown> | undefined
    const reasoning = details?.reasoning_tokens
    const providerCost = usage?.cost
    return {
      inputTokens,
      outputTokens,
      reasoningTokens: typeof reasoning === 'number' ? reasoning : 0,
      ...(typeof providerCost === 'number' ? { providerCostUsd: providerCost } : {})
    }
  } catch {
    return null
  }
}
