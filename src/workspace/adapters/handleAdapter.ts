import { exportWorkspaceBackup } from './backup'
import { copyBytes, equalHash, sha256Hex } from './hash'
import {
  isPathWithin,
  normalizeWorkspacePath,
  workspaceParentPath,
  workspacePathName
} from './path'
import { SerialQueue } from './serialQueue'
import type {
  BackupExportOptions,
  FileSnapshot,
  SaveOutcome,
  WorkspaceAdapter,
  WorkspaceBackupExporter,
  WorkspaceEntry,
  WorkspaceMode,
  WorkspaceOperation,
  WorkspaceStorageInfo,
  WriteAtomicOptions
} from './types'
import {
  WorkspaceOperationError,
  alreadyExists,
  asWorkspaceOperationError,
  errorName,
  notFound,
  workspaceFailure
} from './workspaceError'

interface HandleAdapterOptions {
  id: string
  storage: WorkspaceStorageInfo
  backupExporter?: WorkspaceBackupExporter
  checkPermission?: boolean
  now?: () => number
}

interface ResolvedEntry {
  name: string
  parent: FileSystemDirectoryHandle
  handle: FileSystemFileHandle | FileSystemDirectoryHandle
  kind: 'file' | 'directory'
}

interface CreatedDirectoryRoot {
  parent: FileSystemDirectoryHandle
  name: string
}

type WritableWithAbort = FileSystemWritableFileStream & {
  abort?: (reason?: unknown) => Promise<void>
}

const RELOCATE_TEMP_MARKER = '.__orbitpm_relocate__'

/**
 * Shared FileSystemHandle implementation used by user-selected directories and
 * OPFS. File System Access has atomic writable close but no cross-browser
 * compare-and-swap primitive, so the adapter serializes local operations and
 * performs the expected-hash check immediately before opening the writable.
 */
export abstract class HandleWorkspaceAdapter implements WorkspaceAdapter {
  readonly id: string
  readonly mode: WorkspaceMode
  readonly storage: WorkspaceStorageInfo

  protected readonly root: FileSystemDirectoryHandle
  private readonly queue = new SerialQueue()
  private readonly backupExporter: WorkspaceBackupExporter
  private readonly checkPermission: boolean
  private readonly now: () => number

  protected constructor(
    mode: WorkspaceMode,
    root: FileSystemDirectoryHandle,
    options: HandleAdapterOptions
  ) {
    this.mode = mode
    this.root = root
    this.id = options.id
    this.storage = options.storage
    this.backupExporter = options.backupExporter ?? exportWorkspaceBackup
    this.checkPermission = options.checkPermission ?? false
    this.now = options.now ?? (() => Date.now())
  }

  /**
   * Compatibility bridge for application features that still consume a
   * directory handle (for example bpmn-js import helpers). Mutations should
   * continue to go through the adapter so expected-hash and recovery policies
   * remain enforced.
   */
  get directoryHandle(): FileSystemDirectoryHandle {
    return this.root
  }

  async list(path = ''): Promise<WorkspaceEntry[]> {
    const normalized = normalizeWorkspacePath(path, { allowRoot: true })
    await this.ensurePermission('list', normalized || undefined, false)
    const directory = await this.resolveDirectory(normalized, false, 'list')
    const entries: WorkspaceEntry[] = []
    await this.walkDirectory(directory, normalized, entries, normalized === '')
    return entries.sort(compareEntries)
  }

  async read(path: string): Promise<FileSnapshot> {
    const normalized = normalizeWorkspacePath(path)
    await this.ensurePermission('read', normalized, false)
    const entry = await this.resolveEntry(normalized, 'read')
    if (entry.kind !== 'file') {
      throw new WorkspaceOperationError({
        code: 'not-a-file',
        operation: 'read',
        path: normalized,
        message: `Workspace entry "${normalized}" is not a file.`
      })
    }
    return this.snapshotFile(normalized, entry.handle as FileSystemFileHandle)
  }

