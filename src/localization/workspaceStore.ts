import {
  WorkspaceOperationError,
  WorkspaceReadLimitError,
  type FileSnapshot,
  type SaveOutcome,
  type WorkspaceAdapter
} from '../workspace/adapters'
import { createSeededGlossary, normalizeLocalizationLookup } from './glossary'
import { validateTargetScript } from './script'
import type { GlossaryEntry, LocalizationResources, TranslationMemoryEntry } from './types'

export const WORKSPACE_LOCALIZATION_ROOT = '.orbitpm/i18n'
export const WORKSPACE_GLOSSARY_PATH = `${WORKSPACE_LOCALIZATION_ROOT}/glossary.json`
export const WORKSPACE_TRANSLATION_MEMORY_PATH = `${WORKSPACE_LOCALIZATION_ROOT}/translation-memory.json`
export const WORKSPACE_LOCALIZATION_SCHEMA_VERSION = 1 as const
export const WORKSPACE_GLOSSARY_FORMAT = 'orbitpm-localization-glossary' as const
export const WORKSPACE_TRANSLATION_MEMORY_FORMAT =
  'orbitpm-localization-translation-memory' as const

/**
 * Public localization limits keep validation, JSON encoding, and final atomic
 * writes bounded. Translation-memory batches above their separate batch limit
 * fail visibly; no accepted pair is silently omitted.
 */
export const WORKSPACE_GLOSSARY_LIMITS = Object.freeze({
  maxEntries: 20_000,
  maxEntryTextCodeUnits: 8_192,
  maxDocumentTextCodeUnits: 2_000_000,
  maxFileBytes: 10 * 1024 * 1024,
  maxJsonDepth: 8,
  maxJsonStructuralItems: 300_000
})

export const WORKSPACE_TRANSLATION_MEMORY_LIMITS = Object.freeze({
  maxEntries: 20_000,
  maxBatchEntries: 10_000,
  maxEntryTextCodeUnits: 8_192,
  maxDocumentTextCodeUnits: 2_000_000,
  maxFileBytes: 10 * 1024 * 1024,
  maxJsonDepth: 8,
  maxJsonStructuralItems: 300_000,
  cooperativeChunkSize: 128
})

/**
 * Public-workspace contract.
 *
 * These files are portable user data: directory users can inspect/share them,
 * OPFS users receive them in complete workspace backups, and backup restore
 * writes them back. They may contain approved terminology and explicitly
 * accepted bilingual pairs only. Provider candidates, drafts, credentials,
 * and browser-private preferences must never be written here.
 */
export const WORKSPACE_LOCALIZATION_PUBLIC_CONTRACT = Object.freeze({
  scope: 'public-workspace',
  rootPath: WORKSPACE_LOCALIZATION_ROOT,
  files: Object.freeze([WORKSPACE_GLOSSARY_PATH, WORKSPACE_TRANSLATION_MEMORY_PATH]),
  includedInWorkspaceBackup: true,
  acceptedTranslationPairsOnly: true
})

export interface WorkspaceGlossaryDocument {
  readonly format: typeof WORKSPACE_GLOSSARY_FORMAT
  readonly version: typeof WORKSPACE_LOCALIZATION_SCHEMA_VERSION
  readonly entries: readonly GlossaryEntry[]
}

export interface WorkspaceTranslationMemoryDocument {
  readonly format: typeof WORKSPACE_TRANSLATION_MEMORY_FORMAT
  readonly version: typeof WORKSPACE_LOCALIZATION_SCHEMA_VERSION
  readonly entries: readonly TranslationMemoryEntry[]
}

export interface ParsedWorkspaceLocalizationDocument<Document> {
  readonly document: Document
  /** A legacy top-level entry array needs a compare-and-set v1 rewrite. */
  readonly migratedFromLegacyArray: boolean
}

export interface WorkspaceLocalizationFile<Document> {
  readonly path: string
  readonly document: Document
  readonly hash: string
  readonly size: number
  readonly modifiedAt: number
}

export interface WorkspaceLocalizationState {
  readonly files: {
    readonly glossary: WorkspaceLocalizationFile<WorkspaceGlossaryDocument>
    readonly translationMemory: WorkspaceLocalizationFile<WorkspaceTranslationMemoryDocument>
  }
  /**
   * Structurally compatible with `prepareLocalizationIngestion`,
   * `planLocalResourceApplication`, and `inspectDiagramLocalization` options.
   */
  readonly resources: LocalizationResources
}

export interface WorkspaceLocalizationWriteOptions {
  signal?: AbortSignal
  /** Optional caller-view precondition for whole-array editor replacements. */
  expectedHash?: string
}

export interface WorkspaceLocalizationStoreOptions {
  now?: () => Date
  /** Injectable for deterministic tests; production yields to the next task. */
  cooperativeYield?: () => Promise<void>
}

export interface AcceptTranslationPairInput {
  en: string
  ar: string
  acceptedAt?: string
}

export type GlossaryEditor = (draft: GlossaryEntry[]) => void | readonly GlossaryEntry[]

export type TranslationMemoryEditor = (
  draft: TranslationMemoryEntry[]
) => void | readonly TranslationMemoryEntry[]

export type WorkspaceLocalizationErrorCode =
  'invalid-resource' | 'external-conflict' | 'resource-limit' | 'partial-load'

export class WorkspaceLocalizationValidationError extends Error {
  readonly code = 'invalid-resource' satisfies WorkspaceLocalizationErrorCode
  readonly path: string

  constructor(path: string, message: string, options: { cause?: unknown } = {}) {
    super(`${path}: ${message}`, options)
    this.name = 'WorkspaceLocalizationValidationError'
    this.path = path
  }
}

export class WorkspaceLocalizationConflictError extends Error {
  readonly code = 'external-conflict' satisfies WorkspaceLocalizationErrorCode
  readonly path: string
  readonly reason: 'hash-mismatch' | 'missing' | 'already-exists'
  readonly expectedHash?: string
  readonly actualHash?: string

