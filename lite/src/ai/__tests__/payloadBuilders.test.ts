import { describe, it, expect } from 'vitest'
import {
  buildAnthropicRequest,
  buildGeminiRequest,
  buildOpenRouterRequest,
  buildCustomRequest,
  buildRequest,
  extractText,
  type ProviderConfig
} from '../browserAi'
import type { PdfAttachment } from '../pdf'
import type { LlmMessage } from '@app/gen'

const TEXT_MSGS: LlmMessage[] = [{ role: 'user', content: 'Model an order process.' }]

const PDF: PdfAttachment = {
  base64: 'QkFTRTY0UERG', // "BASE64PDF"
  mediaType: 'application/pdf',
  fileName: 'spec.pdf',
  sizeBytes: 1234
}

const cfg = (over: Partial<ProviderConfig>): ProviderConfig => ({
  providerId: 'anthropic',
  model: 'm',
  apiKey: 'sk-test',
  ...over
})

describe('Anthropic payload', () => {
  it('builds the messages endpoint with the browser-access + version headers', () => {
    const req = buildAnthropicRequest(
      cfg({ providerId: 'anthropic', model: 'claude-opus-4-8' }),
      TEXT_MSGS,
      { maxTokens: 3000, jsonMode: true }
    )
    expect(req.url).toBe('https://api.anthropic.com/v1/messages')
    expect(req.headers['x-api-key']).toBe('sk-test')
    expect(req.headers['anthropic-version']).toBe('2023-06-01')
    expect(req.headers['anthropic-dangerous-direct-browser-access']).toBe('true')
    expect(req.body.model).toBe('claude-opus-4-8')
    expect(req.body.max_tokens).toBe(3000)
    const messages = req.body.messages as Array<{ role: string; content: unknown[] }>
    expect(messages).toHaveLength(1)
    expect(messages[0].role).toBe('user')
    expect(messages[0].content).toEqual([{ type: 'text', text: 'Model an order process.' }])
  })

  it('prepends a base64 document block BEFORE the text when a PDF is attached', () => {
    const req = buildAnthropicRequest(cfg({ providerId: 'anthropic' }), TEXT_MSGS, {
      maxTokens: 3000,
      jsonMode: true,
      attachment: PDF
    })
    const content = (req.body.messages as Array<{ content: Array<Record<string, unknown>> }>)[0]
      .content
    expect(content).toHaveLength(2)
    expect(content[0]).toEqual({
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: 'QkFTRTY0UERG' }
    })
    expect(content[1]).toEqual({ type: 'text', text: 'Model an order process.' })
  })

  it('hoists a system message to the top-level system field', () => {
    const req = buildAnthropicRequest(
      cfg({ providerId: 'anthropic' }),
      [
        { role: 'system', content: 'You are strict.' },
        { role: 'user', content: 'Hi' }
      ],
      { maxTokens: 10, jsonMode: false }
    )
    expect(req.body.system).toBe('You are strict.')
    expect((req.body.messages as unknown[]).length).toBe(1)
  })
})

describe('Gemini payload', () => {
  it('targets generateContent with the api-key header and responseMimeType JSON', () => {
    const req = buildGeminiRequest(cfg({ providerId: 'gemini', model: 'gemini-flash-latest' }), TEXT_MSGS, {
      maxTokens: 3000,
      jsonMode: true
    })
    expect(req.url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent'
    )
    expect(req.headers['x-goog-api-key']).toBe('sk-test')
    expect(req.headers['content-type']).toBe('application/json')
    const gc = req.body.generationConfig as Record<string, unknown>
    expect(gc.responseMimeType).toBe('application/json')
    expect(gc.maxOutputTokens).toBe(3000)
    const contents = req.body.contents as Array<{ role: string; parts: unknown[] }>
    expect(contents[0].role).toBe('user')
    expect(contents[0].parts).toEqual([{ text: 'Model an order process.' }])
  })

  it('omits responseMimeType when jsonMode is off (probe)', () => {
    const req = buildGeminiRequest(cfg({ providerId: 'gemini', model: 'g' }), TEXT_MSGS, {
      maxTokens: 1,
      jsonMode: false
    })
    expect((req.body.generationConfig as Record<string, unknown>).responseMimeType).toBeUndefined()
  })

  it('maps assistant role to "model" and appends an inlineData PDF part', () => {
    const req = buildGeminiRequest(
      cfg({ providerId: 'gemini', model: 'g' }),
      [
        { role: 'user', content: 'first' },
        { role: 'assistant', content: 'reply' }
      ],
      { maxTokens: 10, jsonMode: true, attachment: PDF }
    )
    const contents = req.body.contents as Array<{ role: string; parts: Array<Record<string, unknown>> }>
    expect(contents[1].role).toBe('model')
    // PDF attached to the FIRST user turn.
    expect(contents[0].parts[0]).toEqual({ text: 'first' })
    expect(contents[0].parts[1]).toEqual({
      inlineData: { mimeType: 'application/pdf', data: 'QkFTRTY0UERG' }
    })
  })
})

