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
  SaveOutcome,
  RemoveEmptyFolderResult,
  WorkspaceAdapter,
  WorkspaceBackupExporter,
  WorkspaceEntry,
  WorkspaceStorageInfo,
  WriteAtomicOptions
} from './types'
import {
  WorkspaceOperationError,
  WorkspaceListLimitError,
  WorkspaceReadLimitError,
  alreadyExists,
  notFound,
  validatedListLimits,
  validatedReadLimit,
  workspaceFailure
} from './workspaceError'

interface MemoryDirectory {
  kind: 'directory'
  modifiedAt: number
}

interface MemoryFile {
  kind: 'file'
  bytes: Uint8Array
  modifiedAt: number
  mimeType?: string
}

type MemoryNode = MemoryDirectory | MemoryFile

export interface MemoryWorkspaceSeedFile {
  path: string
  bytes: Uint8Array | string
  modifiedAt?: number
  mimeType?: string
}

export interface MemoryWorkspaceAdapterOptions {
  id?: string
  folders?: string[]
  files?: MemoryWorkspaceSeedFile[] | Record<string, Uint8Array | string>
  now?: () => number
  backupExporter?: WorkspaceBackupExporter
  beforeWrite?: (path: string, bytes: Uint8Array) => void | Promise<void>
  /** Test hook invoked inside the local queue at conditional-delete entry. */
  beforeRemoveIfHash?: (path: string, expectedHash: string) => void | Promise<void>
  /** Test hook invoked inside the local queue at remove-if-empty entry. */
  beforeRemoveEmptyFolder?: (path: string) => void | Promise<void>
}

/**
 * A complete in-memory implementation used by unit tests and non-persistent
 * previews. It deliberately has the same compare-and-set and path rules as the
 * browser-backed adapters rather than being a permissive mock.
 */
export class MemoryWorkspaceAdapter implements WorkspaceAdapter {
  readonly id: string
  readonly mode = 'opfs' as const
  readonly storage: WorkspaceStorageInfo = {
    persistence: 'memory',
    portable: false,
    description: 'In-memory workspace; data is discarded when this adapter is released.',
    capabilities: {
      multipleFiles: true,
      directories: true,
      rename: true,
      move: true,
      remove: true,
      backup: true
    }
  }

  private nodes = new Map<string, MemoryNode>()
  private version = 0
  private permission: 'granted' | 'denied' = 'granted'
  private readonly queue = new SerialQueue()
  private readonly now: () => number
  private readonly backupExporter: WorkspaceBackupExporter
  private readonly beforeWrite?: (path: string, bytes: Uint8Array) => void | Promise<void>
  private readonly beforeRemoveIfHash?: (path: string, expectedHash: string) => void | Promise<void>
  private readonly beforeRemoveEmptyFolder?: (path: string) => void | Promise<void>

  constructor(options: MemoryWorkspaceAdapterOptions = {}) {
    this.id = options.id ?? 'memory-workspace'
    this.now = options.now ?? (() => Date.now())
    this.backupExporter = options.backupExporter ?? exportWorkspaceBackup
    this.beforeWrite = options.beforeWrite
    this.beforeRemoveIfHash = options.beforeRemoveIfHash
    this.beforeRemoveEmptyFolder = options.beforeRemoveEmptyFolder

    for (const folder of options.folders ?? []) this.createFolderSync(folder)
    if (Array.isArray(options.files)) {
      for (const file of options.files) {
        this.seedFile(
          file.path,
          typeof file.bytes === 'string' ? new TextEncoder().encode(file.bytes) : file.bytes,
          file.modifiedAt,
          file.mimeType
        )
      }
    } else {
      for (const [path, bytes] of Object.entries(options.files ?? {})) {
        this.seedFile(path, typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes)
      }
    }
  }

  /** Test/recovery hook that models browser permission revocation. */
  setPermission(permission: 'granted' | 'denied'): void {
    this.permission = permission
  }

  /**
   * Model a write made by another browser tab/process. This bypasses the local
   * operation queue so expected-hash conflict tests exercise the real boundary.
   */
  replaceExternally(path: string, bytes: Uint8Array | string): void {
    this.ensurePermission('write', path)
    this.seedFile(
      path,
      typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes,
      this.now()
    )
    this.version += 1
  }

