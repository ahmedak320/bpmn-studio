import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  classifyBrowserError,
  extractText,
  makeBrowserCallLLM,
  MAX_AI_TECHNICAL_DETAIL_CODE_POINTS,
  MAX_PROVIDER_RESPONSE_BODY_BYTES,
  MAX_PROVIDER_RESPONSE_BODY_CHUNKS,
  MAX_PROVIDER_RESPONSE_ITEMS,
  MAX_PROVIDER_RESPONSE_TEXT_CHARS,
  ProviderHttpError,
  ProviderResponseError,
  type ProviderConfig
} from '../browserAi'
import { getUsageSnapshot, resetSessionUsageForTests } from '../credits'
import type { GenAttachment } from '../pdf'

const config: ProviderConfig = {
  providerId: 'anthropic',
  model: 'claude-test',
  apiKey: 'test-key'
}
const messages = [{ role: 'user' as const, content: 'Return a process.' }]

function nestedObject(depth: number): unknown {
  let value: unknown = { privateWorkspaceText: 'must-not-leak' }
  for (let index = 0; index < depth; index += 1) value = { nested: value }
  return value
}

function streamedResponse(
  chunks: Uint8Array[],
  options: { status?: number; headers?: Record<string, string> } = {}
): {
  response: Response
  cancel: ReturnType<typeof vi.fn>
  json: ReturnType<typeof vi.fn>
  text: ReturnType<typeof vi.fn>
} {
  let index = 0
  const cancel = vi.fn()
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[index]
      index += 1
      if (chunk) controller.enqueue(chunk)
      else controller.close()
    },
    cancel
  })
  const response = new Response(body, {
    status: options.status ?? 200,
    headers: options.headers
  })
  const json = vi.fn(() => Promise.reject(new Error('Response.json() must not be called')))
  const text = vi.fn(() => Promise.reject(new Error('Response.text() must not be called')))
  Object.defineProperties(response, {
    json: { value: json },
    text: { value: text }
  })
  return { response, cancel, json, text }
}

