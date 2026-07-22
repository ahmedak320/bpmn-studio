// Unit tests for the C1 AI adapter: the B4->B3 CallLLM bridge (object vs text
// passthrough) and the error classifier. Neither of these touches Electron or
// the AI SDK at runtime — adapter.ts imports those as erased type-only imports
// and the zod schema straight from the schema module — so no mocking needed.
import { describe, it, expect, vi } from 'vitest'
import { bridgeCallLLM, classifyError } from '../../src/main/ai/adapter'
import { ProcessModelSchema } from '../../src/gen/ir/schema'
import type { CallLLMParams, CallLLMResult } from '../../src/main/providers'
import type { LlmMessage } from '../../src/gen'

const messages: LlmMessage[] = [
  { role: 'user', content: 'draw an order process' },
  { role: 'assistant', content: '{"process":[]}' }
]

describe('bridgeCallLLM', () => {
  it('returns the parsed object when the provider produced one', async () => {
    const obj = { process: [{ type: 'startEvent', id: 'start' }] }
    const call = vi.fn(async (): Promise<CallLLMResult> => ({ object: obj, usedFallback: false }))

    const bridged = bridgeCallLLM(call)
    const result = await bridged(messages, { maxTokens: 3000 })

    expect(result).toBe(obj)
  })

  it('returns the raw text string when there is no object (fallback path)', async () => {
    const text = '{"process":[{"type":"startEvent","id":"start"}]}'
    const call = vi.fn(async (): Promise<CallLLMResult> => ({ text, usedFallback: true }))

    const bridged = bridgeCallLLM(call)
    const result = await bridged(messages, { maxTokens: 3000 })

    expect(result).toBe(text)
    expect(typeof result).toBe('string')
  })

  it('returns an empty string when neither object nor text is present', async () => {
    const call = vi.fn(async (): Promise<CallLLMResult> => ({ usedFallback: true }))
    const bridged = bridgeCallLLM(call)
    expect(await bridged(messages, { maxTokens: 3000 })).toBe('')
  })

  it('passes the IR schema, mapped roles, and maxTokens through to the B4 call', async () => {
    let seen: CallLLMParams | null = null
    const call = vi.fn(async (params: CallLLMParams): Promise<CallLLMResult> => {
      seen = params
      return { object: {}, usedFallback: false }
    })

    await bridgeCallLLM(call)(messages, { maxTokens: 1234 })

    expect(seen).not.toBeNull()
    const params = seen as unknown as CallLLMParams
    expect(params.schema).toBe(ProcessModelSchema)
    expect(params.maxTokens).toBe(1234)
    expect(params.messages).toEqual([
      { role: 'user', content: 'draw an order process' },
      { role: 'assistant', content: '{"process":[]}' }
    ])
  })

  it('reports the raw result (incl. usedFallback) via onResult', async () => {
    const call = vi.fn(async (): Promise<CallLLMResult> => ({ text: '{}', usedFallback: true }))
    const onResult = vi.fn()

    await bridgeCallLLM(call, onResult)(messages, { maxTokens: 3000 })

    expect(onResult).toHaveBeenCalledTimes(1)
    expect(onResult).toHaveBeenCalledWith({ text: '{}', usedFallback: true })
  })
})

describe('classifyError', () => {
  it('flags connectivity failures as offline', () => {
    const dns = classifyError(new Error('getaddrinfo ENOTFOUND api.openai.com'))
    expect(dns.offline).toBe(true)
    expect(dns.message.toLowerCase()).toMatch(/connection|proxy|reach/)

    const generic = classifyError(new Error('fetch failed'))
    expect(generic.offline).toBe(true)
  })

  it('follows the error cause chain to find a network code', () => {
    const outer = Object.assign(new Error('fetch failed'), {
      cause: Object.assign(new Error('connect ECONNREFUSED 1.2.3.4:443'), { code: 'ECONNREFUSED' })
    })
    expect(classifyError(outer).offline).toBe(true)
  })

  it('classifies auth failures with an API-key hint (not offline)', () => {
    const c = classifyError(new Error('401 Unauthorized: invalid api key'))
    expect(c.offline).toBe(false)
    expect(c.message.toLowerCase()).toMatch(/api key|authentication|settings/)
  })

  it('classifies rate-limit / overload failures (not offline)', () => {
    const c = classifyError(new Error('429 Too Many Requests'))
    expect(c.offline).toBe(false)
    expect(c.message.toLowerCase()).toMatch(/rate|overload|moment/)
  })

  it('classifies provider-config failures with a Settings hint', () => {
    const c = classifyError(new Error('Missing required field "apiKey" for openai'))
    expect(c.offline).toBe(false)
    expect(c.message.toLowerCase()).toMatch(/configured|settings/)
  })

  it('falls back to the raw (short) message for unknown errors', () => {
    const c = classifyError(new Error('Something unexpected broke'))
    expect(c.offline).toBe(false)
    expect(c.message).toBe('Something unexpected broke')
  })

  it('handles non-Error throwables', () => {
    const c = classifyError('plain string failure')
    expect(c.offline).toBe(false)
    expect(c.message).toBe('plain string failure')
  })
})
