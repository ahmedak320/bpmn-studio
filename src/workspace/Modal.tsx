import { type ReactNode, type RefObject } from 'react'
import { AccessibleDialog } from '../common/AccessibleDialog'
import { t } from '../i18n'
import { useLang } from '../i18n/useLang'

export interface ModalProps {
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  maxWidth?: number
  role?: 'dialog' | 'alertdialog'
  /** Hide dismissal UI and ignore Escape/backdrop while a commit cannot be cancelled safely. */
  closable?: boolean
  /** Accessible label for the dialog; defaults to `title`. */
  ariaLabel?: string
  ariaDescribedby?: string
  initialFocusRef?: RefObject<HTMLElement | null>
  returnFocusRef?: RefObject<HTMLElement | null>
}

/**
 * Small themed modal shell reused by the Move / Delete-confirm / Unresolved-
 * links dialogs. Escape and overlay-click both close it (matching the app's
 * other modals). Content scrolls inside the panel so long lists never push the
 * page into a horizontal scroll.
 */
export function Modal({
  title,
  onClose,
  children,
  footer,
  maxWidth = 460,
  role = 'dialog',
  closable = true,
  ariaLabel,
  ariaDescribedby,
  initialFocusRef,
  returnFocusRef
}: ModalProps): JSX.Element {
  useLang()

  return (
    <AccessibleDialog
      role={role}
      ariaLabel={ariaLabel ?? title}
      ariaDescribedby={ariaDescribedby}
      onClose={onClose}
      closeOnEscape={closable}
      closeOnBackdrop={closable}
      initialFocusRef={initialFocusRef}
      returnFocusRef={returnFocusRef}
      backdropStyle={{
        position: 'fixed',
        inset: 0,
        zIndex: 3000,
        background: 'rgba(0,0,0,0.42)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1rem'
      }}
      dialogStyle={{
        width: '100%',
        maxWidth,
        maxHeight: '85vh',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--orbitpm-panel-bg)',
        color: 'var(--orbitpm-fg)',
        border: '1px solid var(--orbitpm-border)',
        borderRadius: 12,
        boxShadow: '0 18px 60px rgba(0,0,0,0.4)'
      }}
    >
      <header
        style={{
          padding: '0.8rem 1rem',
          borderBottom: '1px solid var(--orbitpm-border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12
        }}
      >
        <strong style={{ fontSize: 15 }}>{title}</strong>
        {closable ? (
          <button
            type="button"
            onClick={onClose}
            aria-label={t('modal.close.aria')}
            title={t('modal.close.aria')}
            style={{
              border: 'none',
              background: 'transparent',
              fontSize: 18,
              cursor: 'pointer',
              lineHeight: 1,
              color: 'inherit'
            }}
          >
            ×
          </button>
        ) : null}
      </header>
      <div style={{ padding: '1rem', overflowY: 'auto', minHeight: 0 }}>{children}</div>
      {footer && (
        <footer
          style={{
            padding: '0.7rem 1rem',
            borderTop: '1px solid var(--orbitpm-border)',
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 8
          }}
        >
          {footer}
        </footer>
      )}
    </AccessibleDialog>
  )
}

export default Modal
