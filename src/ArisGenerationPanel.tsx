/**
 * The "Create" surface — plan §16 (AI) and §15 (Excel).
 *
 * The Phase-2 build of this panel emitted a hand-written `<OrbitPM-Placeholder>`
 * XML stub. That path is gone. What replaces it is the real §16 sequence:
 *
 *   provider + model capability → input validation → reviewed outbound request →
 *   consent → bounded send → `validateArisAiDraft` → local id allocation and
 *   canonical AML → open on the real canvas.
 *
 * The AI never sees AML and never produces it. `validateArisAiDraft` rejects raw
 * XML, real ARIS ids, coordinates and executable content before the schema runs,
 * and this panel prints those rejections verbatim rather than swallowing them —
 * a silent fallback would defeat the entire point of the contract.
 *
 * The Excel tab is the no-AI half of Create: `createArisTemplateWorkbooks()`
 * produces the two official downloadable templates, and `parseArisWorkbookInBrowser`
 * turns a filled-in one into the same kind of AML, with every issue carried back
 * to the exact `Sheet!A1` cell it came from.
 */

import { useCallback, useMemo, useRef, useState } from 'react'

import { validateArisAiDraft, type ArisAiValidationFinding } from './aris/ai'
import { buildArisAiPrompt, type ArisAiPromptModelType } from './aris/ai/promptBuilder'
import {
  createArisTemplateWorkbooks,
  parseArisWorkbookInBrowser,
  type ArisExcelIssue,
  type ArisWorkbookParseResult
} from './aris/excel'
import { buildAmlFromArisAiDraft } from './aris/shell/arisAiCreate'
import {
  arisExcelIssueAddress,
  buildAmlFromArisWorkbook,
  isAcceptedArisWorkbook,
  isLegacyBpmnWorkbook
} from './aris/shell/arisExcelCreate'
import { tk } from './aris/shell/shellI18n'
import { makeBrowserCallLLM } from './ai/browserAi'
import { getKey, hasKey } from './ai/keys'
import { LITE_PROVIDERS, defaultLiteModelId, type LiteProviderId } from './ai/providersLite'
import { estimateGenerationRequestCount, inspectContextSensitivity } from './ai/requestPrivacy'
import { t, type Key } from './i18n'

export interface ArisGenerationPanelProps {
  /** Open a generated AML document as a new source tab. */
  onCreateModel: (input: { name: string; xml: string }) => Promise<void> | void
  /** Download a generated file (the Excel templates). */
  onDownloadFile: (fileName: string, bytes: Uint8Array, mimeType: string) => void
  onOpenAssistant: () => void
  onOpenSettings: () => void
  embedded?: boolean
  /** Injected in tests to exercise the validation path without a network. */
  callProvider?: (prompt: { system: string; user: string }, signal: AbortSignal) => Promise<string>
}

type CreateTab = 'description' | 'excel'

const MODEL_TYPES: readonly ArisAiPromptModelType[] = [
  'MT_EEPC',
  'MT_VAL_ADD_CHN_DGM',
  'auto-detect'
]
const MAX_TOKENS = 8_000

const inputStyle: React.CSSProperties = {
  width: '100%',
  borderRadius: 8,
  border: '1px solid var(--orbitpm-border)',
  background: 'transparent',
  color: 'inherit',
  font: 'inherit',
  padding: '0.45rem 0.55rem'
}

function findingLines(findings: readonly ArisAiValidationFinding[]): string[] {
  return findings.map((finding) => `${finding.code} @ ${finding.path}: ${finding.message}`)
}

function issueLine(issue: ArisExcelIssue): string {
  const address = arisExcelIssueAddress(issue)
  const message = t(issue.messageKey as Key, issue.details as Record<string, string | number>)
  return address === null ? message : `${address} — ${message}`
}

/** Extract the first JSON object from a model response, tolerating a code fence. */
function extractJson(text: string): unknown {
  const trimmed = text.trim()
  const fenced = /```(?:json)?\s*([\s\S]*?)```/u.exec(trimmed)
  const candidate = fenced?.[1]?.trim() ?? trimmed
  return JSON.parse(candidate) as unknown
}

