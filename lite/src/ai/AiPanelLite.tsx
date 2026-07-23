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
  classifyBrowserError,
  type ClassifiedError,
  type GenerateOutput,
  type ProposedLink
} from './browserAi'
import { getKey, hasKey, getCustomConfig, customConfigReady } from './keys'
import {
  fetchOpenRouterCredits,
  getUsage,
  resetUsage,
  CreditsError,
  type CreditsErrorKind,
  type OpenRouterCredits
} from './credits'
import { partitionLinks, applyLinkDecisions } from './linkReview'
import { LinkVerifyDialog } from './LinkVerifyDialog'
import { CreditsLine } from './CreditsLine'
import { checkPdfSize, fileToBase64 } from './pdf'
import { t } from '../i18n'
import { useLang } from '../i18n/useLang'

export interface FolderOptionLite {
  relPath: string
  label: string
}

export interface AiPanelLiteProps {
  /** Target-folder options (directory mode). Empty in fallback mode. */
  folders: FolderOptionLite[]
  /** Place a freshly-generated diagram. Returns the opened path label, or null
   * if it was opened in-memory (fallback mode). `gen` carries the workspace
   * generation captured when generation STARTED, so App can refuse a placement
   * whose folder was switched out mid-generation (Codex ORIG-1b). */
  onPlaceGenerated: (
    xml: string,
    opts: { name: string; targetFolder: string; gen?: number }
  ) => Promise<{ label: string } | null>
  /** Read the live workspace generation (captured at generation start). */
  getWorkspaceGen?: () => number
  onOpenSettings: () => void
  collapsed: boolean
  onToggle: () => void
  /** Bump to re-read key availability after Settings closes. */
  keysVersion: number
  /** Directory mode shows the target-folder picker; fallback hides it. */
  mode: 'directory' | 'fallback'
  /** Workspace processes offered to the model for callActivity linking. */
  processCatalog: Array<{ id: string; name: string }>
  /** True when a BPMN process id exists in the current workspace. */
  isKnownProcess: (id: string) => boolean
  /** Resolve a BPMN process id to its display name (falls back to the id). */
  resolveProcessName: (id: string) => string
  /** Rendered inside the left sidebar's AI section: the outer fixed-width/border
   *  chrome, the internal header row and the collapsed strip are all dropped —
   *  only the form body is returned, full-width. `collapsed` is ignored here
   *  because the enclosing sidebar section owns the expand/collapse toggle. */
  embedded?: boolean
}

type GenMode = 'description' | 'pdf'

/** Localized message for a classified generation error (RTL-safe); the raw
 * English message is used only for the `unknown` bucket. */
function errorMessageForCode(c: ClassifiedError): string {
  switch (c.code) {
    case 'auth':
      return t('ai.error.auth')
    case 'rate':
      return t('ai.error.rateLimit')
    case 'cors':
      return t('ai.error.cors')
    case 'network':
      return t('ai.error.network')
    case 'timeout':
      return t('ai.error.timeout')
    default:
      return c.message
  }
}

