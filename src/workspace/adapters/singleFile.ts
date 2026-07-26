import { exportWorkspaceBackup } from './backup'
import { copyBytes, equalHash, sha256Hex } from './hash'
import { normalizeWorkspacePath, workspaceParentPath, workspacePathName } from './path'
import { SerialQueue } from './serialQueue'
import type {
  BackupExportOptions,
  FileSnapshot,
  SaveOutcome,
  WorkspaceAdapter,
  WorkspaceBackupExporter,
  WorkspaceEntry,
  WorkspaceStorageInfo,
  WriteAtomicOptions
} from './types'
import { WorkspaceOperationError, notFound, unsupported, workspaceFailure } from './workspaceError'

export interface SingleFileDownloadRequest {
  path: string
  bytes: Uint8Array
  blob: Blob
}

export type SingleFileDownload = (request: SingleFileDownloadRequest) => void | Promise<void>

export interface SingleFileWorkspaceAdapterOptions {
  workspaceId?: string
  path: string
  bytes: Uint8Array
  modifiedAt?: number
  mimeType?: string
  /**
   * Present when opened through showOpenFilePicker. Input[type=file] sources do
   * not provide a writable handle and therefore use the explicit download sink.
   */
  writableHandle?: FileSystemFileHandle
  download?: SingleFileDownload
  backupExporter?: WorkspaceBackupExporter
  now?: () => number
}

interface SingleFileRecord {
  path: string
  bytes: Uint8Array
  modifiedAt: number
  mimeType: string
}

type WritableWithAbort = FileSystemWritableFileStream & {
  abort?: (reason?: unknown) => Promise<void>
}

/**
 * Minimal, explicit open/download workflow. It never claims an in-memory edit
 * was saved: success requires either an atomic writable-handle close or a
 * completed download dispatch.
 */
export class SingleFileWorkspaceAdapter implements WorkspaceAdapter {
  readonly id: string
  readonly mode = 'single-file' as const

  private record: SingleFileRecord
  private writableHandle?: FileSystemFileHandle
  private readonly download: SingleFileDownload
  private readonly backupExporter: WorkspaceBackupExporter
  private readonly now: () => number
  private readonly queue = new SerialQueue()

  constructor(options: SingleFileWorkspaceAdapterOptions) {
    const path = normalizeSingleFilePath(options.path)
    this.id = options.workspaceId ?? `single-file:${path}`
    this.record = {
      path,
      bytes: copyBytes(options.bytes),
      modifiedAt: options.modifiedAt ?? Date.now(),
      mimeType: options.mimeType ?? inferMimeType(path)
    }
    this.writableHandle = options.writableHandle
    this.download = options.download ?? browserDownload
    this.backupExporter = options.backupExporter ?? exportWorkspaceBackup
    this.now = options.now ?? (() => Date.now())
  }

  get storage(): WorkspaceStorageInfo {
    const directWrite = Boolean(this.writableHandle)
    return {
      persistence: directWrite ? 'external-file' : 'download',
      portable: true,
      description: directWrite
        ? 'Changes are written to the explicitly opened file.'
        : 'Each save downloads a new file; choose where the browser stores it.',
      capabilities: {
        multipleFiles: false,
        directories: false,
        rename: true,
        move: false,
        remove: false,
        backup: true
      }
    }
  }

  static async fromFile(
    file: File,
    options: Omit<SingleFileWorkspaceAdapterOptions, 'path' | 'bytes'> = {}
  ): Promise<SingleFileWorkspaceAdapter> {
    return new SingleFileWorkspaceAdapter({
      ...options,
      path: file.name,
      bytes: new Uint8Array(await file.arrayBuffer()),
      modifiedAt: file.lastModified,
      mimeType: file.type || inferMimeType(file.name)
    })
  }

  static async fromHandle(
    handle: FileSystemFileHandle,
    options: Omit<
      SingleFileWorkspaceAdapterOptions,
      'path' | 'bytes' | 'modifiedAt' | 'mimeType' | 'writableHandle'
    > = {}
  ): Promise<SingleFileWorkspaceAdapter> {
    const file = await handle.getFile()
    return new SingleFileWorkspaceAdapter({
      ...options,
      path: file.name || handle.name,
      bytes: new Uint8Array(await file.arrayBuffer()),
      modifiedAt: file.lastModified,
      mimeType: file.type || inferMimeType(file.name || handle.name),
      writableHandle: handle
    })
  }

