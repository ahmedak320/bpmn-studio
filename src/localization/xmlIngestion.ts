import BpmnModdle from 'bpmn-moddle'

import { ORG_ATTR_NAMES, orbitpmModdleDescriptor } from '../org/orbitpmModdle'
import {
  evaluateValidationPolicy,
  validateBpmnXml,
  validateUnknownExtensionPreservation,
  type BpmnValidationOptions,
  type ValidationAction,
  type ValidationSummary
} from '../validation'
import {
  auditLocalizationFields,
  type LocalizationAuditOptions,
  type LocalizationFieldException
} from './audit'
import { extractBpmnLocalization, type ModdleElementLike } from './extract'
import { approvedNeutralTerms } from './glossary'
import {
  prepareLocalizationIngestion,
  type LocalizationIngestionOptions,
  type LocalizationIngestionReview
} from './ingestion'
import { buildTranslationQueue, planLanguageProjection } from './plan'
import {
  type LanguageCode,
  type LocalizationAuditReport,
  type LocalizationField,
  type LocalizationPatch,
  type LocalizationResources,
  type LocalizationSource,
  type TranslationQueueItem
} from './types'

const encoder = new TextEncoder()
const REGISTERED_ORBITPM_ATTRIBUTES = new Set<string>(ORG_ATTR_NAMES)

interface MutableModdleElement extends ModdleElementLike {
  $attrs?: Record<string, unknown>
  $parent?: unknown
  [key: string]: unknown
}

interface SerializableBpmnModdle {
  toXML(
    root: MutableModdleElement,
    options: { format: boolean; preamble: boolean }
  ): Promise<{ xml?: string }>
}

export type ReviewedXmlIngestionErrorCode =
  | 'invalid-input'
  | 'stale'
  | 'review-tampered'
  | 'review-invalid'
  | 'review-incomplete'
  | 'serialization-failed'
  | 'preservation-failed'
  | 'postcondition-failed'

export class ReviewedXmlIngestionError extends Error {
  readonly code: ReviewedXmlIngestionErrorCode
  readonly validation?: ValidationSummary

  constructor(
    code: ReviewedXmlIngestionErrorCode,
    message: string,
    validation?: ValidationSummary
  ) {
    super(message)
    this.name = 'ReviewedXmlIngestionError'
    this.code = code
    this.validation = validation
  }
}

export interface ReviewedLocalizationEdit {
  readonly processId: string
  readonly elementId: string
  readonly field: string
  readonly target: LanguageCode
  /**
   * Exact virtual value shown in the review after accepted local glossary/TM
   * matches. `null` means that side was absent.
   */
  readonly expectedValue: string | null
  readonly value: string
}

export interface ReviewedLocalizationApproval {
  readonly processId: string
  readonly elementId: string
  readonly field: string
  readonly target: LanguageCode
  readonly value: string
  readonly kind: 'neutral' | 'english-bilingual'
}

export interface ReviewedXmlIngestionReviewRequest {
  readonly version: 1
  readonly source: LocalizationSource
  readonly target: LanguageCode
  readonly originalXml: string
  readonly originalDigest: string
  readonly reviewDigest: string
  readonly knownProcessIds: readonly string[]
  readonly resources: LocalizationResources
  readonly validation: ValidationSummary
  readonly ingestion: LocalizationIngestionReview
  /** All actionable directions, not only the selected visible target. */
  readonly queue: readonly TranslationQueueItem[]
}

export type ReviewedXmlIngestionReviewResult =
  | {
      readonly status: 'cancelled'
    }
  | {
      readonly status: 'completed'
      readonly reviewDigest: string
      readonly edits: readonly ReviewedLocalizationEdit[]
      readonly approvals?: readonly ReviewedLocalizationApproval[]
    }

export type ReviewedXmlIngestionReviewer = (
  request: ReviewedXmlIngestionReviewRequest,
  context: { readonly signal?: AbortSignal }
) => Promise<ReviewedXmlIngestionReviewResult>

export interface ReviewBpmnXmlLocalizationOptions extends Omit<
  LocalizationIngestionOptions,
  'source' | 'target' | 'glossary' | 'translationMemory'
