import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  fetchOpenRouterCredits,
  CreditsError,
  recordUsage,
  getUsage,
  getUsageSnapshot,
  resetUsage,
  resetSessionUsageForTests,
  subscribeUsage,
  estimateCostUsd,
  extractUsage,
  ESTIMATED_PRICE_AS_OF,
  MAX_OPENROUTER_CREDITS_RESPONSE_BYTES,
  MAX_OPENROUTER_CREDITS_RESPONSE_READS,
  MAX_PROVIDER_COST_USD,
  MAX_USAGE_FALLBACK_SHARDS,
  MAX_USAGE_LEDGER_COST_USD,
  MAX_USAGE_LEDGER_TOKENS,
  MAX_USAGE_TOKENS_PER_REQUEST
} from '../credits'

// In-memory localStorage stub (vitest env is node — no DOM storage). Matches
// the pattern used by keys.test.ts.
function installMemoryStorage(): Map<string, string> {
  const store = new Map<string, string>()
  const storage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (index: number) => [...store.keys()][index] ?? null,
    get length() {
      return store.size
    }
  }
  vi.stubGlobal('localStorage', storage)
  return store
}

function installMemorySessionStorage(): Map<string, string> {
  const store = new Map<string, string>()
  vi.stubGlobal('sessionStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
    key: (index: number) => [...store.keys()][index] ?? null,
    get length() {
      return store.size
    }
  })
  return store
}

beforeEach(() => {
  installMemoryStorage()
  installMemorySessionStorage()
  resetSessionUsageForTests()
  vi.stubGlobal('navigator', {
    locks: {
      request: vi.fn((_name: string, callback: () => void) => {
        callback()
        return Promise.resolve()
      })
    }
  })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })
}

