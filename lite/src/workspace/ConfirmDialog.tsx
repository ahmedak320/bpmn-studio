import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Modal } from './Modal'
import { t } from '../i18n'
import { useLang } from '../i18n/useLang'

export interface ConfirmDialogProps {
  title: string
  message: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  /** When set, the user must type this exact string to enable the confirm
   *  button — used for deleting a non-empty folder (type its name). */
  requireTyped?: string
  onConfirm: () => void
  onCancel: () => void
}

/**
 * Themed confirm dialog. Plain confirm for files and empty folders; a
 * type-the-name guard for non-empty folders (`requireTyped`), so an
 * irreversible recursive delete can't happen on a single stray click.
 */
export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  cancelLabel,
  danger = false,
  requireTyped,
  onConfirm,
  onCancel
}: ConfirmDialogProps): JSX.Element {
  useLang()
  const resolvedConfirmLabel = confirmLabel ?? t('confirmDialog.confirm.default')
  const resolvedCancelLabel = cancelLabel ?? t('confirmDialog.cancel')
  const [typed, setTyped] = useState('')
  const inputRef = useRef<HTMLInputElement | null>(null)
  const canConfirm = requireTyped === undefined || typed === requireTyped

  useEffect(() => {
    if (requireTyped !== undefined) inputRef.current?.focus()
  }, [requireTyped])

  const confirmBtn = (
    <button
      type="button"
      className="orbitpm-lite-chrome-btn"
      disabled={!canConfirm}
      onClick={() => canConfirm && onConfirm()}
      style={{
        fontWeight: 600,
        color: danger ? '#fff' : undefined,
        background: danger && canConfirm ? '#d0473f' : undefined,
        borderColor: danger && canConfirm ? '#d0473f' : undefined,
        opacity: canConfirm ? 1 : 0.5,
        cursor: canConfirm ? 'pointer' : 'not-allowed'
      }}
    >
      {resolvedConfirmLabel}
    </button>
  )

  return (
    <Modal
      title={title}
      onClose={onCancel}
      maxWidth={440}
      footer={
        <>
          <button type="button" className="orbitpm-lite-chrome-btn" onClick={onCancel}>
            {resolvedCancelLabel}
          </button>
          {confirmBtn}
        </>
      }
    >
      <div style={{ fontSize: 13.5, lineHeight: 1.55 }}>{message}</div>
      {requireTyped !== undefined && (
        <label style={{ display: 'block', marginTop: 12, fontSize: 13 }}>
          <span style={{ display: 'block', marginBottom: 4, color: 'var(--orbitpm-muted)' }}>
            {t('confirmDialog.typeToConfirm').split('{name}')[0]}
            <strong>{requireTyped}</strong>
            {t('confirmDialog.typeToConfirm').split('{name}')[1]}
          </span>
          <input
            ref={inputRef}
            type="text"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && canConfirm) onConfirm()
            }}
            style={{
              width: '100%',
              padding: '0.45rem 0.55rem',
              borderRadius: 6,
              border: '1px solid rgba(127,127,127,0.4)',
              background: 'transparent',
              color: 'inherit',
              font: 'inherit',
              fontSize: 13
            }}
          />
        </label>
      )}
    </Modal>
  )
}

export default ConfirmDialog
