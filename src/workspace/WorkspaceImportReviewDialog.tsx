import { useId, useMemo, useRef, useState } from 'react'
import { AccessibleDialog } from '../common/AccessibleDialog'
import { t, type Key, type Lang } from '../i18n'
import { useLang } from '../i18n/useLang'
import type { ValidationSeverity, ValidationSource } from '../validation'
import { localizeValidationIssue } from '../validation/issueLocalization'
import { normalizeWorkspacePath } from './adapters/path'
import type {
  WorkspaceImportArtifact,
  WorkspaceImportCollision,
  WorkspaceImportCollisionDecision,
  WorkspaceImportPlan,
  WorkspaceImportRepair,
  WorkspaceImportRepairCode,
  WorkspaceImportSkippedItem,
  WorkspaceImportSkipReason
} from './importTransaction'
import { isReservedOrbitPmPath } from './processIdentity'
import {
  boundedWorkspaceImportTechnicalEvidence,
  WORKSPACE_IMPORT_TECHNICAL_DETAIL_MAX_CODE_POINTS,
  WorkspaceImportAutoLayoutPreview
} from './WorkspaceImportAutoLayoutPreview'
import './WorkspaceImportReviewDialog.css'

/**
 * A review plan may legally contain thousands of artifacts. Keep each
 * independently navigable evidence surface bounded so supported input cannot
 * create an unbounded DOM.
 */
export const WORKSPACE_IMPORT_REVIEW_PAGE_SIZE = 12
export const WORKSPACE_IMPORT_EXACT_EVIDENCE_PAGE_SIZE = 16

interface ImportDiagnosticSpec {
  message: Key
  repair: Key
}

interface ImportSkipDiagnosticSpec extends ImportDiagnosticSpec {
  label: Key
}

const WORKSPACE_IMPORT_SKIP_DIAGNOSTICS = Object.freeze({
  'unsupported-content': {
    label: 'workspaceImportReview.reason.unsupportedContent',
    message: 'workspaceImportReview.skip.unsupportedContent',
    repair: 'workspaceImportReview.guidance.chooseSupportedContent'
  },
  'unsafe-path': {
    label: 'workspaceImportReview.reason.unsafePath',
    message: 'workspaceImportReview.skip.unsafePath',
    repair: 'workspaceImportReview.guidance.useSafePath'
  },
  'invalid-bpmn': {
    label: 'workspaceImportReview.reason.invalidBpmn',
    message: 'workspaceImportReview.skip.invalidBpmn',
    repair: 'workspaceImportReview.guidance.repairBpmn'
  },
  'aml-conversion-failed': {
    label: 'workspaceImportReview.reason.amlConversionFailed',
    message: 'workspaceImportReview.skip.amlConversionFailed',
    repair: 'workspaceImportReview.guidance.reviewArisExport'
  },
  'process-id-collision': {
    label: 'workspaceImportReview.reason.processIdCollision',
    message: 'workspaceImportReview.skip.processIdCollision',
    repair: 'workspaceImportReview.guidance.resolveProcessIdentity'
  },
  'process-identity-changed': {
    label: 'workspaceImportReview.reason.processIdentityChanged',
    message: 'workspaceImportReview.skip.processIdentityChanged',
    repair: 'workspaceImportReview.guidance.repeatReview'
  },
  'localization-review-required': {
    label: 'workspaceImportReview.reason.localizationReviewRequired',
    message: 'workspaceImportReview.skip.localizationReviewRequired',
    repair: 'workspaceImportReview.guidance.completeLocalization'
  },
  'localization-review-cancelled': {
    label: 'workspaceImportReview.reason.localizationReviewCancelled',
    message: 'workspaceImportReview.skip.localizationReviewCancelled',
    repair: 'workspaceImportReview.guidance.completeLocalization'
  },
  'localization-invalid': {
    label: 'workspaceImportReview.reason.localizationInvalid',
    message: 'workspaceImportReview.skip.localizationInvalid',
    repair: 'workspaceImportReview.guidance.completeLocalization'
  },
  'destination-parent-file': {
    label: 'workspaceImportReview.reason.destinationParentFile',
    message: 'workspaceImportReview.skip.destinationParentFile',
    repair: 'workspaceImportReview.guidance.useSafePath'
  },
  'library-not-bpmn': {
    label: 'workspaceImportReview.reason.libraryNotBpmn',
    message: 'workspaceImportReview.skip.libraryNotBpmn',
    repair: 'workspaceImportReview.guidance.chooseSupportedContent'
  },
  'library-unsafe-path': {
    label: 'workspaceImportReview.reason.libraryUnsafePath',
    message: 'workspaceImportReview.skip.libraryUnsafePath',
    repair: 'workspaceImportReview.guidance.useSafePath'
  },
  'library-too-large': {
    label: 'workspaceImportReview.reason.libraryTooLarge',
    message: 'workspaceImportReview.skip.libraryTooLarge',
    repair: 'workspaceImportReview.guidance.reduceLibraryEntry'
  },
  'library-decode-failed': {
    label: 'workspaceImportReview.reason.libraryDecodeFailed',
    message: 'workspaceImportReview.skip.libraryDecodeFailed',
    repair: 'workspaceImportReview.guidance.decodeUtf8'
  }
} satisfies Record<WorkspaceImportSkipReason, ImportSkipDiagnosticSpec>)

const WORKSPACE_IMPORT_REPAIR_MESSAGE_KEYS = Object.freeze({
  'aml-converted': 'workspaceImportReview.appliedRepair.amlConverted',
  'auto-layout': 'workspaceImportReview.appliedRepair.autoLayout',
  'destination-normalized': 'workspaceImportReview.appliedRepair.destinationNormalized',
  'destination-deduplicated': 'workspaceImportReview.appliedRepair.destinationDeduplicated',
  'destination-case-normalized': 'workspaceImportReview.appliedRepair.destinationCaseNormalized'
} satisfies Record<WorkspaceImportRepairCode, Key>)

const WORKSPACE_IMPORT_WARNING_DIAGNOSTICS = Object.freeze({
  'aml-downgraded': {
    message: 'workspaceImportReview.warning.amlDowngraded',
    repair: 'workspaceImportReview.guidance.reviewArisReport'
  },
  'aml-ignored': {
    message: 'workspaceImportReview.warning.amlIgnored',
    repair: 'workspaceImportReview.guidance.reviewArisReport'
  },
  'aml-ambiguous': {
    message: 'workspaceImportReview.warning.amlAmbiguous',
    repair: 'workspaceImportReview.guidance.reviewArisReport'
  },
  'aml-unmapped': {
    message: 'workspaceImportReview.warning.amlUnmapped',
    repair: 'workspaceImportReview.guidance.reviewArisReport'
  },
  'same-path-process-replacement': {
    message: 'workspaceImportReview.warning.samePathProcessReplacement',
    repair: 'workspaceImportReview.guidance.reviewReplacement'
  }
} satisfies Record<string, ImportDiagnosticSpec>)