  removeExternally(path: string): void {
    const normalized = normalizeWorkspacePath(path)
    for (const key of [...this.nodes.keys()]) {
      if (key === normalized || key.startsWith(`${normalized}/`)) this.nodes.delete(key)
    }
    this.version += 1
  }

  async list(path = '', options: ListWorkspaceOptions = {}): Promise<WorkspaceEntry[]> {
    const limits = validatedListLimits(options)
    const root = normalizeWorkspacePath(path, { allowRoot: true })
    this.ensurePermission('list', root || undefined)
    if (root) {
      const node = this.nodes.get(root)
      if (!node) throw notFound('list', root)
      if (node.kind !== 'directory') {
        throw new WorkspaceOperationError({
          code: 'not-a-directory',
          operation: 'list',
          path: root,
          message: `Workspace entry "${root}" is not a directory.`
        })
      }
    }

    const prefix = root ? `${root}/` : ''
    const rootDepth = root ? root.split('/').length : 0
    const entries: WorkspaceEntry[] = []
    for (const [entryPath, node] of this.nodes) {
      options.signal?.throwIfAborted()
      if (!entryPath.startsWith(prefix) || entryPath === root) continue
      const depth = entryPath.split('/').length - rootDepth
      if (limits.maxDepth !== undefined && depth > limits.maxDepth) {
        throw new WorkspaceListLimitError(entryPath, 'depth', limits.maxDepth, depth)
      }
      if (limits.maxEntries !== undefined && entries.length >= limits.maxEntries) {
        throw new WorkspaceListLimitError(
          entryPath,
          'entries',
          limits.maxEntries,
          entries.length + 1
        )
      }
      entries.push({
        path: entryPath,
        name: workspacePathName(entryPath),
        parentPath: workspaceParentPath(entryPath),
        kind: node.kind,
        size: node.kind === 'file' ? node.bytes.byteLength : undefined,
        modifiedAt: node.modifiedAt,
        mimeType: node.kind === 'file' ? node.mimeType : undefined,
        readable: true
      })
    }
    entries.sort(compareEntries)
    options.signal?.throwIfAborted()
    return entries
  }

