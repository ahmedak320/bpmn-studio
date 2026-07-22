import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  makeBrowserCallLLM,
  GENERATION_TIMEOUT_MS,
  ProviderHttpError,
  TransportError,
  type ProviderConfig
} from '../browserAi'

const cfg: ProviderConfig = { providerId: 'anthropic', model: 'claude', apiKey: 'k' }
const msgs = [{ role: 'user' as const, content: 'hi' }]

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

/** A fetch whose HEADERS resolve immediately but whose BODY (json/text) stalls
 *  until the request's AbortSignal fires — the "server sent headers then hung"
 *  case the pre-fix timeout did NOT cover (it cleared the timer after headers). */
function stalledBodyFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((_url: string, init: RequestInit) => {
      const signal = init.signal as AbortSignal
      const stall = <T>(): Promise<T> =>
        new Promise<T>((_resolve, reject) => {
          const abort = (): void => reject(new DOMException('Aborted', 'AbortError'))
          if (signal.aborted) abort()
          else signal.addEventListener('abort', abort)
        })
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => stall<unknown>(),
        text: () => stall<string>()
      } as unknown as Response)
    })
  )
}

describe('generation timeout covers the response BODY (ORIG-10)', () => {
  it('a response whose body stalls forever still times out', async () => {
    vi.useFakeTimers()
    stalledBodyFetch()
    const call = makeBrowserCallLLM(cfg)
    let outcome = 'pending'
    void call(msgs, { maxTokens: 1 }).then(
      () => {
        outcome = 'resolved'
      },
      (e: unknown) => {
        outcome = e instanceof TransportError ? e.code : 'other-error'
      }
    )
    await vi.advanceTimersByTimeAsync(GENERATION_TIMEOUT_MS + 1000)
    for (let i = 0; i < 5; i++) await Promise.resolve()
    expect(outcome).toBe('timeout')
  })

  it('a normal (non-stalled) response still resolves with the model text', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ content: [{ type: 'text', text: 'HELLO-XML' }] }), {
            status: 200
          })
        )
      )
    )
    const text = await makeBrowserCallLLM(cfg)(msgs, { maxTokens: 1 })
    expect(text).toBe('HELLO-XML')
  })

  it('preserves error typing: 401 → TransportError(auth), 500 → ProviderHttpError (retriable)', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('nope', { status: 401 }))))
    await expect(makeBrowserCallLLM(cfg)(msgs, { maxTokens: 1 })).rejects.toMatchObject({
      transport: true,
      code: 'auth'
    })

    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('boom', { status: 500 }))))
    await expect(makeBrowserCallLLM(cfg)(msgs, { maxTokens: 1 })).rejects.toBeInstanceOf(
      ProviderHttpError
    )
  })

  it('an empty-text response stays a plain (retriable) error, not a transport error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(new Response(JSON.stringify({ content: [] }), { status: 200 }))
      )
    )
    const err = await makeBrowserCallLLM(cfg)(msgs, { maxTokens: 1 }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(Error)
    expect(err).not.toBeInstanceOf(TransportError)
    expect(err).not.toBeInstanceOf(ProviderHttpError)
  })
})
