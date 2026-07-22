import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import {
  LITE_PROVIDERS,
  DESKTOP_ONLY_PROVIDERS,
  getLiteProvider,
  defaultLiteModelId,
  type LiteProviderId
} from './providersLite'
import {
  generateDiagramXml,
  generateDiagramXmlFromPdf,
  classifyBrowserError
} from './browserAi'
import { getKey, hasKey, getCustomConfig, customConfigReady } from './keys'
import { checkPdfSize, fileToBase64 } from './pdf'

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

type GenMode = 'description' | 'pdf'

export function AiPanelLite({
  folders,
  onPlaceGenerated,
  onOpenSettings,
  collapsed,
  onToggle,
  keysVersion,
  mode
}: AiPanelLiteProps): JSX.Element {
  const [providerId, setProviderId] = useState<LiteProviderId>('openrouter')
  const [modelId, setModelId] = useState<string>(() => defaultLiteModelId('openrouter'))
  const [genMode, setGenMode] = useState<GenMode>('description')
  const [description, setDescription] = useState('')
  const [pdfFile, setPdfFile] = useState<File | null>(null)
  const [hint, setHint] = useState('')
  const [name, setName] = useState('')
  const [targetFolder, setTargetFolder] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [offline, setOffline] = useState(false)
  const [resultLabel, setResultLabel] = useState<string | null>(null)
  const [online, setOnline] = useState<boolean>(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine
  )
  const pdfInputRef = useRef<HTMLInputElement | null>(null)

  // Re-read key + custom-endpoint availability whenever Settings closes.
  const configuredIds = useMemo(
    () => LITE_PROVIDERS.filter((p) => hasKey(p.id)).map((p) => p.id),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [keysVersion]
  )
  const customCfg = useMemo(
    () => getCustomConfig(),
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

  // Default the provider to the first one with a key, once keys are known.
  useEffect(() => {
    if (configuredIds.length === 0) return
    setProviderId((prev) => (configuredIds.includes(prev) ? prev : configuredIds[0]))
  }, [configuredIds])

  const providerSpec = getLiteProvider(providerId)

  useEffect(() => {
    setModelId(defaultLiteModelId(providerId))
  }, [providerId])

  // Custom endpoint has no verified PDF path — snap back to description mode.
  useEffect(() => {
    if (!providerSpec.supportsPdf && genMode === 'pdf') setGenMode('description')
  }, [providerSpec.supportsPdf, genMode])

  useEffect(() => {
    if (folders.length === 0) return
    setTargetFolder((prev) => (folders.some((f) => f.relPath === prev) ? prev : folders[0].relPath))
  }, [folders])

  const keyPresent = hasKey(providerId)
  const isCustom = providerId === 'custom'
  const customReady = isCustom ? customConfigReady(customCfg) : true
  const effectiveModel = isCustom ? customCfg.model : modelId.trim()

  // Size gate for the currently-selected PDF (recomputed on file/provider change).
  const sizeGate = useMemo(
    () => (pdfFile ? checkPdfSize(providerId, pdfFile.size) : { ok: true }),
    [pdfFile, providerId]
  )

  const hasInput = genMode === 'description' ? Boolean(description.trim()) : Boolean(pdfFile)
  const canGenerate =
    !busy &&
    online &&
    keyPresent &&
    customReady &&
    Boolean(effectiveModel) &&
    hasInput &&
    (genMode === 'description' || sizeGate.ok)

  const handleGenerate = useCallback(async () => {
    setBusy(true)
    setError(null)
    setOffline(false)
    setResultLabel(null)
    try {
      const apiKey = getKey(providerId)
      if (!apiKey) throw new Error('No API key for this provider. Add one in Settings.')
      const common = {
        providerId,
        modelId: effectiveModel,
        apiKey,
        baseURL: isCustom ? customCfg.baseURL : undefined,
        extraHeaders: isCustom ? customCfg.extraHeaders : undefined
      }
      let xml: string
      if (genMode === 'pdf') {
        if (!pdfFile) throw new Error('Choose a PDF file first.')
        const gate = checkPdfSize(providerId, pdfFile.size)
        if (!gate.ok) throw new Error(gate.message)
        const base64 = await fileToBase64(pdfFile)
        xml = await generateDiagramXmlFromPdf({
          ...common,
          description: '',
          attachment: {
            base64,
            mediaType: 'application/pdf',
            fileName: pdfFile.name,
            sizeBytes: pdfFile.size
          },
          hint
        })
      } else {
        xml = await generateDiagramXml({ ...common, description: description.trim() })
      }
      const placed = await onPlaceGenerated(xml, { name: name.trim(), targetFolder })
      setResultLabel(placed ? placed.label : 'Opened in a new tab (use Save to download).')
    } catch (err) {
      const classified = classifyBrowserError(err)
      setError(classified.message)
      setOffline(classified.offline || (typeof navigator !== 'undefined' && !navigator.onLine))
    } finally {
      setBusy(false)
    }
  }, [
    providerId,
    effectiveModel,
    isCustom,
    customCfg,
    genMode,
    pdfFile,
    hint,
    description,
    name,
    targetFolder,
    onPlaceGenerated
  ])

  if (collapsed) {
    return (
      <div style={collapsedWrap}>
        <button type="button" onClick={onToggle} title="Show AI panel" style={collapsedBtn}>
          ✨ Generate with AI
        </button>
      </div>
    )
  }

  const noKeysAtAll = configuredIds.length === 0

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

        {noKeysAtAll && (
          <div style={infoBox}>
            No API keys yet. Pick a provider below and{' '}
            <button type="button" onClick={onOpenSettings} style={linkBtn}>
              add a key in Settings
            </button>{' '}
            to generate — you can also test provider connectivity there without a key.
          </div>
        )}

        {/* Generation mode: description vs PDF */}
        <div role="tablist" aria-label="Generation source" style={segmentWrap}>
          <button
            type="button"
            role="tab"
            aria-selected={genMode === 'description'}
            onClick={() => setGenMode('description')}
            style={segmentBtn(genMode === 'description')}
          >
            From description
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={genMode === 'pdf'}
            onClick={() => setGenMode('pdf')}
            disabled={!providerSpec.supportsPdf}
            title={
              providerSpec.supportsPdf
                ? 'Generate from a PDF document'
                : 'PDF is not available for this provider'
            }
            style={segmentBtn(genMode === 'pdf')}
          >
            From PDF
          </button>
        </div>

        <label style={labelStyle}>
          <span style={labelText}>Provider</span>
          <select
            value={providerId}
            onChange={(e) => setProviderId(e.target.value as LiteProviderId)}
            style={inputStyle}
          >
            {LITE_PROVIDERS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
                {hasKey(p.id) ? ' ✓' : ''}
              </option>
            ))}
          </select>
        </label>

        {/* Model selector: free-text (with suggestions) for OpenRouter/Gemini,
            a fixed dropdown for Anthropic, and a Settings-driven note for Custom. */}
        {isCustom ? (
          <div style={{ fontSize: 12, color: 'var(--orbitpm-muted)' }}>
            Model &amp; endpoint are configured in{' '}
            <button type="button" onClick={onOpenSettings} style={linkBtn}>
              Settings
            </button>
            {customCfg.model ? (
              <>
                {' '}
                (model: <code>{customCfg.model}</code>).
              </>
            ) : (
              ' — set a base URL and model there first.'
            )}
          </div>
        ) : providerSpec.allowCustomModel ? (
          <label style={labelStyle}>
            <span style={labelText}>Model</span>
            <input
              type="text"
              list={`models-${providerId}`}
              value={modelId}
              onChange={(e) => setModelId(e.target.value)}
              placeholder="Model id"
              style={inputStyle}
            />
            <datalist id={`models-${providerId}`}>
              {providerSpec.models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </datalist>
          </label>
        ) : (
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
        )}

        {genMode === 'description' ? (
          <label style={labelStyle}>
            <span style={labelText}>Description</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe the process in plain language, e.g. “A customer submits an order; if it's valid it's fulfilled, otherwise it's rejected.”"
              rows={6}
              dir="auto"
              style={{ ...inputStyle, resize: 'vertical', minHeight: 96 }}
            />
          </label>
        ) : (
          <>
            <label style={labelStyle}>
              <span style={labelText}>PDF document</span>
              <input
                ref={pdfInputRef}
                type="file"
                accept="application/pdf,.pdf"
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null
                  setPdfFile(f)
                  setError(null)
                  setResultLabel(null)
                }}
                style={{ fontSize: 12.5 }}
              />
            </label>
            {pdfFile && (
              <div style={{ fontSize: 12, color: sizeGate.ok ? 'var(--orbitpm-muted)' : '#dc2626' }}>
                {pdfFile.name} · {(pdfFile.size / (1024 * 1024)).toFixed(1)} MB
                {!sizeGate.ok && sizeGate.message ? ` — ${sizeGate.message}` : ''}
              </div>
            )}
            <label style={labelStyle}>
              <span style={labelText}>
                Which process? <span style={{ opacity: 0.7 }}>(optional)</span>
              </span>
              <textarea
                value={hint}
                onChange={(e) => setHint(e.target.value)}
                placeholder="Which process from this document? / ما هي العملية المطلوبة من هذا المستند؟"
                rows={2}
                dir="auto"
                style={{ ...inputStyle, resize: 'vertical' }}
              />
            </label>
          </>
        )}

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
            dir="auto"
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
          {busy ? 'Generating…' : genMode === 'pdf' ? 'Generate from PDF' : 'Generate'}
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

        {isCustom && !customReady && (
          <div style={{ fontSize: 12, color: 'var(--orbitpm-muted)' }}>
            Set the base URL and model for the Custom endpoint in Settings.
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

        <div style={noteBox}>
          <strong>Anthropic</strong>, <strong>Gemini</strong>, and <strong>OpenRouter</strong> can be
          called directly from a web page. Reach GLM, Kimi, and DeepSeek through OpenRouter. The
          direct vendor APIs for {DESKTOP_ONLY_PROVIDERS.join(', ')} don&apos;t allow browser (CORS)
          access — use OpenRouter, a Custom endpoint, or the desktop app for those.
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
  background: 'transparent',
  color: 'inherit'
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
  fontSize: 16,
  color: 'inherit'
}
const segmentWrap: CSSProperties = {
  display: 'flex',
  gap: 4,
  padding: 3,
  borderRadius: 8,
  border: '1px solid rgba(127,127,127,0.3)'
}
function segmentBtn(active: boolean): CSSProperties {
  return {
    flex: 1,
    padding: '0.35rem 0.4rem',
    borderRadius: 6,
    border: 'none',
    fontSize: 12.5,
    cursor: 'pointer',
    background: active ? 'var(--orbitpm-accent)' : 'transparent',
    color: active ? '#fff' : 'inherit',
    font: 'inherit'
  }
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
  cursor: 'pointer',
  color: 'inherit'
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
const infoBox: CSSProperties = {
  fontSize: 12.5,
  lineHeight: 1.5,
  padding: '0.5rem 0.6rem',
  borderRadius: 6,
  background: 'rgba(59,130,246,0.12)',
  border: '1px solid rgba(59,130,246,0.35)'
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
