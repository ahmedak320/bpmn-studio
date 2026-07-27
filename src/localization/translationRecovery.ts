import { auditFieldTarget, auditLocalizationFields, createLocalizationAuditContext } from './audit'
import {
  createExternalRequestDisclosure,
  type ExternalRequestDisclosure
} from './externalRequestReview'
import {
  activeLanguagePatches,
  applyLocalizationPatchesAtomically,
  assertLocalizationReviewCurrent,
  inspectDiagramLocalization,
  isDiagramLocalizationProjected,
  type DiagramLocalizationReview,
  type LocalizationModeler
} from './modelerAdapter'
import { planLanguageProjection } from './plan'
import type {
  LanguageCode,
  LocalizationField,
  LocalizationIssue,
  LocalizationIssueCode,
  LocalizationPatchReason,
  ProviderFailure,
  TranslationQueueItem
} from './types'

export type TranslationRecoveryFieldId = string & {
  readonly __translationRecoveryFieldId: unique symbol
}

export interface TranslationRecoveryField {
  id: TranslationRecoveryFieldId
  processId: string
  elementId: string
  field: string
  sourceLanguage: LanguageCode
  target: LanguageCode
  sourceValue: string
  currentTargetValue?: string
  issueCodes: readonly LocalizationIssueCode[]
  failed: boolean
  retryable: boolean
  /** False when an issue has no extractable BPMN storage target to patch safely. */
  editable: boolean
  requiresManualReview: boolean
  queueItem?: TranslationQueueItem
}

export interface TranslationReviewProgress {
  total: number
  resolved: number
  unresolved: number
  failed: number
  complete: boolean
}

export interface TranslationRecoveryProvider {
  providerId: string
  modelId?: string
}

export interface TranslationRecoveryApplyOptions {
  /** Manual edits are review decisions; provider retry results retain provenance. */
  reason?: Extract<LocalizationPatchReason, 'review' | 'provider'>
  /**
   * When this value resolves the final blocker, project the target and active
   * language in the same command-stack batch as the recovered metadata.
   */
  projectCompletedView?: boolean
}

export interface StagedTranslationRecoveryValue {
  fieldId: TranslationRecoveryFieldId
  value: string
}

export interface TranslationRecoveryValidation {
  valid: boolean
  value: string
  issues: readonly LocalizationIssue[]
}

export class InvalidTranslationRecoveryValueError extends Error {
  readonly issues: readonly LocalizationIssue[]

  constructor(issues: readonly LocalizationIssue[]) {
    super('The reviewed translation does not pass the bilingual field audit.')
    this.name = 'InvalidTranslationRecoveryValueError'
    this.issues = issues
  }
}

export class IncompleteTranslationRecoveryError extends Error {
  readonly issues: readonly LocalizationIssue[]

  constructor(issues: readonly LocalizationIssue[]) {
    super('Every unresolved target field must be reviewed before the completed view is applied.')
    this.name = 'IncompleteTranslationRecoveryError'
    this.issues = issues
  }
}

function fieldIdentity(
  value: Pick<TranslationRecoveryField, 'processId' | 'elementId' | 'field' | 'target'>
): TranslationRecoveryFieldId {
  return JSON.stringify([
    value.processId,
    value.elementId,
    value.field,
    value.target
  ]) as TranslationRecoveryFieldId
}

function localizationFieldIdentity(
  value: Pick<LocalizationField, 'processId' | 'elementId' | 'field'>
): string {
  return JSON.stringify([value.processId, value.elementId, value.field])
}

export function translationRecoveryFieldId(
  value: Pick<TranslationRecoveryField, 'processId' | 'elementId' | 'field' | 'target'>
): TranslationRecoveryFieldId {
  return fieldIdentity(value)
}

function fieldMatches(
  field: Pick<LocalizationField, 'processId' | 'elementId' | 'field'>,
  recovery: Pick<TranslationRecoveryField, 'processId' | 'elementId' | 'field'>
): boolean {
  return (
    field.processId === recovery.processId &&
    field.elementId === recovery.elementId &&
    field.field === recovery.field
  )
}

function issueMatches(
  issue: LocalizationIssue,
  recovery: Pick<TranslationRecoveryField, 'processId' | 'elementId' | 'field' | 'target'>
): boolean {
  return fieldMatches(issue, recovery) && issue.target === recovery.target
}

function opposite(language: LanguageCode): LanguageCode {
  return language === 'en' ? 'ar' : 'en'
}

/**
 * One row per unresolved target field. Issue-only rows are retained even when
 * there is no sendable provider queue item, so manual recovery never
 * disappears merely because automatic translation is impossible.
 */
