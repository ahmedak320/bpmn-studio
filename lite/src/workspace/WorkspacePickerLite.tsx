import { ICON_DATA_URI } from '../branding/icon'

export type PickerMode = 'open' | 'reconnect' | 'fallback'

export interface WorkspacePickerLiteProps {
  mode: PickerMode
  /** Folder name to reconnect to (mode === 'reconnect'). */
  rememberedName?: string
  busy?: boolean
  error?: string | null
  /** Open the directory picker (mode 'open') or re-request permission
   * (mode 'reconnect'). */
  onOpenFolder: () => void
  /** Pick a different folder (offered alongside reconnect). */
  onOpenDifferent?: () => void
  /** Open a single .bpmn file (fallback mode). */
  onOpenFile?: () => void
  /** Start a brand-new empty diagram without any folder (fallback mode). */
  onNewDiagram?: () => void
  /** Start the named New-process flow (prompts for a name) — fallback mode. */
  onNewProcess?: () => void
}

/**
 * The landing / empty-state screen. Three shapes:
 *  - 'open'      : first visit with the File System Access API available.
 *  - 'reconnect' : a previously-opened folder is remembered but needs its
 *                  read/write permission re-granted (needs a user click).
 *  - 'fallback'  : the API is unavailable (policy-disabled browser) — offer
 *                  single-file open + a note about the reduced mode.
 */
export function WorkspacePickerLite({
  mode,
  rememberedName,
  busy,
  error,
  onOpenFolder,
  onOpenDifferent,
  onOpenFile,
  onNewDiagram,
  onNewProcess
}: WorkspacePickerLiteProps): JSX.Element {
  return (
    <div
      style={{
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 18,
        padding: '2rem',
        textAlign: 'center'
      }}
    >
      <img src={ICON_DATA_URI} width={72} height={72} alt="OrbitPM" style={{ borderRadius: 16 }} />
      <div>
        <h1 style={{ fontSize: 22, margin: '0 0 4px' }}>OrbitPM Process Studio Lite</h1>
        <p style={{ margin: 0, color: 'var(--orbitpm-muted)', fontSize: 14, maxWidth: 440 }}>
          Draw BPMN 2.0 diagrams, organize them in folders, link processes, and generate from a
          description with AI — all in your browser, nothing to install.
        </p>
      </div>

      {mode === 'open' && (
        <>
          <button className="orbitpm-lite-primary" onClick={onOpenFolder} disabled={busy}>
            {busy ? 'Opening…' : 'Open a folder…'}
          </button>
          <p style={{ margin: 0, fontSize: 12.5, color: 'var(--orbitpm-muted)', maxWidth: 440 }}>
            Choose a folder on your computer (e.g. a OneDrive folder) to hold your{' '}
            <code>.bpmn</code> files. The browser asks permission the first time and remembers the
            folder for next time.
          </p>
        </>
      )}

      {mode === 'reconnect' && (
        <>
          <button className="orbitpm-lite-primary" onClick={onOpenFolder} disabled={busy}>
            {busy ? 'Reconnecting…' : `Reconnect to "${rememberedName ?? 'your folder'}"`}
          </button>
          <button className="orbitpm-lite-chrome-btn" onClick={onOpenDifferent} disabled={busy}>
            Open a different folder…
          </button>
          <p style={{ margin: 0, fontSize: 12.5, color: 'var(--orbitpm-muted)', maxWidth: 440 }}>
            Your browser needs you to re-grant read/write access to this folder for this session.
          </p>
        </>
      )}

      {mode === 'fallback' && (
        <>
          <div className="orbitpm-lite-banner" style={{ borderRadius: 8, maxWidth: 480 }}>
            This browser doesn&apos;t allow opening a folder (the File System Access API is
            unavailable or disabled by policy). You can still open a single <code>.bpmn</code> file
            or start a new diagram — saving will download the file instead of writing it back in
            place. For the full folder experience, use Microsoft Edge or Google Chrome, or the
            desktop app.
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
            <button className="orbitpm-lite-primary" onClick={onNewProcess}>
              ＋ New process
            </button>
            <button className="orbitpm-lite-chrome-btn" onClick={onOpenFile}>
              Open a .bpmn file…
            </button>
            <button className="orbitpm-lite-chrome-btn" onClick={onNewDiagram}>
              New blank diagram
            </button>
          </div>
        </>
      )}

      {error && (
        <div style={{ color: '#c4322f', fontSize: 13, maxWidth: 440 }} role="alert">
          {error}
        </div>
      )}
    </div>
  )
}

export default WorkspacePickerLite
