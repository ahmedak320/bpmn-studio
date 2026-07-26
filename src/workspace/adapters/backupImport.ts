import { unzip } from 'fflate'
import {
  LocalizationSource,
  type LanguageCode,
  type LocalizationResources,
  type ReviewedXmlIngestionReviewer
} from '../../localization'
import {
  getRuntimeValidationAdapters,
  type BpmnValidationAdapter
} from '../../validation'
import {
  assertNonReservedImportPath,
  digestProcessIdentitySnapshot,
  isReservedOrbitPmPath,
  normalizeProcessIdentitySnapshot,
  scanWorkspaceProcessIdentities,
  secureWorkspaceProcessIdentityInspector
} from '../processIdentity'
import {
  defaultLocalizationResources,
  secureReviewedBpmnIngestion,
  type ReviewedBpmnIngestionPort
} from '../reviewedBpmn'
import { copyBytes, equalHash, sha256Hex } from './hash'
import {
  joinWorkspacePath,
  normalizeWorkspacePath,
  workspaceParentPath,
  workspacePathName
} from './path'
import { WORKSPACE_BACKUP_CONTENT_PREFIX, WORKSPACE_BACKUP_MANIFEST_PATH } from './backup'
import type {
  FileSnapshot,
  WorkspaceAdapter,
  WorkspaceBackupAppliedFile,
  WorkspaceBackupCollision,
  WorkspaceBackupCollisionDecision,
  WorkspaceBackupImportCandidate,
  WorkspaceBackupImportOptions,
  WorkspaceBackupImportOutcome,
  WorkspaceBackupImportPlan,
  WorkspaceBackupManifest,
  WorkspaceProcessIdentityInspector,
  WorkspaceProcessIdentitySnapshotEntry
} from './types'
import { WorkspaceOperationError, workspaceFailure } from './workspaceError'

export const DEFAULT_BACKUP_IMPORT_LIMITS = {
  maxCompressedBytes: 120 * 1024 * 1024,
  maxDeclaredUncompressedBytes: 250 * 1024 * 1024,
  maxEntryBytes: 100 * 1024 * 1024,
  maxEntries: 25_000,
  maxCompressionRatio: 200,
  maxManifestBytes: 5 * 1024 * 1024
} as const

export interface BackupImportLimits {
  maxCompressedBytes?: number
  maxDeclaredUncompressedBytes?: number
  maxEntryBytes?: number
  maxEntries?: number
  maxCompressionRatio?: number
  maxManifestBytes?: number
}

export interface InspectWorkspaceBackupOptions {
  signal?: AbortSignal
  limits?: BackupImportLimits
  targetLanguage?: LanguageCode
  localizationResources?: LocalizationResources
  localizationReview?: ReviewedXmlIngestionReviewer
  reviewedBpmnIngestion?: ReviewedBpmnIngestionPort
  validationAdapters?: readonly BpmnValidationAdapter[]
  processIdentityInspector?: WorkspaceProcessIdentityInspector
  isCurrent?: () => boolean | Promise<boolean>
}

export interface ZipPreflightEntry {
  name: string
  compressedSize: number
  uncompressedSize: number
  compression: 0 | 8
  directory: boolean
}

export interface ZipPreflight {
  entries: ZipPreflightEntry[]
  declaredUncompressedBytes: number
}

interface ResolvedLimits {
  maxCompressedBytes: number
  maxDeclaredUncompressedBytes: number
  maxEntryBytes: number
  maxEntries: number
  maxCompressionRatio: number
  maxManifestBytes: number
}

interface ApplyOperation {
  sourcePath: string
  destinationPath: string
  bytes: Uint8Array
  existing?: FileSnapshot
}

const decoder = new TextDecoder('utf-8', { fatal: true })
const ZIP_EOCD_SIGNATURE = 0x06054b50
const ZIP_CENTRAL_SIGNATURE = 0x02014b50

function portablePathKey(path: string): string {
  return normalizeWorkspacePath(path).normalize('NFC').toLocaleLowerCase('en-US')
}

function resolvedLimits(input: BackupImportLimits = {}): ResolvedLimits {
  const limits = { ...DEFAULT_BACKUP_IMPORT_LIMITS, ...input }
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`Backup import limit "${name}" must be positive.`)
    }
  }
  return limits
}

function cancelled(path?: string): WorkspaceOperationError {
  return new WorkspaceOperationError({
    code: 'cancelled',
    operation: 'open',
    path,
    message: 'Workspace backup import was cancelled.'
  })
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw cancelled()
}

function invalidBackup(message: string, path?: string): WorkspaceOperationError {
  return new WorkspaceOperationError({
    code: 'integrity-failure',
    operation: 'open',
    path,
    message
  })
}

type UnsealedWorkspaceBackupImportPlan = Omit<
  WorkspaceBackupImportPlan,
  'integrityDigest' | 'reviewDigest'
>

