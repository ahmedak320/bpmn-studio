import { Modal } from './Modal'
import type { WorkspaceUnresolvedLink } from './unresolved'

export interface UnresolvedLinksPanelProps {
  links: WorkspaceUnresolvedLink[]
  /** directory mode enables "Create now"; fallback only offers "Open source". */
  canCreate: boolean
  /** Create the missing process (its <process id> is fixed to calledElement). */
  onCreate: (calledElement: string) => void
  /** Open the source file that contains the dangling call activity. */
  onOpenSource: (relPath: string) => void
  onClose: () => void
}

/**
 * Lists every unresolved call-activity link across the workspace: source
 * process → missing calledElement, with per-row "Create now" (reusing the
 * existing create-missing-process flow — the new file's <process id> is fixed
 * to the calledElement so the link resolves immediately) and "Open source"
 * (jump to the file that has the dangling link). Opened from the footer badge.
 */
export function UnresolvedLinksPanel({
  links,
  canCreate,
  onCreate,
  onOpenSource,
  onClose
}: UnresolvedLinksPanelProps): JSX.Element {
  return (
    <Modal
      title={`Unresolved links (${links.length})`}
      onClose={onClose}
      maxWidth={620}
      ariaLabel="Unresolved links"
      footer={
        <button type="button" className="orbitpm-lite-chrome-btn" onClick={onClose}>
          Close
        </button>
      }
    >
      {links.length === 0 ? (
        <p style={{ margin: 0, fontSize: 13, color: 'var(--orbitpm-muted)' }}>
          No unresolved links — every call activity points at a process that exists in this
          workspace.
        </p>
      ) : (
        <>
          <p style={{ margin: '0 0 12px', fontSize: 12.5, color: 'var(--orbitpm-muted)' }}>
            Each row is a call activity whose target process isn&apos;t in this workspace.{' '}
            {canCreate
              ? 'Create the missing process (its id is fixed so the link resolves), or open the source to fix it.'
              : 'Open a folder to create the missing processes; here you can jump to each source.'}
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {links.map((link, i) => (
              <div
                key={`${link.sourceRelPath}::${link.elementId ?? i}::${link.calledElement}`}
                style={{
                  border: '1px solid var(--orbitpm-border)',
                  borderRadius: 8,
                  padding: '0.6rem 0.7rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                  flexWrap: 'wrap'
                }}
              >
                <div style={{ minWidth: 0, fontSize: 13 }}>
                  <div style={{ fontWeight: 600, wordBreak: 'break-word' }}>
                    {link.sourceProcessName?.trim() || link.sourceFileName}
                    <span style={{ color: 'var(--orbitpm-muted)', fontWeight: 400 }}> → </span>
                    <span style={{ color: '#d97706', fontFamily: 'monospace', fontSize: 12.5 }}>
                      {link.calledElement}
                    </span>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--orbitpm-muted)', marginTop: 2 }}>
                    {link.sourceRelPath}
                    {link.elementId ? ` · ${link.elementId}` : ''}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, flex: '0 0 auto' }}>
                  {canCreate && (
                    <button
                      type="button"
                      className="orbitpm-lite-chrome-btn"
                      onClick={() => onCreate(link.calledElement)}
                      title={`Create a process with id "${link.calledElement}"`}
                    >
                      Create now
                    </button>
                  )}
                  <button
                    type="button"
                    className="orbitpm-lite-chrome-btn"
                    onClick={() => onOpenSource(link.sourceRelPath)}
                    title="Open the file that contains this call activity"
                  >
                    Open source
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </Modal>
  )
}

export default UnresolvedLinksPanel