  constructor(path: string, outcome: Extract<SaveOutcome, { status: 'external-conflict' }>) {
    super(`Public localization file "${path}" changed outside this editor. Reload before saving.`)
    this.name = 'WorkspaceLocalizationConflictError'
    this.path = path
    this.reason = outcome.reason
    this.expectedHash = outcome.expectedHash
    this.actualHash = outcome.actual?.hash
  }
}

export class WorkspaceLocalizationResourceLimitError extends Error {
  readonly code = 'resource-limit' satisfies WorkspaceLocalizationErrorCode
  readonly scope: 'glossary' | 'translation-memory'
  readonly resource:
    | 'entries'
    | 'batch-entries'
    | 'entry-text'
    | 'document-text'
    | 'file-bytes'
    | 'json-depth'
    | 'json-items'
  readonly limit: number
  readonly actual: number

  constructor(
    scope: WorkspaceLocalizationResourceLimitError['scope'],
    resource: WorkspaceLocalizationResourceLimitError['resource'],
    limit: number,
    actual: number
  ) {
    super(
      `${scope === 'glossary' ? 'Glossary' : 'Translation memory'} ${resource} limit is ${limit}; received ${actual}.`
    )
    this.name = 'WorkspaceLocalizationResourceLimitError'
    this.scope = scope
    this.resource = resource
    this.limit = limit
    this.actual = actual
  }
}

export class WorkspaceLocalizationPartialLoadError extends Error {
  readonly code = 'partial-load' satisfies WorkspaceLocalizationErrorCode
  readonly committedPaths: readonly string[]

  constructor(committedPaths: readonly string[], cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause)
    super(
      `Localization load committed ${committedPaths.map((path) => `"${path}"`).join(', ')} before a later resource operation failed: ${detail}`,
      { cause }
    )
    this.name = 'WorkspaceLocalizationPartialLoadError'
    this.committedPaths = Object.freeze([...committedPaths])
  }
}

type JsonRecord = Record<string, unknown>

const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true })
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/u
const ISO_DATE_TIME =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-](\d{2}):(\d{2}))$/u
const GLOSSARY_DOCUMENT_KEYS = new Set(['format', 'version', 'entries'])
const TRANSLATION_MEMORY_DOCUMENT_KEYS = new Set(['format', 'version', 'entries'])
const GLOSSARY_ENTRY_KEYS = new Set(['en', 'ar', 'neutral'])
const TRANSLATION_MEMORY_ENTRY_KEYS = new Set(['en', 'ar', 'accepted', 'acceptedAt'])

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function fail(path: string, message: string, cause?: unknown): never {
  throw new WorkspaceLocalizationValidationError(path, message, { cause })
}

function requireExactKeys(value: JsonRecord, allowed: ReadonlySet<string>, path: string): void {
  const unexpected = Object.keys(value).filter((key) => !allowed.has(key))
  if (unexpected.length > 0) {
    fail(
      path,
      `contains unsupported field${unexpected.length === 1 ? '' : 's'} ${unexpected
        .map((key) => JSON.stringify(key))
        .join(', ')}.`
    )
  }
}

function normalizedEntryText(value: unknown, path: string): string {
  if (typeof value !== 'string') fail(path, 'must be a string.')
  if (CONTROL_CHARACTER.test(value)) fail(path, 'must not contain control characters.')
  const normalized = normalizeLocalizationLookup(value)
  if (!normalized) fail(path, 'must not be empty.')
  return normalized
}

function glossaryEntryText(value: unknown, path: string): string {
  if (typeof value === 'string' && value.length > WORKSPACE_GLOSSARY_LIMITS.maxEntryTextCodeUnits) {
    throw new WorkspaceLocalizationResourceLimitError(
      'glossary',
      'entry-text',
      WORKSPACE_GLOSSARY_LIMITS.maxEntryTextCodeUnits,
      value.length
    )
  }
  return normalizedEntryText(value, path)
}

function translationMemoryEntryText(value: unknown, path: string): string {
  if (
    typeof value === 'string' &&
    value.length > WORKSPACE_TRANSLATION_MEMORY_LIMITS.maxEntryTextCodeUnits
  ) {
    throw new WorkspaceLocalizationResourceLimitError(
      'translation-memory',
      'entry-text',
      WORKSPACE_TRANSLATION_MEMORY_LIMITS.maxEntryTextCodeUnits,
      value.length
    )
  }
  return normalizedEntryText(value, path)
}

function lookupKey(value: string): string {
  return normalizeLocalizationLookup(value).toLocaleLowerCase('en-US')
}

function translationMemoryPairKey(value: Pick<TranslationMemoryEntry, 'en' | 'ar'>): string {
  return JSON.stringify([lookupKey(value.en), lookupKey(value.ar)])
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  if (typeof signal.throwIfAborted === 'function') {
    signal.throwIfAborted()
    return
  }
  throw new DOMException('The localization operation was cancelled.', 'AbortError')
}

function validateBilingualScripts(en: string, ar: string, path: string, neutral: boolean): void {
  if (neutral) {
    if (en !== ar) {
      fail(path, 'neutral entries must use the same normalized value for en and ar.')
    }
    return
  }

  // Workspace neutral approvals are explicit glossary records. Do not let the
  // built-in seed silently exempt the Arabic side of an ordinary pair here.
  const classifierOptions = { approvedNeutralTerms: [] }
  const english = validateTargetScript(en, 'en', classifierOptions)
  const arabic = validateTargetScript(ar, 'ar', classifierOptions)
  if (!english.valid || english.script !== 'english') {
    fail(`${path}.en`, `must be valid English text (classified as ${english.script}).`)
  }
  if (!arabic.valid || arabic.script !== 'arabic') {
    fail(`${path}.ar`, `must contain meaningful Arabic text (classified as ${arabic.script}).`)
  }
}

