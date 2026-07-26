import {
  WORKSPACE_GLOSSARY_PATH,
  WORKSPACE_TRANSLATION_MEMORY_PATH
} from '../localization/workspaceStore'
import {
  WorkspaceOperationError,
  exportWorkspaceBackup,
  normalizeWorkspacePath,
  type BackupExportOptions,
  type FileSnapshot,
  type SaveOutcome,
  type WorkspaceAdapter,
  type WorkspaceEntry,
  type WorkspaceFailure,
  type WriteAtomicOptions
} from './adapters'
import { decodeUtf8Strict } from './utf8'
import {
  DEFAULT_HISTORY_PER_PROCESS,
  DEFAULT_HISTORY_TOTAL_BYTES,
  HISTORY_ROOT
} from './history/historyManager'

export const WORKSPACE_MANIFEST_PATH = '.orbitpm/manifest.json'
export const WORKSPACE_MANIFEST_FORMAT = 'orbitpm-workspace' as const
export const WORKSPACE_MANIFEST_VERSION = 1 as const
export const WORKSPACE_MANIFEST_CHECKSUM_SCOPE = 'public-workspace-files' as const
export const WORKSPACE_MANIFEST_CHECKSUM_EXCLUDED_PATHS = Object.freeze([
  WORKSPACE_MANIFEST_PATH
] as const)
export const WORKSPACE_MANIFEST_CHECKSUM_EXCLUDED_PREFIXES = Object.freeze([
  `${HISTORY_ROOT}/`,
  '.orbitpm/transactions/'
] as const)
export const WORKSPACE_MANIFEST_LOCALIZATION_CHECKSUM_COVERAGE = 'included' as const
export const WORKSPACE_MANIFEST_HISTORY_CHECKSUM_COVERAGE = 'excluded-managed-revisions' as const

export interface WorkspaceManifestChecksum {
  readonly path: string
  readonly sha256: string
  readonly size: number
  readonly modifiedAt: number
}

export interface WorkspaceManifestWarning {
  readonly code: 'unreadable-file'
  readonly path: string
  readonly message: string
}

export interface WorkspaceManifestPolicies {
  readonly checksumAlgorithm: 'SHA-256'
  readonly checksumScope: typeof WORKSPACE_MANIFEST_CHECKSUM_SCOPE
  readonly excludedPaths: typeof WORKSPACE_MANIFEST_CHECKSUM_EXCLUDED_PATHS
  readonly excludedPathPrefixes: typeof WORKSPACE_MANIFEST_CHECKSUM_EXCLUDED_PREFIXES
  readonly publicLocalization: {
    readonly glossaryPath: typeof WORKSPACE_GLOSSARY_PATH
    readonly translationMemoryPath: typeof WORKSPACE_TRANSLATION_MEMORY_PATH
    readonly checksumCoverage: typeof WORKSPACE_MANIFEST_LOCALIZATION_CHECKSUM_COVERAGE
  }
  readonly portableHistory: {
    readonly rootPath: typeof HISTORY_ROOT
    readonly maxRevisionsPerProcess: typeof DEFAULT_HISTORY_PER_PROCESS
    readonly maxTotalBytes: typeof DEFAULT_HISTORY_TOTAL_BYTES
    readonly pruneOrder: 'oldest-first'
    readonly preserveNewestPerProcess: true
    readonly checksumCoverage: typeof WORKSPACE_MANIFEST_HISTORY_CHECKSUM_COVERAGE
  }
}

export interface WorkspaceManifestDocument {
  readonly format: typeof WORKSPACE_MANIFEST_FORMAT
  readonly version: typeof WORKSPACE_MANIFEST_VERSION
  readonly workspace: {
    /** Stable RFC-4122 UUID persisted with the workspace, never its display name. */
    readonly id: string
    readonly createdAt: string
    readonly updatedAt: string
  }
  readonly policies: WorkspaceManifestPolicies
  readonly checksums: readonly WorkspaceManifestChecksum[]
}

export interface WorkspaceManifestState {
  readonly document: WorkspaceManifestDocument
  readonly snapshot: FileSnapshot
  readonly created: boolean
  readonly reconciled: boolean
  readonly warnings: readonly WorkspaceManifestWarning[]
}

export interface EnsureWorkspaceManifestOptions {
  now?: () => Date
  createUuid?: () => string
  signal?: AbortSignal
  maxAttempts?: number
  onWarning?: (warning: WorkspaceManifestWarning) => void
}

export interface BindWorkspaceToManifestOptions extends EnsureWorkspaceManifestOptions {
  /**
   * Manifest refresh errors happen after the requested storage mutation has
   * committed, so they are reported separately rather than misrepresenting the
   * original write/rename/move/remove as failed.
   */
  onManifestError?: (error: unknown) => void
  onManifestWarning?: (warning: WorkspaceManifestWarning) => void
}

export interface ManifestBoundWorkspace {
  readonly adapter: ManifestBoundWorkspaceAdapter
  readonly manifest: WorkspaceManifestState
}

export class WorkspaceManifestValidationError extends Error {
  readonly path: string

  constructor(path: string, message: string, options: { cause?: unknown } = {}) {
    super(`${path}: ${message}`, options)
    this.name = 'WorkspaceManifestValidationError'
    this.path = path
  }
}

export class WorkspaceManifestConflictError extends Error {
  readonly path = WORKSPACE_MANIFEST_PATH

  constructor(message = 'Workspace manifest changed repeatedly while it was being reconciled.') {
    super(message)
    this.name = 'WorkspaceManifestConflictError'
  }
}

type JsonRecord = Record<string, unknown>

