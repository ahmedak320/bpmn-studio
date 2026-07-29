import { describe, expect, it, vi } from 'vitest'

import { makeArisAiTranslateTexts } from '../aiTranslateTexts'

type Msg = { role: string; content: string }
type Opts = { maxTokens: number }

describe('makeArisAiTranslateTexts', () => {
  it('sends one index-keyed JSON chunk and returns positional results', async () => {
    const callLLM = vi.fn(async (_messages: Msg[], _opts: Opts) =>
      JSON.stringify({ '0': 'يعتمد', '1': 'حدث' })
    )
    const translate = makeArisAiTranslateTexts(callLLM)
    const results = await translate(['Approve', 'Event'], 'en', 'ar')
    expect(results).toEqual(['يعتمد', 'حدث'])

    expect(callLLM).toHaveBeenCalledTimes(1)
    const [messages, opts] = callLLM.mock.calls[0]
    expect(opts).toEqual({ maxTokens: 4000 })
    expect(messages[0]).toMatchObject({ role: 'system' })
    expect(messages[0].content).toContain('You translate BUSINESS PROCESS diagram labels')
    expect(messages[1].role).toBe('user')
    expect(messages[1].content).toContain('"0":"Approve"')
    expect(messages[1].content).toContain('Arabic')
  })

  it('accepts an already-parsed object response', async () => {
    const callLLM = vi.fn(async (_messages: Msg[], _opts: Opts) => ({ '0': 'يعتمد' }))
    const translate = makeArisAiTranslateTexts(callLLM)
    expect(await translate(['Approve'], 'en', 'ar')).toEqual(['يعتمد'])
  })

  it('retries once with the reminder appended when the first response is unparseable', async () => {
    const callLLM = vi
      .fn(async (_messages: Msg[], _opts: Opts): Promise<unknown> => 'not json at all')
      .mockResolvedValueOnce('not json at all')
      .mockResolvedValueOnce(JSON.stringify({ '0': 'يعتمد' }))
    const translate = makeArisAiTranslateTexts(callLLM)
    const results = await translate(['Approve'], 'en', 'ar')
    expect(results).toEqual(['يعتمد'])
    expect(callLLM).toHaveBeenCalledTimes(2)
    const retryMessages = callLLM.mock.calls[1][0]
    expect(retryMessages[1].content).toContain(
      'Reminder: respond with ONLY the JSON object mapping each id to its translation'
    )
  })

  it('gives up on a chunk (positional undefined) after the retry also fails', async () => {
    const callLLM = vi.fn(async (_messages: Msg[], _opts: Opts) => 'still not json')
    const translate = makeArisAiTranslateTexts(callLLM)
    expect(await translate(['Approve'], 'en', 'ar')).toEqual([undefined])
    expect(callLLM).toHaveBeenCalledTimes(2)
  })

  it('chunks by the configured size', async () => {
    const callLLM = vi.fn(async (_messages: Msg[], _opts: Opts) => JSON.stringify({ '0': 'x' }))
    const translate = makeArisAiTranslateTexts(callLLM, { chunkSize: 1 })
    await translate(['a', 'b', 'c'], 'en', 'ar')
    expect(callLLM).toHaveBeenCalledTimes(3)
    // Each chunk is keyed from 0 relative to the chunk.
    for (const call of callLLM.mock.calls) {
      expect(call[0][1].content).toContain('"0":')
    }
  })

  it('drops a non-string value positionally', async () => {
    const callLLM = vi.fn(async (_messages: Msg[], _opts: Opts) =>
      JSON.stringify({ '0': 'يعتمد', '1': 42 })
    )
    const translate = makeArisAiTranslateTexts(callLLM)
    expect(await translate(['Approve', 'Event'], 'en', 'ar')).toEqual(['يعتمد', undefined])
  })
})
