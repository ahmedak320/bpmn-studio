import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import {
  LITE_PROVIDERS,
  DESKTOP_ONLY_PROVIDERS,
  getLiteProvider,
  defaultLiteModelId
} from './providersLite'
import { generateDiagramXml, classifyBrowserError, type LiteProviderId } from './browserAi'
import { getKey, hasKey } from './keys'

export interface FolderOptionLite {
  relPath: string
  label: string
}

export interface AiPanelLiteProps {
  /** Target-folder options (directory mode). Empty in fallback mode. */
  folders: FolderOptionLite[]
  /** Place a freshly-generated diagram. Returns the opened path label, or null
   * if it was opened in-memory (fallback mode). */
  onPlaceGenerated: (
    xml: string,
    opts: { name: string; targetFolder: string }
  ) => Promise<{ label: string } | null>
  onOpenSettings: () => void
  collapsed: boolean
  onToggle: () => void
  /** Bump to re-read key availability after Settings closes. */
  keysVersion: number
  /** Directory mode shows the target-folder picker; fallback hides it. */
  mode: 'directory' | 'fallback'
}

export function AiPanelLite({
  folders,
  onPlaceGenerated,
  onOpenSettings,
  collapsed,
  onToggle,
  keysVersion,
  mode
}: AiPanelLiteProps): JSX.Element {
  const [providerId, setProviderId] = useState<LiteProviderId>('anthropic')
  const [modelId, setModelId] = useState<string>(() => defaultLiteModelId('anthropic'))
  const [description, setDescription] = useState('')
  const [name, setName] = useState('')
  const [targetFolder, setTargetFolder] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [offline, setOffline] = useState(false)
  const [resultLabel, setResultLabel] = useState<string | null>(null)
  const [online, setOnline] = useState<boolean>(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine
  )
  // Recompute key availability whenever Settings closes (keysVersion bump).
  const configured = useMemo(
    () => LITE_PROVIDERS.filter((p) => hasKey(p.id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [keysVersion]
  )

  useEffect(() => {
    const goOnline = (): void => setOnline(true)
    const goOffline = (): void => setOnline(false)
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [])

  // Keep provider valid against which keys exist.
  useEffect(() => {
    if (configured.length === 0) return
    setProviderId((prev) => (configured.some((p) => p.id === prev) ? prev : configured[0].id))
  }, [configured])

  useEffect(() => {
    setModelId(defaultLiteModelId(providerId))
  }, [providerId])

  useEffect(() => {
    if (folders.length === 0) return
    setTargetFolder((prev) => (folders.some((f) => f.relPath === prev) ? prev : folders[0].relPath))
  }, [folders])

  const providerSpec = getLiteProvider(providerId)
  const keyPresent = hasKey(providerId)
  const canGenerate =
    !busy && online && keyPresent && Boolean(modelId.trim()) && Boolean(description.trim())

  const handleGenerate = useCallback(async () => {
    setBusy(true)
    setError(null)
    setOffline(false)
    setResultLabel(null)
    try {
      const apiKey = getKey(providerId)
      if (!apiKey) throw new Error('No API key for this provider. Add one in Settings.')
      const xml = await generateDiagramXml({
        description: description.trim(),
        providerId,
        modelId: modelId.trim(),
        apiKey
      })
      const placed = await onPlaceGenerated(xml, { name: name.trim(), targetFolder })
      setResultLabel(placed ? placed.label : 'Opened in a new tab (use Save to download).')
    } catch (err) {
      const classified = classifyBrowserError(err)
      setError(classified.message)
      setOffline(classified.offline || !navigator.onLine)
    } finally {
      setBusy(false)
    }
  }, [providerId, modelId, description, name, targetFolder, onPlaceGenerated])

  if (collapsed) {
    return (
      <div style={collapsedWrap}>
        <button type="button" onClick={onToggle} title="Show AI panel" style={collapsedBtn}>
          ✨ Generate with AI
        </button>
      </div>
    )
  }

  const noKeys = configured.length === 0

  return (
    <div style={wrap}>
      <header style={panelHeader}>
        <strong style={{ fontSize: 14 }}>✨ Generate with AI</strong>
        <button type="button" onClick={onToggle} title="Hide AI panel" style={hideBtn}>
          ⟩
        </button>
      </header>

      <div style={{ padding: '0.8rem', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {!online && (
          <div role="status" style={warnBox}>
            You appear to be offline. AI generation needs an internet connection; drawing and
            organizing diagrams still works.
          </div>
        )}

        {noKeys ? (
          <div style={{ fontSize: 13, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={{ opacity: 0.85 }}>
              Add an Anthropic or Gemini API key to generate diagrams from a description.
            </span>
            <button type="button" onClick={onOpenSettings} style={ghostBtn}>
              Open Settings
            </button>
          </div>
        ) : (
          <>
            <label style={labelStyle}>
              <span style={labelText}>Description</span>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe the process in plain language, e.g. “A customer submits an order; if it's valid it's fulfilled, otherwise it's rejected.”"
                rows={6}
                style={{ ...inputStyle, resize: 'vertical', minHeight: 96 }}
              />
            </label>

            <label style={labelStyle}>
              <span style={labelText}>Provider</span>
              <select
                value={providerId}
                onChange={(e) => setProviderId(e.target.value as LiteProviderId)}
                style={inputStyle}
              >
                {configured.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>

            <label style={labelStyle}>
              <span style={labelText}>Model</span>
              <select value={modelId} onChange={(e) => setModelId(e.target.value)} style={inputStyle}>
                {providerSpec.models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>

            {mode === 'directory' && folders.length > 0 && (
              <label style={labelStyle}>
                <span style={labelText}>Target folder</span>
                <select
                  value={targetFolder}
                  onChange={(e) => setTargetFolder(e.target.value)}
                  style={inputStyle}
                >
                  {folders.map((f) => (
                    <option key={f.relPath} value={f.relPath}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <label style={labelStyle}>
              <span style={labelText}>Name</span>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Order process (optional)"
                style={inputStyle}
              />
            </label>

            <button
              type="button"
              onClick={() => void handleGenerate()}
              disabled={!canGenerate}
              style={{
                ...ghostBtn,
                background: canGenerate ? 'var(--orbitpm-accent)' : 'rgba(127,127,127,0.25)',
                color: canGenerate ? '#fff' : 'inherit',
                borderColor: canGenerate ? 'var(--orbitpm-accent)' : 'rgba(127,127,127,0.35)',
                cursor: canGenerate ? 'pointer' : 'not-allowed',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8
              }}
            >
              {busy && <Spinner />}
              {busy ? 'Generating…' : 'Generate'}
            </button>

            {!keyPresent && (
              <div style={{ fontSize: 12, color: 'var(--orbitpm-muted)' }}>
                No key stored for {providerSpec.label}.{' '}
                <button type="button" onClick={onOpenSettings} style={linkBtn}>
                  Add one in Settings
                </button>
                .
              </div>
            )}

            {error && (
              <div role="alert" style={errorBox}>
                <span>{error}</span>
                {offline && (
                  <span style={{ opacity: 0.85 }}>
                    Tip: this looks like a connectivity issue. Check your network.
                  </span>
                )}
              </div>
            )}

            {resultLabel && (
              <div role="status" style={okBox}>
                Created: {resultLabel}
              </div>
            )}
          </>
        )}

        <div style={noteBox}>
          Only <strong>Anthropic</strong> and <strong>Gemini</strong> can be called directly from a
          web page. {DESKTOP_ONLY_PROVIDERS.join(', ')} don&apos;t allow browser (CORS) access — use
          the desktop app or the future web backend for those.
        </div>
      </div>
    </div>
  )
}

function Spinner(): JSX.Element {
  return (
    <span
      aria-hidden
      style={{
        width: 14,
        height: 14,
        border: '2px solid rgba(255,255,255,0.5)',
        borderTopColor: '#fff',
        borderRadius: '50%',
        display: 'inline-block',
        animation: 'orbitpm-spin 0.7s linear infinite'
      }}
    />
  )
}

const wrap: CSSProperties = {
  borderLeft: '1px solid var(--orbitpm-border)',
  width: 320,
  display: 'flex',
  flexDirection: 'column',
  minHeight: 0,
  overflowY: 'auto'
}
const collapsedWrap: CSSProperties = {
  borderLeft: '1px solid var(--orbitpm-border)',
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'center',
  padding: '0.5rem'
}
const collapsedBtn: CSSProperties = {
  writingMode: 'vertical-rl',
  transform: 'rotate(180deg)',
  padding: '0.6rem 0.35rem',
  cursor: 'pointer',
  border: '1px solid rgba(127,127,127,0.35)',
  borderRadius: 6,
  background: 'transparent'
}
const panelHeader: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '0.6rem 0.8rem',
  borderBottom: '1px solid var(--orbitpm-border)'
}
const hideBtn: CSSProperties = {
  cursor: 'pointer',
  border: 'none',
  background: 'transparent',
  fontSize: 16
}
const labelStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4 }
const labelText: CSSProperties = { fontSize: 12, opacity: 0.8 }
const inputStyle: CSSProperties = {
  padding: '0.4rem 0.5rem',
  borderRadius: 6,
  border: '1px solid rgba(127,127,127,0.4)',
  background: 'transparent',
  color: 'inherit',
  font: 'inherit',
  fontSize: 13
}
const ghostBtn: CSSProperties = {
  padding: '0.5rem 0.7rem',
  borderRadius: 6,
  border: '1px solid rgba(127,127,127,0.35)',
  background: 'transparent',
  font: 'inherit',
  fontSize: 13,
  cursor: 'pointer'
}
const linkBtn: CSSProperties = {
  border: 'none',
  background: 'transparent',
  color: 'var(--orbitpm-accent)',
  textDecoration: 'underline',
  cursor: 'pointer',
  font: 'inherit',
  padding: 0
}
const warnBox: CSSProperties = {
  fontSize: 12,
  padding: '0.5rem 0.6rem',
  borderRadius: 6,
  background: 'rgba(234,179,8,0.15)',
  border: '1px solid rgba(234,179,8,0.4)'
}
const errorBox: CSSProperties = {
  fontSize: 12,
  padding: '0.5rem 0.6rem',
  borderRadius: 6,
  background: 'rgba(239,68,68,0.12)',
  border: '1px solid rgba(239,68,68,0.4)',
  display: 'flex',
  flexDirection: 'column',
  gap: 6
}
const okBox: CSSProperties = {
  fontSize: 13,
  padding: '0.5rem 0.6rem',
  borderRadius: 6,
  background: 'rgba(34,197,94,0.12)',
  border: '1px solid rgba(34,197,94,0.4)',
  wordBreak: 'break-all'
}
const noteBox: CSSProperties = {
  fontSize: 11.5,
  lineHeight: 1.5,
  color: 'var(--orbitpm-muted)',
  borderTop: '1px dashed var(--orbitpm-border)',
  paddingTop: 10
}

export default AiPanelLite
