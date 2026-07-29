/**
 * Imported-source transaction (plan §7.3) and generated-process packages (§7.5).
 *
 * The transaction is strictly two-phase:
 *
 *   plan  — every destination write is produced in memory, the workspace is
 *           only read, and a review payload plus a review digest is returned;
 *   commit— the reviewer echoes the digest, the plan is re-verified against the
 *           live workspace, and every member is created with a creation-only
 *           compare-and-set write.
 *
 * Any failure during commit rolls back every member the transaction created —
 * files first (conditional delete on the exact hash it wrote), then the
 * directories it created (empty-only removal) — so a failed import leaves zero
 * artifacts behind. Directories are always created explicitly before the first
 * file write so that an adapter's implicit parent creation can never leave an
 * unrecorded directory behind.
 *
 * The imported original is never re-encoded, re-serialized, or normalized: the
 * exact bytes handed to `planArisImportedPackage` are the exact bytes written.
 */

import { copyBytes, equalHash, sha256Hex } from '../../workspace/adapters/hash'
import type { WorkspaceAdapter } from '../../workspace/adapters/types'
import {
  arisAccountingDigest,
  serializeArisAccounting,
  validateArisAccountingDocument,
  type ArisAccountingDocumentV2
} from './accounting'
import { canonicalJsonBytes } from './canonicalJson'
import {
  arisAttachmentDirectory,
  arisAttachmentPath,
  arisGenerationSourcePath,
  arisPackageDirectories,
  arisPackagePaths,
  arisReferencePath,
  arisRevisionPath,
  normalizeArisSourceDigest,
  sanitizeArisMemberName
} from './layout'
import {
  createArisManifest,
  parseArisManifest,
  serializeArisManifest,
  type ArisAttachmentManifestEntry,
  type ArisFidelityIssue,
  type ArisGeneratedOriginKind,
  type ArisModelManifestEntry,
  type ArisPackageOrigin,
  type ArisReferenceManifestEntry,
  type ArisSourcePackageManifestV1
} from './manifest'
import {
  ARIS_BASELINE_COMMAND_TYPE,
  createArisBaselineRevision,
  createArisCurrentRevision,
  serializeArisCurrentRevision,
  serializeArisRevision,
  type ArisRevisionCommand,
  type ArisRevisionPatchV1
} from './revisions'
import { summarizeArisFidelity } from './accounting'
import { writeArisPackageMembersAtomically } from './atomicWrite'
import { ArisPackageError, ArisPackageStore, assertArisPackageWorkspace } from './store'

/**
 * Narrow, local view of an imported AML document. It is deliberately decoupled
 * from `src/aris/source` so the lossless-input layer can evolve independently:
 * only these five fields plus an opaque analysis handle are consumed.
 */
export interface ImportedAmlInput {
  /** Exact imported bytes. Never re-encoded. */
  readonly bytes: Uint8Array
  readonly name: string
  readonly mediaType: string
  /** SHA-256 of `bytes`, recomputed and cross-checked while planning. */
  readonly sha256: string
  readonly encoding: string
  readonly arisVersion?: string
}

/**
 * Evidence that the worker parse (§7.3 step 3) and semantic index (step 4) ran.
 * The index is opaque here; planning only requires that it exists.
 */
export interface ArisSourceAnalysis {
  readonly index: unknown
  readonly diagnostics?: readonly unknown[]
}

export interface ArisPendingAttachment {
  readonly attachmentId: string
  readonly sourceId: string
  readonly name: string
  readonly mediaType: string
  readonly bytes: Uint8Array
}

export interface ArisPendingReference {
  readonly name: string
  readonly mediaType: string
  readonly bytes: Uint8Array
}

export interface ArisPackageLimits {
  readonly maxSourceBytes?: number
  readonly maxAttachments?: number
  readonly maxAttachmentBytes?: number
  readonly maxTotalBytes?: number
  readonly maxModels?: number
}

export const DEFAULT_ARIS_PACKAGE_LIMITS = Object.freeze({
  maxSourceBytes: 256 * 1024 * 1024,
  maxAttachments: 10_000,
  maxAttachmentBytes: 64 * 1024 * 1024,
  maxTotalBytes: 512 * 1024 * 1024,
  maxModels: 50_000
})