> {
  readonly source: LocalizationSource
  readonly target: LanguageCode
  /** Exact workspace snapshot used for the whole review and post-audit. */
  readonly resources: LocalizationResources
  readonly validation?: Omit<BpmnValidationOptions, 'requireBilingual'>
  readonly validationAction?: ValidationAction
  readonly review?: ReviewedXmlIngestionReviewer
  readonly signal?: AbortSignal
  /**
   * Generation/session guard supplied by the caller. It is checked around
   * every asynchronous boundary; false means no result may be committed.
   */
  readonly isCurrent?: () => boolean | Promise<boolean>
}

export interface ReviewedXmlIngestionEvidence {
  readonly version: 1
  readonly source: LocalizationSource
  readonly target: LanguageCode
  readonly reviewMode: 'automatic-complete' | 'explicit'
  readonly originalDigest: string
  readonly requestDigest: string
  readonly reviewDigest: string
  readonly outputDigest: string
  readonly inputValidation: ValidationSummary
  readonly outputValidation: ValidationSummary
  readonly initialAudit: LocalizationAuditReport
  readonly localAudit: LocalizationAuditReport
  readonly finalAudit: LocalizationAuditReport
  readonly reviewedEdits: readonly ReviewedLocalizationEdit[]
  readonly reviewedApprovals: readonly ReviewedLocalizationApproval[]
  readonly appliedPatches: {
    readonly local: number
    readonly reviewed: number
    readonly projection: number
    readonly activeLanguage: number
    readonly changed: number
  }
  readonly processIds: readonly string[]
  readonly planeIds: readonly string[]
  readonly unknownExtensionsPreserved: true
  readonly visibleTargetVerified: true
}

export type ReviewedXmlIngestionOutcome =
  | {
      readonly status: 'review-required'
      readonly request: ReviewedXmlIngestionReviewRequest
    }
  | {
      readonly status: 'cancelled'
      readonly request: ReviewedXmlIngestionReviewRequest
    }
  | {
      readonly status: 'completed'
      readonly xml: string
      readonly digest: string
      readonly reviewDigest: string
      readonly reviewMode: 'automatic-complete' | 'explicit'
      readonly request: ReviewedXmlIngestionReviewRequest
      readonly evidence: ReviewedXmlIngestionEvidence
    }

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || typeof value !== 'object') return value
  const object = value as object
  if (seen.has(object)) return value
  seen.add(object)
  for (const nested of Object.values(object)) deepFreeze(nested, seen)
  return Object.freeze(value)
}

function copyResources(resources: LocalizationResources): LocalizationResources {
  return deepFreeze({
    glossary: resources.glossary.map((entry) => ({ ...entry })),
    translationMemory: resources.translationMemory.map((entry) => ({ ...entry }))
  })
}

function copyEdits(
  edits: readonly ReviewedLocalizationEdit[]
): readonly ReviewedLocalizationEdit[] {
  return deepFreeze(edits.map((edit) => ({ ...edit })))
}

function copyApprovals(
  approvals: readonly ReviewedLocalizationApproval[]
): readonly ReviewedLocalizationApproval[] {
  return deepFreeze(approvals.map((approval) => ({ ...approval })))
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  if (signal.reason !== undefined) throw signal.reason
  throw new DOMException('Operation was aborted.', 'AbortError')
}

async function assertCurrent(options: ReviewBpmnXmlLocalizationOptions): Promise<void> {
  throwIfAborted(options.signal)
  if (options.isCurrent && !(await options.isCurrent())) {
    throw new ReviewedXmlIngestionError(
      'stale',
      'The BPMN source changed while its localization review was in progress.'
    )
  }
  throwIfAborted(options.signal)
}

async function sha256Text(value: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) {
    throw new Error('SHA-256 is unavailable because Web Crypto is not supported.')
  }
  const digest = await subtle.digest('SHA-256', encoder.encode(value))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function stableIds(values: Iterable<string> | undefined): readonly string[] {
  return Object.freeze(
    [...new Set([...(values ?? [])].map((value) => value.trim()).filter(Boolean))].sort((a, b) =>
      a.localeCompare(b, 'en')
    )
  )
}

