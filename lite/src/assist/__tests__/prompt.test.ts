import { describe, it, expect } from 'vitest'
import { buildAssistantPrompt, extractAssistantAnswer } from '../prompt'

describe('buildAssistantPrompt', () => {
  const prompt = buildAssistantPrompt('## P (P.bpmn)\n1. Step [task]', 'what happens next?', 'en')

  it('grounds the model on the context and question', () => {
    expect(prompt).toContain('# Documented processes')
    expect(prompt).toContain('## P (P.bpmn)')
    expect(prompt).toContain('# Question')
    expect(prompt).toContain('what happens next?')
  })

  it('mentions JSON and the {"answer": …} contract — REQUIRED because the shared browser transport forces provider JSON mode (OpenAI-compatible backends 400 without the word JSON in the prompt)', () => {
    expect(prompt).toContain('JSON')
    expect(prompt).toContain('{"answer": "<your reply>"}')
  })

  it('instructs the reply language from lang', () => {
    expect(prompt).toContain('Reply in English.')
    expect(buildAssistantPrompt('c', 'q', 'ar')).toContain('Reply in Arabic.')
  })

  it('points the model at the enriched org metadata', () => {
    expect(prompt).toContain('CC recipients and their purposes')
    expect(prompt).toContain('decision basis')
  })
})

describe('extractAssistantAnswer', () => {
  it('unwraps the {"answer": …} contract', () => {
    expect(extractAssistantAnswer('{"answer": "Next is Review."}')).toBe('Next is Review.')
  })

  it('unwraps fenced / prose-wrapped JSON', () => {
    expect(extractAssistantAnswer('Sure!\n```json\n{"answer": "التالي: المراجعة"}\n```')).toBe(
      'التالي: المراجعة'
    )
  })

  it('accepts a renamed single string key', () => {
    expect(extractAssistantAnswer('{"reply": "Step two follows."}')).toBe('Step two follows.')
  })

  it('passes plain text through untouched (provider ignored JSON mode)', () => {
    expect(extractAssistantAnswer('  The next step is Approve budget. ')).toBe(
      'The next step is Approve budget.'
    )
  })

  it('falls back to the raw reply for arrays / empty answers / multi-key objects', () => {
    expect(extractAssistantAnswer('["a", "b"]')).toBe('["a", "b"]')
    expect(extractAssistantAnswer('{"answer": ""}')).toBe('{"answer": ""}')
    expect(extractAssistantAnswer('{"a": "x", "b": "y"}')).toBe('{"a": "x", "b": "y"}')
  })

  it('never throws on garbage', () => {
    expect(extractAssistantAnswer('')).toBe('')
    expect(extractAssistantAnswer('{{{')).toBe('{{{')
  })
})