export type ArisPlannedWriteRole =
  | 'original'
  | 'generation-source'
  | 'attachment'
  | 'reference'
  | 'accounting'
  | 'revision'
  | 'current-revision'
  | 'manifest'

export interface ArisPlannedWrite {
  readonly path: string
  readonly role: ArisPlannedWriteRole
  readonly byteLength: number
  readonly sha256: string
  /** Staged bytes. Excluded from the review payload and the review digest. */
  readonly bytes: Uint8Array
}

export interface ArisPlannedWriteSummary {
  readonly path: string
  readonly role: ArisPlannedWriteRole
  readonly byteLength: number
  readonly sha256: string
}

/** Everything the import-review UI must display before a commit is allowed. */
export interface ArisPackageReview {
  readonly sourceName: string
  readonly sourceSha256: string
  readonly sourceByteLength: number
  readonly sourceMediaType: string
  readonly origin: ArisPackageOrigin
  readonly duplicate: boolean
  readonly counts: {
    readonly models: number
    readonly attachments: number
    readonly references: number
    readonly writes: number
    readonly totalBytes: number
  }
  readonly fidelity: ArisSourcePackageManifestV1['fidelity']
  readonly diagnostics: number
  readonly directories: readonly string[]
  readonly writes: readonly ArisPlannedWriteSummary[]
}

export interface ArisSourcePackagePlan {
  readonly version: 1
  readonly workspaceId: string
  readonly sourceSha256: string
  readonly root: string
  readonly status: 'ready' | 'duplicate'
  readonly manifest: ArisSourcePackageManifestV1
  readonly accounting: ArisAccountingDocumentV2
  readonly baseline: ArisRevisionPatchV1
  readonly directories: readonly string[]
  readonly writes: readonly ArisPlannedWrite[]
  /** Present when an identical source digest is already stored (§7.3 step 11). */
  readonly existingManifest?: ArisSourcePackageManifestV1
  readonly review: ArisPackageReview
  readonly reviewDigest: string
}

export type ArisTransactionErrorCode =
  | 'invalid-input'
  | 'limit-exceeded'
  | 'cancelled'
  | 'analysis-required'
  | 'digest-mismatch'
  | 'review-mismatch'
  | 'plan-tampered'
  | 'workspace-changed'

export class ArisTransactionError extends Error {
  readonly code: ArisTransactionErrorCode

  constructor(code: ArisTransactionErrorCode, message: string) {
    super(message)
    this.name = 'ArisTransactionError'
    this.code = code
  }
}

export interface ArisCommitFailure {
  readonly message: string
  readonly path?: string
}

export type ArisPackageCommitOutcome =
  | {
      readonly status: 'committed'
      readonly sourceSha256: string
      readonly root: string
      readonly manifest: ArisSourcePackageManifestV1
      readonly writtenPaths: readonly string[]
    }
  | {
      readonly status: 'deduplicated'
      readonly sourceSha256: string
      readonly root: string
      readonly manifest: ArisSourcePackageManifestV1
    }
  | {
      readonly status: 'rolled-back' | 'rollback-failed'
      readonly sourceSha256: string
      readonly root: string
      readonly error: ArisCommitFailure
      readonly rollbackErrors: readonly ArisCommitFailure[]
    }

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new ArisTransactionError(
      'cancelled',
      'The ARIS source-package transaction was cancelled.'
    )
  }
}

function resolvedLimits(input: ArisPackageLimits = {}): Required<ArisPackageLimits> {
  const limits = { ...DEFAULT_ARIS_PACKAGE_LIMITS, ...input }
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new ArisTransactionError(
        'invalid-input',
        `ARIS package limit "${name}" must be a positive safe integer.`
      )
    }
  }
  return limits
}

interface StagedAttachment {
  readonly entry: ArisAttachmentManifestEntry
  readonly path: string
  readonly bytes: Uint8Array
  readonly directory: string
}