function backupPlanIntegrityPayload(plan: UnsealedWorkspaceBackupImportPlan): unknown {
  return {
    manifest: plan.manifest,
    directories: plan.directories,
    files: plan.files.map((file) => ({
      path: file.path,
      archiveSha256: file.archiveSha256,
      sha256: file.sha256,
      size: file.bytes.byteLength,
      modifiedAt: file.modifiedAt ?? null,
      mimeType: file.mimeType ?? null,
      reviewedBpmn: file.reviewedBpmn
        ? {
            reviewDigest: file.reviewedBpmn.reviewDigest,
            outputDigest: file.reviewedBpmn.outputDigest,
            processIds: file.reviewedBpmn.processIds,
            replacesProcessIds: file.reviewedBpmn.replacesProcessIds,
            evidence: file.reviewedBpmn.evidence
          }
        : null
    })),
    collisions: plan.collisions.map((collision) => ({
      path: collision.path,
      incomingHash: collision.incomingHash,
      existingHash: collision.existing.hash,
      existingSize: collision.existing.bytes.byteLength,
      identical: collision.identical
    })),
    compressedBytes: plan.compressedBytes,
    declaredUncompressedBytes: plan.declaredUncompressedBytes,
    workspaceId: plan.workspaceId,
    workspaceMultipleFiles: plan.workspaceMultipleFiles,
    processIdentitySnapshot: plan.processIdentitySnapshot,
    processIdentityDigest: plan.processIdentityDigest
  }
}

async function digestWorkspaceBackupImportPlan(
  plan: UnsealedWorkspaceBackupImportPlan
): Promise<string> {
  return sha256Hex(new TextEncoder().encode(JSON.stringify(backupPlanIntegrityPayload(plan))))
}

export async function sealWorkspaceBackupImportPlan(
  plan: UnsealedWorkspaceBackupImportPlan,
  reviewedDigest?: string
): Promise<WorkspaceBackupImportPlan> {
  const sealedPlan: UnsealedWorkspaceBackupImportPlan = {
    ...plan,
    directories: Object.freeze([...plan.directories]),
    files: Object.freeze(
      plan.files.map((file) =>
        Object.freeze({
          ...file,
          bytes: copyBytes(file.bytes),
          ...(file.reviewedBpmn
            ? {
                reviewedBpmn: Object.freeze({
                  ...file.reviewedBpmn,
                  processIds: Object.freeze([...file.reviewedBpmn.processIds]),
                  replacesProcessIds: Object.freeze([
                    ...file.reviewedBpmn.replacesProcessIds
                  ])
                })
              }
            : {})
        })
      )
    ),
    collisions: Object.freeze(
      plan.collisions.map((collision) =>
        Object.freeze({
          ...collision,
          existing: Object.freeze({
            ...collision.existing,
            bytes: copyBytes(collision.existing.bytes)
          })
        })
      )
    ),
    processIdentitySnapshot: Object.freeze(
      plan.processIdentitySnapshot.map((entry) => Object.freeze({ ...entry }))
    )
  }
  const integrityDigest = await digestWorkspaceBackupImportPlan(sealedPlan)
  return Object.freeze({
    ...sealedPlan,
    integrityDigest,
    reviewDigest: reviewedDigest ?? integrityDigest
  })
}

function uint16(view: DataView, offset: number): number {
  return view.getUint16(offset, true)
}

function uint32(view: DataView, offset: number): number {
  return view.getUint32(offset, true)
}

function findEocd(view: DataView): number {
  const minimum = Math.max(0, view.byteLength - 65_557)
  for (let offset = view.byteLength - 22; offset >= minimum; offset -= 1) {
    if (uint32(view, offset) === ZIP_EOCD_SIGNATURE) return offset
  }
  throw invalidBackup('Backup is not a valid ZIP archive (end record missing).')
}

function decodeZipName(bytes: Uint8Array, utf8: boolean): string {
  if (!utf8 && bytes.some((byte) => byte > 0x7f)) {
    throw invalidBackup('Backup contains a non-UTF-8 filename.')
  }
  try {
    return decoder.decode(bytes)
  } catch {
    throw invalidBackup('Backup contains an undecodable filename.')
  }
}

/**
 * Parse the ZIP central directory before any expansion. ZIP64, encryption,
 * multi-disk archives, unsupported codecs, traversal, and declared size/ratio
 * violations are rejected without invoking a decompressor.
 */
