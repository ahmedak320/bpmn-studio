import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  FreeTranslateError,
  GOOGLE_FREE_URL,
  MYMEMORY_URL,
  makeFreeTranslateTexts,
  parseGoogleResponse,
  parseMyMemoryResponse
} from '../freeTranslate'

// freeTranslate.ts is DOM-free and fetch-injectable — this suite drives the
// whole chain in the node vitest environment with hand-rolled fetch fakes
// (no network). Response objects are minimal structural fakes: the module
// only reads `ok`, `status` and `json()`.

// --- fakes -------------------------------------------------------------------

function jsonResponse(data: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data
  } as unknown as Response
}

function makeFetch(handler: (url: string) => Response | Promise<Response>): {
  fetchImpl: typeof fetch
  urls: string[]
} {
  const urls: string[] = []
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input)
    urls.push(url)
    return handler(url)
  }) as typeof fetch
  return { fetchImpl, urls }
}

/** A well-formed gtx payload translating to `text` (single segment). */
const googleOk = (text: string): Response =>
  jsonResponse([[[text, 'source text', null, null]], null, 'en'])

const myMemoryOk = (text: string): Response =>
  jsonResponse({ responseStatus: 200, responseData: { translatedText: text } })

const q = (url: string): string | null => new URL(url).searchParams.get('q')

afterEach(() => {
  vi.unstubAllGlobals()
})

// === parseGoogleResponse =====================================================

describe('parseGoogleResponse', () => {
  it('joins multi-sentence segments in order', () => {
    const data = [
      [
        ['مرحبا. ', 'Hello. ', null],
        ['بالعالم', 'world', null]
      ],
      null,
      'en'
    ]
    expect(parseGoogleResponse(data)).toBe('مرحبا. بالعالم')
  })

  it('handles the single-segment shape', () => {
    expect(parseGoogleResponse([[['طلب', 'Order']]])).toBe('طلب')
  })

  it('skips non-array entries (trailing nulls) inside the segment list', () => {
    expect(parseGoogleResponse([[['A ', 'a'], null, ['B', 'b']]])).toBe('A B')
  })

  it('returns undefined on unexpected shapes', () => {
    expect(parseGoogleResponse(undefined)).toBeUndefined()
    expect(parseGoogleResponse(null)).toBeUndefined()
    expect(parseGoogleResponse({})).toBeUndefined()
    expect(parseGoogleResponse('text')).toBeUndefined()
    expect(parseGoogleResponse([])).toBeUndefined() // data[0] missing
    expect(parseGoogleResponse([null])).toBeUndefined() // data[0] not an array
    expect(parseGoogleResponse([['not-a-segment-array']])).toBeUndefined() // zero string segments
    expect(parseGoogleResponse([[[42, 'x']]])).toBeUndefined() // segment[0] not a string
  })
})

// === parseMyMemoryResponse ===================================================

describe('parseMyMemoryResponse', () => {
  it('returns the translated text for the ok shape', () => {
    expect(
      parseMyMemoryResponse({ responseStatus: 200, responseData: { translatedText: 'طلب' } })
    ).toBe('طلب')
  })

  it('accepts a string "200" responseStatus (the API is inconsistent)', () => {
    expect(
      parseMyMemoryResponse({ responseStatus: '200', responseData: { translatedText: 'ok' } })
    ).toBe('ok')
  })

  it('throws FreeTranslateError(rate, mymemory) on the quota body', () => {
    const data = {
      responseStatus: 200,
      responseData: {
        translatedText:
          'MYMEMORY WARNING: YOU USED ALL AVAILABLE FREE TRANSLATIONS FOR TODAY. NEXT RESET IN 12 HOURS'
      }
    }
    let thrown: unknown
    try {
      parseMyMemoryResponse(data)
    } catch (err) {
      thrown = err
    }
    expect(thrown).toBeInstanceOf(FreeTranslateError)
    expect((thrown as FreeTranslateError).code).toBe('rate')
    expect((thrown as FreeTranslateError).service).toBe('mymemory')
  })

  it('throws rate on responseStatus 429 (number or string)', () => {
    expect(() => parseMyMemoryResponse({ responseStatus: 429 })).toThrow(FreeTranslateError)
    expect(() => parseMyMemoryResponse({ responseStatus: '429' })).toThrow(FreeTranslateError)
  })

  it('detects the quota marker in responseDetails too', () => {
    expect(() =>
      parseMyMemoryResponse({
        responseStatus: 403,
        responseDetails: 'MYMEMORY WARNING: YOU USED ALL AVAILABLE FREE TRANSLATIONS FOR TODAY'
      })
    ).toThrow(FreeTranslateError)
  })

  it('returns undefined on malformed / unusable shapes', () => {
    expect(parseMyMemoryResponse(undefined)).toBeUndefined()
    expect(parseMyMemoryResponse(null)).toBeUndefined()
    expect(parseMyMemoryResponse('nope')).toBeUndefined()
    expect(parseMyMemoryResponse({})).toBeUndefined()
    expect(parseMyMemoryResponse({ responseStatus: 403 })).toBeUndefined()
    expect(
      parseMyMemoryResponse({ responseStatus: 200, responseData: { translatedText: '   ' } })
    ).toBeUndefined()
    expect(parseMyMemoryResponse({ responseStatus: 200, responseData: {} })).toBeUndefined()
    // A non-quota warning body is not a usable translation either.
    expect(
      parseMyMemoryResponse({
        responseStatus: 200,
        responseData: { translatedText: 'MYMEMORY WARNING: SOMETHING ELSE' }
      })
    ).toBeUndefined()
  })
})