  async writeAtomic(
    path: string,
    bytes: Uint8Array,
    expectedHash?: string,
    options: WriteAtomicOptions = {}
  ): Promise<SaveOutcome> {
    const normalized = normalizeWorkspacePath(path)
    const ownedBytes = copyBytes(bytes)
    let incomingHash: string
    try {
      incomingHash = await sha256Hex(ownedBytes)
    } catch (error) {
      return this.failureOutcome(error, normalized)
    }

    return this.queue.run(async () => {
      if (options.expectedWorkspaceId !== undefined && options.expectedWorkspaceId !== this.id) {
        return {
          ok: false,
          status: 'stale-workspace',
          expectedWorkspaceId: options.expectedWorkspaceId,
          actualWorkspaceId: this.id
        }
      }
      if (options.signal?.aborted) return this.cancelledOutcome(normalized)
      if (expectedHash !== undefined && options.expectedMissing) {
        return this.failureOutcome(
          new WorkspaceOperationError({
            code: 'storage-failure',
            operation: 'write',
            path: normalized,
            message: 'expectedHash and expectedMissing cannot be used together.'
          }),
          normalized
        )
      }

      let parent: FileSystemDirectoryHandle | undefined
      let createdDirectoryRoot: CreatedDirectoryRoot | undefined
      let created = false
      let writable: WritableWithAbort | undefined
      try {
        await this.ensurePermission('write', normalized, true)
        const parentPath = workspaceParentPath(normalized)
        const name = workspacePathName(normalized)
        try {
          parent = await this.resolveDirectory(parentPath, false, 'write')
        } catch (error) {
          const resolved = asWorkspaceOperationError(error, 'write', parentPath)
          if (resolved.code !== 'not-found') throw resolved
        }

        const currentEntry = parent ? await this.probeEntry(parent, name) : undefined
        if (currentEntry?.kind === 'directory') {
          throw new WorkspaceOperationError({
            code: 'not-a-file',
            operation: 'write',
            path: normalized,
            message: `Workspace entry "${normalized}" is a directory.`
          })
        }
        const actual = currentEntry
          ? await this.snapshotFile(normalized, currentEntry.handle as FileSystemFileHandle)
          : undefined

        if (expectedHash !== undefined) {
          if (!actual) {
            return {
              ok: false,
              status: 'external-conflict',
              reason: 'missing',
              expectedHash
            }
          }
          if (!equalHash(actual.hash, expectedHash)) {
            return {
              ok: false,
              status: 'external-conflict',
              reason: 'hash-mismatch',
              expectedHash,
              actual
            }
          }
        } else if (options.expectedMissing && actual) {
          return {
            ok: false,
            status: 'external-conflict',
            reason: 'already-exists',
            actual
          }
        }

        if (options.signal?.aborted) return this.cancelledOutcome(normalized)
        if (!parent) {
          const createdParents = await this.createDirectoryTree(parentPath, 'write')
          parent = createdParents.directory
          createdDirectoryRoot = createdParents.createdRoot
        }
        const handle = await parent.getFileHandle(name, { create: true })
        created = !actual
        writable = (await handle.createWritable({
          keepExistingData: false
        })) as WritableWithAbort
        await writable.write(ownedBytes)
        if (options.signal?.aborted) {
          await abortWritable(writable)
          if (created) await removeEntryQuietly(parent, name, false)
          return this.cancelledOutcome(normalized)
        }
        await writable.close()
        writable = undefined

        let snapshot: FileSnapshot
        try {
          snapshot = await this.snapshotFile(normalized, handle)
        } catch {
          // close() is the persistence commit point. If post-write metadata is
          // temporarily unavailable, report the confirmed bytes truthfully.
          snapshot = {
            path: normalized,
            bytes: copyBytes(ownedBytes),
            hash: incomingHash,
            size: ownedBytes.byteLength,
            modifiedAt: this.now(),
            mimeType: actual?.mimeType ?? inferMimeType(normalized)
          }
        }
        if (!equalHash(snapshot.hash, incomingHash)) {
          throw new WorkspaceOperationError({
            code: 'integrity-failure',
            operation: 'write',
            path: normalized,
            message: `Workspace write verification failed for "${normalized}".`
          })
        }

        return {
          ok: true,
          status: 'success',
          snapshot,
          created,
          previousHash: actual?.hash,
          disposition: 'workspace'
        }
      } catch (error) {
        if (writable) await abortWritable(writable)
        if (created && parent) {
          await removeEntryQuietly(parent, workspacePathName(normalized), false)
        }
        if (createdDirectoryRoot) {
          await removeEntryQuietly(createdDirectoryRoot.parent, createdDirectoryRoot.name, true)
        }
        return this.failureOutcome(error, normalized)
      }
    })
  }

