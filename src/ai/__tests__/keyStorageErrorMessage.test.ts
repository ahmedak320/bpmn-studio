import { afterEach, describe, expect, it } from 'vitest'
import { setLang } from '../../i18n'
import type { KeyStorageErrorCode } from '../keys'
import { keyStorageErrorMessage } from '../keyStorageErrorMessage'

const ERROR_CODES: readonly KeyStorageErrorCode[] = [
  'invalid-input',
  'storage-unavailable',
  'storage-failed',
  'crypto-unavailable',
  'invalid-ciphertext',
  'unlock-failed',
  'operation-cancelled'
]

afterEach(() => setLang('en'))

describe('keyStorageErrorMessage', () => {
  it.each(ERROR_CODES)('serves distinct English and Arabic copy for %s', (code) => {
    setLang('en')
    const english = keyStorageErrorMessage(code)
    setLang('ar')
    const arabic = keyStorageErrorMessage(code)

    expect(english).not.toBe(code)
    expect(arabic).not.toBe(code)
    expect(arabic).not.toBe(english)
  })
})
