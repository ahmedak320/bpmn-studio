import { useMemo, useRef, useState } from 'react'
import { AccessibleDialog } from '../common/AccessibleDialog'
import { t, type Lang } from '../i18n'
import { useLang } from '../i18n/useLang'
import type {
  WorkspaceBackupCollisionDecision,
  WorkspaceBackupImportCandidate,
  WorkspaceBackupImportPlan,
  WorkspaceBackupReviewedBpmn
} from './adapters'
import './BackupImportDialog.css'

export interface BackupImportDialogProps {
  plan: WorkspaceBackupImportPlan
  busy?: boolean
  onApply: (decisions: Readonly<Record<string, WorkspaceBackupCollisionDecision>>) => void
  onCancel: () => void
}

type ReviewedCandidate = WorkspaceBackupImportCandidate & {
  readonly reviewedBpmn: WorkspaceBackupReviewedBpmn
}

function isReviewedCandidate(
  candidate: WorkspaceBackupImportCandidate
): candidate is ReviewedCandidate {
  return candidate.reviewedBpmn !== undefined
}

function CodeList({ values }: { values: readonly string[] }): JSX.Element {
  if (values.length === 0) {
    return <span>{t('workspace.storage.backupReview.none')}</span>
  }
  return (
    <ul className="backup-import-dialog__code-list">
      {values.map((value) => (
        <li key={value}>
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
      <dd>{code ? <code dir="ltr">{children}</code> : children}</dd>
    </>
  )
}

function reviewModeLabel(reviewed: WorkspaceBackupReviewedBpmn): string {
  return reviewed.evidence.reviewMode === 'automatic-complete'
    ? t('workspace.storage.backupReview.mode.automatic')
    : t('workspace.storage.backupReview.mode.explicit')
}

function targetLanguageLabel(reviewed: WorkspaceBackupReviewedBpmn): string {
  return reviewed.evidence.target === 'ar'
    ? t('workspace.storage.backupReview.target.ar')
    : t('workspace.storage.backupReview.target.en')
}

function BackupImportDialogBody({
  plan,
  busy = false,
  onApply,
  onCancel,
  lang
}: BackupImportDialogProps & { lang: Lang }): JSX.Element {
  const titleRef = useRef<HTMLHeadingElement>(null)
  const initial = useMemo(
    () =>
      Object.fromEntries(plan.collisions.map((collision) => [collision.path, 'skip'])) as Record<
        string,
        'replace' | 'skip' | 'keep-both'
      >,
    [plan]
  )
  const [actions, setActions] = useState(initial)
  const decisions = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(actions).map(([path, action]) => [
          path,
          { action } satisfies WorkspaceBackupCollisionDecision
        ])
      ),
    [actions]
  )
  const reviewedCandidates = useMemo(() => plan.files.filter(isReviewedCandidate), [plan.files])
  const candidatesByPath = useMemo(
    () => new Map(plan.files.map((candidate) => [candidate.path, candidate])),
    [plan.files]
  )

  return (
    <AccessibleDialog
      ariaLabelledby="backup-import-title"
      ariaDescribedby="backup-import-intro"
      initialFocusRef={titleRef}
      onClose={onCancel}
      closeOnEscape={!busy}
      closeOnBackdrop={false}
      backdropClassName="backup-import-dialog__backdrop"
      dialogClassName="backup-import-dialog"
      dir={lang === 'ar' ? 'rtl' : 'ltr'}
    >
      <header className="backup-import-dialog__header">
        <h2 id="backup-import-title" ref={titleRef} tabIndex={-1}>
          {t('workspace.storage.collisionReview')}
        </h2>
        <p id="backup-import-intro">{t('workspace.storage.backupReview.intro')}</p>
      </header>

      <div className="backup-import-dialog__body">
        <section aria-labelledby="backup-import-plan-title">
          <h3 id="backup-import-plan-title">{t('workspace.storage.backupReview.sealedPlan')}</h3>
          <p className="backup-import-dialog__summary">
            {t('workspace.storage.backupReview.summary', {
              files: plan.files.length,
              size: Math.round(plan.declaredUncompressedBytes / 1024)
            })}{' '}
            <span dir="ltr">KiB</span>
          </p>
          <dl className="backup-import-dialog__evidence">
            <EvidenceRow label={t('workspace.storage.backupReview.planReviewDigest')} code>
              {plan.reviewDigest}
            </EvidenceRow>
          </dl>
        </section>

        <section aria-labelledby="backup-import-localization-title">
          <h3 id="backup-import-localization-title">
            {t('workspace.storage.backupReview.localizationTitle')}
          </h3>
          <p>{t('workspace.storage.backupReview.localizationIntro')}</p>
          {reviewedCandidates.length === 0 ? (
            <p className="backup-import-dialog__empty">
              {t('workspace.storage.backupReview.localizationNone')}
            </p>
          ) : (
            <ol className="backup-import-dialog__cards">
              {reviewedCandidates.map((candidate, index) => {
                const reviewed = candidate.reviewedBpmn
                return (
                  <li key={candidate.path} className="backup-import-dialog__card">
                    <h4>{t('workspace.storage.backupReview.file', { index: index + 1 })}</h4>
                    <dl className="backup-import-dialog__evidence">
                      <EvidenceRow label={t('workspace.storage.backupReview.path')} code>
                        {candidate.path}
                      </EvidenceRow>
                      <EvidenceRow label={t('workspace.storage.backupReview.mode')}>
                        {reviewModeLabel(reviewed)}
                      </EvidenceRow>
                      <EvidenceRow label={t('workspace.storage.backupReview.target')}>
                        {targetLanguageLabel(reviewed)}
                      </EvidenceRow>
                      <EvidenceRow
                        label={t('workspace.storage.backupReview.localizationReviewDigest')}
                        code
                      >
                        {reviewed.reviewDigest}
                      </EvidenceRow>
                      <EvidenceRow label={t('workspace.storage.backupReview.outputDigest')} code>
                        {reviewed.outputDigest}
                      </EvidenceRow>
                      <EvidenceRow label={t('workspace.storage.backupReview.processIds')}>
                        <CodeList values={reviewed.processIds} />
                      </EvidenceRow>
                      <EvidenceRow label={t('workspace.storage.backupReview.replacesProcessIds')}>
                        <CodeList values={reviewed.replacesProcessIds} />
                      </EvidenceRow>
                      <EvidenceRow label={t('workspace.storage.backupReview.audit')}>
                        {t('workspace.storage.backupReview.auditSummary', {
                          initial: reviewed.evidence.initialAudit.issues.length,
                          final: reviewed.evidence.finalAudit.issues.length
                        })}
                      </EvidenceRow>
                      <EvidenceRow label={t('workspace.storage.backupReview.patches')}>
                        <span dir="ltr">{reviewed.evidence.appliedPatches.changed}</span>
                      </EvidenceRow>
                    </dl>
                    <p className="backup-import-dialog__verified">
                      {t('workspace.storage.backupReview.verified')}
                    </p>
                  </li>
                )
              })}
            </ol>
          )}
        </section>

        {plan.collisions.length > 0 ? (
          <section aria-labelledby="backup-import-collisions-title">
            <h3 id="backup-import-collisions-title">
              {t('workspace.storage.backupReview.collisions')}
            </h3>
            <div className="backup-import-dialog__collisions">
              {plan.collisions.map((collision, index) => {
                const candidate = candidatesByPath.get(collision.path)
                const replacesProcessIds = candidate?.reviewedBpmn?.replacesProcessIds ?? []
                const keepBothDisabled = replacesProcessIds.length > 0
                const selectId = `backup-import-collision-${index}`
                const selectLabelId = `${selectId}-label`
                const pathId = `${selectId}-path`
                const restrictionId = `${selectId}-restriction`
                return (
                  <article key={collision.path} className="backup-import-dialog__collision">
                    <div className="backup-import-dialog__collision-summary">
                      <strong>
                        <code id={pathId} dir="ltr">
                          {collision.path}
                        </code>
                      </strong>
                      <small>
                        <code dir="ltr">
                          {collision.incomingHash.slice(0, 12)} ↔{' '}
                          {collision.existing.hash.slice(0, 12)}
                        </code>
                        {collision.identical
                          ? ` · ${t('workspace.storage.collisionIdentical')}`
                          : ''}
                      </small>
                    </div>
                    <div className="backup-import-dialog__field">
                      <label id={selectLabelId} htmlFor={selectId}>
                        {t('workspace.storage.backupReview.collisionDecision')}
                      </label>
                      <select
                        id={selectId}
                        value={actions[collision.path]}
                        disabled={busy || collision.identical}
                        aria-labelledby={`${selectLabelId} ${pathId}`}
                        aria-describedby={keepBothDisabled ? restrictionId : undefined}
                        onChange={(event) => {
                          const action = event.target.value as 'replace' | 'skip' | 'keep-both'
                          setActions((previous) => ({
                            ...previous,
                            [collision.path]: action
                          }))
                        }}
                      >
                        <option value="skip">{t('workspace.storage.collisionSkip')}</option>
                        <option value="replace">{t('workspace.storage.collisionReplace')}</option>
                        <option value="keep-both" disabled={keepBothDisabled}>
                          {t('workspace.storage.collisionKeepBoth')}
                        </option>
                      </select>
                    </div>
                    {keepBothDisabled ? (
                      <p id={restrictionId} className="backup-import-dialog__restriction">
                        {t('workspace.storage.backupReview.keepBothIdentityDisabled')}{' '}
                        <span className="backup-import-dialog__inline-codes">
                          {replacesProcessIds.map((processId) => (
                            <code key={processId} dir="ltr">
                              {processId}
                            </code>
                          ))}
                        </span>
                      </p>
                    ) : null}
                  </article>
                )
              })}
            </div>
          </section>
        ) : null}
      </div>

      <footer className="backup-import-dialog__footer">
        <button
          type="button"
          className="orbitpm-lite-chrome-btn"
          disabled={busy}
          onClick={onCancel}
        >
          {t('modal.cancel')}
        </button>
        <button
          type="button"
          className="orbitpm-lite-primary"
          disabled={busy}
          onClick={() => onApply(decisions)}
        >
          {t('workspace.storage.backupApply')}
        </button>
      </footer>
    </AccessibleDialog>
  )
}

export function BackupImportDialog(props: BackupImportDialogProps): JSX.Element {
  const lang = useLang()
  return <BackupImportDialogBody key={props.plan.reviewDigest} {...props} lang={lang} />
}