const encoder = new TextEncoder()
const DOCUMENT_KEYS = new Set(['format', 'version', 'workspace', 'policies', 'checksums'])
const WORKSPACE_KEYS = new Set(['id', 'createdAt', 'updatedAt'])
const POLICY_KEYS = new Set([
  'checksumAlgorithm',
  'checksumScope',
  'excludedPaths',
  'excludedPathPrefixes',
  'publicLocalization',
  'portableHistory'
])
const LOCALIZATION_POLICY_KEYS = new Set([
  'glossaryPath',
  'translationMemoryPath',
  'checksumCoverage'
])
const HISTORY_POLICY_KEYS = new Set([
  'rootPath',
  'maxRevisionsPerProcess',
  'maxTotalBytes',
  'pruneOrder',
  'preserveNewestPerProcess',
  'checksumCoverage'
])
const CHECKSUM_KEYS = new Set(['path', 'sha256', 'size', 'modifiedAt'])
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const SHA256 = /^[0-9a-f]{64}$/u

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function fail(path: string, message: string, cause?: unknown): never {
  throw new WorkspaceManifestValidationError(path, message, { cause })
}

function requireRecord(value: unknown, path: string): JsonRecord {
  if (!isRecord(value)) fail(path, 'must be an object.')
  return value
}

function requireExactKeys(value: JsonRecord, allowed: ReadonlySet<string>, path: string): void {
  const extra = Object.keys(value).filter((key) => !allowed.has(key))
  if (extra.length > 0) {
    fail(path, `contains unsupported field${extra.length === 1 ? '' : 's'} ${extra.join(', ')}.`)
  }
  const missing = [...allowed].filter((key) => !(key in value))
  if (missing.length > 0) {
    fail(path, `is missing required field${missing.length === 1 ? '' : 's'} ${missing.join(', ')}.`)
  }
}

function requireUuid(value: unknown, path: string): string {
  if (typeof value !== 'string' || !UUID_V4.test(value)) {
    fail(path, 'must be an RFC-4122 version-4 UUID.')
  }
  return value.toLocaleLowerCase('en-US')
}

function requireTimestamp(value: unknown, path: string): string {
  if (typeof value !== 'string') fail(path, 'must be an ISO-8601 timestamp.')
  const time = Date.parse(value)
  if (!Number.isFinite(time) || new Date(time).toISOString() !== value) {
    fail(path, 'must be a canonical UTC ISO-8601 timestamp.')
  }
  return value
}

function checksumPath(pathInput: unknown, path: string): string {
  if (typeof pathInput !== 'string') fail(path, 'must be a workspace-relative path.')
  let normalized: string
  try {
    normalized = normalizeWorkspacePath(pathInput)
  } catch (error) {
    return fail(path, 'must be a normalized workspace-relative path.', error)
  }
  if (normalized !== pathInput) fail(path, 'must already be normalized.')
  if (!isManifestChecksumPath(normalized)) {
    fail(path, 'is excluded by the manifest checksum policy.')
  }
  return normalized
}

function requireChecksum(value: unknown, path: string): WorkspaceManifestChecksum {
  const record = requireRecord(value, path)
  requireExactKeys(record, CHECKSUM_KEYS, path)
  const itemPath = checksumPath(record.path, `${path}.path`)
  if (typeof record.sha256 !== 'string' || !SHA256.test(record.sha256)) {
    fail(`${path}.sha256`, 'must be a lowercase SHA-256 digest.')
  }
  if (!Number.isSafeInteger(record.size) || (record.size as number) < 0) {
    fail(`${path}.size`, 'must be a non-negative safe integer.')
  }
  if (
    typeof record.modifiedAt !== 'number' ||
    !Number.isFinite(record.modifiedAt) ||
    record.modifiedAt < 0
  ) {
    fail(`${path}.modifiedAt`, 'must be a non-negative finite number.')
  }
  return Object.freeze({
    path: itemPath,
    sha256: record.sha256,
    size: record.size as number,
    modifiedAt: record.modifiedAt
  })
}

