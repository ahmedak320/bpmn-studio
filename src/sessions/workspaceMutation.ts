import type { SessionCoordination, SessionLockLease, SessionLockResult } from './controller'
import type { FileFingerprint, WorkspaceIdentity } from './types'
import { workspaceMutationIdentity } from './workspaceMutationIdentity'

export type WorkspaceMutationChangeKind = 'saved' | 'moved' | 'deleted' | 'invalidated'

export interface WorkspaceMutationChange {
  readonly kind: WorkspaceMutationChangeKind
  readonly path: string
  readonly previousPath?: string
  readonly fingerprint?: FileFingerprint
}

export interface WorkspaceMutationLease extends SessionLockLease {
  publish(changes: readonly WorkspaceMutationChange[]): void
}

export interface AcquireWorkspaceMutationLeaseOptions {
  readonly coordination: SessionCoordination | null | undefined
  readonly workspace: WorkspaceIdentity
  readonly signal?: AbortSignal
  readonly isCurrent?: () => boolean
}

export interface RunWorkspaceMutationOptions extends AcquireWorkspaceMutationLeaseOptions {
  /** Lease release is post-commit cleanup and must not falsify durable success. */
  readonly onReleaseError?: (error: unknown) => void
}

export class WorkspaceMutationLockedError extends Error {
  readonly code = 'locked'
  readonly holderId?: string
  readonly expiresAt?: number

  constructor(result: { readonly holderId?: string; readonly expiresAt?: number }) {
    super(
      result.holderId
        ? `Workspace mutation is locked by "${result.holderId}".`
        : 'Workspace mutation is locked by another tab.'
    )
    this.name = 'WorkspaceMutationLockedError'
    this.holderId = result.holderId
    this.expiresAt = result.expiresAt
  }
}

export class WorkspaceMutationCoordinationUnavailableError extends Error {
  readonly code = 'coordination-unavailable'

  constructor() {
    super('Cross-tab workspace mutation coordination is unavailable.')
    this.name = 'WorkspaceMutationCoordinationUnavailableError'
  }
}

export class WorkspaceMutationStaleError extends Error {
  readonly code = 'stale-workspace'

  constructor() {
    super('The workspace changed before the mutation lease was acquired.')
    this.name = 'WorkspaceMutationStaleError'
  }
}

function throwIfCancelled(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  if (typeof signal.throwIfAborted === 'function') {
    signal.throwIfAborted()
    return
  }
  throw new DOMException('The workspace mutation was cancelled.', 'AbortError')
}

function assertCurrent(options: AcquireWorkspaceMutationLeaseOptions): void {
  throwIfCancelled(options.signal)
  if (options.isCurrent && !options.isCurrent()) throw new WorkspaceMutationStaleError()
}

async function releaseWithoutMasking(
  lease: SessionLockLease,
  onReleaseError?: (error: unknown) => void
): Promise<void> {
  try {
    await lease.release()
  } catch (error) {
    try {
      onReleaseError?.(error)
    } catch {
      // A diagnostic callback is cleanup too; it cannot rewrite durable truth.
    }
  }
}

export async function acquireWorkspaceMutationLease(
  options: AcquireWorkspaceMutationLeaseOptions
): Promise<WorkspaceMutationLease> {
  assertCurrent(options)
  if (!options.coordination) throw new WorkspaceMutationCoordinationUnavailableError()

  let result: SessionLockResult
  try {
    result = await options.coordination.acquire(workspaceMutationIdentity(options.workspace))
  } catch (error) {
    assertCurrent(options)
    throw error
  }

  try {
    assertCurrent(options)
    if (!result.acquired) throw new WorkspaceMutationLockedError(result)
  } catch (error) {
    if (result.acquired) await releaseWithoutMasking(result.lease)
    throw error
  }

  let released = false
  return {
    release: async () => {
      if (released) return
      released = true
      await result.lease.release()
    },
    ...(result.lease.renew ? { renew: () => result.lease.renew?.() } : {}),
    publish: (changes) => {
      if (released) return
      for (const change of changes) {
        options.coordination?.publishDocumentChange?.({
          identity: {
            workspace: options.workspace,
            path: change.path
          },
          kind: change.kind,
          fingerprint: change.fingerprint,
          previousPath: change.previousPath
        })
      }
    }
  }
}

export async function runWorkspaceMutation<Result>(
  options: RunWorkspaceMutationOptions,
  operation: (lease: WorkspaceMutationLease) => Promise<Result>
): Promise<Result> {
  const lease = await acquireWorkspaceMutationLease(options)
  try {
    assertCurrent(options)
    return await operation(lease)
  } finally {
    await releaseWithoutMasking(lease, options.onReleaseError)
  }
}
