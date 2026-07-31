// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'

import { bidiTextAttrs, containsArabicScript, hasMixedBidiScripts } from './bidi'

describe('bidi text classification (V8)', () => {
  it('detects Arabic script and mixed runs', () => {
    expect(containsArabicScript('اسم العملية:')).toBe(true)
    expect(containsArabicScript('Process Code:')).toBe(false)
    expect(hasMixedBidiScripts('قرار رئيس دائرة التخطيط العمراني والبلدي رقم (3) لسنة 1983')).toBe(
      true
    )
    expect(hasMixedBidiScripts('اسم العملية:')).toBe(false)
    expect(hasMixedBidiScripts('Process Code:')).toBe(false)
  })

  it('gives Arabic text RTL direction with per-paragraph bidi resolution', () => {
    expect(bidiTextAttrs('اسم العملية:')).toEqual({
      direction: 'rtl',
      'unicode-bidi': 'plaintext'
    })
    // Mixed Arabic/Latin runs reorder per UAX#9 with the Arabic base direction.
    expect(bidiTextAttrs('قرار رقم (3) لسنة 1983 بشأن')).toEqual({
      direction: 'rtl',
      'unicode-bidi': 'plaintext'
    })
  })

  it('leaves pure LTR text untouched — no direction attributes at all', () => {
    expect(bidiTextAttrs('Process Code:')).toEqual({})
    expect(bidiTextAttrs('AWF.01.01')).toEqual({})
    expect(bidiTextAttrs('')).toEqual({})
  })
})
