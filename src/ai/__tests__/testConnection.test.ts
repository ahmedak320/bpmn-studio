import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { buildTestConnectionReview, testConnection, type ProviderConfig } from '../browserAi'
import { getUsageSnapshot, resetSessionUsageForTests } from '../credits'

const cfg = (over: Partial<ProviderConfig>): ProviderConfig => ({
  providerId: 'openrouter',
  model: '',
  apiKey: '',
  ...over
})

function mockFetch(impl: (url: string, init: RequestInit) => Promise<Response> | Response): void {
  vi.stubGlobal('fetch', vi.fn(impl))
}

function fetchMock(): ReturnType<typeof vi.fn> {
  return globalThis.fetch as unknown as ReturnType<typeof vi.fn>
}

beforeEach(() => {
  resetSessionUsageForTests()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('CORS-vs-auth discriminator', () => {
  it('reviews the exact provider, model, one-request payload, and billable flag', async () => {
    const providerConfig = cfg({
      providerId: 'openrouter',
      model: 'vendor/exact-model',
      apiKey: 'secret-never-in-body'
    })
    const review = buildTestConnectionReview(providerConfig)

    expect(review).toMatchObject({
      providerId: 'openrouter',
      modelId: 'vendor/exact-model',
      requestCount: 1,
      mayBeBillable: true
    })
    expect(JSON.stringify(review.payload)).toContain('"content":"ping"')
    expect(JSON.stringify(review.payload)).not.toContain(providerConfig.apiKey)

    mockFetch(() => new Response('', { status: 401 }))
    await testConnection(providerConfig)
    const [, init] = fetchMock().mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toEqual(review.payload)
  })

  it('a READABLE 401 ⇒ reachable, CORS open, "key invalid" verdict', async () => {
    mockFetch(() => new Response('unauthorized', { status: 401 }))
    const r = await testConnection(cfg({ providerId: 'anthropic', apiKey: '' }))
    expect(r.reachable).toBe(true)
    expect(r.blockedOrUnreachable).toBe(false)
    expect(r.status).toBe(401)
    expect(r.message).toMatch(/reachable/i)
    expect(r.message).toMatch(/rejected the key|key/i)
  })

  it('a thrown TypeError (Failed to fetch) ⇒ BLOCKED-OR-UNREACHABLE verdict', async () => {
    mockFetch(() => {
      throw new TypeError('Failed to fetch')
    })
    const r = await testConnection(cfg({ providerId: 'gemini' }))
    expect(r.reachable).toBe(false)
    // Renamed from corsBlocked: a fetch reject is CORS OR offline OR DNS (ORIG-14).
    expect(r.blockedOrUnreachable).toBe(true)
    expect(r.message).toMatch(/blocked or unreachable|could not read/i)
  })

  it('contains hostile fetch rejection getters instead of throwing during classification', async () => {
    const hostile = new Proxy(new Error('hidden'), {
      get(target, property, receiver) {
        if (property === 'message') throw new Error('hostile message getter')
        return Reflect.get(target, property, receiver)
      },
      getPrototypeOf() {
        throw new Error('hostile prototype trap')
      }
    })
    mockFetch(() => Promise.reject(hostile))

    await expect(testConnection(cfg({ providerId: 'gemini' }))).resolves.toMatchObject({
      reachable: false,
      blockedOrUnreachable: true,
      code: 'blocked'
    })
  })

  it('a 200 ⇒ reachable + "key works"', async () => {
    mockFetch(() => new Response('{}', { status: 200 }))
    const r = await testConnection(cfg({ providerId: 'openrouter', apiKey: 'sk-real' }))
    expect(r.reachable).toBe(true)
    expect(r.status).toBe(200)
    expect(r.message).toMatch(/key works|accepted/i)
    expect(getUsageSnapshot('openrouter').session).toMatchObject({
      requests: 1,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: null,
      costKind: 'unknown'
    })
  })

  it('cancels the unused response body as soon as the status is readable', async () => {
    const cancel = vi.fn(() => Promise.resolve())
    mockFetch(
      () =>
        ({
          ok: true,
          status: 200,
          headers: new Headers(),
          body: { cancel }
        }) as unknown as Response
    )

    await expect(
      testConnection(cfg({ providerId: 'openrouter', apiKey: 'sk-real' }))
    ).resolves.toMatchObject({
      reachable: true,
      status: 200
    })

    expect(cancel).toHaveBeenCalledTimes(1)
    expect(getUsageSnapshot('openrouter').session.requests).toBe(1)
  })

  it('a 400 ⇒ reachable (CORS OK)', async () => {
    mockFetch(() => new Response('bad', { status: 400 }))
    const r = await testConnection(cfg({ providerId: 'gemini' }))
    expect(r.reachable).toBe(true)
    expect(r.blockedOrUnreachable).toBe(false)
    expect(r.message).toMatch(/reachable/i)
    expect(getUsageSnapshot('gemini').session.requests).toBe(0)
  })

  it('probes with a dummy key when none is stored (no key leaked, request still made)', async () => {
    mockFetch(() => new Response('', { status: 401 }))
    await testConnection(cfg({ providerId: 'anthropic', apiKey: '' }))
    const [, init] = fetchMock().mock.calls[0] as [string, RequestInit]
    const headers = init.headers as Record<string, string>
    // A probe key is used — never an empty x-api-key.
    expect(headers['x-api-key']).toBeTruthy()
    expect(headers['x-api-key']).not.toBe('')
  })

  it('uses a fallback model id for the probe when none is chosen', async () => {
    mockFetch(() => new Response('', { status: 401 }))
    await testConnection(cfg({ providerId: 'openrouter', model: '' }))
    const [url] = fetchMock().mock.calls[0] as [string]
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions')
    // body carries a non-empty model
    const [, init] = fetchMock().mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string)
    expect(String(body.model).length).toBeGreaterThan(0)
  })

  it('propagates a caller AbortSignal as a typed cancellation', async () => {
    let fetchSignal: AbortSignal | undefined
    mockFetch(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          fetchSignal = init.signal as AbortSignal
          const rejectAbort = (): void =>
            reject(new DOMException('The probe was aborted.', 'AbortError'))
          if (fetchSignal.aborted) rejectAbort()
          else fetchSignal.addEventListener('abort', rejectAbort, { once: true })
        })
    )
    const controller = new AbortController()
    const pending = testConnection(cfg({ providerId: 'anthropic' }), controller.signal)

    await vi.waitFor(() => expect(fetchSignal).toBeDefined())
    controller.abort()

    await expect(pending).rejects.toMatchObject({
      name: 'TransportError',
      code: 'cancelled'
    })
    expect(fetchSignal?.aborted).toBe(true)
    expect(fetchMock()).toHaveBeenCalledTimes(1)
    expect(getUsageSnapshot('anthropic').session.requests).toBe(0)
  })

  it('still counts and cancels a 2xx response accepted just before caller cancellation', async () => {
    const cancel = vi.fn(() => Promise.resolve())
    const response = {
      ok: true,
      status: 200,
      headers: new Headers(),
      body: { cancel }
    } as unknown as Response
    mockFetch(() => Promise.resolve(response))
    const controller = new AbortController()
    const pending = testConnection(
      cfg({ providerId: 'openrouter', apiKey: 'sk-real' }),
      controller.signal
    )

    controller.abort()

    await expect(pending).rejects.toMatchObject({
      name: 'TransportError',
      code: 'cancelled'
    })
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(getUsageSnapshot('openrouter').session.requests).toBe(1)
  })
})
