import { t } from '../i18n'
import type { KeyStorageErrorCode } from './keys'

/**
 * User-facing storage failures are selected from the stable result code.
 * Callers may expose `KeyStorageResult.error` separately as technical evidence,
 * but must not use it as the primary message.
 */
export function keyStorageErrorMessage(code: KeyStorageErrorCode): string {
  switch (code) {
    case 'invalid-input':
      return t('settings.storageError.invalidInput')
    case 'storage-unavailable':
      return t('settings.storageError.unavailable')
    case 'storage-failed':
      return t('settings.storageError.failed')
    case 'crypto-unavailable':
      return t('settings.storageError.cryptoUnavailable')
    case 'invalid-ciphertext':
      return t('settings.storageError.invalidCiphertext')
    case 'unlock-failed':
      return t('settings.storageError.unlockFailed')
    case 'operation-cancelled':
      return t('settings.storageError.operationCancelled')
  }
}