  async list(path = ''): Promise<WorkspaceEntry[]> {
    const normalized = normalizeWorkspacePath(path, { allowRoot: true })
    if (normalized) {
      throw new WorkspaceOperationError({
        code: 'not-a-directory',
        operation: 'list',
        path: normalized,
        message: 'Single-file mode has no folders.'
      })
    }
    const snapshot = await this.currentSnapshot()
    return [
      {
        path: snapshot.path,
        name: workspacePathName(snapshot.path),
        parentPath: '',
        kind: 'file',
        size: snapshot.size,
        modifiedAt: snapshot.modifiedAt,
        mimeType: snapshot.mimeType,
        readable: true
      }
    ]
  }

  async read(path: string): Promise<FileSnapshot> {
    const normalized = normalizeSingleFilePath(path)
    if (normalized !== this.record.path) throw notFound('read', normalized)
    return this.currentSnapshot()
  }

  async writeAtomic(
    path: string,
    bytes: Uint8Array,
    expectedHash?: string,
    options: WriteAtomicOptions = {}
  ): Promise<SaveOutcome> {
    const normalized = normalizeSingleFilePath(path)
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
      if (normalized !== this.record.path) {
        return this.failureOutcome(notFound('write', normalized), normalized)
      }
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

      try {
        const actual = await this.currentSnapshot()
        if (expectedHash !== undefined && !equalHash(actual.hash, expectedHash)) {
          return {
            ok: false,
            status: 'external-conflict',
            reason: 'hash-mismatch',
            expectedHash,
            actual
          }
        }
        if (options.expectedMissing) {
          return {
            ok: false,
            status: 'external-conflict',
            reason: 'already-exists',
            actual
          }
        }
        if (options.signal?.aborted) return this.cancelledOutcome(normalized)

        let disposition: 'workspace' | 'download'
        let committedSnapshot: FileSnapshot | undefined
        if (this.writableHandle) {
          await this.ensureHandlePermission()
          const writable = (await this.writableHandle.createWritable({
            keepExistingData: false
          })) as WritableWithAbort
          try {
            await writable.write(ownedBytes)
            if (options.signal?.aborted) {
              await abortWritable(writable)
              return this.cancelledOutcome(normalized)
            }
            await writable.close()
          } catch (error) {
            await abortWritable(writable)
            throw error
          }
          disposition = 'workspace'
          try {
            committedSnapshot = await this.snapshotFromHandle(this.writableHandle)
          } catch {
            // close() already confirmed persistence; use the exact input bytes.
          }
        } else {
          const blobBytes = copyBytes(ownedBytes)
          await this.download({
            path: normalized,
            bytes: copyBytes(ownedBytes),
            blob: new Blob([blobBytes], {
              type: this.record.mimeType
            })
          })
          disposition = 'download'
        }

        if (committedSnapshot && !equalHash(committedSnapshot.hash, incomingHash)) {
          throw new WorkspaceOperationError({
            code: 'integrity-failure',
            operation: 'write',
            path: normalized,
            message: `Single-file write verification failed for "${normalized}".`
          })
        }
        const modifiedAt = committedSnapshot?.modifiedAt ?? this.now()
        this.record = {
          path: normalized,
          bytes: copyBytes(ownedBytes),
          modifiedAt,
          mimeType: committedSnapshot?.mimeType ?? this.record.mimeType
        }

        return {
          ok: true,
          status: 'success',
          snapshot: {
            path: normalized,
            bytes: copyBytes(ownedBytes),
            hash: incomingHash,
            size: ownedBytes.byteLength,
            modifiedAt,
            mimeType: this.record.mimeType
          },
          created: false,
          previousHash: actual.hash,
          disposition
        }
      } catch (error) {
        return this.failureOutcome(error, normalized)
      }
    })
  }

  async rename(from: string, to: string): Promise<void> {
    const source = normalizeSingleFilePath(from)
    const destination = normalizeSingleFilePath(to)
    await this.queue.run(async () => {
      if (source !== this.record.path) throw notFound('rename', source)
      this.record = { ...this.record, path: destination }
      // File handles cannot portably rename. Continue truthfully in download
      // mode using the new suggested filename.
      if (source !== destination) this.writableHandle = undefined
    })
  }

  async move(from: string, to: string): Promise<void> {
    const source = normalizeSingleFilePath(from)
    const destination = normalizeSingleFilePath(to)
    if (workspaceParentPath(destination)) {
      throw unsupported(
        'move',
        destination,
        'Single-file mode cannot move a document into a folder.'
      )
    }
    await this.rename(source, destination)
  }

  async remove(path: string): Promise<void> {
    const normalized = normalizeSingleFilePath(path)
    if (normalized !== this.record.path) throw notFound('remove', normalized)
    throw unsupported(
      'remove',
      normalized,
      'Single-file mode cannot delete the source file. Delete it with the operating system.'
    )
  }

  async createFolder(path: string): Promise<void> {
    const normalized = normalizeWorkspacePath(path, { allowRoot: true })
    if (!normalized) return
    throw unsupported('create-folder', normalized, 'Single-file mode does not support folders.')
  }

  exportBackup(options?: BackupExportOptions): Promise<Blob> {
    return this.queue.run(() => this.backupExporter(this, options))
  }

  private async currentSnapshot(): Promise<FileSnapshot> {
    if (this.writableHandle) {
      const snapshot = await this.snapshotFromHandle(this.writableHandle)
      this.record = {
        path: this.record.path,
        bytes: copyBytes(snapshot.bytes),
        modifiedAt: snapshot.modifiedAt,
        mimeType: snapshot.mimeType ?? this.record.mimeType
      }
      return { ...snapshot, path: this.record.path }
    }
    const bytes = copyBytes(this.record.bytes)
    return {
      path: this.record.path,
      bytes,
      hash: await sha256Hex(bytes),
      size: bytes.byteLength,
      modifiedAt: this.record.modifiedAt,
      mimeType: this.record.mimeType
    }
  }

  private async snapshotFromHandle(handle: FileSystemFileHandle): Promise<FileSnapshot> {
    const file = await handle.getFile()
    const bytes = copyBytes(new Uint8Array(await file.arrayBuffer()))
    return {
      path: this.record.path,
      bytes,
      hash: await sha256Hex(bytes),
      size: bytes.byteLength,
      modifiedAt: file.lastModified,
      mimeType: file.type || this.record.mimeType
    }
  }

  private async ensureHandlePermission(): Promise<void> {
    if (typeof this.writableHandle?.queryPermission !== 'function') return
    const state = await this.writableHandle.queryPermission({ mode: 'readwrite' })
    if (state === 'granted') return
    throw new WorkspaceOperationError({
      code: 'permission-loss',
      operation: 'write',
      path: this.record.path,
      message:
        state === 'prompt'
          ? 'File permission must be reconnected from a user gesture.'
          : 'File permission is no longer granted.'
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
        message: 'Single-file save was cancelled.',
        name: 'AbortError'
      }
    }
  }
}

