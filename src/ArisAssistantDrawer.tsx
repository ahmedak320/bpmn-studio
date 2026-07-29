import type { ArisAnswerChip } from './aris/assistant/answer'
import type { ArisProcessDigest } from './aris/assistant/types'
import { ArisAssistantPanel } from './aris/shell/ArisAssistantPanel'
import { AccessibleDialog } from './common/AccessibleDialog'
import { t } from './i18n'
import { useLang } from './i18n/useLang'

export interface ArisAssistantDrawerProps {
  open: boolean
  onClose: () => void
  onOpenSettings: () => void
  onChangeWorkspace?: () => void
  activeTabTitle?: string | null
  activeSourceKindLabel?: string | null
  workspaceLabel: string
  sourceCount: number
  openTabCount: number
  /**
   * Section 17.1 digests for every indexed source. Empty is valid — the panel
   * then answers "no processes are indexed yet" rather than pretending.
   */
  digests?: readonly ArisProcessDigest[]
  /** Reveal a chip's element on the canvas (§17.6). */
  onOpenChip?: (chip: ArisAnswerChip) => boolean
}

export function ArisAssistantDrawer({
  open,
  onClose,
  onOpenSettings,
  onChangeWorkspace,
  activeTabTitle,
  activeSourceKindLabel,
  workspaceLabel,
  sourceCount,
  openTabCount,
  digests = [],
  onOpenChip
}: ArisAssistantDrawerProps): JSX.Element | null {
  const lang = useLang()
  const dir: 'ltr' | 'rtl' = lang === 'ar' ? 'rtl' : 'ltr'

  if (!open) return null

  return (
    <AccessibleDialog
      ariaLabel={t('assist.title')}
      onClose={onClose}
      closeOnEscape
      closeOnBackdrop
      dir={dir}
      backdropStyle={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.44)',
        display: 'grid',
        placeItems: 'center',
        zIndex: 1000,
        padding: '1rem'
      }}
      dialogStyle={{
        width: 'min(760px, 100%)',
        maxHeight: 'min(88vh, 900px)',
        overflow: 'auto',
        borderRadius: 16,
        border: '1px solid var(--orbitpm-border)',
        background: 'var(--orbitpm-panel-bg, var(--orbitpm-bg))',
        color: 'inherit',
        boxShadow: '0 18px 54px rgba(0, 0, 0, 0.28)'
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 12,
          padding: '0.9rem 1rem',
          borderBottom: '1px solid var(--orbitpm-border)'
        }}
      >
        <strong style={{ fontSize: 14 }}>{t('assist.title')}</strong>
        <button
          type="button"
          className="orbitpm-lite-chrome-btn"
          aria-label={t('assist.close')}
          onClick={onClose}
        >
          ×
        </button>
      </div>

      <div style={{ display: 'grid', gap: 14, padding: '1rem' }}>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--orbitpm-muted)', lineHeight: 1.6 }}>
          {t('aris.assistant.body')}
        </p>

        <section
          style={{
            border: '1px solid var(--orbitpm-border)',
            borderRadius: 12,
            padding: '0.9rem 1rem',
            background: 'var(--orbitpm-panel-bg, var(--orbitpm-bg))'
          }}
        >
          <h3 style={{ margin: '0 0 10px', fontSize: 14 }}>{t('aris.assistant.workspace')}</h3>
          <dl
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(120px, 0.75fr) minmax(0, 1fr)',
              gap: '6px 10px',
              margin: 0,
              fontSize: 13
            }}
          >
            <dt style={{ color: 'var(--orbitpm-muted)' }}>{t('aris.assistant.root')}</dt>
            <dd style={{ margin: 0, overflowWrap: 'anywhere' }}>{workspaceLabel}</dd>
            <dt style={{ color: 'var(--orbitpm-muted)' }}>{t('aris.assistant.sources')}</dt>
            <dd style={{ margin: 0 }}>{sourceCount}</dd>
            <dt style={{ color: 'var(--orbitpm-muted)' }}>{t('aris.assistant.tabs')}</dt>
            <dd style={{ margin: 0 }}>{openTabCount}</dd>
            <dt style={{ color: 'var(--orbitpm-muted)' }}>{t('aris.assistant.activeTab')}</dt>
            <dd style={{ margin: 0 }}>{activeTabTitle ?? t('aris.assistant.none')}</dd>
            <dt style={{ color: 'var(--orbitpm-muted)' }}>{t('aris.assistant.activeKind')}</dt>
            <dd style={{ margin: 0 }}>{activeSourceKindLabel ?? t('aris.assistant.none')}</dd>
          </dl>
        </section>

        <ArisAssistantPanel
          digests={digests}
          lang={lang}
          onOpenChip={(chip) => onOpenChip?.(chip) ?? false}
        />

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <button type="button" className="orbitpm-lite-chrome-btn" onClick={onOpenSettings}>
            {t('app.settings')}
          </button>
          {onChangeWorkspace && (
            <button type="button" className="orbitpm-lite-chrome-btn" onClick={onChangeWorkspace}>
              {t('app.changeFolder')}
            </button>
          )}
          <button type="button" className="orbitpm-lite-primary" onClick={onClose}>
            {t('assist.close')}
          </button>
        </div>
      </div>
    </AccessibleDialog>
  )
}

export default ArisAssistantDrawer
