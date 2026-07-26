import { afterEach, describe, expect, it } from 'vitest'
import { setLang } from '../i18n'
import { decodeUtf8Strict } from './utf8'

afterEach(() => setLang('en'))

describe('decodeUtf8Strict', () => {
  it('decodes valid Arabic UTF-8 without changing the text', () => {
    const value = 'اعتماد الطلب'
    expect(decodeUtf8Strict(new TextEncoder().encode(value))).toBe(value)
  })

  it('uses the localized message while retaining the stable error code', () => {
    setLang('ar')

    expect(() =>
      decodeUtf8Strict(new Uint8Array([0xff]), {
        operation: 'read',
        path: 'تالف.bpmn'
      })
    ).toThrow(
      expect.objectContaining({
        code: 'invalid-encoding',
        operation: 'read',
        path: 'تالف.bpmn',
        message: 'تعذّر فك الترميز'
      })
    )
  })
})