export function listTranslationRecoveryFields(
  review: DiagramLocalizationReview
): TranslationRecoveryField[] {
  const rows = new Map<TranslationRecoveryFieldId, TranslationRecoveryField>()
  const fieldsByIdentity = new Map<string, LocalizationField>()
  const issuesByIdentity = new Map<TranslationRecoveryFieldId, LocalizationIssue[]>()

  // Build the two indexes once. A large incomplete diagram must not scan every
  // field and every issue again for each unresolved queue item.
  for (const field of review.fields) {
    const id = localizationFieldIdentity(field)
    if (!fieldsByIdentity.has(id)) fieldsByIdentity.set(id, field)
  }
  for (const issue of review.issues) {
    const id = fieldIdentity(issue)
    const related = issuesByIdentity.get(id)
    if (related) related.push(issue)
    else issuesByIdentity.set(id, [issue])
  }

  const add = (
    identity: Pick<TranslationRecoveryField, 'processId' | 'elementId' | 'field' | 'target'>,
    queueItem?: TranslationQueueItem
  ): void => {
    const id = fieldIdentity(identity)
    if (rows.has(id)) return
    const field = fieldsByIdentity.get(localizationFieldIdentity(identity))
    const relatedIssues = issuesByIdentity.get(id) ?? []
    const sourceLanguage =
      queueItem?.sourceLanguage ??
      field?.sourceLanguage ??
      (field?.value[opposite(identity.target)] !== undefined
        ? opposite(identity.target)
        : identity.target)
    const sourceValue =
      queueItem?.sourceValue ??
      field?.value[sourceLanguage] ??
      field?.projection ??
      relatedIssues.find((issue) => issue.originalValue !== undefined)?.originalValue ??
      ''
    const issueCodes = [
      ...new Set([
        ...relatedIssues.map((issue) => issue.code),
        ...(queueItem?.issues.map((issue) => issue.code) ?? [])
      ])
    ]
    rows.set(id, {
      id,
      ...identity,
      sourceLanguage,
      sourceValue,
      ...(field?.value[identity.target] === undefined
        ? {}
        : { currentTargetValue: field.value[identity.target] }),
      issueCodes,
      failed: issueCodes.includes('provider-failed'),
      editable: field !== undefined,
      retryable:
        queueItem !== undefined &&
        queueItem.requiresSegmentationReview !== true &&
        sourceValue.trim() !== '',
      requiresManualReview:
        queueItem?.requiresSegmentationReview === true ||
        queueItem === undefined ||
        issueCodes.includes('mixed'),
      ...(queueItem === undefined ? {} : { queueItem })
    })
  }

  for (const item of review.queue) add(item, item)
  for (const issue of review.issues) {
    if (issue.target !== review.target) continue
    add(issue)
  }
  return [...rows.values()]
}

export function deriveTranslationReviewProgress(
  review: DiagramLocalizationReview,
  recoveryFields: readonly TranslationRecoveryField[] = listTranslationRecoveryFields(review)
): TranslationReviewProgress {
  const unresolved = recoveryFields.length
  return {
    total: review.fields.length,
    resolved: Math.max(0, review.fields.length - unresolved),
    unresolved,
    failed: recoveryFields.filter((row) => row.failed).length,
    complete: review.complete && unresolved === 0
  }
}

function cloneWithTarget(
  field: LocalizationField,
  target: LanguageCode,
  value: string
): LocalizationField {
  return {
    ...field,
    value: { ...field.value, [target]: value },
    origins: { ...field.origins, [target]: 'paired' },
    storage: { ...field.storage },
    planeIds: [...field.planeIds]
  }
}

export function validateTranslationRecoveryValue(
  review: DiagramLocalizationReview,
  recovery: TranslationRecoveryField,
  input: string
): TranslationRecoveryValidation {
  const value = input.trim()
  const field = review.fields.find((candidate) => fieldMatches(candidate, recovery))
  if (!field) {
    const issues = review.issues.filter((issue) => issueMatches(issue, recovery))
    return { valid: false, value, issues }
  }
  const candidate = cloneWithTarget(field, recovery.target, value)
  const issues = auditLocalizationFields([candidate], {
    glossary: review.localResources.glossary
  }).issues.filter((issue) => issue.target === recovery.target && issue.code !== 'provider-failed')
  return { valid: issues.length === 0, value, issues }
}