function validateGlossaryEntries(value: unknown, path: string): GlossaryEntry[] {
  if (!Array.isArray(value)) fail(path, 'must be an array.')
  if (value.length > WORKSPACE_GLOSSARY_LIMITS.maxEntries) {
    throw new WorkspaceLocalizationResourceLimitError(
      'glossary',
      'entries',
      WORKSPACE_GLOSSARY_LIMITS.maxEntries,
      value.length
    )
  }
  let documentTextCodeUnits = 0
  const entries = value.map((candidate, index): GlossaryEntry => {
    const entryPath = `${path}[${index}]`
    if (!isRecord(candidate)) fail(entryPath, 'must be an object.')
    requireExactKeys(candidate, GLOSSARY_ENTRY_KEYS, entryPath)
    const en = glossaryEntryText(candidate.en, `${entryPath}.en`)
    const ar = glossaryEntryText(candidate.ar, `${entryPath}.ar`)
    documentTextCodeUnits += en.length + ar.length
    if (documentTextCodeUnits > WORKSPACE_GLOSSARY_LIMITS.maxDocumentTextCodeUnits) {
      throw new WorkspaceLocalizationResourceLimitError(
        'glossary',
        'document-text',
        WORKSPACE_GLOSSARY_LIMITS.maxDocumentTextCodeUnits,
        documentTextCodeUnits
      )
    }
    if (candidate.neutral !== undefined && typeof candidate.neutral !== 'boolean') {
      fail(`${entryPath}.neutral`, 'must be a boolean when present.')
    }
    validateBilingualScripts(en, ar, entryPath, candidate.neutral === true)
    return {
      en,
      ar,
      ...(candidate.neutral === undefined ? {} : { neutral: candidate.neutral })
    }
  })
  return entries
}

function validateAcceptedAt(value: unknown, path: string): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string') {
    fail(path, 'must be a valid ISO-8601 timestamp when present.')
  }
  const match = ISO_DATE_TIME.exec(value)
  if (!match || !Number.isFinite(Date.parse(value))) {
    fail(path, 'must be a valid ISO-8601 timestamp when present.')
  }
  const [
    ,
    yearText,
    monthText,
    dayText,
    hourText,
    minuteText,
    secondText,
    ,
    zone,
    offsetHourText,
    offsetMinuteText
  ] = match
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  const hour = Number(hourText)
  const minute = Number(minuteText)
  const second = Number(secondText)
  const offsetHour = Number(offsetHourText ?? 0)
  const offsetMinute = Number(offsetMinuteText ?? 0)
  const daysInMonth =
    month >= 1 && month <= 12 ? new Date(Date.UTC(year, month, 0)).getUTCDate() : 0
  if (
    day < 1 ||
    day > daysInMonth ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    offsetHour > 14 ||
    offsetMinute > 59 ||
    (offsetHour === 14 && offsetMinute !== 0) ||
    (zone !== 'Z' && offsetHourText === undefined)
  ) {
    fail(path, 'must be a valid ISO-8601 timestamp when present.')
  }
  return value
}

function validateTranslationMemoryEntries(value: unknown, path: string): TranslationMemoryEntry[] {
  if (!Array.isArray(value)) fail(path, 'must be an array.')
  if (value.length > WORKSPACE_TRANSLATION_MEMORY_LIMITS.maxEntries) {
    throw new WorkspaceLocalizationResourceLimitError(
      'translation-memory',
      'entries',
      WORKSPACE_TRANSLATION_MEMORY_LIMITS.maxEntries,
      value.length
    )
  }
  let documentTextCodeUnits = 0
  const entries = value.map((candidate, index): TranslationMemoryEntry => {
    const entryPath = `${path}[${index}]`
    if (!isRecord(candidate)) fail(entryPath, 'must be an object.')
    requireExactKeys(candidate, TRANSLATION_MEMORY_ENTRY_KEYS, entryPath)
    if (candidate.accepted !== true) {
      fail(
        `${entryPath}.accepted`,
        'must be true; unaccepted provider candidates are browser-private review data.'
      )
    }
    const acceptedAt = validateAcceptedAt(candidate.acceptedAt, `${entryPath}.acceptedAt`)
    const en = translationMemoryEntryText(candidate.en, `${entryPath}.en`)
    const ar = translationMemoryEntryText(candidate.ar, `${entryPath}.ar`)
    documentTextCodeUnits += en.length + ar.length
    if (documentTextCodeUnits > WORKSPACE_TRANSLATION_MEMORY_LIMITS.maxDocumentTextCodeUnits) {
      throw new WorkspaceLocalizationResourceLimitError(
        'translation-memory',
        'document-text',
        WORKSPACE_TRANSLATION_MEMORY_LIMITS.maxDocumentTextCodeUnits,
        documentTextCodeUnits
      )
    }
    validateBilingualScripts(en, ar, entryPath, false)
    return {
      en,
      ar,
      accepted: true,
      ...(acceptedAt === undefined ? {} : { acceptedAt })
    }
  })
  return entries
}

function freezeGlossaryEntries(entries: readonly GlossaryEntry[]): readonly GlossaryEntry[] {
  return Object.freeze(entries.map((entry) => Object.freeze({ ...entry })))
}

function freezeTranslationMemoryEntries(
  entries: readonly TranslationMemoryEntry[]
): readonly TranslationMemoryEntry[] {
  return Object.freeze(entries.map((entry) => Object.freeze({ ...entry })))
}

function translationMemoryDocumentFromValidatedEntries(
  entries: readonly TranslationMemoryEntry[]
): WorkspaceTranslationMemoryDocument {
  return Object.freeze({
    format: WORKSPACE_TRANSLATION_MEMORY_FORMAT,
    version: WORKSPACE_LOCALIZATION_SCHEMA_VERSION,
    entries: freezeTranslationMemoryEntries(entries)
  })
}

export function createWorkspaceGlossaryDocument(
  entries: unknown = createSeededGlossary(),
  path = WORKSPACE_GLOSSARY_PATH
): WorkspaceGlossaryDocument {
  return Object.freeze({
    format: WORKSPACE_GLOSSARY_FORMAT,
    version: WORKSPACE_LOCALIZATION_SCHEMA_VERSION,
    entries: freezeGlossaryEntries(validateGlossaryEntries(entries, `${path}.entries`))
  })
}

