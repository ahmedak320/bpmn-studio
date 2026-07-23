import { useState, type CSSProperties } from 'react'
import { Modal } from '../workspace/Modal'
import { t } from '../i18n'
import { useLang } from '../i18n/useLang'
import type { ProposedLink } from './browserAi'

export interface LinkVerifyDialogProps {
  /** Low-confidence links to known processes — user opts each in/out (default in). */
  unsure: ProposedLink[]
  /** Links whose target process is unknown — shown disabled, always stay unlinked. */
  unmatched: ProposedLink[]
  /** Resolve a BPMN process id to its display name. */
  resolveProcessName: (id: string) => string
  /** Confirm with the set of CHECKED (kept) elementIds. */
  onConfirm: (acceptedElementIds: Set<string>) => void
  onCancel: () => void
}

/**
 * Modal that lets the user vet the AI's uncertain link proposals before the
 * diagram is placed. Unsure rows default to checked (keep the link); unmatched
 * rows are shown disabled (no target process exists, so they stay unlinked).
 */
export function LinkVerifyDialog({
  unsure,
  unmatched,
  resolveProcessName,
  onConfirm,
  onCancel
}: LinkVerifyDialogProps): JSX.Element {
  useLang()
  const [checked, setChecked] = useState<Set<string>>(
    () => new Set(unsure.map((l) => l.elementId))
  )

  const toggle = (id: string): void => {
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const footer = (
    <>
      <button type="button" onClick={onCancel} style={ghostBtn}>
        {t('ai.linkVerify.cancel')}
      </button>
      <button
        type="button"
        onClick={() => onConfirm(new Set(checked))}
        className="orbitpm-lite-primary"
        style={{ fontSize: 13 }}
      >
        {t('ai.linkVerify.confirm')}
      </button>
    </>
  )

  return (
    <Modal
      title={t('ai.linkVerify.title')}
      ariaLabel={t('ai.linkVerify.title')}
      onClose={onCancel}
      footer={footer}
    >
      <p style={{ marginTop: 0, fontSize: 13, lineHeight: 1.5 }}>{t('ai.linkVerify.intro')}</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {unsure.map((link) => (
          <label key={link.elementId} style={rowStyle}>
            <input
              type="checkbox"
              checked={checked.has(link.elementId)}
              onChange={() => toggle(link.elementId)}
              style={{ marginBlockStart: 3 }}
            />
            <span style={{ minWidth: 0 }}>
              <span dir="auto">
                «{link.label}» → {resolveProcessName(link.calledProcess)}
              </span>{' '}
              <span style={mutedTag}>{t('ai.linkVerify.uncertain')}</span>
            </span>
          </label>
        ))}
        {unmatched.map((link) => (
          <label key={link.elementId} style={{ ...rowStyle, opacity: 0.65 }}>
            <input type="checkbox" checked={false} disabled style={{ marginBlockStart: 3 }} />
            <span style={{ minWidth: 0 }}>
              <span dir="auto">
                «{link.label}» → {link.calledProcess}
              </span>{' '}
              <span style={mutedTag}>{t('ai.linkVerify.noMatch')}</span>
            </span>
          </label>
        ))}
      </div>
    </Modal>
  )
}

const rowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 8,
  fontSize: 13,
  lineHeight: 1.45,
  cursor: 'pointer'
}
const mutedTag: CSSProperties = { fontSize: 11.5, color: 'var(--orbitpm-muted)' }
const ghostBtn: CSSProperties = {
  padding: '0.4rem 0.7rem',
  borderRadius: 6,
  border: '1px solid rgba(127,127,127,0.35)',
  background: 'transparent',
  fontSize: 13,
  cursor: 'pointer',
  color: 'inherit'
}

export default LinkVerifyDialog
