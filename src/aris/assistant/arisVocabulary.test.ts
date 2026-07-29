import { describe, expect, it } from 'vitest'

import { localeKeyToLang } from './arisVocabulary'

/**
 * Regression coverage for the locale-classification bug: `localeKeyToLang` used to check
 * `lower.startsWith('ar'|'en')` plus a numeric-LCID allow-list, neither of which matches the RAW,
 * unexpanded internal-DTD entity reference a real ARIS export puts in `LocaleId="…"`
 * (`"&LocaleId.AEar;"` / `"&LocaleId.USen;"`). It now delegates to the shared `localeLang`
 * classifier (`src/library/amlParse.ts`).
 */
describe('localeKeyToLang', () => {
  it('classifies the raw entity-reference form real exports actually produce', () => {
    expect(localeKeyToLang('&LocaleId.USen;')).toBe('en')
    expect(localeKeyToLang('&LocaleId.AEar;')).toBe('ar')
  })

  it('classifies the bare entity name', () => {
    expect(localeKeyToLang('LocaleId.USen')).toBe('en')
    expect(localeKeyToLang('LocaleId.AEar')).toBe('ar')
  })

  it('classifies numeric Windows LCIDs by primary-language bits, including regional variants', () => {
    expect(localeKeyToLang('1033')).toBe('en') // en-US
    expect(localeKeyToLang('2057')).toBe('en') // en-GB
    expect(localeKeyToLang('14337')).toBe('ar') // ar-AE
    expect(localeKeyToLang('1025')).toBe('ar') // ar-SA
  })

  it('classifies BCP-47-ish tags', () => {
    expect(localeKeyToLang('en-US')).toBe('en')
    expect(localeKeyToLang('ar-AE')).toBe('ar')
  })

  it('returns undefined for null, empty, and unrecognized identifiers', () => {
    expect(localeKeyToLang(null)).toBeUndefined()
    expect(localeKeyToLang(undefined)).toBeUndefined()
    expect(localeKeyToLang('')).toBeUndefined()
    expect(localeKeyToLang('fr-FR')).toBeUndefined()
  })
})
