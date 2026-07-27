import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { LITE_PROVIDERS, type LiteProviderId } from '../ai/providersLite'
import {
  getKey,
  setKey,
  clearKey,
  keyLast4,
  hasEncryptedKey,
  persistEncryptedKey,
  unlockEncryptedKey,
  migrateLegacyCredentialsOnStartup,
  type KeyStorageErrorCode,
  type KeyStorageResult
} from '../ai/keys'
import { keyStorageErrorMessage } from '../ai/keyStorageErrorMessage'
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
import { AccessibleDialog } from '../common/AccessibleDialog'
import {
  LocalizationResourcesEditor,
  type LocalizationResourcesEditorProps
} from './LocalizationResourcesEditor'

export interface SettingsDialogLiteProps {
  open: boolean
  onClose: () => void
  /** Called after keys change so the AI panel can re-evaluate availability. */
  onKeysChanged: () => void
  /** Called after the DMT org-styling flag is toggled so every open modeler can
   *  be re-rendered against the new value (App loops refreshOrgStyling). */
  onOrgStylingChanged?: () => void
  /** Public workspace glossary/TM editor. Omit in single-file mode. */
  localizationResources?: LocalizationResourcesEditorProps
}

type StorageFailureContext = 'startup' | 'key-save' | 'provider-selection' | 'unlock' | 'clear'

interface StorageFailure {
  code: KeyStorageErrorCode
  context: StorageFailureContext
  detail: string | null
  providerLabel?: string
}

type CredentialOperationKind = 'save' | 'unlock'

interface ActiveCredentialOperation {
  id: number
  kind: CredentialOperationKind
  controller: AbortController
}

interface ActiveTestConnectionOperation {
  id: number
  providerId: LiteProviderId
  controller: AbortController
}

interface ActiveCreditsRefreshOperation {
  id: number
  controller: AbortController
}

function storageFailure(
  result: Extract<KeyStorageResult<unknown>, { ok: false }>,
  context: StorageFailureContext,
  providerLabel?: string
): StorageFailure {
  return {
    code: result.code,
    context,
    detail:
      result.code === 'storage-failed' || result.code === 'storage-unavailable'
        ? result.error
        : null,
    ...(providerLabel ? { providerLabel } : {})
  }
}

