import { describe, expect, it } from 'vitest'
import { canonicalJsonText } from '../packages/canonicalJson'
import type { CanonicalProcessV1 } from './contract'
import {
  VALID_CANONICAL_FULL,
  VALID_CANONICAL_MINIMAL,
  VALID_CANONICAL_MISSING_ROLE,
  VALID_CANONICAL_RETURN_PATH
} from './fixtures'
import { buildProcessNarrative, type ProcessNarrativeV1 } from './narrative'
import { canonicalFlowOrder } from './projectToEpc'

const ALL_VALID_FIXTURES: readonly [string, CanonicalProcessV1][] = [
  ['MINIMAL', VALID_CANONICAL_MINIMAL],
  ['FULL', VALID_CANONICAL_FULL],
  ['RETURN_PATH', VALID_CANONICAL_RETURN_PATH],
  ['MISSING_ROLE', VALID_CANONICAL_MISSING_ROLE]
]

describe('buildProcessNarrative', () => {
  describe.each(ALL_VALID_FIXTURES)('%s', (_label, process) => {
    it('produces the BINDING flat shape {schemaVersion:1, en, ar}, both non-empty', () => {
      const narrative: ProcessNarrativeV1 = buildProcessNarrative(process)
      expect(narrative.schemaVersion).toBe(1)
      expect(typeof narrative.en).toBe('string')
      expect(typeof narrative.ar).toBe('string')
      expect(narrative.en.trim().length).toBeGreaterThan(0)
      expect(narrative.ar.trim().length).toBeGreaterThan(0)
    })

    it('every main-flow node NAME appears in its locale body (structure follows canonicalFlowOrder)', () => {
      const narrative = buildProcessNarrative(process)
      const flowOrder = canonicalFlowOrder(process)
      expect(flowOrder).toHaveLength(process.nodes.length)
      for (const nodeId of flowOrder) {
        const node = process.nodes.find((candidate) => candidate.id === nodeId)
        expect(node).toBeDefined()
        if (node?.names.en !== undefined) expect(narrative.en).toContain(node.names.en)
        if (node?.names.ar !== undefined) expect(narrative.ar).toContain(node.names.ar)
      }
    })

    it('determinism: two builds are canonicalJsonText-identical, and en/ar are string-identical', () => {
      const first = buildProcessNarrative(process)
      const second = buildProcessNarrative(process)
      expect(canonicalJsonText(first)).toBe(canonicalJsonText(second))
      expect(first.en).toBe(second.en)
      expect(first.ar).toBe(second.ar)
    })
  })

  it('VALID_CANONICAL_FULL: the purpose paragraph (identity.purpose) opens the body in both locales', () => {
    const narrative = buildProcessNarrative(VALID_CANONICAL_FULL)
    expect(narrative.en).toContain(
      'Resolve reported IT incidents within the agreed service levels.'
    )
    expect(narrative.ar).toContain(
      'حل حوادث تقنية المعلومات المبلغ عنها ضمن مستويات الخدمة المتفق عليها.'
    )
  })

  it('VALID_CANONICAL_MINIMAL: purpose falls back to a name-derived statement (no identity.purpose declared)', () => {
    expect(VALID_CANONICAL_MINIMAL.identity.purpose).toBeUndefined()
    const narrative = buildProcessNarrative(VALID_CANONICAL_MINIMAL)
    expect(narrative.en).toContain('Minimal Process')
    expect(narrative.ar).toContain('عملية بسيطة')
  })

  it('VALID_CANONICAL_FULL: a decision sentence mentions its criteria and both outcome labels', () => {
    const narrative = buildProcessNarrative(VALID_CANONICAL_FULL)
    expect(narrative.en).toContain('Assess severity')
    expect(narrative.en).toContain('Severity classification rules')
    expect(narrative.en).toContain('High severity')
    expect(narrative.en).toContain('Low severity')
    expect(narrative.ar).toContain('تقييم مستوى الخطورة')
    expect(narrative.ar).toContain('قواعد تصنيف الخطورة')
  })

  it('VALID_CANONICAL_FULL: a wait sentence mentions its waitDetail', () => {
    const narrative = buildProcessNarrative(VALID_CANONICAL_FULL)
    expect(narrative.en).toContain('Blocked until the vendor ships a fix')
  })

  it('VALID_CANONICAL_FULL: a handoff sentence mentions the linked process reference', () => {
    const narrative = buildProcessNarrative(VALID_CANONICAL_FULL)
    expect(narrative.en).toContain('proc-vendor-escalation-v1')
  })

  it('VALID_CANONICAL_FULL: end outcomes are mentioned', () => {
    const narrative = buildProcessNarrative(VALID_CANONICAL_FULL)
    expect(narrative.en).toContain('Incident escalation rejected')
    expect(narrative.en).toContain('Incident resolved (high severity)')
    expect(narrative.en).toContain('Incident resolved (low severity)')
  })

  it('VALID_CANONICAL_FULL: roles (with an owner marker) and systems are mentioned', () => {
    const narrative = buildProcessNarrative(VALID_CANONICAL_FULL)
    expect(narrative.en).toContain('Support Agent')
    expect(narrative.en).toContain('IT Manager (owner)')
    expect(narrative.en).toContain('ITSM Platform')
    expect(narrative.en).toContain('Monitoring System')
  })

  it('VALID_CANONICAL_FULL: open unknowns are mentioned', () => {
    const narrative = buildProcessNarrative(VALID_CANONICAL_FULL)
    expect(narrative.en).toContain('Unclear which vendor SLA tier applies to this wait.')
    expect(narrative.en).toContain(
      'The producing node for the root-cause report is not documented.'
    )
  })

  it('VALID_CANONICAL_RETURN_PATH: the rework loop does not break the main-flow walk', () => {
    const narrative = buildProcessNarrative(VALID_CANONICAL_RETURN_PATH)
    expect(narrative.en).toContain('Request submitted')
    expect(narrative.en).toContain('Review request')
    expect(narrative.en).toContain('Review outcome')
    expect(narrative.en).toContain('Rework request')
    expect(narrative.en).toContain('Request approved')
  })
})

