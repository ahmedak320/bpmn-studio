import { useRef } from 'react'
import { AccessibleDialog } from '../common/AccessibleDialog'
import { t, type Key } from '../i18n'
import type { ValidationSummary } from './contracts'

function translate(key: string, variables?: Record<string, string | number>): string {
  return t(key as Key, variables)
}

export interface SaveDraftDialogProps {
  summary: ValidationSummary | null
  busy: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function SaveDraftDialog({
  summary,
  busy,
  onConfirm,
  onCancel
}: SaveDraftDialogProps): JSX.Element | null {
  const headingRef = useRef<HTMLHeadingElement | null>(null)

  if (!summary) return null

  return (
    <AccessibleDialog
      role="alertdialog"
      backdropClassName="orbitpm-validation__backdrop"
      dialogClassName="orbitpm-save-draft"
      ariaLabelledby="orbitpm-save-draft-title"
      onClose={onCancel}
      closeOnEscape={!busy}
      closeOnBackdrop={false}
      initialFocusRef={headingRef}
    >
      <h2 id="orbitpm-save-draft-title" ref={headingRef} tabIndex={-1}>
        {translate('save.blocked')}
      </h2>
      <p>
        {translate('save.draftPrompt', {
          count: summary.blockingErrors
        })}
      </p>
      <div className="orbitpm-validation__footer">
        <button type="button" onClick={onCancel} disabled={busy}>
          {translate('save.cancel')}
        </button>
        <button
          type="button"
          className="orbitpm-validation__danger"
          onClick={onConfirm}
          disabled={busy}
        >
          {translate('save.draftAction')}
        </button>
      </div>
    </AccessibleDialog>
  )
}