function storageFailureMessage(failure: StorageFailure): string {
  const error = keyStorageErrorMessage(failure.code)
  switch (failure.context) {
    case 'startup':
      return t('settings.storageError.startup', { error })
    case 'provider-selection':
      return t('settings.storageError.providerSelection', { error })
    case 'key-save':
      return t('settings.storageError.keySave', {
        provider: failure.providerLabel ?? t('settings.storageError.unknownProvider'),
        error
      })
    case 'unlock':
      return t('settings.storageError.unlock', {
        provider: failure.providerLabel ?? t('settings.storageError.unknownProvider'),
        error
      })
    case 'clear':
      return t('settings.storageError.clear', {
        provider: failure.providerLabel ?? t('settings.storageError.unknownProvider'),
        error
      })
  }
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
  onOrgStylingChanged,
  localizationResources
}: SettingsDialogLiteProps): JSX.Element | null {
  useLang()
  const [orgStyling, setOrgStylingState] = useState<boolean>(() => isOrgStylingOn())
  const [completeness, setCompletenessState] = useState<boolean>(() => isCompletenessOn())
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [saved, setSaved] = useState<string | null>(null)
  const [storageFailures, setStorageFailures] = useState<StorageFailure[]>([])
  const [pendingCredentialOperation, setPendingCredentialOperation] =
    useState<ActiveCredentialOperation | null>(null)
  const credentialOperationSequence = useRef(0)
  const activeCredentialOperation = useRef<ActiveCredentialOperation | null>(null)
  const testConnectionOperationSequence = useRef(0)
  const activeTestConnectionOperation = useRef<ActiveTestConnectionOperation | null>(null)
  const creditsRefreshOperationSequence = useRef(0)
  const activeCreditsRefreshOperation = useRef<ActiveCreditsRefreshOperation | null>(null)
  const mounted = useRef(true)
  const openRef = useRef(open)
  openRef.current = open
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

  const cancelCredentialOperation = useCallback((updatePendingState: boolean): void => {
    activeCredentialOperation.current?.controller.abort()
    activeCredentialOperation.current = null
    credentialOperationSequence.current += 1
    if (updatePendingState && mounted.current) setPendingCredentialOperation(null)
  }, [])

  const cancelTestConnection = useCallback((updateTestingState: boolean): void => {
    activeTestConnectionOperation.current?.controller.abort()
    activeTestConnectionOperation.current = null
    testConnectionOperationSequence.current += 1
    if (updateTestingState && mounted.current) setTesting({})
  }, [])

  const cancelCreditsRefresh = useCallback((updateLoadingState: boolean): void => {
    activeCreditsRefreshOperation.current?.controller.abort()
    activeCreditsRefreshOperation.current = null
    creditsRefreshOperationSequence.current += 1
    if (updateLoadingState && mounted.current) setCreditsLoading(false)
  }, [])

  const beginCredentialOperation = useCallback(
    (kind: CredentialOperationKind): ActiveCredentialOperation => {
      activeCredentialOperation.current?.controller.abort()
      const operation: ActiveCredentialOperation = {
        id: ++credentialOperationSequence.current,
        kind,
        controller: new AbortController()
      }
      activeCredentialOperation.current = operation
      setPendingCredentialOperation(operation)
      setSaved(null)
      setStorageFailures([])
      return operation
    },
    []
  )

  const credentialOperationIsCurrent = useCallback(
    (operation: ActiveCredentialOperation): boolean =>
      mounted.current &&
      openRef.current &&
      !operation.controller.signal.aborted &&
      activeCredentialOperation.current?.id === operation.id,
    []
  )

  const finishCredentialOperation = useCallback((operation: ActiveCredentialOperation): void => {
    if (activeCredentialOperation.current?.id !== operation.id) return
    activeCredentialOperation.current = null
    if (mounted.current) setPendingCredentialOperation(null)
  }, [])

  const refreshCredits = useCallback(async (): Promise<void> => {
    activeCreditsRefreshOperation.current?.controller.abort()
    const key = getKey('openrouter')
    if (!key) {
      activeCreditsRefreshOperation.current = null
      creditsRefreshOperationSequence.current += 1
      setCredits(null)
      setCreditsError(null)
      setCreditsLoading(false)
      return
    }
    const operation: ActiveCreditsRefreshOperation = {
      id: ++creditsRefreshOperationSequence.current,
      controller: new AbortController()
    }
    activeCreditsRefreshOperation.current = operation
    const operationIsCurrent = (): boolean =>
      mounted.current &&
      openRef.current &&
      !operation.controller.signal.aborted &&
      activeCreditsRefreshOperation.current?.id === operation.id

    setCreditsLoading(true)
    setCreditsError(null)
    try {
      const c = await fetchOpenRouterCredits(key, undefined, operation.controller.signal)
      if (!operationIsCurrent()) return
      setCredits(c)
    } catch (err) {
      if (!operationIsCurrent()) return
      setCreditsError(err instanceof CreditsError ? err.kind : 'unexpected')
      setCredits(null)
    } finally {
      if (activeCreditsRefreshOperation.current?.id === operation.id) {
        activeCreditsRefreshOperation.current = null
        if (mounted.current && openRef.current) setCreditsLoading(false)
      }
    }
  }, [])

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      activeCredentialOperation.current?.controller.abort()
      activeCredentialOperation.current = null
      credentialOperationSequence.current += 1
      activeTestConnectionOperation.current?.controller.abort()
      activeTestConnectionOperation.current = null
      testConnectionOperationSequence.current += 1
      activeCreditsRefreshOperation.current?.controller.abort()
      activeCreditsRefreshOperation.current = null
      creditsRefreshOperationSequence.current += 1
    }
  }, [])

  useEffect(() => {
    cancelCredentialOperation(false)
    cancelTestConnection(false)
    cancelCreditsRefresh(false)
    setPendingCredentialOperation(null)
    setTesting({})
    setCreditsLoading(false)
    if (open) {
      setDrafts({})
      setSaved(null)
      setStorageFailures([])
      setPersistEncrypted(false)
      setPassphrase('')
      setResults({})
      setTestConsent({})
      setOrgStylingState(isOrgStylingOn())
      setCompletenessState(isCompletenessOn())
      const selection = getProviderSelection()
      setSelectedProvider(selection?.providerId ?? '')
      setSelectedModel(selection?.modelId ?? '')
      // Reuse the idempotent startup upgrade rather than maintaining a second
      // Settings-only provider list or cleanup path.
      const migration = migrateLegacyCredentialsOnStartup()
      if (!migration.ok) setStorageFailures([storageFailure(migration, 'startup')])
    }
  }, [cancelCredentialOperation, cancelCreditsRefresh, cancelTestConnection, open])

  useEffect(
    () =>
      subscribeUsage(() => {
        bumpUsage((value) => value + 1)
      }),
    []
  )

  if (!open) return null

  const save = async (): Promise<void> => {
    const operation = beginCredentialOperation('save')
    const draftSnapshot = { ...drafts }
    const encryptSnapshot = persistEncrypted
    const passphraseSnapshot = passphrase
    const providerSnapshot = selectedProvider
    const modelSnapshot = selectedModel
    const failures: StorageFailure[] = []
    const openRouterDraft = draftSnapshot.openrouter?.trim()
    if (openRouterDraft) cancelCreditsRefresh(true)
    for (const p of LITE_PROVIDERS) {
      const draft = draftSnapshot[p.id]
      if (draft !== undefined && draft.trim().length > 0) {
        const result = encryptSnapshot
          ? await persistEncryptedKey(p.id, draft, passphraseSnapshot, operation.controller.signal)
          : setKey(p.id, draft)
        if (!credentialOperationIsCurrent(operation)) return
        if (!result.ok) failures.push(storageFailure(result, 'key-save', p.label))
        else if (p.id === 'openrouter') {
          // A refresh may have started against the old key while an encrypted
          // save was pending. Invalidate it at commit and discard its cache.
          cancelCreditsRefresh(true)
          setCredits(null)
          setCreditsError(null)
        }
      }
    }
    if (!credentialOperationIsCurrent(operation)) return
    if (providerSnapshot) {
      const selectionResult = setProviderSelection(providerSnapshot, modelSnapshot)
      if (!selectionResult.ok) {
        failures.push(storageFailure(selectionResult, 'provider-selection'))
      }
    }
    if (!credentialOperationIsCurrent(operation)) return
    setDrafts((current) => {
      const next = { ...current }
      for (const provider of LITE_PROVIDERS) {
        if (
          draftSnapshot[provider.id] !== undefined &&
          next[provider.id] === draftSnapshot[provider.id]
        ) {
          delete next[provider.id]
        }
      }
      return next
    })
    if (failures.length > 0) {
      setSaved(null)
      setStorageFailures(failures)
    } else {
      setStorageFailures([])
      setSaved(t('settings.saved'))
    }
    finishCredentialOperation(operation)
    onKeysChanged()
  }

  const unlockStoredKeys = async (): Promise<void> => {
    const operation = beginCredentialOperation('unlock')
    const passphraseSnapshot = passphrase
    const failures: StorageFailure[] = []
    let unlocked = 0
    if (hasEncryptedKey('openrouter')) cancelCreditsRefresh(true)
    for (const provider of LITE_PROVIDERS) {
      if (!hasEncryptedKey(provider.id)) continue
      const result = await unlockEncryptedKey(
        provider.id,
        passphraseSnapshot,
        operation.controller.signal
      )
      if (!credentialOperationIsCurrent(operation)) return
      if (result.ok) {
        unlocked += 1
        if (provider.id === 'openrouter') {
          cancelCreditsRefresh(true)
          setCredits(null)
          setCreditsError(null)
        }
      } else failures.push(storageFailure(result, 'unlock', provider.label))
    }
    if (!credentialOperationIsCurrent(operation)) return
    if (failures.length > 0) {
      setSaved(null)
      setStorageFailures(failures)
    } else {
      setStorageFailures([])
      setSaved(t('settings.encryption.unlocked', { count: unlocked }))
      setPassphrase('')
      finishCredentialOperation(operation)
      onKeysChanged()
      return
    }
    finishCredentialOperation(operation)
  }

  const testModelFor = (providerId: LiteProviderId): string =>
    selectedProvider === providerId && selectedModel.trim()
      ? selectedModel.trim()
      : defaultLiteModelId(providerId)

  const runTest = async (providerId: LiteProviderId): Promise<void> => {
    activeTestConnectionOperation.current?.controller.abort()
    const operation: ActiveTestConnectionOperation = {
      id: ++testConnectionOperationSequence.current,
      providerId,
      controller: new AbortController()
    }
    activeTestConnectionOperation.current = operation
    const operationIsCurrent = (): boolean =>
      mounted.current &&
      openRef.current &&
      !operation.controller.signal.aborted &&
      activeTestConnectionOperation.current?.id === operation.id

    setTesting({ [providerId]: true })
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
      const result = await testConnection(cfg, operation.controller.signal)
      if (!operationIsCurrent()) return
      setResults((r) => ({ ...r, [providerId]: result }))
    } catch (err) {
      if (!operationIsCurrent()) return
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
      if (activeTestConnectionOperation.current?.id === operation.id) {
        activeTestConnectionOperation.current = null
        if (mounted.current) setTesting({})
      }
    }
  }

  const closeSettings = (): void => {
    cancelCredentialOperation(true)
    cancelTestConnection(true)
    cancelCreditsRefresh(true)
    onClose()
  }

  const clearStoredKey = (providerId: LiteProviderId, providerLabel: string): void => {
    cancelCredentialOperation(true)
    if (providerId === 'openrouter') {
      cancelCreditsRefresh(true)
      setCredits(null)
      setCreditsError(null)
    }
    const result = clearKey(providerId)
    setDrafts((current) => {
      const next = { ...current }
      delete next[providerId]
      return next
    })
    if (result.ok) {
      setStorageFailures([])
      setSaved(t('settings.keyCleared'))
    } else {
      setSaved(null)
      setStorageFailures([storageFailure(result, 'clear', providerLabel)])
    }
    onKeysChanged()
  }

  const hasStoredCiphertext = LITE_PROVIDERS.some((provider) => hasEncryptedKey(provider.id))
  const storageTechnicalFailures = storageFailures.filter(
    (failure): failure is StorageFailure & { detail: string } => failure.detail !== null
  )

  return (
    <AccessibleDialog
      ariaLabel={t('settings.title')}
      onClose={closeSettings}
      closeOnEscape
      closeOnBackdrop
      backdropStyle={overlay}
      dialogStyle={panel}
    >
      <header style={header}>
        <strong>{t('settings.title.providers')}</strong>
        <button
          type="button"
          onClick={closeSettings}
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
          <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer' }}>
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
          <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer' }}>
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

        {localizationResources && (
          <LocalizationResourcesEditor
            key={localizationResources.workspaceBindingKey ?? 'workspace-localization'}
            {...localizationResources}
          />
        )}

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
          aria-busy={pendingCredentialOperation !== null}
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
              disabled={!passphrase || pendingCredentialOperation !== null}
              aria-busy={pendingCredentialOperation?.kind === 'unlock'}
              aria-describedby={
                pendingCredentialOperation?.kind === 'unlock'
                  ? 'orbitpm-credential-operation-status'
                  : undefined
              }
              style={ghostBtn}
            >
              {pendingCredentialOperation?.kind === 'unlock'
                ? t('settings.credentials.unlocking')
                : t('settings.encryption.unlock')}
            </button>
          )}
          <span style={{ fontSize: 11.5, color: 'var(--orbitpm-muted)' }}>
            {t('settings.encryption.hint')}
          </span>
        </section>

        {storageFailures.length > 0 && (
          <div role="alert" style={errorBox}>
            <ul style={{ margin: 0, paddingInlineStart: 20 }}>
              {storageFailures.map((failure, index) => (
                <li
                  key={`${failure.context}:${failure.providerLabel ?? ''}:${failure.code}:${index}`}
                >
                  {storageFailureMessage(failure)}
                </li>
              ))}
            </ul>
            {storageTechnicalFailures.length > 0 ? (
              <details style={{ marginTop: 6 }}>
                <summary>{t('settings.storageError.technicalDetails')}</summary>
                <ul style={{ marginBlock: 6, paddingInlineStart: 20 }}>
                  {storageTechnicalFailures.map((failure, index) => (
                    <li
                      key={`${failure.context}:${failure.providerLabel ?? ''}:${failure.code}:detail:${index}`}
                    >
                      <code
                        aria-label={t('settings.storageError.technicalDetail')}
                        lang="en"
                        dir="ltr"
                        style={{ overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }}
                      >
                        {failure.detail}
                      </code>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
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
                  disabled={
                    testing[p.id] || !testConsent[p.id] || pendingCredentialOperation !== null
                  }
                  style={ghostBtn}
                >
                  {testing[p.id]
                    ? t('settings.testConnection.testing')
                    : t('settings.testConnection')}
                </button>
                {(configured ||
                  encryptedStored ||
                  (pendingCredentialOperation?.kind === 'save' && value.trim().length > 0)) && (
                  <button
                    type="button"
                    onClick={() => clearStoredKey(p.id, p.label)}
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
        {pendingCredentialOperation && (
          <span
            id="orbitpm-credential-operation-status"
            role="status"
            aria-live="polite"
            style={{ fontSize: 12, color: 'var(--orbitpm-muted)' }}
          >
            {pendingCredentialOperation.kind === 'save'
              ? t('settings.credentials.saving')
              : t('settings.credentials.unlocking')}
          </span>
        )}
        <span style={{ flex: 1 }} />
        <button type="button" onClick={closeSettings} style={ghostBtn}>
          {t('settings.close')}
        </button>
        <button
          type="button"
          onClick={() => void save()}
          aria-busy={pendingCredentialOperation?.kind === 'save'}
          aria-describedby={
            pendingCredentialOperation?.kind === 'save'
              ? 'orbitpm-credential-operation-status'
              : undefined
          }
          className="orbitpm-lite-primary"
          style={{ fontSize: 13 }}
        >
          {pendingCredentialOperation?.kind === 'save'
            ? t('settings.credentials.saving')
            : t('settings.saveKeys')}
        </button>
      </footer>
    </AccessibleDialog>
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