function remainingProviderFailures(
  review: DiagramLocalizationReview,
  recovery: TranslationRecoveryField
): ProviderFailure[] {
  return review.issues
    .filter((issue) => issue.code === 'provider-failed' && !issueMatches(issue, recovery))
    .map((issue) => ({
      processId: issue.processId,
      elementId: issue.elementId,
      field: issue.field,
      target: issue.target,
      ...(issue.originalValue === undefined ? {} : { originalValue: issue.originalValue })
    }))
}

/**
 * Validate and atomically apply one manually reviewed or provider-retried
 * target value. No visible language projection is claimed here; the returned
 * fresh review tells the host whether it can explicitly apply the completed
 * target view.
 */
export function applyTranslationRecoveryValue(
  modeler: LocalizationModeler,
  review: DiagramLocalizationReview,
  fieldId: TranslationRecoveryFieldId,
  input: string,
  options: TranslationRecoveryApplyOptions = {}
): DiagramLocalizationReview {
  assertLocalizationReviewCurrent(modeler, review)
  const recovery = listTranslationRecoveryFields(review).find(
    (candidate) => candidate.id === fieldId
  )
  if (!recovery) throw new Error('The translation recovery field is no longer unresolved.')
  const validation = validateTranslationRecoveryValue(review, recovery, input)
  if (!validation.valid) throw new InvalidTranslationRecoveryValueError(validation.issues)
  const field = review.fields.find((candidate) => fieldMatches(candidate, recovery))
  if (!field) throw new Error('The translation recovery field is no longer available.')

  const remainingFailures = remainingProviderFailures(review, recovery)
  const candidateFields = review.fields.map((candidate) =>
    fieldMatches(candidate, recovery)
      ? cloneWithTarget(candidate, recovery.target, validation.value)
      : {
          ...candidate,
          value: { ...candidate.value },
          origins: { ...candidate.origins },
          storage: { ...candidate.storage },
          planeIds: [...candidate.planeIds]
        }
  )
  const projection = planLanguageProjection(candidateFields, review.target, {
    providerFailures: remainingFailures,
    glossary: review.localResources.glossary
  })
  const projectCompletedView = options.projectCompletedView === true && projection.complete
  const fieldLocalUpdates = review.localUpdates.filter((patch) => fieldMatches(patch, recovery))
  const batchExecuted = applyLocalizationPatchesAtomically(modeler, [
    ...(projectCompletedView ? review.localUpdates : fieldLocalUpdates),
    {
      source: field.source,
      processId: field.processId,
      elementId: field.elementId,
      field: field.field,
      property: recovery.target === 'en' ? field.storage.enProperty : field.storage.arProperty,
      value: validation.value,
      expectedValue: field.value[recovery.target] ?? null,
      target: recovery.target,
      reason: options.reason ?? 'review'
    },
    ...(projectCompletedView ? projection.updates : []),
    ...(projectCompletedView ? activeLanguagePatches(modeler, candidateFields, review.target) : [])
  ])

  const post = inspectDiagramLocalization(modeler, review.target, {
    source: review.source,
    providerFailures: remainingFailures,
    ...review.localResources
  })
  if (batchExecuted && projectCompletedView && !isDiagramLocalizationProjected(modeler, post)) {
    try {
      ;(modeler.get('commandStack') as { undo(): void }).undo()
    } catch {
      // The caller still receives an error and must not report completion.
    }
    throw new Error('The completed translation could not be projected into the diagram.')
  }
  return post
}

/**
 * Commit every staged review decision together with local-resource metadata,
 * visible labels, and the active-language marker as one command-stack batch.
 *
 * Staging itself is browser-private state: this is the only point where a
 * completed reviewed set reaches BPMN. The complete set is revalidated and
 * stale-checked immediately before the batch, so closing/postponing the review
 * before this call cannot leave partial model or translation-memory changes.
 */
