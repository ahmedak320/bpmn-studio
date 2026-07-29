import { describe, expect, it } from 'vitest'

import { hasArabicName, hasEnglishName } from './locale'

/**
 * Regression coverage for the locale-classification bug in `hasEnglishName`/`hasArabicName`.
 * These previously only recognized numeric LCIDs and short `en`/`ar` tags via an exact-match
 * `ReadonlySet`. A real ARIS export's `LocaleId` attribute value is neither: it is the RAW,
 * unexpanded internal-DTD entity reference (`"&LocaleId.AEar;"` / `"&LocaleId.USen;"`), so on a
 * real import these functions misreported every model as missing its Arabic (and English) name,
 * which `gapScanner.ts` then surfaced as false `missingArabicName`/`missingEnglishName` gaps.
 */
describe('hasEnglishName / hasArabicName', () => {
  it('recognizes a raw entity-reference locale key', () => {
    const bilingual = {
      values: {
        '&LocaleId.AEar;': 'الهوية الرقمية',
        '&LocaleId.USen;': 'UAE Pass'
      }
    }
    expect(hasEnglishName(bilingual)).toBe(true)
    expect(hasArabicName(bilingual)).toBe(true)
  })

  it('still recognizes the default numeric LCID / short-tag set', () => {
    const bilingual = { values: { '1033': 'Approve', '1025': 'موافقة' } }
    expect(hasEnglishName(bilingual)).toBe(true)
    expect(hasArabicName(bilingual)).toBe(true)
  })

  it('reports false when the language is genuinely absent', () => {
    const englishOnly = { values: { '&LocaleId.USen;': 'UAE Pass' } }
    expect(hasEnglishName(englishOnly)).toBe(true)
    expect(hasArabicName(englishOnly)).toBe(false)
  })

  it('ignores whitespace-only text for a recognized locale', () => {
    const blank = { values: { '&LocaleId.AEar;': '   ' } }
    expect(hasArabicName(blank)).toBe(false)
  })

  it('respects a caller-supplied custom locale-id set in addition to language classification', () => {
    // 'custom-key' has no 'en'/'ar' suffix and isn't a numeric LCID, so `localeLang` classifies
    // it as neither -- only the explicit custom set can recognize it.
    const custom = { values: { 'custom-key': 'Approve' } }
    expect(hasEnglishName(custom, new Set(['custom-key']))).toBe(true)
    expect(hasEnglishName(custom, new Set())).toBe(false)
  })
})
