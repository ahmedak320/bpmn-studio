/**
 * prompts.ts — verbatim IR spec + 7 few-shot examples, and the create_bpmn
 * composition. The composition is golden-checked against a REAL jinja2 render
 * (tests/fixtures/prompt/create_bpmn.golden.txt) of the vendored template —
 * with ONE deliberate divergence (2026-07): composeCreateBpmn now ALWAYS
 * appends the bilingual/org-metadata section between the examples and the
 * message-history framing, so the golden expectation is the fixture with that
 * section spliced in. Everything around the section must stay byte-identical.
 */
import { describe, it, expect } from 'vitest'
import {
  BPMN_REPRESENTATION,
  BPMN_EXAMPLES,
  BILINGUAL_ORG_SECTION,
  composeCreateBpmn,
  messageHistoryToString
} from '../../src/gen/prompts'
import { loadPromptFixture, spliceBilingualOrgSection } from './helpers'

describe('prompts.ts', () => {
  it('composeCreateBpmn matches the jinja2 render + the spliced bilingual/org section', () => {
    const history = loadPromptFixture('history.txt')
    const golden = loadPromptFixture('create_bpmn.golden.txt')
    expect(composeCreateBpmn(history)).toBe(spliceBilingualOrgSection(golden))
  })

  it('everything around the bilingual/org section is byte-identical to the jinja2 render', () => {
    const history = loadPromptFixture('history.txt')
    const golden = loadPromptFixture('create_bpmn.golden.txt')
    const out = composeCreateBpmn(history)
    // Removing the (exactly-once) section restores the vendored render.
    expect(out.split(BILINGUAL_ORG_SECTION)).toHaveLength(2)
    expect(out.replace(BILINGUAL_ORG_SECTION, '')).toBe(golden)
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

describe('prompts.ts: bilingual/org section (always appended)', () => {
  const out = composeCreateBpmn('User: A customer submits an order.')

  it('teaches the language rules (same-language label + labelEn/labelAr + conditions)', () => {
    expect(out).toContain('# Language and organizational metadata')
    expect(out).toContain('SAME language as the user')
    expect(out).toContain('`labelEn` (English) and `labelAr` (Arabic) for EVERY labeled element')
    expect(out).toContain('`conditionEn` / `conditionAr`')
    expect(out).toContain('translate faithfully and professionally')
    expect(out).toContain('if the description mixes languages, translate both ways')
    expect(out).toContain('Modern Standard Arabic, not transliteration')
  })

  it('teaches every org field and the never-invent rule', () => {
    for (const field of [
      '"owner"',
      '"ownerRole"',
      '"channel"',
      '"channelDetail"',
      '"cc"',
      '"inputs"',
      '"respList"',
      '"kind": "cc"',
      '"decisionBasis"',
      '"trigger"',
      '"triggerService"',
      '"triggerDetail"'
    ]) {
      expect(out).toContain(field)
    }
    expect(out).toContain('"R" | "A" | "C" | "I"')
    expect(out).toContain('"dmthub" | "email" | "data"')
    // "cc" documents the "Name — purpose" convention (never-invent still applies to the purpose).
    expect(out).toContain('"cc" (array of "Name — purpose" strings')
    expect(out).toContain('ONLY when the description states or clearly implies them')
    expect(out).toContain('never invent people or systems')
  })

  it('includes bilingual JSON mini-examples (task, gateway, start trigger)', () => {
    expect(out).toContain('"labelAr": "مراجعة الطلب"')
    expect(out).toContain('"conditionEn": "Yes", "conditionAr": "نعم"')
    expect(out).toContain('"triggerService": "DMT HUB"')
  })

  it('sits between the examples block and the message-history framing', () => {
    const examplesAt = out.indexOf('# Process examples')
    const sectionAt = out.indexOf('# Language and organizational metadata')
    const framingAt = out.indexOf('The following is the message history')
    expect(examplesAt).toBeGreaterThan(-1)
    expect(sectionAt).toBeGreaterThan(examplesAt)
    expect(framingAt).toBeGreaterThan(sectionAt)
  })

  it('stays compact (< 60 lines) so the base prompt is not bloated', () => {
    expect(BILINGUAL_ORG_SECTION.split('\n').length).toBeLessThan(60)
  })
})
