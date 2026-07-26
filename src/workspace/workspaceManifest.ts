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
}

export interface EnsureWorkspaceManifestOptions {
  now?: () => Date
  createUuid?: () => string
  signal?: AbortSignal
  maxAttempts?: number
}

export interface BindWorkspaceToManifestOptions extends EnsureWorkspaceManifestOptions {
  /**
   * Manifest refresh errors happen after the requested storage mutation has
   * committed, so they are reported separately rather than misrepresenting the
   * original write/rename/move/remove as failed.
   */
  onManifestError?: (error: unknown) => void
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

function unreadableEntry(entry: WorkspaceEntry): WorkspaceOperationError {
  return new WorkspaceOperationError(
    entry.issue ?? {
      code: 'storage-failure',
      operation: 'read',
      path: entry.path,
      message: `Workspace file "${entry.path}" is unreadable.`
    }
  )
}

export async function collectWorkspaceManifestChecksums(
  adapter: WorkspaceAdapter,
  options: { signal?: AbortSignal } = {}
): Promise<readonly WorkspaceManifestChecksum[]> {
  throwIfAborted(options.signal)
  const entries = (await adapter.list())
    .filter((entry) => entry.kind === 'file' && isManifestChecksumPath(entry.path))
    .sort((left, right) => left.path.localeCompare(right.path))
  const checksums: WorkspaceManifestChecksum[] = []
  for (const entry of entries) {
    throwIfAborted(options.signal)
    if (!entry.readable) throw unreadableEntry(entry)
    const snapshot = await adapter.read(entry.path)
    checksums.push(
      Object.freeze({
        path: snapshot.path,
        sha256: snapshot.hash,
        size: snapshot.size,
        modifiedAt: snapshot.modifiedAt
      })
    )
  }
  return Object.freeze(checksums)
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
    const checksums = await collectWorkspaceManifestChecksums(adapter, {
      signal: options.signal
    })
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
          reconciled: false
        })
      }
      if (outcome.status === 'external-conflict') continue
      throw new WorkspaceOperationError(failureFromOutcome(outcome))
    }

    if (sameChecksums(current.document.checksums, checksums)) {
      return Object.freeze({
        ...current,
        created: false,
        reconciled: false
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
        reconciled: true
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
  #manifest: WorkspaceManifestState
  #manifestTail: Promise<void> = Promise.resolve()
  #lastManifestError: unknown

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
      await this.#reconcileAfterCommittedMutation()
    }
    return outcome
  }

  async rename(from: string, to: string): Promise<void> {
    this.#assertManifestIsNotMoved(from, to, 'rename')
    await this.#backing.rename(from, to)
    if (isManifestChecksumPath(from) || isManifestChecksumPath(to)) {
      await this.#reconcileAfterCommittedMutation()
    }
  }

  async move(from: string, to: string): Promise<void> {
    this.#assertManifestIsNotMoved(from, to, 'move')
    await this.#backing.move(from, to)
    if (isManifestChecksumPath(from) || isManifestChecksumPath(to)) {
      await this.#reconcileAfterCommittedMutation()
    }
  }

  async remove(path: string): Promise<void> {
    if (isManifestOrAncestor(path)) {
      throw new WorkspaceOperationError({
        code: 'unsupported',
        operation: 'remove',
        path: normalizeWorkspacePath(path),
        message:
          'The manifest or its parent metadata folder cannot be removed through this adapter.'
      })
    }
    await this.#backing.remove(path)
    if (isManifestChecksumPath(path)) await this.#reconcileAfterCommittedMutation()
  }

  createFolder(path: string): Promise<void> {
    return this.#backing.createFolder(path)
  }

  exportBackup(options?: BackupExportOptions): Promise<Blob> {
    return exportWorkspaceBackup(this, options)
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

  async #reconcileAfterCommittedMutation(): Promise<void> {
    const reconcile = this.#manifestTail.then(async () => {
      const next = await ensureWorkspaceManifest(this.#backing, {
        now: this.#now,
        createUuid: () => this.id,
        maxAttempts: this.#maxAttempts
      })
      if (next.document.workspace.id !== this.id) {
        throw new WorkspaceManifestValidationError(
          `${WORKSPACE_MANIFEST_PATH}.workspace.id`,
          `changed from bound id ${JSON.stringify(this.id)}.`
        )
      }
      this.#manifest = next
      this.#lastManifestError = undefined
    })
    this.#manifestTail = reconcile.catch(() => undefined)
    try {
      await reconcile
    } catch (error) {
      this.#lastManifestError = error
      try {
        this.#onManifestError?.(error)
      } catch {
        // Diagnostics must never turn an already-committed mutation into a lie.
      }
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
  const manifest = await ensureWorkspaceManifest(backing, options)
  return Object.freeze({
    adapter: new ManifestBoundWorkspaceAdapter(backing, manifest, options),
    manifest
  })
}
