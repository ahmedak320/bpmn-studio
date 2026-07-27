import { describe, expect, it } from 'vitest'
import {
  deriveContextualGatewayNames,
  isGenericGatewayLabel,
  matchesGenericSemanticAlias,
  SEMANTIC_NAMING
} from '../semanticNaming'

describe('SEMANTIC_NAMING', () => {
  it('contains the exact bilingual gateway table', () => {
    expect(SEMANTIC_NAMING).toEqual({
      'bpmn:ExclusiveGateway': {
        en: {
          display: 'Exclusive gateway',
          tooltip: 'Selects exactly one outgoing path, or merges alternative paths.'
        },
        ar: {
          display: 'بوابة حصرية',
          tooltip: 'تختار مسارًا صادرًا واحدًا فقط، أو تدمج المسارات البديلة.'
        },
        arisAlias: 'XOR rule'
      },
      'bpmn:InclusiveGateway': {
        en: {
          display: 'Inclusive gateway',
          tooltip:
            'Selects one or more matching paths, or synchronizes the paths that were activated.'
        },
        ar: {
          display: 'بوابة شاملة',
          tooltip: 'تختار مسارًا واحدًا أو أكثر عند تحقق شروطه، أو تزامن المسارات التي تم تفعيلها.'
        },
        arisAlias: 'OR rule'
      },
      'bpmn:ParallelGateway': {
        en: {
          display: 'Parallel gateway',
          tooltip:
            'Starts concurrent paths, or waits for all incoming paths without evaluating conditions.'
        },
        ar: {
          display: 'بوابة متوازية',
          tooltip: 'تبدأ مسارات متزامنة، أو تنتظر جميع المسارات الواردة من دون تقييم الشروط.'
        },
        arisAlias: 'AND rule'
      }
    })
  })

  it('provides a non-empty display name and tooltip in both locales', () => {
    for (const naming of Object.values(SEMANTIC_NAMING)) {
      for (const lang of ['en', 'ar'] as const) {
        expect(naming[lang].display.trim()).not.toBe('')
        expect(naming[lang].tooltip.trim()).not.toBe('')
      }
    }
  })

  it('is frozen at every mutable level', () => {
    expect(Object.isFrozen(SEMANTIC_NAMING)).toBe(true)
    for (const naming of Object.values(SEMANTIC_NAMING)) {
      expect(Object.isFrozen(naming)).toBe(true)
      expect(Object.isFrozen(naming.en)).toBe(true)
      expect(Object.isFrozen(naming.ar)).toBe(true)
    }
  })
})

describe('matchesGenericSemanticAlias', () => {
  it('matches only a trimmed, case-folded whole string', () => {
    expect(matchesGenericSemanticAlias('XOR rule', 'XOR rule')).toBe(true)
    expect(matchesGenericSemanticAlias('  xor RULE  ', 'XOR rule')).toBe(true)
    expect(matchesGenericSemanticAlias('XOR rule — approved?', 'XOR rule')).toBe(false)
    expect(matchesGenericSemanticAlias('Approved? XOR rule', 'XOR rule')).toBe(false)
    expect(matchesGenericSemanticAlias('XOR  rule', 'XOR rule')).toBe(false)
    expect(matchesGenericSemanticAlias(undefined, 'XOR rule')).toBe(false)
  })
})

describe('deriveContextualGatewayNames', () => {
  it('replaces a stock alias with branch-target context in both languages', () => {
    expect(
      deriveContextualGatewayNames({
        type: 'bpmn:ExclusiveGateway',
        name: { en: 'XOR rule', ar: 'XOR rule' },
        incomingCount: 1,
        outgoingCount: 2,
        outgoing: [
          { name: { en: 'Approved', ar: 'مقبول' } },
          { name: { en: 'Rejected', ar: 'مرفوض' } }
        ]
      })
    ).toEqual({
      en: 'Approved or Rejected?',
      ar: 'مقبول أم مرفوض؟'
    })
  })

  it('uses decision criteria, then standards-based split/merge fallbacks', () => {
    expect(
      deriveContextualGatewayNames({
        type: 'bpmn:ExclusiveGateway',
        decisionBasis: { en: 'Eligibility policy', ar: 'سياسة الأهلية' },
        outgoingCount: 2
      })
    ).toEqual({
      en: 'Decision: Eligibility policy',
      ar: 'قرار: سياسة الأهلية'
    })
    expect(
      deriveContextualGatewayNames({
        type: 'bpmn:ParallelGateway',
        incomingCount: 3,
        outgoingCount: 1
      })
    ).toEqual({
      en: 'Join parallel paths',
      ar: 'ضمّ المسارات المتوازية'
    })
  })

  it('recognises only whole stock aliases as generic', () => {
    expect(isGenericGatewayLabel(' xor RULE ')).toBe(true)
    expect(isGenericGatewayLabel('XOR rule — approved?')).toBe(false)
  })
})