function normalizeSingleFilePath(path: string): string {
  const normalized = normalizeWorkspacePath(path)
  if (workspaceParentPath(normalized)) {
    throw new WorkspaceOperationError({
      code: 'invalid-path',
      operation: 'open',
      path: normalized,
      message: 'Single-file mode accepts only a root-level filename.'
    })
  }
  return normalized
}

async function browserDownload(request: SingleFileDownloadRequest): Promise<void> {
  if (
    typeof document === 'undefined' ||
    typeof URL === 'undefined' ||
    typeof URL.createObjectURL !== 'function'
  ) {
    throw unsupported(
      'write',
      request.path,
      'No browser download surface is available. Provide an explicit download sink.'
    )
  }
  const url = URL.createObjectURL(request.blob)
  try {
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = workspacePathName(request.path)
    anchor.style.display = 'none'
    document.body.append(anchor)
    anchor.click()
    anchor.remove()
  } finally {
    URL.revokeObjectURL(url)
  }
}

async function abortWritable(writable: WritableWithAbort): Promise<void> {
  try {
    if (typeof writable.abort === 'function') await writable.abort()
  } catch {
    // Best effort. The original write error remains authoritative.
  }
}

function inferMimeType(path: string): string {
  if (/\.bpmn$/i.test(path) || /\.xml$/i.test(path)) return 'application/xml'
  return 'application/octet-stream'
}
