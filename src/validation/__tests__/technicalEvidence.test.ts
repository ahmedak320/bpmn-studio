import { describe, expect, it } from 'vitest'

import {
  boundedValidationTechnicalDetail,
  VALIDATION_TECHNICAL_DETAIL_MAX_CODE_POINTS
} from '../technicalEvidence'

describe('validation technical evidence', () => {
  it('converts a runtime non-string Error.message inside the guarded boundary', () => {
    const error = new Error('placeholder')
    Object.defineProperty(error, 'message', { configurable: true, value: 503 })

    expect(boundedValidationTechnicalDetail(error)).toBe('503')
  })

  it('suppresses an Error.message getter that throws while being read', () => {
    const error = new Error('placeholder')
    Object.defineProperty(error, 'message', {
      configurable: true,
      get(): never {
        throw new Error('hostile message getter')
      }
    })

    expect(boundedValidationTechnicalDetail(error)).toBeUndefined()
  })

  it('keeps the ellipsis inside the Unicode code-point ceiling', () => {
    const detail = `${'x'.repeat(510)}😀TAIL${'z'.repeat(1_000_000)}`
    const rendered = boundedValidationTechnicalDetail(detail)

    expect(rendered).toBe(`${'x'.repeat(510)}😀…`)
    expect(Array.from(rendered ?? '')).toHaveLength(VALIDATION_TECHNICAL_DETAIL_MAX_CODE_POINTS)
  })
})