function stableAuditOptions(
  options: ReviewBpmnXmlLocalizationOptions,
  resources: LocalizationResources
): LocalizationAuditOptions {
  return {
    glossary: resources.glossary,
    approvedNeutralTerms:
      options.approvedNeutralTerms === undefined ? undefined : [...options.approvedNeutralTerms],
    approvedEnglishBilingualExceptions:
      options.approvedEnglishBilingualExceptions === undefined
        ? undefined
        : [...options.approvedEnglishBilingualExceptions],
    approvedFieldExceptions:
      options.approvedFieldExceptions === undefined
        ? undefined
        : options.approvedFieldExceptions.map((approval) => ({ ...approval })),
    providerFailures: options.providerFailures
  }
}

function stableLocalizationOptions(
  options: ReviewBpmnXmlLocalizationOptions,
  resources: LocalizationResources
): LocalizationIngestionOptions {
  return {
    source: options.source,
    target: options.target,
    glossary: resources.glossary,
    translationMemory: resources.translationMemory,
    defaultActive: options.defaultActive,
    targetLanguages: options.targetLanguages,
    ...stableAuditOptions(options, resources)
  }
}

function validationFingerprint(summary: ValidationSummary): unknown {
  return {
    valid: summary.valid,
    xmlWellFormed: summary.xmlWellFormed,
    stats: summary.stats,
    issues: summary.issues.map((issue) => [
      issue.code,
      issue.source,
      issue.severity,
      issue.blocking,
      issue.processId ?? null,
      issue.elementId ?? null,
      issue.diagramId ?? null,
      issue.planeId ?? null
    ])
  }
}

function fieldFingerprint(field: LocalizationField): unknown {
  return [
    field.source,
    field.processId,
    field.elementId,
    field.elementType,
    field.field,
    field.kind,
    field.value.active,
    field.value.en ?? null,
    field.value.ar ?? null,
    field.projection ?? null,
    field.sourceLanguage ?? null,
    field.storage.enProperty,
    field.storage.arProperty,
    field.storage.projectionProperty,
    [...field.planeIds]
  ]
}

function issueFingerprint(report: LocalizationAuditReport): unknown {
  return report.issues.map((issue) => [
    issue.source,
    issue.processId,
    issue.elementId,
    issue.field,
    issue.target,
    issue.code,
    issue.originalValue ?? null
  ])
}

function patchFingerprint(patch: LocalizationPatch): unknown {
  return [
    patch.source,
    patch.processId,
    patch.elementId,
    patch.field,
    patch.property,
    patch.value,
    patch.expectedValue ?? null,
    patch.target ?? null,
    patch.reason
  ]
}

function queueFingerprint(item: TranslationQueueItem): unknown {
  return [
    item.source,
    item.processId,
    item.elementId,
    item.field,
    item.sourceLanguage,
    item.sourceValue,
    item.target,
    item.requiresSegmentationReview === true,
    item.issues.map((issue) => [issue.target, issue.code, issue.originalValue ?? null])
  ]
}

async function makeReviewDigest(
  originalDigest: string,
  source: LocalizationSource,
  target: LanguageCode,
  knownProcessIds: readonly string[],
  resources: LocalizationResources,
  validation: ValidationSummary,
  ingestion: LocalizationIngestionReview,
  queue: readonly TranslationQueueItem[]
): Promise<string> {
  return sha256Text(
    JSON.stringify({
      version: 1,
      originalDigest,
      source,
      target,
      knownProcessIds,
      resources,
      validation: validationFingerprint(validation),
      fields: ingestion.localPlan.fields.map(fieldFingerprint),
      initialIssues: issueFingerprint(ingestion.initialAudit),
      localIssues: issueFingerprint(ingestion.audit),
      localUpdates: ingestion.localPlan.updates.map(patchFingerprint),
      projection: {
        complete: ingestion.projection.complete,
        blockers: ingestion.projection.blockers.map((issue) => [
          issue.processId,
          issue.elementId,
          issue.field,
          issue.target,
          issue.code
        ]),
        updates: ingestion.projection.updates.map(patchFingerprint)
      },
      queue: queue.map(queueFingerprint)
    })
  )
}