export function createWorkspaceTranslationMemoryDocument(
  entries: unknown = [],
  path = WORKSPACE_TRANSLATION_MEMORY_PATH
): WorkspaceTranslationMemoryDocument {
  return translationMemoryDocumentFromValidatedEntries(
    validateTranslationMemoryEntries(entries, `${path}.entries`)
  )
}

function parseJson(json: string, path: string): unknown {
  try {
    return JSON.parse(json)
  } catch (error) {
    return fail(path, 'is not valid JSON.', error)
  }
}

interface WorkspaceLocalizationJsonLimits {
  readonly maxFileBytes: number
  readonly maxJsonDepth: number
  readonly maxJsonStructuralItems: number
}

function preflightLocalizationJson(
  json: string,
  scope: WorkspaceLocalizationResourceLimitError['scope'],
  limits: WorkspaceLocalizationJsonLimits
): void {
  if (json.length > limits.maxFileBytes) {
    throw new WorkspaceLocalizationResourceLimitError(
      scope,
      'file-bytes',
      limits.maxFileBytes,
      json.length
    )
  }
  let depth = 0
  let structuralItems = 0
  let inString = false
  let escaped = false
  for (let index = 0; index < json.length; index += 1) {
    const character = json[index]!
    if (inString) {
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === '"') inString = false
      continue
    }
    if (character === '"') {
      inString = true
      continue
    }
    if (character === '{' || character === '[') {
      depth += 1
      structuralItems += 1
      if (depth > limits.maxJsonDepth) {
        throw new WorkspaceLocalizationResourceLimitError(
          scope,
          'json-depth',
          limits.maxJsonDepth,
          depth
        )
      }
    } else if (character === '}' || character === ']') {
      depth = Math.max(0, depth - 1)
    } else if (character === ',' || character === ':') {
      structuralItems += 1
    }
    if (structuralItems > limits.maxJsonStructuralItems) {
      throw new WorkspaceLocalizationResourceLimitError(
        scope,
        'json-items',
        limits.maxJsonStructuralItems,
        structuralItems
      )
    }
  }
}

function validateEnvelope(
  value: unknown,
  path: string,
  expectedFormat: string,
  allowedKeys: ReadonlySet<string>
): { entries: unknown; migratedFromLegacyArray: boolean } {
  if (Array.isArray(value)) {
    return { entries: value, migratedFromLegacyArray: true }
  }
  if (!isRecord(value)) fail(path, 'must contain a JSON object or a legacy top-level array.')
  requireExactKeys(value, allowedKeys, path)
  if (value.format !== expectedFormat) {
    fail(path, `has unsupported format ${JSON.stringify(value.format)}.`)
  }
  if (value.version !== WORKSPACE_LOCALIZATION_SCHEMA_VERSION) {
    fail(path, `has unsupported schema version ${JSON.stringify(value.version)}.`)
  }
  return { entries: value.entries, migratedFromLegacyArray: false }
}

export function parseWorkspaceGlossaryJson(
  json: string,
  path = WORKSPACE_GLOSSARY_PATH
): ParsedWorkspaceLocalizationDocument<WorkspaceGlossaryDocument> {
  preflightLocalizationJson(json, 'glossary', WORKSPACE_GLOSSARY_LIMITS)
  const envelope = validateEnvelope(
    parseJson(json, path),
    path,
    WORKSPACE_GLOSSARY_FORMAT,
    GLOSSARY_DOCUMENT_KEYS
  )
  return {
    document: createWorkspaceGlossaryDocument(
      validateGlossaryEntries(envelope.entries, `${path}.entries`),
      path
    ),
    migratedFromLegacyArray: envelope.migratedFromLegacyArray
  }
}

export function parseWorkspaceTranslationMemoryJson(
  json: string,
  path = WORKSPACE_TRANSLATION_MEMORY_PATH
): ParsedWorkspaceLocalizationDocument<WorkspaceTranslationMemoryDocument> {
  preflightLocalizationJson(json, 'translation-memory', WORKSPACE_TRANSLATION_MEMORY_LIMITS)
  const envelope = validateEnvelope(
    parseJson(json, path),
    path,
    WORKSPACE_TRANSLATION_MEMORY_FORMAT,
    TRANSLATION_MEMORY_DOCUMENT_KEYS
  )
  return {
    document: createWorkspaceTranslationMemoryDocument(
      validateTranslationMemoryEntries(envelope.entries, `${path}.entries`),
      path
    ),
    migratedFromLegacyArray: envelope.migratedFromLegacyArray
  }
}

export function serializeWorkspaceGlossaryDocument(document: WorkspaceGlossaryDocument): string {
  return `${JSON.stringify(createWorkspaceGlossaryDocument(document.entries), null, 2)}\n`
}

export function serializeWorkspaceTranslationMemoryDocument(
  document: WorkspaceTranslationMemoryDocument
): string {
  return `${JSON.stringify(createWorkspaceTranslationMemoryDocument(document.entries), null, 2)}\n`
}

function serializeValidatedWorkspaceTranslationMemoryDocument(
  document: WorkspaceTranslationMemoryDocument
): string {
  return `${JSON.stringify(document, null, 2)}\n`
}

function serializeValidatedWorkspaceGlossaryDocument(document: WorkspaceGlossaryDocument): string {
  return `${JSON.stringify(document, null, 2)}\n`
}

function encodeGlossaryDocument(document: WorkspaceGlossaryDocument): Uint8Array {
  const bytes = encoder.encode(serializeValidatedWorkspaceGlossaryDocument(document))
  if (bytes.byteLength > WORKSPACE_GLOSSARY_LIMITS.maxFileBytes) {
    throw new WorkspaceLocalizationResourceLimitError(
      'glossary',
      'file-bytes',
      WORKSPACE_GLOSSARY_LIMITS.maxFileBytes,
      bytes.byteLength
    )
  }
  return bytes
}