export function preflightWorkspaceBackupZip(
  bytesInput: Uint8Array,
  limitsInput: BackupImportLimits = {}
): ZipPreflight {
  const limits = resolvedLimits(limitsInput)
  if (bytesInput.byteLength > limits.maxCompressedBytes) {
    throw invalidBackup('Backup exceeds the compressed-size limit.')
  }
  const bytes = copyBytes(bytesInput)
  const view = new DataView(bytes.buffer)
  if (view.byteLength < 22) throw invalidBackup('Backup ZIP is truncated.')
  const eocd = findEocd(view)
  const disk = uint16(view, eocd + 4)
  const centralDisk = uint16(view, eocd + 6)
  const diskEntries = uint16(view, eocd + 8)
  const totalEntries = uint16(view, eocd + 10)
  const centralSize = uint32(view, eocd + 12)
  const centralOffset = uint32(view, eocd + 16)
  const commentLength = uint16(view, eocd + 20)
  if (eocd + 22 + commentLength !== view.byteLength) {
    throw invalidBackup('Backup ZIP has a malformed end record.')
  }
  if (disk !== 0 || centralDisk !== 0 || diskEntries !== totalEntries) {
    throw invalidBackup('Multi-disk ZIP backups are not supported.')
  }
  if (totalEntries === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    throw invalidBackup('ZIP64 backups are not supported.')
  }
  if (totalEntries > limits.maxEntries) {
    throw invalidBackup('Backup contains too many entries.')
  }
  if (centralOffset + centralSize !== eocd) {
    throw invalidBackup('Backup ZIP central-directory bounds are inconsistent.')
  }

  const entries: ZipPreflightEntry[] = []
  const names = new Set<string>()
  let declaredUncompressedBytes = 0
  let offset = centralOffset
  for (let index = 0; index < totalEntries; index += 1) {
    if (offset + 46 > eocd || uint32(view, offset) !== ZIP_CENTRAL_SIGNATURE) {
      throw invalidBackup('Backup ZIP central directory is truncated.')
    }
    const flags = uint16(view, offset + 8)
    const compression = uint16(view, offset + 10)
    const compressedSize = uint32(view, offset + 20)
    const uncompressedSize = uint32(view, offset + 24)
    const nameLength = uint16(view, offset + 28)
    const extraLength = uint16(view, offset + 30)
    const entryCommentLength = uint16(view, offset + 32)
    const diskStart = uint16(view, offset + 34)
    const recordEnd = offset + 46 + nameLength + extraLength + entryCommentLength
    if (recordEnd > eocd) throw invalidBackup('Backup ZIP entry metadata is truncated.')
    if (flags & 0x1) throw invalidBackup('Encrypted ZIP backups are not supported.')
    if (diskStart !== 0) throw invalidBackup('Multi-disk ZIP backups are not supported.')
    if (compression !== 0 && compression !== 8) {
      throw invalidBackup(`ZIP compression method ${compression} is not supported.`)
    }
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff) {
      throw invalidBackup('ZIP64 backup entries are not supported.')
    }
    const name = decodeZipName(
      bytes.subarray(offset + 46, offset + 46 + nameLength),
      Boolean(flags & 0x800)
    )
    if (!name || name.includes('\u0000') || name.startsWith('/') || name.startsWith('\\')) {
      throw invalidBackup('Backup contains an unsafe ZIP entry name.')
    }
    const normalizedName = name.replaceAll('\\', '/')
    const pathParts = normalizedName.split('/').filter(Boolean)
    if (pathParts.some((part) => part === '.' || part === '..')) {
      throw invalidBackup(`Backup ZIP entry "${name}" attempts path traversal.`)
    }
    if (names.has(normalizedName)) {
      throw invalidBackup(`Backup ZIP contains duplicate entry "${normalizedName}".`)
    }
    names.add(normalizedName)
    const directory = normalizedName.endsWith('/')
    if (!directory) {
      if (uncompressedSize > limits.maxEntryBytes) {
        throw invalidBackup(`Backup entry "${normalizedName}" exceeds its size limit.`)
      }
      if (
        compressedSize === 0
          ? uncompressedSize > 0
          : uncompressedSize / compressedSize > limits.maxCompressionRatio
      ) {
        throw invalidBackup(`Backup entry "${normalizedName}" has an unsafe compression ratio.`)
      }
      declaredUncompressedBytes += uncompressedSize
      if (declaredUncompressedBytes > limits.maxDeclaredUncompressedBytes) {
        throw invalidBackup('Backup exceeds the total uncompressed-size limit.')
      }
    }
    entries.push({
      name: normalizedName,
      compressedSize,
      uncompressedSize,
      compression: compression as 0 | 8,
      directory
    })
    offset = recordEnd
  }
  if (offset !== eocd) throw invalidBackup('Backup ZIP central directory has trailing data.')
  const manifest = entries.find((entry) => entry.name === WORKSPACE_BACKUP_MANIFEST_PATH)
  if (!manifest || manifest.directory) {
    throw invalidBackup(`Backup manifest "${WORKSPACE_BACKUP_MANIFEST_PATH}" is missing.`)
  }
  if (manifest.uncompressedSize > limits.maxManifestBytes) {
    throw invalidBackup('Backup manifest exceeds its size limit.')
  }
  return { entries, declaredUncompressedBytes }
}