async function stageAttachments(
  digest: string,
  attachments: readonly ArisPendingAttachment[],
  limits: Required<ArisPackageLimits>,
  signal: AbortSignal | undefined
): Promise<readonly StagedAttachment[]> {
  if (attachments.length > limits.maxAttachments) {
    throw new ArisTransactionError(
      'limit-exceeded',
      `The source declares ${attachments.length} attachments; the limit is ${limits.maxAttachments}.`
    )
  }
  const claimed = new Set<string>()
  const staged: StagedAttachment[] = []
  for (const attachment of attachments) {
    throwIfAborted(signal)
    if (attachment.bytes.byteLength > limits.maxAttachmentBytes) {
      throw new ArisTransactionError(
        'limit-exceeded',
        `Attachment "${attachment.attachmentId}" exceeds the per-attachment byte limit.`
      )
    }
    const sourceId = sanitizeArisMemberName(attachment.sourceId)
    // Sanitized names can collide; disambiguate deterministically instead of
    // letting a second attachment overwrite the first.
    const safeName = sanitizeArisMemberName(attachment.name)
    let name = safeName
    let suffix = 1
    while (claimed.has(`${sourceId}/${name.toLowerCase()}`)) {
      suffix += 1
      const dot = safeName.lastIndexOf('.')
      const stem = dot > 0 ? safeName.slice(0, dot) : safeName
      const extension = dot > 0 ? safeName.slice(dot) : ''
      name = sanitizeArisMemberName(`${stem}-${suffix}${extension}`)
    }
    claimed.add(`${sourceId}/${name.toLowerCase()}`)
    const bytes = copyBytes(attachment.bytes)
    const path = arisAttachmentPath(digest, sourceId, name)
    staged.push({
      entry: Object.freeze({
        attachmentId: attachment.attachmentId,
        sourceId: attachment.sourceId,
        name,
        mediaType: attachment.mediaType,
        byteLength: bytes.byteLength,
        sha256: await sha256Hex(bytes),
        path: relativeTo(digest, path)
      }),
      path,
      bytes,
      directory: arisAttachmentDirectory(digest, sourceId)
    })
  }
  return Object.freeze(staged)
}

interface StagedReference {
  readonly entry: ArisReferenceManifestEntry
  readonly path: string
  readonly bytes: Uint8Array
}

async function stageReferences(
  digest: string,
  references: readonly ArisPendingReference[],
  limits: Required<ArisPackageLimits>,
  signal: AbortSignal | undefined
): Promise<readonly StagedReference[]> {
  const claimed = new Set<string>()
  const staged: StagedReference[] = []
  for (const reference of references) {
    throwIfAborted(signal)
    if (reference.bytes.byteLength > limits.maxAttachmentBytes) {
      throw new ArisTransactionError(
        'limit-exceeded',
        `Reference asset "${reference.name}" exceeds the per-asset byte limit.`
      )
    }
    const safeName = sanitizeArisMemberName(reference.name)
    let name = safeName
    let suffix = 1
    while (claimed.has(name.toLowerCase())) {
      suffix += 1
      const dot = safeName.lastIndexOf('.')
      const stem = dot > 0 ? safeName.slice(0, dot) : safeName
      const extension = dot > 0 ? safeName.slice(dot) : ''
      name = sanitizeArisMemberName(`${stem}-${suffix}${extension}`)
    }
    claimed.add(name.toLowerCase())
    const bytes = copyBytes(reference.bytes)
    const path = arisReferencePath(digest, name)
    staged.push({
      entry: Object.freeze({
        name,
        mediaType: reference.mediaType,
        byteLength: bytes.byteLength,
        sha256: await sha256Hex(bytes),
        path: relativeTo(digest, path)
      }),
      path,
      bytes
    })
  }
  return Object.freeze(staged)
}

function relativeTo(digest: string, path: string): string {
  const root = `${arisPackagePaths(digest).root}/`
  return path.startsWith(root) ? path.slice(root.length) : path
}

async function plannedWrite(
  role: ArisPlannedWriteRole,
  path: string,
  bytes: Uint8Array
): Promise<ArisPlannedWrite> {
  const owned = copyBytes(bytes)
  return Object.freeze({
    role,
    path,
    bytes: owned,
    byteLength: owned.byteLength,
    sha256: await sha256Hex(owned)
  })
}

function reviewPayload(plan: Omit<ArisSourcePackagePlan, 'reviewDigest'>): unknown {
  return {
    version: plan.version,
    workspaceId: plan.workspaceId,
    sourceSha256: plan.sourceSha256,
    root: plan.root,
    status: plan.status,
    manifest: JSON.parse(new TextDecoder().decode(serializeArisManifest(plan.manifest))) as unknown,
    accountingSha256: plan.manifest.accountingSha256,
    baselineRevisionId: plan.baseline.revisionId,
    directories: plan.directories,
    writes: plan.writes.map((write) => ({
      path: write.path,
      role: write.role,
      byteLength: write.byteLength,
      sha256: write.sha256
    }))
  }
}

