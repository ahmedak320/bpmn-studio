import {
  WorkspaceOperationError,
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
}

export interface WorkspaceLocalizationStoreOptions {
  now?: () => Date
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

export class WorkspaceLocalizationValidationError extends Error {
  readonly path: string

  constructor(path: string, message: string, options: { cause?: unknown } = {}) {
    super(`${path}: ${message}`, options)
    this.name = 'WorkspaceLocalizationValidationError'
    this.path = path
  }
}

export class WorkspaceLocalizationConflictError extends Error {
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

function lookupKey(value: string): string {
  return normalizeLocalizationLookup(value).toLocaleLowerCase('en-US')
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
  const entries = value.map((candidate, index): GlossaryEntry => {
    const entryPath = `${path}[${index}]`
    if (!isRecord(candidate)) fail(entryPath, 'must be an object.')
    requireExactKeys(candidate, GLOSSARY_ENTRY_KEYS, entryPath)
    const en = normalizedEntryText(candidate.en, `${entryPath}.en`)
    const ar = normalizedEntryText(candidate.ar, `${entryPath}.ar`)
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
    const en = normalizedEntryText(candidate.en, `${entryPath}.en`)
    const ar = normalizedEntryText(candidate.ar, `${entryPath}.ar`)
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
  return Object.freeze({
    format: WORKSPACE_TRANSLATION_MEMORY_FORMAT,
    version: WORKSPACE_LOCALIZATION_SCHEMA_VERSION,
    entries: freezeTranslationMemoryEntries(
      validateTranslationMemoryEntries(entries, `${path}.entries`)
    )
  })
}

function parseJson(json: string, path: string): unknown {
  try {
    return JSON.parse(json)
  } catch (error) {
    return fail(path, 'is not valid JSON.', error)
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

function decodeSnapshot(snapshot: FileSnapshot): string {
  try {
    return decoder.decode(snapshot.bytes)
  } catch (error) {
    return fail(snapshot.path, 'must be valid UTF-8 JSON.', error)
  }
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
  }

  get current(): WorkspaceLocalizationState | undefined {
    return this.#current
  }

  async load(options: WorkspaceLocalizationWriteOptions = {}): Promise<WorkspaceLocalizationState> {
    return this.#enqueue(async () => {
      this.#current = await this.#loadAll(options)
      return this.#current
    })
  }

  async replaceGlossary(
    entries: readonly GlossaryEntry[],
    options: WorkspaceLocalizationWriteOptions = {}
  ): Promise<WorkspaceLocalizationState> {
    return this.#enqueue(async () => {
      const current = await this.#ensureLoaded(options)
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
    return this.#enqueue(async () => {
      const current = await this.#ensureLoaded(options)
      const candidate: TranslationMemoryEntry = {
        en: input.en,
        ar: input.ar,
        accepted: true,
        acceptedAt: input.acceptedAt ?? this.#now().toISOString()
      }
      const validated = createWorkspaceTranslationMemoryDocument([candidate]).entries[0]!
      const enKey = lookupKey(validated.en)
      const arKey = lookupKey(validated.ar)
      const entries = current.resources.translationMemory.map((entry) => ({ ...entry }))
      const firstMatch = entries.findIndex(
        (entry) => lookupKey(entry.en) === enKey && lookupKey(entry.ar) === arKey
      )
      const retained = entries.filter(
        (entry) => lookupKey(entry.en) !== enKey || lookupKey(entry.ar) !== arKey
      )
      retained.splice(firstMatch < 0 ? retained.length : firstMatch, 0, { ...validated })
      return this.#persistTranslationMemory(
        current,
        createWorkspaceTranslationMemoryDocument(retained),
        options
      )
    })
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
    this.#current = await this.#loadAll(options)
    return this.#current
  }