export function ArisGenerationPanel({
  onCreateModel,
  onDownloadFile,
  onOpenAssistant,
  onOpenSettings,
  embedded = false,
  callProvider
}: ArisGenerationPanelProps): JSX.Element {
  const [tab, setTab] = useState<CreateTab>('description')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [modelType, setModelType] = useState<ArisAiPromptModelType>('MT_EEPC')
  const [providerId, setProviderId] = useState<LiteProviderId>(LITE_PROVIDERS[0].id)
  const [redactNames, setRedactNames] = useState(true)
  const [consent, setConsent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [rejections, setRejections] = useState<readonly string[]>([])
  const [excelIssues, setExcelIssues] = useState<readonly string[]>([])
  const abortRef = useRef<AbortController | null>(null)
  const workbookInputRef = useRef<HTMLInputElement | null>(null)

  const trimmedDescription = description.trim()

  const prompt = useMemo(
    () =>
      buildArisAiPrompt({
        modelName: name.trim() === '' ? t('aris.generated.fallbackName') : name.trim(),
        modelType,
        description: trimmedDescription
      }),
    [modelType, name, trimmedDescription]
  )

  const sensitivity = useMemo(
    () => inspectContextSensitivity(trimmedDescription, []),
    [trimmedDescription]
  )
  const requestEstimate = useMemo(() => estimateGenerationRequestCount(false), [])
  const providerReady = hasKey(providerId)

  const cancel = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    setBusy(false)
    setStatus(tk('aris.ai.cancelled', 'The request was cancelled; nothing was created.'))
  }, [])

  const createWithAi = useCallback(async () => {
    if (!trimmedDescription || busy || !consent) return
    setRejections([])
    setStatus(null)
    setBusy(true)
    const controller = new AbortController()
    abortRef.current = controller
    try {
      const text = callProvider
        ? await callProvider(prompt, controller.signal)
        : await (async (): Promise<string> => {
            const call = makeBrowserCallLLM(
              {
                providerId,
                model: defaultLiteModelId(providerId),
                apiKey: getKey(providerId),
                referer: typeof location !== 'undefined' ? location.origin : undefined,
                title: 'OrbitPM ARIS Studio Lite'
              },
              { signal: controller.signal }
            )
            const result = await call(
              [
                { role: 'system', content: prompt.system },
                { role: 'user', content: prompt.user }
              ],
              { maxTokens: MAX_TOKENS }
            )
            return typeof result === 'string' ? result : JSON.stringify(result)
          })()

      let raw: unknown
      try {
        raw = extractJson(text)
      } catch (error) {
        setRejections([
          tk('aris.ai.notJson', 'The provider did not return strict JSON: {error}', {
            error: error instanceof Error ? error.message : String(error)
          })
        ])
        return
      }

      const validation = validateArisAiDraft(raw)
      if (!validation.ok) {
        // Surfaced verbatim: these are the §16.4 security and contract refusals.
        setRejections(findingLines(validation.findings))
        setStatus(tk('aris.ai.rejected', 'The draft was rejected and nothing was created.'))
        return
      }

      const aml = buildAmlFromArisAiDraft(validation.draft, {
        ...(name.trim() === '' ? {} : { modelNameFallback: name.trim() })
      })
      if (controller.signal.aborted) return
      await onCreateModel({ name: name.trim(), xml: aml.xml })
      setStatus(
        tk(
          'aris.ai.created',
          'Created {models} models, {objects} objects, {relations} relations; {uncertainties} uncertainties reported.',
          {
            models: aml.modelCount,
            objects: aml.objectCount,
            relations: aml.relationCount,
            uncertainties: aml.uncertaintyCount
          }
        )
      )
      setDescription('')
    } catch (error) {
      setStatus(
        tk('aris.ai.failed', 'The request failed: {error}', {
          error: error instanceof Error ? error.message : String(error)
        })
      )
    } finally {
      abortRef.current = null
      setBusy(false)
    }
  }, [busy, callProvider, consent, name, onCreateModel, prompt, providerId, trimmedDescription])

  const downloadTemplate = useCallback(
    (kind: 'blank' | 'example') => {
      const asset = createArisTemplateWorkbooks()[kind]
      onDownloadFile(
        asset.fileName,
        asset.bytes,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      )
    },
    [onDownloadFile]
  )

  const handleWorkbook = useCallback(
    async (file: File) => {
      setExcelIssues([])
      setStatus(null)
      setBusy(true)
      try {
        const bytes = new Uint8Array(await file.arrayBuffer())
        const result: ArisWorkbookParseResult = await parseArisWorkbookInBrowser(file.name, bytes)
        if (isLegacyBpmnWorkbook(result)) {
          setExcelIssues(result.issues.map(issueLine))
          setStatus(
            tk(
              'aris.excel.legacy',
              'That is the retired BPMN 0.4.5 workbook. Download the ARIS template below and re-enter the process there.'
            )
          )
          return
        }
        if (!isAcceptedArisWorkbook(result)) {
          setExcelIssues(result.issues.map(issueLine))
          setStatus(
            tk(
              'aris.excel.rejected',
              'The workbook was rejected: {errors} errors, {warnings} warnings.',
              {
                errors: result.issueCounts.errors,
                warnings: result.issueCounts.warnings
              }
            )
          )
          return
        }
        setExcelIssues(result.issues.map(issueLine))
        const aml = buildAmlFromArisWorkbook(result.model)
        await onCreateModel({ name: file.name.replace(/\.xlsx$/iu, ''), xml: aml.xml })
        setStatus(
          tk(
            'aris.excel.created',
            'Created {models} models, {objects} objects, {connections} connections.',
            {
              models: aml.modelCount,
              objects: aml.objectCount,
              connections: aml.connectionCount
            }
          )
        )
      } catch (error) {
        setStatus(
          tk('aris.excel.failed', 'The workbook could not be read: {error}', {
            error: error instanceof Error ? error.message : String(error)
          })
        )
      } finally {
        setBusy(false)
      }
    },
    [onCreateModel]
  )

  return (
    <section
      aria-label={t('ai.header')}
      data-orbitpm-aris-create=""
      style={{
        display: 'grid',
        gap: 10,
        padding: embedded ? '0.75rem 0.8rem 0.9rem' : '1rem',
        border: embedded ? 'none' : '1px solid var(--orbitpm-border)',
        borderRadius: embedded ? 0 : 12,
        background: embedded ? 'transparent' : 'var(--orbitpm-panel-bg, var(--orbitpm-bg))'
      }}
    >
      <div style={{ display: 'grid', gap: 4 }}>
        <strong style={{ fontSize: 14 }}>{t('ai.header')}</strong>
        <p style={{ margin: 0, fontSize: 12.5, color: 'var(--orbitpm-muted)', lineHeight: 1.5 }}>
          {t('aris.ai.body')}
        </p>
      </div>

      <div
        role="tablist"
        aria-label={tk('aris.create.tabsAria', 'Create input source')}
        style={{ display: 'flex', gap: 6 }}
      >
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'description'}
          className="orbitpm-lite-chrome-btn"
          onClick={() => setTab('description')}
        >
          {tk('aris.create.tab.description', 'Description')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'excel'}
          className="orbitpm-lite-chrome-btn"
          data-orbitpm-aris-create-excel-tab=""
          onClick={() => setTab('excel')}
        >
          {tk('aris.create.tab.excel', 'Excel')}
        </button>
      </div>

      {tab === 'description' ? (
        <>
          <label style={{ display: 'grid', gap: 4 }}>
            <span style={{ fontSize: 12, color: 'var(--orbitpm-muted)' }}>{t('aris.ai.name')}</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t('aris.ai.namePlaceholder')}
              style={inputStyle}
            />
          </label>

          <label style={{ display: 'grid', gap: 4 }}>
            <span style={{ fontSize: 12, color: 'var(--orbitpm-muted)' }}>
              {tk('aris.create.modelType', 'Model type')}
            </span>
            <select
              value={modelType}
              onChange={(event) => setModelType(event.target.value as ArisAiPromptModelType)}
              style={inputStyle}
            >
              {MODEL_TYPES.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>

          <label style={{ display: 'grid', gap: 4 }}>
            <span style={{ fontSize: 12, color: 'var(--orbitpm-muted)' }}>
              {tk('aris.create.provider', 'Provider')}
            </span>
            <select
              value={providerId}
              data-orbitpm-aris-create-provider=""
              onChange={(event) => setProviderId(event.target.value as LiteProviderId)}
              style={inputStyle}
            >
              {LITE_PROVIDERS.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.label}
                </option>
              ))}
            </select>
          </label>

          <label style={{ display: 'grid', gap: 4 }}>
            <span style={{ fontSize: 12, color: 'var(--orbitpm-muted)' }}>
              {t('aris.ai.description')}
            </span>
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder={t('aris.ai.descriptionPlaceholder')}
              rows={6}
              style={{ ...inputStyle, minHeight: 120, resize: 'vertical' }}
            />
          </label>

          <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12.5 }}>
            <input
              type="checkbox"
              checked={redactNames}
              onChange={(event) => setRedactNames(event.target.checked)}
            />
            <span>{tk('aris.create.redactNames', 'Redact names in workspace context')}</span>
          </label>

          <details data-orbitpm-aris-create-preview="">
            <summary style={{ fontSize: 12.5, cursor: 'pointer' }}>
              {tk('aris.create.preview', 'Exact outbound request')}
            </summary>
            <p style={{ margin: '6px 0', fontSize: 12, color: 'var(--orbitpm-muted)' }}>
              {tk(
                'aris.create.sensitivity',
                'Names detected: {names} · Sensitive metadata: {meta}',
                {
                  names: String(sensitivity.containsNames),
                  meta: String(sensitivity.containsSensitiveMetadata)
                }
              )}
              {' · '}
              {tk('aris.create.requestEstimate', 'Up to {count} requests', {
                count: requestEstimate
              })}
            </p>
            <pre
              style={{
                margin: 0,
                whiteSpace: 'pre-wrap',
                overflowWrap: 'anywhere',
                fontSize: 11,
                maxHeight: 200,
                overflow: 'auto'
              }}
            >
              {`${prompt.system}\n\n${prompt.user}`}
            </pre>
          </details>

          <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12.5 }}>
            <input
              type="checkbox"
              checked={consent}
              data-orbitpm-aris-create-consent=""
              onChange={(event) => setConsent(event.target.checked)}
            />
            <span>
              {tk('aris.create.consent', 'I reviewed the request above and consent to sending it')}
            </span>
          </label>

          {!providerReady && !callProvider && (
            <p style={{ margin: 0, fontSize: 12 }}>
              {tk(
                'aris.create.noKey',
                'No API key is stored for this provider. Open Settings to add one.'
              )}
            </p>
          )}

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <button
              type="button"
              className="orbitpm-lite-primary"
              data-orbitpm-aris-create-submit=""
              onClick={() => void createWithAi()}
              disabled={
                !trimmedDescription || busy || !consent || (!providerReady && !callProvider)
              }
            >
              {busy ? t('aris.ai.creating') : t('aris.ai.create')}
            </button>
            {busy && (
              <button type="button" className="orbitpm-lite-chrome-btn" onClick={cancel}>
                {tk('aris.import.review.cancel', 'Cancel')}
              </button>
            )}
            <button type="button" className="orbitpm-lite-chrome-btn" onClick={onOpenAssistant}>
              {t('aris.placeholder.openAssistant')}
            </button>
            <button type="button" className="orbitpm-lite-chrome-btn" onClick={onOpenSettings}>
              {t('app.settings')}
            </button>
          </div>
        </>
      ) : (
        <>
          <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.5 }}>
            {tk(
              'aris.excel.body',
              'Fill in the official ARIS template and create native models with no AI at all.'
            )}
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="orbitpm-lite-chrome-btn"
              data-orbitpm-aris-template-blank=""
              onClick={() => downloadTemplate('blank')}
            >
              {tk('aris.excel.downloadBlank', 'Download blank template')}
            </button>
            <button
              type="button"
              className="orbitpm-lite-chrome-btn"
              data-orbitpm-aris-template-example=""
              onClick={() => downloadTemplate('example')}
            >
              {tk('aris.excel.downloadExample', 'Download example template')}
            </button>
            <button
              type="button"
              className="orbitpm-lite-primary"
              data-orbitpm-aris-workbook-open=""
              disabled={busy}
              onClick={() => workbookInputRef.current?.click()}
            >
              {tk('aris.excel.create', 'Create from workbook…')}
            </button>
          </div>
          <input
            ref={workbookInputRef}
            type="file"
            hidden
            accept=".xlsx"
            onChange={(event) => {
              const [file] = Array.from(event.target.files ?? [])
              event.target.value = ''
              if (file) void handleWorkbook(file)
            }}
          />
          {excelIssues.length > 0 && (
            <ul
              data-orbitpm-aris-excel-issues=""
              style={{
                margin: 0,
                paddingInlineStart: '1.1rem',
                fontSize: 12,
                maxHeight: 180,
                overflow: 'auto'
              }}
            >
              {excelIssues.slice(0, 50).map((line, index) => (
                <li key={`${index}:${line}`}>{line}</li>
              ))}
            </ul>
          )}
        </>
      )}

      {rejections.length > 0 && (
        <ul
          data-orbitpm-aris-create-rejections=""
          style={{
            margin: 0,
            paddingInlineStart: '1.1rem',
            fontSize: 12,
            maxHeight: 180,
            overflow: 'auto'
          }}
        >
          {rejections.map((line, index) => (
            <li key={`${index}:${line}`}>{line}</li>
          ))}
        </ul>
      )}

      {status && (
        <p role="status" style={{ margin: 0, fontSize: 12 }}>
          {status}
        </p>
      )}
    </section>
  )
}

export default ArisGenerationPanel