function buildReview(
  plan: Omit<ArisSourcePackagePlan, 'reviewDigest' | 'review'>,
  diagnostics: number
): ArisPackageReview {
  return Object.freeze({
    sourceName: plan.manifest.source.name,
    sourceSha256: plan.sourceSha256,
    sourceByteLength: plan.manifest.source.byteLength,
    sourceMediaType: plan.manifest.source.mediaType,
    origin: plan.manifest.origin,
    duplicate: plan.status === 'duplicate',
    counts: Object.freeze({
      models: plan.manifest.models.length,
      attachments: plan.manifest.attachments.length,
      references: plan.manifest.references.length,
      writes: plan.writes.length,
      totalBytes: plan.writes.reduce((total, write) => total + write.byteLength, 0)
    }),
    fidelity: plan.manifest.fidelity,
    diagnostics,
    directories: plan.directories,
    writes: Object.freeze(
      plan.writes.map((write) =>
        Object.freeze({
          path: write.path,
          role: write.role,
          byteLength: write.byteLength,
          sha256: write.sha256
        })
      )
    )
  })
}

export function arisPackageReviewDigest(
  plan: Omit<ArisSourcePackagePlan, 'reviewDigest'>
): Promise<string> {
  return sha256Hex(canonicalJsonBytes(reviewPayload(plan)))
}

async function readExistingManifest(
  adapter: WorkspaceAdapter,
  digest: string
): Promise<ArisSourcePackageManifestV1 | undefined> {
  try {
    const snapshot = await adapter.read(arisPackagePaths(digest).manifest)
    return parseArisManifest(snapshot.bytes)
  } catch {
    return undefined
  }
}

interface BuildPlanInput {
  readonly adapter: WorkspaceAdapter
  readonly digest: string
  readonly origin: ArisPackageOrigin
  readonly source: {
    readonly name: string
    readonly mediaType: string
    readonly byteLength: number
    readonly sha256: string
    readonly arisVersion?: string
  }
  readonly originalWrite?: {
    readonly role: ArisPlannedWriteRole
    readonly path: string
    readonly bytes: Uint8Array
  }
  readonly accounting: ArisAccountingDocumentV2
  readonly models: readonly ArisModelManifestEntry[]
  readonly attachments: readonly ArisPendingAttachment[]
  readonly references: readonly ArisPendingReference[]
  readonly fidelityIssues: readonly ArisFidelityIssue[]
  readonly baselineCommands: readonly ArisRevisionCommand[]
  readonly diagnostics: number
  readonly limits: Required<ArisPackageLimits>
  readonly signal?: AbortSignal
}