function extractZip(
  bytes: Uint8Array,
  signal: AbortSignal | undefined
): Promise<Record<string, Uint8Array<ArrayBuffer>>> {
  throwIfAborted(signal)
  return new Promise((resolve, reject) => {
    const expansion: { terminate?: () => void } = {}
    const onAbort = (): void => {
      expansion.terminate?.()
      reject(cancelled())
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    expansion.terminate = unzip(copyBytes(bytes), (error, files) => {
      signal?.removeEventListener('abort', onAbort)
      if (error) {
        reject(invalidBackup(`Backup ZIP expansion failed: ${error.message}`))
        return
      }
      const copied: Record<string, Uint8Array<ArrayBuffer>> = {}
      for (const [name, value] of Object.entries(files)) copied[name] = copyBytes(value)
      resolve(copied)
    })
  })
}

function parseManifest(bytes: Uint8Array): WorkspaceBackupManifest {
  let value: Partial<WorkspaceBackupManifest>
  try {
    value = JSON.parse(decoder.decode(bytes)) as Partial<WorkspaceBackupManifest>
  } catch {
    throw invalidBackup('Backup manifest is not valid UTF-8 JSON.')
  }
  if (
    value.format !== 'orbitpm-workspace-backup' ||
    value.version !== 1 ||
    value.checksumAlgorithm !== 'SHA-256' ||
    typeof value.workspace?.id !== 'string' ||
    !['directory', 'opfs', 'single-file'].includes(value.workspace?.mode ?? '') ||
    !Array.isArray(value.directories) ||
    !Array.isArray(value.files)
  ) {
    throw invalidBackup('Backup manifest is incomplete or unsupported.')
  }
  return value as WorkspaceBackupManifest
}

export async function inspectWorkspaceBackup(
  adapter: WorkspaceAdapter,
  backup: Blob,
  options: InspectWorkspaceBackupOptions = {}
): Promise<WorkspaceBackupImportPlan> {
  const limits = resolvedLimits(options.limits)
  if (backup.size > limits.maxCompressedBytes) {
    throw invalidBackup('Backup exceeds the compressed-size limit.')
  }
  throwIfAborted(options.signal)
  const compressed = copyBytes(new Uint8Array(await backup.arrayBuffer()))
  const preflight = preflightWorkspaceBackupZip(compressed, limits)
  const extracted = await extractZip(compressed, options.signal)
  const manifestBytes = extracted[WORKSPACE_BACKUP_MANIFEST_PATH]
  if (!manifestBytes) throw invalidBackup('Backup manifest was not expanded.')
  const manifest = parseManifest(manifestBytes)
  if (!adapter.storage.capabilities.multipleFiles && manifest.files.length > 1) {
    throw invalidBackup('The selected workspace adapter cannot restore multiple files.')
  }
  const processIdentityInspector =
    options.processIdentityInspector ?? secureWorkspaceProcessIdentityInspector
  const processIdentitySnapshot = await scanWorkspaceProcessIdentities(adapter, {
    inspector: processIdentityInspector,
    signal: options.signal
  })
  const processIdentityDigest =
    await digestProcessIdentitySnapshot(processIdentitySnapshot)

  const directories = [
    ...new Set(manifest.directories.map((path) => normalizeWorkspacePath(path)))
  ].sort((left, right) => left.localeCompare(right))
  if (directories.length !== manifest.directories.length) {
    throw invalidBackup('Backup manifest contains duplicate directories.')
  }

  const archiveFiles = new Set<string>()
  const files: WorkspaceBackupImportCandidate[] = []
  const filePaths = new Set<string>()
  for (const item of manifest.files) {
    throwIfAborted(options.signal)
    if (!item || typeof item !== 'object') {
      throw invalidBackup('Backup manifest contains an invalid file record.')
    }
    const path = normalizeWorkspacePath(item.path)
    const expectedArchivePath = `${WORKSPACE_BACKUP_CONTENT_PREFIX}/${path}`
    if (
      item.archivePath !== expectedArchivePath ||
      filePaths.has(path) ||
      archiveFiles.has(item.archivePath) ||
      !/^[a-f0-9]{64}$/i.test(item.sha256) ||
      !Number.isInteger(item.size) ||
      item.size < 0
    ) {
      throw invalidBackup(`Backup manifest file "${item.path}" is inconsistent.`, path)
    }
    const bytes = extracted[item.archivePath]
    if (!bytes || bytes.byteLength !== item.size) {
      throw invalidBackup(`Backup file "${path}" is missing or has the wrong size.`, path)
    }
    const actualHash = await sha256Hex(bytes)
    if (!equalHash(actualHash, item.sha256)) {
      throw invalidBackup(`Backup file "${path}" failed checksum verification.`, path)
    }
    filePaths.add(path)
    archiveFiles.add(item.archivePath)
    files.push({
      path,
      bytes: copyBytes(bytes),
      archiveSha256: actualHash,
      sha256: actualHash,
      modifiedAt: item.modifiedAt,
      mimeType: item.mimeType
    })
  }

  for (const entry of preflight.entries) {
    if (entry.directory || entry.name === WORKSPACE_BACKUP_MANIFEST_PATH) continue
    if (!archiveFiles.has(entry.name)) {
      throw invalidBackup(`Backup contains unmanifested file "${entry.name}".`)
    }
  }

  const incomingIdentityByPath = new Map<string, readonly string[]>()
  const incomingIdentityOwners = new Map<string, string>()
  for (const file of files) {
    if (!/\.bpmn$/i.test(file.path)) continue
    let xml: string
    try {
      xml = decoder.decode(file.bytes)
    } catch {
      throw invalidBackup(`Backup BPMN file "${file.path}" is not valid UTF-8.`, file.path)
    }
    let inspected: { readonly processIds: readonly string[] }
    try {
      inspected = await processIdentityInspector(xml, options.signal)
    } catch (error) {
      throw invalidBackup(
        `Backup BPMN file "${file.path}" failed secure identity inspection: ${
          error instanceof Error ? error.message : String(error)
        }`,
        file.path
      )
    }
    const processIds = Object.freeze(
      [...new Set(inspected.processIds.map((processId) => processId.trim()).filter(Boolean))].sort(
        (left, right) => left.localeCompare(right, 'en')
      )
    )
    incomingIdentityByPath.set(file.path, processIds)
    if (isReservedOrbitPmPath(file.path)) continue
    for (const processId of processIds) {
      const previous = incomingIdentityOwners.get(processId)
      if (previous && previous !== file.path) {
        throw invalidBackup(
          `Backup process id "${processId}" is duplicated by "${previous}" and "${file.path}".`,
          file.path
        )
      }
      incomingIdentityOwners.set(processId, file.path)
    }
  }

  const currentIdentityById = new Map(
    processIdentitySnapshot
      .filter(
        (
          entry
        ): entry is WorkspaceProcessIdentitySnapshotEntry & { readonly path: string } =>
          entry.path !== null
      )
      .map((entry) => [entry.processId, entry.path])
  )
  const knownProcessIds = Object.freeze(
    [...new Set([...currentIdentityById.keys(), ...incomingIdentityOwners.keys()])].sort(
      (left, right) => left.localeCompare(right, 'en')
    )
  )
  const reviewedBpmnIngestion =
    options.reviewedBpmnIngestion ?? secureReviewedBpmnIngestion
  const validationAdapters =
    options.validationAdapters ?? getRuntimeValidationAdapters()
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index]
    const inspectedProcessIds = incomingIdentityByPath.get(file.path)
    if (!inspectedProcessIds) continue
    let xml: string
    try {
      xml = decoder.decode(file.bytes)
    } catch {
      throw invalidBackup(`Backup BPMN file "${file.path}" is not valid UTF-8.`, file.path)
    }
    let reviewed
    try {
      reviewed = await reviewedBpmnIngestion(xml, {
        source: LocalizationSource.Backup,
        target: options.targetLanguage ?? 'en',
        resources: options.localizationResources ?? defaultLocalizationResources(),
        knownProcessIds,
        validationAdapters,
        review: options.localizationReview,
        signal: options.signal,
        isCurrent: options.isCurrent
      })
    } catch (error) {
      throw invalidBackup(
        `Backup BPMN file "${file.path}" did not complete reviewed localization: ${
          error instanceof Error ? error.message : String(error)
        }`,
        file.path
      )
    }
    const reviewedBytes = new TextEncoder().encode(reviewed.xml)
    const reviewedDigest = await sha256Hex(reviewedBytes)
    if (
      !equalHash(reviewedDigest, reviewed.digest) ||
      !equalHash(reviewedDigest, reviewed.evidence.outputDigest)
    ) {
      throw invalidBackup(
        `Backup BPMN file "${file.path}" returned inconsistent reviewed bytes.`,
        file.path
      )
    }
    let reviewedIdentity
    try {
      reviewedIdentity = await processIdentityInspector(reviewed.xml, options.signal)
    } catch (error) {
      throw invalidBackup(
        `Reviewed backup BPMN file "${file.path}" failed identity inspection: ${
          error instanceof Error ? error.message : String(error)
        }`,
        file.path
      )
    }
    const reviewedProcessIds = Object.freeze(
      [...new Set(reviewedIdentity.processIds)].sort((left, right) =>
        left.localeCompare(right, 'en')
      )
    )
    if (
      reviewedProcessIds.length !== inspectedProcessIds.length ||
      reviewedProcessIds.some((processId, ordinal) => processId !== inspectedProcessIds[ordinal])
    ) {
      throw invalidBackup(
        `Reviewed localization changed process identity in "${file.path}".`,
        file.path
      )
    }
    const replacesProcessIds: string[] = []
    if (!isReservedOrbitPmPath(file.path)) {
      for (const processId of reviewedProcessIds) {
        const existingPath = currentIdentityById.get(processId)
        if (!existingPath) continue
        if (portablePathKey(existingPath) !== portablePathKey(file.path)) {
          throw invalidBackup(
            `Backup process id "${processId}" belongs to "${existingPath}", not "${file.path}".`,
            file.path
          )
        }
        replacesProcessIds.push(processId)
      }
    }
    files[index] = {
      ...file,
      bytes: copyBytes(reviewedBytes),
      sha256: reviewedDigest,
      reviewedBpmn: {
        reviewDigest: reviewed.reviewDigest,
        outputDigest: reviewedDigest,
        processIds: reviewedProcessIds,
        replacesProcessIds: Object.freeze(replacesProcessIds),
        evidence: reviewed.evidence
      }
    }
  }

  const existingEntries = await adapter.list()
  const existingFiles = new Map(
    existingEntries.filter((entry) => entry.kind === 'file').map((entry) => [entry.path, entry])
  )
  const collisions: WorkspaceBackupCollision[] = []
  for (const file of files) {
    if (!existingFiles.has(file.path)) continue
    const existing = await adapter.read(file.path)
    collisions.push({
      path: file.path,
      incomingHash: file.sha256,
      existing,
      identical: equalHash(file.sha256, existing.hash)
    })
  }
  const finalProcessIdentitySnapshot = await scanWorkspaceProcessIdentities(adapter, {
    inspector: processIdentityInspector,
    signal: options.signal
  })
  if (
    !equalHash(
      await digestProcessIdentitySnapshot(finalProcessIdentitySnapshot),
      processIdentityDigest
    )
  ) {
    throw invalidBackup('Workspace process identities changed during backup inspection.')
  }
  return sealWorkspaceBackupImportPlan({
    manifest,
    directories,
    files,
    collisions,
    compressedBytes: compressed.byteLength,
    declaredUncompressedBytes: preflight.declaredUncompressedBytes,
    workspaceId: adapter.id,
    workspaceMultipleFiles: adapter.storage.capabilities.multipleFiles,
    processIdentitySnapshot,
    processIdentityDigest
  })
}

