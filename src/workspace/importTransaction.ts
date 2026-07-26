import { layoutBpmnValidated } from '../generation'
import {
  convertAmlToBpmnFiles,
  createArisConversionReportDownload,
  looksLikeAml,
  type AmlConversion,
  type ArisConversionReport,
  type ArisConversionReportDownload
} from '../library/apcImport'
import type { LibraryImportResult, SkipReason as LibrarySkipReason } from '../library/zipImport'
import type {
  LocalizationResources,
  ReviewedXmlIngestionEvidence,
  ReviewedXmlIngestionReviewer
} from '../localization'
import { deriveFileBaseName, sanitizeFolderName } from '../editor/newProcessDoc'
import {
  evaluateValidationPolicy,
  getRuntimeValidationAdapters,
  validateBpmnXml,
  validateUnknownExtensionPreservation,
  type BpmnValidationAdapter,
  type ParsedBpmnValidation,
  type ValidationIssue,
  type ValidationSummary
} from '../validation'
import {
  applyWorkspaceBackupImport,
  copyBytes,
  equalHash,
  joinWorkspacePath,
  normalizeWorkspacePath,
  sealWorkspaceBackupImportPlan,
  sha256Hex,
  workspaceParentPath,
  workspacePathName,
  type FileSnapshot,
  type WorkspaceAdapter,
  type WorkspaceBackupAppliedFile,
  type WorkspaceBackupCollision,
  type WorkspaceBackupCollisionDecision,
  type WorkspaceBackupImportOutcome,
  type WorkspaceBackupImportPlan,
  type WorkspaceBackupManifest,
  type WorkspaceFailure,
  type WorkspaceProcessIdentityInspector,
  type WorkspaceProcessIdentitySnapshotEntry
} from './adapters'
import { looksLikeBpmnXml } from './importDrop'
import {
  assertNonReservedImportPath,
  digestProcessIdentitySnapshot,
  normalizeProcessIdentitySnapshot,
  scanWorkspaceProcessIdentities
} from './processIdentity'
import {
  ReviewedBpmnBoundaryError,
  defaultLocalizationResources,
  localizationSourceForImport,
  secureReviewedBpmnIngestion,
  type CompletedReviewedBpmnIngestion,
  type ReviewedBpmnIngestionPort
} from './reviewedBpmn'

const encoder = new TextEncoder()

export const DEFAULT_WORKSPACE_IMPORT_LIMITS = Object.freeze({
  maxSources: 2_500,
  maxSourceCharacters: 5 * 1024 * 1024,
  maxTotalSourceCharacters: 50 * 1024 * 1024,
  maxArtifacts: 2_500,
  maxArtifactBytes: 5 * 1024 * 1024,
  maxTotalArtifactBytes: 50 * 1024 * 1024
})

export interface WorkspaceImportLimits {
  readonly maxSources?: number
  readonly maxSourceCharacters?: number
  readonly maxTotalSourceCharacters?: number
  readonly maxArtifacts?: number
  readonly maxArtifactBytes?: number
  readonly maxTotalArtifactBytes?: number
}

interface ResolvedWorkspaceImportLimits {
  readonly maxSources: number
  readonly maxSourceCharacters: number
  readonly maxTotalSourceCharacters: number
  readonly maxArtifacts: number
  readonly maxArtifactBytes: number
  readonly maxTotalArtifactBytes: number
}

export type WorkspaceImportSource =
  | {
      readonly kind: 'document'
      /** Stable identifier supplied by the UI for review and diagnostics. */
      readonly id: string
      readonly name: string
      /** Relative source path. Defaults to `name`. */
      readonly relPath?: string
      /** Already size-bounded, strictly decoded source text. */
      readonly text: string
    }
  | {
      readonly kind: 'library'
      readonly id: string
      readonly name: string
      /**
       * Result returned by `readLibraryZipFileInWorker`. ZIP security
       * preflight, bounded inflation, CRC verification, and strict UTF-8
       * decoding therefore finish before this transaction planner runs.
       */
      readonly result: LibraryImportResult
    }

export type WorkspaceImportArtifactSourceKind = 'bpmn' | 'aml' | 'library'

export type WorkspaceImportRepairCode =
  | 'aml-converted'
  | 'auto-layout'
  | 'destination-normalized'
  | 'destination-deduplicated'
  | 'destination-case-normalized'

export interface WorkspaceImportRepair {
  readonly code: WorkspaceImportRepairCode
  readonly sourceId: string
  readonly artifactId: string
  readonly message: string
  readonly before?: string
  readonly after?: string
}

export interface WorkspaceImportWarning {
  readonly code: string
  readonly sourceId: string
  readonly artifactId?: string
  readonly message: string
  readonly validationIssue?: ValidationIssue
  readonly count?: number
}

/**
 * Exact ARIS conversion evidence retained in the review digest and execution
 * outcome. `report` contains all five categories (converted, downgraded,
 * ignored, ambiguous, and unmapped); `download` is the stable JSON handoff.
 */
export interface WorkspaceImportArisEvidence {
  readonly sourceId: string
  readonly sourceName: string
  readonly report: ArisConversionReport
  readonly download: ArisConversionReportDownload
}

export type WorkspaceImportSkipReason =
  | 'unsupported-content'
  | 'unsafe-path'
  | 'invalid-bpmn'
  | 'aml-conversion-failed'
  | 'process-id-collision'
  | 'process-identity-changed'
  | 'localization-review-required'
  | 'localization-review-cancelled'
  | 'localization-invalid'
  | 'destination-parent-file'
  | `library-${LibrarySkipReason}`

export interface WorkspaceImportSkippedItem {
  readonly sourceId: string
  readonly sourceName: string
  readonly path?: string
  readonly reason: WorkspaceImportSkipReason
  readonly message: string
}

export interface WorkspaceImportArtifact {
  readonly id: string
  readonly sourceId: string
  readonly sourceName: string
  readonly sourceKind: WorkspaceImportArtifactSourceKind
  readonly sourcePath: string
  readonly destinationPath: string
  readonly xml: string
  /** Exact UTF-8 bytes that the transaction will write. */
  readonly bytes: Uint8Array
  readonly sha256: string
  readonly processIds: readonly string[]
  /**
   * Existing process identities bound to this exact destination. These may be
   * replaced or skipped, but never written to a keep-both path.
   */
  readonly replacesProcessIds: readonly string[]
  readonly validation: ValidationSummary
  readonly localizationReviewDigest: string
  readonly localizationEvidence: ReviewedXmlIngestionEvidence
}

export interface WorkspaceImportCollision {
  readonly artifactId: string
  readonly path: string
  readonly incomingHash: string
  readonly existingHash: string
  readonly identical: boolean
  readonly existing: FileSnapshot
  /** Collision-free path calculated against the reviewed workspace snapshot. */
  readonly suggestedKeepBothPath: string
}

export interface WorkspaceImportReviewSummary {
  readonly sources: number
  readonly artifacts: number
  readonly collisions: number
  readonly skipped: number
  readonly repairs: number
  readonly warnings: number
  readonly arisReports: number
  readonly creates: number
  readonly identical: number
}

/**
 * Immutable review contract. No filesystem mutation occurs while this plan is
 * built. The UI must display collisions, skips, automatic repairs, and warnings
 * before echoing `reviewDigest` through `confirmWorkspaceImportPlan`.
 */
export interface WorkspaceImportPlan {
  readonly version: 1
  readonly id: string
  readonly createdAt: string
  readonly workspaceId: string
  readonly workspaceMode: WorkspaceAdapter['mode']
  readonly workspaceMultipleFiles: boolean
  readonly status: 'ready' | 'blocked'
  readonly targetFolder: string
  readonly artifacts: readonly WorkspaceImportArtifact[]
  readonly collisions: readonly WorkspaceImportCollision[]
  readonly skipped: readonly WorkspaceImportSkippedItem[]
  readonly repairs: readonly WorkspaceImportRepair[]
  readonly warnings: readonly WorkspaceImportWarning[]
  readonly arisReports: readonly WorkspaceImportArisEvidence[]
  readonly summary: WorkspaceImportReviewSummary
  readonly processIdentitySnapshot: readonly WorkspaceProcessIdentitySnapshotEntry[]
  readonly processIdentityDigest: string
  readonly reviewDigest: string
}

export type WorkspaceImportCollisionDecision =
  | { readonly action: 'replace' }
  | { readonly action: 'skip' }
  | { readonly action: 'keep-both'; readonly destinationPath?: string }

export interface ConfirmWorkspaceImportOptions {
  readonly accepted: true
  /** Must be copied from the plan visible to the reviewer. */
  readonly reviewedDigest: string
  /** Keyed by artifact id, not a mutable destination label. */
  readonly collisionDecisions?: Readonly<Record<string, WorkspaceImportCollisionDecision>>
}

