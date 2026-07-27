import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  fetchOpenRouterCredits,
  CreditsError,
  recordUsage,
  getUsage,
  getUsageSnapshot,
  resetUsage,
  resetSessionUsageForTests,
  estimateCostUsd,
  extractUsage,
  ESTIMATED_PRICE_AS_OF
} from '../credits'

// In-memory localStorage stub (vitest env is node — no DOM storage). Matches
// the pattern used by keys.test.ts.
function installMemoryStorage(): Map<string, string> {
  const store = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear()
  })
  return store
}

beforeEach(() => {
  installMemoryStorage()
  resetSessionUsageForTests()
})

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body
  } as unknown as Response
}

describe('fetchOpenRouterCredits', () => {
  it('returns totals + clamped remaining on success', async () => {
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe('https://openrouter.ai/api/v1/credits')
      expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test')
      return jsonResponse(200, { data: { total_credits: 10, total_usage: 3 } })
    })
    const result = await fetchOpenRouterCredits('sk-test', fetchImpl as unknown as typeof fetch)
    expect(result).toEqual({ totalCredits: 10, totalUsage: 3, remaining: 7 })
  })

  it('clamps remaining to 0 when usage exceeds credits', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { data: { total_credits: 5, total_usage: 12 } })
    )
    const result = await fetchOpenRouterCredits('sk-test', fetchImpl as unknown as typeof fetch)
    expect(result.remaining).toBe(0)
  })

  it('throws auth CreditsError on 401', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(401, {}))
    await expect(
      fetchOpenRouterCredits('sk-bad', fetchImpl as unknown as typeof fetch)
    ).rejects.toMatchObject({ kind: 'auth' })
  })

  it('throws auth CreditsError on 403', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(403, {}))
    const err = await fetchOpenRouterCredits('sk-bad', fetchImpl as unknown as typeof fetch).catch(
      (e) => e
    )
    expect(err).toBeInstanceOf(CreditsError)
    expect((err as CreditsError).kind).toBe('auth')
  })

  it('throws timeout CreditsError when the request aborts', async () => {
    vi.useFakeTimers()
    const fetchImpl = vi.fn((_url: string, init: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        const signal = init.signal as AbortSignal
        signal.addEventListener('abort', () => {
          const err = new Error('aborted')
          err.name = 'AbortError'
          reject(err)
        })
      })
    })
    const promise = fetchOpenRouterCredits('sk-test', fetchImpl as unknown as typeof fetch)
    const assertion = expect(promise).rejects.toMatchObject({ kind: 'timeout' })
    await vi.advanceTimersByTimeAsync(15_000)
    await assertion
    vi.useRealTimers()
  })

  it('throws network CreditsError when fetch rejects', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    })
    const err = await fetchOpenRouterCredits('sk-test', fetchImpl as unknown as typeof fetch).catch(
      (e) => e
    )
    expect(err).toBeInstanceOf(CreditsError)
    expect((err as CreditsError).kind).toBe('network')
  })

  it('throws unexpected CreditsError on other non-2xx status', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(500, {}))
    const err = await fetchOpenRouterCredits('sk-test', fetchImpl as unknown as typeof fetch).catch(
      (e) => e
    )
    expect(err).toBeInstanceOf(CreditsError)
    expect((err as CreditsError).kind).toBe('unexpected')
  })

  it('throws unexpected CreditsError when fields are missing', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { data: {} }))
    const err = await fetchOpenRouterCredits('sk-test', fetchImpl as unknown as typeof fetch).catch(
      (e) => e
    )
    expect(err).toBeInstanceOf(CreditsError)
    expect((err as CreditsError).kind).toBe('unexpected')
  })
})