function encodeTranslationMemoryDocument(document: WorkspaceTranslationMemoryDocument): Uint8Array {
  const bytes = encoder.encode(serializeValidatedWorkspaceTranslationMemoryDocument(document))
  if (bytes.byteLength > WORKSPACE_TRANSLATION_MEMORY_LIMITS.maxFileBytes) {
    throw new WorkspaceLocalizationResourceLimitError(
      'translation-memory',
      'file-bytes',
      WORKSPACE_TRANSLATION_MEMORY_LIMITS.maxFileBytes,
      bytes.byteLength
    )
  }
  return bytes
}

function decodeSnapshot(snapshot: FileSnapshot): string {
  try {
    return decoder.decode(snapshot.bytes)
  } catch (error) {
    return fail(snapshot.path, 'must be valid UTF-8 JSON.', error)
  }
}

function decodeBoundedSnapshot(
  snapshot: FileSnapshot,
  scope: WorkspaceLocalizationResourceLimitError['scope'],
  maxFileBytes: number
): string {
  const actual = Math.max(snapshot.size, snapshot.bytes.byteLength)
  if (actual > maxFileBytes) {
    throw new WorkspaceLocalizationResourceLimitError(scope, 'file-bytes', maxFileBytes, actual)
  }
  return decodeSnapshot(snapshot)
}

function decodeGlossarySnapshot(snapshot: FileSnapshot): string {
  return decodeBoundedSnapshot(snapshot, 'glossary', WORKSPACE_GLOSSARY_LIMITS.maxFileBytes)
}

function decodeTranslationMemorySnapshot(snapshot: FileSnapshot): string {
  return decodeBoundedSnapshot(
    snapshot,
    'translation-memory',
    WORKSPACE_TRANSLATION_MEMORY_LIMITS.maxFileBytes
  )
}

function savedSnapshot(outcome: SaveOutcome, path: string): FileSnapshot {
  if (outcome.status === 'success') return outcome.snapshot
  if (outcome.status === 'external-conflict') {
    throw new WorkspaceLocalizationConflictError(path, outcome)
  }
  if ('error' in outcome) {
    throw new WorkspaceOperationError({
      code: outcome.error.code,
      operation: 'write',
      path,
      message: outcome.error.message,
      cause: outcome
    })
  }
  throw new WorkspaceOperationError({
    code: 'stale-workspace',
    operation: 'write',
    path,
    message: `Workspace changed from "${outcome.expectedWorkspaceId}" to "${outcome.actualWorkspaceId}" before the localization write.`,
    cause: outcome
  })
}

function isNotFound(error: unknown): boolean {
  return error instanceof WorkspaceOperationError && error.code === 'not-found'
}

function localizationFile<Document>(
  snapshot: FileSnapshot,
  document: Document
): WorkspaceLocalizationFile<Document> {
  return Object.freeze({
    path: snapshot.path,
    document,
    hash: snapshot.hash,
    size: snapshot.size,
    modifiedAt: snapshot.modifiedAt
  })
}

function localizationState(
  glossary: WorkspaceLocalizationFile<WorkspaceGlossaryDocument>,
  translationMemory: WorkspaceLocalizationFile<WorkspaceTranslationMemoryDocument>
): WorkspaceLocalizationState {
  return Object.freeze({
    files: Object.freeze({ glossary, translationMemory }),
    resources: Object.freeze({
      glossary: glossary.document.entries,
      translationMemory: translationMemory.document.entries
    })
  })
}

type PreparedLocalizationFile<Document> =
  | {
      readonly status: 'existing'
      readonly snapshot: FileSnapshot
      readonly document: Document
      readonly migrate: boolean
    }
  | {
      readonly status: 'missing'
      readonly path: string
      readonly document: Document
    }

interface CommittedLocalizationFile<Document> {
  readonly file: WorkspaceLocalizationFile<Document>
  readonly wrote: boolean
}

/**
 * Versioned compare-and-set editor for the two public localization files.
 *
 * One instance should be bound to one selected adapter generation. All local
 * operations are serialized, while expected hashes prevent a different
 * browser tab or external editor from being overwritten.
 */
export class WorkspaceLocalizationStore {
  readonly #adapter: WorkspaceAdapter
  readonly #now: () => Date
  readonly #cooperativeYield: () => Promise<void>
  #current: WorkspaceLocalizationState | undefined
  #tail: Promise<void> = Promise.resolve()

