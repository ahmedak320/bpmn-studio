import { useMemo, useRef, useState } from 'react'
import { AccessibleDialog } from '../common/AccessibleDialog'
import { t, type Lang } from '../i18n'
import { useLang } from '../i18n/useLang'
import { normalizeWorkspacePath } from './adapters/path'
import type {
  WorkspaceImportArtifact,
  WorkspaceImportCollision,
  WorkspaceImportCollisionDecision,
  WorkspaceImportPlan
} from './importTransaction'
import { isReservedOrbitPmPath } from './processIdentity'
import './WorkspaceImportReviewDialog.css'

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

function sourceNameFor(plan: WorkspaceImportPlan, sourceId: string): string | undefined {
  return (
    plan.artifacts.find((artifact) => artifact.sourceId === sourceId)?.sourceName ??
    plan.skipped.find((item) => item.sourceId === sourceId)?.sourceName ??
    plan.arisReports.find((evidence) => evidence.sourceId === sourceId)?.sourceName
  )
}

function exactList(values: readonly string[]): JSX.Element {
  if (values.length === 0) return <span>{t('workspaceImportReview.none')}</span>
  return (
    <ul className="workspace-import-review__exact-list">
      {values.map((value, index) => (
        <li key={`${value}-${index}`}>
          <code dir="ltr">{value}</code>
        </li>
      ))}
    </ul>
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
  const unresolved = reviews.filter(
    ({ collision, decision }) => !collision.identical && decision === undefined
  ).length
  const invalidKeepBoth = reviews.some(
    ({ decision, keepBothError }) => decision?.action === 'keep-both' && keepBothError
  )
  const reservedPlanDestination = planHasReservedDestination(plan)
  const confirmDisabled =
    busy ||
    plan.status === 'blocked' ||
    unresolved > 0 ||
    invalidKeepBoth ||
    reservedPlanDestination
  const statusMessage = reservedPlanDestination
    ? t('workspaceImportReview.reservedPlanDestination')
    : plan.status === 'blocked'
      ? t('workspaceImportReview.blocked')
      : unresolved > 0
        ? t('workspaceImportReview.unresolved', { count: unresolved })
        : invalidKeepBoth
          ? t('workspaceImportReview.invalidDecision')
          : t('workspaceImportReview.ready')

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
      onClose={onCancel}
      closeOnEscape
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
            <ol className="workspace-import-review__cards">
              {plan.artifacts.map((artifact, index) => (
                <li key={artifact.id} className="workspace-import-review__card">
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
                      {exactList(artifact.processIds)}
                    </EvidenceRow>
                    <EvidenceRow label={t('workspaceImportReview.replacesProcessIds')}>
                      {exactList(artifact.replacesProcessIds)}
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
              ))}
            </ol>
          )}
        </section>

        <section aria-labelledby="workspace-import-review-skipped">
          <h3 id="workspace-import-review-skipped">{t('workspaceImportReview.skipped')}</h3>
          {plan.skipped.length === 0 ? (
            <EmptyEvidence />
          ) : (
            <ol className="workspace-import-review__cards">
              {plan.skipped.map((item, index) => (
                <li
                  key={`${item.sourceId}-${item.path ?? ''}-${item.reason}-${index}`}
                  className="workspace-import-review__card"
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
                    <EvidenceRow label={t('workspaceImportReview.reason')} code>
                      {item.reason}
                    </EvidenceRow>
                    <EvidenceRow label={t('workspaceImportReview.message')}>
                      <span dir="auto">{item.message}</span>
                    </EvidenceRow>
                  </dl>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section aria-labelledby="workspace-import-review-warnings">
          <h3 id="workspace-import-review-warnings">{t('workspaceImportReview.warnings')}</h3>
          {plan.warnings.length === 0 ? (
            <EmptyEvidence />
          ) : (
            <ol className="workspace-import-review__cards">
              {plan.warnings.map((warning, index) => (
                <li
                  key={`${warning.sourceId}-${warning.artifactId ?? ''}-${warning.code}-${index}`}
                  className="workspace-import-review__card"
                >
                  <h4>{t('workspaceImportReview.warningItem', { index: index + 1 })}</h4>
                  <dl className="workspace-import-review__evidence">
                    {sourceNameFor(plan, warning.sourceId) ? (
                      <EvidenceRow label={t('workspaceImportReview.sourceName')}>
                        <span dir="auto">{sourceNameFor(plan, warning.sourceId)}</span>
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
                    <EvidenceRow label={t('workspaceImportReview.code')} code>
                      {warning.code}
                    </EvidenceRow>
                    {warning.count !== undefined ? (
                      <EvidenceRow label={t('workspaceImportReview.count')}>
                        <span dir="ltr">{String(warning.count)}</span>
                      </EvidenceRow>
                    ) : null}
                    <EvidenceRow label={t('workspaceImportReview.message')}>
                      <span dir="auto">{warning.message}</span>
                    </EvidenceRow>
                    {warning.validationIssue ? (
                      <EvidenceRow label={t('workspaceImportReview.validationIssue')}>
                        <span dir="auto">
                          <code dir="ltr">{warning.validationIssue.code}</code>
                          {' · '}
                          <code dir="ltr">{warning.validationIssue.severity}</code>
                          {' · '}
                          <code dir="ltr">{warning.validationIssue.source}</code>
                          {' · '}
                          {warning.validationIssue.message}
                        </span>
                      </EvidenceRow>
                    ) : null}
                  </dl>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section aria-labelledby="workspace-import-review-repairs">
          <h3 id="workspace-import-review-repairs">{t('workspaceImportReview.repairs')}</h3>
          {plan.repairs.length === 0 ? (
            <EmptyEvidence />
          ) : (
            <ol className="workspace-import-review__cards">
              {plan.repairs.map((repair, index) => (
                <li
                  key={`${repair.sourceId}-${repair.artifactId}-${repair.code}-${index}`}
                  className="workspace-import-review__card"
                >
                  <h4>{t('workspaceImportReview.repairItem', { index: index + 1 })}</h4>
                  <dl className="workspace-import-review__evidence">
                    {sourceNameFor(plan, repair.sourceId) ? (
                      <EvidenceRow label={t('workspaceImportReview.sourceName')}>
                        <span dir="auto">{sourceNameFor(plan, repair.sourceId)}</span>
                      </EvidenceRow>
                    ) : null}
                    <EvidenceRow label={t('workspaceImportReview.sourceId')} code>
                      {repair.sourceId}
                    </EvidenceRow>
                    <EvidenceRow label={t('workspaceImportReview.artifactId')} code>
                      {repair.artifactId}
                    </EvidenceRow>
                    <EvidenceRow label={t('workspaceImportReview.code')} code>
                      {repair.code}
                    </EvidenceRow>
                    <EvidenceRow label={t('workspaceImportReview.message')}>
                      <span dir="auto">{repair.message}</span>
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
              ))}
            </ol>
          )}
        </section>

        <section aria-labelledby="workspace-import-review-aris">
          <h3 id="workspace-import-review-aris">{t('workspaceImportReview.aris')}</h3>
          {plan.arisReports.length === 0 ? (
            <EmptyEvidence />
          ) : (
            <ol className="workspace-import-review__cards">
              {plan.arisReports.map((evidence, index) => (
                <li key={`${evidence.sourceId}-${index}`} className="workspace-import-review__card">
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
              ))}
            </ol>
          )}
        </section>

        <section aria-labelledby="workspace-import-review-collisions">
          <h3 id="workspace-import-review-collisions">{t('workspaceImportReview.collisions')}</h3>
          {reviews.length === 0 ? (
            <EmptyEvidence />
          ) : (
            <ol className="workspace-import-review__cards">
              {reviews.map((review, index) => {
                const { collision, artifact, decision } = review
                const decisionId = `workspace-import-decision-${index}`
                const pathId = `workspace-import-keep-both-${index}`
                const pathErrorId = `${pathId}-error`
                const restrictionId = `${decisionId}-restriction`
                const selectedAction = collision.identical ? 'skip' : (decision?.action ?? '')
                return (
                  <li key={collision.artifactId} className="workspace-import-review__card">
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
                        aria-describedby={review.keepBothRestriction ? restrictionId : undefined}
                        onChange={(event) =>
                          setDecision(
                            review,
                            event.target.value as '' | WorkspaceImportCollisionDecision['action']
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
          )}
        </section>

        {error ? (
          <div className="workspace-import-review__error" role="alert" aria-live="assertive">
            <strong>{t('workspaceImportReview.error')}</strong>
            <span dir="auto">{error}</span>
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
          <button type="button" className="orbitpm-lite-chrome-btn" onClick={onCancel}>
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