function candidateCopyPath(path: string, occupied: Set<string>): string {
  const parent = workspaceParentPath(path)
  const name = workspacePathName(path)
  const extensionIndex = name.toLocaleLowerCase('en-US').endsWith('.bpmn')
    ? name.length - '.bpmn'.length
    : name.lastIndexOf('.')
  const stem = extensionIndex > 0 ? name.slice(0, extensionIndex) : name
  const extension = extensionIndex > 0 ? name.slice(extensionIndex) : ''
  for (let suffix = 1; suffix <= 10_000; suffix += 1) {
    const candidate = joinWorkspacePath(
      parent,
      `${stem}-restored${suffix === 1 ? '' : `-${suffix}`}${extension}`
    )
    if (!occupied.has(candidate)) return candidate
  }
  throw new WorkspaceOperationError({
    code: 'already-exists',
    operation: 'write',
    path,
    message: `Could not allocate a collision-free restored filename for "${path}".`
  })
}

async function verifyWorkspaceBackupImportPlan(
  adapter: WorkspaceAdapter,
  plan: WorkspaceBackupImportPlan
): Promise<void> {
  if (
    adapter.id !== plan.workspaceId ||
    adapter.storage.capabilities.multipleFiles !== plan.workspaceMultipleFiles
  ) {
    throw invalidBackup('The active workspace changed after backup review.')
  }
  if (!adapter.storage.capabilities.multipleFiles && plan.files.length > 1) {
    throw invalidBackup('The selected workspace adapter cannot restore multiple files.')
  }
  if (
    !equalHash(
      await digestProcessIdentitySnapshot(plan.processIdentitySnapshot),
      plan.processIdentityDigest
    )
  ) {
    throw invalidBackup('The backup process identity snapshot changed after review.')
  }
  const { integrityDigest, reviewDigest: _reviewDigest, ...unsealed } = plan
  if (!equalHash(await digestWorkspaceBackupImportPlan(unsealed), integrityDigest)) {
    throw invalidBackup('The backup import plan changed after review.')
  }
  const manifestByPath = new Map(plan.manifest.files.map((file) => [file.path, file]))
  const seenPaths = new Set<string>()
  for (const file of plan.files) {
    if (seenPaths.has(file.path)) {
      throw invalidBackup(`The backup import plan duplicates "${file.path}".`, file.path)
    }
    seenPaths.add(file.path)
    const manifestFile = manifestByPath.get(file.path)
    if (
      !manifestFile ||
      !equalHash(manifestFile.sha256, file.archiveSha256) ||
      !equalHash(await sha256Hex(file.bytes), file.sha256)
    ) {
      throw invalidBackup(
        `Backup candidate "${file.path}" failed exact byte verification.`,
        file.path
      )
    }
    const bpmn = /\.bpmn$/i.test(file.path)
    if (
      bpmn !== Boolean(file.reviewedBpmn) ||
      (!bpmn && !equalHash(file.archiveSha256, file.sha256)) ||
      (file.reviewedBpmn !== undefined &&
        (!equalHash(file.reviewedBpmn.outputDigest, file.sha256) ||
          !equalHash(file.reviewedBpmn.evidence.outputDigest, file.sha256) ||
          file.reviewedBpmn.evidence.reviewDigest !== file.reviewedBpmn.reviewDigest))
    ) {
      throw invalidBackup(
        `Backup BPMN candidate "${file.path}" lacks completed reviewed evidence.`,
        file.path
      )
    }
  }
  for (const collision of plan.collisions) {
    const incoming = plan.files.find((file) => file.path === collision.path)
    if (
      !incoming ||
      !equalHash(await sha256Hex(collision.existing.bytes), collision.existing.hash) ||
      !equalHash(collision.incomingHash, incoming.sha256)
    ) {
      throw invalidBackup(
        `Backup collision snapshot "${collision.path}" changed after review.`,
        collision.path
      )
    }
  }
}

