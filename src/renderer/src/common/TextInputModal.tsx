import { useEffect, useRef } from 'react'
import './TextInputModal.css'

export interface TextInputModalProps {
  open: boolean
  title: string
  label: string
  value: string
  onChange: (value: string) => void
  okLabel?: string
  cancelLabel?: string
  /** Optional helper text shown under the input (e.g. a naming hint). */
  hint?: string
  placeholder?: string
  onOk: () => void
  onCancel: () => void
}

/**
 * Small reusable single-line text prompt. Electron's `BrowserWindow` does not
 * implement `window.prompt()` (it is a no-op that returns null / throws
 * "prompt() is not supported"), so every in-app "enter a name" flow must use
 * this modal instead. Controlled input — the parent (PromptProvider) owns the
 * value. Enter confirms, Escape / overlay-click / Cancel dismisses. Autofocuses
 * and selects its text on open so the suggested name can be typed over.
 * Confirm is disabled while the trimmed value is empty (the "validate hint").
 */
export function TextInputModal({
  open,
  title,
  label,
  value,
  onChange,
  okLabel = 'OK',
  cancelLabel = 'Cancel',
  hint,
  placeholder,
  onOk,
  onCancel
}: TextInputModalProps): JSX.Element | null {
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    // Autofocus + select on open so typing replaces the suggested name.
    const id = requestAnimationFrame(() => {
      const el = inputRef.current
      if (el) {
        el.focus()
        el.select()
      }
    })
    return () => cancelAnimationFrame(id)
  }, [open])

  if (!open) return null

  const canConfirm = value.trim().length > 0
  const submit = (): void => {
    if (canConfirm) onOk()
  }

  return (
    <div
      className="text-input-modal-overlay"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel()
      }}
    >
      <div
        className="text-input-modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            submit()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            onCancel()
          }
        }}
      >
        <header className="text-input-modal__header">
          <h2>{title}</h2>
        </header>
        <div className="text-input-modal__body">
          <label className="text-input-modal__label">
            <span>{label}</span>
            <input
              ref={inputRef}
              className="text-input-modal__input"
              type="text"
              value={value}
              placeholder={placeholder}
              onChange={(e) => onChange(e.target.value)}
            />
          </label>
          {hint && <p className="text-input-modal__hint">{hint}</p>}
        </div>
        <footer className="text-input-modal__footer">
          <button type="button" className="text-input-modal__cancel" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className="text-input-modal__ok"
            onClick={submit}
            disabled={!canConfirm}
          >
            {okLabel}
          </button>
        </footer>
      </div>
    </div>
  )
}

export default TextInputModal