async function buildPlan(input: BuildPlanInput): Promise<ArisSourcePackagePlan> {
  const { adapter, digest, limits, signal } = input
  assertArisPackageWorkspace(adapter)
  throwIfAborted(signal)

  if (input.models.length > limits.maxModels) {
    throw new ArisTransactionError(
      'limit-exceeded',
      `The source declares ${input.models.length} models; the limit is ${limits.maxModels}.`
    )
  }

  const paths = arisPackagePaths(digest)
  const accounting = validateArisAccountingDocument(input.accounting)
  if (!equalHash(accounting.sourceSha256, digest)) {
    throw new ArisTransactionError(
      'digest-mismatch',
      'The accounting document does not belong to this source digest.'
    )
  }

  const staged = await stageAttachments(digest, input.attachments, limits, signal)
  const stagedReferences = await stageReferences(digest, input.references, limits, signal)
  throwIfAborted(signal)

  const baseline = await createArisBaselineRevision(digest, input.baselineCommands)
  const current = createArisCurrentRevision(baseline)
  const manifest = createArisManifest({
    source: input.source,
    origin: input.origin,
    currentRevisionId: baseline.revisionId,
    models: input.models,
    attachments: staged.map((attachment) => attachment.entry),
    references: stagedReferences.map((reference) => reference.entry),
    accountingSha256: await arisAccountingDigest(accounting),
    fidelity: summarizeArisFidelity(accounting, input.fidelityIssues)
  })

  // Write order is deliberate. Content members land first and `manifest.json`
  // last, so a torn package can never be discovered as a valid one.
  const writes: ArisPlannedWrite[] = []
  if (input.originalWrite) {
    writes.push(
      await plannedWrite(
        input.originalWrite.role,
        input.originalWrite.path,
        input.originalWrite.bytes
      )
    )
  }
  for (const attachment of staged) {
    writes.push(await plannedWrite('attachment', attachment.path, attachment.bytes))
  }
  for (const reference of stagedReferences) {
    writes.push(await plannedWrite('reference', reference.path, reference.bytes))
  }
  writes.push(
    await plannedWrite('accounting', paths.accounting, serializeArisAccounting(accounting))
  )
  writes.push(
    await plannedWrite(
      'revision',
      arisRevisionPath(digest, baseline.revisionId),
      serializeArisRevision(baseline)
    )
  )
  writes.push(
    await plannedWrite(
      'current-revision',
      paths.currentRevision,
      serializeArisCurrentRevision(current)
    )
  )
  writes.push(await plannedWrite('manifest', paths.manifest, serializeArisManifest(manifest)))

  const totalBytes = writes.reduce((total, write) => total + write.byteLength, 0)
  if (totalBytes > limits.maxTotalBytes) {
    throw new ArisTransactionError(
      'limit-exceeded',
      `The staged package is ${totalBytes} bytes; the limit is ${limits.maxTotalBytes}.`
    )
  }

  const directories = [
    ...arisPackageDirectories(digest),
    ...(staged.length > 0 ? [paths.attachmentsDirectory] : []),
    ...staged.map((attachment) => attachment.directory),
    ...(stagedReferences.length > 0 ? [paths.referencesDirectory] : [])
  ]
  const uniqueDirectories = Object.freeze([...new Set(directories)])

  const existingManifest = await readExistingManifest(adapter, digest)
  const duplicate =
    existingManifest !== undefined && equalHash(existingManifest.source.sha256, digest)

  const draft: Omit<ArisSourcePackagePlan, 'reviewDigest' | 'review'> = {
    version: 1,
    workspaceId: adapter.id,
    sourceSha256: digest,
    root: paths.root,
    status: duplicate ? 'duplicate' : 'ready',
    manifest,
    accounting,
    baseline,
    directories: uniqueDirectories,
    writes: Object.freeze(duplicate ? [] : writes),
    ...(existingManifest ? { existingManifest } : {})
  }
  const review = buildReview(draft, input.diagnostics)
  const withReview = { ...draft, review }
  return Object.freeze({ ...withReview, reviewDigest: await arisPackageReviewDigest(withReview) })
}

export interface PlanArisImportedPackageOptions {
  readonly adapter: WorkspaceAdapter
  readonly source: ImportedAmlInput
  /** Proof that the worker parse and semantic index completed (steps 3-4). */
  readonly analysis: ArisSourceAnalysis
  readonly accounting: ArisAccountingDocumentV2
  readonly models?: readonly ArisModelManifestEntry[]
  readonly attachments?: readonly ArisPendingAttachment[]
  readonly references?: readonly ArisPendingReference[]
  readonly fidelityIssues?: readonly ArisFidelityIssue[]
  readonly baselineCommands?: readonly ArisRevisionCommand[]
  readonly limits?: ArisPackageLimits
  readonly signal?: AbortSignal
}