function requirePolicies(value: unknown, path: string): WorkspaceManifestPolicies {
  const policies = requireRecord(value, path)
  requireExactKeys(policies, POLICY_KEYS, path)
  if (policies.checksumAlgorithm !== 'SHA-256') {
    fail(`${path}.checksumAlgorithm`, 'must be "SHA-256".')
  }
  if (policies.checksumScope !== WORKSPACE_MANIFEST_CHECKSUM_SCOPE) {
    fail(`${path}.checksumScope`, `must be ${JSON.stringify(WORKSPACE_MANIFEST_CHECKSUM_SCOPE)}.`)
  }
  if (
    !Array.isArray(policies.excludedPaths) ||
    policies.excludedPaths.length !== WORKSPACE_MANIFEST_CHECKSUM_EXCLUDED_PATHS.length ||
    policies.excludedPaths.some(
      (item, index) => item !== WORKSPACE_MANIFEST_CHECKSUM_EXCLUDED_PATHS[index]
    )
  ) {
    fail(
      `${path}.excludedPaths`,
      `must exclude only ${JSON.stringify(WORKSPACE_MANIFEST_CHECKSUM_EXCLUDED_PATHS)}.`
    )
  }
  if (
    !Array.isArray(policies.excludedPathPrefixes) ||
    policies.excludedPathPrefixes.length !== WORKSPACE_MANIFEST_CHECKSUM_EXCLUDED_PREFIXES.length ||
    policies.excludedPathPrefixes.some(
      (item, index) => item !== WORKSPACE_MANIFEST_CHECKSUM_EXCLUDED_PREFIXES[index]
    )
  ) {
    fail(
      `${path}.excludedPathPrefixes`,
      `must equal ${JSON.stringify(WORKSPACE_MANIFEST_CHECKSUM_EXCLUDED_PREFIXES)}.`
    )
  }
  const localization = requireRecord(policies.publicLocalization, `${path}.publicLocalization`)
  requireExactKeys(localization, LOCALIZATION_POLICY_KEYS, `${path}.publicLocalization`)
  if (localization.glossaryPath !== WORKSPACE_GLOSSARY_PATH) {
    fail(
      `${path}.publicLocalization.glossaryPath`,
      `must be ${JSON.stringify(WORKSPACE_GLOSSARY_PATH)}.`
    )
  }
  if (localization.translationMemoryPath !== WORKSPACE_TRANSLATION_MEMORY_PATH) {
    fail(
      `${path}.publicLocalization.translationMemoryPath`,
      `must be ${JSON.stringify(WORKSPACE_TRANSLATION_MEMORY_PATH)}.`
    )
  }
  if (localization.checksumCoverage !== WORKSPACE_MANIFEST_LOCALIZATION_CHECKSUM_COVERAGE) {
    fail(
      `${path}.publicLocalization.checksumCoverage`,
      `must be ${JSON.stringify(WORKSPACE_MANIFEST_LOCALIZATION_CHECKSUM_COVERAGE)}.`
    )
  }
  const history = requireRecord(policies.portableHistory, `${path}.portableHistory`)
  requireExactKeys(history, HISTORY_POLICY_KEYS, `${path}.portableHistory`)
  if (history.rootPath !== HISTORY_ROOT) {
    fail(`${path}.portableHistory.rootPath`, `must be ${JSON.stringify(HISTORY_ROOT)}.`)
  }
  if (history.maxRevisionsPerProcess !== DEFAULT_HISTORY_PER_PROCESS) {
    fail(
      `${path}.portableHistory.maxRevisionsPerProcess`,
      `must be ${DEFAULT_HISTORY_PER_PROCESS}.`
    )
  }
  if (history.maxTotalBytes !== DEFAULT_HISTORY_TOTAL_BYTES) {
    fail(`${path}.portableHistory.maxTotalBytes`, `must be ${DEFAULT_HISTORY_TOTAL_BYTES}.`)
  }
  if (history.pruneOrder !== 'oldest-first') {
    fail(`${path}.portableHistory.pruneOrder`, 'must be "oldest-first".')
  }
  if (history.preserveNewestPerProcess !== true) {
    fail(`${path}.portableHistory.preserveNewestPerProcess`, 'must be true.')
  }
  if (history.checksumCoverage !== WORKSPACE_MANIFEST_HISTORY_CHECKSUM_COVERAGE) {
    fail(
      `${path}.portableHistory.checksumCoverage`,
      `must be ${JSON.stringify(WORKSPACE_MANIFEST_HISTORY_CHECKSUM_COVERAGE)}.`
    )
  }
  return workspaceManifestPolicies()
}

function requireChecksums(value: unknown, path: string): readonly WorkspaceManifestChecksum[] {
  if (!Array.isArray(value)) fail(path, 'must be an array.')
  const checksums = value.map((item, index) => requireChecksum(item, `${path}[${index}]`))
  const sorted = [...checksums].sort((left, right) => left.path.localeCompare(right.path))
  if (checksums.some((item, index) => item.path !== sorted[index]?.path)) {
    fail(path, 'must be sorted by path.')
  }
  if (new Set(checksums.map((item) => item.path)).size !== checksums.length) {
    fail(path, 'must not contain duplicate paths.')
  }
  return Object.freeze(checksums)
}

function workspaceManifestPolicies(): WorkspaceManifestPolicies {
  return Object.freeze({
    checksumAlgorithm: 'SHA-256' as const,
    checksumScope: WORKSPACE_MANIFEST_CHECKSUM_SCOPE,
    excludedPaths: WORKSPACE_MANIFEST_CHECKSUM_EXCLUDED_PATHS,
    excludedPathPrefixes: WORKSPACE_MANIFEST_CHECKSUM_EXCLUDED_PREFIXES,
    publicLocalization: Object.freeze({
      glossaryPath: WORKSPACE_GLOSSARY_PATH,
      translationMemoryPath: WORKSPACE_TRANSLATION_MEMORY_PATH,
      checksumCoverage: WORKSPACE_MANIFEST_LOCALIZATION_CHECKSUM_COVERAGE
    }),
    portableHistory: Object.freeze({
      rootPath: HISTORY_ROOT,
      maxRevisionsPerProcess: DEFAULT_HISTORY_PER_PROCESS,
      maxTotalBytes: DEFAULT_HISTORY_TOTAL_BYTES,
      pruneOrder: 'oldest-first' as const,
      preserveNewestPerProcess: true as const,
      checksumCoverage: WORKSPACE_MANIFEST_HISTORY_CHECKSUM_COVERAGE
    })
  })
}

export function isManifestChecksumPath(path: string): boolean {
  let normalized: string
  try {
    normalized = normalizeWorkspacePath(path)
  } catch {
    return false
  }
  return (
    normalized === path &&
    !WORKSPACE_MANIFEST_CHECKSUM_EXCLUDED_PATHS.includes(
      normalized as (typeof WORKSPACE_MANIFEST_CHECKSUM_EXCLUDED_PATHS)[number]
    ) &&
    !WORKSPACE_MANIFEST_CHECKSUM_EXCLUDED_PREFIXES.some((prefix) => normalized.startsWith(prefix))
  )
}

