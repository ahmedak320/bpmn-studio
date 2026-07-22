import { t } from '../i18n'
import { useLang } from '../i18n/useLang'

export interface EmptyWorkspaceCardProps {
  /** Name of the opened workspace folder (shown in the folder hint line). */
  folderName?: string
  /** Start the New-process flow (prompt for a name, create + open the file). */
  onCreateFirst: () => void
}

/**
 * Shown in the tree area when the opened folder contains no `.bpmn` files.
 * Before this existed, an empty folder rendered a blank pane with no visible
 * way to begin — the reported dead end. Now there is an unmissable
 * "Create your first process" button plus a one-line explanation of how the
 * folder maps to files, alongside the always-present header "New process"
 * button and the folder-tree right-click menu.
 */
export function EmptyWorkspaceCard({
  folderName,
  onCreateFirst
}: EmptyWorkspaceCardProps): JSX.Element {
  useLang()
  return (
    <div
      style={{
        margin: '0.75rem 0.7rem',
        padding: '1.1rem 1rem',
        borderRadius: 10,
        border: '1px dashed var(--orbitpm-border)',
        background: 'var(--orbitpm-hover)',
        textAlign: 'center',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 10
      }}
    >
      <div style={{ fontSize: 30, lineHeight: 1 }} aria-hidden>
        🗂️
      </div>
      <strong style={{ fontSize: 14 }}>{t('emptyWorkspace.heading')}</strong>
      <button
        type="button"
        className="orbitpm-lite-primary"
        style={{ width: '100%' }}
        onClick={onCreateFirst}
      >
        {t('emptyWorkspace.createFirst')}
      </button>
      <p style={{ margin: 0, fontSize: 12, color: 'var(--orbitpm-muted)', lineHeight: 1.45 }}>
        {t('emptyWorkspace.explain', {
          folderName: folderName ? folderName : t('emptyWorkspace.explain.fallbackFolderName')
        })}
      </p>
    </div>
  )
}

export default EmptyWorkspaceCard
