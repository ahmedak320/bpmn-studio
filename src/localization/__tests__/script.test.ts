import { describe, expect, it } from 'vitest'
import {
  LOCALIZATION_SOURCES,
  LocalizationSource,
  SEEDED_GLOSSARY,
  approvedNeutralTerms,
  classifyScript,
  createSeededGlossary,
  mergeGlossary,
  segmentByScript,
  validateTargetScript
} from '..'

describe('durable localization contracts', () => {
  it('uses one exhaustive ingestion-source vocabulary across all import paths', () => {
    expect(LOCALIZATION_SOURCES).toEqual([
      'xml',
      'aris',
      'ai',
      'pdf',
      'image',
      'docx',
      'excel',
      'backup',
      'editor'
    ])
    expect(LocalizationSource.Image).toBe('image')
  })
})

describe('script-aware localization classifier', () => {
  it.each([
    ['Approve request', 'english'],
    ['Crème brûlée', 'english'],
    ['اعتماد الطلب', 'arabic'],
    ['Approve الطلب', 'mixed'],
    ['طلب DMT HUB', 'mixed'],
    ['Журнал', 'unknown'],
    ['✓ — …', 'unknown'],
    ['', 'unknown']
  ] as const)('classifies %j as %s', (value, expected) => {
    expect(classifyScript(value)).toBe(expected)
  })

  it('requires meaningful Arabic letters, not Arabic punctuation alone', () => {
    expect(classifyScript('، ؛ ؟')).toBe('unknown')
    expect(classifyScript('١٢٣')).toBe('neutral')
    expect(classifyScript('١٢٣ - ٤٥٦')).toBe('neutral')
  })

  it.each([
    '42',
    '12/07/2026',
    'Task_123',
    'Process:Review',
    'caseReviewV2',
    'R',
    'https://example.ae/process?id=2',
    'owner@example.ae',
    'API',
    'SLA',
    'DMT HUB'
  ])('classifies approved numeric/code/link value %j as neutral', (value) => {
    expect(classifyScript(value)).toBe('neutral')
  })

  it('does not treat arbitrary uppercase English as a neutral acronym/product', () => {
    expect(classifyScript('APPROVE')).toBe('english')
    expect(classifyScript('APPROVE REQUEST')).toBe('english')
    expect(classifyScript('API approval')).toBe('english')
    expect(classifyScript('APPROVE-REQUEST')).toBe('english')
  })

  it('applies explicit neutral approval to the complete value only', () => {
    const options = { approvedNeutralTerms: ['MY PRODUCT'] }
    expect(classifyScript('MY PRODUCT', options)).toBe('neutral')
    expect(classifyScript('Use MY PRODUCT', options)).toBe('english')
    // Supplying an editable list replaces (rather than silently augments) the
    // seeds, so users can remove an approval.
    expect(classifyScript('API', { approvedNeutralTerms: [] })).toBe('english')
  })

  it('validates targets asymmetrically and supports an explicit English proper-name exception', () => {
    expect(validateTargetScript('اعتماد الطلب', 'ar').valid).toBe(true)
    expect(validateTargetScript('Approve request', 'ar').valid).toBe(false)
    expect(validateTargetScript('Approve request', 'en').valid).toBe(true)
    expect(validateTargetScript('اعتماد الطلب', 'en').valid).toBe(false)

    const properName = 'DMT دائرة البلديات والنقل'
    expect(validateTargetScript(properName, 'en').valid).toBe(false)
    expect(
      validateTargetScript(properName, 'en', {
        approvedEnglishBilingualExceptions: [properName]
      }).valid
    ).toBe(true)
    // An English-side exception never weakens the Arabic target rule.
    expect(
      validateTargetScript(properName, 'ar', {
        approvedEnglishBilingualExceptions: [properName]
      }).valid
    ).toBe(false)
  })

  it('segments mixed text for review without changing a code point', () => {
    const input = 'Approve طلب API'
    const segments = segmentByScript(input)
    expect(segments).toEqual([
      { text: 'Approve ', script: 'english' },
      { text: 'طلب ', script: 'arabic' },
      { text: 'API', script: 'neutral' }
    ])
    expect(segments.map((segment) => segment.text).join('')).toBe(input)
  })
})

describe('editable reviewed glossary seed', () => {
  it('ships exactly the reviewed API/SLA/DMT HUB neutral terms', () => {
    expect(SEEDED_GLOSSARY).toEqual([
      { en: 'API', ar: 'API', neutral: true },
      { en: 'SLA', ar: 'SLA', neutral: true },
      { en: 'DMT HUB', ar: 'DMT HUB', neutral: true }
    ])
    expect(approvedNeutralTerms()).toEqual(['API', 'SLA', 'DMT HUB'])
  })

  it('returns an editable copy and deterministically replaces a seed', () => {
    const workspace = createSeededGlossary()
    workspace[0].ar = 'واجهة برمجة التطبيقات'
    expect(SEEDED_GLOSSARY[0].ar).toBe('API')

    expect(
      mergeGlossary([
        {
          en: 'API',
          ar: 'واجهة برمجة التطبيقات',
          neutral: false
        }
      ])
    ).toEqual([
      { en: 'SLA', ar: 'SLA', neutral: true },
      { en: 'DMT HUB', ar: 'DMT HUB', neutral: true },
      {
        en: 'API',
        ar: 'واجهة برمجة التطبيقات',
        neutral: false
      }
    ])
  })
})
