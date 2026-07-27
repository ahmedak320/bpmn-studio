import { HandleWorkspaceAdapter } from './handleAdapter'
import { normalizeWorkspacePath, workspaceParentPath } from './path'
import type { WorkspaceBackupExporter } from './types'
import { WorkspaceOperationError } from './workspaceError'

export interface OpfsStorageManager {
  getDirectory(): Promise<FileSystemDirectoryHandle>
  persisted?(): Promise<boolean>
  persist?(): Promise<boolean>
}

export interface OpfsWorkspaceAdapterOptions {
  workspaceId?: string
  /** One directory directly below the origin-private root. */
  directoryName?: string
  persisted?: boolean
  backupExporter?: WorkspaceBackupExporter
  now?: () => number
}

export interface OpenOpfsWorkspaceOptions extends OpfsWorkspaceAdapterOptions {
  storageManager?: OpfsStorageManager
  /**
   * Persistence requests are opt-in because browser policy may require them to
   * happen in response to a user action.
   */
  requestPersistence?: boolean
}

const PERSISTENCE_REQUEST_TIMEOUT_MS = 1_000

async function requestPersistenceWithin(
  storageManager: OpfsStorageManager,
  timeoutMs = PERSISTENCE_REQUEST_TIMEOUT_MS
): Promise<boolean> {
  if (!storageManager.persist) return false

  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      storageManager.persist(),
      new Promise<false>((resolve) => {
        timeout = setTimeout(() => resolve(false), timeoutMs)
      })
    ])
  } catch {
    return false
  } finally {
    if (timeout !== undefined) clearTimeout(timeout)
  }
}

/**
 * Persistent, multi-file browser workspace for Firefox/Safari and as an
 * alternative in Chromium. It uses the same recursive handle implementation as
 * directory mode, so folders, history, metadata, search inputs, and backups are
 * first-class files rather than virtual tabs.
 */
export class OpfsWorkspaceAdapter extends HandleWorkspaceAdapter {
  readonly persisted: boolean
  readonly directoryName: string

  constructor(root: FileSystemDirectoryHandle, options: OpfsWorkspaceAdapterOptions = {}) {
    const directoryName = options.directoryName ?? root.name ?? 'orbitpm'
    const persisted = options.persisted ?? false
    super('opfs', root, {
      id: options.workspaceId ?? `opfs:${directoryName}`,
      backupExporter: options.backupExporter,
      now: options.now,
      checkPermission: false,
      storage: {
        persistence: persisted ? 'origin-private-durable' : 'origin-private-best-effort',
        portable: false,
        description: persisted
          ? 'Files are stored privately by this browser with durable storage granted.'
          : 'Files are stored privately by this browser; export backups because the browser may evict storage.',
        capabilities: {
          multipleFiles: true,
          directories: true,
          rename: true,
          move: true,
          remove: true,
          backup: true
        }
      }
    })
    this.persisted = persisted
    this.directoryName = directoryName
  }

  static async open(options: OpenOpfsWorkspaceOptions = {}): Promise<OpfsWorkspaceAdapter> {
    const storageManager =
      options.storageManager ??
      (typeof navigator !== 'undefined' ? (navigator.storage as OpfsStorageManager) : undefined)
    if (!storageManager || typeof storageManager.getDirectory !== 'function') {
      throw new WorkspaceOperationError({
        code: 'unsupported',
        operation: 'open',
        message: 'Origin Private File System is not available in this browser.'
      })
    }

    const directoryName = normalizeWorkspacePath(options.directoryName ?? 'orbitpm')
    if (workspaceParentPath(directoryName)) {
      throw new WorkspaceOperationError({
        code: 'invalid-path',
        operation: 'open',
        path: directoryName,
        message: 'An OPFS workspace directory name must be one path segment.'
      })
    }

    const originRoot = await storageManager.getDirectory()
    const root = await originRoot.getDirectoryHandle(directoryName, { create: true })
    let persisted = options.persisted
    if (persisted === undefined) {
      try {
        persisted = (await storageManager.persisted?.()) ?? false
        if (!persisted && options.requestPersistence && storageManager.persist) {
          // The persistence grant is an optional durability improvement, not a
          // prerequisite for using OPFS. Firefox can expose a functional OPFS
          // while leaving persist() pending indefinitely, so never let that
          // browser-policy request block opening the workspace.
          persisted = await requestPersistenceWithin(storageManager)
        }
      } catch {
        persisted = false
      }
    }

    return new OpfsWorkspaceAdapter(root, {
      ...options,
      directoryName,
      persisted
    })
  }
}

export function opfsSupported(storageManager?: Partial<OpfsStorageManager>): boolean {
  const manager =
    storageManager ??
    (typeof navigator !== 'undefined'
      ? (navigator.storage as Partial<OpfsStorageManager>)
      : undefined)
  return typeof manager?.getDirectory === 'function'
}
