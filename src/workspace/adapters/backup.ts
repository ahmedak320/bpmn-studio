import { Zip, ZipPassThrough, strToU8 } from 'fflate'
import { copyBytes } from './hash'
import {
  normalizeWorkspacePath,
  workspaceParentPath
} from './path'
import type {
  BackupExportOptions,
  WorkspaceAdapter,
  WorkspaceBackupManifest
} from './types'
import { WorkspaceOperationError } from './workspaceError'

export const WORKSPACE_BACKUP_MANIFEST_PATH = 'orbitpm-backup.json'
export const WORKSPACE_BACKUP_CONTENT_PREFIX = 'workspace'

const ZIP_EPOCH = new Date(1980, 0, 1, 0, 0, 0)

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new WorkspaceOperationError({
      code: 'cancelled',
      operation: 'export-backup',
      message: 'Workspace backup export was cancelled.'
    })
  }
}

function archivePath(path: string): string {
  return `${WORKSPACE_BACKUP_CONTENT_PREFIX}/${normalizeWorkspacePath(path)}`
}

function addZipEntry(zip: Zip, name: string, bytes: Uint8Array): void {
  const file = new ZipPassThrough(name)
  file.mtime = ZIP_EPOCH
  zip.add(file)
  file.push(copyBytes(bytes), true)
}

function zipEntries(entries: Array<{ name: string; bytes: Uint8Array }>): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    const chunks: Uint8Array<ArrayBuffer>[] = []
    const zip = new Zip((error, chunk, final) => {
      if (error) {
        reject(error)
        return
      }
      chunks.push(copyBytes(chunk))
      if (final) resolve(new Blob(chunks, { type: 'application/zip' }))
    })

    try {
      for (const entry of entries) addZipEntry(zip, entry.name, entry.bytes)
      zip.end()
    } catch (error) {
      zip.terminate()
      reject(error)
    }
  })
}

/**
 * Export every public workspace file, including `.orbitpm` metadata, i18n, and
 * history files. Browser-private drafts and credentials are not addressable by
 * a WorkspaceAdapter and therefore cannot leak into this archive.
 */
export async function exportWorkspaceBackup(
  adapter: WorkspaceAdapter,
  options: BackupExportOptions = {}
): Promise<Blob> {
  throwIfAborted(options.signal)
  const entries = await adapter.list()
  const directories = entries
    .filter((entry) => entry.kind === 'directory')
    .map((entry) => entry.path)
    .sort((left, right) => left.localeCompare(right))
  const files = entries
    .filter((entry) => entry.kind === 'file')
    .sort((left, right) => left.path.localeCompare(right.path))

  const manifest: WorkspaceBackupManifest = {
    format: 'orbitpm-workspace-backup',
    version: 1,
    generatedAt: (options.generatedAt ?? new Date()).toISOString(),
    workspace: {
      id: adapter.id,
      mode: adapter.mode
    },
    checksumAlgorithm: 'SHA-256',
    directories,
    files: []
  }
  const archiveEntries: Array<{ name: string; bytes: Uint8Array }> = []
  const capturedFiles = new Map<
    string,
    { size: number; modifiedAt: number; readable: boolean }
  >()

  // Preserve explicitly created empty folders. Directory entries are stored,
  // while the manifest remains the authoritative directory list.
  for (const directory of directories) {
    throwIfAborted(options.signal)
    archiveEntries.push({ name: `${archivePath(directory)}/`, bytes: new Uint8Array() })
  }

  for (const entry of files) {
    throwIfAborted(options.signal)
    if (!entry.readable) {
      throw new WorkspaceOperationError({
        code: entry.issue?.code ?? 'storage-failure',
        operation: 'export-backup',
        path: entry.path,
        message: `Cannot export an incomplete backup because "${entry.path}" is unreadable.`
      })
    }
    const snapshot = await adapter.read(entry.path)
    if (
      (entry.size !== undefined && entry.size !== snapshot.size) ||
      (entry.modifiedAt !== undefined &&
        entry.modifiedAt !== 0 &&
        snapshot.modifiedAt !== 0 &&
        entry.modifiedAt !== snapshot.modifiedAt)
    ) {
      throw changedDuringBackup(entry.path)
    }
    const target = archivePath(entry.path)
    manifest.files.push({
      path: snapshot.path,
      archivePath: target,
      size: snapshot.size,
      sha256: snapshot.hash,
      modifiedAt: snapshot.modifiedAt,
      mimeType: snapshot.mimeType
    })
    archiveEntries.push({ name: target, bytes: snapshot.bytes })
    capturedFiles.set(entry.path, {
      size: snapshot.size,
      modifiedAt: snapshot.modifiedAt,
      readable: true
    })
  }

  // Ensure parent folders inferred from files are represented in the manifest
  // even if a nonconforming backing implementation omitted them from list().
  const directorySet = new Set(manifest.directories)
  for (const file of manifest.files) {
    let parent = workspaceParentPath(file.path)
    while (parent) {
      directorySet.add(parent)
      parent = workspaceParentPath(parent)
    }
  }
  manifest.directories = [...directorySet].sort((left, right) => left.localeCompare(right))

  // Refuse a coherent-looking but mixed-time archive. This second lightweight
  // listing catches external creates, deletes, renames, and ordinary metadata
  // changes that occurred while file snapshots were being collected.
  throwIfAborted(options.signal)
  const finalEntries = await adapter.list()
  const finalDirectories = finalEntries
    .filter((entry) => entry.kind === 'directory')
    .map((entry) => entry.path)
    .sort((left, right) => left.localeCompare(right))
  const finalFiles = finalEntries.filter((entry) => entry.kind === 'file')
  if (
    JSON.stringify(finalDirectories) !==
    JSON.stringify(
      entries
        .filter((entry) => entry.kind === 'directory')
        .map((entry) => entry.path)
        .sort((left, right) => left.localeCompare(right))
    ) ||
    finalFiles.length !== capturedFiles.size
  ) {
    throw changedDuringBackup()
  }
  for (const entry of finalFiles) {
    const captured = capturedFiles.get(entry.path)
    if (
      !captured ||
      !entry.readable ||
      (entry.size !== undefined && entry.size !== captured.size) ||
      (entry.modifiedAt !== undefined &&
        entry.modifiedAt !== 0 &&
        captured.modifiedAt !== 0 &&
        entry.modifiedAt !== captured.modifiedAt)
    ) {
      throw changedDuringBackup(entry.path)
    }
  }

  const manifestBytes = strToU8(JSON.stringify(manifest, null, 2))
  return zipEntries([
    { name: WORKSPACE_BACKUP_MANIFEST_PATH, bytes: manifestBytes },
    ...archiveEntries
  ])
}

function changedDuringBackup(path?: string): WorkspaceOperationError {
  return new WorkspaceOperationError({
    code: 'integrity-failure',
    operation: 'export-backup',
    path,
    message: path
      ? `Workspace entry "${path}" changed while its backup was being created.`
      : 'The workspace changed while its backup was being created.'
  })
}