function copyField(field: LocalizationField): LocalizationField {
  return {
    ...field,
    value: { ...field.value },
    origins: { ...field.origins },
    storage: { ...field.storage },
    planeIds: [...field.planeIds]
  }
}

function fieldKey(value: Pick<LocalizationField, 'processId' | 'elementId' | 'field'>): string {
  return `${value.processId}\u0000${value.elementId}\u0000${value.field}`
}

function editKey(edit: ReviewedLocalizationEdit): string {
  return `${edit.processId}\u0000${edit.elementId}\u0000${edit.field}\u0000${edit.target}`
}

function approvalKey(approval: ReviewedLocalizationApproval): string {
  return [
    approval.processId,
    approval.elementId,
    approval.field,
    approval.target,
    approval.kind
  ].join('\u0000')
}

function applyReviewedEdits(
  inputFields: readonly LocalizationField[],
  edits: readonly ReviewedLocalizationEdit[]
): { fields: LocalizationField[]; patches: LocalizationPatch[] } {
  const fields = inputFields.map(copyField)
  const byKey = new Map(fields.map((field) => [fieldKey(field), field]))
  const patches: LocalizationPatch[] = []
  const seen = new Set<string>()

  for (const edit of edits) {
    if (seen.has(editKey(edit))) {
      throw new ReviewedXmlIngestionError(
        'review-invalid',
        `Localization review contains duplicate edits for "${edit.elementId}/${edit.field}/${edit.target}".`
      )
    }
    seen.add(editKey(edit))
    const field = byKey.get(fieldKey(edit))
    if (!field) {
      throw new ReviewedXmlIngestionError(
        'review-invalid',
        `Localization review references unknown field "${edit.elementId}/${edit.field}".`
      )
    }
    if (typeof edit.value !== 'string' || edit.value.trim() === '') {
      throw new ReviewedXmlIngestionError(
        'review-invalid',
        `Localization review supplied an empty ${edit.target} value for "${edit.elementId}/${edit.field}".`
      )
    }
    const current = field.value[edit.target] ?? null
    if (current !== edit.expectedValue) {
      throw new ReviewedXmlIngestionError(
        'review-tampered',
        `Localization field "${edit.elementId}/${edit.field}/${edit.target}" changed after review.`
      )
    }
    if (current === edit.value) continue
    patches.push({
      source: field.source,
      processId: field.processId,
      elementId: field.elementId,
      field: field.field,
      property: edit.target === 'en' ? field.storage.enProperty : field.storage.arProperty,
      value: edit.value,
      ...(current === null ? {} : { expectedValue: current }),
      target: edit.target,
      reason: 'review'
    })
    field.value[edit.target] = edit.value
    field.origins[edit.target] = 'paired'
  }
  return { fields, patches }
}

function validateReviewedApprovals(
  fields: readonly LocalizationField[],
  approvals: readonly ReviewedLocalizationApproval[]
): readonly LocalizationFieldException[] {
  const byKey = new Map(fields.map((field) => [fieldKey(field), field]))
  const seen = new Set<string>()
  const output: LocalizationFieldException[] = []
  for (const approval of approvals) {
    const key = approvalKey(approval)
    if (seen.has(key)) {
      throw new ReviewedXmlIngestionError(
        'review-invalid',
        `Localization review contains duplicate approval "${approval.elementId}/${approval.field}/${approval.target}/${approval.kind}".`
      )
    }
    seen.add(key)
    const field = byKey.get(fieldKey(approval))
    if (!field) {
      throw new ReviewedXmlIngestionError(
        'review-invalid',
        `Localization review approves unknown field "${approval.elementId}/${approval.field}".`
      )
    }
    if (approval.kind === 'english-bilingual' && approval.target !== 'en') {
      throw new ReviewedXmlIngestionError(
        'review-invalid',
        'English bilingual-name exceptions may approve only an English target.'
      )
    }
    if (field.value[approval.target] !== approval.value || approval.value.trim() === '') {
      throw new ReviewedXmlIngestionError(
        'review-tampered',
        `Localization approval "${approval.elementId}/${approval.field}/${approval.target}" no longer matches the reviewed value.`
      )
    }
    output.push({ ...approval })
  }
  return Object.freeze(output)
}

