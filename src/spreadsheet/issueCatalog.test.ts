import { describe, expect, it } from 'vitest'

import { ar, en } from '../i18n/dictionaries'
import { SPREADSHEET_GUIDANCE_KEYS, SPREADSHEET_VALIDATION_MESSAGE_KEYS } from './issueCatalog'

describe('spreadsheet validation translation catalog', () => {
  for (const [locale, dictionary] of [
    ['en', en],
    ['ar', ar]
  ] as const) {
    it(`has a distinct ${locale} message for every emitted validation key`, () => {
      const values = SPREADSHEET_VALIDATION_MESSAGE_KEYS.map((key) => dictionary[key])

      expect(values.every((value) => typeof value === 'string' && value.trim().length > 0)).toBe(
        true
      )
      expect(
        values.every((value, index) => value !== SPREADSHEET_VALIDATION_MESSAGE_KEYS[index])
      ).toBe(true)
      expect(new Set(values).size).toBe(SPREADSHEET_VALIDATION_MESSAGE_KEYS.length)
    })

    it(`has a distinct ${locale} repair for every emitted guidance key`, () => {
      const values = SPREADSHEET_GUIDANCE_KEYS.map((key) => dictionary[key])

      expect(values.every((value) => typeof value === 'string' && value.trim().length > 0)).toBe(
        true
      )
      expect(values.every((value, index) => value !== SPREADSHEET_GUIDANCE_KEYS[index])).toBe(true)
      expect(new Set(values).size).toBe(SPREADSHEET_GUIDANCE_KEYS.length)
    })
  }
})
