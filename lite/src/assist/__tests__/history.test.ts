import { describe, it, expect } from 'vitest'
import { toLlmHistory, HISTORY_MAX_TURNS, HISTORY_TURN_CHARS, type ChatTurn } from '../history'

const u = (text: string, kind?: ChatTurn['kind']): ChatTurn => ({ role: 'user', text, kind })
const a = (text: string, kind?: ChatTurn['kind']): ChatTurn => ({ role: 'assistant', text, kind })

describe('toLlmHistory', () => {
  it('keeps complete user→assistant pairs in order', () => {
    expect(toLlmHistory([u('q1'), a('a1'), u('q2'), a('a2')])).toEqual([
      { role: 'user', content: 'q1' },
      { role: 'assistant', content: 'a1' },
      { role: 'user', content: 'q2' },
      { role: 'assistant', content: 'a2' }
    ])
  })

  it('drops an unanswered (errored) question and stray leading assistant turns', () => {
    // Greeting first, then q1 got only an error bubble (filtered), then a real pair.
    const out = toLlmHistory([a('greeting'), u('q1'), a('boom', 'error'), u('q2'), a('a2')])
    expect(out).toEqual([
      { role: 'user', content: 'q2' },
      { role: 'assistant', content: 'a2' }
    ])
  })

  it('excludes error/status bubbles entirely', () => {
    const out = toLlmHistory([u('q1'), a('rate limited', 'error'), a('applying…', 'status'), a('a1')])
    expect(out).toEqual([
      { role: 'user', content: 'q1' },
      { role: 'assistant', content: 'a1' }
    ])
  })

  it('bounds the result to the most recent turns (whole pairs)', () => {
    const transcript: ChatTurn[] = []
    for (let i = 1; i <= 10; i++) {
      transcript.push(u(`q${i}`), a(`a${i}`))
    }
    const out = toLlmHistory(transcript)
    expect(out).toHaveLength(HISTORY_MAX_TURNS)
    expect(out[0]).toEqual({ role: 'user', content: 'q5' })
    expect(out[out.length - 1]).toEqual({ role: 'assistant', content: 'a10' })
  })

  it('always starts with user and strictly alternates', () => {
    const transcript: ChatTurn[] = [a('hello'), u('q1'), a('a1'), u('q2'), u('q2b'), a('a2')]
    const out = toLlmHistory(transcript)
    expect(out[0].role).toBe('user')
    for (let i = 1; i < out.length; i++) {
      expect(out[i].role).not.toBe(out[i - 1].role)
    }
    // The superseded unanswered q2 is gone; q2b pairs with a2.
    expect(out.map((m) => m.content)).toEqual(['q1', 'a1', 'q2b', 'a2'])
  })

  it('clips oversized turns to the per-turn character cap', () => {
    const long = 'x'.repeat(HISTORY_TURN_CHARS + 500)
    const out = toLlmHistory([u(long), a('ok')])
    expect(out[0].content.length).toBe(HISTORY_TURN_CHARS)
    expect(out[0].content.endsWith('…')).toBe(true)
  })

  it('returns [] for empty or all-filtered transcripts', () => {
    expect(toLlmHistory([])).toEqual([])
    expect(toLlmHistory([a('err', 'error'), a('note', 'status'), u('   ')])).toEqual([])
  })
})