export function createWorkspaceManifestDocument(input: {
  workspaceId: string
  createdAt: string
  updatedAt?: string
  checksums?: readonly WorkspaceManifestChecksum[]
}): WorkspaceManifestDocument {
  const createdAt = requireTimestamp(
    input.createdAt,
    `${WORKSPACE_MANIFEST_PATH}.workspace.createdAt`
  )
  const updatedAt = requireTimestamp(
    input.updatedAt ?? input.createdAt,
    `${WORKSPACE_MANIFEST_PATH}.workspace.updatedAt`
  )
  if (Date.parse(updatedAt) < Date.parse(createdAt)) {
    fail(`${WORKSPACE_MANIFEST_PATH}.workspace.updatedAt`, 'must not precede createdAt.')
  }
  const checksums = requireChecksums(
    [...(input.checksums ?? [])].map((item) => ({ ...item })),
    `${WORKSPACE_MANIFEST_PATH}.checksums`
  )
  return Object.freeze({
    format: WORKSPACE_MANIFEST_FORMAT,
    version: WORKSPACE_MANIFEST_VERSION,
    workspace: Object.freeze({
      id: requireUuid(input.workspaceId, `${WORKSPACE_MANIFEST_PATH}.workspace.id`),
      createdAt,
      updatedAt
    }),
    policies: workspaceManifestPolicies(),
    checksums
  })
}

export function parseWorkspaceManifestJson(
  json: string,
  path = WORKSPACE_MANIFEST_PATH
): WorkspaceManifestDocument {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch (error) {
    return fail(path, 'is not valid JSON.', error)
  }
  const document = requireRecord(parsed, path)
  requireExactKeys(document, DOCUMENT_KEYS, path)
  if (document.format !== WORKSPACE_MANIFEST_FORMAT) {
    fail(`${path}.format`, `must be ${JSON.stringify(WORKSPACE_MANIFEST_FORMAT)}.`)
  }
  if (document.version !== WORKSPACE_MANIFEST_VERSION) {
    fail(`${path}.version`, `must be ${WORKSPACE_MANIFEST_VERSION}.`)
  }
  const workspace = requireRecord(document.workspace, `${path}.workspace`)
  requireExactKeys(workspace, WORKSPACE_KEYS, `${path}.workspace`)
  const id = requireUuid(workspace.id, `${path}.workspace.id`)
  const createdAt = requireTimestamp(workspace.createdAt, `${path}.workspace.createdAt`)
  const updatedAt = requireTimestamp(workspace.updatedAt, `${path}.workspace.updatedAt`)
  if (Date.parse(updatedAt) < Date.parse(createdAt)) {
    fail(`${path}.workspace.updatedAt`, 'must not precede createdAt.')
  }
  requirePolicies(document.policies, `${path}.policies`)
  const checksums = requireChecksums(document.checksums, `${path}.checksums`)
  return createWorkspaceManifestDocument({
    workspaceId: id,
    createdAt,
    updatedAt,
    checksums
  })
}

export function serializeWorkspaceManifest(document: WorkspaceManifestDocument): string {
  const validated = createWorkspaceManifestDocument({
    workspaceId: document.workspace.id,
    createdAt: document.workspace.createdAt,
    updatedAt: document.workspace.updatedAt,
    checksums: document.checksums
  })
  return `${JSON.stringify(validated, null, 2)}\n`
}

function defaultUuid(): string {
  const uuid = globalThis.crypto?.randomUUID?.()
  if (!uuid) {
    throw new WorkspaceOperationError({
      code: 'unsupported',
      operation: 'open',
      path: WORKSPACE_MANIFEST_PATH,
      message: 'A stable workspace UUID requires Web Crypto randomUUID support.'
    })
  }
  return uuid
}

function isNotFound(error: unknown): boolean {
  return error instanceof WorkspaceOperationError && error.code === 'not-found'
}

function cancelled(path = WORKSPACE_MANIFEST_PATH): WorkspaceOperationError {
  return new WorkspaceOperationError({
    code: 'cancelled',
    operation: 'open',
    path,
    message: 'Workspace manifest operation was cancelled.'
  })
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw cancelled()
}

function failureFromOutcome(
  outcome: Exclude<SaveOutcome, { status: 'success' }>
): WorkspaceFailure {
  if ('error' in outcome) return outcome.error
  if (outcome.status === 'stale-workspace') {
    return {
      code: 'stale-workspace',
      operation: 'write',
      path: WORKSPACE_MANIFEST_PATH,
      message: 'The selected workspace changed while its manifest was being written.'
    }
  }
  return {
    code: 'storage-failure',
    operation: 'write',
    path: WORKSPACE_MANIFEST_PATH,
    message: `Workspace manifest write did not complete (${outcome.status}).`
  }
}

interface WorkspaceManifestChecksumCollection {
  readonly checksums: readonly WorkspaceManifestChecksum[]
  readonly warnings: readonly WorkspaceManifestWarning[]
}

export interface CollectWorkspaceManifestChecksumsOptions {
  signal?: AbortSignal
  existingChecksums?: readonly WorkspaceManifestChecksum[]
  onWarning?: (warning: WorkspaceManifestWarning) => void
}

function manifestWarning(path: string, error?: unknown): WorkspaceManifestWarning {
  const detail =
    error instanceof Error
      ? error.message
      : typeof error === 'object' &&
          error !== null &&
          'message' in error &&
          typeof error.message === 'string'
        ? error.message
        : `Workspace file "${path}" is unreadable.`
  return Object.freeze({
    code: 'unreadable-file' as const,
    path,
    message: detail
  })
}

function publishManifestWarning(
  warning: WorkspaceManifestWarning,
  onWarning?: (warning: WorkspaceManifestWarning) => void
): void {
  try {
    onWarning?.(warning)
  } catch {
    // Warning observers are diagnostic and cannot make a healthy bind fail.
  }
}

function checksumFromSnapshot(snapshot: FileSnapshot): WorkspaceManifestChecksum {
  return Object.freeze({
    path: snapshot.path,
    sha256: snapshot.hash,
    size: snapshot.size,
    modifiedAt: snapshot.modifiedAt
  })
}