  async rename(from: string, to: string): Promise<void> {
    const source = normalizeWorkspacePath(from)
    const destination = normalizeWorkspacePath(to)
    if (workspaceParentPath(source) !== workspaceParentPath(destination)) {
      throw new WorkspaceOperationError({
        code: 'invalid-path',
        operation: 'rename',
        path: destination,
        message: 'Rename destinations must remain in the same parent folder.'
      })
    }
    await this.queue.run(() => this.relocate(source, destination, 'rename'))
  }

  async move(from: string, to: string): Promise<void> {
    const source = normalizeWorkspacePath(from)
    const destination = normalizeWorkspacePath(to)
    await this.queue.run(() => this.relocate(source, destination, 'move'))
  }

  async remove(path: string): Promise<void> {
    const normalized = normalizeWorkspacePath(path)
    await this.queue.run(async () => {
      await this.ensurePermission('remove', normalized, true)
      const entry = await this.resolveEntry(normalized, 'remove')
      await entry.parent.removeEntry(entry.name, { recursive: entry.kind === 'directory' })
    })
  }

  async createFolder(path: string): Promise<void> {
    const normalized = normalizeWorkspacePath(path)
    await this.queue.run(async () => {
      await this.ensurePermission('create-folder', normalized, true)
      await this.createDirectoryTree(normalized, 'create-folder')
    })
  }

  exportBackup(options?: BackupExportOptions): Promise<Blob> {
    return this.queue.run(() => this.backupExporter(this, options))
  }

  private async walkDirectory(
    directory: FileSystemDirectoryHandle,
    parentPath: string,
    output: WorkspaceEntry[],
    isRoot: boolean
  ): Promise<void> {
    let children: Array<[string, FileSystemFileHandle | FileSystemDirectoryHandle]>
    try {
      children = []
      for await (const child of directory.entries()) children.push(child)
    } catch (error) {
      if (isRoot) throw asWorkspaceOperationError(error, 'list', parentPath)
      const directoryEntry = output.find((entry) => entry.path === parentPath)
      if (directoryEntry) {
        directoryEntry.readable = false
        directoryEntry.issue = workspaceFailure(error, 'list', parentPath)
      }
      return
    }

    children.sort(([left], [right]) =>
      left.localeCompare(right, undefined, { sensitivity: 'base' })
    )
    for (const [name, handle] of children) {
      const path = parentPath ? `${parentPath}/${name}` : name
      if (handle.kind === 'directory') {
        const entry: WorkspaceEntry = {
          path,
          name,
          parentPath,
          kind: 'directory',
          readable: true
        }
        output.push(entry)
        try {
          await this.walkDirectory(handle as FileSystemDirectoryHandle, path, output, false)
        } catch (error) {
          entry.readable = false
          entry.issue = workspaceFailure(error, 'list', path)
        }
        continue
      }

      try {
        const file = await (handle as FileSystemFileHandle).getFile()
        output.push({
          path,
          name,
          parentPath,
          kind: 'file',
          size: file.size,
          modifiedAt: file.lastModified,
          mimeType: file.type || inferMimeType(path),
          readable: true
        })
      } catch (error) {
        output.push({
          path,
          name,
          parentPath,
          kind: 'file',
          readable: false,
          issue: workspaceFailure(error, 'read', path)
        })
      }
    }
  }