/** §7.3 steps 1-8: read bytes, verify digest, require analysis, stage, review. */
export async function planArisImportedPackage(
  options: PlanArisImportedPackageOptions
): Promise<ArisSourcePackagePlan> {
  const limits = resolvedLimits(options.limits)
  const source = options.source
  if (!(source?.bytes instanceof Uint8Array) || source.bytes.byteLength === 0) {
    throw new ArisTransactionError(
      'invalid-input',
      'An imported source must carry its exact bytes.'
    )
  }
  if (source.bytes.byteLength > limits.maxSourceBytes) {
    throw new ArisTransactionError('limit-exceeded', 'The imported source exceeds the byte limit.')
  }
  if (typeof source.encoding !== 'string' || source.encoding.trim().length === 0) {
    throw new ArisTransactionError(
      'analysis-required',
      'The imported source encoding must come from the tokenizer.'
    )
  }
  if (options.analysis?.index === null || typeof options.analysis?.index !== 'object') {
    throw new ArisTransactionError(
      'analysis-required',
      'An imported source can only be staged after a worker parse and semantic index.'
    )
  }
  const bytes = copyBytes(source.bytes)
  const recomputed = await sha256Hex(bytes)
  if (!equalHash(recomputed, source.sha256)) {
    throw new ArisTransactionError(
      'digest-mismatch',
      'The declared source digest does not match the imported bytes.'
    )
  }
  const digest = normalizeArisSourceDigest(recomputed)

  return buildPlan({
    adapter: options.adapter,
    digest,
    origin: { kind: 'imported-aml' },
    source: {
      name: source.name,
      mediaType: source.mediaType,
      byteLength: bytes.byteLength,
      sha256: digest,
      ...(source.arisVersion !== undefined ? { arisVersion: source.arisVersion } : {})
    },
    originalWrite: { role: 'original', path: arisPackagePaths(digest).originalSource, bytes },
    accounting: options.accounting,
    models: options.models ?? [],
    attachments: options.attachments ?? [],
    references: options.references ?? [],
    fidelityIssues: options.fidelityIssues ?? [],
    baselineCommands: options.baselineCommands ?? [],
    diagnostics: options.analysis?.diagnostics?.length ?? 0,
    limits,
    ...(options.signal ? { signal: options.signal } : {})
  })
}

export interface ArisGenerationRequestProvenance {
  readonly provider: string
  readonly model: string
  /** SHA-256 of the exact outbound request body. The key is never accepted. */
  readonly requestSha256: string
}

export interface ArisRetainedGenerationSource {
  readonly bytes: Uint8Array
  readonly name: string
  readonly mediaType: string
}

export interface PlanArisGeneratedPackageOptions {
  readonly adapter: WorkspaceAdapter
  readonly originKind: ArisGeneratedOriginKind
  /** Canonical AML produced for revision zero (§7.5.2/§7.5.5). */
  readonly baselineAml: { readonly text: string; readonly name: string }
  /** Retained description/workbook/PDF/image kept as an immutable artifact. */
  readonly generationSource?: ArisRetainedGenerationSource
  readonly generation?: ArisGenerationRequestProvenance
  readonly accounting: ArisAccountingDocumentV2
  readonly models?: readonly ArisModelManifestEntry[]
  readonly attachments?: readonly ArisPendingAttachment[]
  readonly references?: readonly ArisPendingReference[]
  readonly fidelityIssues?: readonly ArisFidelityIssue[]
  readonly limits?: ArisPackageLimits
  readonly signal?: AbortSignal
}

/**
 * §7.5: a package whose origin is a description, spreadsheet, PDF or image.
 * There is no imported AML original; the retained generation source becomes the
 * immutable artifact and revision zero carries the generated baseline AML.
 */
export async function planArisGeneratedPackage(
  options: PlanArisGeneratedPackageOptions
): Promise<ArisSourcePackagePlan> {
  const limits = resolvedLimits(options.limits)
  const amlText = options.baselineAml?.text
  if (typeof amlText !== 'string' || amlText.trim().length === 0) {
    throw new ArisTransactionError(
      'invalid-input',
      'A generated package requires canonical revision-zero AML.'
    )
  }
  const amlBytes = new TextEncoder().encode(amlText)
  const amlSha256 = await sha256Hex(amlBytes)

  const retained = options.generationSource
  if (retained && retained.bytes.byteLength > limits.maxSourceBytes) {
    throw new ArisTransactionError(
      'limit-exceeded',
      'The retained generation source exceeds the byte limit.'
    )
  }
  const retainedBytes = retained ? copyBytes(retained.bytes) : undefined
  const digest = normalizeArisSourceDigest(
    retainedBytes ? await sha256Hex(retainedBytes) : amlSha256
  )
  const retainedPath = retained ? arisGenerationSourcePath(digest, retained.name) : undefined

  const origin: ArisPackageOrigin = {
    kind: options.originKind,
    ...(options.generation
      ? {
          generation: {
            provider: options.generation.provider,
            model: options.generation.model,
            requestSha256: options.generation.requestSha256,
            retainedSourcePath: retainedPath ? relativeTo(digest, retainedPath) : null
          }
        }
      : {})
  }

  return buildPlan({
    adapter: options.adapter,
    digest,
    origin,
    source: {
      name: retained ? retained.name : options.baselineAml.name,
      mediaType: retained ? retained.mediaType : 'application/xml',
      byteLength: retainedBytes ? retainedBytes.byteLength : amlBytes.byteLength,
      sha256: digest
    },
    ...(retainedPath && retainedBytes
      ? {
          originalWrite: {
            role: 'generation-source' as const,
            path: retainedPath,
            bytes: retainedBytes
          }
        }
      : {}),
    accounting: options.accounting,
    models: options.models ?? [],
    attachments: options.attachments ?? [],
    references: options.references ?? [],
    fidelityIssues: options.fidelityIssues ?? [],
    baselineCommands: [
      {
        type: ARIS_BASELINE_COMMAND_TYPE,
        payload: {
          aml: amlText,
          sha256: amlSha256,
          originKind: options.originKind,
          retainedSource: retained ? relativeTo(digest, retainedPath ?? '') : null
        }
      }
    ],
    diagnostics: 0,
    limits,
    ...(options.signal ? { signal: options.signal } : {})
  })
}

