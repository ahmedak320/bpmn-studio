/**
 * prompts.ts — verbatim IR spec + 7 few-shot examples, and the create_bpmn
 * composition. The composition is golden-checked against a REAL jinja2 render
 * (tests/fixtures/prompt/create_bpmn.golden.txt) of the vendored template.
 */
import { describe, it, expect } from 'vitest'
import {
  BPMN_REPRESENTATION,
  BPMN_EXAMPLES,
  composeCreateBpmn,
  messageHistoryToString
} from '../../src/gen/prompts'
import { loadPromptFixture } from './helpers'

describe('prompts.ts', () => {
  it('composeCreateBpmn matches the real jinja2 render byte-for-byte', () => {
    const history = loadPromptFixture('history.txt')
    const golden = loadPromptFixture('create_bpmn.golden.txt')
    expect(composeCreateBpmn(history)).toBe(golden)
  })

  it('messageHistoryToString reproduces Python str.capitalize per role', () => {
    const s = messageHistoryToString([
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi there' },
      { role: 'USER', content: 'again' }
    ])
    expect(s).toBe('User: hello\nAssistant: hi there\nUser: again')
  })

  it('carries the IR-spec text verbatim', () => {
    expect(BPMN_REPRESENTATION).toContain('# Representation of various BPMN elements')
    expect(BPMN_REPRESENTATION).toContain('### Exclusive gateway')
    expect(BPMN_REPRESENTATION).toContain('### Inclusive gateway')
    expect(BPMN_REPRESENTATION).toContain('### Parallel gateway')
  })

  it('carries all 7 few-shot examples', () => {
    const count = (BPMN_EXAMPLES.match(/Textual description/g) ?? []).length
    expect(count).toBe(7)
    expect(BPMN_EXAMPLES).toContain('# Process examples')
  })
})