function storageKeys(): string[] {
  return Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index)).filter(
    (key): key is string => key !== null
  )
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
  })

  it('keeps the timeout active through streamed body reads and cancels the reader', async () => {
    vi.useFakeTimers()
    let rejectRead: ((reason: unknown) => void) | undefined
    const cancel = vi.fn(() => {
      const error = new Error('cancelled')
      error.name = 'AbortError'
      rejectRead?.(error)
      return Promise.resolve()
    })
    const reader = {
      read: () =>
        new Promise<ReadableStreamReadResult<Uint8Array>>((_resolve, reject) => {
          rejectRead = reject
        }),
      cancel,
      releaseLock: vi.fn()
    }
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      body: { getReader: () => reader }
    }))

    const assertion = expect(
      fetchOpenRouterCredits('sk-test', fetchImpl as unknown as typeof fetch)
    ).rejects.toMatchObject({ kind: 'timeout' })
    await vi.advanceTimersByTimeAsync(15_000)

    await assertion
    expect(cancel).toHaveBeenCalled()
  })

  it('classifies caller cancellation distinctly and cancels a pending body reader', async () => {
    const caller = new AbortController()
    let rejectRead: ((reason: unknown) => void) | undefined
    const cancel = vi.fn(() => {
      const error = new Error('cancelled')
      error.name = 'AbortError'
      rejectRead?.(error)
      return Promise.resolve()
    })
    const reader = {
      read: () =>
        new Promise<ReadableStreamReadResult<Uint8Array>>((_resolve, reject) => {
          rejectRead = reject
        }),
      cancel,
      releaseLock: vi.fn()
    }
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      body: { getReader: () => reader }
    }))

    const assertion = expect(
      fetchOpenRouterCredits('sk-test', fetchImpl as unknown as typeof fetch, caller.signal)
    ).rejects.toMatchObject({ kind: 'aborted' })
    await vi.waitFor(() => expect(rejectRead).toBeTypeOf('function'))
    caller.abort()

    await assertion
    expect(cancel).toHaveBeenCalled()
  })

  it('rejects and cancels a 2xx response above the byte ceiling', async () => {
    const cancel = vi.fn()
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(MAX_OPENROUTER_CREDITS_RESPONSE_BYTES + 1))
      },
      cancel
    })
    const fetchImpl = vi.fn(async () => new Response(stream, { status: 200 }))

    await expect(
      fetchOpenRouterCredits('sk-test', fetchImpl as unknown as typeof fetch)
    ).rejects.toMatchObject({ kind: 'unexpected' })
    expect(cancel).toHaveBeenCalled()
  })

  it('bounds zero-byte stream iterations as well as aggregate bytes', async () => {
    const cancel = vi.fn(() => Promise.resolve())
    const read = vi.fn(async () => ({ done: false as const, value: new Uint8Array() }))
    const reader = { read, cancel, releaseLock: vi.fn() }
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      body: { getReader: () => reader }
    }))

    await expect(
      fetchOpenRouterCredits('sk-test', fetchImpl as unknown as typeof fetch)
    ).rejects.toMatchObject({ kind: 'unexpected' })
    expect(read).toHaveBeenCalledTimes(MAX_OPENROUTER_CREDITS_RESPONSE_READS)
    expect(cancel).toHaveBeenCalled()
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

  it.each([
    { total_credits: -1, total_usage: 0 },
    { total_credits: Number.POSITIVE_INFINITY, total_usage: 0 },
    { total_credits: 1e308, total_usage: 0 },
    { total_credits: 1, total_usage: Number.NaN }
  ])('rejects hostile credit totals: %o', async (data) => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { data }))
    await expect(
      fetchOpenRouterCredits('sk-test', fetchImpl as unknown as typeof fetch)
    ).rejects.toMatchObject({ kind: 'unexpected' })
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
    expect(usage!.costUsd).toBeCloseTo((100 / 1e6) * 2 + (50 / 1e6) * 10, 10)
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

  it('uses a non-destructive reset snapshot to clear malformed records explicitly', () => {
    const baseKey = 'orbitpm.lite.usage.anthropic'
    const shardKey = 'orbitpm.lite.usage.anthropic.fallback.damaged'
    localStorage.setItem(baseKey, '{bad base')
    localStorage.setItem(shardKey, '{bad shard')

    resetUsage('anthropic')

    expect(getUsage('anthropic')).toBeNull()
    expect(localStorage.getItem(baseKey)).toBe('{bad base')
    expect(localStorage.getItem(shardKey)).toBe('{bad shard')

    recordUsage('anthropic', {
      inputTokens: 3,
      outputTokens: 2,
      modelId: 'claude-sonnet-5'
    })
    expect(getUsage('anthropic')).toMatchObject({
      requests: 1,
      inputTokens: 3,
      outputTokens: 2,
      costKind: 'estimated'
    })
    expect(getUsage('anthropic')?.overflowed).toBeUndefined()
  })

  it('does not delete foreign records when a reset marker cannot be persisted', () => {
    const baseKey = 'orbitpm.lite.usage.anthropic'
    const shardKey = 'orbitpm.lite.usage.anthropic.fallback.foreign'
    const stored = JSON.stringify({
      requests: 1,
      inputTokens: 2,
      outputTokens: 1,
      reasoningTokens: 0,
      costUsd: 0.000014,
      costKind: 'estimated',
      since: 1
    })
    localStorage.setItem(baseKey, stored)
    localStorage.setItem(shardKey, stored)
    const setItem = localStorage.setItem.bind(localStorage)
    vi.spyOn(localStorage, 'setItem').mockImplementation((key: string, value: string) => {
      if (key === 'orbitpm.lite.usage.anthropic.reset-generation') {
        throw new Error('quota')
      }
      setItem(key, value)
    })
    const removeItem = vi.spyOn(localStorage, 'removeItem')

    resetUsage('anthropic')

    expect(localStorage.getItem(baseKey)).toBe(stored)
    expect(localStorage.getItem(shardKey)).toBe(stored)
    expect(removeItem).not.toHaveBeenCalled()
    expect(getUsage('anthropic')).toMatchObject({
      requests: 2,
      inputTokens: 4,
      outputTokens: 2,
      costUsd: null,
      costKind: 'unknown',
      overflowed: true
    })
  })

  it('marks corrupted JSON as incomplete instead of presenting exact zero usage', () => {
    localStorage.setItem('orbitpm.lite.usage.anthropic', '{not json')
    expect(getUsage('anthropic')).toMatchObject({
      requests: 0,
      costUsd: null,
      costKind: 'unknown',
      overflowed: true
    })
  })

  it('marks a record missing required fields as incomplete', () => {
    localStorage.setItem('orbitpm.lite.usage.anthropic', JSON.stringify({ requests: 1 }))
    expect(getUsage('anthropic')).toMatchObject({
      requests: 0,
      costUsd: null,
      costKind: 'unknown',
      overflowed: true
    })
  })

  it('marks an unreadable primary record as incomplete', () => {
    const getItem = localStorage.getItem.bind(localStorage)
    vi.spyOn(localStorage, 'getItem').mockImplementation((key: string) => {
      if (key === 'orbitpm.lite.usage.anthropic') throw new Error('blocked')
      return getItem(key)
    })

    expect(getUsage('anthropic')).toMatchObject({
      requests: 0,
      costUsd: null,
      costKind: 'unknown',
      overflowed: true
    })
  })

  it('keeps a malformed primary record incomplete after a locked write', () => {
    localStorage.setItem('orbitpm.lite.usage.anthropic', '{not json')
    vi.stubGlobal('navigator', {
      locks: {
        request: vi.fn((_name: string, callback: () => void) => {
          callback()
          return Promise.resolve()
        })
      }
    })

    recordUsage('anthropic', {
      inputTokens: 4,
      outputTokens: 2,
      modelId: 'claude-sonnet-5'
    })

    expect(getUsage('anthropic')).toMatchObject({
      requests: 1,
      inputTokens: 4,
      outputTokens: 2,
      costUsd: null,
      costKind: 'unknown',
      overflowed: true
    })
  })

  it.each(['length', 'key'] as const)(
    'marks fallback enumeration %s failures as incomplete',
    (failure) => {
      localStorage.setItem(
        'orbitpm.lite.usage.anthropic',
        JSON.stringify({
          requests: 2,
          inputTokens: 4,
          outputTokens: 2,
          reasoningTokens: 0,
          costUsd: 0.001,
          costKind: 'estimated',
          since: 1
        })
      )
      if (failure === 'length') {
        vi.spyOn(localStorage, 'length', 'get').mockImplementation(() => {
          throw new Error('blocked')
        })
      } else {
        vi.spyOn(localStorage, 'key').mockImplementation(() => {
          throw new Error('blocked')
        })
      }

      expect(getUsage('anthropic')).toMatchObject({
        requests: 2,
        inputTokens: 4,
        outputTokens: 2,
        costUsd: null,
        costKind: 'unknown',
        overflowed: true
      })
    }
  )

  it('marks an unreadable fallback-overflow marker as incomplete', () => {
    localStorage.setItem(
      'orbitpm.lite.usage.anthropic',
      JSON.stringify({
        requests: 2,
        inputTokens: 4,
        outputTokens: 2,
        reasoningTokens: 0,
        costUsd: 0.001,
        costKind: 'estimated',
        since: 1
      })
    )
    const getItem = localStorage.getItem.bind(localStorage)
    vi.spyOn(localStorage, 'getItem').mockImplementation((key: string) => {
      if (key === 'orbitpm.lite.usage.anthropic.fallback-overflow') {
        throw new Error('blocked')
      }
      return getItem(key)
    })

    expect(getUsage('anthropic')).toMatchObject({
      requests: 2,
      inputTokens: 4,
      outputTokens: 2,
      costUsd: null,
      costKind: 'unknown',
      overflowed: true
    })
  })

  it.each(['corrupt', 'a'.repeat(32)])(
    'marks malformed or initial-generation-inconsistent overflow marker %s incomplete',
    (marker) => {
      localStorage.setItem(
        'orbitpm.lite.usage.anthropic',
        JSON.stringify({
          requests: 2,
          inputTokens: 4,
          outputTokens: 2,
          reasoningTokens: 0,
          costUsd: 0.001,
          costKind: 'estimated',
          since: 1
        })
      )
      localStorage.setItem('orbitpm.lite.usage.anthropic.fallback-overflow', marker)

      expect(getUsage('anthropic')).toMatchObject({
        requests: 2,
        inputTokens: 4,
        outputTokens: 2,
        costUsd: null,
        costKind: 'unknown',
        overflowed: true
      })
    }
  )

  it('keeps providers independent', () => {
    recordUsage('anthropic', { inputTokens: 5, outputTokens: 5, modelId: 'claude-sonnet-5' })
    recordUsage('gemini', { inputTokens: 7, outputTokens: 7, modelId: 'gemini-3.6-flash' })
    expect(getUsage('anthropic')!.inputTokens).toBe(5)
    expect(getUsage('gemini')!.inputTokens).toBe(7)
  })

  it('bills Gemini candidate and thought tokens as output exactly once', () => {
    recordUsage('gemini', {
      inputTokens: 1_000_000,
      outputTokens: 2_000_000,
      reasoningTokens: 3_000_000,
      modelId: 'gemini-3.6-flash'
    })

    expect(getUsageSnapshot('gemini')).toMatchObject({
      session: {
        outputTokens: 2_000_000,
        reasoningTokens: 3_000_000,
        costUsd: 1.5 + 5 * 7.5,
        costKind: 'estimated'
      },
      allTime: {
        outputTokens: 2_000_000,
        reasoningTokens: 3_000_000,
        costUsd: 1.5 + 5 * 7.5,
        costKind: 'estimated'
      }
    })
  })

  it('tracks Anthropic thinking without adding it to inclusive billed output twice', () => {
    recordUsage('anthropic', {
      inputTokens: 1_000_000,
      outputTokens: 2_000_000,
      reasoningTokens: 1_500_000,
      modelId: 'claude-sonnet-5'
    })

    expect(getUsageSnapshot('anthropic')).toMatchObject({
      session: {
        outputTokens: 2_000_000,
        reasoningTokens: 1_500_000,
        costUsd: 2 + 2 * 10,
        costKind: 'estimated'
      },
      allTime: {
        outputTokens: 2_000_000,
        reasoningTokens: 1_500_000,
        costUsd: 2 + 2 * 10,
        costKind: 'estimated'
      }
    })
  })

  it.each([
    { inputTokens: -1, outputTokens: 1, modelId: 'claude-sonnet-5' },
    { inputTokens: 1.5, outputTokens: 1, modelId: 'claude-sonnet-5' },
    { inputTokens: 1e308, outputTokens: 1, modelId: 'claude-sonnet-5' },
    {
      inputTokens: 1,
      outputTokens: 1,
      reasoningTokens: Number.POSITIVE_INFINITY,
      modelId: 'claude-sonnet-5'
    },
    {
      inputTokens: 1,
      outputTokens: 1,
      providerCostUsd: -0.01,
      modelId: 'claude-sonnet-5'
    },
    {
      inputTokens: 1,
      outputTokens: 1,
      providerCostUsd: MAX_PROVIDER_COST_USD + 1,
      modelId: 'claude-sonnet-5'
    }
  ])('records hostile direct usage as one unknown request: %o', (input) => {
    recordUsage('anthropic', input)

    expect(getUsageSnapshot('anthropic')).toMatchObject({
      session: {
        requests: 1,
        inputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        costUsd: null,
        costKind: 'unknown'
      },
      allTime: {
        requests: 1,
        inputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        costUsd: null,
        costKind: 'unknown'
      }
    })
  })

  it('rejects poisoned stored totals instead of loading negative or overflowing values', () => {
    const base = {
      requests: 1,
      inputTokens: 1,
      outputTokens: 1,
      reasoningTokens: 0,
      costUsd: 0,
      costKind: 'provider',
      since: 1
    }
    for (const poison of [
      { inputTokens: -1 },
      { outputTokens: 1.5 },
      { reasoningTokens: 1e308 },
      { costUsd: -1 },
      { requests: Number.POSITIVE_INFINITY }
    ]) {
      localStorage.setItem('orbitpm.lite.usage.anthropic', JSON.stringify({ ...base, ...poison }))
      expect(getUsage('anthropic')).toMatchObject({
        costUsd: null,
        costKind: 'unknown',
        overflowed: true
      })
    }
  })

  it.each([
    { costUsd: null, costKind: 'provider' },
    { costUsd: null, costKind: 'estimated' },
    { costUsd: 1, costKind: 'unknown' },
    { estCostUsd: 1, costKind: 'provider' },
    { costUsd: 1, estCostUsd: 1, costKind: 'provider' },
    { costUsd: 1, estCostUsd: 2, costKind: 'estimated' }
  ])('rejects contradictory stored cost state: %o', (costState) => {
    localStorage.setItem(
      'orbitpm.lite.usage.anthropic',
      JSON.stringify({
        requests: 1,
        inputTokens: 1,
        outputTokens: 1,
        reasoningTokens: 0,
        since: 1,
        ...costState
      })
    )

    expect(getUsage('anthropic')).toMatchObject({
      costUsd: null,
      costKind: 'unknown',
      overflowed: true
    })
  })

  it('normalizes unambiguous legacy/missing cost metadata', () => {
    const base = {
      requests: 1,
      inputTokens: 1,
      outputTokens: 1,
      reasoningTokens: 0,
      since: 1
    }
    localStorage.setItem('orbitpm.lite.usage.anthropic', JSON.stringify({ ...base, costUsd: null }))
    expect(getUsage('anthropic')).toMatchObject({ costUsd: null, costKind: 'unknown' })

    localStorage.setItem('orbitpm.lite.usage.anthropic', JSON.stringify({ ...base, costUsd: 1 }))
    expect(getUsage('anthropic')).toMatchObject({ costUsd: 1, costKind: 'estimated' })

    localStorage.setItem('orbitpm.lite.usage.anthropic', JSON.stringify({ ...base, estCostUsd: 2 }))
    expect(getUsage('anthropic')).toMatchObject({ costUsd: 2, costKind: 'estimated' })
  })

  it('serializes two simulated realms from the same base without losing either update', async () => {
    let tail = Promise.resolve()
    const locks = {
      request: vi.fn((_name: string, callback: () => void) => {
        const result = tail.then(() => callback())
        tail = result.then(() => undefined)
        return result
      })
    }
    vi.stubGlobal('navigator', { locks })

    vi.resetModules()
    const realmA = await import('../credits')
    vi.resetModules()
    const realmB = await import('../credits')

    realmA.recordUsage('anthropic', {
      inputTokens: 1,
      outputTokens: 1,
      modelId: 'claude-sonnet-5'
    })
    realmB.recordUsage('anthropic', {
      inputTokens: 2,
      outputTokens: 2,
      modelId: 'claude-sonnet-5'
    })
    await tail

    expect(realmA.getUsage('anthropic')).toMatchObject({
      requests: 2,
      inputTokens: 3,
      outputTokens: 3
    })
    expect(locks.request).toHaveBeenCalledTimes(2)
  })

  it('falls back to one bounded per-tab shard when LockManager rejects', async () => {
    vi.stubGlobal('navigator', {
      locks: { request: vi.fn(() => Promise.reject(new Error('Lockdown'))) }
    })
    for (let index = 0; index < 100; index += 1) {
      recordUsage('anthropic', {
        inputTokens: 1,
        outputTokens: 1,
        modelId: 'claude-sonnet-5'
      })
    }
    await vi.waitFor(() => expect(getUsage('anthropic')?.requests).toBe(100))

    const fallbackKeys = storageKeys().filter((key) =>
      key.startsWith('orbitpm.lite.usage.anthropic.fallback.')
    )
    expect(fallbackKeys).toHaveLength(1)
    expect(localStorage.getItem('orbitpm.lite.usage.anthropic')).toBeNull()
  })

  it('keeps two rejecting-LockManager realms in distinct fallback shards', async () => {
    vi.stubGlobal('navigator', {
      locks: { request: vi.fn(() => Promise.reject(new Error('Lockdown'))) }
    })
    vi.resetModules()
    const realmA = await import('../credits')
    vi.resetModules()
    const realmB = await import('../credits')

    realmA.recordUsage('gemini', {
      inputTokens: 1,
      outputTokens: 1,
      modelId: 'gemini-3.6-flash'
    })
    realmB.recordUsage('gemini', {
      inputTokens: 2,
      outputTokens: 2,
      modelId: 'gemini-3.6-flash'
    })

    await vi.waitFor(() => expect(realmA.getUsage('gemini')?.requests).toBe(2))
    expect(
      storageKeys().filter((key) => key.startsWith('orbitpm.lite.usage.gemini.fallback.'))
    ).toHaveLength(2)
  })

  it('gives two cloned active sessions immutable fallback shard IDs', async () => {
    vi.stubGlobal('navigator', {
      locks: { request: vi.fn(() => Promise.reject(new Error('Lockdown'))) }
    })
    vi.resetModules()
    const realmA = await import('../credits')
    vi.resetModules()
    const realmB = await import('../credits')
    const copiedWriterState = JSON.stringify({
      version: 1,
      id: 'a'.repeat(32),
      closed: false
    })
    const makeClonedSessionStorage = (): Storage => {
      const values = new Map([['orbitpm.lite.usage.writer-id', copiedWriterState]])
      return {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => void values.set(key, value),
        removeItem: (key: string) => void values.delete(key),
        clear: () => values.clear(),
        key: (index: number) => [...values.keys()][index] ?? null,
        get length() {
          return values.size
        }
      }
    }
    const sessionA = makeClonedSessionStorage()
    const sessionB = makeClonedSessionStorage()

    vi.stubGlobal('sessionStorage', sessionA)
    realmA.recordUsage('gemini', {
      inputTokens: 1,
      outputTokens: 1,
      modelId: 'gemini-3.6-flash'
    })
    vi.stubGlobal('sessionStorage', sessionB)
    realmB.recordUsage('gemini', {
      inputTokens: 2,
      outputTokens: 2,
      modelId: 'gemini-3.6-flash'
    })

    await vi.waitFor(() => expect(realmA.getUsage('gemini')?.requests).toBe(2))
    const fallbackKeys = storageKeys().filter((key) =>
      key.startsWith('orbitpm.lite.usage.gemini.fallback.')
    )
    expect(fallbackKeys).toHaveLength(2)
    expect(new Set(fallbackKeys).size).toBe(2)
  })

  it('marks fallback overflow explicitly without creating an unbounded new shard', () => {
    vi.stubGlobal('navigator', {})
    const stored = {
      requests: 1,
      inputTokens: 1,
      outputTokens: 1,
      reasoningTokens: 0,
      costUsd: 0,
      costKind: 'estimated',
      since: 1
    }
    for (let index = 0; index < MAX_USAGE_FALLBACK_SHARDS; index += 1) {
      localStorage.setItem(
        `orbitpm.lite.usage.gemini.fallback.existing-${index}`,
        JSON.stringify(stored)
      )
    }
    recordUsage('gemini', {
      inputTokens: 1,
      outputTokens: 1,
      modelId: 'gemini-3.6-flash'
    })

    const fallbackKeys = storageKeys().filter((key) =>
      key.startsWith('orbitpm.lite.usage.gemini.fallback.')
    )
    expect(fallbackKeys).toHaveLength(MAX_USAGE_FALLBACK_SHARDS)
    expect(
      JSON.parse(localStorage.getItem('orbitpm.lite.usage.gemini.fallback-overflow') ?? 'null')
    ).toMatchObject({ version: 1, generation: '' })
    expect(getUsage('gemini')).toMatchObject({
      requests: 33,
      overflowed: true,
      costKind: 'unknown'
    })
  })

  it('keeps simultaneous boundary writers inside the fixed 32-slot registry', async () => {
    const stored = {
      requests: 1,
      inputTokens: 1,
      outputTokens: 1,
      reasoningTokens: 0,
      costUsd: 0,
      costKind: 'estimated',
      since: 1
    }
    for (let index = 0; index < MAX_USAGE_FALLBACK_SHARDS - 1; index += 1) {
      localStorage.setItem(
        `orbitpm.lite.usage.gemini.fallback.slot-${index.toString().padStart(2, '0')}`,
        JSON.stringify(stored)
      )
    }
    const rejecters: Array<() => void> = []
    vi.stubGlobal('navigator', {
      locks: {
        request: vi.fn(
          () =>
            new Promise<void>((_resolve, reject) => {
              rejecters.push(() => reject(new Error('Lockdown')))
            })
        )
      }
    })
    vi.resetModules()
    const realmA = await import('../credits')
    vi.resetModules()
    const realmB = await import('../credits')

    realmA.recordUsage('gemini', {
      inputTokens: 1,
      outputTokens: 1,
      modelId: 'gemini-3.6-flash'
    })
    realmB.recordUsage('gemini', {
      inputTokens: 1,
      outputTokens: 1,
      modelId: 'gemini-3.6-flash'
    })
    rejecters.forEach((reject) => reject())

    await vi.waitFor(() => expect(realmB.getUsage('gemini')?.requests).toBe(33))
    expect(
      storageKeys().filter((key) => key.startsWith('orbitpm.lite.usage.gemini.fallback.'))
    ).toHaveLength(MAX_USAGE_FALLBACK_SHARDS)
    expect(realmB.getUsage('gemini')).toMatchObject({
      costUsd: null,
      costKind: 'unknown',
      overflowed: true
    })
  })

  it('discloses a true same-slot read/write interleaving as a lower bound', async () => {
    const stored = {
      requests: 1,
      inputTokens: 1,
      outputTokens: 1,
      reasoningTokens: 0,
      costUsd: 0,
      costKind: 'estimated',
      since: 1
    }
    for (let index = 0; index < MAX_USAGE_FALLBACK_SHARDS - 1; index += 1) {
      localStorage.setItem(
        `orbitpm.lite.usage.gemini.fallback.slot-${index.toString().padStart(2, '0')}`,
        JSON.stringify(stored)
      )
    }
    vi.stubGlobal('navigator', {})
    vi.resetModules()
    const realmA = await import('../credits')
    vi.resetModules()
    const realmB = await import('../credits')
    const target = 'orbitpm.lite.usage.gemini.fallback.slot-31'
    const getItem = localStorage.getItem.bind(localStorage)
    let targetReads = 0
    let reentered = false
    vi.spyOn(localStorage, 'getItem').mockImplementation((key: string) => {
      const visibleValue = getItem(key)
      if (key === target) {
        targetReads += 1
        if (targetReads === 3 && !reentered) {
          reentered = true
          realmB.recordUsage('gemini', {
            inputTokens: 1,
            outputTokens: 1,
            modelId: 'gemini-3.6-flash'
          })
        }
      }
      return visibleValue
    })

    realmA.recordUsage('gemini', {
      inputTokens: 1,
      outputTokens: 1,
      modelId: 'gemini-3.6-flash'
    })

    expect(reentered).toBe(true)
    // One interleaved delta was overwritten, but the persisted 32 is an
    // explicit lower bound rather than a false exact total.
    expect(realmA.getUsage('gemini')).toMatchObject({
      requests: MAX_USAGE_FALLBACK_SHARDS,
      costUsd: null,
      costKind: 'unknown',
      overflowed: true
    })
    expect(
      storageKeys().filter((key) => key.startsWith('orbitpm.lite.usage.gemini.fallback.'))
    ).toHaveLength(MAX_USAGE_FALLBACK_SHARDS)
  })

  it('marks a post-reset slot incomplete when a stale writer overwrites it', async () => {
    const stored = {
      requests: 1,
      inputTokens: 1,
      outputTokens: 1,
      reasoningTokens: 0,
      costUsd: 0,
      costKind: 'estimated',
      since: 1
    }
    for (let index = 0; index < MAX_USAGE_FALLBACK_SHARDS - 1; index += 1) {
      localStorage.setItem(
        `orbitpm.lite.usage.gemini.fallback.legacy-${index.toString().padStart(2, '0')}`,
        JSON.stringify(stored)
      )
    }
    vi.stubGlobal('navigator', {})
    vi.resetModules()
    const staleRealm = await import('../credits')
    vi.resetModules()
    const resetRealm = await import('../credits')
    const target = 'orbitpm.lite.usage.gemini.fallback.slot-00'
    const getItem = localStorage.getItem.bind(localStorage)
    let targetReads = 0
    let reentered = false
    vi.spyOn(localStorage, 'getItem').mockImplementation((key: string) => {
      const visibleValue = getItem(key)
      if (key === target) {
        targetReads += 1
        if (targetReads === 3 && !reentered) {
          reentered = true
          resetRealm.resetUsage('gemini')
          resetRealm.recordUsage('gemini', {
            inputTokens: 2,
            outputTokens: 1,
            modelId: 'gemini-3.6-flash'
          })
        }
      }
      return visibleValue
    })

    staleRealm.recordUsage('gemini', {
      inputTokens: 1,
      outputTokens: 1,
      modelId: 'gemini-3.6-flash'
    })

    expect(reentered).toBe(true)
    expect(resetRealm.getUsageSnapshot('gemini')).toMatchObject({
      session: { requests: 1, inputTokens: 2, outputTokens: 1 },
      allTime: {
        requests: 0,
        costUsd: null,
        costKind: 'unknown',
        overflowed: true
      }
    })
  })

  it('repairs current overflow evidence when a stale no-key attempt exits after reset', async () => {
    localStorage.setItem('orbitpm.lite.usage.gemini.fallback-overflow', '1')
    vi.stubGlobal('navigator', {})
    vi.resetModules()
    const staleRealm = await import('../credits')
    vi.resetModules()
    const resetRealm = await import('../credits')
    const actualLength = localStorage.length
    let reentered = false
    let failNestedEnumeration = false
    const lengthSpy = vi.spyOn(localStorage, 'length', 'get').mockImplementation(() => {
      if (!reentered) {
        reentered = true
        // Reset enumeration succeeds and snapshots the old "1" marker.
        resetRealm.resetUsage('gemini')
        // The post-reset request and the stale request both take the no-key
        // early exit, recreating the marker ABA that must be repaired.
        failNestedEnumeration = true
        resetRealm.recordUsage('gemini', {
          inputTokens: 2,
          outputTokens: 1,
          modelId: 'gemini-3.6-flash'
        })
        failNestedEnumeration = false
        throw new Error('stale enumeration failed')
      }
      if (failNestedEnumeration) throw new Error('post-reset enumeration failed')
      return actualLength
    })

    staleRealm.recordUsage('gemini', {
      inputTokens: 1,
      outputTokens: 1,
      modelId: 'gemini-3.6-flash'
    })
    lengthSpy.mockRestore()

    expect(reentered).toBe(true)
    const resetMarker = JSON.parse(
      localStorage.getItem('orbitpm.lite.usage.gemini.reset-generation') ?? 'null'
    ) as { generation?: string } | null
    const overflowMarker = JSON.parse(
      localStorage.getItem('orbitpm.lite.usage.gemini.fallback-overflow') ?? 'null'
    ) as { generation?: string } | null
    expect(overflowMarker?.generation).toBe(resetMarker?.generation)

    // A fresh realm has no volatile delta. Durable current-generation evidence
    // must still prevent an exact-looking empty/$0 ledger.
    vi.resetModules()
    const reloadedRealm = await import('../credits')
    expect(reloadedRealm.getUsage('gemini')).toMatchObject({
      requests: 0,
      costUsd: null,
      costKind: 'unknown',
      overflowed: true
    })
  })

  it('keeps marker ABA visible when another reset lands between helper read and repair', async () => {
    localStorage.setItem('orbitpm.lite.usage.gemini.fallback-overflow', '1')
    vi.stubGlobal('navigator', {})
    vi.resetModules()
    const staleRealm = await import('../credits')
    vi.resetModules()
    const resetRealm = await import('../credits')
    const resetKey = 'orbitpm.lite.usage.gemini.reset-generation'
    const overflowKey = 'orbitpm.lite.usage.gemini.fallback-overflow'
    const actualLength = localStorage.length
    const setItem = localStorage.setItem.bind(localStorage)
    let firstResetGeneration: string | undefined
    let firstGenerationMarkerWrites = 0
    let secondResetInjected = false
    let failNestedEnumeration = false
    const setItemSpy = vi.spyOn(localStorage, 'setItem').mockImplementation((key, value) => {
      if (key === overflowKey && firstResetGeneration) {
        const marker = JSON.parse(value) as { generation?: string }
        if (marker.generation === firstResetGeneration) {
          firstGenerationMarkerWrites += 1
          if (firstGenerationMarkerWrites === 2 && !secondResetInjected) {
            secondResetInjected = true
            // This reset linearizes after the helper read but before its g1
            // marker write. Its post-reset request also takes the no-key path.
            resetRealm.resetUsage('gemini')
            failNestedEnumeration = true
            resetRealm.recordUsage('gemini', {
              inputTokens: 3,
              outputTokens: 1,
              modelId: 'gemini-3.6-flash'
            })
            failNestedEnumeration = false
          }
        }
      }
      setItem(key, value)
    })
    let firstResetInjected = false
    const lengthSpy = vi.spyOn(localStorage, 'length', 'get').mockImplementation(() => {
      if (!firstResetInjected) {
        firstResetInjected = true
        resetRealm.resetUsage('gemini')
        firstResetGeneration = (
          JSON.parse(localStorage.getItem(resetKey) ?? 'null') as { generation?: string } | null
        )?.generation
        failNestedEnumeration = true
        resetRealm.recordUsage('gemini', {
          inputTokens: 2,
          outputTokens: 1,
          modelId: 'gemini-3.6-flash'
        })
        failNestedEnumeration = false
        throw new Error('stale enumeration failed')
      }
      if (failNestedEnumeration) throw new Error('post-reset enumeration failed')
      return actualLength
    })

    staleRealm.recordUsage('gemini', {
      inputTokens: 1,
      outputTokens: 1,
      modelId: 'gemini-3.6-flash'
    })
    lengthSpy.mockRestore()
    setItemSpy.mockRestore()

    expect(secondResetInjected).toBe(true)
    const finalResetMarker = JSON.parse(localStorage.getItem(resetKey) ?? 'null') as {
      generation?: string
    } | null
    const finalOverflowMarker = JSON.parse(localStorage.getItem(overflowKey) ?? 'null') as {
      generation?: string
    } | null
    // The stale helper did overwrite the raw marker with g1 after g2. Its
    // fresh revision prevents it from matching g2's reset snapshot.
    expect(finalOverflowMarker?.generation).toBe(firstResetGeneration)
    expect(finalOverflowMarker?.generation).not.toBe(finalResetMarker?.generation)

    vi.resetModules()
    const reloadedRealm = await import('../credits')
    expect(reloadedRealm.getUsage('gemini')).toMatchObject({
      requests: 0,
      costUsd: null,
      costKind: 'unknown',
      overflowed: true
    })
  })

  it('bounds hostile matching-key enumeration and marks omitted shards incomplete', () => {
    const stored = {
      requests: 1,
      inputTokens: 1,
      outputTokens: 1,
      reasoningTokens: 0,
      costUsd: 0,
      costKind: 'estimated',
      since: 1
    }
    for (let index = 0; index < MAX_USAGE_FALLBACK_SHARDS + 100; index += 1) {
      localStorage.setItem(
        `orbitpm.lite.usage.gemini.fallback.hostile-${index.toString().padStart(4, '0')}`,
        JSON.stringify(stored)
      )
    }

    expect(getUsage('gemini')).toMatchObject({
      requests: MAX_USAGE_FALLBACK_SHARDS,
      costUsd: null,
      costKind: 'unknown',
      overflowed: true
    })
  })

  it('keeps a malformed fallback shard incomplete after recording', () => {
    localStorage.setItem('orbitpm.lite.usage.gemini.fallback.damaged', '{not json')

    recordUsage('gemini', {
      inputTokens: 2,
      outputTokens: 1,
      modelId: 'gemini-3.6-flash'
    })

    expect(getUsage('gemini')).toMatchObject({
      requests: 1,
      inputTokens: 2,
      outputTokens: 1,
      costUsd: null,
      costKind: 'unknown',
      overflowed: true
    })
  })

  it('repairs a malformed reset tombstone without presenting a fresh exact ledger', () => {
    localStorage.setItem('orbitpm.lite.usage.gemini.reset-generation', 'not a valid generation')

    recordUsage('gemini', {
      inputTokens: 2,
      outputTokens: 1,
      modelId: 'gemini-3.6-flash'
    })

    expect(getUsage('gemini')).toMatchObject({
      requests: 1,
      inputTokens: 2,
      outputTokens: 1,
      costUsd: null,
      costKind: 'unknown',
      overflowed: true
    })

    resetUsage('gemini')
    expect(getUsage('gemini')).toBeNull()
  })

  it('bounds storage-key inspection during fallback recording and reset', () => {
    vi.stubGlobal('navigator', {})
    for (let index = 0; index < 5_000; index += 1) {
      localStorage.setItem(`unrelated-${index}`, '1')
    }
    const key = localStorage.key.bind(localStorage)
    const keySpy = vi.spyOn(localStorage, 'key').mockImplementation(key)

    recordUsage('gemini', {
      inputTokens: 1,
      outputTokens: 1,
      modelId: 'gemini-3.6-flash'
    })
    expect(keySpy.mock.calls.length).toBeLessThanOrEqual(4_096)

    keySpy.mockClear()
    resetUsage('gemini')
    expect(keySpy.mock.calls.length).toBeLessThanOrEqual(4_096)
  })

  it('drops a queued pre-reset delta before a delayed lock drain', async () => {
    let runLock: (() => void) | undefined
    const locks = {
      request: vi.fn(
        (_name: string, callback: () => void) =>
          new Promise<void>((resolve) => {
            runLock = () => {
              callback()
              resolve()
            }
          })
      )
    }
    vi.stubGlobal('navigator', { locks })

    recordUsage('openrouter', {
      inputTokens: 1,
      outputTokens: 1,
      providerCostUsd: 0.01,
      modelId: 'z-ai/glm-5.2'
    })
    expect(getUsageSnapshot('openrouter').session.requests).toBe(1)
    expect(getUsageSnapshot('openrouter').allTime.requests).toBe(0)

    resetUsage('openrouter')
    expect(getUsageSnapshot('openrouter').session.requests).toBe(0)
    runLock?.()
    await vi.waitFor(() => expect(getUsage('openrouter')).toBeNull())
  })

  it('does not resurrect another realm pre-reset delta after delayed lock rejection', async () => {
    const rejectLock: Array<() => void> = []
    vi.stubGlobal('navigator', {
      locks: {
        request: vi.fn(
          () =>
            new Promise<void>((_resolve, reject) => {
              rejectLock.push(() => reject(new Error('Lockdown')))
            })
        )
      }
    })
    vi.resetModules()
    const realmA = await import('../credits')
    vi.resetModules()
    const realmB = await import('../credits')

    realmA.recordUsage('anthropic', {
      inputTokens: 10,
      outputTokens: 5,
      modelId: 'claude-sonnet-5'
    })
    realmB.resetUsage('anthropic')

    // Complete reset cleanup first, then let the stale pre-reset writer fail
    // over to its shard. The persisted reset generation must discard it.
    rejectLock[1]?.()
    await Promise.resolve()
    rejectLock[0]?.()
    await vi.waitFor(() => expect(realmB.getUsage('anthropic')).toBeNull())
    expect(
      storageKeys().filter((key) => key === 'orbitpm.lite.usage.anthropic.reset-generation')
    ).toHaveLength(1)
  })

  it('preserves a post-reset delta when its earlier queued lock fails before reset cleanup', async () => {
    const rejectLock: Array<() => void> = []
    vi.stubGlobal('navigator', {
      locks: {
        request: vi.fn(
          () =>
            new Promise<void>((_resolve, reject) => {
              rejectLock.push(() => reject(new Error('Lockdown')))
            })
        )
      }
    })
    vi.resetModules()
    const realmA = await import('../credits')
    vi.resetModules()
    const realmB = await import('../credits')

    realmA.recordUsage('anthropic', {
      inputTokens: 100,
      outputTokens: 50,
      modelId: 'claude-sonnet-5'
    })
    realmB.resetUsage('anthropic')
    realmA.recordUsage('anthropic', {
      inputTokens: 3,
      outputTokens: 2,
      modelId: 'claude-sonnet-5'
    })

    // Realm A's old queued job drains the new-generation aggregate first.
    rejectLock[0]?.()
    await vi.waitFor(() => expect(realmA.getUsage('anthropic')?.requests).toBe(1))
    // Realm B's later reset cleanup must preserve that same-generation delta.
    rejectLock[1]?.()
    await vi.waitFor(() =>
      expect(realmB.getUsage('anthropic')).toMatchObject({
        requests: 1,
        inputTokens: 3,
        outputTokens: 2
      })
    )
  })

  it('does not delete a newer-generation shard when a reset callback resumes late', () => {
    let runLock: (() => void) | undefined
    vi.stubGlobal('navigator', {
      locks: {
        request: vi.fn(
          (_name: string, callback: () => void) =>
            new Promise<void>((resolve) => {
              runLock = () => {
                callback()
                resolve()
              }
            })
        )
      }
    })

    resetUsage('anthropic')
    const resetKey = 'orbitpm.lite.usage.anthropic.reset-generation'
    const oldGeneration = localStorage.getItem(resetKey)
    expect(oldGeneration).toBeTruthy()
    const newGeneration = oldGeneration === 'b'.repeat(32) ? 'c'.repeat(32) : 'b'.repeat(32)
    const originalGetItem = localStorage.getItem.bind(localStorage)
    const originalSetItem = localStorage.setItem.bind(localStorage)
    let injected = false
    vi.spyOn(localStorage, 'getItem').mockImplementation((key: string) => {
      const visibleValue = originalGetItem(key)
      if (key === resetKey && !injected) {
        injected = true
        originalSetItem(resetKey, newGeneration)
        originalSetItem(
          'orbitpm.lite.usage.anthropic.fallback.newer-realm',
          JSON.stringify({
            version: 1,
            generation: newGeneration,
            totals: {
              requests: 1,
              inputTokens: 3,
              outputTokens: 2,
              reasoningTokens: 0,
              costUsd: 0.000026,
              costKind: 'estimated',
              since: 1
            }
          })
        )
      }
      return visibleValue
    })

    runLock?.()

    expect(getUsage('anthropic')).toMatchObject({
      requests: 1,
      inputTokens: 3,
      outputTokens: 2
    })
  })

  it('keeps a stale realm pagehide flush behind another realm reset tombstone', async () => {
    const eventTarget = new EventTarget()
    vi.stubGlobal('window', eventTarget)
    vi.stubGlobal('navigator', {
      locks: {
        request: vi.fn(
          () =>
            new Promise<void>(() => {
              // Deliberately held so pagehide must flush synchronously.
            })
        )
      }
    })
    vi.resetModules()
    const realmA = await import('../credits')
    vi.resetModules()
    const realmB = await import('../credits')

    realmA.recordUsage('gemini', {
      inputTokens: 8,
      outputTokens: 4,
      modelId: 'gemini-3.6-flash'
    })
    realmB.resetUsage('gemini')
    eventTarget.dispatchEvent(new Event('pagehide'))

    expect(realmB.getUsage('gemini')).toBeNull()
  })

  it('flushes a delayed locked update to a fallback shard on pagehide without duplication', async () => {
    const eventTarget = new EventTarget()
    vi.stubGlobal('window', eventTarget)
    let runLock: (() => void) | undefined
    const locks = {
      request: vi.fn(
        (_name: string, callback: () => void) =>
          new Promise<void>((resolve) => {
            runLock = () => {
              callback()
              resolve()
            }
          })
      )
    }
    vi.stubGlobal('navigator', { locks })

    recordUsage('anthropic', {
      inputTokens: 4,
      outputTokens: 2,
      modelId: 'claude-sonnet-5'
    })
    eventTarget.dispatchEvent(new Event('pagehide'))

    expect(getUsage('anthropic')).toMatchObject({ requests: 1, inputTokens: 4, outputTokens: 2 })
    runLock?.()
    await vi.waitFor(() => expect(getUsage('anthropic')?.requests).toBe(1))
  })

  it('reuses one closed fallback aggregate across sequential page reloads', async () => {
    vi.stubGlobal('navigator', {
      locks: { request: vi.fn(() => Promise.reject(new Error('Lockdown'))) }
    })

    let latest: typeof import('../credits') | undefined
    for (let index = 0; index < MAX_USAGE_FALLBACK_SHARDS + 8; index += 1) {
      const eventTarget = new EventTarget()
      vi.stubGlobal('window', eventTarget)
      vi.resetModules()
      latest = await import('../credits')
      latest.recordUsage('openrouter', {
        inputTokens: 1,
        outputTokens: 1,
        providerCostUsd: 0.001,
        modelId: 'z-ai/glm-5.2'
      })
      await vi.waitFor(() => expect(latest?.getUsage('openrouter')?.requests).toBe(index + 1))
      eventTarget.dispatchEvent(new Event('pagehide'))
    }

    const usage = latest?.getUsage('openrouter')
    expect(usage).toMatchObject({ requests: MAX_USAGE_FALLBACK_SHARDS + 8 })
    expect(usage).toMatchObject({
      costUsd: null,
      costKind: 'unknown',
      overflowed: true
    })
    expect(
      storageKeys().filter((key) => key.startsWith('orbitpm.lite.usage.openrouter.fallback.'))
    ).toHaveLength(1)
  })

  it('keeps exactly one durable reset-generation key across repeated resets', () => {
    for (let index = 0; index < MAX_USAGE_FALLBACK_SHARDS + 8; index += 1) {
      resetUsage('anthropic')
    }

    expect(
      storageKeys().filter((key) => key === 'orbitpm.lite.usage.anthropic.reset-generation')
    ).toHaveLength(1)
    expect(getUsage('anthropic')).toBeNull()
  })

  it('saturates a lifetime token total at its explicit cap and marks cost unknown', () => {
    localStorage.setItem(
      'orbitpm.lite.usage.anthropic',
      JSON.stringify({
        requests: 1,
        inputTokens: MAX_USAGE_LEDGER_TOKENS,
        outputTokens: 0,
        reasoningTokens: 0,
        costUsd: 0,
        costKind: 'estimated',
        since: 1
      })
    )

    recordUsage('anthropic', { inputTokens: 1, outputTokens: 0, modelId: 'claude-sonnet-5' })

    expect(getUsage('anthropic')).toMatchObject({
      inputTokens: MAX_USAGE_LEDGER_TOKENS,
      costUsd: null,
      costKind: 'unknown'
    })
  })

  it('turns a lifetime cost overflow into unknown rather than Infinity', () => {
    localStorage.setItem(
      'orbitpm.lite.usage.openrouter',
      JSON.stringify({
        requests: 1,
        inputTokens: 1,
        outputTokens: 1,
        reasoningTokens: 0,
        costUsd: MAX_USAGE_LEDGER_COST_USD,
        costKind: 'provider',
        since: 1
      })
    )

    recordUsage('openrouter', {
      inputTokens: 1,
      outputTokens: 1,
      providerCostUsd: 0.01,
      modelId: 'z-ai/glm-5.2'
    })

    expect(getUsage('openrouter')).toMatchObject({
      costUsd: null,
      costKind: 'unknown'
    })
  })
})

