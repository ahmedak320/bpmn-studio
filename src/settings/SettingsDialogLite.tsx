import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import { LITE_PROVIDERS, type LiteProviderId } from '../ai/providersLite'
import {
  getKey,
  setKey,
  clearKey,
  keyLast4,
  hasEncryptedKey,
  persistEncryptedKey,
  unlockEncryptedKey,
  migrateLegacyPlaintextKeys
} from '../ai/keys'
import { getProviderSelection, setProviderSelection } from '../ai/providerSelection'
import { defaultLiteModelId, getLiteProvider } from '../ai/providersLite'
import {
  buildTestConnectionReview,
  testConnection,
  type ProviderConfig,
  type TestConnectionResult
} from '../ai/browserAi'
import {
  fetchOpenRouterCredits,
  getUsageSnapshot,
  resetUsage,
  subscribeUsage,
  CreditsError,
  type CreditsErrorKind,
  type OpenRouterCredits
} from '../ai/credits'
import { CreditsLine } from '../ai/CreditsLine'
import {
  isOrgStylingOn,
  setOrgStyling,
  isCompletenessOn,
  setCompletenessOn
} from '../org/orgSettings'
import { t } from '../i18n'
import { useLang } from '../i18n/useLang'

export interface SettingsDialogLiteProps {
  open: boolean
  onClose: () => void
  /** Called after keys change so the AI panel can re-evaluate availability. */
  onKeysChanged: () => void
  /** Called after the DMT org-styling flag is toggled so every open modeler can
   *  be re-rendered against the new value (App loops refreshOrgStyling). */
  onOrgStylingChanged?: () => void
}

/**
 * Per-provider API-key manager for the three browser-callable providers.
 * Key fields are write-only: an already-stored key shows a "Configured
 * (••••1234)" placeholder and is only overwritten when you type a new value +
 * Save; Clear removes it. Every provider has a "Test connection" button that
 * truthfully distinguishes a CORS block from an auth failure (see
 * browserAi.testConnection). Everything lives in localStorage — the warning
 * banner makes the session-only default and encrypted opt-in explicit.
 */
