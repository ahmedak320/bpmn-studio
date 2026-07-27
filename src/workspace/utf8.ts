import { t } from '../i18n'
import type { WorkspaceOperation } from './adapters/types'
import { WorkspaceOperationError } from './adapters/workspaceError'

/** Stable machine-readable code for bytes that are not valid UTF-8. */
export const INVALID_UTF8_ERROR_CODE = 'invalid-encoding' as const

/**
 * Decode a browser/file-system byte boundary without accepting replacement
 * characters. Callers can safely isolate the resulting WorkspaceOperationError
 * while presenting its message in the currently selected application language.
 */
export function decodeUtf8Strict(
  bytes: Uint8Array,
  options: {
    operation?: WorkspaceOperation
    path?: string
  } = {}
): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch (cause) {
    throw new WorkspaceOperationError({
      code: INVALID_UTF8_ERROR_CODE,
      operation: options.operation ?? 'read',
      path: options.path,
      message: t('library.skip.decode-failed'),
      cause
    })
  }
}