export interface ConfirmedWorkspaceImport {
  readonly plan: WorkspaceImportPlan
  readonly planId: string
  readonly reviewedDigest: string
  readonly collisionDecisions: Readonly<Record<string, WorkspaceImportCollisionDecision>>
}

export interface InspectedBpmnImport {
  readonly processIds: readonly string[]
}

export interface PreparedBpmnImport extends InspectedBpmnImport {
  readonly xml: string
  readonly validation: ValidationSummary
  readonly autoLayouted: boolean
}

export interface BpmnImportPreparationOptions {
  readonly knownProcessIds: ReadonlySet<string>
  readonly validationAdapters: readonly BpmnValidationAdapter[]
  readonly signal?: AbortSignal
}

/**
 * Port kept injectable so the transaction state machine can be tested without
 * weakening the production validator/layout/preservation pipeline.
 */
export interface BpmnImportPreparer {
  inspect(xml: string, signal?: AbortSignal): Promise<InspectedBpmnImport>
  prepare(xml: string, options: BpmnImportPreparationOptions): Promise<PreparedBpmnImport>
}

export interface PrepareWorkspaceImportOptions {
  readonly adapter: WorkspaceAdapter
  readonly sources: readonly WorkspaceImportSource[]
  readonly targetFolder?: string
  readonly language?: 'en' | 'ar'
  /**
   * Legacy compatibility input. An ID without a corresponding entry in
   * `existingProcessIndex` is treated as an unverifiable collision and skipped.
   */
  readonly existingProcessIds?: ReadonlySet<string>
  /**
   * Workspace process identity snapshot. This is structurally compatible with
   * the App's `ProcessIndex`; only each entry's portable `relPath` is consumed.
   *
   * An incoming process may replace an existing process only when its reviewed
   * destination resolves to the same normalized, case-insensitive path.
   */
  readonly existingProcessIndex?: ReadonlyMap<string, { readonly relPath: string }>
  readonly validationAdapters?: readonly BpmnValidationAdapter[]
  readonly bpmnPreparer?: BpmnImportPreparer
  readonly localizationResources?: LocalizationResources
  readonly localizationReview?: ReviewedXmlIngestionReviewer
  readonly reviewedBpmnIngestion?: ReviewedBpmnIngestionPort
  readonly processIdentityInspector?: WorkspaceProcessIdentityInspector
  readonly amlConverter?: (text: string, options: { lang: 'en' | 'ar' }) => Promise<AmlConversion>
  readonly limits?: WorkspaceImportLimits
  readonly signal?: AbortSignal
  readonly now?: () => Date
}

export interface WorkspaceImportHistory {
  createRevision(
    path: string,
    options: {
      reason: 'backup-import'
      snapshot: FileSnapshot
      /**
       * Retention is deferred until commit, preventing a failed import from
       * pruning older recovery evidence before rollback completes.
       */
      prune: false
      /** The exact execution signal, so history creation cannot outlive import cancellation. */
      signal?: AbortSignal
    }
  ): Promise<unknown>
  enforceRetention?(): Promise<unknown>
}

export interface ExecuteConfirmedWorkspaceImportOptions {
  readonly adapter: WorkspaceAdapter
  readonly history?: WorkspaceImportHistory
  readonly signal?: AbortSignal
  /** Optional caller snapshot; otherwise the adapter is securely rescanned. */
  readonly currentProcessIndex?: ReadonlyMap<string, { readonly relPath: string }>
  readonly currentProcessIds?: ReadonlySet<string>
  readonly processIdentityInspector?: WorkspaceProcessIdentityInspector
  /** App supplies its operation mutex so apply and rollback share one lane. */
  readonly runExclusive?: <T>(operation: () => Promise<T>) => Promise<T>
}

export interface WorkspaceImportExecutionEvidence {
  readonly reviewDigest: string
  readonly summary: WorkspaceImportReviewSummary
  readonly collisions: readonly WorkspaceImportCollision[]
  readonly collisionDecisions: Readonly<Record<string, WorkspaceImportCollisionDecision>>
  readonly skipped: readonly WorkspaceImportSkippedItem[]
  readonly repairs: readonly WorkspaceImportRepair[]
  readonly warnings: readonly WorkspaceImportWarning[]
  readonly arisReports: readonly WorkspaceImportArisEvidence[]
}

export type WorkspaceImportExecutionOutcome =
  | {
      readonly status: 'committed'
      readonly planId: string
      readonly applied: readonly WorkspaceBackupAppliedFile[]
      readonly skippedPaths: readonly string[]
      readonly historyRevisions: number
      readonly postCommitWarnings: readonly string[]
      readonly arisReports: readonly WorkspaceImportArisEvidence[]
      readonly evidence: WorkspaceImportExecutionEvidence
    }
  | {
      readonly status: 'rolled-back' | 'rollback-failed'
      readonly planId: string
      readonly appliedBeforeFailure: readonly WorkspaceBackupAppliedFile[]
      readonly skippedPaths: readonly string[]
      readonly historyRevisions: number
      readonly error: WorkspaceFailure
      readonly rollbackErrors: readonly WorkspaceFailure[]
      readonly arisReports: readonly WorkspaceImportArisEvidence[]
      readonly evidence: WorkspaceImportExecutionEvidence
    }

export type WorkspaceImportErrorCode =
  | 'invalid-input'
  | 'limit-exceeded'
  | 'cancelled'
  | 'plan-blocked'
  | 'review-mismatch'
  | 'unresolved-collision'
  | 'plan-tampered'
  | 'workspace-changed'
  | 'history-required'

export class WorkspaceImportError extends Error {
  readonly code: WorkspaceImportErrorCode

  constructor(code: WorkspaceImportErrorCode, message: string) {
    super(message)
    this.name = 'WorkspaceImportError'
    this.code = code
  }
}

class BpmnPreparationFailure extends Error {
  readonly summary?: ValidationSummary

  constructor(message: string, summary?: ValidationSummary) {
    super(message)
    this.name = 'BpmnPreparationFailure'
    this.summary = summary
  }
}

interface Candidate {
  readonly id: string
  readonly sourceId: string
  readonly sourceName: string
  readonly sourceKind: WorkspaceImportArtifactSourceKind
  readonly sourcePath: string
  readonly desiredPath: string
  readonly xml: string
  readonly repairs: readonly WorkspaceImportRepair[]
  readonly warnings: readonly WorkspaceImportWarning[]
  readonly processIds?: readonly string[]
  /** Existing IDs whose reviewed owner is this candidate's destination. */
  readonly replacesProcessIds?: readonly string[]
}

interface InspectedCandidate extends Candidate {
  readonly processIds: readonly string[]
  readonly replacesProcessIds: readonly string[]
}

interface PreparedCandidate extends InspectedCandidate {
  readonly prepared: PreparedBpmnImport
  readonly reviewed: CompletedReviewedBpmnIngestion
}

interface ExistingProcessIdentities {
  readonly ids: ReadonlySet<string>
  /** Normalized paths only. Missing means the caller supplied an ID without a verifiable path. */
  readonly paths: ReadonlyMap<string, string>
  readonly snapshot: readonly WorkspaceProcessIdentitySnapshotEntry[]
  readonly digest: string
}

function resolvedLimits(input: WorkspaceImportLimits = {}): ResolvedWorkspaceImportLimits {
  const limits = { ...DEFAULT_WORKSPACE_IMPORT_LIMITS, ...input }
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new WorkspaceImportError(
        'invalid-input',
        `Workspace import limit "${name}" must be a positive safe integer.`
      )
    }
  }
  return limits
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new WorkspaceImportError('cancelled', 'Workspace import was cancelled.')
  }
}

function assertSourcesWithinLimits(
  sources: readonly WorkspaceImportSource[],
  limits: ResolvedWorkspaceImportLimits
): void {
  if (sources.length > limits.maxSources) {
    throw new WorkspaceImportError(
      'limit-exceeded',
      `Workspace import has ${sources.length} sources; limit is ${limits.maxSources}.`
    )
  }
  const ids = new Set<string>()
  let totalCharacters = 0
  for (const source of sources) {
    if (!source.id.trim() || ids.has(source.id)) {
      throw new WorkspaceImportError(
        'invalid-input',
        `Workspace import source id "${source.id}" is empty or duplicated.`
      )
    }
    ids.add(source.id)
    if (!source.name.trim()) {
      throw new WorkspaceImportError(
        'invalid-input',
        `Workspace import source "${source.id}" has no name.`
      )
    }
    if (source.kind !== 'document') continue
    const sourceBytes = utf8ByteLength(source.text)
    if (sourceBytes > limits.maxSourceCharacters) {
      throw new WorkspaceImportError(
        'limit-exceeded',
        `Workspace import source "${source.name}" exceeds the encoded byte limit.`
      )
    }
    totalCharacters += sourceBytes
    if (totalCharacters > limits.maxTotalSourceCharacters) {
      throw new WorkspaceImportError(
        'limit-exceeded',
        'Workspace import exceeds the total encoded source byte limit.'
      )
    }
  }
}

