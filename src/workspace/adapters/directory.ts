import { HandleWorkspaceAdapter } from './handleAdapter'
import type { WorkspaceBackupExporter } from './types'

export interface DirectoryWorkspaceAdapterOptions {
  /** Stable identity persisted alongside the directory handle. */
  workspaceId: string
  backupExporter?: WorkspaceBackupExporter
  now?: () => number
  /**
   * Disable only for a conforming fake or a handle whose permission lifecycle
   * is managed externally. Production directory adapters should keep it true.
   */
  checkPermission?: boolean
}

/** Chrome/Edge user-selected directory workspace. */
export class DirectoryWorkspaceAdapter extends HandleWorkspaceAdapter {
  constructor(
    root: FileSystemDirectoryHandle,
    options: DirectoryWorkspaceAdapterOptions
  ) {
    super('directory', root, {
      id: options.workspaceId,
      backupExporter: options.backupExporter,
      now: options.now,
      checkPermission: options.checkPermission ?? true,
      storage: {
        persistence: 'external-directory',
        portable: true,
        description:
          'Files are stored in a user-selected directory and remain available outside OrbitPM.',
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
  }
}