export interface CommitArisSourcePackageOptions {
  readonly adapter: WorkspaceAdapter
  readonly plan: ArisSourcePackagePlan
  /** Must echo the exact digest shown to the reviewer (§7.3 step 8). */
  readonly reviewedDigest: string
  readonly signal?: AbortSignal
}

/**
 * §7.3 steps 9-11. Atomic commit with complete rollback, and a no-op for an
 * already-stored identical source digest.
 */
export async function commitArisSourcePackage(
  options: CommitArisSourcePackageOptions
): Promise<ArisPackageCommitOutcome> {
  const { adapter, plan } = options
  assertArisPackageWorkspace(adapter)
  throwIfAborted(options.signal)

  const recomputedDigest = await arisPackageReviewDigest(plan)
  if (!equalHash(recomputedDigest, plan.reviewDigest)) {
    throw new ArisTransactionError('plan-tampered', 'The reviewed plan was modified after review.')
  }
  if (!equalHash(options.reviewedDigest ?? '', plan.reviewDigest)) {
    throw new ArisTransactionError(
      'review-mismatch',
      'The commit must echo the exact digest of the reviewed plan.'
    )
  }
  if (adapter.id !== plan.workspaceId) {
    throw new ArisTransactionError(
      'workspace-changed',
      'The reviewed plan belongs to a different workspace.'
    )
  }

  // Step 11: re-check for an identical digest immediately before writing, so a
  // concurrent import cannot produce a second package for the same bytes.
  const existing = await readExistingManifest(adapter, plan.sourceSha256)
  if (existing && equalHash(existing.source.sha256, plan.sourceSha256)) {
    return Object.freeze({
      status: 'deduplicated',
      sourceSha256: plan.sourceSha256,
      root: plan.root,
      manifest: existing
    })
  }

  const store = new ArisPackageStore(adapter)
  // Directories are created explicitly and recorded first, so an adapter's
  // implicit parent creation during a write can never leave residue behind.
  const result = await writeArisPackageMembersAtomically(adapter, {
    directories: plan.directories,
    members: plan.writes.map((write) => ({
      path: write.path,
      bytes: write.bytes,
      sha256: write.sha256
    })),
    // Post-write verification: the original must read back byte-identical.
    verify: async () => {
      if (plan.manifest.origin.kind !== 'imported-aml') return
      const original = await store.readOriginalSource(plan.sourceSha256)
      if (!equalHash(original.hash, plan.sourceSha256)) {
        throw new ArisPackageError(
          'integrity-failure',
          'The stored original source does not match the imported bytes.',
          original.path
        )
      }
    },
    ...(options.signal ? { signal: options.signal } : {})
  })

  if (result.status !== 'committed') {
    return Object.freeze({
      status: result.status,
      sourceSha256: plan.sourceSha256,
      root: plan.root,
      error: result.error,
      rollbackErrors: result.rollbackErrors
    })
  }

  return Object.freeze({
    status: 'committed',
    sourceSha256: plan.sourceSha256,
    root: plan.root,
    manifest: plan.manifest,
    writtenPaths: result.writtenPaths
  })
}
