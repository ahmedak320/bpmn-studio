// Credits + usage tracking for Lite — OpenRouter balance lookups and a local,
// best-effort usage/cost ledger. Unlike the desktop app there is no server-side
// account to query for non-OpenRouter providers, so usage is estimated from the
// token counts each provider's response reports and accumulated in
// localStorage, scoped to this browser profile (same storage-guard style as
// keys.ts — every access is try/catch-guarded so a private-mode / disabled
// storage failure degrades silently instead of crashing the app).

import type { LiteProviderId } from './providersLite'

const USAGE_PREFIX = 'orbitpm.lite.usage.'

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
    | { total_credits?: unknown; total_usage?: unknown }
    | undefined
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
  estCostUsd: number | null
  since: number
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
    const estCostUsd = typeof parsed.estCostUsd === 'number' ? parsed.estCostUsd : null
    return {
      requests: parsed.requests,
      inputTokens: parsed.inputTokens,
      outputTokens: parsed.outputTokens,
      estCostUsd,
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
  modelId: string
}

/** Accumulate one request's token usage (and estimated cost, when computable). */
export function recordUsage(providerId: LiteProviderId, input: RecordUsageInput): void {
  const existing = getUsage(providerId)
  const costDelta = estimateCostUsd(input.modelId, input.inputTokens, input.outputTokens)

  const requests = (existing?.requests ?? 0) + 1
  const inputTokens = (existing?.inputTokens ?? 0) + input.inputTokens
  const outputTokens = (existing?.outputTokens ?? 0) + input.outputTokens
  const since = existing?.since ?? Date.now()
  const estCostUsd =
    costDelta === null
      ? (existing?.estCostUsd ?? null)
      : (existing?.estCostUsd ?? 0) + costDelta

  writeUsage(providerId, { requests, inputTokens, outputTokens, estCostUsd, since })
}

/** Clear the stored usage ledger for a provider. */
export function resetUsage(providerId: LiteProviderId): void {
  try {
    localStorage.removeItem(usageKey(providerId))
  } catch {
    /* ignore */
  }
}

// --- cost estimation ---------------------------------------------------------

interface ModelPrice {
  /** USD per 1M input tokens. */
  in: number
  /** USD per 1M output tokens. */
  out: number
}

// Best-effort public list prices (USD / 1M tokens) as of this writing. Not
// guaranteed to the cent — surfaced in the UI as an estimate only. Includes
// both the OpenRouter `provider/model` slugs (providersLite.ts) and the bare
// vendor ids used directly by the Anthropic/Gemini adapters
// (@app/shared/providers PROVIDERS.anthropic.models / PROVIDERS.gemini.models).
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
      return { inputTokens, outputTokens }
    }

    if (providerId === 'gemini') {
      const usageMetadata = obj.usageMetadata as Record<string, unknown> | undefined
      const inputTokens = usageMetadata?.promptTokenCount
      const outputTokens = usageMetadata?.candidatesTokenCount
      if (typeof inputTokens !== 'number' || typeof outputTokens !== 'number') return null
      return { inputTokens, outputTokens }
    }

    // openrouter + custom (OpenAI-shaped)
    const usage = obj.usage as Record<string, unknown> | undefined
    const inputTokens = usage?.prompt_tokens
    const outputTokens = usage?.completion_tokens
    if (typeof inputTokens !== 'number' || typeof outputTokens !== 'number') return null
    return { inputTokens, outputTokens }
  } catch {
    return null
  }
}
