import { useMemo, useState } from 'react'
import { AccessibleDialog } from '../common/AccessibleDialog'
import { t } from '../i18n'
import type { WorkspaceBackupCollisionDecision, WorkspaceBackupImportPlan } from './adapters'

export interface BackupImportDialogProps {
  plan: WorkspaceBackupImportPlan
  busy?: boolean
  onApply: (decisions: Readonly<Record<string, WorkspaceBackupCollisionDecision>>) => void
  onCancel: () => void
}

export function BackupImportDialog({
  plan,
  busy = false,
  onApply,
  onCancel
}: BackupImportDialogProps): JSX.Element {
  const initial = useMemo(
    () =>
      Object.fromEntries(plan.collisions.map((collision) => [collision.path, 'skip'])) as Record<
        string,
        'replace' | 'skip' | 'keep-both'
      >,
    [plan]
  )
  const [actions, setActions] = useState(initial)
  const decisions = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(actions).map(([path, action]) => [
          path,
          { action } satisfies WorkspaceBackupCollisionDecision
        ])
      ),
    [actions]
  )

  return (
    <AccessibleDialog
      ariaLabelledby="backup-import-title"
      onClose={onCancel}
      closeOnEscape={!busy}
      closeOnBackdrop={false}
      backdropStyle={{
        position: 'fixed',
        inset: 0,
        zIndex: 10020,
        display: 'grid',
        placeItems: 'center',
        padding: 20,
        background: 'rgba(0,0,0,0.52)'
      }}
      dialogStyle={{
        width: 'min(760px, 96vw)',
        maxHeight: '86vh',
        overflow: 'auto',
        padding: 18,
        borderRadius: 12,
        border: '1px solid var(--orbitpm-border)',
        background: 'var(--orbitpm-panel-bg, var(--orbitpm-bg))',
        color: 'var(--orbitpm-fg)',
        boxShadow: '0 24px 64px rgba(0,0,0,0.35)'
      }}
    >
      <h2 id="backup-import-title" style={{ margin: '0 0 8px', fontSize: 18 }}>
        {t('workspace.storage.collisionReview')}
      </h2>
      <p style={{ margin: '0 0 14px', color: 'var(--orbitpm-muted)' }}>
        {plan.files.length} · {Math.round(plan.declaredUncompressedBytes / 1024)} KiB
      </p>

      {plan.collisions.length > 0 ? (
        <div style={{ display: 'grid', gap: 8 }}>
          {plan.collisions.map((collision) => (
            <label
              key={collision.path}
              style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(0, 1fr) minmax(150px, auto)',
                alignItems: 'center',
                gap: 12,
                padding: 10,
                border: '1px solid var(--orbitpm-border)',
                borderRadius: 8
              }}
            >
              <span style={{ minWidth: 0 }}>
                <strong style={{ display: 'block', overflowWrap: 'anywhere' }}>
                  {collision.path}
                </strong>
                <small style={{ color: 'var(--orbitpm-muted)' }}>
                  {collision.incomingHash.slice(0, 12)} ↔ {collision.existing.hash.slice(0, 12)}
                  {collision.identical ? ` · ${t('workspace.storage.collisionIdentical')}` : ''}
                </small>
              </span>
              <select
                value={actions[collision.path]}
                disabled={busy || collision.identical}
                onChange={(event) => {
                  const action = event.target.value as 'replace' | 'skip' | 'keep-both'
                  setActions((previous) => ({
                    ...previous,
                    [collision.path]: action
                  }))
                }}
              >
                <option value="skip">{t('workspace.storage.collisionSkip')}</option>
                <option value="replace">{t('workspace.storage.collisionReplace')}</option>
                <option value="keep-both">{t('workspace.storage.collisionKeepBoth')}</option>
              </select>
            </label>
          ))}
        </div>
      ) : null}

      <div
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          gap: 8,
          marginTop: 16
        }}
      >
        <button
          type="button"
          className="orbitpm-lite-chrome-btn"
          disabled={busy}
          onClick={onCancel}
        >
          {t('modal.cancel')}
        </button>
        <button
          type="button"
          className="orbitpm-lite-primary"
          disabled={busy}
          onClick={() => onApply(decisions)}
        >
          {t('workspace.storage.backupApply')}
        </button>
      </div>
    </AccessibleDialog>
  )
}
