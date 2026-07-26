import { useEffect, useRef } from 'react'
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

const focusableSelector =
  'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function DraftRecoveryDialog({
  lang,
  title,
  comparison,
  onDecision,
  onDownload
}: DraftRecoveryDialogProps): JSX.Element {
  const overlayRef = useRef<HTMLDivElement | null>(null)
  const panelRef = useRef<HTMLElement | null>(null)
  const restoreRef = useRef<HTMLButtonElement | null>(null)
  const ar = lang === 'ar'
  const locale = ar ? 'ar-AE' : 'en'
  const timestamp = new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(comparison.draft.timestamp))
  const relation = t(`draftRecovery.relation.${comparison.relation}` as Key)

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null
    const panel = panelRef.current
    const overlay = overlayRef.current
    const background = Array.from(overlay?.parentElement?.children ?? []).filter(
      (node): node is HTMLElement => node instanceof HTMLElement && node !== overlay
    )
    for (const node of background) node.inert = true
    restoreRef.current?.focus()

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Tab' || !panel) return
      const candidates = Array.from(panel.querySelectorAll<HTMLElement>(focusableSelector)).filter(
        (element) => !element.hidden && element.getClientRects().length > 0
      )
      if (candidates.length === 0) return
      const first = candidates[0]!
      const last = candidates.at(-1)!
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      for (const node of background) node.inert = false
      previouslyFocused?.focus()
    }
  }, [])

  return (
    <div
      ref={overlayRef}
      role="presentation"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10040,
        display: 'grid',
        placeItems: 'center',
        padding: 16,
        background: 'rgba(0,0,0,0.58)'
      }}
    >
      <section
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="draft-recovery-title"
        aria-describedby="draft-recovery-summary"
        dir={ar ? 'rtl' : 'ltr'}
        style={{
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
      </section>
    </div>
  )
}

export default DraftRecoveryDialog