const VALIDATION_SEVERITY_KEYS = Object.freeze({
  error: 'validation.severity.error',
  warning: 'validation.severity.warning',
  info: 'validation.severity.info'
} satisfies Record<ValidationSeverity, Key>)

const VALIDATION_SOURCE_KEYS = Object.freeze({
  xml: 'validation.stage.xml',
  moddle: 'validation.stage.moddle',
  xsd: 'validation.stage.xsd',
  bpmnlint: 'validation.stage.bpmnlint',
  structure: 'validation.stage.structure',
  semantic: 'validation.stage.semantic',
  di: 'validation.stage.di',
  orbitpm: 'validation.stage.orbitpm',
  preservation: 'validation.stage.preservation'
} satisfies Record<ValidationSource, Key>)

function ownValue<Value>(record: Readonly<Record<string, Value>>, key: string): Value | undefined {
  if (!Object.prototype.hasOwnProperty.call(record, key)) return undefined
  return record[key]
}

function validationSeverityLabel(severity: unknown): string {
  const key =
    typeof severity === 'string' ? ownValue<Key>(VALIDATION_SEVERITY_KEYS, severity) : undefined
  return t(key ?? 'workspaceImportReview.validationSeverityUnknown')
}

function validationSourceLabel(source: unknown): string {
  const key = typeof source === 'string' ? ownValue<Key>(VALIDATION_SOURCE_KEYS, source) : undefined
  return t(key ?? 'workspaceImportReview.validationSourceUnknown')
}

function workspaceImportSkipCopy(item: WorkspaceImportSkippedItem): {
  label: string
  message: string
  suggestedRepair: string
} {
  const spec = ownValue<ImportSkipDiagnosticSpec>(WORKSPACE_IMPORT_SKIP_DIAGNOSTICS, item.reason)
  return spec
    ? {
        label: t(spec.label),
        message: t(spec.message),
        suggestedRepair: t(spec.repair)
      }
    : {
        label: t('workspaceImportReview.reason.unknown'),
        message: t('workspaceImportReview.skip.unknown'),
        suggestedRepair: t('workspaceImportReview.guidance.unknown')
      }
}

function workspaceImportRepairMessage(repair: WorkspaceImportRepair): string {
  const key = ownValue<Key>(WORKSPACE_IMPORT_REPAIR_MESSAGE_KEYS, repair.code)
  return t(key ?? 'workspaceImportReview.appliedRepair.unknown')
}

function workspaceImportWarningCopy(
  warning: WorkspaceImportPlan['warnings'][number],
  lang: Lang
): { message: string; suggestedRepair: string } {
  if (warning.validationIssue) {
    return localizeValidationIssue(warning.validationIssue)
  }
  const spec = ownValue<ImportDiagnosticSpec>(WORKSPACE_IMPORT_WARNING_DIAGNOSTICS, warning.code)
  if (!spec) {
    return {
      message: t('workspaceImportReview.warning.unknown'),
      suggestedRepair: t('workspaceImportReview.guidance.unknown')
    }
  }
  return {
    message: t(spec.message, {
      count: new Intl.NumberFormat(lang).format(warning.count ?? 0)
    }),
    suggestedRepair: t(spec.repair)
  }
}

export interface WorkspaceImportReviewDialogProps {
  plan: WorkspaceImportPlan
  decisions: Readonly<Record<string, WorkspaceImportCollisionDecision | undefined>>
  busy?: boolean
  error?: string
  onDecision: (artifactId: string, decision: WorkspaceImportCollisionDecision | undefined) => void
  onConfirm: () => void
  onCancel: () => void
  onDownloadArisReport?: (sourceId: string) => void
}

interface CollisionReview {
  collision: WorkspaceImportCollision
  artifact: WorkspaceImportArtifact | undefined
  decision: WorkspaceImportCollisionDecision | undefined
  keepBothPath: string
  keepBothAllowed: boolean
  keepBothRestriction?: string
  normalizedKeepBothPath?: string
  keepBothError?: string
}

function pathKey(path: string): string {
  return path.normalize('NFC').toLocaleLowerCase('en-US')
}

function reservedPath(path: string): boolean {
  try {
    return isReservedOrbitPmPath(path)
  } catch {
    return false
  }
}

function planHasReservedDestination(plan: WorkspaceImportPlan): boolean {
  return (
    reservedPath(plan.targetFolder) ||
    plan.artifacts.some(({ destinationPath }) => reservedPath(destinationPath))
  )
}

interface PaginationWindow {
  readonly page: number
  readonly pageCount: number
  readonly start: number
  readonly end: number
  readonly setPage: (page: number) => void
}

function usePaginationWindow(total: number, pageSize: number): PaginationWindow {
  const [requestedPage, setRequestedPage] = useState(0)
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const page = Math.min(requestedPage, pageCount - 1)
  const start = page * pageSize
  const end = Math.min(total, start + pageSize)

  return {
    page,
    pageCount,
    start,
    end,
    setPage: (nextPage) => {
      setRequestedPage(Math.max(0, Math.min(nextPage, pageCount - 1)))
    }
  }
}

function PaginationControls({
  label,
  total,
  window,
  controls
}: {
  label: string
  total: number
  window: PaginationWindow
  controls: string
}): JSX.Element | null {
  if (total <= 0 || window.pageCount <= 1) return null
  return (
    <nav
      className="workspace-import-review__pagination"
      aria-label={t('workspaceImportReview.pagination.navigation', { section: label })}
    >
      <p role="status" aria-live="polite">
        {t('workspaceImportReview.pagination.status', {
          start: window.start + 1,
          end: window.end,
          total,
          page: window.page + 1,
          pages: window.pageCount
        })}
      </p>
      <div>
        <button
          type="button"
          className="orbitpm-lite-chrome-btn"
          disabled={window.page === 0}
          aria-controls={controls}
          aria-label={t('workspaceImportReview.pagination.previousFor', { section: label })}
          onClick={() => window.setPage(window.page - 1)}
        >
          {t('workspaceImportReview.pagination.previous')}
        </button>
        <button
          type="button"
          className="orbitpm-lite-chrome-btn"
          disabled={window.page + 1 >= window.pageCount}
          aria-controls={controls}
          aria-label={t('workspaceImportReview.pagination.nextFor', { section: label })}
          onClick={() => window.setPage(window.page + 1)}
        >
          {t('workspaceImportReview.pagination.next')}
        </button>
      </div>
    </nav>
  )
}