  private async relocate(
    sourcePath: string,
    destinationPath: string,
    operation: 'rename' | 'move'
  ): Promise<void> {
    if (sourcePath === destinationPath) return
    await this.ensurePermission(operation, sourcePath, true)
    const source = await this.resolveEntry(sourcePath, operation)
    if (source.kind === 'directory' && isPathWithin(destinationPath, sourcePath)) {
      throw new WorkspaceOperationError({
        code: 'invalid-path',
        operation,
        path: destinationPath,
        message: 'A folder cannot be moved into itself or one of its descendants.'
      })
    }

    const destinationParentPath = workspaceParentPath(destinationPath)
    const destinationName = workspacePathName(destinationPath)
    const destinationParent = await this.resolveDirectory(destinationParentPath, false, operation)
    const existing = await this.probeEntry(destinationParent, destinationName)
    const sameEntry = existing
      ? await handlesReferToSameEntry(source, existing, sourcePath, destinationPath)
      : false
    if (existing && !sameEntry) throw alreadyExists(operation, destinationPath)

    const beforeFingerprint = await this.fingerprint(source.handle)
    if (sameEntry) {
      await this.caseOnlyRelocate(
        source,
        sourcePath,
        destinationParent,
        destinationName,
        destinationPath,
        beforeFingerprint,
        operation
      )
      return
    }

    try {
      await this.copyEntry(source.handle, destinationParent, destinationName)
      const sourceAfterCopy = await this.resolveEntry(sourcePath, operation)
      const afterFingerprint = await this.fingerprint(sourceAfterCopy.handle)
      if (beforeFingerprint !== afterFingerprint) {
        throw new WorkspaceOperationError({
          code: 'integrity-failure',
          operation,
          path: sourcePath,
          message: `Workspace entry "${sourcePath}" changed while it was being relocated.`
        })
      }
      await source.parent.removeEntry(source.name, {
        recursive: source.kind === 'directory'
      })
    } catch (error) {
      await removeEntryQuietly(destinationParent, destinationName, source.kind === 'directory')
      throw asWorkspaceOperationError(error, operation, sourcePath)
    }
  }

  private async caseOnlyRelocate(
    source: ResolvedEntry,
    sourcePath: string,
    destinationParent: FileSystemDirectoryHandle,
    destinationName: string,
    destinationPath: string,
    beforeFingerprint: string,
    operation: 'rename' | 'move'
  ): Promise<void> {
    const tempName = await this.uniqueTempName(source.parent, source.name)
    let sourceRemoved = false
    try {
      await this.copyEntry(source.handle, source.parent, tempName)
      const afterFingerprint = await this.fingerprint(source.handle)
      if (afterFingerprint !== beforeFingerprint) {
        throw new WorkspaceOperationError({
          code: 'integrity-failure',
          operation,
          path: sourcePath,
          message: `Workspace entry "${sourcePath}" changed while it was being renamed.`
        })
      }
      await source.parent.removeEntry(source.name, {
        recursive: source.kind === 'directory'
      })
      sourceRemoved = true
      const staged = await this.probeEntry(source.parent, tempName)
      if (!staged) throw notFound(operation, tempName)
      await this.copyEntry(staged.handle, destinationParent, destinationName)
      await source.parent.removeEntry(tempName, {
        recursive: source.kind === 'directory'
      })
    } catch (error) {
      if (sourceRemoved) {
        const staged = await this.probeEntry(source.parent, tempName)
        if (staged) {
          await removeEntryQuietly(destinationParent, destinationName, source.kind === 'directory')
          try {
            await this.copyEntry(staged.handle, source.parent, source.name)
            await source.parent.removeEntry(tempName, {
              recursive: source.kind === 'directory'
            })
          } catch {
            // Keep the distinctive staging entry as the recovery copy when a
            // backing filesystem fails both the operation and its rollback.
          }
        }
      } else {
        await removeEntryQuietly(source.parent, tempName, source.kind === 'directory')
      }
      throw asWorkspaceOperationError(error, operation, destinationPath)
    }
  }

  private async copyEntry(
    source: FileSystemFileHandle | FileSystemDirectoryHandle,
    destinationParent: FileSystemDirectoryHandle,
    destinationName: string
  ): Promise<void> {
    if (source.kind === 'file') {
      const file = await (source as FileSystemFileHandle).getFile()
      const bytes = copyBytes(new Uint8Array(await file.arrayBuffer()))
      const target = await destinationParent.getFileHandle(destinationName, { create: true })
      let writable: WritableWithAbort | undefined
      try {
        writable = (await target.createWritable({
          keepExistingData: false
        })) as WritableWithAbort
        await writable.write(bytes)
        await writable.close()
      } catch (error) {
        if (writable) await abortWritable(writable)
        await removeEntryQuietly(destinationParent, destinationName, false)
        throw error
      }
      return
    }

    const target = await destinationParent.getDirectoryHandle(destinationName, {
      create: true
    })
    try {
      for await (const [name, child] of (source as FileSystemDirectoryHandle).entries()) {
        await this.copyEntry(child, target, name)
      }
    } catch (error) {
      await removeEntryQuietly(destinationParent, destinationName, true)
      throw error
    }
  }