function encodedChunks(text: string, chunkBytes = 64 * 1024): Uint8Array[] {
  const bytes = new TextEncoder().encode(text)
  const chunks: Uint8Array[] = []
  for (let offset = 0; offset < bytes.byteLength; offset += chunkBytes) {
    chunks.push(bytes.slice(offset, offset + chunkBytes))
  }
  return chunks
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

const malformedResponses: Array<{
  name: string
  providerId: ProviderConfig['providerId']
  data: unknown
}> = [
  { name: 'null root', providerId: 'anthropic', data: null },
  { name: 'array root', providerId: 'gemini', data: [] },
  { name: 'missing Anthropic content', providerId: 'anthropic', data: {} },
  { name: 'object Anthropic content', providerId: 'anthropic', data: { content: {} } },
  {
    name: 'Anthropic content with a malformed item after valid text',
    providerId: 'anthropic',
    data: { content: [{ type: 'text', text: 'must-not-be-returned' }, null] }
  },
  {
    name: 'Anthropic text block with missing text',
    providerId: 'anthropic',
    data: { content: [{ type: 'text' }] }
  },
  {
    name: 'Anthropic thinking block with missing signature',
    providerId: 'anthropic',
    data: { content: [{ type: 'thinking', thinking: 'summary' }] }
  },
  {
    name: 'Anthropic redacted thinking block with malformed data',
    providerId: 'anthropic',
    data: { content: [{ type: 'redacted_thinking', data: 1 }] }
  },
  {
    name: 'Anthropic unknown content block',
    providerId: 'anthropic',
    data: { content: [{ type: 'tool_use', id: 'unexpected' }] }
  },
  { name: 'missing Gemini candidates', providerId: 'gemini', data: {} },
  { name: 'object Gemini candidates', providerId: 'gemini', data: { candidates: {} } },
  {
    name: 'Gemini candidate with missing content',
    providerId: 'gemini',
    data: { candidates: [{}] }
  },
  {
    name: 'Gemini content with missing parts',
    providerId: 'gemini',
    data: { candidates: [{ content: {} }] }
  },
  {
    name: 'object Gemini parts',
    providerId: 'gemini',
    data: { candidates: [{ content: { parts: {} } }] }
  },
  {
    name: 'Gemini parts with wrong item after valid text',
    providerId: 'gemini',
    data: {
      candidates: [{ content: { parts: [{ text: 'must-not-be-returned' }, { text: 42 }] } }]
    }
  },
  {
    name: 'Gemini candidates with a malformed unused alternative',
    providerId: 'gemini',
    data: {
      candidates: [{ content: { parts: [{ text: 'must-not-be-returned' }] } }, null]
    }
  },
  { name: 'missing OpenRouter choices', providerId: 'openrouter', data: {} },
  {
    name: 'object OpenRouter choices',
    providerId: 'openrouter',
    data: { choices: {} }
  },
  {
    name: 'OpenRouter choice with missing message',
    providerId: 'openrouter',
    data: { choices: [{}] }
  },
  {
    name: 'OpenRouter object content',
    providerId: 'openrouter',
    data: { choices: [{ message: { content: { text: 'wrong container' } } }] }
  },
  {
    name: 'OpenRouter null content',
    providerId: 'openrouter',
    data: { choices: [{ message: { content: null } }] }
  },
  {
    name: 'OpenRouter array content with malformed trailing item',
    providerId: 'openrouter',
    data: {
      choices: [{ message: { content: [{ text: 'must-not-be-returned' }, { type: 'text' }] } }]
    }
  },
  {
    name: 'OpenRouter choices with a malformed unused alternative',
    providerId: 'openrouter',
    data: {
      choices: [{ message: { content: 'must-not-be-returned' } }, null]
    }
  },
  {
    name: 'OpenRouter content over the text budget',
    providerId: 'openrouter',
    data: {
      choices: [{ message: { content: 'x'.repeat(MAX_PROVIDER_RESPONSE_TEXT_CHARS + 1) } }]
    }
  },
  {
    name: 'Anthropic ignored thinking fields over the text budget',
    providerId: 'anthropic',
    data: {
      content: [
        {
          type: 'thinking',
          thinking: '',
          signature: 'x'.repeat(MAX_PROVIDER_RESPONSE_TEXT_CHARS + 1)
        },
        { type: 'text', text: 'must-not-be-returned' }
      ]
    }
  },
  {
    name: 'OpenRouter content over the item budget',
    providerId: 'openrouter',
    data: {
      choices: [
        {
          message: {
            content: Array.from({ length: MAX_PROVIDER_RESPONSE_ITEMS + 1 }, () => ({
              text: 'x'
            }))
          }
        }
      ]
    }
  },
  {
    name: 'deep malformed OpenRouter content',
    providerId: 'openrouter',
    data: { choices: [{ message: { content: nestedObject(512) } }] }
  }
]

afterEach(() => {
  vi.unstubAllGlobals()
  resetSessionUsageForTests()
})

describe('browser AI failure boundaries', () => {
  it.each(malformedResponses)(
    'rejects $name as a typed, bounded invalid response',
    ({ providerId, data }) => {
      let error: unknown
      try {
        extractText(providerId, data)
      } catch (caught) {
        error = caught
      }

      expect(error).toBeInstanceOf(ProviderResponseError)
      expect(error).not.toBeInstanceOf(TypeError)
      expect(error).toMatchObject({
        name: 'ProviderResponseError',
        code: 'invalid-response',
        providerId
      })
      const classified = classifyBrowserError(error)
      expect(classified).toEqual({
        code: 'invalid-response',
        message: 'The AI provider returned an unreadable or empty response.',
        offline: false,
        technicalDetail: `${providerId}: invalid-response`
      })
      expect(classified.technicalDetail!.length).toBeLessThanOrEqual(200)
      expect(classified.technicalDetail).not.toContain('must-not')
      expect(classified.technicalDetail).not.toContain('privateWorkspaceText')
    }
  )

  it.each([
    {
      name: 'Anthropic text blocks',
      providerId: 'anthropic' as const,
      data: {
        content: [
          { type: 'text', text: '{"process":' },
          { type: 'text', text: '[]}' }
        ]
      },
      expected: '{"process":[]}'
    },
    {
      name: 'Gemini candidate parts',
      providerId: 'gemini' as const,
      data: {
        candidates: [{ content: { parts: [{ text: '{"process":' }, { text: '[]}' }] } }]
      },
      expected: '{"process":[]}'
    },
    {
      name: 'OpenRouter string content',
      providerId: 'openrouter' as const,
      data: { choices: [{ message: { content: '{"process":[]}' } }] },
      expected: '{"process":[]}'
    },
    {
      name: 'OpenRouter text-part content',
      providerId: 'openrouter' as const,
      data: {
        choices: [{ message: { content: [{ text: '{"process":' }, { text: '[]}' }] } }]
      },
      expected: '{"process":[]}'
    }
  ])('accepts $name without changing its text', ({ providerId, data, expected }) => {
    expect(extractText(providerId, data)).toBe(expected)
  })

  it('never exposes provider HTTP response text as technical detail', () => {
    const diagnostic = 'openrouter 503: {"error":"upstream unavailable"}'
    const classified = classifyBrowserError(new ProviderHttpError(503, diagnostic))

    expect(classified).toEqual({
      code: 'provider',
      message: 'The AI provider returned an error.',
      offline: false,
      technicalDetail: 'HTTP 503'
    })
    expect(classified.message).not.toContain('upstream unavailable')
    expect(classified.technicalDetail).not.toContain('upstream unavailable')
  })

  it('drops an untrusted request-id value from technical evidence', () => {
    const secret = 'PRIVATE prompt echoed through header'
    const classified = classifyBrowserError(
      new ProviderHttpError(400, 'ignored body', undefined, {
        providerId: 'openrouter',
        requestId: secret
      })
    )

    expect(classified.technicalDetail).toBe('openrouter: HTTP 400')
    expect(classified.message).not.toContain(secret)
    expect(classified.technicalDetail).not.toContain(secret)
  })

  it('turns invalid and empty successful responses into typed response errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(new Response('not-json', { status: 200 }))
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ content: [] }), {
            status: 200,
            headers: { 'content-type': 'application/json' }
          })
        )
    )
    const call = makeBrowserCallLLM(config)

    await expect(call(messages, { maxTokens: 100 })).rejects.toMatchObject({
      name: 'ProviderResponseError',
      code: 'invalid-json',
      providerId: 'anthropic'
    })
    await expect(call(messages, { maxTokens: 100 })).rejects.toMatchObject({
      name: 'ProviderResponseError',
      code: 'empty-response',
      providerId: 'anthropic'
    })
    expect(getUsageSnapshot('anthropic').session).toMatchObject({
      requests: 2,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: null,
      costKind: 'unknown'
    })
  })

  it('rejects an over-cap declared length before reading and cancels the body', async () => {
    const streamed = streamedResponse(encodedChunks('{"content":[]}'), {
      headers: { 'content-length': String(MAX_PROVIDER_RESPONSE_BODY_BYTES + 1) }
    })
    const fetchMock = vi.fn().mockResolvedValue(streamed.response)
    vi.stubGlobal('fetch', fetchMock)

    const error = await makeBrowserCallLLM(config)(messages, { maxTokens: 100 }).catch(
      (caught: unknown) => caught
    )

    expect(error).toMatchObject({
      name: 'ProviderResponseError',
      code: 'invalid-response',
      providerId: 'anthropic'
    })
    expect(classifyBrowserError(error).technicalDetail).toBe('anthropic: invalid-response')
    expect(streamed.cancel).toHaveBeenCalledTimes(1)
    expect(streamed.json).not.toHaveBeenCalled()
    expect(streamed.text).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(getUsageSnapshot('anthropic').session.requests).toBe(1)
  })

  it.each([
    { name: 'missing', headers: undefined },
    { name: 'lying', headers: { 'content-length': '12' } }
  ])('enforces the decompressed byte cap with $name Content-Length', async ({ headers }) => {
    const chunks = [
      new Uint8Array(Math.floor(MAX_PROVIDER_RESPONSE_BODY_BYTES / 2)),
      new Uint8Array(Math.floor(MAX_PROVIDER_RESPONSE_BODY_BYTES / 2)),
      new Uint8Array(2),
      ...Array.from({ length: 8 }, () => new Uint8Array(64 * 1024))
    ]
    const streamed = streamedResponse(chunks, { headers })
    const fetchMock = vi.fn().mockResolvedValue(streamed.response)
    vi.stubGlobal('fetch', fetchMock)

    const error = await makeBrowserCallLLM(config)(messages, { maxTokens: 100 }).catch(
      (caught: unknown) => caught
    )

    expect(error).toMatchObject({
      name: 'ProviderResponseError',
      code: 'invalid-response',
      providerId: 'anthropic'
    })
    expect(streamed.cancel).toHaveBeenCalledTimes(1)
    expect(streamed.json).not.toHaveBeenCalled()
    expect(streamed.text).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(getUsageSnapshot('anthropic').session.requests).toBe(1)
  })

  it('caps zero-byte chunk churn and counts the accepted request as unknown usage', async () => {
    const streamed = streamedResponse(
      Array.from({ length: MAX_PROVIDER_RESPONSE_BODY_CHUNKS + 2 }, () => new Uint8Array())
    )
    const fetchMock = vi.fn().mockResolvedValue(streamed.response)
    vi.stubGlobal('fetch', fetchMock)

    const error = await makeBrowserCallLLM(config)(messages, { maxTokens: 100 }).catch(
      (caught: unknown) => caught
    )

    expect(error).toMatchObject({
      name: 'ProviderResponseError',
      code: 'invalid-response',
      providerId: 'anthropic'
    })
    expect(streamed.cancel).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(getUsageSnapshot('anthropic').session.requests).toBe(1)
  })

  it('rejects a huge unused JSON field before parsing and records unknown usage', async () => {
    const body =
      '{"content":[{"type":"text","text":"valid"}],"usage":{"input_tokens":1,' +
      '"output_tokens":1},"unused":"' +
      'private-prompt-'.repeat(Math.ceil((MAX_PROVIDER_RESPONSE_BODY_BYTES * 2) / 15)) +
      '"}'
    const streamed = streamedResponse(encodedChunks(body))
    const fetchMock = vi.fn().mockResolvedValue(streamed.response)
    vi.stubGlobal('fetch', fetchMock)

    const error = await makeBrowserCallLLM(config)(messages, { maxTokens: 100 }).catch(
      (caught: unknown) => caught
    )

    expect(error).toMatchObject({ code: 'invalid-response' })
    expect(streamed.cancel).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(getUsageSnapshot('anthropic').session).toMatchObject({
      requests: 1,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: null,
      costKind: 'unknown'
    })
  })

  it('accepts bounded deep unused JSON and never calls full-body helpers', async () => {
    const depth = 2_000
    const body =
      '{"content":[{"type":"text","text":"VALID"}],"unused":' +
      '['.repeat(depth) +
      '0' +
      ']'.repeat(depth) +
      '}'
    const streamed = streamedResponse(encodedChunks(body, 127))
    const fetchMock = vi.fn().mockResolvedValue(streamed.response)
    vi.stubGlobal('fetch', fetchMock)

    await expect(makeBrowserCallLLM(config)(messages, { maxTokens: 100 })).resolves.toBe('VALID')
    expect(streamed.cancel).not.toHaveBeenCalled()
    expect(streamed.json).not.toHaveBeenCalled()
    expect(streamed.text).not.toHaveBeenCalled()
  })

  it('types bounded invalid JSON without retrying or exposing its contents', async () => {
    const secret = 'PRIVATE-PROMPT-CONTENT'
    const streamed = streamedResponse(encodedChunks(`{"content":"${secret}"`))
    const fetchMock = vi.fn().mockResolvedValue(streamed.response)
    vi.stubGlobal('fetch', fetchMock)

    const error = await makeBrowserCallLLM(config)(messages, { maxTokens: 100 }).catch(
      (caught: unknown) => caught
    )
    const classified = classifyBrowserError(error)

    expect(error).toMatchObject({ code: 'invalid-json' })
    expect(classified).toMatchObject({
      code: 'invalid-response',
      technicalDetail: 'anthropic: invalid-json'
    })
    expect(errorMessage(error)).not.toContain(secret)
    expect(classified.message).not.toContain(secret)
    expect(classified.technicalDetail).not.toContain(secret)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('cancels a hostile non-2xx body without reading it and retains only safe metadata', async () => {
    const secret = 'PRIVATE USER PROMPT: approve acquisition'
    const body = `${secret}\n${'x'.repeat(64 * 1024)}`
    const streamed = streamedResponse(encodedChunks(body, 4_096), {
      status: 400,
      headers: {
        'x-request-id': 'req-safe_123',
        'content-length': '10'
      }
    })
    const fetchMock = vi.fn().mockResolvedValue(streamed.response)
    vi.stubGlobal('fetch', fetchMock)

    const error = await makeBrowserCallLLM(config)(messages, { maxTokens: 100 }).catch(
      (caught: unknown) => caught
    )
    const classified = classifyBrowserError(error)

    expect(error).toBeInstanceOf(ProviderHttpError)
    expect(errorMessage(error)).not.toContain(secret)
    expect(classified).toEqual({
      code: 'provider',
      message: 'The AI provider returned an error.',
      offline: false,
      technicalDetail: 'anthropic: HTTP 400; request-id req-safe_123'
    })
    expect(classified.message).not.toContain(secret)
    expect(classified.technicalDetail).not.toContain(secret)
    expect(streamed.cancel).toHaveBeenCalledTimes(1)
    expect(streamed.json).not.toHaveBeenCalled()
    expect(streamed.text).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('classifies a permanent status before touching a stalled body and never retries it', async () => {
    const cancel = vi.fn(() => Promise.resolve())
    const getReader = vi.fn(() => {
      throw new Error('A permanent response body must not be read.')
    })
    const response = {
      ok: false,
      status: 400,
      headers: new Headers(),
      body: { cancel, getReader }
    } as unknown as Response
    const fetchMock = vi.fn().mockResolvedValue(response)
    vi.stubGlobal('fetch', fetchMock)

    await expect(makeBrowserCallLLM(config)(messages, { maxTokens: 100 })).rejects.toMatchObject({
      name: 'ProviderHttpError',
      status: 400
    })

    expect(cancel).toHaveBeenCalledTimes(1)
    expect(getReader).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(getUsageSnapshot('anthropic').session.requests).toBe(0)
  })

  it('keeps transient status retry behavior without leaking hostile bodies', async () => {
    const secret = 'PRIVATE-PROMPT-ECHO'
    const fetchMock = vi.fn(() => {
      const streamed = streamedResponse(encodedChunks(secret), {
        status: 503,
        headers: { 'request-id': 'retry-req-1' }
      })
      return Promise.resolve(streamed.response)
    })
    vi.stubGlobal('fetch', fetchMock)

    const error = await makeBrowserCallLLM(config)(messages, { maxTokens: 100 }).catch(
      (caught: unknown) => caught
    )
    const classified = classifyBrowserError(error)

    expect(error).toBeInstanceOf(ProviderHttpError)
    expect(errorMessage(error)).not.toContain(secret)
    expect(classified).toMatchObject({
      code: 'provider',
      technicalDetail: 'anthropic: HTTP 503; request-id retry-req-1'
    })
    expect(classified.message).not.toContain(secret)
    expect(classified.technicalDetail).not.toContain(secret)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('types mid-body read failures as network errors, retries them, and counts every 2xx', async () => {
    const failedResponse = (): Response =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.error(new TypeError('connection reset during response body'))
          }
        }),
        { status: 200 }
      )
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => Promise.resolve(failedResponse()))
      .mockImplementationOnce(() => Promise.resolve(failedResponse()))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            content: [{ type: 'text', text: 'VALID' }],
            usage: { input_tokens: 5, output_tokens: 7 }
          }),
          { status: 200 }
        )
      )
    vi.stubGlobal('fetch', fetchMock)

    await expect(makeBrowserCallLLM(config)(messages, { maxTokens: 100 })).resolves.toBe('VALID')

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(getUsageSnapshot('anthropic').session).toMatchObject({
      requests: 3,
      inputTokens: 5,
      outputTokens: 7,
      reasoningTokens: 0,
      costUsd: null,
      costKind: 'unknown'
    })
  })

  it('keeps an attachment mid-body failure typed but deliberately single-shot', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.error(new TypeError('connection reset during attachment response'))
          }
        }),
        { status: 200 }
      )
    )
    vi.stubGlobal('fetch', fetchMock)
    const attachment = {
      kind: 'image',
      base64: 'aW1hZ2U=',
      mediaType: 'image/png',
      fileName: 'private.png',
      sizeBytes: 5
    } satisfies GenAttachment

    await expect(
      makeBrowserCallLLM(config, { attachment })(messages, { maxTokens: 100 })
    ).rejects.toMatchObject({
      name: 'TransportError',
      code: 'network'
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(getUsageSnapshot('anthropic').session.requests).toBe(1)
  })

  it('contains a hostile fetch rejection and retries it as a typed network failure', async () => {
    const hostile = new Proxy(new Error('hidden'), {
      get(target, property, receiver) {
        if (property === 'message') throw new Error('hostile message getter')
        return Reflect.get(target, property, receiver)
      },
      getPrototypeOf() {
        throw new Error('hostile prototype trap')
      }
    })
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(hostile)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ content: [{ type: 'text', text: 'VALID' }] }), {
          status: 200
        })
      )
    vi.stubGlobal('fetch', fetchMock)

    await expect(makeBrowserCallLLM(config)(messages, { maxTokens: 100 })).resolves.toBe('VALID')

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(getUsageSnapshot('anthropic').session.requests).toBe(1)
  })

  it('types a response-reader acquisition failure as network and retries it', async () => {
    const unavailableBody = {
      ok: true,
      status: 200,
      headers: new Headers(),
      body: {
        getReader() {
          throw new TypeError('response stream is unavailable')
        }
      }
    } as unknown as Response
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(unavailableBody)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ content: [{ type: 'text', text: 'VALID' }] }), {
          status: 200
        })
      )
    vi.stubGlobal('fetch', fetchMock)

    await expect(makeBrowserCallLLM(config)(messages, { maxTokens: 100 })).resolves.toBe('VALID')

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(getUsageSnapshot('anthropic').session.requests).toBe(2)
  })

  it('cancels a pending body reader when the caller aborts', async () => {
    let resolveRead: ((result: ReadableStreamReadResult<Uint8Array>) => void) | undefined
    const read = vi.fn(
      () =>
        new Promise<ReadableStreamReadResult<Uint8Array>>((resolve) => {
          resolveRead = resolve
        })
    )
    const cancel = vi.fn()
    cancel.mockImplementation(() => {
      resolveRead?.({ done: true, value: undefined })
      return Promise.resolve()
    })
    const response = {
      ok: true,
      status: 200,
      headers: new Headers(),
      body: {
        getReader: () => ({
          read,
          cancel,
          releaseLock: vi.fn()
        })
      }
    } as unknown as Response
    const fetchMock = vi.fn().mockResolvedValue(response)
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()
    const pending = makeBrowserCallLLM(config, { signal: controller.signal })(messages, {
      maxTokens: 100
    })

    await Promise.resolve()
    await Promise.resolve()
    controller.abort()

    const error = await pending.catch((caught: unknown) => caught)
    expect(classifyBrowserError(error).code).toBe('cancelled')
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(getUsageSnapshot('anthropic').session.requests).toBe(1)
  })

  it('records hostile usage as unknown only after valid response text is accepted', async () => {
    const body = JSON.stringify({
      content: [{ type: 'text', text: 'VALID' }],
      usage: { input_tokens: -1, output_tokens: 1e308 }
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, { status: 200 })))

    await expect(makeBrowserCallLLM(config)(messages, { maxTokens: 100 })).resolves.toBe('VALID')
    expect(getUsageSnapshot('anthropic').session).toMatchObject({
      requests: 1,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: null,
      costKind: 'unknown'
    })
  })

  it('records validated usage attached to an accepted but malformed response shape', async () => {
    const body = JSON.stringify({
      content: { text: 'malformed' },
      usage: { input_tokens: 12, output_tokens: 34 }
    })
    const fetchMock = vi.fn().mockResolvedValue(new Response(body, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(makeBrowserCallLLM(config)(messages, { maxTokens: 100 })).rejects.toMatchObject({
      code: 'invalid-response'
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(getUsageSnapshot('anthropic').session).toMatchObject({
      requests: 1,
      inputTokens: 12,
      outputTokens: 34,
      reasoningTokens: 0
    })
  })

  it.each([
    { name: 'text', attachment: undefined },
    {
      name: 'PDF document',
      attachment: {
        kind: 'pdf',
        base64: 'cGRm',
        mediaType: 'application/pdf',
        fileName: 'private.pdf',
        sizeBytes: 3
      } satisfies GenAttachment
    },
    {
      name: 'image',
      attachment: {
        kind: 'image',
        base64: 'aW1hZ2U=',
        mediaType: 'image/png',
        fileName: 'private.png',
        sizeBytes: 5
      } satisfies GenAttachment
    }
  ])('uses the same strict OpenRouter parser for $name requests', async ({ attachment }) => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: [{ text: '{"process":[]}' }, { text: { nested: 'wrong' } }]
              }
            }
          ]
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' }
        }
      )
    )
    vi.stubGlobal('fetch', fetchMock)
    const call = makeBrowserCallLLM(
      {
        providerId: 'openrouter',
        model: 'test/model',
        apiKey: 'test-key'
      },
      { attachment }
    )

    const error = await call(messages, { maxTokens: 100 }).catch((caught: unknown) => caught)

    expect(error).toMatchObject({
      name: 'ProviderResponseError',
      code: 'invalid-response',
      providerId: 'openrouter'
    })
    expect(classifyBrowserError(error).code).toBe('invalid-response')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('maps response errors to an invalid-response summary without leaking their cause', () => {
    const classified = classifyBrowserError(
      new ProviderResponseError('invalid-json', 'anthropic', {
        cause: new SyntaxError('provider body contained private raw content')
      })
    )

    expect(classified).toEqual({
      code: 'invalid-response',
      message: 'The AI provider returned an unreadable or empty response.',
      offline: false,
      technicalDetail: 'anthropic: invalid-json'
    })
    expect(classified.message).not.toContain('private raw content')
    expect(classified.technicalDetail).not.toContain('private raw content')
  })

  it('bounds unknown diagnostics and never uses them as the user-facing summary', () => {
    const diagnostic = `provider exploded: ${'x'.repeat(100_000)}\nsecret second line`
    const classified = classifyBrowserError(new Error(diagnostic))

    expect(classified.code).toBe('unknown')
    expect(classified.message).toBe('The AI operation failed unexpectedly.')
    expect(Array.from(classified.technicalDetail!).length).toBeLessThanOrEqual(
      MAX_AI_TECHNICAL_DETAIL_CODE_POINTS
    )
    expect(classified.technicalDetail?.endsWith('…')).toBe(true)
    expect(classified.technicalDetail).not.toContain('secret second line')
  })

  it('classifies hostile thrown values without allowing proxy traps to escape', () => {
    const hostile = new Proxy(
      {},
      {
        get() {
          throw new Error('hostile getter')
        },
        getPrototypeOf() {
          throw new Error('hostile prototype')
        }
      }
    )

    expect(() => classifyBrowserError(hostile)).not.toThrow()
    expect(classifyBrowserError(hostile)).toEqual({
      code: 'unknown',
      message: 'The AI operation failed unexpectedly.',
      offline: false
    })
  })

  it('bounds diagnostics by Unicode code points and removes unsafe direction controls', () => {
    const diagnostic = `prefix😀\u202e\u2066\u061c\u200f\ud800${'x'.repeat(300)}`
    const classified = classifyBrowserError(new Error(diagnostic))
    const detail = classified.technicalDetail!

    expect(classified.code).toBe('unknown')
    expect(Array.from(detail).length).toBeLessThanOrEqual(MAX_AI_TECHNICAL_DETAIL_CODE_POINTS)
    expect(detail).toContain('😀')
    expect(detail).not.toMatch(/[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u)
    expect(detail).not.toMatch(/[\ud800-\udfff]/u)
    expect(detail.endsWith('…')).toBe(true)
  })

  it('treats Unicode line separators as diagnostic line boundaries', () => {
    const classified = classifyBrowserError(new Error('safe first line\u2028private second line'))

    expect(classified.technicalDetail).toBe('safe first line')
  })
})