async function completedReviewDigest(
  requestDigest: string,
  reviewMode: 'automatic-complete' | 'explicit',
  edits: readonly ReviewedLocalizationEdit[],
  approvals: readonly ReviewedLocalizationApproval[]
): Promise<string> {
  return sha256Text(
    JSON.stringify({
      version: 1,
      requestDigest,
      reviewMode,
      edits,
      approvals
    })
  )
}

function activeLanguagePatches(
  fields: readonly LocalizationField[],
  target: LanguageCode
): LocalizationPatch[] {
  const fieldsByProcess = new Map<string, LocalizationField[]>()
  for (const field of fields) {
    const values = fieldsByProcess.get(field.processId) ?? []
    values.push(field)
    fieldsByProcess.set(field.processId, values)
  }
  const patches: LocalizationPatch[] = []
  for (const [processId, processFields] of fieldsByProcess) {
    if (processFields.every((field) => field.value.active === target)) continue
    patches.push({
      source: processFields[0]!.source,
      processId,
      elementId: processId,
      field: '__activeLang',
      property: 'orbitpm:activeLang',
      value: target,
      target,
      reason: 'projection'
    })
  }
  return patches
}

function readValue(object: MutableModdleElement | undefined, property: string): unknown {
  if (!object) return undefined
  if (typeof object.get === 'function') {
    try {
      const value = object.get(property)
      if (value !== undefined) return value
    } catch {
      // Direct and raw-attribute storage remain valid fallbacks.
    }
  }
  if (Object.prototype.hasOwnProperty.call(object, property)) return object[property]
  if (property.startsWith('orbitpm:')) {
    const local = property.slice('orbitpm:'.length)
    if (Object.prototype.hasOwnProperty.call(object, local)) return object[local]
  }
  return object.$attrs?.[property]
}

function textValue(value: unknown): string | undefined {
  if (value == null) return undefined
  const text = String(value)
  return text.trim() === '' ? undefined : text
}

function typeOf(object: MutableModdleElement): string {
  const type = readValue(object, '$type')
  return typeof type === 'string' ? type : ''
}

function idOf(object: MutableModdleElement | undefined): string | undefined {
  return textValue(readValue(object, 'id'))?.trim()
}

function childObjects(object: MutableModdleElement): MutableModdleElement[] {
  const output: MutableModdleElement[] = []
  for (const [key, value] of Object.entries(object)) {
    if (
      key === '$attrs' ||
      key === '$parent' ||
      key === '$model' ||
      key === '$descriptor' ||
      key === 'incoming' ||
      key === 'outgoing' ||
      key.endsWith('Ref')
    ) {
      continue
    }
    for (const candidate of Array.isArray(value) ? value : [value]) {
      if (candidate && typeof candidate === 'object') {
        output.push(candidate as MutableModdleElement)
      }
    }
  }
  return output
}

function collectObjects(root: unknown): MutableModdleElement[] {
  if (!root || typeof root !== 'object') return []
  const output: MutableModdleElement[] = []
  const seen = new WeakSet<object>()
  const visit = (object: MutableModdleElement): void => {
    if (seen.has(object)) return
    seen.add(object)
    output.push(object)
    for (const child of childObjects(object)) visit(child)
  }
  visit(root as MutableModdleElement)
  return output
}

function resolveObject(
  patch: LocalizationPatch,
  objects: readonly MutableModdleElement[],
  directById: ReadonlyMap<string, MutableModdleElement>
): MutableModdleElement | undefined {
  const direct = directById.get(patch.elementId)
  if (direct) return direct
  const match = /^(.*)::([^:]+):(\d+)$/.exec(patch.elementId)
  if (!match) return undefined
  const [, parentOrProcess, localType, ordinalText] = match
  const ordinal = Number(ordinalText)
  const candidates = objects.filter((object) => {
    const type = typeOf(object)
    const local = type.includes(':') ? type.slice(type.indexOf(':') + 1) : type
    if (local !== localType) return false
    const parent =
      object.$parent && typeof object.$parent === 'object'
        ? idOf(object.$parent as MutableModdleElement)
        : undefined
    return (parent ?? patch.processId) === parentOrProcess
  })
  return candidates[ordinal - 1]
}