function processIdsFromParsed(parsed: ParsedBpmnValidation): readonly string[] {
  const definitions = parsed.definitions as
    { rootElements?: Array<{ $type?: string; id?: string }> } | undefined
  return Object.freeze(
    [
      ...new Set(
        (definitions?.rootElements ?? [])
          .filter((element) => element.$type === 'bpmn:Process')
          .map((element) => element.id?.trim() ?? '')
          .filter(Boolean)
      )
    ].sort((left, right) => left.localeCompare(right, 'en'))
  )
}

function validationFailure(summary: ValidationSummary, prefix: string): BpmnPreparationFailure {
  const codes = summary.issues
    .filter((issue) => issue.blocking)
    .slice(0, 8)
    .map((issue) => issue.code)
    .join(', ')
  return new BpmnPreparationFailure(`${prefix}${codes ? `: ${codes}` : ''}`, summary)
}

function evaluatePreLocalizationImportPolicy(summary: ValidationSummary) {
  return evaluateValidationPolicy(
    {
      ...summary,
      issues: summary.issues.filter(
        (issue) =>
          !(
            issue.source === 'orbitpm' &&
            (issue.code.startsWith('orbitpm.bilingual-') ||
              issue.code === 'orbitpm.active-language' ||
              issue.code === 'orbitpm.active-projection-mismatch')
          )
      )
    },
    'commit-import'
  )
}

export const secureBpmnImportPreparer: BpmnImportPreparer = Object.freeze({
  async inspect(xml: string, signal?: AbortSignal) {
    throwIfAborted(signal)
    const parsed = await validateBpmnXml(xml, { requireDi: false })
    throwIfAborted(signal)
    if (!parsed.summary.xmlWellFormed || !parsed.definitions) {
      throw validationFailure(parsed.summary, 'BPMN secure parse failed')
    }
    return Object.freeze({ processIds: processIdsFromParsed(parsed) })
  },

  async prepare(xml: string, options: BpmnImportPreparationOptions) {
    throwIfAborted(options.signal)
    const preview = await validateBpmnXml(xml, {
      adapters: options.validationAdapters,
      knownProcessIds: options.knownProcessIds,
      requireBilingual: false,
      requireDi: false
    })
    throwIfAborted(options.signal)
    const previewPolicy = evaluatePreLocalizationImportPolicy(preview.summary)
    if (!previewPolicy.allowed) {
      throw validationFailure(preview.summary, 'BPMN import validation failed')
    }

    const missingDi = preview.summary.issues.some(
      (issue) => issue.code === 'di.process-missing' || issue.code === 'bpmnlint.no-bpmndi'
    )
    let preparedXml = xml
    let autoLayouted = false
    if (missingDi) {
      const layout = await layoutBpmnValidated(xml, {
        validation: {
          adapters: options.validationAdapters,
          knownProcessIds: options.knownProcessIds,
          requireBilingual: false
        }
      })
      throwIfAborted(options.signal)
      const preservation = await validateUnknownExtensionPreservation(xml, layout.xml)
      if (!preservation.valid) {
        throw validationFailure(preservation, 'BPMN auto-layout failed extension preservation')
      }
      preparedXml = layout.xml
      autoLayouted = true
    }

    const final = await validateBpmnXml(preparedXml, {
      adapters: options.validationAdapters,
      knownProcessIds: options.knownProcessIds,
      requireBilingual: false,
      requireDi: true
    })
    throwIfAborted(options.signal)
    const finalPolicy = evaluatePreLocalizationImportPolicy(final.summary)
    if (!finalPolicy.allowed || !final.definitions) {
      throw validationFailure(final.summary, 'Prepared BPMN import validation failed')
    }
    return Object.freeze({
      xml: preparedXml,
      validation: final.summary,
      autoLayouted,
      processIds: processIdsFromParsed(final)
    })
  }
})

function sourceRelativePath(source: Extract<WorkspaceImportSource, { kind: 'document' }>): string {
  return source.relPath?.trim() || source.name
}

function bpmnDestinationPath(input: string): {
  path: string
  changed: boolean
} {
  const normalized = normalizeWorkspacePath(input)
  const parent = workspaceParentPath(normalized)
  const leaf = workspacePathName(normalized)
  const withoutExtension = leaf.replace(/\.(?:bpmn|xml|apc|aml)$/i, '')
  const safeLeaf = `${deriveFileBaseName(withoutExtension)}.bpmn`
  const path = parent ? joinWorkspacePath(parent, safeLeaf) : safeLeaf
  return { path, changed: path !== normalized }
}

function withTargetFolder(path: string, targetFolder: string): string {
  return targetFolder ? joinWorkspacePath(targetFolder, path) : normalizeWorkspacePath(path)
}

function repair(
  code: WorkspaceImportRepairCode,
  candidate: Pick<Candidate, 'id' | 'sourceId'>,
  message: string,
  before?: string,
  after?: string
): WorkspaceImportRepair {
  return Object.freeze({
    code,
    sourceId: candidate.sourceId,
    artifactId: candidate.id,
    message,
    ...(before !== undefined ? { before } : {}),
    ...(after !== undefined ? { after } : {})
  })
}

function reportWarnings(
  sourceId: string,
  report: ArisConversionReport
): readonly WorkspaceImportWarning[] {
  return (['downgraded', 'ignored', 'ambiguous', 'unmapped'] as const)
    .map((category) => ({ category, count: report.summary[category] }))
    .filter(({ count }) => count > 0)
    .map(({ category, count }) =>
      Object.freeze({
        code: `aml-${category}`,
        sourceId,
        count,
        message: `ARIS conversion reported ${count} ${category} source decision${
          count === 1 ? '' : 's'
        }.`
      })
    )
}

function skipped(
  sourceId: string,
  sourceName: string,
  reason: WorkspaceImportSkipReason,
  message: string,
  path?: string
): WorkspaceImportSkippedItem {
  return Object.freeze({
    sourceId,
    sourceName,
    reason,
    message,
    ...(path ? { path } : {})
  })
}