  private async fingerprint(
    handle: FileSystemFileHandle | FileSystemDirectoryHandle
  ): Promise<string> {
    if (handle.kind === 'file') {
      const file = await (handle as FileSystemFileHandle).getFile()
      const bytes = new Uint8Array(await file.arrayBuffer())
      const hash = await sha256Hex(bytes)
      return `f:${file.size}:${file.lastModified}:${hash}`
    }
    const parts: string[] = []
    const children: Array<[string, FileSystemFileHandle | FileSystemDirectoryHandle]> = []
    for await (const child of (handle as FileSystemDirectoryHandle).entries()) {
      children.push(child)
    }
    children.sort(([left], [right]) => left.localeCompare(right))
    for (const [name, child] of children) {
      parts.push(`${name}:${await this.fingerprint(child)}`)
    }
    return `d:${parts.join('|')}`
  }

  private async snapshotFile(path: string, handle: FileSystemFileHandle): Promise<FileSnapshot> {
    const file = await handle.getFile()
    const bytes = copyBytes(new Uint8Array(await file.arrayBuffer()))
    return {
      path,
      bytes,
      hash: await sha256Hex(bytes),
      size: bytes.byteLength,
      modifiedAt: typeof file.lastModified === 'number' ? file.lastModified : 0,
      mimeType: file.type || inferMimeType(path)
    }
  }

  private async resolveDirectory(
    path: string,
    create: boolean,
    operation: WorkspaceOperation
  ): Promise<FileSystemDirectoryHandle> {
    const normalized = normalizeWorkspacePath(path, { allowRoot: true })
    let directory = this.root
    if (!normalized) return directory
    let current = ''
    for (const segment of normalized.split('/')) {
      current = current ? `${current}/${segment}` : segment
      if (!create) {
        const entry = await this.probeEntry(directory, segment)
        if (!entry) throw notFound(operation, current)
        if (entry.kind !== 'directory') {
          throw new WorkspaceOperationError({
            code: 'not-a-directory',
            operation,
            path: current,
            message: `Workspace entry "${current}" is not a directory.`
          })
        }
        directory = entry.handle as FileSystemDirectoryHandle
        continue
      }

      const existing = await this.probeEntry(directory, segment)
      if (existing?.kind === 'file') throw alreadyExists(operation, current)
      directory = existing
        ? (existing.handle as FileSystemDirectoryHandle)
        : await directory.getDirectoryHandle(segment, { create: true })
    }
    return directory
  }

  private async createDirectoryTree(
    path: string,
    operation: WorkspaceOperation
  ): Promise<{
    directory: FileSystemDirectoryHandle
    createdRoot?: CreatedDirectoryRoot
  }> {
    const normalized = normalizeWorkspacePath(path, { allowRoot: true })
    let directory = this.root
    let createdRoot: CreatedDirectoryRoot | undefined
    if (!normalized) return { directory }

    let current = ''
    try {
      for (const segment of normalized.split('/')) {
        current = current ? `${current}/${segment}` : segment
        const existing = await this.probeEntry(directory, segment)
        if (existing?.kind === 'file') throw alreadyExists(operation, current)
        if (existing) {
          directory = existing.handle as FileSystemDirectoryHandle
          continue
        }
        const parent = directory
        directory = await parent.getDirectoryHandle(segment, { create: true })
        createdRoot ??= { parent, name: segment }
      }
      return { directory, createdRoot }
    } catch (error) {
      if (createdRoot) {
        await removeEntryQuietly(createdRoot.parent, createdRoot.name, true)
      }
      throw error
    }
  }

  private async resolveEntry(path: string, operation: WorkspaceOperation): Promise<ResolvedEntry> {
    const normalized = normalizeWorkspacePath(path)
    const parent = await this.resolveDirectory(workspaceParentPath(normalized), false, operation)
    const entry = await this.probeEntry(parent, workspacePathName(normalized))
    if (!entry) throw notFound(operation, normalized)
    return entry
  }

