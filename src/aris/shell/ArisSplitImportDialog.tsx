/**
 * The split-import review dialog (lane T7).
 *
 * The user sees every model that will be written as a separate workspace file
 * and every model that is skipped because it already exists. Confirming is the
 * only path that writes files; cancelling leaves the workspace untouched.
 */

import { useRef } from 'react'

import { AccessibleDialog } from '../../common/AccessibleDialog'
import { tk } from './shellI18n'
import type { ArisSplitImportPlan } from './arisSplitImport'

export interface ArisSplitImportDialogProps {
  readonly open: boolean
  readonly plan: ArisSplitImportPlan | null
  readonly busy: boolean
  readonly dir: 'ltr' | 'rtl'
  readonly onConfirm: () => void
  readonly onCancel: () => void
}

export function ArisSplitImportDialog({
  open,
  plan,
  busy,
  dir,
  onConfirm,
  onCancel
}: ArisSplitImportDialogProps): JSX.Element | null {
  const confirmRef = useRef<HTMLButtonElement | null>(null)
  if (!open || !plan) return null

  // `executeArisSplitImport` keeps writing files once started; letting Escape,
  // the backdrop or the Cancel button dismiss the dialog while `busy` would
  // hide that in-flight write from the user without stopping it (there is no
  // abort path). Refusing to call `onCancel` at all while busy is a complete
  // guard regardless of what the caller's `onCancel` does — the parent simply
  // never gets a chance to close the dialog out from under the write.
  const handleCancel = (): void => {
    if (busy) return
    onCancel()
  }

  return (
    <AccessibleDialog
      role="dialog"
      dir={dir}
      ariaLabel={tk('aris.import.split.title', 'Import into the workspace')}
      onClose={handleCancel}
      initialFocusRef={confirmRef}
      dialogStyle={{
        maxWidth: 720,
        width: 'min(92vw, 720px)',
        maxHeight: '86vh',
        overflow: 'auto',
        padding: '1rem 1.1rem',
        borderRadius: 14,
        border: '1px solid var(--orbitpm-border)',
        background: 'var(--orbitpm-panel-bg, var(--orbitpm-bg))'
      }}
    >
      <h2 style={{ margin: '0 0 12px', fontSize: 18 }}>
        {tk('aris.import.split.title', 'Import into the workspace')}
      </h2>

      <p style={{ margin: '12px 0 0', fontSize: 13, lineHeight: 1.5 }}>
        {tk(
          'aris.import.split.body',
          'Each ARIS model becomes its own .aml file, in folders mirroring the ARIS group tree. Existing files are never overwritten.'
        )}
      </p>

      <h3 style={{ margin: '14px 0 6px', fontSize: 14 }}>
        {tk('aris.import.split.listAria', 'Files to be created')}
      </h3>
      <div style={{ maxHeight: 260, overflow: 'auto' }}>
        <table
          className="orbitpm-aris-report"
          aria-label={tk('aris.import.split.listAria', 'Files to be created')}
        >
          <tbody>
            {plan.targets.map((target) => (
              <tr key={target.modelId}>
                <td>{target.relPath}</td>
                <td>{target.modelName}</td>
                <td>
                  {target.status === 'skip-existing-model' &&
                    tk(
                      'aris.import.split.skipExisting',
                      'Skipped — model {id} already exists in this workspace',
                      { id: target.modelId }
                    )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
        <button
          ref={confirmRef}
          type="button"
          className="orbitpm-lite-chrome-btn"
          disabled={busy}
          onClick={onConfirm}
        >
          {tk('aris.import.split.confirm', 'Import {count} file(s)', { count: plan.writeCount })}
        </button>
        <button
          type="button"
          className="orbitpm-lite-chrome-btn"
          disabled={busy}
          onClick={handleCancel}
        >
          {tk('aris.import.split.cancel', 'Cancel')}
        </button>
      </div>
    </AccessibleDialog>
  )
}
