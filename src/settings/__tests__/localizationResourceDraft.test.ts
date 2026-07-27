import { describe, expect, it } from 'vitest'
import type { TranslationMemoryEntry } from '../../localization/types'
import {
  issueForField,
  validateGlossaryDraft,
  validateTranslationMemoryDraft
} from '../localizationResourceDraft'

describe('Settings localization resource draft validation', () => {
  it('accepts explicit neutrals and ordered glossary synonyms', () => {
    expect(
      validateGlossaryDraft([
        { en: 'API', ar: 'API', neutral: true },
        { en: 'Review request', ar: 'مراجعة الطلب' },
        { en: 'Review request', ar: 'تدقيق الطلب' },
        { en: 'Audit request', ar: 'مراجعة الطلب' }
      ])
    ).toEqual([])
  })

  it('reports required fields, wrong scripts, and neutral mismatches inline', () => {
    const issues = validateGlossaryDraft([
      { en: '', ar: '' },
      { en: 'مراجعة', ar: 'Still English' },
      { en: 'API', ar: 'واجهة برمجة التطبيقات', neutral: true }
    ])
    expect(issues.map((issue) => issue.code)).toEqual([
      'english-required',
      'arabic-required',
      'english-script',
      'arabic-script',
      'neutral-mismatch'
    ])
    expect(issueForField(issues, 1, 'ar')?.code).toBe('arabic-script')
    expect(issueForField(issues, 2, 'neutral')?.code).toBe('neutral-mismatch')
  })

  it('allows accepted pairs only and delegates timestamp/schema checks to the store contract', () => {
    const unaccepted = [
      {
        en: 'Review request',
        ar: 'مراجعة الطلب',
        accepted: false
      }
    ] as unknown as readonly TranslationMemoryEntry[]
    expect(validateTranslationMemoryDraft(unaccepted)).toEqual([
      { row: 0, field: 'accepted', code: 'accepted-only' }
    ])

    expect(
      validateTranslationMemoryDraft([
        {
          en: 'Review request',
          ar: 'مراجعة الطلب',
          accepted: true,
          acceptedAt: 'not-an-iso-timestamp'
        }
      ])
    ).toEqual([{ row: -1, field: 'document', code: 'schema' }])
  })
})