function isCancellationError(error: unknown): boolean {
  return (
    (error instanceof WorkspaceOperationError && error.code === 'cancelled') ||
    (typeof DOMException !== 'undefined' &&
      error instanceof DOMException &&
      error.name === 'AbortError')
  )
}

async function collectManifestChecksumsFromEntries(
  adapter: WorkspaceAdapter,
  entries: readonly WorkspaceEntry[],
  options: CollectWorkspaceManifestChecksumsOptions = {}
): Promise<WorkspaceManifestChecksumCollection> {
  const existing = new Map(
    (options.existingChecksums ?? []).map((checksum) => [checksum.path, checksum])
  )
  const checksums: WorkspaceManifestChecksum[] = []
  const warnings: WorkspaceManifestWarning[] = []
  for (const entry of [...entries].sort((left, right) => left.path.localeCompare(right.path))) {
    throwIfAborted(options.signal)
    if (entry.kind !== 'file' || !isManifestChecksumPath(entry.path)) continue
    let snapshot: FileSnapshot | undefined
    let warning: WorkspaceManifestWarning | undefined
    if (!entry.readable) {
      warning = manifestWarning(entry.path, entry.issue)
    } else {
      try {
        snapshot = await adapter.read(entry.path)
      } catch (error) {
        throwIfAborted(options.signal)
        if (isCancellationError(error)) throw error
        warning = manifestWarning(entry.path, error)
      }
    }
    if (snapshot && snapshot.path !== entry.path) {
      warning = manifestWarning(
        entry.path,
        new Error(`Workspace read returned unexpected path "${snapshot.path}".`)
      )
      snapshot = undefined
    }
    if (snapshot) {
      checksums.push(checksumFromSnapshot(snapshot))
      continue
    }
    const preserved = existing.get(entry.path)
    if (preserved) checksums.push(preserved)
    if (warning) {
      warnings.push(warning)
      publishManifestWarning(warning, options.onWarning)
    }
  }
  checksums.sort((left, right) => left.path.localeCompare(right.path))
  warnings.sort((left, right) => left.path.localeCompare(right.path))
  return Object.freeze({
    checksums: Object.freeze(checksums),
    warnings: Object.freeze(warnings)
  })
}

async function collectWorkspaceManifestChecksumState(
  adapter: WorkspaceAdapter,
  options: CollectWorkspaceManifestChecksumsOptions = {}
): Promise<WorkspaceManifestChecksumCollection> {
  throwIfAborted(options.signal)
  return collectManifestChecksumsFromEntries(adapter, await adapter.list(), options)
}

export async function collectWorkspaceManifestChecksums(
  adapter: WorkspaceAdapter,
  options: CollectWorkspaceManifestChecksumsOptions = {}
): Promise<readonly WorkspaceManifestChecksum[]> {
  return (await collectWorkspaceManifestChecksumState(adapter, options)).checksums
}

function sameChecksums(
  left: readonly WorkspaceManifestChecksum[],
  right: readonly WorkspaceManifestChecksum[]
): boolean {
  return (
    left.length === right.length &&
    left.every(
      (item, index) =>
        item.path === right[index]?.path &&
        item.sha256 === right[index]?.sha256 &&
        item.size === right[index]?.size &&
        item.modifiedAt === right[index]?.modifiedAt
    )
  )
}

async function readManifest(adapter: WorkspaceAdapter): Promise<{
  document: WorkspaceManifestDocument
  snapshot: FileSnapshot
}> {
  const snapshot = await adapter.read(WORKSPACE_MANIFEST_PATH)
  const document = parseWorkspaceManifestJson(
    decodeUtf8Strict(snapshot.bytes, {
      operation: 'read',
      path: WORKSPACE_MANIFEST_PATH
    })
  )
  return { document, snapshot }
}

function assertManifestWorkspace(adapter: WorkspaceAdapter): void {
  if (!adapter.storage.capabilities.multipleFiles || !adapter.storage.capabilities.directories) {
    throw new WorkspaceOperationError({
      code: 'unsupported',
      operation: 'open',
      path: WORKSPACE_MANIFEST_PATH,
      message: 'A public workspace manifest requires a directory or browser workspace.'
    })
  }
}

/**
 * Loads or creates the public manifest and reconciles its advisory public-file
 * checksum snapshot with compare-and-set protection. The stable UUID comes
 * from the persisted document; adapter/display names never become identity.
 * The manifest itself, managed history revisions, and recoverable transaction
 * staging are excluded. Public localization resources remain covered.
 */
