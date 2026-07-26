import { ICON_DATA_URI } from '../branding/icon'
import { t } from '../i18n'
import { useLang, setLang } from '../i18n/useLang'

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
  const lang = useLang()
  return (
    <div
      style={{
        position: 'relative',
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
      <button
        type="button"
        className="orbitpm-lite-chrome-btn"
        onClick={() => setLang(lang === 'en' ? 'ar' : 'en')}
        title={t('app.lang.toggle.title')}
        style={{ position: 'absolute', insetBlockStart: 16, insetInlineEnd: 16 }}
      >
        {lang === 'en' ? t('app.lang.ar') : t('app.lang.en')}
      </button>
      <img src={ICON_DATA_URI} width={72} height={72} alt="OrbitPM" style={{ borderRadius: 16 }} />
      <div>
        <h1 style={{ fontSize: 22, margin: '0 0 4px' }}>{t('picker.title')}</h1>
        <p style={{ margin: 0, color: 'var(--orbitpm-muted)', fontSize: 14, maxWidth: 440 }}>
          {t('picker.subtitle')}
        </p>
      </div>

      {mode === 'open' && (
        <>
          <button className="orbitpm-lite-primary" onClick={onOpenFolder} disabled={busy}>
            {busy ? t('picker.open.button.busy') : t('picker.open.button')}
          </button>
          <p style={{ margin: 0, fontSize: 12.5, color: 'var(--orbitpm-muted)', maxWidth: 440 }}>
            {t('picker.open.hint')}
          </p>
        </>
      )}

      {mode === 'reconnect' && (
        <>
          <button className="orbitpm-lite-primary" onClick={onOpenFolder} disabled={busy}>
            {busy
              ? t('picker.reconnect.button.busy')
              : t('picker.reconnect.button', {
                  rememberedName: rememberedName ?? t('picker.reconnect.button.fallbackName')
                })}
          </button>
          <button className="orbitpm-lite-chrome-btn" onClick={onOpenDifferent} disabled={busy}>
            {t('picker.reconnect.openDifferent')}
          </button>
          <p style={{ margin: 0, fontSize: 12.5, color: 'var(--orbitpm-muted)', maxWidth: 440 }}>
            {t('picker.reconnect.hint')}
          </p>
        </>
      )}

      {mode === 'fallback' && (
        <>
          <div className="orbitpm-lite-banner" style={{ borderRadius: 8, maxWidth: 480 }}>
            {t('picker.fallback.banner')}
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
            <button className="orbitpm-lite-primary" onClick={onNewProcess}>
              {t('picker.fallback.newProcess')}
            </button>
            <button className="orbitpm-lite-chrome-btn" onClick={onOpenFile}>
              {t('picker.fallback.openFile')}
            </button>
            <button className="orbitpm-lite-chrome-btn" onClick={onNewDiagram}>
              {t('picker.fallback.newDiagram')}
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