function ExactList({ values, label }: { values: readonly string[]; label: string }): JSX.Element {
  const reactId = useId()
  const listId = `workspace-import-review-exact-list-${reactId}`
  const window = usePaginationWindow(values.length, WORKSPACE_IMPORT_EXACT_EVIDENCE_PAGE_SIZE)
  if (values.length === 0) return <span>{t('workspaceImportReview.none')}</span>
  return (
    <div className="workspace-import-review__exact-list-container">
      <ul id={listId} className="workspace-import-review__exact-list">
        {values.slice(window.start, window.end).map((value, localIndex) => {
          const index = window.start + localIndex
          return (
            <li key={`${value}-${index}`} aria-posinset={index + 1} aria-setsize={values.length}>
              <code dir="ltr">{value}</code>
            </li>
          )
        })}
      </ul>
      <PaginationControls label={label} total={values.length} window={window} controls={listId} />
    </div>
  )
}

function TechnicalDiagnostic({
  value,
  validation = false
}: {
  value: unknown
  validation?: boolean
}): JSX.Element {
  const evidence = boundedWorkspaceImportTechnicalEvidence(value)
  if (!evidence) return <span>{t('workspaceImportReview.none')}</span>
  return (
    <span className="workspace-import-review__bounded-technical">
      <code
        lang="en"
        dir="ltr"
        {...(validation
          ? { 'data-workspace-import-validation-diagnostic': true }
          : { 'data-workspace-import-technical-diagnostic': true })}
      >
        {evidence.text}
      </code>
      {evidence.truncated ? (
        <span data-workspace-import-technical-truncation>
          {t('workspaceImportReview.technicalEvidenceTruncated', {
            limit: WORKSPACE_IMPORT_TECHNICAL_DETAIL_MAX_CODE_POINTS
          })}
        </span>
      ) : null}
    </span>
  )
}

function EvidenceRow({
  label,
  children,
  code = false
}: {
  label: string
  children: React.ReactNode
  code?: boolean
}): JSX.Element {
  return (
    <>
      <dt>{label}</dt>
      <dd className={code ? 'workspace-import-review__code' : undefined}>
        {code ? <code dir="ltr">{children}</code> : children}
      </dd>
    </>
  )
}

function SummaryItem({ label, value }: { label: string; value: number }): JSX.Element {
  return (
    <div className="workspace-import-review__summary-item">
      <dt>{label}</dt>
      <dd dir="ltr">{String(value)}</dd>
    </div>
  )
}

function EmptyEvidence(): JSX.Element {
  return <p className="workspace-import-review__empty">{t('workspaceImportReview.none')}</p>
}

function collisionReviews(
  plan: WorkspaceImportPlan,
  decisions: WorkspaceImportReviewDialogProps['decisions'],
  keepBothPaths: Readonly<Record<string, string>>
): CollisionReview[] {
  const artifactsById = new Map(plan.artifacts.map((artifact) => [artifact.id, artifact]))
  const occupied = new Set(plan.artifacts.map(({ destinationPath }) => pathKey(destinationPath)))
  const reviews = plan.collisions.map((collision): CollisionReview => {
    const artifact = artifactsById.get(collision.artifactId)
    const decision = collision.identical ? undefined : decisions[collision.artifactId]
    const keepBothPath =
      keepBothPaths[collision.artifactId] ??
      (decision?.action === 'keep-both' ? decision.destinationPath : undefined) ??
      collision.suggestedKeepBothPath
    const keepBothAllowed =
      plan.workspaceMultipleFiles && (artifact?.replacesProcessIds.length ?? 0) === 0
    const keepBothRestriction = !plan.workspaceMultipleFiles
      ? t('workspaceImportReview.keepBoth.adapterDisabled')
      : (artifact?.replacesProcessIds.length ?? 0) > 0
        ? t('workspaceImportReview.keepBoth.identityDisabled')
        : undefined

    let normalizedKeepBothPath: string | undefined
    let keepBothError: string | undefined
    if (decision?.action === 'keep-both') {
      if (!keepBothAllowed) {
        keepBothError = keepBothRestriction
      } else {
        try {
          normalizedKeepBothPath = normalizeWorkspacePath(keepBothPath)
          if (isReservedOrbitPmPath(normalizedKeepBothPath)) {
            keepBothError = t('workspaceImportReview.keepBoth.reserved')
          } else if (occupied.has(pathKey(normalizedKeepBothPath))) {
            keepBothError = t('workspaceImportReview.keepBoth.occupied')
          }
        } catch {
          keepBothError = t('workspaceImportReview.keepBoth.invalid')
        }
      }
    }

    return {
      collision,
      artifact,
      decision,
      keepBothPath,
      keepBothAllowed,
      keepBothRestriction,
      normalizedKeepBothPath,
      keepBothError
    }
  })

  const chosenPathCounts = new Map<string, number>()
  for (const review of reviews) {
    if (
      review.decision?.action !== 'keep-both' ||
      review.keepBothError ||
      !review.normalizedKeepBothPath
    ) {
      continue
    }
    const key = pathKey(review.normalizedKeepBothPath)
    chosenPathCounts.set(key, (chosenPathCounts.get(key) ?? 0) + 1)
  }

  return reviews.map((review) => {
    if (
      review.decision?.action !== 'keep-both' ||
      review.keepBothError ||
      !review.normalizedKeepBothPath ||
      chosenPathCounts.get(pathKey(review.normalizedKeepBothPath)) === 1
    ) {
      return review
    }
    return {
      ...review,
      keepBothError: t('workspaceImportReview.keepBoth.duplicate')
    }
  })
}