// === makeFreeTranslateTexts ==================================================

describe('makeFreeTranslateTexts', () => {
  it('sends ONE google request per text and returns positional results', async () => {
    const { fetchImpl, urls } = makeFetch((url) => {
      expect(url.startsWith(GOOGLE_FREE_URL)).toBe(true)
      return googleOk(`AR:${q(url)}`)
    })
    const translate = makeFreeTranslateTexts({ fetchImpl, minDelayMs: 0 })

    const results = await translate(['Order', 'Approve request'], 'en', 'ar')

    expect(results).toEqual(['AR:Order', 'AR:Approve request'])
    expect(urls).toHaveLength(2) // one request per text, no batching
    expect(urls[0]).toContain('client=gtx')
    expect(urls[0]).toContain('sl=en')
    expect(urls[0]).toContain('tl=ar')
    expect(urls[0]).toContain('dt=t')
    expect(urls.some((u) => u.includes(`q=${encodeURIComponent('Approve request')}`))).toBe(true)
  })

  it('falls back to MyMemory PER TEXT when google fails for that text only', async () => {
    const { fetchImpl, urls } = makeFetch((url) => {
      if (url.startsWith(GOOGLE_FREE_URL)) {
        return q(url) === 'B' ? jsonResponse({ bogus: true }) : googleOk(`G:${q(url)}`)
      }
      expect(url.startsWith(MYMEMORY_URL)).toBe(true)
      return myMemoryOk(`MM:${q(url)}`)
    })
    const translate = makeFreeTranslateTexts({ fetchImpl, minDelayMs: 0 })

    const results = await translate(['A', 'B', 'C'], 'en', 'ar')

    expect(results).toEqual(['G:A', 'MM:B', 'G:C'])
    const myMemoryUrls = urls.filter((u) => u.startsWith(MYMEMORY_URL))
    expect(myMemoryUrls).toHaveLength(1) // only the failed text fell back
    expect(myMemoryUrls[0]).toContain('langpair=en%7Car') // pipe %7C-encoded
    expect(myMemoryUrls[0]).toContain('q=B')
  })

  it('leaves a positional undefined slot when both services fail for one text', async () => {
    const { fetchImpl } = makeFetch((url) => {
      if (q(url) === 'bad') return jsonResponse('broken', 500)
      return url.startsWith(GOOGLE_FREE_URL) ? googleOk(`G:${q(url)}`) : myMemoryOk(`MM:${q(url)}`)
    })
    const translate = makeFreeTranslateTexts({ fetchImpl, minDelayMs: 0 })

    const results = await translate(['ok1', 'bad', 'ok2'], 'en', 'ar')

    expect(results).toEqual(['G:ok1', undefined, 'G:ok2']) // partial ⇒ no throw
  })

  it('throws FreeTranslateError(service, chain) when EVERY text fails the same way', async () => {
    const { fetchImpl } = makeFetch(() => jsonResponse('down', 503))
    const translate = makeFreeTranslateTexts({ fetchImpl, minDelayMs: 0 })

    const err = await translate(['A', 'B'], 'en', 'ar').then(
      () => null,
      (e: unknown) => e
    )

    expect(err).toBeInstanceOf(FreeTranslateError)
    expect((err as FreeTranslateError).code).toBe('service')
    expect((err as FreeTranslateError).service).toBe('chain')
  })

  it('classifies quota exhaustion as rate (google down + mymemory 429)', async () => {
    const { fetchImpl } = makeFetch((url) =>
      url.startsWith(GOOGLE_FREE_URL) ? jsonResponse('x', 500) : jsonResponse(null, 429)
    )
    const translate = makeFreeTranslateTexts({ fetchImpl, minDelayMs: 0 })

    const err = await translate(['A'], 'en', 'ar').then(
      () => null,
      (e: unknown) => e
    )

    expect(err).toBeInstanceOf(FreeTranslateError)
    expect((err as FreeTranslateError).code).toBe('rate')
  })

  it('classifies quota via the MyMemory 200-with-warning body too', async () => {
    const { fetchImpl } = makeFetch((url) =>
      url.startsWith(GOOGLE_FREE_URL)
        ? jsonResponse('x', 500)
        : jsonResponse({
            responseStatus: 200,
            responseData: {
              translatedText: 'MYMEMORY WARNING: YOU USED ALL AVAILABLE FREE TRANSLATIONS FOR TODAY'
            }
          })
    )
    const err = await makeFreeTranslateTexts({ fetchImpl, minDelayMs: 0 })(['A'], 'en', 'ar').then(
      () => null,
      (e: unknown) => e
    )
    expect((err as FreeTranslateError).code).toBe('rate')
  })

  it('classifies fetch rejections while navigator reports offline as offline', async () => {
    vi.stubGlobal('navigator', { onLine: false })
    const { fetchImpl } = makeFetch(() => {
      throw new Error('network down')
    })
    const err = await makeFreeTranslateTexts({ fetchImpl, minDelayMs: 0 })(['A'], 'en', 'ar').then(
      () => null,
      (e: unknown) => e
    )
    expect(err).toBeInstanceOf(FreeTranslateError)
    expect((err as FreeTranslateError).code).toBe('offline')
  })

  it('classifies fetch rejections while online as service', async () => {
    vi.stubGlobal('navigator', { onLine: true })
    const { fetchImpl } = makeFetch(() => {
      throw new Error('connection reset')
    })
    const err = await makeFreeTranslateTexts({ fetchImpl, minDelayMs: 0 })(['A'], 'en', 'ar').then(
      () => null,
      (e: unknown) => e
    )
    expect((err as FreeTranslateError).code).toBe('service')
  })

  it('returns all-undefined WITHOUT throwing when all-fail causes are mixed', async () => {
    const { fetchImpl } = makeFetch((url) => {
      // text 'b' hits rate on both hops; text 'a' plain service failures.
      if (q(url) === 'b') return jsonResponse(null, 429)
      return jsonResponse('broken', 500)
    })
    const results = await makeFreeTranslateTexts({ fetchImpl, minDelayMs: 0 })(
      ['a', 'b'],
      'en',
      'ar'
    )
    expect(results).toEqual([undefined, undefined])
  })

  it('caps in-flight requests at the configured concurrency (default 4)', async () => {
    let inFlight = 0
    let maxInFlight = 0
    const { fetchImpl } = makeFetch(async (url) => {
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 5))
      inFlight -= 1
      return googleOk(`G:${q(url)}`)
    })
    const texts = Array.from({ length: 12 }, (_, i) => `text ${i}`)

    const results = await makeFreeTranslateTexts({ fetchImpl, minDelayMs: 0 })(texts, 'en', 'ar')

    expect(results).toHaveLength(12)
    expect(results.every((r) => typeof r === 'string')).toBe(true)
    expect(maxInFlight).toBeLessThanOrEqual(4)
    expect(maxInFlight).toBeGreaterThan(1) // genuinely parallel
  })

  it('respects a custom concurrency of 1 (strictly sequential)', async () => {
    let inFlight = 0
    let maxInFlight = 0
    const { fetchImpl } = makeFetch(async (url) => {
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 1))
      inFlight -= 1
      return googleOk(`G:${q(url)}`)
    })
    await makeFreeTranslateTexts({ fetchImpl, concurrency: 1, minDelayMs: 0 })(
      ['a', 'b', 'c'],
      'en',
      'ar'
    )
    expect(maxInFlight).toBe(1)
  })

  it('returns an empty array for zero texts without any network call', async () => {
    const { fetchImpl, urls } = makeFetch(() => {
      throw new Error('must not be called')
    })
    const results = await makeFreeTranslateTexts({ fetchImpl, minDelayMs: 0 })([], 'ar', 'en')
    expect(results).toEqual([])
    expect(urls).toHaveLength(0)
  })

  it('passes the direction through to both services (ar → en)', async () => {
    const { fetchImpl, urls } = makeFetch((url) =>
      url.startsWith(GOOGLE_FREE_URL) ? jsonResponse({}) : myMemoryOk('Request')
    )
    const results = await makeFreeTranslateTexts({ fetchImpl, minDelayMs: 0 })(['طلب'], 'ar', 'en')
    expect(results).toEqual(['Request'])
    expect(urls[0]).toContain('sl=ar')
    expect(urls[0]).toContain('tl=en')
    expect(urls[1]).toContain('langpair=ar%7Cen')
  })
})

// === FreeTranslateError ======================================================

describe('FreeTranslateError', () => {
  it('carries code + service and is a real Error', () => {
    const err = new FreeTranslateError('rate', 'chain')
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('FreeTranslateError')
    expect(err.code).toBe('rate')
    expect(err.service).toBe('chain')
    expect(err.message).toContain('rate')
  })

  it('accepts a custom message', () => {
    expect(new FreeTranslateError('offline', 'google', 'no net').message).toBe('no net')
  })
})
