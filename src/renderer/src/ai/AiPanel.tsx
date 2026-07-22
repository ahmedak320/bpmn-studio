import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import {
  PROVIDER_LIST,
  defaultModelId,
  getProvider,
  type ProviderId
} from '../../../shared/providers'
import type { FolderOption } from './folders'
import './ai.css'

export interface AiPanelProps {
  /** Folder options for the target-folder select (from the workspace tree). */
  folders: FolderOption[]
  /** Open the freshly-generated file in an editor tab. */
  onOpenFile: (relPath: string) => void
  /** Called after a successful generation so the caller can refresh the tree. */
  onGenerated?: (relPath: string) => void
  /** Open the Settings modal (used by the "no providers configured" hint). */
  onOpenSettings: () => void
  collapsed: boolean
  onToggle: () => void
  /** Bump to force a re-fetch of provider availability (e.g. after Settings closes). */
  refreshToken?: number
}

const CONFIGURED_LABELS = new Map(PROVIDER_LIST.map((p) => [p.id, p.label]))

export function AiPanel({
  folders,
  onOpenFile,
  onGenerated,
  onOpenSettings,
  collapsed,
  onToggle,
  refreshToken
}: AiPanelProps): JSX.Element {
  const [available, setAvailable] = useState<AvailableProviderInfo[]>([])
  const [providersLoaded, setProvidersLoaded] = useState(false)
  const [providerId, setProviderId] = useState<ProviderId | ''>('')
  const [modelId, setModelId] = useState('')
  const [description, setDescription] = useState('')
  const [name, setName] = useState('')
  const [targetFolder, setTargetFolder] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [offline, setOffline] = useState(false)
  const [result, setResult] = useState<{ relPath: string } | null>(null)
  const [online, setOnline] = useState<boolean>(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine
  )

  // Track connectivity.
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

  // Load which providers are configured (re-runs when refreshToken changes).
  useEffect(() => {
    let cancelled = false
    setProvidersLoaded(false)
    window.orbitpm.providers
      .available()
      .then((list) => {
        if (cancelled) return
        setAvailable(list)
        setProvidersLoaded(true)
      })
      .catch(() => {
        if (cancelled) return
        setAvailable([])
        setProvidersLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [refreshToken])

  const configuredProviders = useMemo(
    () => available.filter((p) => p.configured),
    [available]
  )

  // Keep the selected provider valid as availability changes.
  useEffect(() => {
    if (configuredProviders.length === 0) {
      setProviderId('')
      return
    }
    setProviderId((prev) =>
      prev && configuredProviders.some((p) => p.id === prev)
        ? prev
        : (configuredProviders[0].id as ProviderId)
    )
  }, [configuredProviders])

  const providerSpec = providerId ? getProvider(providerId) : null

  // Reset the model when the provider changes.
  useEffect(() => {
    if (!providerId) {
      setModelId('')
      return
    }
    setModelId(defaultModelId(providerId) ?? '')
  }, [providerId])

  // Default the target folder to the first available (workspace root).
  useEffect(() => {
    if (folders.length === 0) return
    setTargetFolder((prev) => (folders.some((f) => f.relPath === prev) ? prev : folders[0].relPath))
  }, [folders])

  const canGenerate =
    !busy &&
    online &&
    Boolean(providerId) &&
    Boolean(modelId.trim()) &&
    Boolean(description.trim())

  const handleGenerate = useCallback(async () => {
    if (!providerId) return
    setBusy(true)
    setError(null)
    setOffline(false)
    setResult(null)
    try {
      const res = await window.orbitpm.ai.generate({
        description: description.trim(),
        providerId,
        modelId: modelId.trim(),
        targetFolder,
        name: name.trim()
      })
      if (res.ok && res.relPath) {
        setResult({ relPath: res.relPath })
        onGenerated?.(res.relPath)
        onOpenFile(res.relPath)
      } else {
        setError(res.error ?? 'Generation failed.')
        setOffline(Boolean(res.offline) || !navigator.onLine)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setOffline(!navigator.onLine)
    } finally {
      setBusy(false)
    }
  }, [providerId, modelId, description, targetFolder, name, onGenerated, onOpenFile])

  if (collapsed) {
    return (
      <div
        style={{
          borderLeft: '1px solid rgba(127,127,127,0.25)',
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'center',
          padding: '0.5rem'
        }}
      >
        <button
          type="button"
          onClick={onToggle}
          title="Show AI panel"
          style={{
            writingMode: 'vertical-rl',
            transform: 'rotate(180deg)',
            padding: '0.6rem 0.35rem',
            cursor: 'pointer',
            border: '1px solid rgba(127,127,127,0.35)',
            borderRadius: 6,
            background: 'transparent',
            font: 'inherit'
          }}
        >
          ✨ Generate with AI
        </button>
      </div>
    )
  }

  const noProviders = providersLoaded && configuredProviders.length === 0

  return (
    <div
      style={{
        borderLeft: '1px solid rgba(127,127,127,0.25)',
        width: 320,
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        overflowY: 'auto'
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0.6rem 0.8rem',
          borderBottom: '1px solid rgba(127,127,127,0.2)'
        }}
      >
        <strong style={{ fontSize: 14 }}>✨ Generate with AI</strong>
        <button
          type="button"
          onClick={onToggle}
          title="Hide AI panel"
          style={{ cursor: 'pointer', border: 'none', background: 'transparent', fontSize: 16 }}
        >
          ⟩
        </button>
      </header>

      <div style={{ padding: '0.8rem', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {!online && (
          <div
            role="status"
            style={{
              fontSize: 12,
              padding: '0.5rem 0.6rem',
              borderRadius: 6,
              background: 'rgba(234,179,8,0.15)',
              border: '1px solid rgba(234,179,8,0.4)'
            }}
          >
            You appear to be offline. AI generation needs an internet connection; drawing and
            organizing diagrams still works.
          </div>
        )}

        {noProviders ? (
          <div style={{ fontSize: 13, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={{ opacity: 0.8 }}>
              No AI providers are configured yet. Add an API key to enable generation.
            </span>
            <button type="button" onClick={onOpenSettings} style={buttonStyle}>
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
                onChange={(e) => setProviderId(e.target.value as ProviderId)}
                disabled={!providersLoaded || configuredProviders.length === 0}
                style={inputStyle}
              >
                {configuredProviders.map((p) => (
                  <option key={p.id} value={p.id}>
                    {CONFIGURED_LABELS.get(p.id) ?? p.id}
                  </option>
                ))}
              </select>
            </label>

            {providerSpec && (
              <label style={labelStyle}>
                <span style={labelText}>Model</span>
                {providerSpec.allowCustomModel ? (
                  <>
                    <input
                      type="text"
                      value={modelId}
                      onChange={(e) => setModelId(e.target.value)}
                      list={`ai-${providerSpec.id}-models`}
                      placeholder={
                        providerSpec.models.length === 0 ? 'deployment / model id' : undefined
                      }
                      style={inputStyle}
                    />
                    {providerSpec.models.length > 0 && (
                      <datalist id={`ai-${providerSpec.id}-models`}>
                        {providerSpec.models.map((m) => (
                          <option key={m.id} value={m.id} />
                        ))}
                      </datalist>
                    )}
                  </>
                ) : (
                  <select
                    value={modelId}
                    onChange={(e) => setModelId(e.target.value)}
                    style={inputStyle}
                  >
                    {providerSpec.models.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                )}
              </label>
            )}

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
                ...buttonStyle,
                background: canGenerate ? '#2563eb' : 'rgba(127,127,127,0.25)',
                color: canGenerate ? '#fff' : 'inherit',
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

            {error && (
              <div
                role="alert"
                style={{
                  fontSize: 12,
                  padding: '0.5rem 0.6rem',
                  borderRadius: 6,
                  background: 'rgba(239,68,68,0.12)',
                  border: '1px solid rgba(239,68,68,0.4)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6
                }}
              >
                <span>{error}</span>
                {offline && (
                  <span style={{ opacity: 0.85 }}>
                    Tip: this looks like a connectivity issue. Check your network or corporate
                    proxy.
                  </span>
                )}
              </div>
            )}

            {result && (
              <div
                role="status"
                style={{
                  fontSize: 13,
                  padding: '0.5rem 0.6rem',
                  borderRadius: 6,
                  background: 'rgba(34,197,94,0.12)',
                  border: '1px solid rgba(34,197,94,0.4)'
                }}
              >
                Created{' '}
                <button
                  type="button"
                  onClick={() => onOpenFile(result.relPath)}
                  style={{
                    border: 'none',
                    background: 'transparent',
                    color: '#2563eb',
                    textDecoration: 'underline',
                    cursor: 'pointer',
                    font: 'inherit',
                    padding: 0
                  }}
                >
                  {result.relPath}
                </button>
              </div>
            )}
          </>
        )}
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
const buttonStyle: CSSProperties = {
  padding: '0.5rem 0.7rem',
  borderRadius: 6,
  border: '1px solid rgba(127,127,127,0.35)',
  background: 'transparent',
  color: 'inherit',
  font: 'inherit',
  fontSize: 13,
  cursor: 'pointer'
}

export default AiPanel