describe('usage store', () => {
  it('returns null when nothing stored', () => {
    expect(getUsage('anthropic')).toBeNull()
  })

  it('creates a record on first write and sets since', () => {
    const before = Date.now()
    recordUsage('anthropic', { inputTokens: 100, outputTokens: 50, modelId: 'claude-sonnet-5' })
    const usage = getUsage('anthropic')
    expect(usage).not.toBeNull()
    expect(usage!.requests).toBe(1)
    expect(usage!.inputTokens).toBe(100)
    expect(usage!.outputTokens).toBe(50)
    expect(usage!.since).toBeGreaterThanOrEqual(before)
    expect(usage!.costUsd).toBeCloseTo((100 / 1e6) * 3 + (50 / 1e6) * 15, 10)
    expect(usage!.costKind).toBe('estimated')
  })

  it('accumulates across multiple calls, preserving since', () => {
    recordUsage('anthropic', { inputTokens: 100, outputTokens: 50, modelId: 'claude-sonnet-5' })
    const first = getUsage('anthropic')!
    recordUsage('anthropic', { inputTokens: 20, outputTokens: 10, modelId: 'claude-sonnet-5' })
    const second = getUsage('anthropic')!
    expect(second.requests).toBe(2)
    expect(second.inputTokens).toBe(120)
    expect(second.outputTokens).toBe(60)
    expect(second.since).toBe(first.since)
  })

  it('marks the aggregate cost unknown when any model is unpriced', () => {
    recordUsage('anthropic', { inputTokens: 100, outputTokens: 50, modelId: 'claude-sonnet-5' })
    recordUsage('anthropic', { inputTokens: 10, outputTokens: 10, modelId: 'unknown/model' })
    const usage = getUsage('anthropic')!
    expect(usage.costUsd).toBeNull()
    expect(usage.costKind).toBe('unknown')
    expect(usage.inputTokens).toBe(110)
  })

  it('cost stays null when every call is unpriced', () => {
    recordUsage('gemini', { inputTokens: 10, outputTokens: 10, modelId: 'unknown/model' })
    expect(getUsage('gemini')!.costUsd).toBeNull()
  })

  it('counts an accepted request with missing usage without presenting it as free', () => {
    recordUsage('openrouter', {
      inputTokens: 0,
      outputTokens: 0,
      usageKnown: false,
      modelId: 'z-ai/glm-5.2'
    })

    expect(getUsageSnapshot('openrouter')).toMatchObject({
      session: {
        requests: 1,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: null,
        costKind: 'unknown'
      },
      allTime: {
        requests: 1,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: null,
        costKind: 'unknown'
      }
    })
  })

  it('keeps session and all-time totals separate and prefers provider cost', () => {
    localStorage.setItem(
      'orbitpm.lite.usage.openrouter',
      JSON.stringify({
        requests: 4,
        inputTokens: 400,
        outputTokens: 200,
        reasoningTokens: 50,
        costUsd: 1,
        costKind: 'provider',
        since: 1
      })
    )
    recordUsage('openrouter', {
      inputTokens: 10,
      outputTokens: 5,
      reasoningTokens: 3,
      providerCostUsd: 0.000123,
      modelId: 'unknown/model'
    })
    const snapshot = getUsageSnapshot('openrouter')
    expect(snapshot.session).toMatchObject({
      requests: 1,
      reasoningTokens: 3,
      costUsd: 0.000123,
      costKind: 'provider'
    })
    expect(snapshot.allTime).toMatchObject({
      requests: 5,
      reasoningTokens: 53,
      costUsd: 1.000123,
      costKind: 'provider'
    })
  })

  it('resetUsage clears the record', () => {
    recordUsage('anthropic', { inputTokens: 100, outputTokens: 50, modelId: 'claude-sonnet-5' })
    resetUsage('anthropic')
    expect(getUsage('anthropic')).toBeNull()
  })

  it('tolerates corrupted JSON in storage, returning null', () => {
    localStorage.setItem('orbitpm.lite.usage.anthropic', '{not json')
    expect(getUsage('anthropic')).toBeNull()
  })

  it('tolerates a record missing required fields, returning null', () => {
    localStorage.setItem('orbitpm.lite.usage.anthropic', JSON.stringify({ requests: 1 }))
    expect(getUsage('anthropic')).toBeNull()
  })

  it('keeps providers independent', () => {
    recordUsage('anthropic', { inputTokens: 5, outputTokens: 5, modelId: 'claude-sonnet-5' })
    recordUsage('gemini', { inputTokens: 7, outputTokens: 7, modelId: 'gemini-flash-latest' })
    expect(getUsage('anthropic')!.inputTokens).toBe(5)
    expect(getUsage('gemini')!.inputTokens).toBe(7)
  })
})

describe('estimateCostUsd', () => {
  it('publishes the review date for locally estimated prices', () => {
    expect(ESTIMATED_PRICE_AS_OF).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('computes exact arithmetic for a known OpenRouter slug', () => {
    // z-ai/glm-5.2: in 0.6, out 2.2 per 1M tokens
    const cost = estimateCostUsd('z-ai/glm-5.2', 1_000_000, 1_000_000)
    expect(cost).toBeCloseTo(0.6 + 2.2, 10)
  })

  it('computes exact arithmetic for a known bare Anthropic id', () => {
    const cost = estimateCostUsd('claude-opus-4-8', 500_000, 250_000)
    expect(cost).toBeCloseTo(0.5 * 15 + 0.25 * 75, 10)
  })

  it('computes exact arithmetic for a known bare Gemini id', () => {
    const cost = estimateCostUsd('gemini-3-pro-preview', 2_000_000, 100_000)
    expect(cost).toBeCloseTo(2 * 1.25 + 0.1 * 10, 10)
  })

  it('returns null for an unknown model id', () => {
    expect(estimateCostUsd('totally/unknown-model', 100, 100)).toBeNull()
  })
})

describe('extractUsage', () => {
  it('extracts anthropic usage', () => {
    expect(extractUsage('anthropic', { usage: { input_tokens: 12, output_tokens: 34 } })).toEqual({
      inputTokens: 12,
      outputTokens: 34,
      reasoningTokens: 0
    })
  })

  it('extracts gemini usage', () => {
    expect(
      extractUsage('gemini', {
        usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 6 }
      })
    ).toEqual({ inputTokens: 5, outputTokens: 6, reasoningTokens: 0 })
  })

  it('extracts openrouter usage', () => {
    expect(
      extractUsage('openrouter', {
        usage: {
          prompt_tokens: 1,
          completion_tokens: 2,
          completion_tokens_details: { reasoning_tokens: 7 },
          cost: 0.004
        }
      })
    ).toEqual({
      inputTokens: 1,
      outputTokens: 2,
      reasoningTokens: 7,
      providerCostUsd: 0.004
    })
  })

  it('returns null for missing usage', () => {
    expect(extractUsage('anthropic', {})).toBeNull()
  })

  it('returns null for malformed usage fields', () => {
    expect(extractUsage('anthropic', { usage: { input_tokens: 'x' } })).toBeNull()
  })

  it('returns null for null/non-object input, never throws', () => {
    expect(extractUsage('anthropic', null)).toBeNull()
    expect(extractUsage('gemini', 'nope')).toBeNull()
    expect(extractUsage('openrouter', 42)).toBeNull()
  })
})