function writeValue(object: MutableModdleElement, property: string, value: string): void {
  if (!property.startsWith('orbitpm:')) {
    object[property] = value
    return
  }
  const local = property.slice('orbitpm:'.length)
  if (REGISTERED_ORBITPM_ATTRIBUTES.has(local)) {
    object[local] = value
    if (object.$attrs) delete object.$attrs[property]
    return
  }
  object.$attrs ??= {}
  object.$attrs[property] = value
}

function applyPatches(
  definitions: MutableModdleElement,
  patches: readonly LocalizationPatch[]
): number {
  const objects = collectObjects(definitions)
  const directById = new Map<string, MutableModdleElement>()
  for (const object of objects) {
    const id = idOf(object)
    if (id && !directById.has(id)) directById.set(id, object)
  }
  let changed = 0
  for (const patch of patches) {
    const object = resolveObject(patch, objects, directById)
    if (!object) {
      throw new ReviewedXmlIngestionError(
        'postcondition-failed',
        `Localization patch target "${patch.elementId}/${patch.field}" was not found.`
      )
    }
    const current = textValue(readValue(object, patch.property))
    if (
      patch.expectedValue !== undefined &&
      current !== patch.expectedValue &&
      current !== patch.value
    ) {
      throw new ReviewedXmlIngestionError(
        'stale',
        `Localization patch target "${patch.elementId}/${patch.field}" changed after review.`
      )
    }
    if (current === patch.value) continue
    writeValue(object, patch.property, patch.value)
    changed += 1
  }
  return changed
}

function validationOptions(
  options: ReviewBpmnXmlLocalizationOptions,
  resources: LocalizationResources,
  knownProcessIds: readonly string[],
  requireBilingual: boolean,
  reviewedFieldExceptions: readonly LocalizationFieldException[] = []
): BpmnValidationOptions {
  const supplied = options.validation ?? {}
  const suppliedNeutralTerms = supplied.neutralTerms === undefined ? [] : [...supplied.neutralTerms]
  return {
    ...supplied,
    knownProcessIds,
    neutralTerms: [...approvedNeutralTerms(resources.glossary), ...suppliedNeutralTerms],
    approvedEnglishBilingualExceptions: [
      ...(options.approvedEnglishBilingualExceptions ?? []),
      ...(supplied.approvedEnglishBilingualExceptions ?? [])
    ],
    approvedFieldExceptions: [
      ...(options.approvedFieldExceptions ?? []),
      ...(supplied.approvedFieldExceptions ?? []),
      ...reviewedFieldExceptions
    ],
    requireBilingual
  }
}

function assertValidationAllowed(
  summary: ValidationSummary,
  action: ValidationAction,
  stage: 'input' | 'output',
  allowReviewableLocalizationIssues = false
): void {
  const policySummary = allowReviewableLocalizationIssues
    ? {
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
      }
    : summary
  const decision = evaluateValidationPolicy(policySummary, action)
  if (!decision.allowed) {
    throw new ReviewedXmlIngestionError(
      'invalid-input',
      `BPMN ${stage} validation failed: ${decision.blockingIssues
        .slice(0, 8)
        .map((issue) => issue.code)
        .join(', ')}`,
      summary
    )
  }
}

function assertFinalLocalization(
  beforeFields: readonly LocalizationField[],
  definitions: MutableModdleElement,
  options: ReviewBpmnXmlLocalizationOptions,
  auditOptions: LocalizationAuditOptions
): LocalizationAuditReport {
  const fields = extractBpmnLocalization(definitions, {
    source: options.source,
    defaultActive: options.defaultActive
  })
  const report = auditLocalizationFields(fields, auditOptions)
  if (report.issues.length > 0) {
    throw new ReviewedXmlIngestionError(
      'postcondition-failed',
      `Serialized BPMN still has ${report.issues.length} bilingual localization issue(s).`
    )
  }
  const beforeKeys = beforeFields.map(fieldKey)
  const afterKeys = fields.map(fieldKey)
  if (
    beforeKeys.length !== afterKeys.length ||
    beforeKeys.some((key, index) => key !== afterKeys[index])
  ) {
    throw new ReviewedXmlIngestionError(
      'postcondition-failed',
      'Serialized BPMN changed the set of translatable fields.'
    )
  }
  const mismatch = fields.find(
    (field) =>
      field.value.active !== options.target ||
      field.value[options.target] === undefined ||
      field.projection !== field.value[options.target]
  )
  if (mismatch) {
    throw new ReviewedXmlIngestionError(
      'postcondition-failed',
      `Visible ${options.target} projection failed for "${mismatch.elementId}/${mismatch.field}".`
    )
  }
  return report
}

