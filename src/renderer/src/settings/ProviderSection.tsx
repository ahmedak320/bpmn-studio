import { useEffect, useState } from 'react'
import type { ProviderSpec } from '../../../shared/providers'
import type { KeyFieldStatus, SettingsHandlers, TestConnectionResult } from './types'

interface ProviderSectionProps extends SettingsHandlers {
  spec: ProviderSpec
  configured: boolean
}

/** One provider's card in the Settings modal: write-only key/config fields
 * (masked for secrets, never prefilled with the stored value — only a
 * "Configured (****abcd)" placeholder hint), model picker (or free-text for
 * Azure/GLM), save/clear, and an optional "Test connection" slot. */
export function ProviderSection({
  spec,
  configured,
  onGetKeys,
  onSetKey,
  onDeleteKey,
  onTestConnection
}: ProviderSectionProps): JSX.Element {
  // What the user has typed THIS session — never prefilled from the vault.
  const [fields, setFields] = useState<Record<string, string>>({})
  // Per-field configured/last4 status, fetched from the vault (no values).
  const [keyStatus, setKeyStatus] = useState<Record<string, KeyFieldStatus>>({})
  const [modelId, setModelId] = useState<string>(spec.models[0]?.id ?? '')
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error' | 'testing'>('idle')
  const [testResult, setTestResult] = useState<TestConnectionResult | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    onGetKeys(spec.id).then((existing) => {
      if (cancelled) return
      setKeyStatus(existing)
      setLoaded(true)
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spec.id])

  function updateField(name: string, value: string): void {
    setFields((prev) => ({ ...prev, [name]: value }))
    setStatus('idle')
  }

  async function handleSave(): Promise<void> {
    setStatus('saving')
    try {
      // Only send fields the user actually typed into this session — a
      // blank input must never overwrite an already-configured value.
      const toSend: Record<string, string> = {}
      for (const f of spec.keyFields) {
        const value = fields[f.name]
        if (value) toSend[f.name] = value
      }
      await onSetKey(spec.id, toSend)
      const refreshed = await onGetKeys(spec.id)
      setKeyStatus(refreshed)
      setFields({})
      setStatus('saved')
    } catch {
      setStatus('error')
    }
  }

  async function handleClear(): Promise<void> {
    setStatus('saving')
    try {
      await onDeleteKey(spec.id)
      setFields({})
      setKeyStatus({})
      setTestResult(null)
      setStatus('saved')
    } catch {
      setStatus('error')
    }
  }

  async function handleTest(): Promise<void> {
    if (!onTestConnection) return
    setStatus('testing')
    setTestResult(null)
    try {
      const result = await onTestConnection(spec.id, modelId)
      setTestResult(result)
    } finally {
      setStatus('idle')
    }
  }

  return (
    <section className="settings-provider" data-provider={spec.id} aria-busy={!loaded}>
      <header className="settings-provider__header">
        <h3>{spec.label}</h3>
        <span
          className={
            configured ? 'settings-badge settings-badge--ok' : 'settings-badge settings-badge--off'
          }
        >
          {configured ? 'Configured' : 'Not configured'}
        </span>
      </header>
      <p className="settings-provider__desc">{spec.description}</p>

      <div className="settings-provider__fields">
        {spec.keyFields.map((field) => {
          const stored = keyStatus[field.name]
          const placeholder = stored?.configured
            ? `Configured (****${stored.last4 ?? ''})`
            : field.placeholder
          return (
            <label key={field.name} className="settings-field">
              <span>{field.label}</span>
              <div className="settings-field__input-row">
                <input
                  type={field.kind === 'secret' ? 'password' : 'text'}
                  value={fields[field.name] ?? ''}
                  placeholder={placeholder}
                  autoComplete="off"
                  onChange={(e) => updateField(field.name, e.target.value)}
                />
              </div>
            </label>
          )
        })}

        {spec.models.length > 0 && (
          <label className="settings-field">
            <span>Model</span>
            {spec.allowCustomModel ? (
              <input
                type="text"
                value={modelId}
                onChange={(e) => setModelId(e.target.value)}
                list={`${spec.id}-models`}
              />
            ) : (
              <select value={modelId} onChange={(e) => setModelId(e.target.value)}>
                {spec.models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            )}
            {spec.allowCustomModel && spec.models.length > 0 && (
              <datalist id={`${spec.id}-models`}>
                {spec.models.map((m) => (
                  <option key={m.id} value={m.id} />
                ))}
              </datalist>
            )}
          </label>
        )}

        {spec.allowCustomModel && spec.models.length === 0 && (
          <label className="settings-field">
            <span>Model / deployment id</span>
            <input type="text" value={modelId} onChange={(e) => setModelId(e.target.value)} />
          </label>
        )}
      </div>

      <div className="settings-provider__actions">
        <button type="button" onClick={handleSave} disabled={status === 'saving'}>
          Save
        </button>
        <button type="button" onClick={handleClear} disabled={status === 'saving'}>
          Clear
        </button>
        {onTestConnection && (
          <button type="button" onClick={handleTest} disabled={status === 'testing'}>
            {status === 'testing' ? 'Testing…' : 'Test connection'}
          </button>
        )}
        {status === 'saved' && <span className="settings-status settings-status--ok">Saved</span>}
        {status === 'error' && (
          <span className="settings-status settings-status--error">Failed to save</span>
        )}
        {testResult && (
          <span
            className={
              testResult.ok
                ? 'settings-status settings-status--ok'
                : 'settings-status settings-status--error'
            }
          >
            {testResult.message}
          </span>
        )}
      </div>
    </section>
  )
}
