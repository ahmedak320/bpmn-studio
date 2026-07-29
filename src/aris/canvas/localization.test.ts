import { describe, expect, it } from 'vitest'

import type { ArisLocalizedValue } from '../model/types'
import { DEFAULT_LOCALE_ID } from './emptyDocument'
import { readLocalized } from './localization'

/**
 * Regression coverage for the locale-classification bug in `readLocalized`. Canvas-authored
 * content is keyed literally by `DEFAULT_LOCALE_ID` ('en-US'), so the original exact-match
 * lookup worked for it. But a value sourced from real imported AML is keyed by the RAW,
 * unexpanded internal-DTD entity reference (`"&LocaleId.USen;"` / `"&LocaleId.AEar;"`), which
 * never equals 'en-US' — so the exact match always missed and the canvas silently fell through
 * to `fallback` (the first non-empty value seen in document order), which can be Arabic even
 * when the canvas defaults to English.
 */
describe('readLocalized', () => {
  it('resolves the exact key for canvas-authored content (unchanged behavior)', () => {
    const value: ArisLocalizedValue = {
      values: { 'en-US': 'Approve', 'ar-AE': 'موافقة' },
      fallback: 'Approve'
    }
    expect(readLocalized(value)).toBe('Approve')
    expect(readLocalized(value, 'ar-AE')).toBe('موافقة')
  })

  it('resolves the active locale by language for raw entity-reference keys, English default', () => {
    // Confirmed against reference/AnimalWF/ARISAMLExport.xml's ObjDef.-6n37IkhqS5m-p-L: Arabic
    // is written BEFORE English, so `fallback` is Arabic — the bug this regression pins.
    const value: ArisLocalizedValue = {
      values: {
        '&LocaleId.AEar;': 'الهوية الرقمية',
        '&LocaleId.USen;': 'UAE Pass'
      },
      fallback: 'الهوية الرقمية'
    }
    expect(readLocalized(value)).toBe('UAE Pass')
    expect(readLocalized(value, DEFAULT_LOCALE_ID)).toBe('UAE Pass')
  })

  it('resolves Arabic when an Arabic locale id is requested for raw entity-reference keys', () => {
    const value: ArisLocalizedValue = {
      values: {
        '&LocaleId.AEar;': 'الهوية الرقمية',
        '&LocaleId.USen;': 'UAE Pass'
      },
      fallback: 'الهوية الرقمية'
    }
    expect(readLocalized(value, 'ar-AE')).toBe('الهوية الرقمية')
  })

  it('falls back to fallback text, then any value, when the language is absent', () => {
    const englishOnly: ArisLocalizedValue = {
      values: { '&LocaleId.USen;': 'UAE Pass' },
      fallback: 'UAE Pass'
    }
    expect(readLocalized(englishOnly, 'ar-AE')).toBe('UAE Pass')

    const unclassified: ArisLocalizedValue = { values: {}, fallback: 'Some fallback' }
    expect(readLocalized(unclassified)).toBe('Some fallback')
  })

  it('returns empty string for null/undefined values with nothing to show', () => {
    expect(readLocalized(null)).toBe('')
    expect(readLocalized(undefined)).toBe('')
    expect(readLocalized({ values: {}, fallback: null })).toBe('')
  })
})