export function AiPanelLite({
  folders,
  onPlaceGenerated,
  getWorkspaceGen,
  onOpenSettings,
  collapsed,
  onToggle,
  keysVersion,
  mode,
  processCatalog,
  isKnownProcess,
  resolveProcessName,
  embedded = false
}: AiPanelLiteProps): JSX.Element {
  useLang()
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
  // Summary of the links that survived placement ("label → process, …"); shown in
  // the success box alongside the created-file label when any link was kept.
  const [linkedSummary, setLinkedSummary] = useState<string | null>(null)
  // A generation awaiting user verification of its uncertain links. Held until
  // the LinkVerifyDialog resolves; placement happens on confirm/cancel.
  const [pending, setPending] = useState<{
    xml: string
    confident: ProposedLink[]
    unsure: ProposedLink[]
    unmatched: ProposedLink[]
    gen?: number
  } | null>(null)
  // OpenRouter balance + local usage-ledger display state.
  const [credits, setCredits] = useState<OpenRouterCredits | null>(null)
  const [creditsLoading, setCreditsLoading] = useState(false)
  const [creditsError, setCreditsError] = useState<CreditsErrorKind | null>(null)
  // Bumped after a generation / a usage reset so the (localStorage-backed) usage
  // line re-reads. Only the setter is needed — the re-render re-runs getUsage.
  const [, bumpUsage] = useState(0)
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
  // Providers not on the page's CSP connect-src allowlist (the Custom endpoint)
  // cannot be reached from the browser — generation is desktop-app only.
  const desktopOnly = Boolean(providerSpec.desktopOnly)
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
    !desktopOnly &&
    keyPresent &&
    customReady &&
    Boolean(effectiveModel) &&
    hasInput &&
    (genMode === 'description' || sizeGate.ok)

  // OpenRouter balance lookup — only when the current provider is OpenRouter and
  // a key is stored (keyless renders show nothing and issue no request). Fetches
  // on mount, on keysVersion change, on switching to OpenRouter, and after each
  // generation (see below). Errors surface as a stable CreditsErrorKind.
  const refreshCredits = useCallback(async () => {
    if (providerId !== 'openrouter') return
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
  }, [providerId])

  useEffect(() => {
    void refreshCredits()
    // Re-run on provider switch (refreshCredits identity depends on providerId)
    // and whenever the stored keys change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providerId, keysVersion])

  // Shared placement + reporting for both the immediate path and the post-verify
  // path. `survived` is the set of links whose calledElement was kept, used to
  // build the linked-summary line. onPlaceGenerated may throw (a write failure),
  // so classify here too.
  const placeAndReport = useCallback(
    async (finalXml: string, survived: ProposedLink[], gen: number | undefined): Promise<void> => {
      try {
        const placed = await onPlaceGenerated(finalXml, { name: name.trim(), targetFolder, gen })
        setResultLabel(placed ? placed.label : t('ai.openedInMemory'))
        if (survived.length > 0) {
          const list = survived
            .map((l) => `${l.label} → ${resolveProcessName(l.calledProcess)}`)
            .join(', ')
          setLinkedSummary(t('ai.linked.summary', { count: survived.length, list }))
        }
      } catch (err) {
        const classified = classifyBrowserError(err)
        setError(errorMessageForCode(classified))
        setOffline(classified.offline || (typeof navigator !== 'undefined' && !navigator.onLine))
      }
    },
    [name, targetFolder, onPlaceGenerated, resolveProcessName]
  )

  const handleGenerate = useCallback(async () => {
    setBusy(true)
    setError(null)
    setOffline(false)
    setResultLabel(null)
    setLinkedSummary(null)
    // Capture the workspace generation at generation START so App can refuse the
    // placement if the user switches folders during the (slow) generation (ORIG-1b).
    const genAtStart = getWorkspaceGen?.()
    try {
      const apiKey = getKey(providerId)
      if (!apiKey) throw new Error(t('ai.error.noApiKey'))
      const common = {
        providerId,
        modelId: effectiveModel,
        apiKey,
        baseURL: isCustom ? customCfg.baseURL : undefined,
        extraHeaders: isCustom ? customCfg.extraHeaders : undefined,
        processCatalog
      }
      let res: GenerateOutput
      if (genMode === 'pdf') {
        if (!pdfFile) throw new Error(t('ai.error.chooseNoPdf'))
        const gate = checkPdfSize(providerId, pdfFile.size)
        if (!gate.ok) throw new Error(gate.message)
        const base64 = await fileToBase64(pdfFile)
        res = await generateDiagramXmlFromPdf({
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
        res = await generateDiagramXml({ ...common, description: description.trim() })
      }
      // The generation call recorded usage and (for OpenRouter) spent credits —
      // refresh both balance lines.
      bumpUsage((v) => v + 1)
      void refreshCredits()
      const { confident, unsure, unmatched } = partitionLinks(res.links, isKnownProcess)
      if (unsure.length + unmatched.length === 0) {
        // Nothing to vet — place with the XML unchanged; confident links stay.
        await placeAndReport(res.xml, confident, genAtStart)
      } else {
        // Hand the uncertain/unmatched links to the verification dialog; the
        // placement waits for the user's decision.
        setPending({ xml: res.xml, confident, unsure, unmatched, gen: genAtStart })
      }
    } catch (err) {
      const classified = classifyBrowserError(err)
      setError(errorMessageForCode(classified))
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
    processCatalog,
    isKnownProcess,
    placeAndReport,
    refreshCredits,
    getWorkspaceGen
  ])

  // Verify-dialog confirm: keep confident links + the user-accepted unsure ones,
  // strip everything else (unaccepted unsure + all unmatched).
  const handleVerifyConfirm = useCallback(
    async (accepted: Set<string>): Promise<void> => {
      const p = pending
      if (!p) return
      setPending(null)
      setBusy(true)
      try {
        const keepIds = new Set<string>([...accepted, ...p.confident.map((l) => l.elementId)])
        const finalXml = applyLinkDecisions(p.xml, [...p.unsure, ...p.unmatched], keepIds)
        const survived = [...p.confident, ...p.unsure.filter((l) => accepted.has(l.elementId))]
        await placeAndReport(finalXml, survived, p.gen)
      } finally {
        setBusy(false)
      }
    },
    [pending, placeAndReport]
  )

  // Verify-dialog cancel: keep only the confident links (dismiss all uncertain).
  const handleVerifyCancel = useCallback(async (): Promise<void> => {
    const p = pending
    if (!p) return
    setPending(null)
    setBusy(true)
    try {
      const keepIds = new Set<string>(p.confident.map((l) => l.elementId))
      const finalXml = applyLinkDecisions(p.xml, [...p.unsure, ...p.unmatched], keepIds)
      await placeAndReport(finalXml, p.confident, p.gen)
    } finally {
      setBusy(false)
    }
  }, [pending, placeAndReport])

  const noKeysAtAll = configuredIds.length === 0

  // Local usage ledger for the balance line (Anthropic/Gemini). Re-read every
  // render; bumpUsage() forces the re-render after a generation or a reset.
  const sessionUsage =
    keyPresent && (providerId === 'anthropic' || providerId === 'gemini')
      ? getUsage(providerId)
      : null

  // The balance/usage status line shown directly under the provider selector.
  const balanceLine =
    !desktopOnly && keyPresent && providerId === 'openrouter' ? (
      <CreditsLine
        state={
          creditsLoading
            ? { kind: 'loading' }
            : creditsError
              ? { kind: 'error', errorKind: creditsError }
              : credits
                ? { kind: 'credits', remaining: credits.remaining }
                : { kind: 'loading' }
        }
        onRefresh={() => void refreshCredits()}
      />
    ) : keyPresent && (providerId === 'anthropic' || providerId === 'gemini') ? (
      <CreditsLine
        state={{
          kind: 'usage',
          requests: sessionUsage?.requests ?? 0,
          inputTokens: sessionUsage?.inputTokens ?? 0,
          outputTokens: sessionUsage?.outputTokens ?? 0,
          estCostUsd: sessionUsage?.estCostUsd ?? null
        }}
        onReset={() => {
          resetUsage(providerId)
          bumpUsage((v) => v + 1)
        }}
      />
    ) : null

  // The generation form itself — shared verbatim between the embedded (left
  // sidebar) render and the legacy (right-column) render; only the surrounding
  // chrome differs, so the whole body lives in one place.
  const body = (
    <div style={{ padding: '0.8rem', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {!online && (
          <div role="status" style={warnBox}>
            {t('ai.offlineWarning')}
          </div>
        )}

        {noKeysAtAll && (
          <div style={infoBox}>
            {t('ai.noKeysAtAll.note').split('{link}')[0]}
            <button type="button" onClick={onOpenSettings} style={linkBtn}>
              {t('ai.noKeysAtAll.link')}
            </button>
            {t('ai.noKeysAtAll.note').split('{link}')[1]}
          </div>
        )}

        {/* Generation mode: description vs PDF */}
        <div role="tablist" aria-label={t('ai.tablist.aria')} style={segmentWrap}>
          <button
            type="button"
            role="tab"
            aria-selected={genMode === 'description'}
            onClick={() => setGenMode('description')}
            style={segmentBtn(genMode === 'description')}
          >
            {t('ai.tab.description')}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={genMode === 'pdf'}
            onClick={() => setGenMode('pdf')}
            disabled={!providerSpec.supportsPdf}
            title={
              providerSpec.supportsPdf
                ? t('ai.tab.pdf.title.supported')
                : t('ai.tab.pdf.title.unsupported')
            }
            style={segmentBtn(genMode === 'pdf')}
          >
            {t('ai.tab.pdf')}
          </button>
        </div>

        <label style={labelStyle}>
          <span style={labelText}>{t('ai.provider.label')}</span>
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

        {/* Provider balance: OpenRouter remaining credits, or the local session
            usage ledger for Anthropic/Gemini (no balance API). */}
        {balanceLine}

        {/* Model selector: free-text (with suggestions) for OpenRouter/Gemini,
            a fixed dropdown for Anthropic, and a Settings-driven note for Custom. */}
        {isCustom ? (
          <div style={infoBox} role="note">
            🖥️ <strong>{t('settings.desktopOnly.badge')}</strong> — {t('ai.custom.desktopOnly')}
          </div>
        ) : providerSpec.allowCustomModel ? (
          <label style={labelStyle}>
            <span style={labelText}>{t('ai.model.label')}</span>
            <input
              type="text"
              list={`models-${providerId}`}
              value={modelId}
              onChange={(e) => setModelId(e.target.value)}
              placeholder={t('ai.model.label')}
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
            <span style={labelText}>{t('ai.model.label')}</span>
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
            <span style={labelText}>{t('ai.description.label')}</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('ai.description.placeholder')}
              rows={6}
              dir="auto"
              style={{ ...inputStyle, resize: 'vertical', minHeight: 96 }}
            />
          </label>
        ) : (
          <>
            <label style={labelStyle}>
              <span style={labelText}>{t('ai.pdfDocument.label')}</span>
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
            {pdfFile && sizeGate.ok && sizeGate.warning && (
              <div role="status" style={warnBox}>
                {sizeGate.warning}
              </div>
            )}
            <div style={{ fontSize: 11, color: 'var(--orbitpm-muted)' }}>{t('ai.pdf.engineNote')}</div>
            <div style={{ fontSize: 11, color: 'var(--orbitpm-muted)' }}>{t('ai.pdf.memoryNote')}</div>
            <label style={labelStyle}>
              <span style={labelText}>
                {t('ai.pdfHint.label')} <span style={{ opacity: 0.7 }}>{t('ai.pdfHint.optional')}</span>
              </span>
              <textarea
                value={hint}
                onChange={(e) => setHint(e.target.value)}
                placeholder={t('ai.pdfHint.placeholder')}
                rows={2}
                dir="auto"
                style={{ ...inputStyle, resize: 'vertical' }}
              />
            </label>
          </>
        )}

        {mode === 'directory' && folders.length > 0 && (
          <label style={labelStyle}>
            <span style={labelText}>{t('ai.targetFolder.label')}</span>
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
          <span style={labelText}>{t('ai.name.label')}</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('ai.name.placeholder')}
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
          {busy ? t('ai.generating') : genMode === 'pdf' ? t('ai.generateFromPdf') : t('ai.generate')}
        </button>

        {!desktopOnly && !keyPresent && (
          <div style={{ fontSize: 12, color: 'var(--orbitpm-muted)' }}>
            {t('ai.noKeyForProvider', { providerLabel: providerSpec.label })}{' '}
            <button type="button" onClick={onOpenSettings} style={linkBtn}>
              {t('ai.addOneInSettings')}
            </button>
            {t('ai.addOneInSettings.period')}
          </div>
        )}

        {error && (
          <div role="alert" style={errorBox}>
            <span>{error}</span>
            {offline && (
              <span style={{ opacity: 0.85 }}>
                {t('ai.errorTip.offline')}
              </span>
            )}
          </div>
        )}

        {resultLabel && (
          <div role="status" style={okBox}>
            <span>{t('ai.created', { resultLabel })}</span>
            {linkedSummary && <span style={{ opacity: 0.85 }}>{linkedSummary}</span>}
          </div>
        )}

        <div style={noteBox}>
          {t('ai.note.updated', {
            anthropic: 'Anthropic',
            gemini: 'Gemini',
            openrouter: 'OpenRouter',
            desktopOnlyProviders: DESKTOP_ONLY_PROVIDERS.join(', ')
          })}
        </div>
      </div>
  )

  // The verification modal renders above whichever chrome variant is active, so
  // it is emitted alongside every return.
  const verifyDialog = pending ? (
    <LinkVerifyDialog
      unsure={pending.unsure}
      unmatched={pending.unmatched}
      resolveProcessName={resolveProcessName}
      onConfirm={(accepted) => void handleVerifyConfirm(accepted)}
      onCancel={() => void handleVerifyCancel()}
    />
  ) : null

  // Embedded: the enclosing sidebar section owns the header + expand/collapse
  // toggle, so drop the fixed-width/bordered wrap, the internal header row and
  // the collapsed strip; return only the full-width form body.
  if (embedded) {
    return (
      <div style={{ width: '100%' }}>
        {body}
        {verifyDialog}
      </div>
    )
  }

  if (collapsed) {
    return (
      <div style={collapsedWrap}>
        <button type="button" onClick={onToggle} title={t('app.showAi.title')} style={collapsedBtn}>
          {t('ai.collapsedButton')}
        </button>
        {verifyDialog}
      </div>
    )
  }

  return (
    <div style={wrap}>
      <header style={panelHeader}>
        <strong style={{ fontSize: 14 }}>{t('ai.header')}</strong>
        <button type="button" onClick={onToggle} title={t('ai.hide.title')} style={hideBtn}>
          ⟩
        </button>
      </header>
      {body}
      {verifyDialog}
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
  borderInlineStart: '1px solid var(--orbitpm-border)',
  width: 320,
  display: 'flex',
  flexDirection: 'column',
  minHeight: 0,
  overflowY: 'auto'
}
const collapsedWrap: CSSProperties = {
  borderInlineStart: '1px solid var(--orbitpm-border)',
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
  wordBreak: 'break-word',
  display: 'flex',
  flexDirection: 'column',
  gap: 4
}
const noteBox: CSSProperties = {
  fontSize: 11.5,
  lineHeight: 1.5,
  color: 'var(--orbitpm-muted)',
  borderTop: '1px dashed var(--orbitpm-border)',
  paddingTop: 10
}

export default AiPanelLite