  /**
   * Enumeration provides the canonical spelling. Direct probes after that catch
   * case-insensitive aliases on Windows/macOS, which is essential for avoiding
   * copy-then-delete loss during case-only renames.
   */
  private async probeEntry(
    parent: FileSystemDirectoryHandle,
    name: string
  ): Promise<ResolvedEntry | undefined> {
    for await (const [entryName, handle] of parent.entries()) {
      if (entryName === name) {
        return { name: entryName, parent, handle, kind: handle.kind }
      }
    }
    try {
      const handle = await parent.getFileHandle(name, { create: false })
      return { name, parent, handle, kind: 'file' }
    } catch (error) {
      if (!isMissingOrWrongKind(error)) throw error
    }
    try {
      const handle = await parent.getDirectoryHandle(name, { create: false })
      return { name, parent, handle, kind: 'directory' }
    } catch (error) {
      if (!isMissingOrWrongKind(error)) throw error
      return undefined
    }
  }

  private async uniqueTempName(
    parent: FileSystemDirectoryHandle,
    sourceName: string
  ): Promise<string> {
    for (let index = 1; index <= 1000; index += 1) {
      const candidate = `${sourceName}${RELOCATE_TEMP_MARKER}${index}`
      if (!(await this.probeEntry(parent, candidate))) return candidate
    }
    throw new WorkspaceOperationError({
      code: 'storage-failure',
      operation: 'move',
      message: 'Could not allocate a safe temporary relocation name.'
    })
  }

  private async ensurePermission(
    operation: WorkspaceOperation,
    path: string | undefined,
    write: boolean
  ): Promise<void> {
    if (!this.checkPermission || typeof this.root.queryPermission !== 'function') return
    const state = await this.root.queryPermission({ mode: write ? 'readwrite' : 'read' })
    if (state === 'granted') return
    throw new WorkspaceOperationError({
      code: 'permission-loss',
      operation,
      path,
      message:
        state === 'prompt'
          ? 'Workspace permission must be reconnected from a user gesture.'
          : 'Workspace permission is no longer granted.'
    })
  }

  private failureOutcome(error: unknown, path: string): SaveOutcome {
    const failure = workspaceFailure(error, 'write', path)
    if (failure.code === 'permission-loss') {
      return { ok: false, status: 'permission-loss', error: failure }
    }
    if (failure.code === 'cancelled') {
      return { ok: false, status: 'cancelled', error: failure }
    }
    return { ok: false, status: 'storage-failure', error: failure }
  }

  private cancelledOutcome(path: string): SaveOutcome {
    return {
      ok: false,
      status: 'cancelled',
      error: {
        code: 'cancelled',
        operation: 'write',
        path,
        message: 'Workspace write was cancelled.',
        name: 'AbortError'
      }
    }
  }
}

async function handlesReferToSameEntry(
  source: ResolvedEntry,
  destination: ResolvedEntry,
  sourcePath: string,
  destinationPath: string
): Promise<boolean> {
  const isSameEntry = (
    source.handle as FileSystemHandle & {
      isSameEntry?: (other: FileSystemHandle) => Promise<boolean>
    }
  ).isSameEntry
  if (typeof isSameEntry === 'function') {
    return isSameEntry.call(source.handle, destination.handle)
  }
  return (
    source.parent === destination.parent &&
    source.kind === destination.kind &&
    workspacePathName(sourcePath).toLocaleLowerCase('en-US') ===
      workspacePathName(destinationPath).toLocaleLowerCase('en-US')
  )
}

async function abortWritable(writable: WritableWithAbort): Promise<void> {
  try {
    if (typeof writable.abort === 'function') await writable.abort()
  } catch {
    // Best effort; the original failure remains authoritative.
  }
}

async function removeEntryQuietly(
  parent: FileSystemDirectoryHandle,
  name: string,
  recursive: boolean
): Promise<void> {
  try {
    await parent.removeEntry(name, { recursive })
  } catch {
    // Rollback cleanup is best effort. Relocation staging names are distinctive
    // and retain data if cleanup/restoration cannot complete.
  }
}

function inferMimeType(path: string): string {
  if (/\.bpmn$/i.test(path) || /\.xml$/i.test(path)) return 'application/xml'
  if (/\.json$/i.test(path)) return 'application/json'
  return 'application/octet-stream'
}

function compareEntries(left: WorkspaceEntry, right: WorkspaceEntry): number {
  if (left.parentPath === right.parentPath && left.kind !== right.kind) {
    return left.kind === 'directory' ? -1 : 1
  }
  return left.path.localeCompare(right.path, undefined, { sensitivity: 'base' })
}

function isMissingOrWrongKind(error: unknown): boolean {
  const name = errorName(error)
  return name === 'NotFoundError' || name === 'TypeMismatchError'
}