  async read(path: string, options: ReadFileOptions = {}): Promise<FileSnapshot> {
    const normalized = normalizeWorkspacePath(path)
    const maxBytes = validatedReadLimit(normalized, options)
    this.ensurePermission('read', normalized)
    const node = this.nodes.get(normalized)
    if (!node) throw notFound('read', normalized)
    if (node.kind !== 'file') {
      throw new WorkspaceOperationError({
        code: 'not-a-file',
        operation: 'read',
        path: normalized,
        message: `Workspace entry "${normalized}" is not a file.`
      })
    }
    if (maxBytes !== undefined && node.bytes.byteLength > maxBytes) {
      throw new WorkspaceReadLimitError(normalized, maxBytes, node.bytes.byteLength)
    }
    options.signal?.throwIfAborted()
    const snapshot = await this.snapshot(normalized, node)
    options.signal?.throwIfAborted()
    return snapshot
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

      try {
        this.ensurePermission('write', normalized)
        await this.beforeWrite?.(normalized, copyBytes(ownedBytes))
        if (options.signal?.aborted) return this.cancelledOutcome(normalized)

        // Hashing yields to the event loop. Retry the observation if the
        // external-write hook changed this record while its digest was running.
        let actual: FileSnapshot | undefined
        let observedVersion: number
        do {
          observedVersion = this.version
          const current = this.nodes.get(normalized)
          if (current?.kind === 'directory') {
            throw new WorkspaceOperationError({
              code: 'not-a-file',
              operation: 'write',
              path: normalized,
              message: `Workspace entry "${normalized}" is a directory.`
            })
          }
          actual = current ? await this.snapshot(normalized, current) : undefined
        } while (observedVersion !== this.version)

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

        this.createParentFoldersSync(normalized)
        const modifiedAt = this.now()
        this.nodes.set(normalized, {
          kind: 'file',
          bytes: copyBytes(ownedBytes),
          modifiedAt,
          mimeType: actual?.mimeType ?? inferMimeType(normalized)
        })
        this.version += 1

        return {
          ok: true,
          status: 'success',
          snapshot: {
            path: normalized,
            bytes: copyBytes(ownedBytes),
            hash: incomingHash,
            size: ownedBytes.byteLength,
            modifiedAt,
            mimeType: actual?.mimeType ?? inferMimeType(normalized)
          },
          created: !actual,
          previousHash: actual?.hash,
          disposition: 'workspace'
        }
      } catch (error) {
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
    await this.relocate(source, destination, 'rename')
  }

  async move(from: string, to: string): Promise<void> {
    await this.relocate(normalizeWorkspacePath(from), normalizeWorkspacePath(to), 'move')
  }

  async remove(path: string): Promise<void> {
    const normalized = normalizeWorkspacePath(path)
    await this.queue.run(async () => {
      this.ensurePermission('remove', normalized)
      if (!this.nodes.has(normalized)) throw notFound('remove', normalized)
      const next = new Map(this.nodes)
      for (const key of next.keys()) {
        if (key === normalized || key.startsWith(`${normalized}/`)) next.delete(key)
      }
      this.nodes = next
      this.version += 1
    })
  }

  async removeIfHash(path: string, expectedHashInput: string): Promise<void> {
    const normalized = normalizeWorkspacePath(path)
    const expectedHash = validatedExpectedHash(expectedHashInput)
    await this.queue.run(async () => {
      this.ensurePermission('remove', normalized)
      await this.beforeRemoveIfHash?.(normalized, expectedHash)
      const captured = this.nodes.get(normalized)
      if (!captured) {
        throw conditionalRemoveConflict(normalized, 'disappeared')
      }
      if (captured.kind !== 'file') {
        throw new WorkspaceOperationError({
          code: 'not-a-file',
          operation: 'remove',
          path: normalized,
          message: `Workspace entry "${normalized}" is not a file.`
        })
      }
      const actualHash = await sha256Hex(copyBytes(captured.bytes))
      // External test/recovery mutations intentionally bypass the local queue.
      // Object identity closes that asynchronous digest window, including ABA
      // rewrites with byte-identical content.
      if (this.nodes.get(normalized) !== captured || !equalHash(actualHash, expectedHash)) {
        throw conditionalRemoveConflict(normalized, 'changed')
      }
      const next = new Map(this.nodes)
      next.delete(normalized)
      this.nodes = next
      this.version += 1
    })
  }

  async removeEmptyFolder(path: string): Promise<RemoveEmptyFolderResult> {
    const normalized = normalizeWorkspacePath(path)
    return await this.queue.run(async () => {
      this.ensurePermission('remove', normalized)
      await this.beforeRemoveEmptyFolder?.(normalized)
      const node = this.nodes.get(normalized)
      if (!node) throw notFound('remove', normalized)
      if (node.kind !== 'directory') {
        throw new WorkspaceOperationError({
          code: 'not-a-directory',
          operation: 'remove',
          path: normalized,
          message: `Workspace entry "${normalized}" is not a directory.`
        })
      }
      const prefix = `${normalized}/`
      if ([...this.nodes.keys()].some((candidate) => candidate.startsWith(prefix))) {
        return 'not-empty'
      }
      const next = new Map(this.nodes)
      next.delete(normalized)
      this.nodes = next
      this.version += 1
      return 'removed'
    })
  }

  async createFolder(path: string): Promise<void> {
    const normalized = normalizeWorkspacePath(path)
    await this.queue.run(async () => {
      this.ensurePermission('create-folder', normalized)
      const next = new Map(this.nodes)
      const parts = normalized.split('/')
      let current = ''
      for (const part of parts) {
        current = current ? `${current}/${part}` : part
        const existing = next.get(current)
        if (existing?.kind === 'file') {
          throw alreadyExists('create-folder', current)
        }
        if (!existing) next.set(current, { kind: 'directory', modifiedAt: this.now() })
      }
      this.nodes = next
      this.version += 1
    })
  }

  async createFolderIfMissing(path: string): Promise<CreateFolderIfMissingResult> {
    const normalized = normalizeWorkspacePath(path)
    return await this.queue.run(async () => {
      this.ensurePermission('create-folder', normalized)
      const existing = this.nodes.get(normalized)
      if (existing?.kind === 'file') throw alreadyExists('create-folder', normalized)
      if (existing) return 'existing'

      const parent = workspaceParentPath(normalized)
      if (parent) {
        const parentNode = this.nodes.get(parent)
        if (!parentNode) throw notFound('create-folder', parent)
        if (parentNode.kind !== 'directory') {
          throw new WorkspaceOperationError({
            code: 'not-a-directory',
            operation: 'create-folder',
            path: parent,
            message: `Workspace entry "${parent}" is not a directory.`
          })
        }
      }
      const next = new Map(this.nodes)
      next.set(normalized, { kind: 'directory', modifiedAt: this.now() })
      this.nodes = next
      this.version += 1
      return 'created'
    })
  }

  exportBackup(options?: BackupExportOptions): Promise<Blob> {
    return this.queue.run(() => this.backupExporter(this, options))
  }

  private async relocate(
    source: string,
    destination: string,
    operation: 'rename' | 'move'
  ): Promise<void> {
    await this.queue.run(async () => {
      this.ensurePermission(operation, source)
      if (source === destination) return
      const sourceNode = this.nodes.get(source)
      if (!sourceNode) throw notFound(operation, source)
      if (sourceNode.kind === 'directory' && isPathWithin(destination, source)) {
        throw new WorkspaceOperationError({
          code: 'invalid-path',
          operation,
          path: destination,
          message: 'A folder cannot be moved into itself or one of its descendants.'
        })
      }
      const parent = workspaceParentPath(destination)
      if (parent) {
        const parentNode = this.nodes.get(parent)
        if (!parentNode) throw notFound(operation, parent)
        if (parentNode.kind !== 'directory') {
          throw new WorkspaceOperationError({
            code: 'not-a-directory',
            operation,
            path: parent,
            message: `Destination parent "${parent}" is not a directory.`
          })
        }
      }
      if (this.nodes.has(destination)) throw alreadyExists(operation, destination)

      const moving = [...this.nodes.entries()].filter(
        ([path]) => path === source || path.startsWith(`${source}/`)
      )
      const movingPaths = new Set(moving.map(([path]) => path))
      const remapped = moving.map(([path, node]) => {
        const suffix = path.slice(source.length)
        return [`${destination}${suffix}`, node] as const
      })
      for (const [path] of remapped) {
        if (this.nodes.has(path) && !movingPaths.has(path)) throw alreadyExists(operation, path)
      }

      const next = new Map(this.nodes)
      for (const [path] of moving) next.delete(path)
      for (const [path, node] of remapped) next.set(path, node)
      this.nodes = next
      this.version += 1
    })
  }

  private async snapshot(path: string, file: MemoryFile): Promise<FileSnapshot> {
    const bytes = copyBytes(file.bytes)
    return {
      path,
      bytes,
      hash: await sha256Hex(bytes),
      size: bytes.byteLength,
      modifiedAt: file.modifiedAt,
      mimeType: file.mimeType
    }
  }

  private ensurePermission(
    operation: 'list' | 'read' | 'write' | 'rename' | 'move' | 'remove' | 'create-folder',
    path?: string
  ): void {
    if (this.permission === 'granted') return
    throw new WorkspaceOperationError({
      code: 'permission-loss',
      operation,
      path,
      message: 'Workspace permission is no longer granted.'
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

  private seedFile(
    path: string,
    bytes: Uint8Array,
    modifiedAt = this.now(),
    mimeType = inferMimeType(path)
  ): void {
    const normalized = normalizeWorkspacePath(path)
    this.createParentFoldersSync(normalized)
    const existing = this.nodes.get(normalized)
    if (existing?.kind === 'directory') {
      throw new Error(`Cannot seed file "${normalized}" over a directory.`)
    }
    this.nodes.set(normalized, {
      kind: 'file',
      bytes: copyBytes(bytes),
      modifiedAt,
      mimeType
    })
  }

  private createFolderSync(path: string): void {
    const normalized = normalizeWorkspacePath(path)
    const parts = normalized.split('/')
    let current = ''
    for (const part of parts) {
      current = current ? `${current}/${part}` : part
      const existing = this.nodes.get(current)
      if (existing?.kind === 'file') {
        throw new Error(`Cannot seed directory "${current}" over a file.`)
      }
      if (!existing) this.nodes.set(current, { kind: 'directory', modifiedAt: this.now() })
    }
  }

  private createParentFoldersSync(filePath: string): void {
    const parent = workspaceParentPath(filePath)
    if (parent) this.createFolderSync(parent)
  }
}

function validatedExpectedHash(expectedHash: string): string {
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