function WorkspaceImportReviewDialogBody({
  plan,
  decisions,
  busy = false,
  error,
  onDecision,
  onConfirm,
  onCancel,
  onDownloadArisReport,
  lang
}: WorkspaceImportReviewDialogProps & { lang: Lang }): JSX.Element {
  const titleRef = useRef<HTMLHeadingElement>(null)
  const [autoLayoutAccepted, setAutoLayoutAccepted] = useState(false)
  const sourceNames = useMemo(() => {
    const names = new Map<string, string>()
    for (const artifact of plan.artifacts) names.set(artifact.sourceId, artifact.sourceName)
    for (const item of plan.skipped) {
      if (!names.has(item.sourceId)) names.set(item.sourceId, item.sourceName)
    }
    for (const evidence of plan.arisReports) {
      if (!names.has(evidence.sourceId)) names.set(evidence.sourceId, evidence.sourceName)
    }
    return names
  }, [plan.arisReports, plan.artifacts, plan.skipped])
  const [keepBothPaths, setKeepBothPaths] = useState<Readonly<Record<string, string>>>(() =>
    Object.fromEntries(
      plan.collisions.map((collision) => {
        const decision = decisions[collision.artifactId]
        return [
          collision.artifactId,
          decision?.action === 'keep-both'
            ? (decision.destinationPath ?? collision.suggestedKeepBothPath)
            : collision.suggestedKeepBothPath
        ]
      })
    )
  )
  const reviews = useMemo(
    () => collisionReviews(plan, decisions, keepBothPaths),
    [decisions, keepBothPaths, plan]
  )
  const artifactWindow = usePaginationWindow(
    plan.artifacts.length,
    WORKSPACE_IMPORT_REVIEW_PAGE_SIZE
  )
  const skippedWindow = usePaginationWindow(plan.skipped.length, WORKSPACE_IMPORT_REVIEW_PAGE_SIZE)
  const warningWindow = usePaginationWindow(plan.warnings.length, WORKSPACE_IMPORT_REVIEW_PAGE_SIZE)
  const repairWindow = usePaginationWindow(plan.repairs.length, WORKSPACE_IMPORT_REVIEW_PAGE_SIZE)
  const arisWindow = usePaginationWindow(plan.arisReports.length, WORKSPACE_IMPORT_REVIEW_PAGE_SIZE)
  const collisionWindow = usePaginationWindow(reviews.length, WORKSPACE_IMPORT_REVIEW_PAGE_SIZE)
  const layoutPreviews = useMemo(() => {
    const autoLayoutIds = new Set(
      plan.repairs.filter(({ code }) => code === 'auto-layout').map(({ artifactId }) => artifactId)
    )
    return plan.artifacts
      .filter(({ id }) => autoLayoutIds.has(id))
      .map((artifact) => ({
        artifactId: artifact.id,
        sourceId: artifact.sourceId,
        sourceName: artifact.sourceName,
        sourcePath: artifact.sourcePath,
        destinationPath: artifact.destinationPath,
        reviewedXml: artifact.xml
      }))
  }, [plan.artifacts, plan.repairs])
  const unresolved = reviews.filter(
    ({ collision, decision }) => !collision.identical && decision === undefined
  ).length
  const invalidKeepBoth = reviews.some(
    ({ decision, keepBothError }) => decision?.action === 'keep-both' && keepBothError
  )
  const autoLayoutAcceptanceRequired = layoutPreviews.length > 0 && !autoLayoutAccepted
  const reservedPlanDestination = planHasReservedDestination(plan)
  const confirmDisabled =
    busy ||
    plan.status === 'blocked' ||
    unresolved > 0 ||
    invalidKeepBoth ||
    autoLayoutAcceptanceRequired ||
    reservedPlanDestination
  const statusMessage = reservedPlanDestination
    ? t('workspaceImportReview.reservedPlanDestination')
    : plan.status === 'blocked'
      ? t('workspaceImportReview.blocked')
      : unresolved > 0
        ? t('workspaceImportReview.unresolved', { count: unresolved })
        : invalidKeepBoth
          ? t('workspaceImportReview.invalidDecision')
          : autoLayoutAcceptanceRequired
            ? t('workspaceImportReview.autoLayoutAcceptance.required')
            : t('workspaceImportReview.ready')
  const applyTechnicalEvidence = boundedWorkspaceImportTechnicalEvidence(error)

  const setDecision = (
    review: CollisionReview,
    action: '' | WorkspaceImportCollisionDecision['action']
  ): void => {
    if (action === '') {
      onDecision(review.collision.artifactId, undefined)
      return
    }
    if (action === 'keep-both') {
      onDecision(review.collision.artifactId, {
        action,
        destinationPath: review.keepBothPath
      })
      return
    }
    onDecision(review.collision.artifactId, { action })
  }

  return (
    <AccessibleDialog
      ariaLabelledby="workspace-import-review-title"
      ariaDescribedby="workspace-import-review-intro workspace-import-review-state"
      initialFocusRef={titleRef}
      onClose={() => {
        if (!busy) onCancel()
      }}
      closeOnEscape={!busy}
      closeOnBackdrop={false}
      backdropClassName="workspace-import-review__backdrop"
      dialogClassName="workspace-import-review"
      dir={lang === 'ar' ? 'rtl' : 'ltr'}
    >
      <header className="workspace-import-review__header">
        <div>
          <h2 id="workspace-import-review-title" ref={titleRef} tabIndex={-1}>
            {t('workspaceImportReview.title')}
          </h2>
          <p id="workspace-import-review-intro">{t('workspaceImportReview.intro')}</p>
        </div>
        <button
          type="button"
          className="workspace-import-review__close"
          aria-label={t('workspaceImportReview.close')}
          title={t('workspaceImportReview.close')}
          disabled={busy}
          onClick={onCancel}
        >
          ×
        </button>
      </header>

      <div className="workspace-import-review__body">
        <section aria-labelledby="workspace-import-review-plan">
          <h3 id="workspace-import-review-plan">{t('workspaceImportReview.plan')}</h3>
          <dl className="workspace-import-review__evidence">
            <EvidenceRow label={t('workspaceImportReview.status')}>
              <span
                className={`workspace-import-review__status workspace-import-review__status--${plan.status}`}
              >
                {plan.status === 'ready'
                  ? t('workspaceImportReview.status.ready')
                  : t('workspaceImportReview.status.blocked')}
              </span>
            </EvidenceRow>
            <EvidenceRow label={t('workspaceImportReview.reviewDigest')} code>
              {plan.reviewDigest}
            </EvidenceRow>
            <EvidenceRow label={t('workspaceImportReview.planId')} code>
              {plan.id}
            </EvidenceRow>
            <EvidenceRow label={t('workspaceImportReview.createdAt')} code>
              {plan.createdAt}
            </EvidenceRow>
            <EvidenceRow label={t('workspaceImportReview.workspaceId')} code>
              {plan.workspaceId}
            </EvidenceRow>
            <EvidenceRow label={t('workspaceImportReview.workspaceMode')} code>
              {plan.workspaceMode}
            </EvidenceRow>
            <EvidenceRow label={t('workspaceImportReview.targetFolder')} code>
              {plan.targetFolder || t('workspaceImportReview.root')}
            </EvidenceRow>
          </dl>
        </section>

        <section aria-labelledby="workspace-import-review-summary">
          <h3 id="workspace-import-review-summary">{t('workspaceImportReview.summary')}</h3>
          <dl className="workspace-import-review__summary">
            <SummaryItem
              label={t('workspaceImportReview.summary.sources')}
              value={plan.summary.sources}
            />
            <SummaryItem
              label={t('workspaceImportReview.summary.artifacts')}
              value={plan.summary.artifacts}
            />
            <SummaryItem
              label={t('workspaceImportReview.summary.collisions')}
              value={plan.summary.collisions}
            />
            <SummaryItem
              label={t('workspaceImportReview.summary.skipped')}
              value={plan.summary.skipped}
            />
            <SummaryItem
              label={t('workspaceImportReview.summary.repairs')}
              value={plan.summary.repairs}
            />
            <SummaryItem
              label={t('workspaceImportReview.summary.warnings')}
              value={plan.summary.warnings}
            />
            <SummaryItem
              label={t('workspaceImportReview.summary.arisReports')}
              value={plan.summary.arisReports}
            />
            <SummaryItem
              label={t('workspaceImportReview.summary.creates')}
              value={plan.summary.creates}
            />
            <SummaryItem
              label={t('workspaceImportReview.summary.identical')}
              value={plan.summary.identical}
            />
          </dl>
        </section>

        <section aria-labelledby="workspace-import-review-artifacts">
          <h3 id="workspace-import-review-artifacts">{t('workspaceImportReview.artifacts')}</h3>
          {plan.artifacts.length === 0 ? (
            <EmptyEvidence />
          ) : (
            <>
              <ol
                id="workspace-import-review-artifact-list"
                className="workspace-import-review__cards"
                start={artifactWindow.start + 1}
              >
                {plan.artifacts
                  .slice(artifactWindow.start, artifactWindow.end)
                  .map((artifact, localIndex) => {
                    const index = artifactWindow.start + localIndex
                    return (
                      <li
                        key={artifact.id}
                        className="workspace-import-review__card"
                        aria-posinset={index + 1}
                        aria-setsize={plan.artifacts.length}
                      >
                        <h4>
                          {t('workspaceImportReview.artifact', {
                            index: index + 1,
                            name: artifact.sourceName
                          })}
                        </h4>
                        <dl className="workspace-import-review__evidence">
                          <EvidenceRow label={t('workspaceImportReview.artifactId')} code>
                            {artifact.id}
                          </EvidenceRow>
                          <EvidenceRow label={t('workspaceImportReview.sourceName')}>
                            <span dir="auto">{artifact.sourceName}</span>
                          </EvidenceRow>
                          <EvidenceRow label={t('workspaceImportReview.sourceId')} code>
                            {artifact.sourceId}
                          </EvidenceRow>
                          <EvidenceRow label={t('workspaceImportReview.sourceKind')} code>
                            {artifact.sourceKind}
                          </EvidenceRow>
                          <EvidenceRow label={t('workspaceImportReview.sourcePath')} code>
                            {artifact.sourcePath}
                          </EvidenceRow>
                          <EvidenceRow label={t('workspaceImportReview.destinationPath')} code>
                            {artifact.destinationPath}
                          </EvidenceRow>
                          <EvidenceRow label={t('workspaceImportReview.utf8Bytes')}>
                            <span dir="ltr">{String(artifact.bytes.byteLength)}</span>
                          </EvidenceRow>
                          <EvidenceRow label={t('workspaceImportReview.sha256')} code>
                            {artifact.sha256}
                          </EvidenceRow>
                          <EvidenceRow label={t('workspaceImportReview.processIds')}>
                            <ExactList
                              values={artifact.processIds}
                              label={`${t('workspaceImportReview.processIds')}: ${artifact.id}`}
                            />
                          </EvidenceRow>
                          <EvidenceRow label={t('workspaceImportReview.replacesProcessIds')}>
                            <ExactList
                              values={artifact.replacesProcessIds}
                              label={`${t('workspaceImportReview.replacesProcessIds')}: ${artifact.id}`}
                            />
                          </EvidenceRow>
                          <EvidenceRow label={t('workspaceImportReview.localizationMode')}>
                            <span>
                              {artifact.localizationEvidence.reviewMode === 'automatic-complete'
                                ? t('workspaceImportReview.localizationMode.automatic')
                                : t('workspaceImportReview.localizationMode.explicit')}{' '}
                              (<code dir="ltr">{artifact.localizationEvidence.reviewMode}</code>)
                            </span>
                          </EvidenceRow>
                          <EvidenceRow label={t('workspaceImportReview.localizationDigest')} code>
                            {artifact.localizationReviewDigest}
                          </EvidenceRow>
                        </dl>
                      </li>
                    )
                  })}
              </ol>
              <PaginationControls
                label={t('workspaceImportReview.artifacts')}
                total={plan.artifacts.length}
                window={artifactWindow}
                controls="workspace-import-review-artifact-list"
              />
            </>
          )}
        </section>

        <section aria-labelledby="workspace-import-review-skipped">
          <h3 id="workspace-import-review-skipped">{t('workspaceImportReview.skipped')}</h3>
          {plan.skipped.length === 0 ? (
            <EmptyEvidence />
          ) : (
            <>
              <ol
                id="workspace-import-review-skipped-list"
                className="workspace-import-review__cards"
                start={skippedWindow.start + 1}
              >
                {plan.skipped
                  .slice(skippedWindow.start, skippedWindow.end)
                  .map((item, localIndex) => {
                    const index = skippedWindow.start + localIndex
                    const copy = workspaceImportSkipCopy(item)
                    return (
                      <li
                        key={`${item.sourceId}-${item.path ?? ''}-${item.reason}-${index}`}
                        className="workspace-import-review__card"
                        aria-posinset={index + 1}
                        aria-setsize={plan.skipped.length}
                      >
                        <h4>{t('workspaceImportReview.skippedItem', { index: index + 1 })}</h4>
                        <dl className="workspace-import-review__evidence">
                          <EvidenceRow label={t('workspaceImportReview.sourceName')}>
                            <span dir="auto">{item.sourceName}</span>
                          </EvidenceRow>
                          <EvidenceRow label={t('workspaceImportReview.sourceId')} code>
                            {item.sourceId}
                          </EvidenceRow>
                          {item.path ? (
                            <EvidenceRow label={t('workspaceImportReview.path')} code>
                              {item.path}
                            </EvidenceRow>
                          ) : null}
                          <EvidenceRow label={t('workspaceImportReview.reason')}>
                            <span data-workspace-import-skip-reason-label>{copy.label}</span>
                          </EvidenceRow>
                          <EvidenceRow label={t('workspaceImportReview.message')}>
                            <span data-workspace-import-localized-message>{copy.message}</span>
                          </EvidenceRow>
                          <EvidenceRow label={t('workspaceImportReview.suggestedRepair')}>
                            <span data-workspace-import-localized-repair>
                              {copy.suggestedRepair}
                            </span>
                          </EvidenceRow>
                          <EvidenceRow label={t('workspaceImportReview.technicalCode')}>
                            <code lang="en" dir="ltr" data-workspace-import-skip-reason-code>
                              {item.reason}
                            </code>
                          </EvidenceRow>
                          <EvidenceRow label={t('workspaceImportReview.technicalDiagnostic')}>
                            <TechnicalDiagnostic value={item.message} />
                          </EvidenceRow>
                        </dl>
                      </li>
                    )
                  })}
              </ol>
              <PaginationControls
                label={t('workspaceImportReview.skipped')}
                total={plan.skipped.length}
                window={skippedWindow}
                controls="workspace-import-review-skipped-list"
              />
            </>
          )}
        </section>

        <section aria-labelledby="workspace-import-review-warnings">
          <h3 id="workspace-import-review-warnings">{t('workspaceImportReview.warnings')}</h3>
          {plan.warnings.length === 0 ? (
            <EmptyEvidence />
          ) : (
            <>
              <ol
                id="workspace-import-review-warning-list"
                className="workspace-import-review__cards"
                start={warningWindow.start + 1}
              >
                {plan.warnings
                  .slice(warningWindow.start, warningWindow.end)
                  .map((warning, localIndex) => {
                    const index = warningWindow.start + localIndex
                    const copy = workspaceImportWarningCopy(warning, lang)
                    return (
                      <li
                        key={`${warning.sourceId}-${warning.artifactId ?? ''}-${warning.code}-${index}`}
                        className="workspace-import-review__card"
                        aria-posinset={index + 1}
                        aria-setsize={plan.warnings.length}
                      >
                        <h4>{t('workspaceImportReview.warningItem', { index: index + 1 })}</h4>
                        <dl className="workspace-import-review__evidence">
                          {sourceNames.get(warning.sourceId) ? (
                            <EvidenceRow label={t('workspaceImportReview.sourceName')}>
                              <span dir="auto">{sourceNames.get(warning.sourceId)}</span>
                            </EvidenceRow>
                          ) : null}
                          <EvidenceRow label={t('workspaceImportReview.sourceId')} code>
                            {warning.sourceId}
                          </EvidenceRow>
                          {warning.artifactId ? (
                            <EvidenceRow label={t('workspaceImportReview.artifactId')} code>
                              {warning.artifactId}
                            </EvidenceRow>
                          ) : null}
                          {warning.count !== undefined ? (
                            <EvidenceRow label={t('workspaceImportReview.count')}>
                              <span dir="ltr">
                                {new Intl.NumberFormat(lang).format(warning.count)}
                              </span>
                            </EvidenceRow>
                          ) : null}
                          {warning.validationIssue ? (
                            <>
                              <EvidenceRow label={t('workspaceImportReview.validationSeverity')}>
                                <span data-workspace-import-validation-severity>
                                  {validationSeverityLabel(warning.validationIssue.severity)}
                                </span>
                              </EvidenceRow>
                              <EvidenceRow label={t('workspaceImportReview.validationSource')}>
                                <span data-workspace-import-validation-source>
                                  {validationSourceLabel(warning.validationIssue.source)}
                                </span>
                              </EvidenceRow>
                            </>
                          ) : null}
                          <EvidenceRow label={t('workspaceImportReview.message')}>
                            <span data-workspace-import-localized-message>{copy.message}</span>
                          </EvidenceRow>
                          <EvidenceRow label={t('workspaceImportReview.suggestedRepair')}>
                            <span data-workspace-import-localized-repair>
                              {copy.suggestedRepair}
                            </span>
                          </EvidenceRow>
                          <EvidenceRow label={t('workspaceImportReview.technicalCode')}>
                            <code lang="en" dir="ltr">
                              {warning.code}
                            </code>
                          </EvidenceRow>
                          {warning.validationIssue ? (
                            <EvidenceRow label={t('workspaceImportReview.validationCode')}>
                              <code lang="en" dir="ltr" data-workspace-import-validation-code>
                                {warning.validationIssue.code}
                              </code>
                            </EvidenceRow>
                          ) : null}
                          {warning.validationIssue?.ruleId ? (
                            <EvidenceRow label={t('workspaceImportReview.validationRuleId')}>
                              <code lang="en" dir="ltr" data-workspace-import-validation-rule>
                                {warning.validationIssue.ruleId}
                              </code>
                            </EvidenceRow>
                          ) : null}
                          <EvidenceRow label={t('workspaceImportReview.technicalDiagnostic')}>
                            <TechnicalDiagnostic value={warning.message} />
                          </EvidenceRow>
                          {warning.validationIssue &&
                          warning.validationIssue.message !== warning.message ? (
                            <EvidenceRow label={t('workspaceImportReview.validationDiagnostic')}>
                              <TechnicalDiagnostic
                                value={warning.validationIssue.message}
                                validation
                              />
                            </EvidenceRow>
                          ) : null}
                        </dl>
                      </li>
                    )
                  })}
              </ol>
              <PaginationControls
                label={t('workspaceImportReview.warnings')}
                total={plan.warnings.length}
                window={warningWindow}
                controls="workspace-import-review-warning-list"
              />
            </>
          )}
        </section>

        <section aria-labelledby="workspace-import-review-repairs">
          <h3 id="workspace-import-review-repairs">{t('workspaceImportReview.repairs')}</h3>
          {plan.repairs.length === 0 ? (
            <EmptyEvidence />
          ) : (
            <>
              <ol
                id="workspace-import-review-repair-list"
                className="workspace-import-review__cards"
                start={repairWindow.start + 1}
              >
                {plan.repairs
                  .slice(repairWindow.start, repairWindow.end)
                  .map((repair, localIndex) => {
                    const index = repairWindow.start + localIndex
                    const localizedMessage = workspaceImportRepairMessage(repair)
                    return (
                      <li
                        key={`${repair.sourceId}-${repair.artifactId}-${repair.code}-${index}`}
                        className="workspace-import-review__card"
                        aria-posinset={index + 1}
                        aria-setsize={plan.repairs.length}
                      >
                        <h4>{t('workspaceImportReview.repairItem', { index: index + 1 })}</h4>
                        <dl className="workspace-import-review__evidence">
                          {sourceNames.get(repair.sourceId) ? (
                            <EvidenceRow label={t('workspaceImportReview.sourceName')}>
                              <span dir="auto">{sourceNames.get(repair.sourceId)}</span>
                            </EvidenceRow>
                          ) : null}
                          <EvidenceRow label={t('workspaceImportReview.sourceId')} code>
                            {repair.sourceId}
                          </EvidenceRow>
                          <EvidenceRow label={t('workspaceImportReview.artifactId')} code>
                            {repair.artifactId}
                          </EvidenceRow>
                          <EvidenceRow label={t('workspaceImportReview.message')}>
                            <span data-workspace-import-localized-message>{localizedMessage}</span>
                          </EvidenceRow>
                          <EvidenceRow label={t('workspaceImportReview.technicalCode')}>
                            <code lang="en" dir="ltr">
                              {repair.code}
                            </code>
                          </EvidenceRow>
                          <EvidenceRow label={t('workspaceImportReview.technicalDiagnostic')}>
                            <TechnicalDiagnostic value={repair.message} />
                          </EvidenceRow>
                          {repair.before !== undefined ? (
                            <EvidenceRow label={t('workspaceImportReview.before')} code>
                              {repair.before}
                            </EvidenceRow>
                          ) : null}
                          {repair.after !== undefined ? (
                            <EvidenceRow label={t('workspaceImportReview.after')} code>
                              {repair.after}
                            </EvidenceRow>
                          ) : null}
                        </dl>
                      </li>
                    )
                  })}
              </ol>
              <PaginationControls
                label={t('workspaceImportReview.repairs')}
                total={plan.repairs.length}
                window={repairWindow}
                controls="workspace-import-review-repair-list"
              />
              {layoutPreviews.length > 0 ? (
                <>
                  <WorkspaceImportAutoLayoutPreview artifacts={layoutPreviews} />
                  <div className="workspace-import-review__layout-acceptance">
                    <label>
                      <input
                        type="checkbox"
                        checked={autoLayoutAccepted}
                        disabled={busy}
                        aria-describedby="workspace-import-review-layout-acceptance-hint"
                        onChange={(event) => setAutoLayoutAccepted(event.target.checked)}
                      />
                      <span>
                        {t('workspaceImportReview.autoLayoutAcceptance.label', {
                          count: layoutPreviews.length
                        })}
                      </span>
                    </label>
                    <p id="workspace-import-review-layout-acceptance-hint">
                      {t('workspaceImportReview.autoLayoutAcceptance.hint')}
                    </p>
                  </div>
                </>
              ) : null}
            </>
          )}
        </section>

        <section aria-labelledby="workspace-import-review-aris">
          <h3 id="workspace-import-review-aris">{t('workspaceImportReview.aris')}</h3>
          {plan.arisReports.length === 0 ? (
            <EmptyEvidence />
          ) : (
            <>
              <ol
                id="workspace-import-review-aris-list"
                className="workspace-import-review__cards"
                start={arisWindow.start + 1}
              >
                {plan.arisReports
                  .slice(arisWindow.start, arisWindow.end)
                  .map((evidence, localIndex) => {
                    const index = arisWindow.start + localIndex
                    return (
                      <li
                        key={`${evidence.sourceId}-${index}`}
                        className="workspace-import-review__card"
                        aria-posinset={index + 1}
                        aria-setsize={plan.arisReports.length}
                      >
                        <h4>
                          {t('workspaceImportReview.arisItem', {
                            index: index + 1,
                            name: evidence.sourceName
                          })}
                        </h4>
                        <dl className="workspace-import-review__aris-counts">
                          <SummaryItem
                            label={t('workspaceImportReview.aris.converted')}
                            value={evidence.report.summary.converted}
                          />
                          <SummaryItem
                            label={t('workspaceImportReview.aris.downgraded')}
                            value={evidence.report.summary.downgraded}
                          />
                          <SummaryItem
                            label={t('workspaceImportReview.aris.ignored')}
                            value={evidence.report.summary.ignored}
                          />
                          <SummaryItem
                            label={t('workspaceImportReview.aris.ambiguous')}
                            value={evidence.report.summary.ambiguous}
                          />
                          <SummaryItem
                            label={t('workspaceImportReview.aris.unmapped')}
                            value={evidence.report.summary.unmapped}
                          />
                        </dl>
                        <dl className="workspace-import-review__evidence">
                          <EvidenceRow label={t('workspaceImportReview.sourceId')} code>
                            {evidence.sourceId}
                          </EvidenceRow>
                          <EvidenceRow label={t('workspaceImportReview.reportFile')} code>
                            {evidence.download.fileName}
                          </EvidenceRow>
                        </dl>
                        <button
                          type="button"
                          className="orbitpm-lite-chrome-btn"
                          disabled={!onDownloadArisReport}
                          title={
                            onDownloadArisReport
                              ? undefined
                              : t('workspaceImportReview.arisDownloadUnavailable')
                          }
                          onClick={() => onDownloadArisReport?.(evidence.sourceId)}
                        >
                          {t('workspaceImportReview.arisDownload')}
                        </button>
                      </li>
                    )
                  })}
              </ol>
              <PaginationControls
                label={t('workspaceImportReview.aris')}
                total={plan.arisReports.length}
                window={arisWindow}
                controls="workspace-import-review-aris-list"
              />
            </>
          )}
        </section>

        <section aria-labelledby="workspace-import-review-collisions">
          <h3 id="workspace-import-review-collisions">{t('workspaceImportReview.collisions')}</h3>
          {reviews.length === 0 ? (
            <EmptyEvidence />
          ) : (
            <>
              <ol
                id="workspace-import-review-collision-list"
                className="workspace-import-review__cards"
                start={collisionWindow.start + 1}
              >
                {reviews
                  .slice(collisionWindow.start, collisionWindow.end)
                  .map((review, localIndex) => {
                    const index = collisionWindow.start + localIndex
                    const { collision, artifact, decision } = review
                    const decisionId = `workspace-import-decision-${index}`
                    const pathId = `workspace-import-keep-both-${index}`
                    const pathErrorId = `${pathId}-error`
                    const restrictionId = `${decisionId}-restriction`
                    const selectedAction = collision.identical ? 'skip' : (decision?.action ?? '')
                    return (
                      <li
                        key={collision.artifactId}
                        className="workspace-import-review__card"
                        aria-posinset={index + 1}
                        aria-setsize={reviews.length}
                      >
                        <h4>
                          {t('workspaceImportReview.collisionItem', {
                            index: index + 1,
                            path: collision.path
                          })}
                        </h4>
                        <dl className="workspace-import-review__evidence">
                          <EvidenceRow label={t('workspaceImportReview.artifactId')} code>
                            {collision.artifactId}
                          </EvidenceRow>
                          {artifact ? (
                            <EvidenceRow label={t('workspaceImportReview.sourceName')}>
                              <span dir="auto">{artifact.sourceName}</span>
                            </EvidenceRow>
                          ) : null}
                          <EvidenceRow label={t('workspaceImportReview.destinationPath')} code>
                            {collision.path}
                          </EvidenceRow>
                          <EvidenceRow label={t('workspaceImportReview.incomingHash')} code>
                            {collision.incomingHash}
                          </EvidenceRow>
                          <EvidenceRow label={t('workspaceImportReview.existingHash')} code>
                            {collision.existingHash}
                          </EvidenceRow>
                          <EvidenceRow label={t('workspaceImportReview.suggestedKeepBoth')} code>
                            {collision.suggestedKeepBothPath}
                          </EvidenceRow>
                        </dl>
                        {collision.identical ? (
                          <p className="workspace-import-review__identical">
                            {t('workspaceImportReview.identical')}
                          </p>
                        ) : null}
                        {review.keepBothRestriction ? (
                          <p
                            id={restrictionId}
                            className="workspace-import-review__restriction"
                            role="note"
                          >
                            {review.keepBothRestriction}
                          </p>
                        ) : null}
                        <div className="workspace-import-review__field">
                          <label htmlFor={decisionId}>{t('workspaceImportReview.decision')}</label>
                          <select
                            id={decisionId}
                            value={selectedAction}
                            disabled={busy || collision.identical}
                            required={!collision.identical}
                            aria-describedby={
                              review.keepBothRestriction ? restrictionId : undefined
                            }
                            onChange={(event) =>
                              setDecision(
                                review,
                                event.target.value as
                                  '' | WorkspaceImportCollisionDecision['action']
                              )
                            }
                          >
                            {!collision.identical ? (
                              <option value="" disabled>
                                {t('workspaceImportReview.decision.choose')}
                              </option>
                            ) : null}
                            <option value="replace">
                              {t('workspaceImportReview.decision.replace')}
                            </option>
                            <option value="skip">{t('workspaceImportReview.decision.skip')}</option>
                            <option value="keep-both" disabled={!review.keepBothAllowed}>
                              {t('workspaceImportReview.decision.keepBoth')}
                            </option>
                          </select>
                        </div>
                        {decision?.action === 'keep-both' ? (
                          <div className="workspace-import-review__field">
                            <label htmlFor={pathId}>
                              {t('workspaceImportReview.keepBothDestination')}
                            </label>
                            <input
                              id={pathId}
                              type="text"
                              dir="ltr"
                              value={review.keepBothPath}
                              disabled={busy || !review.keepBothAllowed}
                              aria-invalid={Boolean(review.keepBothError)}
                              aria-describedby={review.keepBothError ? pathErrorId : undefined}
                              onChange={(event) => {
                                const destinationPath = event.target.value
                                setKeepBothPaths((previous) => ({
                                  ...previous,
                                  [collision.artifactId]: destinationPath
                                }))
                                onDecision(collision.artifactId, {
                                  action: 'keep-both',
                                  destinationPath
                                })
                              }}
                            />
                            {review.keepBothError ? (
                              <p
                                id={pathErrorId}
                                className="workspace-import-review__field-error"
                                role="alert"
                              >
                                {review.keepBothError}
                              </p>
                            ) : null}
                          </div>
                        ) : null}
                      </li>
                    )
                  })}
              </ol>
              <PaginationControls
                label={t('workspaceImportReview.collisions')}
                total={reviews.length}
                window={collisionWindow}
                controls="workspace-import-review-collision-list"
              />
            </>
          )}
        </section>

        {error ? (
          <div className="workspace-import-review__error-container">
            <div className="workspace-import-review__error" role="alert" aria-live="assertive">
              <strong>{t('workspaceImportReview.error')}</strong>
              <span>{t('workspaceImportReview.errorSummary')}</span>
            </div>
            {applyTechnicalEvidence ? (
              <details className="workspace-import-review__technical-evidence">
                <summary>{t('workspaceImportReview.technicalEvidence')}</summary>
                {applyTechnicalEvidence.truncated ? (
                  <p data-workspace-import-technical-truncation>
                    {t('workspaceImportReview.technicalEvidenceTruncated', {
                      limit: WORKSPACE_IMPORT_TECHNICAL_DETAIL_MAX_CODE_POINTS
                    })}
                  </p>
                ) : null}
                <code dir="auto" data-workspace-import-apply-technical-diagnostic>
                  {applyTechnicalEvidence.text}
                </code>
              </details>
            ) : null}
          </div>
        ) : null}
      </div>

      <footer className="workspace-import-review__footer">
        <p
          id="workspace-import-review-state"
          className={
            confirmDisabled && !busy
              ? 'workspace-import-review__review-state workspace-import-review__review-state--blocked'
              : 'workspace-import-review__review-state'
          }
          role={confirmDisabled && !busy ? 'alert' : 'status'}
          aria-live="polite"
        >
          {busy ? t('workspaceImportReview.busy') : statusMessage}
        </p>
        <div className="workspace-import-review__actions">
          <button
            type="button"
            className="orbitpm-lite-chrome-btn"
            disabled={busy}
            onClick={onCancel}
          >
            {t('workspaceImportReview.cancel')}
          </button>
          <button
            type="button"
            className="orbitpm-lite-primary"
            disabled={confirmDisabled}
            onClick={() => {
              if (!confirmDisabled) onConfirm()
            }}
          >
            {busy ? t('workspaceImportReview.confirming') : t('workspaceImportReview.confirm')}
          </button>
        </div>
      </footer>
    </AccessibleDialog>
  )
}

/**
 * Read-only review UI for a sealed WorkspaceImportPlan. It only reports
 * collision decisions and explicit confirmation/cancellation through
 * callbacks; filesystem mutation remains owned by the transaction caller.
 */
export function WorkspaceImportReviewDialog(props: WorkspaceImportReviewDialogProps): JSX.Element {
  const lang = useLang()
  return <WorkspaceImportReviewDialogBody key={props.plan.reviewDigest} {...props} lang={lang} />
}

export default WorkspaceImportReviewDialog
