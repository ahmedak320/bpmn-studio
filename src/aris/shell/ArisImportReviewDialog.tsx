/**
 * The §7.3 step-8 review gate.
 *
 * `planArisImportedPackage` refuses to be committed unless the caller echoes
 * the exact digest of the plan it was shown, so the review is not advisory: this
 * dialog is the only place the user can see what will be written, and closing it
 * without confirming leaves the workspace byte-identical.
 */

import { useRef } from 'react'

import { AccessibleDialog } from '../../common/AccessibleDialog'
import { t } from '../../i18n'
import type { ArisSourcePackagePlan } from '../packages/transaction'
import { tk } from './shellI18n'

export interface ArisImportReviewDialogProps {
  readonly open: boolean
  readonly plan: ArisSourcePackagePlan | null
  readonly busy: boolean
  readonly dir: 'ltr' | 'rtl'
  readonly onConfirm: () => void
  readonly onCancel: () => void
}

export function ArisImportReviewDialog({
  open,
  plan,
  busy,
  dir,
  onConfirm,
  onCancel
}: ArisImportReviewDialogProps): JSX.Element | null {
  const confirmRef = useRef<HTMLButtonElement | null>(null)
  if (!open || !plan) return null

  const review = plan.review

  return (
    <AccessibleDialog
      role="dialog"
      dir={dir}
      ariaLabel={tk('aris.import.review.title', 'Review this import')}
      onClose={onCancel}
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
        {tk('aris.import.review.title', 'Review this import')}
      </h2>

      <dl className="orbitpm-aris-defs">
        <dt>{tk('aris.import.review.source', 'Source')}</dt>
        <dd>{review.sourceName}</dd>
        <dt>{t('aris.placeholder.sourceDigest')}</dt>
        <dd style={{ fontFamily: 'monospace' }}>{review.sourceSha256}</dd>
        <dt>{tk('aris.import.review.digest', 'Review digest')}</dt>
        <dd style={{ fontFamily: 'monospace' }}>{plan.reviewDigest}</dd>
      </dl>

      <p style={{ margin: '12px 0 0', fontSize: 13, lineHeight: 1.5 }}>
        {tk(
          'aris.import.review.counts',
          '{models} models · {writes} package members · {bytes} bytes · {attachments} attachments',
          {
            models: review.counts.models,
            writes: review.counts.writes,
            bytes: review.counts.totalBytes,
            attachments: review.counts.attachments
          }
        )}
      </p>
      <p style={{ margin: '6px 0 0', fontSize: 13, lineHeight: 1.5 }}>
        {tk(
          'aris.import.review.fidelity',
          '{accounted} of {total} records accounted for, {unaccounted} unaccounted.',
          {
            accounted: review.fidelity.accountedRecords,
            total: review.fidelity.totalRecords,
            unaccounted: review.fidelity.unaccountedRecords
          }
        )}
      </p>

      {review.duplicate && (
        <p role="status" style={{ margin: '10px 0 0', fontSize: 13, lineHeight: 1.5 }}>
          {tk(
            'aris.import.review.duplicate',
            'An identical source digest is already stored; committing will deduplicate.'
          )}
        </p>
      )}

      <h3 style={{ margin: '14px 0 6px', fontSize: 14 }}>
        {tk('aris.import.review.writes', 'Package members to be written')}
      </h3>
      <div style={{ maxHeight: 260, overflow: 'auto' }}>
        <table className="orbitpm-aris-report">
          <tbody>
            {review.writes.map((write) => (
              <tr key={write.path}>
                <td>{write.path}</td>
                <td>{write.role}</td>
                <td>{write.byteLength}</td>
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
          {tk('aris.import.review.confirm', 'Commit import')}
        </button>
        <button type="button" className="orbitpm-lite-chrome-btn" onClick={onCancel}>
          {tk('aris.import.review.cancel', 'Cancel')}
        </button>
      </div>
    </AccessibleDialog>
  )
}