export async function ensureWorkspaceManifest(
  adapter: WorkspaceAdapter,
  options: EnsureWorkspaceManifestOptions = {}
): Promise<WorkspaceManifestState> {
  assertManifestWorkspace(adapter)
  const now = options.now ?? (() => new Date())
  const createUuid = options.createUuid ?? defaultUuid
  const maxAttempts = options.maxAttempts ?? 4
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new Error('maxAttempts must be a positive integer')
  }

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    throwIfAborted(options.signal)
    let current: { document: WorkspaceManifestDocument; snapshot: FileSnapshot } | undefined
    try {
      current = await readManifest(adapter)
    } catch (error) {
      if (!isNotFound(error)) throw error
    }
    const collection = await collectWorkspaceManifestChecksumState(adapter, {
      signal: options.signal,
      existingChecksums: current?.document.checksums,
      onWarning: options.onWarning
    })
    const { checksums, warnings } = collection
    throwIfAborted(options.signal)

    if (!current) {
      const timestamp = now().toISOString()
      const document = createWorkspaceManifestDocument({
        workspaceId: createUuid(),
        createdAt: timestamp,
        checksums
      })
      await adapter.createFolder('.orbitpm')
      const outcome = await adapter.writeAtomic(
        WORKSPACE_MANIFEST_PATH,
        encoder.encode(serializeWorkspaceManifest(document)),
        undefined,
        {
          expectedWorkspaceId: adapter.id,
          expectedMissing: true,
          signal: options.signal
        }
      )
      if (outcome.status === 'success') {
        return Object.freeze({
          document,
          snapshot: outcome.snapshot,
          created: true,
          reconciled: false,
          warnings
        })
      }
      if (outcome.status === 'external-conflict') continue
      throw new WorkspaceOperationError(failureFromOutcome(outcome))
    }

    if (sameChecksums(current.document.checksums, checksums)) {
      return Object.freeze({
        ...current,
        created: false,
        reconciled: false,
        warnings
      })
    }
    const document = createWorkspaceManifestDocument({
      workspaceId: current.document.workspace.id,
      createdAt: current.document.workspace.createdAt,
      updatedAt: now().toISOString(),
      checksums
    })
    const outcome = await adapter.writeAtomic(
      WORKSPACE_MANIFEST_PATH,
      encoder.encode(serializeWorkspaceManifest(document)),
      current.snapshot.hash,
      {
        expectedWorkspaceId: adapter.id,
        signal: options.signal
      }
    )
    if (outcome.status === 'success') {
      return Object.freeze({
        document,
        snapshot: outcome.snapshot,
        created: false,
        reconciled: true,
        warnings
      })
    }
    if (outcome.status === 'external-conflict') continue
    throw new WorkspaceOperationError(failureFromOutcome(outcome))
  }
  throw new WorkspaceManifestConflictError()
}

function isManifestOrAncestor(pathInput: string): boolean {
  let path: string
  try {
    path = normalizeWorkspacePath(pathInput)
  } catch {
    return false
  }
  return path === WORKSPACE_MANIFEST_PATH || WORKSPACE_MANIFEST_PATH.startsWith(`${path}/`)
}

function staleWorkspaceOutcome(
  expectedWorkspaceId: string,
  actualWorkspaceId: string
): SaveOutcome {
  return {
    ok: false,
    status: 'stale-workspace',
    expectedWorkspaceId,
    actualWorkspaceId
  }
}

function reservedManifestWriteOutcome(): SaveOutcome {
  return {
    ok: false,
    status: 'storage-failure',
    error: {
      code: 'unsupported',
      operation: 'write',
      path: WORKSPACE_MANIFEST_PATH,
      message: 'The workspace manifest is maintained by the manifest-bound adapter.'
    }
  }
}

