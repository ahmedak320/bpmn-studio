import { describe, expect, it } from 'vitest'

import { containsArabicScript, hasMixedBidiScripts, resolveTextDirection } from './bidi'

describe('bidi direction detection', () => {
  it('detects Arabic script text', () => {
    expect(containsArabicScript('إدارة الحيوان')).toBe(true)
    expect(containsArabicScript('Owner Registration')).toBe(false)
  })

  it('resolves direction from an explicit locale first', () => {
    expect(resolveTextDirection('anything', 'ar')).toBe('rtl')
    expect(resolveTextDirection('انی', 'en')).toBe('ltr')
  })

  it('falls back to a script scan when locale is unknown', () => {
    expect(resolveTextDirection('إدارة الحيوان', undefined)).toBe('rtl')
    expect(resolveTextDirection('Owner Registration', undefined)).toBe('ltr')
  })

  it('flags mixed Arabic/Latin runs as a known single-direction approximation', () => {
    expect(hasMixedBidiScripts('نموذج ANIMAL-01')).toBe(true)
    expect(hasMixedBidiScripts('نموذج التسجيل')).toBe(false)
    expect(hasMixedBidiScripts('Animal Registration')).toBe(false)
  })
})
