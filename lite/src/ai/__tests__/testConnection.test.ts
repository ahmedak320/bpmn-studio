import { describe, it, expect, vi, afterEach } from 'vitest'
import { testConnection, type ProviderConfig } from '../browserAi'

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

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('CORS-vs-auth discriminator', () => {
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

  it('a 200 ⇒ reachable + "key works"', async () => {
    mockFetch(() => new Response('{}', { status: 200 }))
    const r = await testConnection(cfg({ providerId: 'openrouter', apiKey: 'sk-real' }))
    expect(r.reachable).toBe(true)
    expect(r.status).toBe(200)
    expect(r.message).toMatch(/key works|accepted/i)
  })

  it('a 400 ⇒ reachable (CORS OK)', async () => {
    mockFetch(() => new Response('bad', { status: 400 }))
    const r = await testConnection(cfg({ providerId: 'gemini' }))
    expect(r.reachable).toBe(true)
    expect(r.blockedOrUnreachable).toBe(false)
    expect(r.message).toMatch(/reachable/i)
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

  it('refuses to probe a custom endpoint with no base URL (not a CORS block)', async () => {
    mockFetch(() => new Response('', { status: 200 }))
    const r = await testConnection(cfg({ providerId: 'custom', baseURL: '' }))
    expect(r.reachable).toBe(false)
    expect(r.blockedOrUnreachable).toBe(false)
    expect(r.message).toMatch(/base url/i)
    expect(fetchMock()).not.toHaveBeenCalled()
  })
})