describe('OpenRouter payload', () => {
  it('uses the chat/completions endpoint with a Bearer key and json_object mode', () => {
    const req = buildOpenRouterRequest(
      cfg({ providerId: 'openrouter', model: 'z-ai/glm-5.2', referer: 'https://x', title: 'T' }),
      TEXT_MSGS,
      { maxTokens: 3000, jsonMode: true }
    )
    expect(req.url).toBe('https://openrouter.ai/api/v1/chat/completions')
    expect(req.headers.authorization).toBe('Bearer sk-test')
    expect(req.headers['HTTP-Referer']).toBe('https://x')
    expect(req.headers['X-Title']).toBe('T')
    expect(req.body.model).toBe('z-ai/glm-5.2')
    expect(req.body.response_format).toEqual({ type: 'json_object' })
    expect(req.body.messages).toEqual([{ role: 'user', content: 'Model an order process.' }])
    expect(req.body.plugins).toBeUndefined()
  })

  it('attaches a file part + file-parser plugin for PDFs', () => {
    const req = buildOpenRouterRequest(cfg({ providerId: 'openrouter', model: 'x' }), TEXT_MSGS, {
      maxTokens: 3000,
      jsonMode: true,
      attachment: PDF
    })
    const content = (req.body.messages as Array<{ content: Array<Record<string, unknown>> }>)[0]
      .content
    expect(content[0]).toEqual({ type: 'text', text: 'Model an order process.' })
    expect(content[1]).toEqual({
      type: 'file',
      file: { filename: 'spec.pdf', file_data: 'data:application/pdf;base64,QkFTRTY0UERG' }
    })
    expect(req.body.plugins).toEqual([{ id: 'file-parser', pdf: { engine: 'native' } }])
  })
})

describe('Custom OpenAI-compatible payload', () => {
  it('strips a trailing slash, appends /chat/completions, merges extra headers', () => {
    const req = buildCustomRequest(
      cfg({
        providerId: 'custom',
        model: 'llama',
        baseURL: 'https://api.example.com/v1/',
        extraHeaders: { 'X-Org': 'acme' }
      }),
      TEXT_MSGS,
      { maxTokens: 3000, jsonMode: true }
    )
    expect(req.url).toBe('https://api.example.com/v1/chat/completions')
    expect(req.headers.authorization).toBe('Bearer sk-test')
    expect(req.headers['X-Org']).toBe('acme')
    expect(req.body.response_format).toEqual({ type: 'json_object' })
  })

  it('never adds a PDF part (no verified document contract)', () => {
    const req = buildCustomRequest(
      cfg({ providerId: 'custom', model: 'm', baseURL: 'https://x' }),
      TEXT_MSGS,
      { maxTokens: 3000, jsonMode: true, attachment: PDF }
    )
    // content stays a plain string — no file part injected.
    expect((req.body.messages as Array<{ content: unknown }>)[0].content).toBe(
      'Model an order process.'
    )
  })
})

describe('Arabic hint / RTL passthrough', () => {
  const arabic = 'عملية الموافقة على الفاتورة'
  const msgs: LlmMessage[] = [{ role: 'user', content: `Instruction with hint: "${arabic}"` }]

  it('carries Arabic text verbatim into every provider body', () => {
    for (const providerId of ['anthropic', 'gemini', 'openrouter', 'custom'] as const) {
      const req = buildRequest(cfg({ providerId, baseURL: 'https://x', model: 'm' }), msgs, {
        maxTokens: 100,
        jsonMode: true
      })
      expect(JSON.stringify(req.body)).toContain(arabic)
    }
  })
})

describe('response extraction', () => {
  it('reads Anthropic content text blocks', () => {
    const data = { content: [{ type: 'text', text: '{"process":[]}' }, { type: 'thinking' }] }
    expect(extractText('anthropic', data)).toBe('{"process":[]}')
  })
  it('reads Gemini candidate parts', () => {
    const data = { candidates: [{ content: { parts: [{ text: '{"a":' }, { text: '1}' }] } }] }
    expect(extractText('gemini', data)).toBe('{"a":1}')
  })
  it('reads OpenAI-shaped choices (string + array content)', () => {
    expect(extractText('openrouter', { choices: [{ message: { content: 'hi' } }] })).toBe('hi')
    expect(
      extractText('custom', { choices: [{ message: { content: [{ text: 'a' }, { text: 'b' }] } }] })
    ).toBe('ab')
  })
  it('returns empty string on a malformed response (pipeline then repairs)', () => {
    expect(extractText('gemini', {})).toBe('')
    expect(extractText('anthropic', { content: [] })).toBe('')
  })
})