describe('usage subscriptions', () => {
  it('refreshes for matching cross-tab storage changes and ignores unrelated keys', () => {
    const eventTarget = new EventTarget()
    vi.stubGlobal('window', eventTarget)
    const listener = vi.fn()
    const unsubscribe = subscribeUsage(listener)
    const dispatchStorage = (key: string | null): void => {
      const event = new Event('storage')
      Object.defineProperty(event, 'key', { value: key })
      eventTarget.dispatchEvent(event)
    }

    dispatchStorage('unrelated')
    dispatchStorage('orbitpm.lite.usage.anthropic')
    dispatchStorage('orbitpm.lite.usage.gemini.fallback.other-realm')
    dispatchStorage('orbitpm.lite.usage.openrouter.fallback-overflow')
    dispatchStorage(null)

    expect(listener.mock.calls).toEqual([
      ['anthropic'],
      ['gemini'],
      ['openrouter'],
      ['openrouter'],
      ['anthropic'],
      ['gemini']
    ])
    unsubscribe()
    dispatchStorage('orbitpm.lite.usage.openrouter')
    expect(listener).toHaveBeenCalledTimes(6)
  })
})

describe('estimateCostUsd', () => {
  it('publishes the review date for locally estimated prices', () => {
    expect(ESTIMATED_PRICE_AS_OF).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it.each([
    ['z-ai/glm-5.2', 0.8106, 2.5476],
    ['moonshotai/kimi-k3', 3, 15],
    ['deepseek/deepseek-v4-pro', 0.435, 0.87],
    ['deepseek/deepseek-v4-flash', 0.14, 0.28],
    ['anthropic/claude-opus-4.8', 5, 25],
    ['anthropic/claude-sonnet-5', 2, 10],
    ['google/gemini-3.6-flash', 1.5, 7.5]
  ])(
    'uses the reviewed OpenRouter route price for %s',
    (modelId, inputPerMillion, outputPerMillion) => {
      const cost = estimateCostUsd(modelId, 1_000_000, 1_000_000)
      expect(cost).toBeCloseTo(inputPerMillion + outputPerMillion, 10)
    }
  )

  it('computes exact arithmetic for a known bare Anthropic id', () => {
    const cost = estimateCostUsd('claude-opus-4-8', 500_000, 250_000)
    expect(cost).toBeCloseTo(0.5 * 5 + 0.25 * 25, 10)
  })

  it('uses the current direct Sonnet promotional price through its documented expiry', () => {
    expect(estimateCostUsd('claude-sonnet-5', 1_000_000, 1_000_000)).toBeCloseTo(12, 10)
    expect(estimateCostUsd('anthropic/claude-sonnet-5', 1_000_000, 1_000_000)).toBeCloseTo(12, 10)
  })

  it('computes exact arithmetic for a known bare Gemini id', () => {
    const cost = estimateCostUsd('gemini-3.1-pro-preview', 200_000, 100_000)
    expect(cost).toBeCloseTo(0.2 * 2 + 0.1 * 12, 10)
  })

  it('uses the official long-context tier for Gemini 3.1 Pro Preview', () => {
    const cost = estimateCostUsd('gemini-3.1-pro-preview', 200_001, 100_000)
    expect(cost).toBeCloseTo((200_001 / 1_000_000) * 4 + 0.1 * 18, 10)
  })

  it('uses OpenRouter own published Gemini 3.6 Flash route price', () => {
    const cost = estimateCostUsd('google/gemini-3.6-flash', 1_000_000, 1_000_000)
    expect(cost).toBeCloseTo(1.5 + 7.5, 10)
  })

  it('does not estimate retired direct Gemini model ids', () => {
    expect(estimateCostUsd('gemini-3-pro-preview', 100, 100)).toBeNull()
    expect(estimateCostUsd('gemini-flash-latest', 100, 100)).toBeNull()
  })

  it('returns null for an unknown model id', () => {
    expect(estimateCostUsd('totally/unknown-model', 100, 100)).toBeNull()
  })

  it.each([-1, 1.5, 1e308, Number.POSITIVE_INFINITY])(
    'does not estimate from hostile token count %s',
    (tokens) => {
      expect(estimateCostUsd('z-ai/glm-5.2', tokens, 1)).toBeNull()
    }
  )
})

describe('extractUsage', () => {
  it('extracts anthropic usage', () => {
    expect(extractUsage('anthropic', { usage: { input_tokens: 12, output_tokens: 34 } })).toEqual({
      inputTokens: 12,
      outputTokens: 34,
      reasoningTokens: 0
    })
  })

  it('extracts Anthropic thinking_tokens as an output breakdown', () => {
    expect(
      extractUsage('anthropic', {
        usage: {
          input_tokens: 12,
          output_tokens: 34,
          output_tokens_details: {
            thinking_tokens: 20,
            // The current authoritative field wins without double counting.
            reasoning_tokens: 19
          }
        }
      })
    ).toEqual({
      inputTokens: 12,
      outputTokens: 34,
      reasoningTokens: 20
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

  it.each([
    {
      providerId: 'anthropic' as const,
      response: { usage: { input_tokens: -1, output_tokens: 1 } }
    },
    {
      providerId: 'anthropic' as const,
      response: { usage: { input_tokens: 1.5, output_tokens: 1 } }
    },
    {
      providerId: 'anthropic' as const,
      response: {
        usage: {
          input_tokens: 1,
          output_tokens: 2,
          output_tokens_details: { thinking_tokens: 3 }
        }
      }
    },
    {
      providerId: 'gemini' as const,
      response: { usageMetadata: { promptTokenCount: 1e308, candidatesTokenCount: 1 } }
    },
    {
      providerId: 'gemini' as const,
      response: {
        usageMetadata: {
          promptTokenCount: 1,
          candidatesTokenCount: 1,
          thoughtsTokenCount: Number.NaN
        }
      }
    },
    {
      providerId: 'openrouter' as const,
      response: { usage: { prompt_tokens: 1, completion_tokens: Number.POSITIVE_INFINITY } }
    },
    {
      providerId: 'openrouter' as const,
      response: { usage: { prompt_tokens: 1, completion_tokens: 1, cost: -0.1 } }
    },
    {
      providerId: 'openrouter' as const,
      response: {
        usage: {
          prompt_tokens: MAX_USAGE_TOKENS_PER_REQUEST + 1,
          completion_tokens: 1
        }
      }
    }
  ])('returns null for hostile $providerId usage: $response', ({ providerId, response }) => {
    expect(extractUsage(providerId, response)).toBeNull()
  })

  it('accepts bounded integer counts and a finite fractional provider cost', () => {
    expect(
      extractUsage('openrouter', {
        usage: {
          prompt_tokens: MAX_USAGE_TOKENS_PER_REQUEST,
          completion_tokens: 0,
          completion_tokens_details: { reasoning_tokens: 1 },
          cost: 0.000_001
        }
      })
    ).toEqual({
      inputTokens: MAX_USAGE_TOKENS_PER_REQUEST,
      outputTokens: 0,
      reasoningTokens: 1,
      providerCostUsd: 0.000_001
    })
  })

  it('returns null for null/non-object input, never throws', () => {
    expect(extractUsage('anthropic', null)).toBeNull()
    expect(extractUsage('gemini', 'nope')).toBeNull()
    expect(extractUsage('openrouter', 42)).toBeNull()
  })
})
