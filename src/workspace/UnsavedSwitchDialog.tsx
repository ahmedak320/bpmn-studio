import { Modal } from './Modal'
import { t } from '../i18n'
import { useLang } from '../i18n/useLang'

export interface UnsavedSwitchDialogProps {
  /** How many open diagrams have unsaved changes. */
  count: number
  onSaveAll: () => void
  onDiscard: () => void
  onCancel: () => void
}

/**
 * Shown once when the user switches to a different workspace folder while open
 * diagrams still hold unsaved changes (Codex CRITICAL-1). The switch fully
 * resets state, so we must give the user an explicit save-all / discard / cancel
 * choice before their work is dropped — never silently.
 */
export function UnsavedSwitchDialog({
  count,
  onSaveAll,
  onDiscard,
  onCancel
}: UnsavedSwitchDialogProps): JSX.Element {
  useLang()
  return (
    <Modal
      title={t('confirm.switch.title')}
      onClose={onCancel}
      maxWidth={480}
      footer={
        <>
          <button type="button" className="orbitpm-lite-chrome-btn" onClick={onCancel}>
            {t('confirm.switch.cancel')}
          </button>
          <button
            type="button"
            className="orbitpm-lite-chrome-btn"
            onClick={onDiscard}
            style={{ color: '#d0473f', borderColor: '#d0473f' }}
          >
            {t('confirm.switch.discard')}
          </button>
          <button
            type="button"
            className="orbitpm-lite-chrome-btn"
            onClick={onSaveAll}
            style={{
              fontWeight: 600,
              background: 'var(--orbitpm-accent)',
              color: '#fff',
              borderColor: 'var(--orbitpm-accent)'
            }}
          >
            {t('confirm.switch.saveAll')}
          </button>
        </>
      }
    >
      <div style={{ fontSize: 13.5, lineHeight: 1.55 }}>{t('confirm.switch.body', { count })}</div>
    </Modal>
  )
}

export default UnsavedSwitchDialog