function pathIsSameOrDescendant(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}/`)
}

function relocateManifestPath(path: string, from: string, to: string): string {
  return `${to}${path.slice(from.length)}`
}

function isFullyExcludedChecksumSubtree(pathInput: string): boolean {
  const path = normalizeWorkspacePath(pathInput)
  if (path === WORKSPACE_MANIFEST_PATH) return true
  return WORKSPACE_MANIFEST_CHECKSUM_EXCLUDED_PREFIXES.some((prefix) => {
    const root = prefix.slice(0, -1)
    return pathIsSameOrDescendant(path, root)
  })
}

function normalizedManifestWarnings(
  warnings: readonly WorkspaceManifestWarning[]
): readonly WorkspaceManifestWarning[] {
  const byPath = new Map<string, WorkspaceManifestWarning>()
  for (const warning of warnings) byPath.set(warning.path, warning)
  return Object.freeze(
    [...byPath.values()].sort((left, right) => left.path.localeCompare(right.path))
  )
}

function sameManifestWarnings(
  left: readonly WorkspaceManifestWarning[],
  right: readonly WorkspaceManifestWarning[]
): boolean {
  return (
    left.length === right.length &&
    left.every(
      (warning, index) =>
        warning.code === right[index]?.code &&
        warning.path === right[index]?.path &&
        warning.message === right[index]?.message
    )
  )
}

/**
 * Production-facing adapter identity. The backing adapter may use a directory
 * handle/display-derived provisional id, but all sessions, draft keys,
 * BroadcastChannel names, and backup manifests see the persisted workspace
 * UUID through this wrapper.
 */
export class ManifestBoundWorkspaceAdapter implements WorkspaceAdapter {
  readonly id: string
  readonly mode: WorkspaceAdapter['mode']
  readonly storage: WorkspaceAdapter['storage']

  readonly #backing: WorkspaceAdapter
  readonly #now?: () => Date
  readonly #maxAttempts?: number
  readonly #onManifestError?: (error: unknown) => void
  readonly #onManifestWarning?: (warning: WorkspaceManifestWarning) => void
  #manifest: WorkspaceManifestState
  #manifestTail: Promise<void> = Promise.resolve()
  #lastManifestError: unknown
  #needsFullReconciliation = false

  constructor(
    backing: WorkspaceAdapter,
    manifest: WorkspaceManifestState,
    options: BindWorkspaceToManifestOptions = {}
  ) {
    if (
      manifest.document.workspace.id === backing.id &&
      backing instanceof ManifestBoundWorkspaceAdapter
    ) {
      throw new Error('A manifest-bound adapter must not wrap another manifest-bound adapter.')
    }
    this.#backing = backing
    this.#manifest = manifest
    this.id = manifest.document.workspace.id
    this.mode = backing.mode
    this.storage = backing.storage
    this.#now = options.now
    this.#maxAttempts = options.maxAttempts
    this.#onManifestError = options.onManifestError
    this.#onManifestWarning = options.onManifestWarning ?? options.onWarning
  }

  get manifest(): WorkspaceManifestState {
    return this.#manifest
  }

  get lastManifestError(): unknown {
    return this.#lastManifestError
  }

  list(path?: string): Promise<WorkspaceEntry[]> {
    return this.#backing.list(path)
  }

  read(path: string): Promise<FileSnapshot> {
    return this.#backing.read(path)
  }

  async writeAtomic(
    path: string,
    bytes: Uint8Array,
    expectedHash?: string,
    options: WriteAtomicOptions = {}
  ): Promise<SaveOutcome> {
    if (options.expectedWorkspaceId !== undefined && options.expectedWorkspaceId !== this.id) {
      return staleWorkspaceOutcome(options.expectedWorkspaceId, this.id)
    }
    const normalized = normalizeWorkspacePath(path)
    if (normalized === WORKSPACE_MANIFEST_PATH) return reservedManifestWriteOutcome()
    const outcome = await this.#backing.writeAtomic(normalized, bytes, expectedHash, {
      ...options,
      expectedWorkspaceId: options.expectedWorkspaceId === undefined ? undefined : this.#backing.id
    })
    if (outcome.status === 'success' && isManifestChecksumPath(normalized)) {
      await this.#afterCommittedMutation(async () => {
        const checksum = checksumFromSnapshot(outcome.snapshot)
        const checksums = this.#manifest.document.checksums.filter(
          (item) => item.path !== normalized
        )
        checksums.push(checksum)
        await this.#commitIncrementalManifest(
          checksums,
          this.#manifest.warnings.filter((warning) => warning.path !== normalized)
        )
      })
    }
    return outcome
  }

  async rename(from: string, to: string): Promise<void> {
    this.#assertManifestIsNotMoved(from, to, 'rename')
    const source = normalizeWorkspacePath(from)
    const destination = normalizeWorkspacePath(to)
    await this.#backing.rename(source, destination)
    if (!isFullyExcludedChecksumSubtree(source) || !isFullyExcludedChecksumSubtree(destination)) {
      await this.#afterCommittedMutation(() => this.#applyRelocationDelta(source, destination))
    }
  }

  async move(from: string, to: string): Promise<void> {
    this.#assertManifestIsNotMoved(from, to, 'move')
    const source = normalizeWorkspacePath(from)
    const destination = normalizeWorkspacePath(to)
    await this.#backing.move(source, destination)
    if (!isFullyExcludedChecksumSubtree(source) || !isFullyExcludedChecksumSubtree(destination)) {
      await this.#afterCommittedMutation(() => this.#applyRelocationDelta(source, destination))
    }
  }

  async remove(path: string): Promise<void> {
    const normalized = normalizeWorkspacePath(path)
    if (isManifestOrAncestor(normalized)) {
      throw new WorkspaceOperationError({
        code: 'unsupported',
        operation: 'remove',
        path: normalized,
        message:
          'The manifest or its parent metadata folder cannot be removed through this adapter.'
      })
    }
    await this.#backing.remove(normalized)
    if (!isFullyExcludedChecksumSubtree(normalized)) {
      await this.#afterCommittedMutation(async () => {
        await this.#commitIncrementalManifest(
          this.#manifest.document.checksums.filter(
            (checksum) => !pathIsSameOrDescendant(checksum.path, normalized)
          ),
          this.#manifest.warnings.filter(
            (warning) => !pathIsSameOrDescendant(warning.path, normalized)
          )
        )
      })
    }
  }

  createFolder(path: string): Promise<void> {
    return this.#backing.createFolder(path)
  }

  exportBackup(options?: BackupExportOptions): Promise<Blob> {
    return exportWorkspaceBackup(this, options)
  }

  /**
   * Explicit retry surface for a prior post-commit manifest warning. Ordinary
   * successful mutations stay incremental; this method intentionally performs
   * a complete bounded reconciliation.
   */
  async reconcileManifest(): Promise<WorkspaceManifestState> {
    const reconcile = this.#manifestTail
      .then(async () => {
        await this.#fullReconcile()
        this.#lastManifestError = undefined
      })
      .catch((error) => {
        this.#needsFullReconciliation = true
        this.#reportManifestError(error)
        throw error
      })
    this.#manifestTail = reconcile.then(
      () => undefined,
      () => undefined
    )
    await reconcile
    return this.#manifest
  }

  #assertManifestIsNotMoved(from: string, to: string, operation: 'rename' | 'move'): void {
    if (!isManifestOrAncestor(from) && normalizeWorkspacePath(to) !== WORKSPACE_MANIFEST_PATH) {
      return
    }
    throw new WorkspaceOperationError({
      code: 'unsupported',
      operation,
      path: normalizeWorkspacePath(from),
      message: 'The workspace manifest cannot be renamed or moved.'
    })
  }

  async #afterCommittedMutation(update: () => Promise<void>): Promise<void> {
    const task = this.#manifestTail
      .then(async () => {
        if (this.#needsFullReconciliation) {
          await this.#fullReconcile()
        } else {
          await update()
        }
        this.#lastManifestError = undefined
      })
      .catch((error) => {
        this.#needsFullReconciliation = true
        this.#reportManifestError(error)
        throw error
      })
    this.#manifestTail = task.then(
      () => undefined,
      () => undefined
    )
    try {
      await task
    } catch {
      // The backing mutation committed; its separate manifest error is surfaced
      // through lastManifestError/onManifestError and retried by the next task.
    }
  }

  async #commitIncrementalManifest(
    checksumsInput: readonly WorkspaceManifestChecksum[],
    warningsInput: readonly WorkspaceManifestWarning[]
  ): Promise<void> {
    const checksums = [...checksumsInput].sort((left, right) => left.path.localeCompare(right.path))
    const warnings = normalizedManifestWarnings(warningsInput)
    if (
      sameChecksums(this.#manifest.document.checksums, checksums) &&
      sameManifestWarnings(this.#manifest.warnings, warnings)
    ) {
      return
    }
    if (sameChecksums(this.#manifest.document.checksums, checksums)) {
      this.#manifest = Object.freeze({
        ...this.#manifest,
        warnings
      })
      return
    }

    const document = createWorkspaceManifestDocument({
      workspaceId: this.id,
      createdAt: this.#manifest.document.workspace.createdAt,
      updatedAt: (this.#now?.() ?? new Date()).toISOString(),
      checksums
    })
    const outcome = await this.#backing.writeAtomic(
      WORKSPACE_MANIFEST_PATH,
      encoder.encode(serializeWorkspaceManifest(document)),
      this.#manifest.snapshot.hash,
      {
        expectedWorkspaceId: this.#backing.id
      }
    )
    if (outcome.status === 'external-conflict') {
      await this.#fullReconcile()
      return
    }
    if (outcome.status !== 'success') {
      throw new WorkspaceOperationError(failureFromOutcome(outcome))
    }
    this.#manifest = Object.freeze({
      document,
      snapshot: outcome.snapshot,
      created: false,
      reconciled: true,
      warnings
    })
  }

  async #applyRelocationDelta(source: string, destination: string): Promise<void> {
    const relocatedExisting = new Map<string, WorkspaceManifestChecksum>()
    for (const checksum of this.#manifest.document.checksums) {
      if (!pathIsSameOrDescendant(checksum.path, source)) continue
      const path = relocateManifestPath(checksum.path, source, destination)
      if (!isManifestChecksumPath(path)) continue
      relocatedExisting.set(
        path,
        Object.freeze({
          ...checksum,
          path
        })
      )
    }

    const collected = isFullyExcludedChecksumSubtree(destination)
      ? { checksums: Object.freeze([]), warnings: Object.freeze([]) }
      : await this.#collectRelocationDestination(source, destination, relocatedExisting)
    const checksums = this.#manifest.document.checksums.filter(
      (checksum) => !pathIsSameOrDescendant(checksum.path, source)
    )
    checksums.push(...collected.checksums)
    const warnings = this.#manifest.warnings.filter(
      (warning) => !pathIsSameOrDescendant(warning.path, source)
    )
    warnings.push(...collected.warnings)
    await this.#commitIncrementalManifest(checksums, warnings)
  }

  async #collectRelocationDestination(
    source: string,
    destination: string,
    existing: ReadonlyMap<string, WorkspaceManifestChecksum>
  ): Promise<WorkspaceManifestChecksumCollection> {
    const sourceWasTrackedFile = this.#manifest.document.checksums.some(
      (checksum) => checksum.path === source
    )
    if (sourceWasTrackedFile) {
      return this.#collectRelocatedFile(destination, existing)
    }
    try {
      const entries = await this.#backing.list(destination)
      return collectManifestChecksumsFromEntries(this.#backing, entries, {
        existingChecksums: [...existing.values()],
        onWarning: (warning) => this.#publishWarning(warning)
      })
    } catch (error) {
      if (error instanceof WorkspaceOperationError && error.code === 'not-a-directory') {
        return this.#collectRelocatedFile(destination, existing)
      }
      throw error
    }
  }

  async #collectRelocatedFile(
    destination: string,
    existing: ReadonlyMap<string, WorkspaceManifestChecksum>
  ): Promise<WorkspaceManifestChecksumCollection> {
    if (!isManifestChecksumPath(destination)) {
      return Object.freeze({
        checksums: Object.freeze([]),
        warnings: Object.freeze([])
      })
    }
    try {
      const snapshot = await this.#backing.read(destination)
      return Object.freeze({
        checksums: Object.freeze([checksumFromSnapshot(snapshot)]),
        warnings: Object.freeze([])
      })
    } catch (error) {
      if (error instanceof WorkspaceOperationError && error.code === 'not-a-file') {
        const entries = await this.#backing.list(destination)
        return collectManifestChecksumsFromEntries(this.#backing, entries, {
          existingChecksums: [...existing.values()],
          onWarning: (warning) => this.#publishWarning(warning)
        })
      }
      const warning = manifestWarning(destination, error)
      this.#publishWarning(warning)
      const preserved = existing.get(destination)
      return Object.freeze({
        checksums: Object.freeze(preserved ? [preserved] : []),
        warnings: Object.freeze([warning])
      })
    }
  }

  async #fullReconcile(): Promise<void> {
    const next = await ensureWorkspaceManifest(this.#backing, {
      now: this.#now,
      createUuid: () => this.id,
      maxAttempts: this.#maxAttempts,
      onWarning: (warning) => this.#publishWarning(warning)
    })
    if (next.document.workspace.id !== this.id) {
      throw new WorkspaceManifestValidationError(
        `${WORKSPACE_MANIFEST_PATH}.workspace.id`,
        `changed from bound id ${JSON.stringify(this.id)}.`
      )
    }
    this.#manifest = next
    this.#needsFullReconciliation = false
  }

  #publishWarning(warning: WorkspaceManifestWarning): void {
    publishManifestWarning(warning, this.#onManifestWarning)
  }

  #reportManifestError(error: unknown): void {
    this.#lastManifestError = error
    try {
      this.#onManifestError?.(error)
    } catch {
      // Diagnostics must never turn an already-committed mutation into a lie.
    }
  }
}

export async function bindWorkspaceToManifest(
  backing: WorkspaceAdapter,
  options: BindWorkspaceToManifestOptions = {}
): Promise<ManifestBoundWorkspace> {
  if (backing instanceof ManifestBoundWorkspaceAdapter) {
    return Object.freeze({
      adapter: backing,
      manifest: backing.manifest
    })
  }
  const manifest = await ensureWorkspaceManifest(backing, {
    ...options,
    onWarning: options.onManifestWarning ?? options.onWarning
  })
  return Object.freeze({
    adapter: new ManifestBoundWorkspaceAdapter(backing, manifest, options),
    manifest
  })
}