/**
 * Secure, storage-agnostic bilingual ingestion for exact BPMN XML.
 *
 * The coordinator performs no network or durable mutation. Complete inputs
 * auto-complete from reviewed local resources. Incomplete inputs expose one
 * immutable, digest-bound awaited review. Only local-plan patches, explicit
 * field edits, visible projection, and active-language markers can change the
 * parsed model; arbitrary reviewer XML is never accepted.
 */
export async function reviewBpmnXmlLocalization(
  originalXml: string,
  options: ReviewBpmnXmlLocalizationOptions
): Promise<ReviewedXmlIngestionOutcome> {
  await assertCurrent(options)
  const resources = copyResources(options.resources)
  const knownProcessIds = stableIds(options.validation?.knownProcessIds)
  const action = options.validationAction ?? 'commit-import'
  const input = await validateBpmnXml(
    originalXml,
    validationOptions(options, resources, knownProcessIds, false)
  )
  await assertCurrent(options)
  if (!input.definitions) {
    throw new ReviewedXmlIngestionError(
      'invalid-input',
      'BPMN input did not produce parsed definitions.',
      input.summary
    )
  }
  // Missing/invalid bilingual values and stale projection metadata are the
  // exact fields this coordinator repairs. All structural, semantic and
  // preservation blockers remain fail-closed before a review can be shown.
  assertValidationAllowed(input.summary, action, 'input', true)

  const localizationOptions = stableLocalizationOptions(options, resources)
  const auditOptions = stableAuditOptions(options, resources)
  const ingestion = prepareLocalizationIngestion(input.definitions, localizationOptions)
  const queue = buildTranslationQueue(ingestion.localPlan.fields, auditOptions)
  const originalDigest = await sha256Text(originalXml)
  await assertCurrent(options)
  const reviewDigest = await makeReviewDigest(
    originalDigest,
    options.source,
    options.target,
    knownProcessIds,
    resources,
    input.summary,
    ingestion,
    queue
  )
  await assertCurrent(options)
  const request = deepFreeze<ReviewedXmlIngestionReviewRequest>({
    version: 1,
    source: options.source,
    target: options.target,
    originalXml,
    originalDigest,
    reviewDigest,
    knownProcessIds,
    resources,
    validation: input.summary,
    ingestion,
    queue
  })

  const needsReview = ingestion.audit.issues.length > 0 || !ingestion.projection.complete
  let reviewMode: 'automatic-complete' | 'explicit' = 'automatic-complete'
  let reviewedEdits: readonly ReviewedLocalizationEdit[] = Object.freeze([])
  let reviewedApprovals: readonly ReviewedLocalizationApproval[] = Object.freeze([])
  if (needsReview) {
    if (!options.review) return deepFreeze({ status: 'review-required' as const, request })
    const result = await options.review(request, { signal: options.signal })
    await assertCurrent(options)
    if (result.status === 'cancelled') {
      return deepFreeze({ status: 'cancelled' as const, request })
    }
    if (result.reviewDigest !== reviewDigest) {
      throw new ReviewedXmlIngestionError(
        'review-tampered',
        'Localization review does not match the exact current BPMN report.'
      )
    }
    reviewedEdits = copyEdits(result.edits)
    reviewedApprovals = copyApprovals(result.approvals ?? [])
    reviewMode = 'explicit'
  }

  const reviewed = applyReviewedEdits(ingestion.localPlan.fields, reviewedEdits)
  const approvedFieldExceptions = validateReviewedApprovals(reviewed.fields, reviewedApprovals)
  const reviewedAuditOptions: LocalizationAuditOptions = {
    ...auditOptions,
    approvedFieldExceptions: [
      ...(auditOptions.approvedFieldExceptions ?? []),
      ...approvedFieldExceptions
    ]
  }
  const reviewedAudit = auditLocalizationFields(reviewed.fields, reviewedAuditOptions)
  if (reviewedAudit.issues.length > 0) {
    throw new ReviewedXmlIngestionError(
      'review-incomplete',
      `Localization review left ${reviewedAudit.issues.length} unresolved issue(s).`
    )
  }
  const projection = planLanguageProjection(reviewed.fields, options.target, reviewedAuditOptions)
  if (!projection.complete) {
    throw new ReviewedXmlIngestionError(
      'review-incomplete',
      `Localization review left ${projection.blockers.length} visible projection blocker(s).`
    )
  }
  const active = activeLanguagePatches(reviewed.fields, options.target)
  const patches = [
    ...ingestion.localPlan.updates,
    ...reviewed.patches,
    ...projection.updates,
    ...active
  ]
  const definitions = input.definitions as MutableModdleElement
  const changed = applyPatches(definitions, patches)
  await assertCurrent(options)

  let xml = originalXml
  if (changed > 0) {
    const moddle = new BpmnModdle({
      orbitpm: orbitpmModdleDescriptor as unknown as Record<string, unknown>
    }) as unknown as SerializableBpmnModdle
    const serialized = await moddle.toXML(definitions, { format: true, preamble: true })
    if (typeof serialized.xml !== 'string' || serialized.xml.length === 0) {
      throw new ReviewedXmlIngestionError(
        'serialization-failed',
        'bpmn-moddle returned no serialized XML after localization review.'
      )
    }
    xml = serialized.xml
  }
  await assertCurrent(options)

  const preservation = await validateUnknownExtensionPreservation(originalXml, xml)
  await assertCurrent(options)
  if (!preservation.valid) {
    throw new ReviewedXmlIngestionError(
      'preservation-failed',
      'Localization ingestion would mutate or discard opaque BPMN extension data.',
      preservation
    )
  }

  const output = await validateBpmnXml(
    xml,
    validationOptions(options, resources, knownProcessIds, true, approvedFieldExceptions)
  )
  await assertCurrent(options)
  if (!output.definitions) {
    throw new ReviewedXmlIngestionError(
      'postcondition-failed',
      'Serialized BPMN did not produce parsed definitions.',
      output.summary
    )
  }
  assertValidationAllowed(output.summary, action, 'output')
  const finalAudit = assertFinalLocalization(
    reviewed.fields,
    output.definitions as MutableModdleElement,
    options,
    reviewedAuditOptions
  )
  const digest = await sha256Text(xml)
  const decisionDigest = await completedReviewDigest(
    reviewDigest,
    reviewMode,
    reviewedEdits,
    reviewedApprovals
  )
  await assertCurrent(options)

  const processIds = stableIds(finalAudit.fields.map((field) => field.processId))
  const planeIds = stableIds(finalAudit.fields.flatMap((field) => field.planeIds))
  const evidence = deepFreeze<ReviewedXmlIngestionEvidence>({
    version: 1,
    source: options.source,
    target: options.target,
    reviewMode,
    originalDigest,
    requestDigest: reviewDigest,
    reviewDigest: decisionDigest,
    outputDigest: digest,
    inputValidation: input.summary,
    outputValidation: output.summary,
    initialAudit: ingestion.initialAudit,
    localAudit: ingestion.audit,
    finalAudit,
    reviewedEdits,
    reviewedApprovals,
    appliedPatches: {
      local: ingestion.localPlan.updates.length,
      reviewed: reviewed.patches.length,
      projection: projection.updates.length,
      activeLanguage: active.length,
      changed
    },
    processIds,
    planeIds,
    unknownExtensionsPreserved: true,
    visibleTargetVerified: true
  })
  return deepFreeze({
    status: 'completed' as const,
    xml,
    digest,
    reviewDigest: decisionDigest,
    reviewMode,
    request,
    evidence
  })
}