function resolveOperations(
  plan: WorkspaceBackupImportPlan,
  decisions: Readonly<Record<string, WorkspaceBackupCollisionDecision>>,
  initiallyOccupied: ReadonlySet<string>
): { operations: ApplyOperation[]; skipped: string[]; unresolved: WorkspaceBackupCollision[] } {
  const collisionMap = new Map(plan.collisions.map((collision) => [collision.path, collision]))
  const occupied = new Set(initiallyOccupied)
  const operations: ApplyOperation[] = []
  const skipped: string[] = []
  const unresolved: WorkspaceBackupCollision[] = []

  for (const file of plan.files) {
    const collision = collisionMap.get(file.path)
    if (!collision) {
      occupied.add(file.path)
      operations.push({
        sourcePath: file.path,
        destinationPath: file.path,
        bytes: copyBytes(file.bytes)
      })
      continue
    }
    const decision = decisions[file.path] ?? (collision.identical ? { action: 'skip' } : undefined)
    if (!decision) {
      unresolved.push(collision)
      continue
    }
    if (decision.action === 'skip') {
      skipped.push(file.path)
      continue
    }
    if (decision.action === 'replace') {
      operations.push({
        sourcePath: file.path,
        destinationPath: file.path,
        bytes: copyBytes(file.bytes),
        existing: collision.existing
      })
      continue
    }
    const requested = decision.destinationPath
      ? normalizeWorkspacePath(decision.destinationPath)
      : candidateCopyPath(file.path, occupied)
    if (decision.destinationPath) {
      try {
        assertNonReservedImportPath(requested, 'Backup keep-both destination')
      } catch (error) {
        throw invalidBackup(error instanceof Error ? error.message : String(error), requested)
      }
    }
    if ((file.reviewedBpmn?.replacesProcessIds.length ?? 0) > 0) {
      throw invalidBackup(
        `Backup BPMN "${file.path}" owns existing process identities and cannot use keep-both.`,
        file.path
      )
    }
    if (occupied.has(requested)) {
      throw new WorkspaceOperationError({
        code: 'already-exists',
        operation: 'write',
        path: requested,
        message: `Backup restore destination "${requested}" already exists.`
      })
    }
    occupied.add(requested)
    operations.push({
      sourcePath: file.path,
      destinationPath: requested,
      bytes: copyBytes(file.bytes)
    })
  }
  return { operations, skipped, unresolved }
}

