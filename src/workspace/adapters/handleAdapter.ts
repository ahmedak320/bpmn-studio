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
  CreateFolderIfMissingResult,
  FileSnapshot,
  ListWorkspaceOptions,
  ReadFileOptions,
  RemoveEmptyFolderResult,
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
  WorkspaceListLimitError,
  WorkspaceOperationError,
  WorkspaceReadLimitError,
  alreadyExists,
  asWorkspaceOperationError,
  errorName,
  notFound,
  validatedListLimits,
  validatedReadLimit,
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
const fingerprintEncoder = new TextEncoder()

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

  async list(path = '', options: ListWorkspaceOptions = {}): Promise<WorkspaceEntry[]> {
    const limits = validatedListLimits(options)
    const normalized = normalizeWorkspacePath(path, { allowRoot: true })
    await this.ensurePermission('list', normalized || undefined, false)
    options.signal?.throwIfAborted()
    const directory = await this.resolveDirectory(normalized, false, 'list')
    options.signal?.throwIfAborted()
    const entries: WorkspaceEntry[] = []
    await this.walkDirectory(
      directory,
      normalized,
      entries,
      normalized === '',
      options.signal,
      limits.maxEntries,
      limits.maxDepth,
      0
    )
    options.signal?.throwIfAborted()
    return entries.sort(compareEntries)
  }

  async read(path: string, options: ReadFileOptions = {}): Promise<FileSnapshot> {
    const normalized = normalizeWorkspacePath(path)
    validatedReadLimit(normalized, options)
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
    return this.snapshotFile(normalized, entry.handle as FileSystemFileHandle, options)
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

  async removeIfHash(path: string, expectedHashInput: string): Promise<void> {
    const normalized = normalizeWorkspacePath(path)
    const expectedHash = validatedConditionalRemoveHash(expectedHashInput)
    await this.queue.run(async () => {
      await this.ensurePermission('remove', normalized, true)
      let entry: ResolvedEntry
      try {
        entry = await this.resolveEntry(normalized, 'remove')
      } catch (error) {
        if (error instanceof WorkspaceOperationError && error.code === 'not-found') {
          throw conditionalRemoveConflict(normalized, 'disappeared')
        }
        throw error
      }
      if (entry.kind !== 'file') {
        throw new WorkspaceOperationError({
          code: 'not-a-file',
          operation: 'remove',
          path: normalized,
          message: `Workspace entry "${normalized}" is not a file.`
        })
      }
      const snapshot = await this.snapshotFile(normalized, entry.handle as FileSystemFileHandle)
      if (!equalHash(snapshot.hash, expectedHash)) {
        throw conditionalRemoveConflict(normalized, 'changed')
      }
      let current: ResolvedEntry
      try {
        current = await this.resolveEntry(normalized, 'remove')
      } catch (error) {
        if (error instanceof WorkspaceOperationError && error.code === 'not-found') {
          throw conditionalRemoveConflict(normalized, 'disappeared')
        }
        throw error
      }
      if (current.kind !== 'file' || !(await handlesReferToSameEntry(entry, current))) {
        throw conditionalRemoveConflict(normalized, 'changed')
      }
      const finalSnapshot = await this.snapshotFile(
        normalized,
        current.handle as FileSystemFileHandle
      )
      if (!equalHash(finalSnapshot.hash, expectedHash)) {
        throw conditionalRemoveConflict(normalized, 'changed')
      }
      let finalEntry: ResolvedEntry
      try {
        finalEntry = await this.resolveEntry(normalized, 'remove')
      } catch (error) {
        if (error instanceof WorkspaceOperationError && error.code === 'not-found') {
          throw conditionalRemoveConflict(normalized, 'disappeared')
        }
        throw error
      }
      if (finalEntry.kind !== 'file' || !(await handlesReferToSameEntry(current, finalEntry))) {
        throw conditionalRemoveConflict(normalized, 'changed')
      }
      // File System Access exposes no atomic compare-and-delete operation.
      // These final identity/hash checks are inside the adapter queue used by
      // cooperating app operations; an arbitrary OS writer can still race the
      // final removeEntry browser call.
      await finalEntry.parent.removeEntry(finalEntry.name)
    })
  }

  async removeEmptyFolder(path: string): Promise<RemoveEmptyFolderResult> {
    const normalized = normalizeWorkspacePath(path)
    return await this.queue.run(async () => {
      await this.ensurePermission('remove', normalized, true)
      const entry = await this.resolveEntry(normalized, 'remove')
      if (entry.kind !== 'directory') {
        throw new WorkspaceOperationError({
          code: 'not-a-directory',
          operation: 'remove',
          path: normalized,
          message: `Workspace entry "${normalized}" is not a directory.`
        })
      }
      try {
        // Omitting `recursive` is the File System Access API's atomic
        // remove-if-empty operation. A concurrent child makes this fail.
        await entry.parent.removeEntry(entry.name)
        return 'removed'
      } catch (error) {
        if (errorName(error) === 'InvalidModificationError') return 'not-empty'
        throw asWorkspaceOperationError(error, 'remove', normalized)
      }
    })
  }

  async createFolder(path: string): Promise<void> {
    const normalized = normalizeWorkspacePath(path)
    await this.queue.run(async () => {
      await this.ensurePermission('create-folder', normalized, true)
      await this.createDirectoryTree(normalized, 'create-folder')
    })
  }

  async createFolderIfMissing(path: string): Promise<CreateFolderIfMissingResult> {
    const normalized = normalizeWorkspacePath(path)
    return await this.queue.run(async () => {
      await this.ensurePermission('create-folder', normalized, true)
      const parentPath = workspaceParentPath(normalized)
      const parent = await this.resolveDirectory(parentPath, false, 'create-folder')
      const name = workspacePathName(normalized)
      const existing = await this.probeEntry(parent, name)
      if (existing?.kind === 'file') throw alreadyExists('create-folder', normalized)
      if (existing) return 'existing'
      try {
        // File System Access has no exclusive mkdir. This final probe/create is
        // serialized for cooperating app operations, but an arbitrary OS
        // writer can still race the browser call.
        await parent.getDirectoryHandle(name, { create: true })
        return 'created'
      } catch (error) {
        throw asWorkspaceOperationError(error, 'create-folder', normalized)
      }
    })
  }

  exportBackup(options?: BackupExportOptions): Promise<Blob> {
    return this.queue.run(() => this.backupExporter(this, options))
  }

  private async walkDirectory(
    directory: FileSystemDirectoryHandle,
    parentPath: string,
    output: WorkspaceEntry[],
    isRoot: boolean,
    signal: AbortSignal | undefined,
    maxEntries: number | undefined,
    maxDepth: number | undefined,
    parentDepth: number
  ): Promise<void> {
    signal?.throwIfAborted()
    let children: Array<[string, FileSystemFileHandle | FileSystemDirectoryHandle]>
    try {
      children = []
      for await (const child of directory.entries()) {
        signal?.throwIfAborted()
        if (maxEntries !== undefined && output.length + children.length >= maxEntries) {
          throw new WorkspaceListLimitError(
            parentPath || undefined,
            'entries',
            maxEntries,
            output.length + children.length + 1
          )
        }
        children.push(child)
      }
    } catch (error) {
      if (
        signal?.aborted ||
        errorName(error) === 'AbortError' ||
        error instanceof WorkspaceListLimitError
      ) {
        throw error
      }
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
      signal?.throwIfAborted()
      const path = parentPath ? `${parentPath}/${name}` : name
      const depth = parentDepth + 1
      if (maxDepth !== undefined && depth > maxDepth) {
        throw new WorkspaceListLimitError(path, 'depth', maxDepth, depth)
      }
      if (maxEntries !== undefined && output.length >= maxEntries) {
        throw new WorkspaceListLimitError(path, 'entries', maxEntries, output.length + 1)
      }
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
          await this.walkDirectory(
            handle as FileSystemDirectoryHandle,
            path,
            output,
            false,
            signal,
            maxEntries,
            maxDepth,
            depth
          )
        } catch (error) {
          if (
            signal?.aborted ||
            errorName(error) === 'AbortError' ||
            error instanceof WorkspaceListLimitError
          ) {
            throw error
          }
          entry.readable = false
          entry.issue = workspaceFailure(error, 'list', path)
        }
        continue
      }

      try {
        const file = await (handle as FileSystemFileHandle).getFile()
        signal?.throwIfAborted()
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
        if (signal?.aborted || errorName(error) === 'AbortError') throw error
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
    const sameEntry = existing ? await handlesReferToSameEntry(source, existing) : false
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

    let copiedDestination: ResolvedEntry | undefined
    let copiedDestinationFingerprint: string | undefined
    try {
      const copiedHandle = await this.copyEntry(source.handle, destinationParent, destinationName)
      const expectedDestination: ResolvedEntry = {
        name: destinationName,
        parent: destinationParent,
        handle: copiedHandle,
        kind: copiedHandle.kind
      }
      const observedDestination = await this.probeEntry(destinationParent, destinationName)
      if (
        !observedDestination ||
        !(await handlesReferToSameEntry(expectedDestination, observedDestination))
      ) {
        throw new WorkspaceOperationError({
          code: 'integrity-failure',
          operation,
          path: destinationPath,
          message: `Workspace relocation destination identity changed for "${destinationPath}".`
        })
      }
      copiedDestination = expectedDestination
      copiedDestinationFingerprint = await this.fingerprint(observedDestination.handle)
      if (copiedDestinationFingerprint !== beforeFingerprint) {
        throw new WorkspaceOperationError({
          code: 'integrity-failure',
          operation,
          path: destinationPath,
          message: `Workspace relocation verification failed for "${destinationPath}".`
        })
      }
      const sourceAfterCopy = await this.resolveEntry(sourcePath, operation)
      if (!(await handlesReferToSameEntry(source, sourceAfterCopy))) {
        throw new WorkspaceOperationError({
          code: 'integrity-failure',
          operation,
          path: sourcePath,
          message: `Workspace entry "${sourcePath}" changed identity while it was being relocated.`
        })
      }
      const afterFingerprint = await this.fingerprint(sourceAfterCopy.handle)
      if (beforeFingerprint !== afterFingerprint) {
        throw new WorkspaceOperationError({
          code: 'integrity-failure',
          operation,
          path: sourcePath,
          message: `Workspace entry "${sourcePath}" changed while it was being relocated.`
        })
      }
      const finalSource = await this.resolveEntry(sourcePath, operation)
      if (!(await handlesReferToSameEntry(sourceAfterCopy, finalSource))) {
        throw new WorkspaceOperationError({
          code: 'integrity-failure',
          operation,
          path: sourcePath,
          message: `Workspace entry "${sourcePath}" changed before relocation removal.`
        })
      }
      const finalDestination = await this.probeEntry(destinationParent, destinationName)
      if (
        !copiedDestination ||
        !finalDestination ||
        !(await handlesReferToSameEntry(copiedDestination, finalDestination)) ||
        (await this.fingerprint(finalDestination.handle)) !== beforeFingerprint
      ) {
        throw new WorkspaceOperationError({
          code: 'integrity-failure',
          operation,
          path: destinationPath,
          message: `Workspace relocation destination changed before source removal for "${destinationPath}".`
        })
      }
      // Both entries have now passed the last checks available to the browser.
      // File System Access cannot make this cross-entry gate and removeEntry a
      // single filesystem transaction; an arbitrary OS writer can still race
      // the final call.
      await finalSource.parent.removeEntry(finalSource.name, {
        recursive: source.kind === 'directory'
      })
    } catch (error) {
      // Some handle implementations can commit removeEntry and then reject.
      // Only clean the copied destination when the original source entry is
      // still present. An absent/unprovable source means the destination may be
      // the sole verified copy and must be retained as recovery evidence.
      let sourceStillVerified = false
      try {
        const currentSource = await this.probeEntry(source.parent, source.name)
        sourceStillVerified = Boolean(
          currentSource &&
          (await handlesReferToSameEntry(source, currentSource)) &&
          (await this.fingerprint(currentSource.handle)) === beforeFingerprint
        )
      } catch {
        sourceStillVerified = false
      }
      if (sourceStillVerified && copiedDestination) {
        await this.removeVerifiedEntry(
          destinationParent,
          destinationName,
          copiedDestination,
          source.kind === 'directory',
          beforeFingerprint
        )
      }
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
    let stagedCopy: ResolvedEntry | undefined
    let stagedFingerprint: string | undefined
    let copiedDestination: ResolvedEntry | undefined
    let copiedDestinationFingerprint: string | undefined
    try {
      const stagedHandle = await this.copyEntry(source.handle, source.parent, tempName)
      const expectedStaging: ResolvedEntry = {
        name: tempName,
        parent: source.parent,
        handle: stagedHandle,
        kind: stagedHandle.kind
      }
      const observedStaging = await this.probeEntry(source.parent, tempName)
      if (!observedStaging || !(await handlesReferToSameEntry(expectedStaging, observedStaging))) {
        throw new WorkspaceOperationError({
          code: 'integrity-failure',
          operation,
          path: tempName,
          message: `Workspace relocation staging identity changed for "${sourcePath}".`
        })
      }
      stagedCopy = expectedStaging
      stagedFingerprint = await this.fingerprint(observedStaging.handle)
      if (stagedFingerprint !== beforeFingerprint) {
        throw new WorkspaceOperationError({
          code: 'integrity-failure',
          operation,
          path: tempName,
          message: `Workspace relocation staging verification failed for "${sourcePath}".`
        })
      }
      const afterFingerprint = await this.fingerprint(source.handle)
      if (afterFingerprint !== beforeFingerprint) {
        throw new WorkspaceOperationError({
          code: 'integrity-failure',
          operation,
          path: sourcePath,
          message: `Workspace entry "${sourcePath}" changed while it was being renamed.`
        })
      }
      const sourceBeforeRemove = await this.resolveEntry(sourcePath, operation)
      if (!(await handlesReferToSameEntry(source, sourceBeforeRemove))) {
        throw new WorkspaceOperationError({
          code: 'integrity-failure',
          operation,
          path: sourcePath,
          message: `Workspace entry "${sourcePath}" changed before rename removal.`
        })
      }
      await sourceBeforeRemove.parent.removeEntry(sourceBeforeRemove.name, {
        recursive: source.kind === 'directory'
      })
      sourceRemoved = true
      const staged = await this.probeEntry(source.parent, tempName)
      if (!staged) throw notFound(operation, tempName)
      if (
        !stagedCopy ||
        !(await handlesReferToSameEntry(stagedCopy, staged)) ||
        (await this.fingerprint(staged.handle)) !== beforeFingerprint
      ) {
        throw new WorkspaceOperationError({
          code: 'integrity-failure',
          operation,
          path: tempName,
          message: `Workspace relocation staging changed before final copy for "${sourcePath}".`
        })
      }
      const destinationHandle = await this.copyEntry(
        staged.handle,
        destinationParent,
        destinationName
      )
      const expectedDestination: ResolvedEntry = {
        name: destinationName,
        parent: destinationParent,
        handle: destinationHandle,
        kind: destinationHandle.kind
      }
      const observedDestination = await this.probeEntry(destinationParent, destinationName)
      if (
        !observedDestination ||
        !(await handlesReferToSameEntry(expectedDestination, observedDestination))
      ) {
        throw new WorkspaceOperationError({
          code: 'integrity-failure',
          operation,
          path: destinationPath,
          message: `Workspace relocation destination identity changed for "${destinationPath}".`
        })
      }
      copiedDestination = expectedDestination
      copiedDestinationFingerprint = await this.fingerprint(observedDestination.handle)
      if (copiedDestinationFingerprint !== beforeFingerprint) {
        throw new WorkspaceOperationError({
          code: 'integrity-failure',
          operation,
          path: destinationPath,
          message: `Workspace relocation verification failed for "${destinationPath}".`
        })
      }
      const finalStaging = await this.probeEntry(source.parent, tempName)
      if (
        !stagedCopy ||
        !finalStaging ||
        !(await handlesReferToSameEntry(stagedCopy, finalStaging)) ||
        (await this.fingerprint(finalStaging.handle)) !== beforeFingerprint
      ) {
        throw new WorkspaceOperationError({
          code: 'integrity-failure',
          operation,
          path: tempName,
          message: `Workspace relocation staging changed before final removal for "${sourcePath}".`
        })
      }
      const finalDestination = await this.probeEntry(destinationParent, destinationName)
      if (
        !copiedDestination ||
        !finalDestination ||
        !(await handlesReferToSameEntry(copiedDestination, finalDestination)) ||
        (await this.fingerprint(finalDestination.handle)) !== beforeFingerprint
      ) {
        throw new WorkspaceOperationError({
          code: 'integrity-failure',
          operation,
          path: destinationPath,
          message: `Workspace relocation destination changed before staging removal for "${destinationPath}".`
        })
      }
      // The two verified entries cannot be removed conditionally as one native
      // filesystem transaction. Cooperating operations are queued/leased; an
      // arbitrary OS writer can still race this final browser call.
      await finalStaging.parent.removeEntry(finalStaging.name, {
        recursive: source.kind === 'directory'
      })
    } catch (error) {
      if (sourceRemoved) {
        let staged: ResolvedEntry | undefined
        try {
          staged = await this.probeEntry(source.parent, tempName)
        } catch {
          staged = undefined
        }
        const stagedIsVerified = Boolean(
          staged &&
          stagedCopy &&
          (await handlesReferToSameEntry(stagedCopy, staged)) &&
          (await this.fingerprint(staged.handle)) === beforeFingerprint
        )
        if (staged && stagedIsVerified) {
          let destinationAllowsRestore = true
          if (copiedDestination) {
            destinationAllowsRestore = await this.removeVerifiedEntry(
              destinationParent,
              destinationName,
              copiedDestination,
              source.kind === 'directory',
              beforeFingerprint
            )
          } else {
            try {
              destinationAllowsRestore = !(await this.probeEntry(
                destinationParent,
                destinationName
              ))
            } catch {
              destinationAllowsRestore = false
            }
          }
          if (destinationAllowsRestore)
            try {
              await this.copyEntry(staged.handle, source.parent, source.name)
              const restoredSource = await this.probeEntry(source.parent, source.name)
              if (
                !restoredSource ||
                (await this.fingerprint(restoredSource.handle)) !== beforeFingerprint
              ) {
                throw new WorkspaceOperationError({
                  code: 'integrity-failure',
                  operation,
                  path: sourcePath,
                  message: `Workspace relocation recovery verification failed for "${sourcePath}".`
                })
              }
              if (stagedCopy) {
                await this.removeVerifiedEntry(
                  source.parent,
                  tempName,
                  stagedCopy,
                  source.kind === 'directory',
                  beforeFingerprint
                )
              }
            } catch {
              // Keep the distinctive staging entry as the recovery copy when a
              // backing filesystem fails both the operation and its rollback.
            }
        }
      } else {
        // A source delete can commit and then reject. Only remove the verified
        // staging copy when the source name is still present; otherwise staging
        // is the sole recovery copy and must survive.
        let sourceStillVerified = false
        try {
          const currentSource = await this.probeEntry(source.parent, source.name)
          sourceStillVerified = Boolean(
            currentSource &&
            (await handlesReferToSameEntry(source, currentSource)) &&
            (await this.fingerprint(currentSource.handle)) === beforeFingerprint
          )
        } catch {
          sourceStillVerified = false
        }
        if (sourceStillVerified && stagedCopy) {
          await this.removeVerifiedEntry(
            source.parent,
            tempName,
            stagedCopy,
            source.kind === 'directory',
            beforeFingerprint
          )
        }
      }
      throw asWorkspaceOperationError(error, operation, destinationPath)
    }
  }

  private async removeVerifiedEntry(
    parent: FileSystemDirectoryHandle,
    name: string,
    expected: ResolvedEntry,
    recursive: boolean,
    expectedFingerprint?: string
  ): Promise<boolean> {
    if (expectedFingerprint === undefined) return false
    try {
      const current = await this.probeEntry(parent, name)
      if (
        !current ||
        current.kind !== expected.kind ||
        !(await handlesReferToSameEntry(expected, current))
      ) {
        return false
      }
      if (
        expectedFingerprint !== undefined &&
        (await this.fingerprint(current.handle)) !== expectedFingerprint
      ) {
        return false
      }
      // This is the final app-observable identity/content check. File System
      // Access still cannot make the subsequent removeEntry conditional
      // against an arbitrary OS writer.
      await parent.removeEntry(current.name, { recursive })
      return true
    } catch {
      // Cleanup is best-effort and fail-closed: ambiguity preserves the entry.
      return false
    }
  }

  private async copyEntry(
    source: FileSystemFileHandle | FileSystemDirectoryHandle,
    destinationParent: FileSystemDirectoryHandle,
    destinationName: string
  ): Promise<FileSystemFileHandle | FileSystemDirectoryHandle> {
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
        await this.removeVerifiedEntry(
          destinationParent,
          destinationName,
          {
            name: destinationName,
            parent: destinationParent,
            handle: target,
            kind: 'file'
          },
          false
        )
        throw error
      }
      return target
    }

    const target = await destinationParent.getDirectoryHandle(destinationName, {
      create: true
    })
    try {
      for await (const [name, child] of (source as FileSystemDirectoryHandle).entries()) {
        await this.copyEntry(child, target, name)
      }
    } catch (error) {
      await this.removeVerifiedEntry(
        destinationParent,
        destinationName,
        {
          name: destinationName,
          parent: destinationParent,
          handle: target,
          kind: 'directory'
        },
        true
      )
      throw error
    }
    return target
  }

  private async fingerprint(
    handle: FileSystemFileHandle | FileSystemDirectoryHandle
  ): Promise<string> {
    if (handle.kind === 'file') {
      const file = await (handle as FileSystemFileHandle).getFile()
      const bytes = new Uint8Array(await file.arrayBuffer())
      const hash = await sha256Hex(bytes)
      // Relocation compares a copied handle with its source. A successful copy
      // naturally receives a different modification time, so integrity is the
      // exact byte length/hash rather than mutable filesystem metadata.
      return `f:${file.size}:${hash}`
    }
    const parts: Array<readonly [string, string]> = []
    const children: Array<[string, FileSystemFileHandle | FileSystemDirectoryHandle]> = []
    for await (const child of (handle as FileSystemDirectoryHandle).entries()) {
      children.push(child)
    }
    // Exact UTF-16 ordering is a deterministic total order even for
    // case/diacritic variants that localeCompare may consider equivalent.
    children.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    for (const [name, child] of children) {
      parts.push([name, await this.fingerprint(child)])
    }
    // Hash canonical JSON tuples instead of delimiter-concatenating legal file
    // names. This prevents names containing ":" or "|" from aliasing a
    // different directory structure.
    return `d:${await sha256Hex(fingerprintEncoder.encode(JSON.stringify(parts)))}`
  }

  private async snapshotFile(
    path: string,
    handle: FileSystemFileHandle,
    options: ReadFileOptions = {}
  ): Promise<FileSnapshot> {
    const maxBytes = validatedReadLimit(path, options)
    const file = await handle.getFile()
    if (maxBytes !== undefined && file.size > maxBytes) {
      throw new WorkspaceReadLimitError(path, maxBytes, file.size)
    }
    options.signal?.throwIfAborted()
    const bytes = copyBytes(new Uint8Array(await file.arrayBuffer()))
    options.signal?.throwIfAborted()
    const hash = await sha256Hex(bytes)
    options.signal?.throwIfAborted()
    return {
      path,
      bytes,
      hash,
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

function validatedConditionalRemoveHash(expectedHash: string): string {
  if (!/^[a-f0-9]{64}$/iu.test(expectedHash)) {
    throw new TypeError('Conditional removal requires a SHA-256 digest.')
  }
  return expectedHash.toLowerCase()
}

function conditionalRemoveConflict(
  path: string,
  state: 'changed' | 'disappeared'
): WorkspaceOperationError {
  return new WorkspaceOperationError({
    code: 'integrity-failure',
    operation: 'remove',
    path,
    message: `Workspace file "${path}" ${state} before conditional removal.`
  })
}

async function handlesReferToSameEntry(
  source: ResolvedEntry,
  destination: ResolvedEntry
): Promise<boolean> {
  const isSameEntry = (
    source.handle as FileSystemHandle & {
      isSameEntry?: (other: FileSystemHandle) => Promise<boolean>
    }
  ).isSameEntry
  if (typeof isSameEntry === 'function') {
    return isSameEntry.call(source.handle, destination.handle)
  }
  // Case-folded names do not prove identity on a case-sensitive filesystem:
  // `Order.bpmn` and `order.bpmn` may be distinct files. A shared handle object
  // is the only safe fallback when the platform omits isSameEntry().
  return source.handle === destination.handle
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