async function flattenSources(
  sources: readonly WorkspaceImportSource[],
  language: 'en' | 'ar',
  targetFolder: string,
  amlConverter: NonNullable<PrepareWorkspaceImportOptions['amlConverter']>,
  signal: AbortSignal | undefined
): Promise<{
  candidates: Candidate[]
  skippedItems: WorkspaceImportSkippedItem[]
  sourceWarnings: WorkspaceImportWarning[]
  arisReports: WorkspaceImportArisEvidence[]
}> {
  const candidates: Candidate[] = []
  const skippedItems: WorkspaceImportSkippedItem[] = []
  const sourceWarnings: WorkspaceImportWarning[] = []
  const arisReports: WorkspaceImportArisEvidence[] = []

  const addBpmnCandidate = (
    source: Pick<WorkspaceImportSource, 'id' | 'name'>,
    sourceKind: WorkspaceImportArtifactSourceKind,
    sourcePath: string,
    xml: string,
    ordinal: number,
    initialRepairs: readonly WorkspaceImportRepair[] = [],
    initialWarnings: readonly WorkspaceImportWarning[] = []
  ): void => {
    const id = `${source.id}:${ordinal}`
    const pathResult = bpmnDestinationPath(sourcePath)
    const desiredPath = withTargetFolder(pathResult.path, targetFolder)
    try {
      assertNonReservedImportPath(desiredPath, 'Workspace import destination')
    } catch (error) {
      throw new WorkspaceImportError(
        'invalid-input',
        error instanceof Error ? error.message : String(error)
      )
    }
    const draft: Candidate = {
      id,
      sourceId: source.id,
      sourceName: source.name,
      sourceKind,
      sourcePath,
      desiredPath,
      xml,
      repairs: Object.freeze([...initialRepairs]),
      warnings: Object.freeze([...initialWarnings])
    }
    const repairs = [...draft.repairs]
    if (pathResult.changed || desiredPath !== sourcePath) {
      repairs.push(
        repair(
          'destination-normalized',
          draft,
          'The imported document destination was normalized to a portable BPMN path.',
          sourcePath,
          desiredPath
        )
      )
    }
    candidates.push(Object.freeze({ ...draft, repairs: Object.freeze(repairs) }))
  }

  for (const source of sources) {
    throwIfAborted(signal)
    if (source.kind === 'library') {
      let ordinal = 0
      for (const entry of source.result.entries) {
        ordinal += 1
        try {
          addBpmnCandidate(source, 'library', entry.relPath, entry.xml, ordinal)
        } catch (error) {
          if (error instanceof WorkspaceImportError) throw error
          skippedItems.push(
            skipped(
              source.id,
              source.name,
              'unsafe-path',
              error instanceof Error ? error.message : String(error),
              entry.relPath
            )
          )
        }
      }
      for (const item of source.result.skipped) {
        skippedItems.push(
          skipped(
            source.id,
            source.name,
            `library-${item.reason}`,
            `Library entry "${item.path}" was skipped during ZIP preflight or decoding.`,
            item.path
          )
        )
      }
      continue
    }

    const sourcePath = sourceRelativePath(source)
    try {
      normalizeWorkspacePath(sourcePath)
    } catch (error) {
      skippedItems.push(
        skipped(
          source.id,
          source.name,
          'unsafe-path',
          error instanceof Error ? error.message : String(error),
          sourcePath
        )
      )
      continue
    }
    if (looksLikeBpmnXml(source.text)) {
      addBpmnCandidate(source, 'bpmn', sourcePath, source.text, 1)
      continue
    }
    if (looksLikeAml(source.text)) {
      const conversion = await amlConverter(source.text, { lang: language })
      throwIfAborted(signal)
      if ('error' in conversion) {
        skippedItems.push(
          skipped(
            source.id,
            source.name,
            'aml-conversion-failed',
            `ARIS conversion failed: ${conversion.error}`,
            sourcePath
          )
        )
        continue
      }
      const warnings = reportWarnings(source.id, conversion.report)
      sourceWarnings.push(...warnings)
      arisReports.push(
        Object.freeze({
          sourceId: source.id,
          sourceName: source.name,
          report: conversion.report,
          download: createArisConversionReportDownload(conversion.report, source.name)
        })
      )
      const sourceParent = workspaceParentPath(normalizeWorkspacePath(sourcePath))
      const multiFolder =
        conversion.files.length > 1
          ? sanitizeFolderName(
              conversion.folderName ?? '',
              deriveFileBaseName(source.name.replace(/\.(?:apc|aml|xml)$/i, ''))
            )
          : ''
      let ordinal = 0
      for (const model of conversion.files) {
        ordinal += 1
        const displayName =
          (language === 'ar' ? model.nameAr : model.nameEn) || model.name || `process-${ordinal}`
        const leaf = `${deriveFileBaseName(displayName)}.bpmn`
        const relative = [sourceParent, multiFolder, leaf].filter(Boolean).join('/')
        const candidateId = `${source.id}:${ordinal}`
        addBpmnCandidate(source, 'aml', relative, model.xml, ordinal, [
          Object.freeze({
            code: 'aml-converted',
            sourceId: source.id,
            artifactId: candidateId,
            message: 'ARIS AML was converted to reviewed BPMN 2.0 output.',
            before: sourcePath,
            after: withTargetFolder(relative, targetFolder)
          })
        ])
      }
      continue
    }

    const extensionIsBpmn = /\.bpmn$/i.test(source.name)
    if (extensionIsBpmn) {
      try {
        addBpmnCandidate(source, 'bpmn', sourcePath, source.text, 1)
      } catch (error) {
        if (error instanceof WorkspaceImportError) throw error
        skippedItems.push(
          skipped(
            source.id,
            source.name,
            'unsafe-path',
            error instanceof Error ? error.message : String(error),
            sourcePath
          )
        )
      }
      continue
    }

    skippedItems.push(
      skipped(
        source.id,
        source.name,
        'unsupported-content',
        'The source is neither BPMN XML nor an ARIS AML export.',
        sourcePath
      )
    )
  }

  return { candidates, skippedItems, sourceWarnings, arisReports }
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

async function snapshotExistingProcessIdentities(
  existingProcessIds: ReadonlySet<string> | undefined,
  existingProcessIndex: ReadonlyMap<string, { readonly relPath: string }> | undefined,
  fallbackSnapshot: readonly WorkspaceProcessIdentitySnapshotEntry[] = []
): Promise<ExistingProcessIdentities> {
  const ids = new Set(existingProcessIds ?? [])
  const paths = new Map<string, string>()
  for (const entry of fallbackSnapshot) {
    ids.add(entry.processId)
    if (entry.path !== null) paths.set(entry.processId, entry.path)
  }
  for (const [processId, entry] of existingProcessIndex ?? []) {
    ids.add(processId)
    try {
      paths.set(processId, normalizeWorkspacePath(entry.relPath))
    } catch {
      // Keep the ID without a path. Identity verification will fail safe for
      // candidates that attempt to reuse it.
    }
  }
  for (const processId of existingProcessIds ?? []) {
    if (!existingProcessIndex?.has(processId)) paths.delete(processId)
  }
  const snapshot = normalizeProcessIdentitySnapshot(
    new Map([...paths].map(([processId, relPath]) => [processId, { relPath }])),
    ids
  )
  return {
    ids,
    paths,
    snapshot,
    digest: await digestProcessIdentitySnapshot(snapshot)
  }
}

function samePortablePath(left: string, right: string): boolean {
  return pathKey(left) === pathKey(right)
}

async function inspectCandidates(
  candidates: readonly Candidate[],
  preparer: BpmnImportPreparer,
  skippedItems: WorkspaceImportSkippedItem[],
  warnings: WorkspaceImportWarning[],
  existingProcesses: ExistingProcessIdentities,
  signal?: AbortSignal
): Promise<InspectedCandidate[]> {
  const parsed: Array<{ candidate: Candidate; processIds: readonly string[] }> = []
  for (const candidate of candidates) {
    throwIfAborted(signal)
    try {
      const result = await preparer.inspect(candidate.xml, signal)
      const processIds = Object.freeze([...new Set(result.processIds)].sort())
      parsed.push({ candidate, processIds })
    } catch (error) {
      const failure = error instanceof BpmnPreparationFailure ? error : undefined
      skippedItems.push(
        skipped(
          candidate.sourceId,
          candidate.sourceName,
          'invalid-bpmn',
          failure?.message ?? (error instanceof Error ? error.message : String(error)),
          candidate.sourcePath
        )
      )
      for (const issue of failure?.summary?.issues ?? []) {
        warnings.push(
          Object.freeze({
            code: issue.code,
            sourceId: candidate.sourceId,
            artifactId: candidate.id,
            message: issue.message,
            validationIssue: issue
          })
        )
      }
    }
  }

  const incomingCounts = new Map<string, number>()
  for (const { processIds } of parsed) {
    for (const processId of processIds) {
      incomingCounts.set(processId, (incomingCounts.get(processId) ?? 0) + 1)
    }
  }
  const inspected: InspectedCandidate[] = []
  for (const { candidate, processIds } of parsed) {
    const duplicate = processIds.find((id) => (incomingCounts.get(id) ?? 0) > 1)
    if (duplicate) {
      skippedItems.push(
        skipped(
          candidate.sourceId,
          candidate.sourceName,
          'process-id-collision',
          `Process id "${duplicate}" is duplicated by incoming artifacts.`,
          candidate.sourcePath
        )
      )
      continue
    }
    const replacesProcessIds: string[] = []
    let identityCollision = false
    for (const processId of processIds) {
      if (!existingProcesses.ids.has(processId)) continue
      const existingPath = existingProcesses.paths.get(processId)
      if (!existingPath) {
        skippedItems.push(
          skipped(
            candidate.sourceId,
            candidate.sourceName,
            'process-id-collision',
            `Process id "${processId}" already exists, but its workspace path was not supplied; replacement identity cannot be verified.`,
            candidate.sourcePath
          )
        )
        identityCollision = true
        break
      }
      if (!samePortablePath(existingPath, candidate.desiredPath)) {
        skippedItems.push(
          skipped(
            candidate.sourceId,
            candidate.sourceName,
            'process-id-collision',
            `Process id "${processId}" belongs to workspace path "${existingPath}", not reviewed destination "${candidate.desiredPath}".`,
            candidate.sourcePath
          )
        )
        identityCollision = true
        break
      }
      replacesProcessIds.push(processId)
    }
    if (identityCollision) continue
    if (replacesProcessIds.length > 0) {
      warnings.push(
        Object.freeze({
          code: 'same-path-process-replacement',
          sourceId: candidate.sourceId,
          artifactId: candidate.id,
          count: replacesProcessIds.length,
          message: `${replacesProcessIds.length} existing process id${
            replacesProcessIds.length === 1 ? '' : 's'
          } will be replaced only at the same reviewed workspace path.`
        })
      )
    }
    inspected.push(
      Object.freeze({
        ...candidate,
        processIds,
        replacesProcessIds: Object.freeze(replacesProcessIds)
      })
    )
  }
  return inspected
}

async function prepareCandidateClosure(
  candidates: readonly InspectedCandidate[],
  preparer: BpmnImportPreparer,
  reviewedBpmnIngestion: ReviewedBpmnIngestionPort,
  localizationResources: LocalizationResources,
  localizationReview: ReviewedXmlIngestionReviewer | undefined,
  language: 'en' | 'ar',
  validationAdapters: readonly BpmnValidationAdapter[],
  existingProcessIds: ReadonlySet<string>,
  skippedItems: WorkspaceImportSkippedItem[],
  warnings: WorkspaceImportWarning[],
  signal?: AbortSignal
): Promise<PreparedCandidate[]> {
  const originalById = new Map(candidates.map((candidate) => [candidate.id, candidate]))
  let active = [...candidates]
  let prepared: PreparedCandidate[] = []

  // When one document fails, re-run survivors without its process ids. This
  // closes forward-reference chains: a caller cannot commit merely because it
  // referenced a process that was parsed but will not be written.
  for (let pass = 0; pass <= candidates.length; pass += 1) {
    throwIfAborted(signal)
    const knownProcessIds = new Set(existingProcessIds)
    for (const candidate of active) {
      for (const processId of candidate.processIds ?? []) knownProcessIds.add(processId)
    }

    const next: PreparedCandidate[] = []
    for (const candidate of active) {
      throwIfAborted(signal)
      let preparedStructurally = false
      try {
        const result = await preparer.prepare(candidate.xml, {
          knownProcessIds,
          validationAdapters,
          signal
        })
        preparedStructurally = true
        const processIds = Object.freeze([...new Set(result.processIds)].sort())
        if (!sameStringSet(candidate.processIds ?? [], processIds)) {
          skippedItems.push(
            skipped(
              candidate.sourceId,
              candidate.sourceName,
              'process-identity-changed',
              'Secure preparation changed the document process identity.',
              candidate.sourcePath
            )
          )
          continue
        }
        const reviewed = await reviewedBpmnIngestion(result.xml, {
          source: localizationSourceForImport(candidate.sourceKind),
          target: language,
          resources: localizationResources,
          knownProcessIds: [...knownProcessIds].sort((left, right) =>
            left.localeCompare(right, 'en')
          ),
          validationAdapters,
          review: localizationReview,
          signal
        })
        throwIfAborted(signal)
        const reviewedIdentity = await preparer.inspect(reviewed.xml, signal)
        const reviewedProcessIds = Object.freeze(
          [...new Set(reviewedIdentity.processIds)].sort((left, right) =>
            left.localeCompare(right, 'en')
          )
        )
        if (!sameStringSet(processIds, reviewedProcessIds)) {
          skippedItems.push(
            skipped(
              candidate.sourceId,
              candidate.sourceName,
              'process-identity-changed',
              'Reviewed localization changed the document process identity.',
              candidate.sourcePath
            )
          )
          continue
        }
        const candidateWarnings = [...result.validation.issues, ...reviewed.validation.issues]
          .filter((issue) => !issue.blocking)
          .filter(
            (issue, index, all) =>
              all.findIndex(
                (candidateIssue) =>
                  candidateIssue.code === issue.code &&
                  candidateIssue.elementId === issue.elementId &&
                  candidateIssue.message === issue.message
              ) === index
          )
          .map((issue) =>
            Object.freeze({
              code: issue.code,
              sourceId: candidate.sourceId,
              artifactId: candidate.id,
              message: issue.message,
              validationIssue: issue
            })
          )
        next.push(
          Object.freeze({
            ...candidate,
            processIds: reviewedProcessIds,
            prepared: result,
            reviewed,
            warnings: Object.freeze([...candidate.warnings, ...candidateWarnings]),
            repairs: Object.freeze([
              ...candidate.repairs,
              ...(result.autoLayouted
                ? [
                    repair(
                      'auto-layout',
                      candidate,
                      'Missing BPMN DI was generated and the exact output revalidated.'
                    )
                  ]
                : [])
            ])
          })
        )
      } catch (error) {
        const failure = error instanceof BpmnPreparationFailure ? error : undefined
        const reviewFailure = error instanceof ReviewedBpmnBoundaryError ? error : undefined
        const reviewReason: WorkspaceImportSkipReason =
          reviewFailure?.code === 'review-required'
            ? 'localization-review-required'
            : reviewFailure?.code === 'review-cancelled'
              ? 'localization-review-cancelled'
              : failure
                ? 'invalid-bpmn'
                : preparedStructurally
                  ? 'localization-invalid'
                  : 'invalid-bpmn'
        skippedItems.push(
          skipped(
            candidate.sourceId,
            candidate.sourceName,
            reviewReason,
            failure?.message ?? (error instanceof Error ? error.message : String(error)),
            candidate.sourcePath
          )
        )
        for (const issue of failure?.summary?.issues ?? []) {
          warnings.push(
            Object.freeze({
              code: issue.code,
              sourceId: candidate.sourceId,
              artifactId: candidate.id,
              message: issue.message,
              validationIssue: issue
            })
          )
        }
      }
    }

    prepared = next
    if (next.length === active.length) break
    active = next.map((candidate) => originalById.get(candidate.id)!)
  }
  return prepared
}

function assertCandidateLimits(
  candidates: readonly Candidate[],
  limits: ResolvedWorkspaceImportLimits
): void {
  let totalBytes = 0
  for (const candidate of candidates) {
    const bytes = utf8ByteLength(candidate.xml)
    if (bytes > limits.maxArtifactBytes) {
      throw new WorkspaceImportError(
        'limit-exceeded',
        `Candidate artifact "${candidate.sourcePath}" exceeds the pre-parse byte limit.`
      )
    }
    totalBytes += bytes
    if (totalBytes > limits.maxTotalArtifactBytes) {
      throw new WorkspaceImportError(
        'limit-exceeded',
        'Workspace import exceeds the total pre-parse candidate byte limit.'
      )
    }
  }
}

function utf8ByteLength(text: string): number {
  let bytes = 0
  for (const character of text) {
    const codePoint = character.codePointAt(0)!
    bytes += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4
  }
  return bytes
}

function pathKey(path: string): string {
  return path.normalize('NFC').toLocaleLowerCase('en-US')
}

function candidateSiblingPath(path: string, occupied: ReadonlySet<string>, label: string): string {
  const parent = workspaceParentPath(path)
  const name = workspacePathName(path)
  const extensionIndex = name.toLocaleLowerCase('en-US').endsWith('.bpmn')
    ? name.length - '.bpmn'.length
    : name.lastIndexOf('.')
  const stem = extensionIndex > 0 ? name.slice(0, extensionIndex) : name
  const extension = extensionIndex > 0 ? name.slice(extensionIndex) : ''
  for (let suffix = 1; suffix <= 10_000; suffix += 1) {
    const leaf = `${stem}-${label}${suffix === 1 ? '' : `-${suffix}`}${extension}`
    const candidate = parent ? joinWorkspacePath(parent, leaf) : leaf
    if (!occupied.has(pathKey(candidate))) return candidate
  }
  throw new WorkspaceImportError(
    'invalid-input',
    `Could not allocate a collision-free import destination for "${path}".`
  )
}

async function materializeArtifacts(
  prepared: readonly PreparedCandidate[],
  adapter: WorkspaceAdapter,
  existingProcesses: ExistingProcessIdentities,
  limits: ResolvedWorkspaceImportLimits,
  skippedItems: WorkspaceImportSkippedItem[],
  signal: AbortSignal | undefined
): Promise<{
  artifacts: WorkspaceImportArtifact[]
  collisions: WorkspaceImportCollision[]
  repairs: WorkspaceImportRepair[]
  warnings: WorkspaceImportWarning[]
}> {
  if (prepared.length > limits.maxArtifacts) {
    throw new WorkspaceImportError(
      'limit-exceeded',
      `Workspace import produced ${prepared.length} artifacts; limit is ${limits.maxArtifacts}.`
    )
  }
  throwIfAborted(signal)
  const entries = await adapter.list()
  throwIfAborted(signal)
  const byKey = new Map(entries.map((entry) => [pathKey(entry.path), entry]))
  const occupied = new Set(entries.map((entry) => pathKey(entry.path)))
  const claimed = new Set<string>()
  const artifacts: WorkspaceImportArtifact[] = []
  const collisions: WorkspaceImportCollision[] = []
  const repairs: WorkspaceImportRepair[] = []
  const warnings: WorkspaceImportWarning[] = []
  let totalBytes = 0

  for (const candidate of prepared) {
    throwIfAborted(signal)
    let destinationPath = candidate.desiredPath
    const destinationRepairs: WorkspaceImportRepair[] = []
    let parent = workspaceParentPath(destinationPath)
    let blockedParent: string | undefined
    while (parent) {
      const parentKey = pathKey(parent)
      if (byKey.get(parentKey)?.kind === 'file' || claimed.has(parentKey)) {
        blockedParent = parent
        break
      }
      parent = workspaceParentPath(parent)
    }
    if (blockedParent) {
      skippedItems.push(
        skipped(
          candidate.sourceId,
          candidate.sourceName,
          'destination-parent-file',
          `Destination parent "${blockedParent}" is a file planned or present in the workspace.`,
          candidate.sourcePath
        )
      )
      continue
    }
    const existingByCase = byKey.get(pathKey(destinationPath))
    if (existingByCase?.kind === 'file' && existingByCase.path !== destinationPath) {
      const before = destinationPath
      destinationPath = existingByCase.path
      destinationRepairs.push(
        repair(
          'destination-case-normalized',
          candidate,
          'Destination casing was aligned with the existing portable workspace path.',
          before,
          destinationPath
        )
      )
    }
    if (existingByCase?.kind === 'directory' || claimed.has(pathKey(destinationPath))) {
      const before = destinationPath
      destinationPath = candidateSiblingPath(
        destinationPath,
        new Set([...occupied, ...claimed]),
        'imported'
      )
      destinationRepairs.push(
        repair(
          'destination-deduplicated',
          candidate,
          'A directory or another incoming artifact occupied the requested destination.',
          before,
          destinationPath
        )
      )
    }
    const displacedProcessId = candidate.replacesProcessIds.find((processId) => {
      const existingPath = existingProcesses.paths.get(processId)
      return !existingPath || !samePortablePath(existingPath, destinationPath)
    })
    if (displacedProcessId) {
      skippedItems.push(
        skipped(
          candidate.sourceId,
          candidate.sourceName,
          'process-id-collision',
          `Process id "${displacedProcessId}" cannot move from its reviewed workspace path during destination planning.`,
          candidate.sourcePath
        )
      )
      continue
    }
    claimed.add(pathKey(destinationPath))
    occupied.add(pathKey(destinationPath))

    const bytes = encoder.encode(candidate.reviewed.xml)
    if (bytes.byteLength > limits.maxArtifactBytes) {
      throw new WorkspaceImportError(
        'limit-exceeded',
        `Prepared artifact "${candidate.sourcePath}" exceeds the byte limit.`
      )
    }
    totalBytes += bytes.byteLength
    if (totalBytes > limits.maxTotalArtifactBytes) {
      throw new WorkspaceImportError(
        'limit-exceeded',
        'Workspace import exceeds the total prepared artifact byte limit.'
      )
    }
    const sha256 = await sha256Hex(bytes)
    if (
      !equalHash(sha256, candidate.reviewed.digest) ||
      !equalHash(candidate.reviewed.digest, candidate.reviewed.evidence.outputDigest)
    ) {
      throw new WorkspaceImportError(
        'plan-tampered',
        `Reviewed BPMN artifact "${candidate.id}" has inconsistent localization evidence.`
      )
    }
    const artifact: WorkspaceImportArtifact = Object.freeze({
      id: candidate.id,
      sourceId: candidate.sourceId,
      sourceName: candidate.sourceName,
      sourceKind: candidate.sourceKind,
      sourcePath: candidate.sourcePath,
      destinationPath,
      xml: candidate.reviewed.xml,
      bytes: copyBytes(bytes),
      sha256,
      processIds: candidate.processIds,
      replacesProcessIds: candidate.replacesProcessIds,
      validation: candidate.reviewed.validation,
      localizationReviewDigest: candidate.reviewed.reviewDigest,
      localizationEvidence: candidate.reviewed.evidence
    })
    artifacts.push(artifact)
    repairs.push(...candidate.repairs, ...destinationRepairs)
    warnings.push(...candidate.warnings)

    const matchingEntry = byKey.get(pathKey(destinationPath))
    if (matchingEntry?.kind === 'file') {
      const existing = await adapter.read(matchingEntry.path)
      throwIfAborted(signal)
      const suggestedKeepBothPath = candidateSiblingPath(
        destinationPath,
        new Set([...occupied, ...claimed]),
        'imported'
      )
      collisions.push(
        Object.freeze({
          artifactId: candidate.id,
          path: destinationPath,
          incomingHash: sha256,
          existingHash: existing.hash,
          identical: equalHash(sha256, existing.hash),
          existing: Object.freeze({ ...existing, bytes: copyBytes(existing.bytes) }),
          suggestedKeepBothPath
        })
      )
    }
  }
  return { artifacts, collisions, repairs, warnings }
}

function reviewPayload(plan: Omit<WorkspaceImportPlan, 'id' | 'reviewDigest'>): unknown {
  return {
    version: plan.version,
    createdAt: plan.createdAt,
    workspaceId: plan.workspaceId,
    workspaceMode: plan.workspaceMode,
    workspaceMultipleFiles: plan.workspaceMultipleFiles,
    status: plan.status,
    targetFolder: plan.targetFolder,
    artifacts: plan.artifacts.map((artifact) => ({
      id: artifact.id,
      sourceId: artifact.sourceId,
      sourceName: artifact.sourceName,
      sourceKind: artifact.sourceKind,
      sourcePath: artifact.sourcePath,
      destinationPath: artifact.destinationPath,
      sha256: artifact.sha256,
      bytes: artifact.bytes.byteLength,
      processIds: artifact.processIds,
      replacesProcessIds: artifact.replacesProcessIds,
      localizationReviewDigest: artifact.localizationReviewDigest,
      localizationOutputDigest: artifact.localizationEvidence.outputDigest,
      validationIssues: artifact.validation.issues
    })),
    collisions: plan.collisions.map((collision) => ({
      artifactId: collision.artifactId,
      path: collision.path,
      incomingHash: collision.incomingHash,
      existingHash: collision.existingHash,
      identical: collision.identical,
      suggestedKeepBothPath: collision.suggestedKeepBothPath
    })),
    skipped: plan.skipped,
    repairs: plan.repairs,
    warnings: plan.warnings,
    arisReports: plan.arisReports,
    summary: plan.summary,
    processIdentitySnapshot: plan.processIdentitySnapshot,
    processIdentityDigest: plan.processIdentityDigest
  }
}

async function digestReview(
  plan: Omit<WorkspaceImportPlan, 'id' | 'reviewDigest'>
): Promise<string> {
  return sha256Hex(encoder.encode(JSON.stringify(reviewPayload(plan))))
}

export async function prepareWorkspaceImportPlan(
  options: PrepareWorkspaceImportOptions
): Promise<WorkspaceImportPlan> {
  const limits = resolvedLimits(options.limits)
  assertSourcesWithinLimits(options.sources, limits)
  throwIfAborted(options.signal)
  const targetFolder = normalizeWorkspacePath(options.targetFolder ?? '', { allowRoot: true })
  try {
    assertNonReservedImportPath(targetFolder, 'Workspace import target folder')
  } catch (error) {
    throw new WorkspaceImportError(
      'invalid-input',
      error instanceof Error ? error.message : String(error)
    )
  }
  const language = options.language ?? 'en'
  const preparer = options.bpmnPreparer ?? secureBpmnImportPreparer
  const processIdentityInspector = options.processIdentityInspector ?? preparer.inspect.bind(preparer)
  const validationAdapters = options.validationAdapters ?? getRuntimeValidationAdapters()
  const scannedSnapshot =
    options.existingProcessIndex === undefined
      ? await scanWorkspaceProcessIdentities(options.adapter, {
          inspector: processIdentityInspector,
          signal: options.signal
        })
      : Object.freeze([])
  const scannedSnapshotDigest =
    options.existingProcessIndex === undefined
      ? await digestProcessIdentitySnapshot(scannedSnapshot)
      : undefined
  const existingProcesses = await snapshotExistingProcessIdentities(
    options.existingProcessIds,
    options.existingProcessIndex,
    scannedSnapshot
  )
  const flattened = await flattenSources(
    options.sources,
    language,
    targetFolder,
    options.amlConverter ?? convertAmlToBpmnFiles,
    options.signal
  )
  if (flattened.candidates.length > limits.maxArtifacts) {
    throw new WorkspaceImportError(
      'limit-exceeded',
      `Workspace import produced too many candidate artifacts (${flattened.candidates.length}).`
    )
  }
  assertCandidateLimits(flattened.candidates, limits)

  const skippedItems = [...flattened.skippedItems]
  const warnings = [...flattened.sourceWarnings]
  const inspected = await inspectCandidates(
    flattened.candidates,
    preparer,
    skippedItems,
    warnings,
    existingProcesses,
    options.signal
  )
  const prepared = await prepareCandidateClosure(
    inspected,
    preparer,
    options.reviewedBpmnIngestion ?? secureReviewedBpmnIngestion,
    options.localizationResources ?? defaultLocalizationResources(),
    options.localizationReview,
    language,
    validationAdapters,
    existingProcesses.ids,
    skippedItems,
    warnings,
    options.signal
  )
  const materialized = await materializeArtifacts(
    prepared,
    options.adapter,
    existingProcesses,
    limits,
    skippedItems,
    options.signal
  )
  if (!options.adapter.storage.capabilities.multipleFiles && materialized.artifacts.length > 1) {
    throw new WorkspaceImportError(
      'invalid-input',
      'The selected workspace adapter cannot import multiple files.'
    )
  }
  if (options.existingProcessIndex === undefined) {
    const currentSnapshot = await scanWorkspaceProcessIdentities(options.adapter, {
      inspector: processIdentityInspector,
      signal: options.signal
    })
    const currentDigest = await digestProcessIdentitySnapshot(currentSnapshot)
    if (
      scannedSnapshotDigest === undefined ||
      !equalHash(currentDigest, scannedSnapshotDigest)
    ) {
      throw new WorkspaceImportError(
        'workspace-changed',
        'Workspace process identities changed while the import plan was being prepared.'
      )
    }
  }
  warnings.push(...materialized.warnings)

  const status = materialized.artifacts.length > 0 ? 'ready' : 'blocked'
  const summary: WorkspaceImportReviewSummary = Object.freeze({
    sources: options.sources.length,
    artifacts: materialized.artifacts.length,
    collisions: materialized.collisions.length,
    skipped: skippedItems.length,
    repairs: materialized.repairs.length,
    warnings: warnings.length,
    arisReports: flattened.arisReports.length,
    creates: materialized.artifacts.length - materialized.collisions.length,
    identical: materialized.collisions.filter(({ identical }) => identical).length
  })
  const planWithoutDigest: Omit<WorkspaceImportPlan, 'id' | 'reviewDigest'> = {
    version: 1,
    createdAt: (options.now ?? (() => new Date()))().toISOString(),
    workspaceId: options.adapter.id,
    workspaceMode: options.adapter.mode,
    workspaceMultipleFiles: options.adapter.storage.capabilities.multipleFiles,
    status,
    targetFolder,
    artifacts: Object.freeze(materialized.artifacts),
    collisions: Object.freeze(materialized.collisions),
    skipped: Object.freeze(skippedItems),
    repairs: Object.freeze(materialized.repairs),
    warnings: Object.freeze(warnings),
    arisReports: Object.freeze(flattened.arisReports),
    summary,
    processIdentitySnapshot: existingProcesses.snapshot,
    processIdentityDigest: existingProcesses.digest
  }
  const reviewDigest = await digestReview(planWithoutDigest)
  return Object.freeze({
    ...planWithoutDigest,
    id: `workspace-import-${reviewDigest.slice(0, 24)}`,
    reviewDigest
  })
}

function normalizedDecision(
  collision: WorkspaceImportCollision,
  input: WorkspaceImportCollisionDecision | undefined
): WorkspaceImportCollisionDecision {
  if (!input && collision.identical) return Object.freeze({ action: 'skip' })
  if (!input) {
    throw new WorkspaceImportError(
      'unresolved-collision',
      `Collision "${collision.path}" has no reviewed decision.`
    )
  }
  if (input.action !== 'keep-both') return Object.freeze({ action: input.action })
  const destinationPath = normalizeWorkspacePath(
    input.destinationPath ?? collision.suggestedKeepBothPath
  )
  try {
    assertNonReservedImportPath(destinationPath, 'Workspace import keep-both destination')
  } catch (error) {
    throw new WorkspaceImportError(
      'invalid-input',
      error instanceof Error ? error.message : String(error)
    )
  }
  return Object.freeze({ action: 'keep-both', destinationPath })
}

export function confirmWorkspaceImportPlan(
  plan: WorkspaceImportPlan,
  options: ConfirmWorkspaceImportOptions
): ConfirmedWorkspaceImport {
  if (plan.status !== 'ready') {
    throw new WorkspaceImportError(
      'plan-blocked',
      'A blocked workspace import cannot be confirmed.'
    )
  }
  if (options.reviewedDigest !== plan.reviewDigest) {
    throw new WorkspaceImportError(
      'review-mismatch',
      'The confirmed review digest does not match the current import plan.'
    )
  }
  const collisionIds = new Set(plan.collisions.map(({ artifactId }) => artifactId))
  for (const artifactId of Object.keys(options.collisionDecisions ?? {})) {
    if (!collisionIds.has(artifactId)) {
      throw new WorkspaceImportError(
        'invalid-input',
        `Collision decision "${artifactId}" is not part of this import plan.`
      )
    }
  }

  const decisions: Record<string, WorkspaceImportCollisionDecision> = {}
  const artifactsById = new Map(plan.artifacts.map((artifact) => [artifact.id, artifact]))
  const occupied = new Set(plan.artifacts.map(({ destinationPath }) => pathKey(destinationPath)))
  for (const collision of plan.collisions) {
    const decision = normalizedDecision(
      collision,
      options.collisionDecisions?.[collision.artifactId]
    )
    if (decision.action === 'keep-both') {
      if (!plan.workspaceMultipleFiles) {
        throw new WorkspaceImportError(
          'unresolved-collision',
          'The selected workspace adapter cannot create a keep-both import file.'
        )
      }
      const artifact = artifactsById.get(collision.artifactId)
      if (artifact && artifact.replacesProcessIds.length > 0) {
        throw new WorkspaceImportError(
          'unresolved-collision',
          `Reviewed artifact "${artifact.id}" owns existing process identities at "${collision.path}" and cannot use keep-both.`
        )
      }
      const key = pathKey(decision.destinationPath ?? collision.suggestedKeepBothPath)
      if (occupied.has(key)) {
        throw new WorkspaceImportError(
          'unresolved-collision',
          `Reviewed keep-both destination "${decision.destinationPath}" is already occupied by the plan.`
        )
      }
      occupied.add(key)
    }
    decisions[collision.artifactId] = decision
  }
  return Object.freeze({
    plan,
    planId: plan.id,
    reviewedDigest: plan.reviewDigest,
    collisionDecisions: Object.freeze(decisions)
  })
}

async function verifyConfirmedPlan(confirmed: ConfirmedWorkspaceImport): Promise<void> {
  const { plan } = confirmed
  if (
    confirmed.planId !== plan.id ||
    confirmed.reviewedDigest !== plan.reviewDigest ||
    (await digestReview(plan)) !== plan.reviewDigest
  ) {
    throw new WorkspaceImportError(
      'plan-tampered',
      'The confirmed import plan changed after review.'
    )
  }
  if (
    !equalHash(
      await digestProcessIdentitySnapshot(plan.processIdentitySnapshot),
      plan.processIdentityDigest
    )
  ) {
    throw new WorkspaceImportError(
      'plan-tampered',
      'The reviewed workspace process identity snapshot changed after review.'
    )
  }
  for (const artifact of plan.artifacts) {
    if (
      (await sha256Hex(artifact.bytes)) !== artifact.sha256 ||
      encoder.encode(artifact.xml).byteLength !== artifact.bytes.byteLength
    ) {
      throw new WorkspaceImportError(
        'plan-tampered',
        `Prepared artifact "${artifact.id}" changed after review.`
      )
    }
    const xmlBytes = encoder.encode(artifact.xml)
    if (!equalHash(await sha256Hex(xmlBytes), artifact.sha256)) {
      throw new WorkspaceImportError(
        'plan-tampered',
        `Prepared artifact XML "${artifact.id}" no longer matches its reviewed bytes.`
      )
    }
    if (
      !equalHash(artifact.sha256, artifact.localizationEvidence.outputDigest) ||
      artifact.localizationReviewDigest !== artifact.localizationEvidence.reviewDigest
    ) {
      throw new WorkspaceImportError(
        'plan-tampered',
        `Prepared artifact localization evidence "${artifact.id}" changed after review.`
      )
    }
  }
  for (const collision of plan.collisions) {
    if (
      !equalHash(await sha256Hex(collision.existing.bytes), collision.existingHash) ||
      !equalHash(collision.existing.hash, collision.existingHash)
    ) {
      throw new WorkspaceImportError(
        'plan-tampered',
        `Collision snapshot "${collision.path}" changed after review.`
      )
    }
  }
}

function parentDirectories(paths: readonly string[]): string[] {
  const directories = new Set<string>()
  for (const path of paths) {
    let parent = workspaceParentPath(path)
    while (parent) {
      directories.add(parent)
      parent = workspaceParentPath(parent)
    }
  }
  return [...directories].sort(
    (left, right) =>
      left.split('/').length - right.split('/').length || left.localeCompare(right, 'en')
  )
}

function backupManifestFor(
  plan: WorkspaceImportPlan,
  directories: readonly string[]
): WorkspaceBackupManifest {
  return {
    format: 'orbitpm-workspace-backup',
    version: 1,
    generatedAt: plan.createdAt,
    workspace: {
      id: plan.workspaceId,
      mode: plan.workspaceMode
    },
    checksumAlgorithm: 'SHA-256',
    directories: [...directories],
    files: plan.artifacts.map((artifact) => ({
      path: artifact.destinationPath,
      archivePath: `content/${artifact.destinationPath}`,
      size: artifact.bytes.byteLength,
      sha256: artifact.sha256,
      modifiedAt: 0,
      mimeType: 'application/xml'
    }))
  }
}

async function backupPlanFor(plan: WorkspaceImportPlan): Promise<WorkspaceBackupImportPlan> {
  const directories = parentDirectories(
    plan.artifacts.map(({ destinationPath }) => destinationPath)
  )
  const collisions: WorkspaceBackupCollision[] = plan.collisions.map((collision) => ({
    path: collision.path,
    incomingHash: collision.incomingHash,
    existing: {
      ...collision.existing,
      bytes: copyBytes(collision.existing.bytes)
    },
    identical: collision.identical
  }))
  return sealWorkspaceBackupImportPlan(
    {
    manifest: backupManifestFor(plan, directories),
    directories,
    files: plan.artifacts.map((artifact) => ({
      path: artifact.destinationPath,
      bytes: copyBytes(artifact.bytes),
      archiveSha256: artifact.sha256,
      sha256: artifact.sha256,
      mimeType: 'application/xml',
      reviewedBpmn: {
        reviewDigest: artifact.localizationReviewDigest,
        outputDigest: artifact.sha256,
        processIds: artifact.processIds,
        replacesProcessIds: artifact.replacesProcessIds,
        evidence: artifact.localizationEvidence
      }
    })),
    collisions,
    compressedBytes: 0,
    declaredUncompressedBytes: plan.artifacts.reduce(
      (total, artifact) => total + artifact.bytes.byteLength,
      0
    ),
    workspaceId: plan.workspaceId,
    workspaceMultipleFiles: plan.workspaceMultipleFiles,
    processIdentitySnapshot: plan.processIdentitySnapshot,
    processIdentityDigest: plan.processIdentityDigest
    },
    plan.reviewDigest
  )
}

function backupDecisionsFor(
  confirmed: ConfirmedWorkspaceImport
): Readonly<Record<string, WorkspaceBackupCollisionDecision>> {
  return Object.freeze(
    Object.fromEntries(
      confirmed.plan.collisions.map((collision) => {
        const decision = confirmed.collisionDecisions[collision.artifactId]
        if (!decision) {
          throw new WorkspaceImportError(
            'unresolved-collision',
            `Confirmed collision "${collision.artifactId}" has no decision.`
          )
        }
        return [
          collision.path,
          decision.action === 'keep-both'
            ? {
                action: 'keep-both' as const,
                destinationPath: decision.destinationPath ?? collision.suggestedKeepBothPath
              }
            : { action: decision.action }
        ]
      })
    )
  )
}

function executionEvidence(confirmed: ConfirmedWorkspaceImport): WorkspaceImportExecutionEvidence {
  return Object.freeze({
    reviewDigest: confirmed.reviewedDigest,
    summary: confirmed.plan.summary,
    collisions: confirmed.plan.collisions,
    collisionDecisions: confirmed.collisionDecisions,
    skipped: confirmed.plan.skipped,
    repairs: confirmed.plan.repairs,
    warnings: confirmed.plan.warnings,
    arisReports: confirmed.plan.arisReports
  })
}

export async function executeConfirmedWorkspaceImport(
  confirmed: ConfirmedWorkspaceImport,
  options: ExecuteConfirmedWorkspaceImportOptions
): Promise<WorkspaceImportExecutionOutcome> {
  throwIfAborted(options.signal)
  if (options.adapter.id !== confirmed.plan.workspaceId) {
    throw new WorkspaceImportError(
      'workspace-changed',
      'The active workspace changed after the import review.'
    )
  }
  await verifyConfirmedPlan(confirmed)
  throwIfAborted(options.signal)
  if (
    options.adapter.storage.capabilities.multipleFiles !==
      confirmed.plan.workspaceMultipleFiles ||
    (!options.adapter.storage.capabilities.multipleFiles &&
      confirmed.plan.artifacts.length > 1)
  ) {
    throw new WorkspaceImportError(
      'workspace-changed',
      'Workspace multi-file capabilities changed after the import review.'
    )
  }
  if (options.currentProcessIndex !== undefined || options.currentProcessIds !== undefined) {
    const suppliedIdentityDigest = await digestProcessIdentitySnapshot(
      normalizeProcessIdentitySnapshot(
        options.currentProcessIndex,
        options.currentProcessIds
      )
    )
    if (!equalHash(suppliedIdentityDigest, confirmed.plan.processIdentityDigest)) {
      throw new WorkspaceImportError(
        'workspace-changed',
        'The supplied workspace process identities changed after the import review.'
      )
    }
  }
  const currentIdentityDigest = await digestProcessIdentitySnapshot(
    await scanWorkspaceProcessIdentities(options.adapter, {
      inspector: options.processIdentityInspector,
      signal: options.signal
    })
  )
  if (!equalHash(currentIdentityDigest, confirmed.plan.processIdentityDigest)) {
    throw new WorkspaceImportError(
      'workspace-changed',
      'Workspace process identities changed after the import review.'
    )
  }
  throwIfAborted(options.signal)
  const replaces = confirmed.plan.collisions.filter(
    (collision) => confirmed.collisionDecisions[collision.artifactId]?.action === 'replace'
  )
  if (replaces.length > 0 && !options.history) {
    throw new WorkspaceImportError(
      'history-required',
      'Replacing imported files requires portable recovery history.'
    )
  }

  let historyRevisions = 0
  const apply = async (): Promise<WorkspaceBackupImportOutcome> =>
    applyWorkspaceBackupImport(options.adapter, await backupPlanFor(confirmed.plan), {
      decisions: backupDecisionsFor(confirmed),
      reviewedDigest: confirmed.reviewedDigest,
      currentProcessIndex: options.currentProcessIndex,
      currentProcessIds: options.currentProcessIds,
      processIdentityInspector: options.processIdentityInspector,
      signal: options.signal,
      beforeOverwrite: async (path, existing) => {
        if (!options.history) return
        await options.history.createRevision(path, {
          reason: 'backup-import',
          snapshot: existing,
          prune: false,
          signal: options.signal
        })
        historyRevisions += 1
      }
    })
  const outcome = options.runExclusive ? await options.runExclusive(apply) : await apply()
  if (outcome.status === 'needs-review') {
    throw new WorkspaceImportError(
      'unresolved-collision',
      'The confirmed import unexpectedly returned to collision review.'
    )
  }
  if (outcome.status === 'committed') {
    const postCommitWarnings: string[] = []
    if (historyRevisions > 0 && options.history?.enforceRetention) {
      try {
        await options.history.enforceRetention()
      } catch (error) {
        postCommitWarnings.push(
          `History retention could not be enforced after commit: ${
            error instanceof Error ? error.message : String(error)
          }`
        )
      }
    }
    return Object.freeze({
      status: 'committed',
      planId: confirmed.plan.id,
      applied: outcome.applied,
      skippedPaths: Object.freeze([...outcome.skipped]),
      historyRevisions,
      postCommitWarnings: Object.freeze(postCommitWarnings),
      arisReports: confirmed.plan.arisReports,
      evidence: executionEvidence(confirmed)
    })
  }
  return Object.freeze({
    status: outcome.status,
    planId: confirmed.plan.id,
    appliedBeforeFailure: outcome.appliedBeforeFailure,
    skippedPaths: Object.freeze([...outcome.skipped]),
    historyRevisions,
    error: outcome.error,
    rollbackErrors: outcome.rollbackErrors,
    arisReports: confirmed.plan.arisReports,
    evidence: executionEvidence(confirmed)
  })
}