export function applyStagedTranslationRecoveryValues(
  modeler: LocalizationModeler,
  review: DiagramLocalizationReview,
  stagedValues: readonly StagedTranslationRecoveryValue[]
): DiagramLocalizationReview {
  assertLocalizationReviewCurrent(modeler, review)

  const recoveryFields = listTranslationRecoveryFields(review)
  const recoveryById = new Map(recoveryFields.map((field) => [field.id, field] as const))
  const fieldsByIdentity = new Map(
    review.fields.map((field) => [localizationFieldIdentity(field), field] as const)
  )
  const stagedById = new Map<TranslationRecoveryFieldId, string>()
  const accepted: Array<{
    recovery: TranslationRecoveryField
    field: LocalizationField
    value: string
  }> = []
  const auditContext = createLocalizationAuditContext({
    glossary: review.localResources.glossary
  })

  for (const staged of stagedValues) {
    if (stagedById.has(staged.fieldId)) {
      throw new Error('The same translation recovery field was staged more than once.')
    }
    const recovery = recoveryById.get(staged.fieldId)
    const field = recovery ? fieldsByIdentity.get(localizationFieldIdentity(recovery)) : undefined
    if (!recovery || !field || !recovery.editable) {
      throw new Error('The translation recovery field is no longer available.')
    }
    const value = staged.value.trim()
    const candidate = cloneWithTarget(field, recovery.target, value)
    const issues = auditFieldTarget(
      candidate,
      recovery.target,
      {
        glossary: review.localResources.glossary,
        auditContext
      },
      auditContext
    ).filter((issue) => issue.code !== 'provider-failed')
    if (issues.length > 0) throw new InvalidTranslationRecoveryValueError(issues)
    stagedById.set(staged.fieldId, value)
    accepted.push({ recovery, field, value })
  }

  const candidateFields = review.fields.map((field) => {
    const id = fieldIdentity({
      processId: field.processId,
      elementId: field.elementId,
      field: field.field,
      target: review.target
    })
    const value = stagedById.get(id)
    return value === undefined
      ? {
          ...field,
          value: { ...field.value },
          origins: { ...field.origins },
          storage: { ...field.storage },
          planeIds: [...field.planeIds]
        }
      : cloneWithTarget(field, review.target, value)
  })
  const stagedIds = new Set(stagedById.keys())
  const remainingFailures = review.issues
    .filter(
      (issue) =>
        issue.code === 'provider-failed' &&
        !stagedIds.has(
          fieldIdentity({
            processId: issue.processId,
            elementId: issue.elementId,
            field: issue.field,
            target: issue.target
          })
        )
    )
    .map((issue) => ({
      processId: issue.processId,
      elementId: issue.elementId,
      field: issue.field,
      target: issue.target,
      ...(issue.originalValue === undefined ? {} : { originalValue: issue.originalValue })
    }))
  const projection = planLanguageProjection(candidateFields, review.target, {
    providerFailures: remainingFailures,
    glossary: review.localResources.glossary,
    auditContext
  })
  if (!projection.complete) throw new IncompleteTranslationRecoveryError(projection.blockers)

  const batchExecuted = applyLocalizationPatchesAtomically(modeler, [
    ...review.localUpdates,
    ...accepted.map(({ recovery, field, value }) => ({
      source: field.source,
      processId: field.processId,
      elementId: field.elementId,
      field: field.field,
      property: recovery.target === 'en' ? field.storage.enProperty : field.storage.arProperty,
      value,
      expectedValue:
        field.origins[recovery.target] === 'paired' ? (field.value[recovery.target] ?? null) : null,
      target: recovery.target,
      reason: 'review' as const
    })),
    ...projection.updates,
    ...activeLanguagePatches(modeler, candidateFields, review.target)
  ])

  const post = inspectDiagramLocalization(modeler, review.target, {
    source: review.source,
    providerFailures: remainingFailures,
    ...review.localResources
  })
  if (!post.complete || !isDiagramLocalizationProjected(modeler, post)) {
    if (batchExecuted) {
      try {
        ;(modeler.get('commandStack') as { undo(): void }).undo()
      } catch {
        // The caller still receives an error and must not report completion.
      }
    }
    throw new Error('The completed translation could not be projected into the diagram.')
  }
  return post
}

function sensitiveField(field: string): boolean {
  return (
    field === 'owner' ||
    field === 'ownerRole' ||
    field === 'respList' ||
    field === 'ccList' ||
    field === 'ccTo'
  )
}

/**
 * Consent disclosure for an exact one-field retry. The host must use this
 * disclosure (and a matching consent token) for only the identified field.
 */
export function buildTranslationRecoveryDisclosure(
  recovery: TranslationRecoveryField,
  provider: TranslationRecoveryProvider
): ExternalRequestDisclosure {
  if (!recovery.retryable) {
    throw new Error('This translation field requires manual review and cannot be sent.')
  }
  return createExternalRequestDisclosure({
    purpose: 'diagram-localization-field-retry',
    providerId: provider.providerId,
    ...(provider.modelId === undefined ? {} : { modelId: provider.modelId }),
    outbound: [
      {
        id: 'loc_1',
        text: recovery.sourceValue,
        context: `${recovery.processId} / ${recovery.elementId} / ${recovery.field} / ${recovery.sourceLanguage}→${recovery.target}`,
        sensitive: sensitiveField(recovery.field)
      }
    ],
    // Free translation can fall back between two services; AI output can
    // require one parse-repair request. Both use at most three transport tries.
    estimatedRequests: { min: 1, max: 6 }
  })
}