describe('graceful locale degradation (never the literal string "undefined")', () => {
  const DEGRADED_LOCALE_PROCESS: CanonicalProcessV1 = {
    version: 1,
    identity: {
      id: 'proc-degraded',
      names: { en: 'Degraded Locale Fixture', ar: 'عملية ناقصة اللغة' },
      confidence: 'high'
    },
    nodes: [
      // Deliberately English-only: no `ar` key at all.
      { id: 'n-start', kind: 'event', names: { en: 'Start' }, confidence: 'high' },
      {
        id: 'n-task',
        kind: 'activity',
        names: { en: 'Do the task', ar: 'القيام بالمهمة' },
        confidence: 'high'
      },
      { id: 'n-end', kind: 'event', names: { en: 'End', ar: 'نهاية' }, confidence: 'high' }
    ],
    decisions: [],
    edges: [
      {
        id: 'e-1',
        kind: 'sequence',
        sourceNodeId: 'n-start',
        targetNodeId: 'n-task',
        confidence: 'high'
      },
      {
        id: 'e-2',
        kind: 'sequence',
        sourceNodeId: 'n-task',
        targetNodeId: 'n-end',
        confidence: 'high'
      }
    ],
    roles: [],
    systems: [],
    informationObjects: [],
    controls: [],
    facts: [],
    unknowns: []
  }

  it('a node missing one locale name has its sentence appear in EN but omitted from AR (never "undefined")', () => {
    const narrative = buildProcessNarrative(DEGRADED_LOCALE_PROCESS)
    expect(narrative.en).toContain('Event: Start.')
    expect(narrative.en).not.toContain('undefined')
    expect(narrative.ar).not.toContain('undefined')
    // The whole sentence for n-start is omitted from AR, not partially
    // rendered with an untranslated fragment.
    expect(narrative.ar).not.toContain('Start')
  })

  it('the AR body still renders fully for the nodes that DO have an AR name', () => {
    const narrative = buildProcessNarrative(DEGRADED_LOCALE_PROCESS)
    expect(narrative.ar.trim().length).toBeGreaterThan(0)
    expect(narrative.ar).toContain('القيام بالمهمة')
    expect(narrative.ar).toContain('نهاية')
  })

  it('a title missing one locale falls back to the other locale rather than an empty heading', () => {
    const englishOnlyTitleProcess: CanonicalProcessV1 = {
      ...DEGRADED_LOCALE_PROCESS,
      identity: { id: 'proc-en-only', names: { en: 'English Only Title' }, confidence: 'high' }
    }
    const narrative = buildProcessNarrative(englishOnlyTitleProcess)
    expect(narrative.ar.startsWith('# English Only Title')).toBe(true)
    expect(narrative.ar).not.toContain('undefined')
  })
})