function outcomeFailure(
  outcome: Exclude<Awaited<ReturnType<WorkspaceAdapter['writeAtomic']>>, { status: 'success' }>,
  path: string
): WorkspaceOperationError {
  const message =
    outcome.status === 'external-conflict'
      ? `Backup restore encountered an external conflict at "${path}".`
      : 'error' in outcome
        ? outcome.error.message
        : `Backup restore failed with ${outcome.status}.`
  return new WorkspaceOperationError({
    code:
      outcome.status === 'external-conflict'
        ? 'integrity-failure'
        : 'error' in outcome
          ? outcome.error.code
          : 'stale-workspace',
    operation: 'write',
    path,
    message
  })
}

async function removeEmptyCreatedFolders(
  adapter: WorkspaceAdapter,
  folders: string[],
  errors: ReturnType<typeof workspaceFailure>[]
): Promise<void> {
  for (const folder of [...folders].sort((left, right) => right.length - left.length)) {
    try {
      if ((await adapter.list(folder)).length === 0) await adapter.remove(folder)
    } catch (error) {
      if (error instanceof WorkspaceOperationError && error.code === 'not-found') continue
      errors.push(workspaceFailure(error, 'remove', folder))
    }
  }
}

/**
 * Apply a reviewed import plan with per-file compare-and-set writes. Every
 * successful mutation records enough state to roll back in reverse order.
 */
