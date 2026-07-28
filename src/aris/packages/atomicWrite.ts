/**
 * The one place that mutates a workspace on behalf of an ARIS source package.
 *
 * It creates the requested directories, creates every member with a
 * creation-only compare-and-set write, and — on any failure, including a failed
 * post-write verification — removes every file and directory it created, in
 * reverse order. Files are removed by conditional delete on the exact hash this
 * routine wrote, so a concurrent writer's content is never destroyed by a
 * rollback.
 */

import { equalHash } from '../../workspace/adapters/hash'
import type { WorkspaceAdapter } from '../../workspace/adapters/types'
import { ArisPackageError, ArisPackageStore } from './store'

export interface AtomicPackageMember {
  readonly path: string
  readonly bytes: Uint8Array
  readonly sha256: string
}

export interface AtomicPackageFailure {
  readonly message: string
  readonly path?: string
}

export type AtomicPackageWriteResult =
  | { readonly status: 'committed'; readonly writtenPaths: readonly string[] }
  | {
      readonly status: 'rolled-back' | 'rollback-failed'
      readonly error: AtomicPackageFailure
      readonly rollbackErrors: readonly AtomicPackageFailure[]
    }

export interface AtomicPackageWriteOptions {
  /** Created in order; every ancestor must precede its descendants. */
  readonly directories: readonly string[]
  readonly members: readonly AtomicPackageMember[]
  /** Treat a byte-identical existing member as already satisfied. */
  readonly skipIdentical?: boolean
  /** Runs after every member is written; a rejection triggers full rollback. */
  readonly verify?: () => Promise<void>
  readonly signal?: AbortSignal
}

export function atomicFailure(error: unknown, path?: string): AtomicPackageFailure {
  const message = error instanceof Error ? error.message : String(error)
  const resolved = path ?? (error instanceof ArisPackageError ? error.path : undefined)
  return Object.freeze({ message, ...(resolved ? { path: resolved } : {}) })
}

export async function writeArisPackageMembersAtomically(
  adapter: WorkspaceAdapter,
  options: AtomicPackageWriteOptions
): Promise<AtomicPackageWriteResult> {
  const store = new ArisPackageStore(adapter)
  const createdFiles: Array<{ path: string; sha256: string }> = []
  const createdDirectories: string[] = []

  const rollback = async (error: unknown): Promise<AtomicPackageWriteResult> => {
    const rollbackErrors: AtomicPackageFailure[] = []
    for (const file of [...createdFiles].reverse()) {
      try {
        await adapter.removeIfHash?.(file.path, file.sha256)
      } catch (removeError) {
        rollbackErrors.push(atomicFailure(removeError, file.path))
      }
    }
    for (const directory of [...createdDirectories].reverse()) {
      try {
        const result = await adapter.removeEmptyFolder?.(directory)
        if (result === 'not-empty') {
          rollbackErrors.push(
            Object.freeze({
              message: `Directory "${directory}" was not empty during rollback.`,
              path: directory
            })
          )
        }
      } catch (removeError) {
        rollbackErrors.push(atomicFailure(removeError, directory))
      }
    }
    return Object.freeze({
      status: rollbackErrors.length === 0 ? 'rolled-back' : 'rollback-failed',
      error: atomicFailure(error),
      rollbackErrors: Object.freeze(rollbackErrors)
    })
  }

  try {
    for (const directory of options.directories) {
      options.signal?.throwIfAborted()
      const result = await adapter.createFolderIfMissing?.(directory)
      if (result === 'created') createdDirectories.push(directory)
    }
    for (const member of options.members) {
      options.signal?.throwIfAborted()
      if (options.skipIdentical) {
        const existing = await readIfPresent(adapter, member.path)
        if (existing && equalHash(existing, member.sha256)) continue
      }
      const written = await store.createMemberOnce(member.path, member.bytes)
      createdFiles.push({ path: written.path, sha256: written.sha256 })
      if (!equalHash(written.sha256, member.sha256)) {
        throw new ArisPackageError(
          'integrity-failure',
          `Member "${member.path}" was stored with unexpected content.`,
          member.path
        )
      }
    }
    await options.verify?.()
  } catch (error) {
    return rollback(error)
  }

  return Object.freeze({
    status: 'committed',
    writtenPaths: Object.freeze(createdFiles.map((file) => file.path))
  })
}

async function readIfPresent(
  adapter: WorkspaceAdapter,
  path: string
): Promise<string | undefined> {
  try {
    return (await adapter.read(path)).hash
  } catch {
    return undefined
  }
}