export function SettingsDialogLite({
  open,
  onClose,
  onKeysChanged,
  onOrgStylingChanged
}: SettingsDialogLiteProps): JSX.Element | null {
  useLang()
  const [orgStyling, setOrgStylingState] = useState<boolean>(() => isOrgStylingOn())
  const [completeness, setCompletenessState] = useState<boolean>(() => isCompletenessOn())
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [saved, setSaved] = useState<string | null>(null)
  const [storageError, setStorageError] = useState<string | null>(null)
  const [persistEncrypted, setPersistEncrypted] = useState(false)
  const [passphrase, setPassphrase] = useState('')
  const initialSelection = getProviderSelection()
  const [selectedProvider, setSelectedProvider] = useState<LiteProviderId | ''>(
    initialSelection?.providerId ?? ''
  )
  const [selectedModel, setSelectedModel] = useState(initialSelection?.modelId ?? '')
  const [testing, setTesting] = useState<Record<string, boolean>>({})
  const [testConsent, setTestConsent] = useState<Record<string, boolean>>({})
  const [results, setResults] = useState<Record<string, TestConnectionResult>>({})
  // OpenRouter balance display state (Anthropic/Gemini have no balance API — they
  // show the local usage ledger instead, re-read via a bump on reset).
  const [credits, setCredits] = useState<OpenRouterCredits | null>(null)
  const [creditsLoading, setCreditsLoading] = useState(false)
  const [creditsError, setCreditsError] = useState<CreditsErrorKind | null>(null)
  const [, bumpUsage] = useState(0)

  const refreshCredits = useCallback(async () => {
    const key = getKey('openrouter')
    if (!key) {
      setCredits(null)
      setCreditsError(null)
      setCreditsLoading(false)
      return
    }
    setCreditsLoading(true)
    setCreditsError(null)
    try {
      const c = await fetchOpenRouterCredits(key)
      setCredits(c)
    } catch (err) {
      setCreditsError(err instanceof CreditsError ? err.kind : 'unexpected')
      setCredits(null)
    } finally {
      setCreditsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (open) {
      setDrafts({})
      setSaved(null)
      setStorageError(null)
      setPersistEncrypted(false)
      setPassphrase('')
      setResults({})
      setTestConsent({})
      setOrgStylingState(isOrgStylingOn())
      setCompletenessState(isCompletenessOn())
      const selection = getProviderSelection()
      setSelectedProvider(selection?.providerId ?? '')
      setSelectedModel(selection?.modelId ?? '')
      const migration = migrateLegacyPlaintextKeys(LITE_PROVIDERS.map((provider) => provider.id))
      if (!migration.ok) setStorageError(migration.error)
    }
  }, [open])

  useEffect(
    () =>
      subscribeUsage(() => {
        bumpUsage((value) => value + 1)
      }),
    []
  )

  // Escape closes the dialog (consistent with the app's other modals).
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!open) return null

  const save = async (): Promise<void> => {
    const failures: string[] = []
    for (const p of LITE_PROVIDERS) {
      const draft = drafts[p.id]
      if (draft !== undefined && draft.trim().length > 0) {
        const result = persistEncrypted
          ? await persistEncryptedKey(p.id, draft, passphrase)
          : setKey(p.id, draft)
        if (!result.ok) failures.push(`${p.label}: ${result.error}`)
      }
    }
    if (selectedProvider) {
      const selectionResult = setProviderSelection(selectedProvider, selectedModel)
      if (!selectionResult.ok) failures.push(selectionResult.error)
    }
    setDrafts({})
    if (failures.length > 0) {
      setSaved(null)
      setStorageError(failures.join(' '))
    } else {
      setStorageError(null)
      setSaved(t('settings.saved'))
    }
    onKeysChanged()
  }

  const unlockStoredKeys = async (): Promise<void> => {
    const failures: string[] = []
    let unlocked = 0
    for (const provider of LITE_PROVIDERS) {
      if (!hasEncryptedKey(provider.id)) continue
      const result = await unlockEncryptedKey(provider.id, passphrase)
      if (result.ok) unlocked += 1
      else failures.push(`${provider.label}: ${result.error}`)
    }
    if (failures.length > 0) {
      setSaved(null)
      setStorageError(failures.join(' '))
    } else {
      setStorageError(null)
      setSaved(t('settings.encryption.unlocked', { count: unlocked }))
      setPassphrase('')
      onKeysChanged()
    }
  }

  const testModelFor = (providerId: LiteProviderId): string =>
    selectedProvider === providerId && selectedModel.trim()
      ? selectedModel.trim()
      : defaultLiteModelId(providerId)

  const runTest = async (providerId: LiteProviderId): Promise<void> => {
    setTesting((t) => ({ ...t, [providerId]: true }))
    setResults((r) => {
      const next = { ...r }
      delete next[providerId]
      return next
    })
    // Prefer a freshly-typed draft key so users can test before saving; fall
    // back to the stored key; the probe itself uses a dummy when both are empty.
    const draftKey = drafts[providerId]
    const apiKey = draftKey && draftKey.trim() ? draftKey.trim() : getKey(providerId)
    const cfg: ProviderConfig = {
      providerId,
      model: testModelFor(providerId),
      apiKey,
      referer: typeof location !== 'undefined' ? location.origin : undefined,
      title: t('app.title')
    }
    try {
      const result = await testConnection(cfg)
      setResults((r) => ({ ...r, [providerId]: result }))
    } catch (err) {
      // testConnection resolves for every real outcome; this only trips on an
      // unexpected throw. Surface it as a blocked verdict with the raw message.
      setResults((r) => ({
        ...r,
        [providerId]: {
          reachable: false,
          blockedOrUnreachable: true,
          code: 'blocked',
          message: err instanceof Error ? err.message : String(err)
        }
      }))
    } finally {
      setTesting((t) => ({ ...t, [providerId]: false }))
    }
  }

  const hasStoredCiphertext = LITE_PROVIDERS.some((provider) => hasEncryptedKey(provider.id))

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('settings.title')}
      style={overlay}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div style={panel}>
        <header style={header}>
          <strong>{t('settings.title.providers')}</strong>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('settings.close.aria')}
            style={closeBtn}
          >
            ×
          </button>
        </header>

        <div style={{ padding: '0.9rem 1rem', display: 'flex', flexDirection: 'column', gap: 18 }}>
          <section
            aria-label={t('settings.diagram.title')}
            style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
          >
            <span style={{ fontWeight: 600, fontSize: 14 }}>{t('settings.diagram.title')}</span>
            <label
              style={{ display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer' }}
            >
              <input
                type="checkbox"
                aria-label={t('settings.orgStyling.label')}
                checked={orgStyling}
                onChange={(e) => {
                  const next = e.target.checked
                  setOrgStyling(next)
                  setOrgStylingState(next)
                  onOrgStylingChanged?.()
                }}
                style={{ marginTop: 3 }}
              />
              <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontWeight: 600, fontSize: 13 }}>
                  {t('settings.orgStyling.label')}
                </span>
                <span style={{ fontSize: 11.5, color: 'var(--orbitpm-muted)' }}>
                  {t('settings.orgStyling.desc')}
                </span>
              </span>
            </label>
            <label
              style={{ display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer' }}
            >
              <input
                type="checkbox"
                aria-label={t('settings.completeness.label')}
                checked={completeness}
                onChange={(e) => {
                  const next = e.target.checked
                  setCompletenessOn(next)
                  setCompletenessState(next)
                  // Same repaint hook as the styling toggle: App sweeps every
                  // open modeler with refreshOrgStyling, and the renderer reads
                  // isCompletenessOn() live on each draw.
                  onOrgStylingChanged?.()
                }}
                style={{ marginTop: 3 }}
              />
              <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontWeight: 600, fontSize: 13 }}>
                  {t('settings.completeness.label')}
                </span>
                <span style={{ fontSize: 11.5, color: 'var(--orbitpm-muted)' }}>
                  {t('settings.completeness.hint')}
                </span>
              </span>
            </label>
          </section>

          <div style={warning} role="note">
            ⚠️ {t('settings.keyStorageWarning')}
          </div>

          <section
            aria-label={t('settings.aiSelection.title')}
            style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
          >
            <span style={{ fontWeight: 600, fontSize: 14 }}>{t('settings.aiSelection.title')}</span>
            <label style={labelStack}>
              <span>{t('ai.provider.label')}</span>
              <select
                value={selectedProvider}
                onChange={(event) => {
                  const providerId = event.target.value as LiteProviderId | ''
                  setSelectedProvider(providerId)
                  setSelectedModel(providerId ? defaultLiteModelId(providerId) : '')
                  setTestConsent({})
                  setResults({})
                }}
                style={input}
              >
                <option value="">{t('ai.provider.select')}</option>
                {LITE_PROVIDERS.map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {provider.label}
                  </option>
                ))}
              </select>
            </label>
            {selectedProvider &&
              (getLiteProvider(selectedProvider).allowCustomModel ? (
                <label style={labelStack}>
                  <span>{t('ai.model.label')}</span>
                  <input
                    type="text"
                    value={selectedModel}
                    list="settings-ai-models"
                    onChange={(event) => {
                      setSelectedModel(event.target.value)
                      setTestConsent({})
                      setResults({})
                    }}
                    style={input}
                  />
                  <datalist id="settings-ai-models">
                    {getLiteProvider(selectedProvider).models.map((model) => (
                      <option key={model.id} value={model.id}>
                        {model.label}
                      </option>
                    ))}
                  </datalist>
                </label>
              ) : (
                <label style={labelStack}>
                  <span>{t('ai.model.label')}</span>
                  <select
                    value={selectedModel}
                    onChange={(event) => {
                      setSelectedModel(event.target.value)
                      setTestConsent({})
                      setResults({})
                    }}
                    style={input}
                  >
                    {getLiteProvider(selectedProvider).models.map((model) => (
                      <option key={model.id} value={model.id}>
                        {model.label}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            <span style={{ fontSize: 11.5, color: 'var(--orbitpm-muted)' }}>
              {t('settings.aiSelection.hint')}
            </span>
          </section>

          <section
            aria-label={t('settings.encryption.title')}
            style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
          >
            <span style={{ fontWeight: 600, fontSize: 14 }}>{t('settings.encryption.title')}</span>
            <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <input
                type="checkbox"
                checked={persistEncrypted}
                onChange={(event) => setPersistEncrypted(event.target.checked)}
              />
              <span>{t('settings.encryption.persist')}</span>
            </label>
            <input
              type="password"
              autoComplete="new-password"
              value={passphrase}
              onChange={(event) => setPassphrase(event.target.value)}
              aria-label={t('settings.encryption.passphrase')}
              placeholder={t('settings.encryption.passphrase')}
              style={input}
            />
            {hasStoredCiphertext && (
              <button
                type="button"
                onClick={() => void unlockStoredKeys()}
                disabled={!passphrase}
                style={ghostBtn}
              >
                {t('settings.encryption.unlock')}
              </button>
            )}
            <span style={{ fontSize: 11.5, color: 'var(--orbitpm-muted)' }}>
              {t('settings.encryption.hint')}
            </span>
          </section>

          {storageError && (
            <div role="alert" style={errorBox}>
              {storageError}
            </div>
          )}

          {LITE_PROVIDERS.map((p) => {
            const configured = getKey(p.id).length > 0
            const encryptedStored = hasEncryptedKey(p.id)
            const last4 = keyLast4(p.id)
            const value = drafts[p.id] ?? ''
            const result = results[p.id]
            const testReview = buildTestConnectionReview({
              providerId: p.id,
              model: testModelFor(p.id),
              apiKey: ''
            })
            return (
              <section
                key={p.id}
                aria-label={p.label}
                style={{ display: 'flex', flexDirection: 'column', gap: 6 }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'baseline'
                  }}
                >
                  <span style={{ fontWeight: 600, fontSize: 14 }}>{p.label}</span>
                  {p.keysUrl && (
                    <a
                      href={p.keysUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      style={{ fontSize: 12, color: 'var(--orbitpm-accent)' }}
                    >
                      {t('settings.getKey')}
                    </a>
                  )}
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--orbitpm-muted)' }}>
                  {providerDescription(p.id)}
                </div>

                <input
                  type="password"
                  autoComplete="off"
                  aria-label={t('settings.apiKey.aria', { label: p.label })}
                  value={value}
                  placeholder={
                    configured
                      ? t('settings.keyPlaceholder.configured', { last4 })
                      : encryptedStored
                        ? t('settings.keyPlaceholder.encrypted')
                        : t('settings.keyPlaceholder.empty')
                  }
                  onChange={(e) => setDrafts((d) => ({ ...d, [p.id]: e.target.value }))}
                  style={input}
                />

                <div
                  role="note"
                  aria-label={t('ai.privacy.preview.title')}
                  style={{
                    padding: 8,
                    border: '1px solid var(--orbitpm-border)',
                    borderRadius: 6,
                    display: 'grid',
                    gap: 4,
                    fontSize: 11.5,
                    color: 'var(--orbitpm-muted)'
                  }}
                >
                  <strong style={{ color: 'inherit' }}>{t('ai.privacy.preview.title')}</strong>
                  <span>
                    {t('ai.privacy.providerModel', {
                      provider: p.label,
                      model: testReview.modelId
                    })}
                  </span>
                  <span>
                    {t('ai.privacy.requestCount', {
                      count: testReview.requestCount
                    })}
                  </span>
                  <code
                    dir="ltr"
                    style={{
                      padding: 6,
                      borderRadius: 4,
                      background: 'rgba(127,127,127,0.08)',
                      overflowWrap: 'anywhere',
                      whiteSpace: 'pre-wrap'
                    }}
                  >
                    {JSON.stringify(testReview.payload)}
                  </code>
                </div>

                <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                  <input
                    type="checkbox"
                    checked={Boolean(testConsent[p.id])}
                    onChange={(event) =>
                      setTestConsent((current) => ({
                        ...current,
                        [p.id]: event.target.checked
                      }))
                    }
                  />
                  <span style={{ fontSize: 11.5, color: 'var(--orbitpm-muted)' }}>
                    {t('settings.testConnection.billableDisclosure')}
                  </span>
                </label>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    onClick={() => void runTest(p.id)}
                    disabled={testing[p.id] || !testConsent[p.id]}
                    style={ghostBtn}
                  >
                    {testing[p.id]
                      ? t('settings.testConnection.testing')
                      : t('settings.testConnection')}
                  </button>
                  {(configured || encryptedStored) && (
                    <button
                      type="button"
                      onClick={() => {
                        const result = clearKey(p.id)
                        setDrafts((d) => {
                          const next = { ...d }
                          delete next[p.id]
                          return next
                        })
                        if (result.ok) {
                          setStorageError(null)
                          setSaved(t('settings.keyCleared'))
                        } else {
                          setSaved(null)
                          setStorageError(result.error)
                        }
                        onKeysChanged()
                      }}
                      style={ghostBtn}
                    >
                      {t('settings.clearKey')}
                    </button>
                  )}
                </div>

                {configured && p.id === 'openrouter' && (
                  <CreditsLine
                    state={
                      creditsLoading
                        ? { kind: 'loading' }
                        : creditsError
                          ? { kind: 'error', errorKind: creditsError }
                          : credits
                            ? { kind: 'credits', remaining: credits.remaining }
                            : { kind: 'idle' }
                    }
                    onRefresh={() => void refreshCredits()}
                  />
                )}
                {configured && (
                  <UsageLine
                    providerId={p.id}
                    onReset={() => bumpUsage((v) => v + 1)}
                    note={p.id !== 'openrouter'}
                  />
                )}

                {result && (
                  <div role="status" style={verdictStyle(result)}>
                    {result.blockedOrUnreachable ? '⛔ ' : result.reachable ? '✅ ' : 'ℹ️ '}
                    {verdictMessage(result)}
                  </div>
                )}
              </section>
            )
          })}
        </div>

        <footer style={footer}>
          {saved && <span style={{ fontSize: 12, color: 'var(--orbitpm-muted)' }}>{saved}</span>}
          <span style={{ flex: 1 }} />
          <button type="button" onClick={onClose} style={ghostBtn}>
            {t('settings.close')}
          </button>
          <button
            type="button"
            onClick={() => void save()}
            className="orbitpm-lite-primary"
            style={{ fontSize: 13 }}
          >
            {t('settings.saveKeys')}
          </button>
        </footer>
      </div>
    </div>
  )
}

/** Local usage-ledger line for a provider with no balance API (Anthropic/Gemini):
 *  session/all-time totals + a reset link + the "no balance API" note.
 *  re-read on every render; the parent's onReset bump forces that re-render. */
function UsageLine({
  providerId,
  onReset,
  note
}: {
  providerId: LiteProviderId
  onReset: () => void
  note: boolean
}): JSX.Element {
  const usage = getUsageSnapshot(providerId)
  return (
    <CreditsLine
      state={{
        kind: 'usage',
        session: usage.session,
        allTime: usage.allTime
      }}
      onReset={() => {
        resetUsage(providerId)
        onReset()
      }}
      note={note}
    />
  )
}

/** Localized one-line provider blurb (kept out of providersLite so it's RTL-safe). */
function providerDescription(id: LiteProviderId): string {
  switch (id) {
    case 'openrouter':
      return t('ai.provider.openrouter.desc')
    case 'anthropic':
      return t('ai.provider.anthropic.desc')
    case 'gemini':
      return t('ai.provider.gemini.desc')
  }
}

/** Render a test-connection verdict from its code (localized) — falls back to the
 * English `message` for any future/unknown code. */
function verdictMessage(r: TestConnectionResult): string {
  const status = r.status ?? ''
  switch (r.code) {
    case 'reachable-ok':
      return t('settings.verdict.reachableOk', { status })
    case 'reachable-auth':
      return t('settings.verdict.reachableAuth', { status })
    case 'reachable-other':
      return t('settings.verdict.reachableOther', { status })
    case 'blocked':
      return t('settings.verdict.blocked')
    case 'timeout':
      return t('settings.verdict.timeout')
    default:
      return r.message
  }
}

function verdictStyle(r: TestConnectionResult): CSSProperties {
  const tone = r.blockedOrUnreachable
    ? { bg: 'rgba(239,68,68,0.12)', border: 'rgba(239,68,68,0.4)' }
    : r.reachable
      ? { bg: 'rgba(34,197,94,0.12)', border: 'rgba(34,197,94,0.4)' }
      : { bg: 'rgba(234,179,8,0.12)', border: 'rgba(234,179,8,0.4)' }
  return {
    fontSize: 12,
    lineHeight: 1.45,
    padding: '0.45rem 0.55rem',
    borderRadius: 6,
    background: tone.bg,
    border: `1px solid ${tone.border}`
  }
}

const overlay: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.4)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1500
}
const panel: CSSProperties = {
  width: 520,
  maxWidth: '92vw',
  maxHeight: '88vh',
  overflow: 'auto',
  background: 'var(--orbitpm-panel-bg)',
  borderRadius: 10,
  boxShadow: '0 10px 40px rgba(0,0,0,0.35)'
}
const header: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '0.75rem 1rem',
  borderBottom: '1px solid var(--orbitpm-border)',
  position: 'sticky',
  top: 0,
  background: 'var(--orbitpm-panel-bg)'
}
const footer: CSSProperties = {
  display: 'flex',
  gap: 8,
  alignItems: 'center',
  padding: '0.7rem 1rem',
  borderTop: '1px solid var(--orbitpm-border)',
  position: 'sticky',
  bottom: 0,
  background: 'var(--orbitpm-panel-bg)'
}
const warning: CSSProperties = {
  fontSize: 12,
  lineHeight: 1.5,
  padding: '0.6rem 0.7rem',
  borderRadius: 8,
  background: 'rgba(234,179,8,0.15)',
  border: '1px solid rgba(234,179,8,0.4)'
}
const labelStack: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 5,
  fontSize: 12
}
const errorBox: CSSProperties = {
  fontSize: 12,
  lineHeight: 1.5,
  padding: '0.6rem 0.7rem',
  borderRadius: 8,
  color: 'var(--orbitpm-danger, #b91c1c)',
  background: 'rgba(239,68,68,0.1)',
  border: '1px solid rgba(239,68,68,0.4)'
}
const input: CSSProperties = {
  padding: '0.45rem 0.55rem',
  borderRadius: 6,
  border: '1px solid rgba(127,127,127,0.4)',
  background: 'transparent',
  color: 'inherit',
  font: 'inherit',
  fontSize: 13
}
const closeBtn: CSSProperties = {
  border: 'none',
  background: 'transparent',
  fontSize: 20,
  cursor: 'pointer',
  lineHeight: 1
}
const ghostBtn: CSSProperties = {
  padding: '0.4rem 0.7rem',
  borderRadius: 6,
  border: '1px solid rgba(127,127,127,0.35)',
  background: 'transparent',
  fontSize: 13,
  cursor: 'pointer',
  color: 'inherit'
}

export default SettingsDialogLite