  constructor(adapter: WorkspaceAdapter, options: WorkspaceLocalizationStoreOptions = {}) {
    if (!adapter.storage.capabilities.multipleFiles || !adapter.storage.capabilities.directories) {
      throw new WorkspaceOperationError({
        code: 'unsupported',
        operation: 'open',
        path: WORKSPACE_LOCALIZATION_ROOT,
        message:
          'Public glossary and translation-memory files require a directory or browser workspace.'
      })
    }
    this.#adapter = adapter
    this.#now = options.now ?? (() => new Date())
    this.#cooperativeYield =
      options.cooperativeYield ??
      (() => new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0)))
  }

  get current(): WorkspaceLocalizationState | undefined {
    return this.#current
  }

  async load(options: WorkspaceLocalizationWriteOptions = {}): Promise<WorkspaceLocalizationState> {
    return this.#enqueue(() => this.#loadFresh(options))
  }

  async replaceGlossary(
    entries: readonly GlossaryEntry[],
    options: WorkspaceLocalizationWriteOptions = {}
  ): Promise<WorkspaceLocalizationState> {
    return this.#enqueue(async () => {
      const current = await this.#ensureLoaded(options)
      if (
        options.expectedHash !== undefined &&
        options.expectedHash !== current.files.glossary.hash
      ) {
        throw new WorkspaceLocalizationConflictError(WORKSPACE_GLOSSARY_PATH, {
          ok: false,
          status: 'external-conflict',
          reason: 'hash-mismatch',
          expectedHash: options.expectedHash,
          actual: {
            path: current.files.glossary.path,
            bytes: encodeGlossaryDocument(current.files.glossary.document),
            hash: current.files.glossary.hash,
            size: current.files.glossary.size,
            modifiedAt: current.files.glossary.modifiedAt,
            mimeType: 'application/json'
          }
        })
      }
      return this.#persistGlossary(current, createWorkspaceGlossaryDocument(entries), options)
    })
  }

  async editGlossary(
    editor: GlossaryEditor,
    options: WorkspaceLocalizationWriteOptions = {}
  ): Promise<WorkspaceLocalizationState> {
    return this.#enqueue(async () => {
      const current = await this.#ensureLoaded(options)
      const draft = current.resources.glossary.map((entry) => ({ ...entry }))
      const edited = editor(draft)
      return this.#persistGlossary(
        current,
        createWorkspaceGlossaryDocument(edited === undefined ? draft : edited),
        options
      )
    })
  }

  async replaceTranslationMemory(
    entries: readonly TranslationMemoryEntry[],
    options: WorkspaceLocalizationWriteOptions = {}
  ): Promise<WorkspaceLocalizationState> {
    return this.#enqueue(async () => {
      const current = await this.#ensureLoaded(options)
      if (
        options.expectedHash !== undefined &&
        options.expectedHash !== current.files.translationMemory.hash
      ) {
        throw new WorkspaceLocalizationConflictError(WORKSPACE_TRANSLATION_MEMORY_PATH, {
          ok: false,
          status: 'external-conflict',
          reason: 'hash-mismatch',
          expectedHash: options.expectedHash,
          actual: {
            path: current.files.translationMemory.path,
            bytes: encodeTranslationMemoryDocument(current.files.translationMemory.document),
            hash: current.files.translationMemory.hash,
            size: current.files.translationMemory.size,
            modifiedAt: current.files.translationMemory.modifiedAt,
            mimeType: 'application/json'
          }
        })
      }
      return this.#persistTranslationMemory(
        current,
        createWorkspaceTranslationMemoryDocument(entries),
        options
      )
    })
  }

  async editTranslationMemory(
    editor: TranslationMemoryEditor,
    options: WorkspaceLocalizationWriteOptions = {}
  ): Promise<WorkspaceLocalizationState> {
    return this.#enqueue(async () => {
      const current = await this.#ensureLoaded(options)
      const draft = current.resources.translationMemory.map((entry) => ({ ...entry }))
      const edited = editor(draft)
      return this.#persistTranslationMemory(
        current,
        createWorkspaceTranslationMemoryDocument(edited === undefined ? draft : edited),
        options
      )
    })
  }

  /**
   * The only candidate-oriented write API is intentionally named for the user
   * action. It canonicalizes/upserts one pair and stamps `accepted: true`;
   * provider attempts that have not been accepted cannot enter the file.
   */
  async acceptTranslationPair(
    input: AcceptTranslationPairInput,
    options: WorkspaceLocalizationWriteOptions = {}
  ): Promise<WorkspaceLocalizationState> {
    return this.acceptTranslationPairs([input], options)
  }

  /**
   * Accepts a reviewed batch in one queued compare-and-set write.
   *
   * The merge is O(current entries + batch entries): exact-pair keys are
   * indexed once, the last reviewed duplicate wins at its first stable
   * position, and all new keys retain first-seen batch order. Work yields every
   * documented chunk and honours cancellation until the single atomic write;
   * storage failure cannot expose a partially persisted provider batch.
   */
  async acceptTranslationPairs(
    inputs: readonly AcceptTranslationPairInput[],
    options: WorkspaceLocalizationWriteOptions = {}
  ): Promise<WorkspaceLocalizationState> {
    return this.#enqueue(async () => {
      if (inputs.length > WORKSPACE_TRANSLATION_MEMORY_LIMITS.maxBatchEntries) {
        throw new WorkspaceLocalizationResourceLimitError(
          'translation-memory',
          'batch-entries',
          WORKSPACE_TRANSLATION_MEMORY_LIMITS.maxBatchEntries,
          inputs.length
        )
      }
      throwIfAborted(options.signal)
      const current = await this.#ensureLoaded(options)
      if (inputs.length === 0) return current

      const replacements = new Map<string, TranslationMemoryEntry>()
      const replacementOrder: string[] = []
      let batchTextCodeUnits = 0
      for (let index = 0; index < inputs.length; index += 1) {
        if (index > 0 && index % WORKSPACE_TRANSLATION_MEMORY_LIMITS.cooperativeChunkSize === 0) {
          await this.#yieldAndCheck(options.signal)
        }
        const input = inputs[index]!
        const candidate: TranslationMemoryEntry = {
          en: input.en,
          ar: input.ar,
          accepted: true,
          acceptedAt: input.acceptedAt ?? this.#now().toISOString()
        }
        const validated = createWorkspaceTranslationMemoryDocument([candidate]).entries[0]!
        batchTextCodeUnits += validated.en.length + validated.ar.length
        if (batchTextCodeUnits > WORKSPACE_TRANSLATION_MEMORY_LIMITS.maxDocumentTextCodeUnits) {
          throw new WorkspaceLocalizationResourceLimitError(
            'translation-memory',
            'document-text',
            WORKSPACE_TRANSLATION_MEMORY_LIMITS.maxDocumentTextCodeUnits,
            batchTextCodeUnits
          )
        }
        const key = translationMemoryPairKey(validated)
        if (!replacements.has(key)) replacementOrder.push(key)
        replacements.set(key, validated)
      }

      const entries: TranslationMemoryEntry[] = []
      const inserted = new Set<string>()
      let documentTextCodeUnits = 0
      const append = (entry: TranslationMemoryEntry): void => {
        documentTextCodeUnits += entry.en.length + entry.ar.length
        if (documentTextCodeUnits > WORKSPACE_TRANSLATION_MEMORY_LIMITS.maxDocumentTextCodeUnits) {
          throw new WorkspaceLocalizationResourceLimitError(
            'translation-memory',
            'document-text',
            WORKSPACE_TRANSLATION_MEMORY_LIMITS.maxDocumentTextCodeUnits,
            documentTextCodeUnits
          )
        }
        entries.push({ ...entry })
      }

      for (let index = 0; index < current.resources.translationMemory.length; index += 1) {
        if (index > 0 && index % WORKSPACE_TRANSLATION_MEMORY_LIMITS.cooperativeChunkSize === 0) {
          await this.#yieldAndCheck(options.signal)
        }
        const entry = current.resources.translationMemory[index]!
        const key = translationMemoryPairKey(entry)
        const replacement = replacements.get(key)
        if (!replacement) {
          append(entry)
        } else if (!inserted.has(key)) {
          append(replacement)
          inserted.add(key)
        }
      }
      for (let index = 0; index < replacementOrder.length; index += 1) {
        if (index > 0 && index % WORKSPACE_TRANSLATION_MEMORY_LIMITS.cooperativeChunkSize === 0) {
          await this.#yieldAndCheck(options.signal)
        }
        const key = replacementOrder[index]!
        if (inserted.has(key)) continue
        append(replacements.get(key)!)
        inserted.add(key)
      }
      if (entries.length > WORKSPACE_TRANSLATION_MEMORY_LIMITS.maxEntries) {
        throw new WorkspaceLocalizationResourceLimitError(
          'translation-memory',
          'entries',
          WORKSPACE_TRANSLATION_MEMORY_LIMITS.maxEntries,
          entries.length
        )
      }
      await this.#yieldAndCheck(options.signal)
      return this.#persistTranslationMemory(
        current,
        translationMemoryDocumentFromValidatedEntries(entries),
        options
      )
    })
  }

  async #yieldAndCheck(signal?: AbortSignal): Promise<void> {
    throwIfAborted(signal)
    await this.#cooperativeYield()
    throwIfAborted(signal)
  }

  async #enqueue<Result>(task: () => Promise<Result>): Promise<Result> {
    const result = this.#tail.then(task, task)
    this.#tail = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }

  async #ensureLoaded(
    options: WorkspaceLocalizationWriteOptions
  ): Promise<WorkspaceLocalizationState> {
    if (this.#current) return this.#current
    return this.#loadFresh(options)
  }

  async #loadFresh(
    options: WorkspaceLocalizationWriteOptions
  ): Promise<WorkspaceLocalizationState> {
    this.#current = undefined
    try {
      const next = await this.#loadAll(options)
      this.#current = next
      return next
    } catch (error) {
      this.#current = undefined
      throw error
    }
  }

  async #loadAll(options: WorkspaceLocalizationWriteOptions): Promise<WorkspaceLocalizationState> {
    // Phase one is read/validate only. Neither seeding nor legacy migration is
    // allowed until both public resources are known to be safe.
    const preparedGlossary = await this.#prepareGlossary(options)
    const preparedTranslationMemory = await this.#prepareTranslationMemory(options)
    throwIfAborted(options.signal)

    // Workspace adapters expose per-file CAS, not a multi-file transaction.
    // A later phase-two storage failure may therefore leave an earlier seed or
    // migration committed. `#loadFresh` keeps the aggregate unavailable and a
    // retry re-reads/adopts that exact committed file before editing resumes.
    const committedPaths: string[] = []
    const glossary = await this.#commitPreparedGlossary(preparedGlossary, options)
    if (glossary.wrote) committedPaths.push(glossary.file.path)
    try {
      const translationMemory = await this.#commitPreparedTranslationMemory(
        preparedTranslationMemory,
        options
      )
      return localizationState(glossary.file, translationMemory.file)
    } catch (error) {
      if (committedPaths.length > 0) {
        throw new WorkspaceLocalizationPartialLoadError(committedPaths, error)
      }
      throw error
    }
  }

  async #prepareGlossary(
    options: WorkspaceLocalizationWriteOptions
  ): Promise<PreparedLocalizationFile<WorkspaceGlossaryDocument>> {
    try {
      const snapshot = await this.#readGlossarySnapshot(options)
      const parsed = parseWorkspaceGlossaryJson(decodeGlossarySnapshot(snapshot), snapshot.path)
      return {
        status: 'existing',
        snapshot,
        document: parsed.document,
        migrate: parsed.migratedFromLegacyArray
      }
    } catch (error) {
      if (!isNotFound(error)) throw error
      return {
        status: 'missing',
        path: WORKSPACE_GLOSSARY_PATH,
        document: createWorkspaceGlossaryDocument()
      }
    }
  }

  async #prepareTranslationMemory(
    options: WorkspaceLocalizationWriteOptions
  ): Promise<PreparedLocalizationFile<WorkspaceTranslationMemoryDocument>> {
    try {
      const snapshot = await this.#readTranslationMemorySnapshot(options)
      const parsed = parseWorkspaceTranslationMemoryJson(
        decodeTranslationMemorySnapshot(snapshot),
        snapshot.path
      )
      return {
        status: 'existing',
        snapshot,
        document: parsed.document,
        migrate: parsed.migratedFromLegacyArray
      }
    } catch (error) {
      if (!isNotFound(error)) throw error
      return {
        status: 'missing',
        path: WORKSPACE_TRANSLATION_MEMORY_PATH,
        document: createWorkspaceTranslationMemoryDocument()
      }
    }
  }

  async #readBoundedSnapshot(
    path: string,
    scope: WorkspaceLocalizationResourceLimitError['scope'],
    maxBytes: number,
    options: WorkspaceLocalizationWriteOptions
  ): Promise<FileSnapshot> {
    try {
      return await this.#adapter.read(path, {
        maxBytes,
        signal: options.signal
      })
    } catch (error) {
      if (error instanceof WorkspaceReadLimitError) {
        throw new WorkspaceLocalizationResourceLimitError(
          scope,
          'file-bytes',
          error.maxBytes,
          error.actualBytes
        )
      }
      throw error
    }
  }

  #readGlossarySnapshot(options: WorkspaceLocalizationWriteOptions): Promise<FileSnapshot> {
    return this.#readBoundedSnapshot(
      WORKSPACE_GLOSSARY_PATH,
      'glossary',
      WORKSPACE_GLOSSARY_LIMITS.maxFileBytes,
      options
    )
  }

  #readTranslationMemorySnapshot(
    options: WorkspaceLocalizationWriteOptions
  ): Promise<FileSnapshot> {
    return this.#readBoundedSnapshot(
      WORKSPACE_TRANSLATION_MEMORY_PATH,
      'translation-memory',
      WORKSPACE_TRANSLATION_MEMORY_LIMITS.maxFileBytes,
      options
    )
  }

  async #commitPreparedGlossary(
    prepared: PreparedLocalizationFile<WorkspaceGlossaryDocument>,
    options: WorkspaceLocalizationWriteOptions
  ): Promise<CommittedLocalizationFile<WorkspaceGlossaryDocument>> {
    if (prepared.status === 'existing' && !prepared.migrate) {
      return { file: localizationFile(prepared.snapshot, prepared.document), wrote: false }
    }
    const outcome = await this.#adapter.writeAtomic(
      prepared.status === 'existing' ? prepared.snapshot.path : prepared.path,
      encodeGlossaryDocument(prepared.document),
      prepared.status === 'existing' ? prepared.snapshot.hash : undefined,
      {
        expectedWorkspaceId: this.#adapter.id,
        ...(prepared.status === 'missing' ? { expectedMissing: true } : {}),
        signal: options.signal
      }
    )
    if (
      prepared.status === 'missing' &&
      outcome.status === 'external-conflict' &&
      outcome.reason === 'already-exists'
    ) {
      const winner = await this.#readGlossarySnapshot(options)
      const parsed = parseWorkspaceGlossaryJson(decodeGlossarySnapshot(winner), winner.path)
      if (!parsed.migratedFromLegacyArray) {
        return { file: localizationFile(winner, parsed.document), wrote: false }
      }
      const migrated = await this.#adapter.writeAtomic(
        winner.path,
        encodeGlossaryDocument(parsed.document),
        winner.hash,
        {
          expectedWorkspaceId: this.#adapter.id,
          signal: options.signal
        }
      )
      return {
        file: localizationFile(savedSnapshot(migrated, winner.path), parsed.document),
        wrote: true
      }
    }
    const path = prepared.status === 'existing' ? prepared.snapshot.path : prepared.path
    return {
      file: localizationFile(savedSnapshot(outcome, path), prepared.document),
      wrote: true
    }
  }

  async #commitPreparedTranslationMemory(
    prepared: PreparedLocalizationFile<WorkspaceTranslationMemoryDocument>,
    options: WorkspaceLocalizationWriteOptions
  ): Promise<CommittedLocalizationFile<WorkspaceTranslationMemoryDocument>> {
    if (prepared.status === 'existing' && !prepared.migrate) {
      return { file: localizationFile(prepared.snapshot, prepared.document), wrote: false }
    }
    const outcome = await this.#adapter.writeAtomic(
      prepared.status === 'existing' ? prepared.snapshot.path : prepared.path,
      encodeTranslationMemoryDocument(prepared.document),
      prepared.status === 'existing' ? prepared.snapshot.hash : undefined,
      {
        expectedWorkspaceId: this.#adapter.id,
        ...(prepared.status === 'missing' ? { expectedMissing: true } : {}),
        signal: options.signal
      }
    )
    if (
      prepared.status === 'missing' &&
      outcome.status === 'external-conflict' &&
      outcome.reason === 'already-exists'
    ) {
      const winner = await this.#readTranslationMemorySnapshot(options)
      const parsed = parseWorkspaceTranslationMemoryJson(
        decodeTranslationMemorySnapshot(winner),
        winner.path
      )
      if (!parsed.migratedFromLegacyArray) {
        return { file: localizationFile(winner, parsed.document), wrote: false }
      }
      const migrated = await this.#adapter.writeAtomic(
        winner.path,
        encodeTranslationMemoryDocument(parsed.document),
        winner.hash,
        {
          expectedWorkspaceId: this.#adapter.id,
          signal: options.signal
        }
      )
      return {
        file: localizationFile(savedSnapshot(migrated, winner.path), parsed.document),
        wrote: true
      }
    }
    const path = prepared.status === 'existing' ? prepared.snapshot.path : prepared.path
    return {
      file: localizationFile(savedSnapshot(outcome, path), prepared.document),
      wrote: true
    }
  }

  async #persistGlossary(
    current: WorkspaceLocalizationState,
    document: WorkspaceGlossaryDocument,
    options: WorkspaceLocalizationWriteOptions
  ): Promise<WorkspaceLocalizationState> {
    const snapshot = savedSnapshot(
      await this.#adapter.writeAtomic(
        WORKSPACE_GLOSSARY_PATH,
        encodeGlossaryDocument(document),
        current.files.glossary.hash,
        {
          expectedWorkspaceId: this.#adapter.id,
          signal: options.signal
        }
      ),
      WORKSPACE_GLOSSARY_PATH
    )
    this.#current = localizationState(
      localizationFile(snapshot, document),
      current.files.translationMemory
    )
    return this.#current
  }

  async #persistTranslationMemory(
    current: WorkspaceLocalizationState,
    document: WorkspaceTranslationMemoryDocument,
    options: WorkspaceLocalizationWriteOptions
  ): Promise<WorkspaceLocalizationState> {
    const snapshot = savedSnapshot(
      await this.#adapter.writeAtomic(
        WORKSPACE_TRANSLATION_MEMORY_PATH,
        encodeTranslationMemoryDocument(document),
        current.files.translationMemory.hash,
        {
          expectedWorkspaceId: this.#adapter.id,
          signal: options.signal
        }
      ),
      WORKSPACE_TRANSLATION_MEMORY_PATH
    )
    this.#current = localizationState(current.files.glossary, localizationFile(snapshot, document))
    return this.#current
  }
}

export function createWorkspaceLocalizationStore(
  adapter: WorkspaceAdapter,
  options: WorkspaceLocalizationStoreOptions = {}
): WorkspaceLocalizationStore {
  return new WorkspaceLocalizationStore(adapter, options)
}