  async #loadAll(options: WorkspaceLocalizationWriteOptions): Promise<WorkspaceLocalizationState> {
    const glossary = await this.#loadGlossary(options)
    const translationMemory = await this.#loadTranslationMemory(options)
    return localizationState(glossary, translationMemory)
  }

  async #loadGlossary(
    options: WorkspaceLocalizationWriteOptions
  ): Promise<WorkspaceLocalizationFile<WorkspaceGlossaryDocument>> {
    try {
      const snapshot = await this.#adapter.read(WORKSPACE_GLOSSARY_PATH)
      return this.#parseOrMigrateGlossary(snapshot, options)
    } catch (error) {
      if (!isNotFound(error)) throw error
      const document = createWorkspaceGlossaryDocument()
      const outcome = await this.#adapter.writeAtomic(
        WORKSPACE_GLOSSARY_PATH,
        encoder.encode(serializeWorkspaceGlossaryDocument(document)),
        undefined,
        {
          expectedWorkspaceId: this.#adapter.id,
          expectedMissing: true,
          signal: options.signal
        }
      )
      if (outcome.status === 'external-conflict' && outcome.reason === 'already-exists') {
        return this.#parseOrMigrateGlossary(
          await this.#adapter.read(WORKSPACE_GLOSSARY_PATH),
          options
        )
      }
      return localizationFile(savedSnapshot(outcome, WORKSPACE_GLOSSARY_PATH), document)
    }
  }

  async #loadTranslationMemory(
    options: WorkspaceLocalizationWriteOptions
  ): Promise<WorkspaceLocalizationFile<WorkspaceTranslationMemoryDocument>> {
    try {
      const snapshot = await this.#adapter.read(WORKSPACE_TRANSLATION_MEMORY_PATH)
      return this.#parseOrMigrateTranslationMemory(snapshot, options)
    } catch (error) {
      if (!isNotFound(error)) throw error
      const document = createWorkspaceTranslationMemoryDocument()
      const outcome = await this.#adapter.writeAtomic(
        WORKSPACE_TRANSLATION_MEMORY_PATH,
        encoder.encode(serializeWorkspaceTranslationMemoryDocument(document)),
        undefined,
        {
          expectedWorkspaceId: this.#adapter.id,
          expectedMissing: true,
          signal: options.signal
        }
      )
      if (outcome.status === 'external-conflict' && outcome.reason === 'already-exists') {
        return this.#parseOrMigrateTranslationMemory(
          await this.#adapter.read(WORKSPACE_TRANSLATION_MEMORY_PATH),
          options
        )
      }
      return localizationFile(savedSnapshot(outcome, WORKSPACE_TRANSLATION_MEMORY_PATH), document)
    }
  }

  async #parseOrMigrateGlossary(
    snapshot: FileSnapshot,
    options: WorkspaceLocalizationWriteOptions
  ): Promise<WorkspaceLocalizationFile<WorkspaceGlossaryDocument>> {
    const parsed = parseWorkspaceGlossaryJson(decodeSnapshot(snapshot), snapshot.path)
    if (!parsed.migratedFromLegacyArray) {
      return localizationFile(snapshot, parsed.document)
    }
    const outcome = await this.#adapter.writeAtomic(
      snapshot.path,
      encoder.encode(serializeWorkspaceGlossaryDocument(parsed.document)),
      snapshot.hash,
      {
        expectedWorkspaceId: this.#adapter.id,
        signal: options.signal
      }
    )
    return localizationFile(savedSnapshot(outcome, snapshot.path), parsed.document)
  }

  async #parseOrMigrateTranslationMemory(
    snapshot: FileSnapshot,
    options: WorkspaceLocalizationWriteOptions
  ): Promise<WorkspaceLocalizationFile<WorkspaceTranslationMemoryDocument>> {
    const parsed = parseWorkspaceTranslationMemoryJson(decodeSnapshot(snapshot), snapshot.path)
    if (!parsed.migratedFromLegacyArray) {
      return localizationFile(snapshot, parsed.document)
    }
    const outcome = await this.#adapter.writeAtomic(
      snapshot.path,
      encoder.encode(serializeWorkspaceTranslationMemoryDocument(parsed.document)),
      snapshot.hash,
      {
        expectedWorkspaceId: this.#adapter.id,
        signal: options.signal
      }
    )
    return localizationFile(savedSnapshot(outcome, snapshot.path), parsed.document)
  }

  async #persistGlossary(
    current: WorkspaceLocalizationState,
    document: WorkspaceGlossaryDocument,
    options: WorkspaceLocalizationWriteOptions
  ): Promise<WorkspaceLocalizationState> {
    const snapshot = savedSnapshot(
      await this.#adapter.writeAtomic(
        WORKSPACE_GLOSSARY_PATH,
        encoder.encode(serializeWorkspaceGlossaryDocument(document)),
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
        encoder.encode(serializeWorkspaceTranslationMemoryDocument(document)),
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