export async function applyWorkspaceBackupImport(
  adapter: WorkspaceAdapter,
  plan: WorkspaceBackupImportPlan,
  options: WorkspaceBackupImportOptions = {}
): Promise<WorkspaceBackupImportOutcome> {
  throwIfAborted(options.signal)
  await verifyWorkspaceBackupImportPlan(adapter, plan)
  if (options.currentProcessIndex !== undefined || options.currentProcessIds !== undefined) {
    const suppliedDigest = await digestProcessIdentitySnapshot(
      normalizeProcessIdentitySnapshot(
        options.currentProcessIndex,
        options.currentProcessIds
      )
    )
    if (!equalHash(suppliedDigest, plan.processIdentityDigest)) {
      throw invalidBackup('Supplied process identities changed after backup review.')
    }
  }
  const assertLiveProcessIdentities = async (): Promise<void> => {
    const currentSnapshot = await scanWorkspaceProcessIdentities(adapter, {
      inspector: options.processIdentityInspector,
      signal: options.signal
    })
    if (
      !equalHash(
        await digestProcessIdentitySnapshot(currentSnapshot),
        plan.processIdentityDigest
      )
    ) {
      throw invalidBackup('Workspace process identities changed after backup review.')
    }
  }
  await assertLiveProcessIdentities()
  throwIfAborted(options.signal)
  const beforeEntries = await adapter.list()
  const { operations, skipped, unresolved } = resolveOperations(
    plan,
    options.decisions ?? {},
    new Set(beforeEntries.filter((entry) => entry.kind === 'file').map((entry) => entry.path))
  )
  if (unresolved.length > 0) {
    return { status: 'needs-review', unresolvedCollisions: unresolved }
  }
  if (options.reviewedDigest !== plan.reviewDigest) {
    throw invalidBackup('The applied backup review digest does not match the current plan.')
  }
  if (!adapter.storage.capabilities.multipleFiles && operations.length > 1) {
    throw invalidBackup('The selected workspace adapter cannot restore multiple files.')
  }
  await assertLiveProcessIdentities()
  throwIfAborted(options.signal)

  const existingDirectories = new Set(
    beforeEntries.filter((entry) => entry.kind === 'directory').map((entry) => entry.path)
  )
  const requiredDirectories = new Set(plan.directories)
  for (const operation of operations) {
    let parent = workspaceParentPath(operation.destinationPath)
    while (parent) {
      requiredDirectories.add(parent)
      parent = workspaceParentPath(parent)
    }
  }
  const createdDirectories: string[] = []
  const applied: WorkspaceBackupAppliedFile[] = []
  const originalByDestination = new Map<string, FileSnapshot>()

  try {
    for (const directory of [...requiredDirectories].sort(
      (left, right) => left.split('/').length - right.split('/').length
    )) {
      throwIfAborted(options.signal)
      if (!existingDirectories.has(directory)) {
        await adapter.createFolder(directory)
        createdDirectories.push(directory)
      }
    }

    for (const operation of operations) {
      throwIfAborted(options.signal)
      if (operation.existing) {
        await options.beforeOverwrite?.(operation.destinationPath, operation.existing)
        originalByDestination.set(operation.destinationPath, operation.existing)
      }
      const outcome = await adapter.writeAtomic(
        operation.destinationPath,
        operation.bytes,
        operation.existing?.hash,
        {
          expectedWorkspaceId: adapter.id,
          expectedMissing: !operation.existing,
          signal: options.signal
        }
      )
      if (outcome.status !== 'success') {
        throw outcomeFailure(outcome, operation.destinationPath)
      }
      applied.push({
        sourcePath: operation.sourcePath,
        destinationPath: operation.destinationPath,
        replaced: Boolean(operation.existing),
        snapshot: outcome.snapshot
      })
    }
    return { status: 'committed', applied, skipped }
  } catch (error) {
    const rollbackErrors: ReturnType<typeof workspaceFailure>[] = []
    for (const item of [...applied].reverse()) {
      try {
        const original = originalByDestination.get(item.destinationPath)
        if (original) {
          const rollback = await adapter.writeAtomic(
            item.destinationPath,
            original.bytes,
            item.snapshot.hash,
            {
              expectedWorkspaceId: adapter.id
            }
          )
          if (rollback.status !== 'success') {
            throw outcomeFailure(rollback, item.destinationPath)
          }
        } else {
          const current = await adapter.read(item.destinationPath)
          if (!equalHash(current.hash, item.snapshot.hash)) {
            throw new WorkspaceOperationError({
              code: 'integrity-failure',
              operation: 'remove',
              path: item.destinationPath,
              message: 'A restored file changed before rollback.'
            })
          }
          await adapter.remove(item.destinationPath)
        }
      } catch (rollbackError) {
        rollbackErrors.push(workspaceFailure(rollbackError, 'write', item.destinationPath))
      }
    }
    await removeEmptyCreatedFolders(adapter, createdDirectories, rollbackErrors)
    return {
      status: rollbackErrors.length > 0 ? 'rollback-failed' : 'rolled-back',
      appliedBeforeFailure: applied,
      skipped,
      error: workspaceFailure(error, 'write'),
      rollbackErrors
    }
  }
}
