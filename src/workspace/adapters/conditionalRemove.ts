import type { WorkspaceAdapter } from './types'
import { WorkspaceOperationError } from './workspaceError'

/**
 * Fail-closed bridge for adapters whose conditional-delete capability is
 * optional for compatibility with third-party implementations.
 */
export async function removeFileIfHash(
  adapter: WorkspaceAdapter,
  path: string,
  expectedHash: string
): Promise<void> {
  if (!adapter.removeIfHash) {
    throw new WorkspaceOperationError({
      code: 'unsupported',
      operation: 'remove',
      path,
      message: 'This workspace cannot prove a hash-conditional file removal.'
    })
  }
  await adapter.removeIfHash(path, expectedHash)
}
