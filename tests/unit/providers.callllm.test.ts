import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

const generateObject = vi.fn()
const generateText = vi.fn()

vi.mock('ai', () => ({
  generateObject,
  generateText
}))
vi.mock('electron', () => ({
  net: { fetch: vi.fn() }
}))
vi.mock('../../src/main/secrets', () => ({
  getAllKeys: vi.fn(async () => ({ openai: { apiKey: 'sk-1' } }))
}))
vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: vi.fn(() => vi.fn((modelId: string) => ({ kind: 'openai', modelId })))
}))

const schema = z.object({ ok: z.boolean() })

describe('providers.makeCallLLM', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns the parsed object on a successful generateObject call', async () => {
    generateObject.mockResolvedValueOnce({ object: { ok: true } })
    const { makeCallLLM } = await import('../../src/main/providers')
    const callLLM = makeCallLLM('openai', 'gpt-5.6-sol')

    const result = await callLLM({ schema, messages: [{ role: 'user', content: 'hi' }] })

    expect(result.usedFallback).toBe(false)
    expect(result.object).toEqual({ ok: true })
    expect(generateText).not.toHaveBeenCalled()
  })

  it('falls back to generateText + loose JSON parse when generateObject throws', async () => {
    generateObject.mockRejectedValueOnce(new Error('schema too complex for this provider'))
    generateText.mockResolvedValueOnce({ text: 'here is your answer: {"ok":true} thanks' })
    const { makeCallLLM } = await import('../../src/main/providers')
    const callLLM = makeCallLLM('openai', 'gpt-5.6-sol')

    const result = await callLLM({ schema, messages: [{ role: 'user', content: 'hi' }] })

    expect(result.usedFallback).toBe(true)
    expect(result.object).toEqual({ ok: true })
    expect(result.text).toContain('here is your answer')
  })
})
