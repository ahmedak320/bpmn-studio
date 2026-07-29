import { describe, expect, it } from 'vitest'

import type { ArisLocalizedValue } from '../model/types'
import { arisText } from './arisStudioDocument'

/**
 * Regression coverage for the locale-classification bug: `arisText` used to look up
 * `value.values[localeId]` against an exact-match `ENGLISH_LOCALE_IDS`/`ARABIC_LOCALE_IDS`
 * allow-list. A real ARIS AML export keys `values` by the RAW, unexpanded internal-DTD entity
 * reference (`"&LocaleId.AEar;"` / `"&LocaleId.USen;"`) — never the bare entity name and never
 * the resolved numeric LCID on its own — so the allow-list could never match real data and the
 * shell fell through to `fallback`/first-value, regardless of the requested language.
 */
describe('arisText locale classification', () => {
  const rawEntityReferenceNames: ArisLocalizedValue = {
    // Confirmed against reference/AnimalWF/ARISAMLExport.xml's ObjDef.-6n37IkhqS5m-p-L: the
    // Arabic AttrValue is written BEFORE the English one, so a naive "first value" fallback
    // would silently return Arabic when English was requested.
    values: {
      '&LocaleId.AEar;': 'الهوية الرقمية',
      '&LocaleId.USen;': 'UAE Pass'
    },
    fallback: 'الهوية الرقمية'
  }

  it('resolves English from a raw entity-reference locale key', () => {
    expect(arisText(rawEntityReferenceNames, 'en')).toBe('UAE Pass')
  })

  it('resolves Arabic from a raw entity-reference locale key', () => {
    expect(arisText(rawEntityReferenceNames, 'ar')).toBe('الهوية الرقمية')
  })

  it('still resolves numeric LCIDs and BCP-47 tags', () => {
    const numeric: ArisLocalizedValue = {
      values: { '1033': 'Approve', '14337': 'موافقة' },
      fallback: null
    }
    expect(arisText(numeric, 'en')).toBe('Approve')
    expect(arisText(numeric, 'ar')).toBe('موافقة')

    const bcp47: ArisLocalizedValue = {
      values: { 'en-US': 'Approve', 'ar-AE': 'موافقة' },
      fallback: null
    }
    expect(arisText(bcp47, 'en')).toBe('Approve')
    expect(arisText(bcp47, 'ar')).toBe('موافقة')
  })

  it('falls back to fallback text, then any value, when the language is absent', () => {
    const englishOnly: ArisLocalizedValue = {
      values: { '&LocaleId.USen;': 'UAE Pass' },
      fallback: null
    }
    expect(arisText(englishOnly, 'ar')).toBe('UAE Pass')

    const unclassified: ArisLocalizedValue = { values: {}, fallback: 'Some fallback' }
    expect(arisText(unclassified, 'en')).toBe('Some fallback')
  })

  it('returns null for an undefined value', () => {
    expect(arisText(undefined, 'en')).toBeNull()
  })
})
