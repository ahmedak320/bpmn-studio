import { useRef } from 'react'
import { AccessibleDialog } from '../common/AccessibleDialog'
import { t, type Key } from '../i18n'
import type { DraftRecoveryComparison } from './draftJournal'

export type DraftRecoveryDecision = 'restore' | 'discard'

export interface DraftRecoveryDialogProps {
  lang: 'en' | 'ar'
  title: string
  comparison: DraftRecoveryComparison
  onDecision: (decision: DraftRecoveryDecision) => void
  onDownload: () => void
}

export function DraftRecoveryDialog({
  lang,
  title,
  comparison,
  onDecision,
  onDownload
}: DraftRecoveryDialogProps): JSX.Element {
  const restoreRef = useRef<HTMLButtonElement | null>(null)
  const ar = lang === 'ar'
  const locale = ar ? 'ar-AE' : 'en'
  const timestamp = new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(comparison.draft.timestamp))
  const relation = t(`draftRecovery.relation.${comparison.relation}` as Key)

  return (
    <AccessibleDialog
      ariaLabelledby="draft-recovery-title"
      ariaDescribedby="draft-recovery-summary"
      closeOnEscape={false}
      closeOnBackdrop={false}
      initialFocusRef={restoreRef}
      dir={ar ? 'rtl' : 'ltr'}
      backdropStyle={{
        position: 'fixed',
        inset: 0,
        zIndex: 10040,
        display: 'grid',
        placeItems: 'center',
        padding: 16,
        background: 'rgba(0,0,0,0.58)'
      }}
      dialogStyle={{
        width: 'min(1040px, 96vw)',
        maxHeight: '92dvh',
        overflow: 'auto',
        padding: 18,
        border: '1px solid var(--orbitpm-border)',
        borderRadius: 12,
        background: 'var(--orbitpm-panel-bg, var(--orbitpm-bg))',
        color: 'var(--orbitpm-fg)',
        boxShadow: '0 24px 70px rgba(0,0,0,0.4)'
      }}
    >
      <h2 id="draft-recovery-title" style={{ margin: 0, fontSize: 19 }}>
        {t('draftRecovery.title')}
      </h2>
      <p id="draft-recovery-summary" style={{ color: 'var(--orbitpm-muted)' }}>
        {t('draftRecovery.summary', { title, timestamp, relation })}
      </p>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))',
          gap: 12
        }}
      >
        <section aria-labelledby="draft-recovery-saved">
          <h3 id="draft-recovery-saved" style={{ fontSize: 15 }}>
            {t('draftRecovery.saved')}
          </h3>
          <pre
            dir="ltr"
            style={{
              maxHeight: 330,
              overflow: 'auto',
              whiteSpace: 'pre-wrap',
              textAlign: 'left',
              padding: 12,
              border: '1px solid var(--orbitpm-border)',
              borderRadius: 8,
              background: 'rgba(127,127,127,0.08)',
              fontSize: 11
            }}
          >
            {comparison.loadedXml}
          </pre>
        </section>
        <section aria-labelledby="draft-recovery-draft">
          <h3 id="draft-recovery-draft" style={{ fontSize: 15 }}>
            {t('draftRecovery.draft')}
          </h3>
          <pre
            dir="ltr"
            style={{
              maxHeight: 330,
              overflow: 'auto',
              whiteSpace: 'pre-wrap',
              textAlign: 'left',
              padding: 12,
              border: '1px solid var(--orbitpm-border)',
              borderRadius: 8,
              background: 'rgba(127,127,127,0.08)',
              fontSize: 11
            }}
          >
            {comparison.draft.xml}
          </pre>
        </section>
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          flexWrap: 'wrap',
          gap: 8,
          marginTop: 16
        }}
      >
        <button type="button" className="orbitpm-lite-chrome-btn" onClick={onDownload}>
          {t('draftRecovery.download')}
        </button>
        <button
          type="button"
          className="orbitpm-lite-chrome-btn"
          onClick={() => onDecision('discard')}
        >
          {t('draftRecovery.discard')}
        </button>
        <button
          ref={restoreRef}
          type="button"
          className="orbitpm-lite-primary"
          onClick={() => onDecision('restore')}
        >
          {t('draftRecovery.restore')}
        </button>
      </div>
    </AccessibleDialog>
  )
}

export default DraftRecoveryDialog
