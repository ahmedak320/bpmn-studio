/**
 * The "Create" surface — plan §16 (AI) and §15 (Excel).
 *
 * §16.1 names three input tabs, and all three are here:
 *
 *   Description   typed English/Arabic, optionally with a DOCX (extracted
 *                 locally, never uploaded) or a PDF (sent natively, only when
 *                 the exact provider/model is verified to read documents).
 *   PDF/Picture   a PDF or a picture of a process drawing (PNG/JPEG/WebP,
 *                 and GIF only on a verified route), plus an optional hint
 *                 about model name, orientation, boundaries, or unclear
 *                 symbols.
 *   Excel         the no-AI half of Create.
 *
 * The AI never sees AML and never produces it. It produces `ArisAiDraftV1`,
 * and `validateArisAiDraft` rejects raw XML, real ARIS ids, coordinates and
 * executable content before the schema even runs. This panel prints those
 * rejections verbatim rather than swallowing them — a silent fallback would
 * defeat the entire point of the contract.
 *
 * The §16.6 ordering is deliberately NOT inlined here. This component owns
 * steps 1–4 (capability → type/size → reviewed request → consent) and steps
 * 11–17 (local AML, preview, confirm, commit); steps 5–10 — attachment on the
 * first attempt only, bounded parse, draft/type/EPC validation, up to three
 * semantic repair turns, and the transport-vs-semantic distinction — live in
 * `aris/shell/arisAiGeneration.ts`, and placement/recovery (§16.7) lives in
 * `aris/shell/arisAiPlacement.ts`, so each is unit-testable without a DOM.
 */

import { useCallback, useMemo, useRef, useState } from 'react'

import type { ArisAiValidationFinding } from './aris/ai'
import { buildArisAiPrompt, type ArisAiPromptModelType } from './aris/ai/promptBuilder'
import type { ArisProcessDigest } from './aris/assistant/types'
import {
  buildArisCreateDescriptionContext,
  buildArisCreateDescriptionDisclosure,
  buildArisCreateDescriptionSensitivity,
  grantArisCreateDescriptionConsent,
  hasArisCreateDescriptionConsent,
  type ArisCreateDescriptionConsent
} from './aris/shell/arisCreateDescriptionAi'
import {
  createArisTemplateWorkbooks,
  parseArisWorkbookInBrowser,
  type ArisExcelIssue,
  type ArisWorkbookParseResult
} from './aris/excel'
import { buildAmlFromArisAiDraft } from './aris/shell/arisAiCreate'
import {
  checkArisAiAttachment,
  encodeArisAiAttachment,
  extractArisAiDocxText,
  isArisAiDocxFile,
  type ArisAiAttachmentAccepted,
  type ArisAiDocxParser
} from './aris/shell/arisAiAttachments'
import {
  runArisAiGeneration,
  type ArisAiGenerationRequest,
  type ArisAiSend
} from './aris/shell/arisAiGeneration'
import {
  arisAiRecoveryArtifact,
  resolveArisAiPlacement,
  type ArisAiRecoveryArtifact
} from './aris/shell/arisAiPlacement'
import {
  arisExcelIssueAddress,
  buildAmlFromArisWorkbook,
  isAcceptedArisWorkbook,
  isLegacyBpmnWorkbook
} from './aris/shell/arisExcelCreate'
import { tk } from './aris/shell/shellI18n'
import { makeBrowserCallLLM } from './ai/browserAi'
import { getKey, hasKey } from './ai/keys'
import { buildImageInstruction, buildPdfInstruction, type GenAttachment } from './ai/pdf'
import {
  LITE_PROVIDERS,
  defaultLiteModelId,
  getLiteProvider,
  type LiteProviderId
} from './ai/providersLite'
import { estimateGenerationRequestCount } from './ai/requestPrivacy'
import { t, type Key } from './i18n'

export interface ArisGenerationPanelProps {
  /** Open a generated AML document as a new source tab. */
  onCreateModel: (input: { name: string; xml: string }) => Promise<void> | void
  /** Download a generated file (the Excel templates, the §16.7 recovery AML). */
  onDownloadFile: (fileName: string, bytes: Uint8Array, mimeType: string) => void
  onOpenAssistant: () => void
  onOpenSettings: () => void
  embedded?: boolean
  /**
   * Identity of the workspace a generated model would be written into. §16.7:
   * if this changes between sending the request and placing the result, the
   * result is NOT written into the stale destination — it is offered as a
   * recoverable download instead.
   */
  workspaceId?: string | null
  /**
   * Process digests for optional workspace context ranking (§16.2). Passing no
   * digests leaves the context control with nothing to rank.
   */
  digests?: readonly ArisProcessDigest[]
  /** Injected in tests to exercise the whole sequence without a network. */
  callProvider?: (request: ArisAiGenerationRequest, signal: AbortSignal) => Promise<string>
  /** Injected in tests: local DOCX text extraction (default: inline worker). */
  parseDocx?: ArisAiDocxParser
  /** Injected in tests: base64 encoding of an attachment (default: FileReader). */
  encodeAttachment?: (
    file: File,
    accepted: ArisAiAttachmentAccepted,
    signal: AbortSignal
  ) => Promise<GenAttachment>
}

type CreateTab = 'description' | 'document' | 'excel'

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

const listStyle: React.CSSProperties = {
  margin: 0,
  paddingInlineStart: '1.1rem',
  fontSize: 12,
  maxHeight: 180,
  overflow: 'auto'
}

/** A file the user picked, together with the check that accepted it. */
interface PickedAttachment {
  readonly file: File
  readonly accepted: ArisAiAttachmentAccepted
}

interface PickedDocx {
  readonly fileName: string
  readonly text: string
  readonly characterCount: number
}

function findingLines(findings: readonly ArisAiValidationFinding[]): string[] {
  return findings.map((finding) => `${finding.code} @ ${finding.path}: ${finding.message}`)
}

function issueLine(issue: ArisExcelIssue): string {
  const address = arisExcelIssueAddress(issue)
  const message = t(issue.messageKey as Key, issue.details as Record<string, string | number>)
  return address === null ? message : `${address} — ${message}`
}

function formatBytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function ArisGenerationPanel({
  onCreateModel,
  onDownloadFile,
  onOpenAssistant,
  onOpenSettings,
  embedded = false,
  workspaceId,
  digests = [],
  callProvider,
  parseDocx,
  encodeAttachment
}: ArisGenerationPanelProps): JSX.Element {
  const [tab, setTab] = useState<CreateTab>('description')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [hint, setHint] = useState('')
  const [modelType, setModelType] = useState<ArisAiPromptModelType>('MT_EEPC')
  const [providerId, setProviderId] = useState<LiteProviderId>(LITE_PROVIDERS[0].id)
  const [modelId, setModelId] = useState<string>(defaultLiteModelId(LITE_PROVIDERS[0].id))
  const [docx, setDocx] = useState<PickedDocx | null>(null)
  const [descriptionPdf, setDescriptionPdf] = useState<PickedAttachment | null>(null)
  const [documentFile, setDocumentFile] = useState<PickedAttachment | null>(null)
  const [attachmentNotice, setAttachmentNotice] = useState<string | null>(null)
  const [includeContext, setIncludeContext] = useState(false)
  const [redactNames, setRedactNames] = useState(true)
  const [consent, setConsent] = useState<ArisCreateDescriptionConsent | null>(null)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [rejections, setRejections] = useState<readonly string[]>([])
  const [warnings, setWarnings] = useState<readonly string[]>([])
  const [excelIssues, setExcelIssues] = useState<readonly string[]>([])
  const [recovery, setRecovery] = useState<ArisAiRecoveryArtifact | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const workbookInputRef = useRef<HTMLInputElement | null>(null)
  const docxInputRef = useRef<HTMLInputElement | null>(null)
  const descriptionPdfInputRef = useRef<HTMLInputElement | null>(null)
  const documentInputRef = useRef<HTMLInputElement | null>(null)

  // §16.7 reads this at PLACEMENT time, not at send time, so a workspace swap
  // mid-request is visible to the decision.
  const workspaceIdRef = useRef<string | null>(workspaceId ?? null)
  workspaceIdRef.current = workspaceId ?? null

  const trimmedDescription = description.trim()
  const trimmedHint = hint.trim()
  const attachment = tab === 'document' ? documentFile : descriptionPdf

  const provider = getLiteProvider(providerId)
  const providerReady = hasKey(providerId)

  /**
   * The operator request that actually goes out. On the PDF/Picture tab the
   * attachment IS the request, so the retained document/drawing instructions
   * (`buildPdfInstruction` / `buildImageInstruction`, which already fold the
   * hint in verbatim — Arabic-safe, no translation) stand in for typed text.
   */
  const operatorRequest = useMemo(() => {
    if (tab !== 'document') return trimmedDescription
    if (!documentFile) return ''
    return documentFile.accepted.kind === 'image'
      ? buildImageInstruction(trimmedHint)
      : buildPdfInstruction(trimmedHint)
  }, [documentFile, tab, trimmedDescription, trimmedHint])

  const context = useMemo(
    () => buildArisCreateDescriptionContext(digests, trimmedDescription, redactNames),
    [digests, trimmedDescription, redactNames]
  )

  const prompt = useMemo(
    () =>
      buildArisAiPrompt({
        modelName: name.trim() === '' ? t('aris.generated.fallbackName') : name.trim(),
        modelType,
        description: operatorRequest,
        ...(tab === 'description' && docx ? { attachmentText: docx.text } : {}),
        ...(tab === 'description' && includeContext
          ? { workspaceContext: context.contextText }
          : {})
      }),
    [docx, modelType, name, operatorRequest, tab, includeContext, context]
  )

  const sensitivity = useMemo(
    () =>
      buildArisCreateDescriptionSensitivity(
        operatorRequest,
        tab === 'description' && includeContext
          ? context
          : { includedModelIds: [], chips: [], contextText: '' }
      ),
    [operatorRequest, tab, includeContext, context]
  )
  const requestEstimate = useMemo(
    () => estimateGenerationRequestCount(attachment !== null),
    [attachment]
  )

  // §4.3: "No request before exact outbound review and consent." Any change to
  // what would be sent invalidates the review the consent was given for.
  const disclosure = useMemo(
    () =>
      buildArisCreateDescriptionDisclosure({
        tab,
        providerId,
        modelId,
        modelName: name.trim(),
        modelType,
        includeContext,
        redactNames,
        context,
        attachmentName: attachment?.accepted.fileName ?? '',
        attachmentSizeBytes: attachment?.accepted.sizeBytes ?? 0,
        outboundSystem: prompt.system,
        outboundUser: prompt.user
      }),
    [
      tab,
      providerId,
      modelId,
      name,
      modelType,
      includeContext,
      redactNames,
      context,
      attachment,
      prompt.system,
      prompt.user
    ]
  )
  const consentValid = hasArisCreateDescriptionConsent(disclosure, consent)

  const cancel = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    setBusy(false)
    setStatus(tk('aris.ai.cancelled', 'The request was cancelled; nothing was created.'))
  }, [])

  const selectProvider = useCallback((next: LiteProviderId) => {
    setProviderId(next)
    setModelId(defaultLiteModelId(next))
    // A provider/model swap can invalidate an already-picked attachment, so
    // the capability gate is re-run at pick time AND at send time.
    setAttachmentNotice(null)
  }, [])

  // --- attachment pickers (§16.6 steps 1-2 run before any byte is read) -----

  const pickAttachment = useCallback(
    (file: File, target: 'description-pdf' | 'document') => {
      setStatus(null)
      const check = checkArisAiAttachment({ providerId, modelId, file })
      if (!check.ok) {
        setAttachmentNotice(check.message)
        if (target === 'document') setDocumentFile(null)
        else setDescriptionPdf(null)
        return
      }
      if (target === 'description-pdf' && check.kind !== 'pdf') {
        setAttachmentNotice(
          tk(
            'aris.create.pdf.onlyPdf',
            'The description tab accepts a PDF attachment. Use the PDF/Picture tab for a drawing.'
          )
        )
        setDescriptionPdf(null)
        return
      }
      setAttachmentNotice(
        check.warning ??
          tk('aris.create.attachment.selected', 'Attached {name} ({size}, {type}).', {
            name: check.fileName,
            size: formatBytes(check.sizeBytes),
            type: check.mediaType
          })
      )
      const picked: PickedAttachment = { file, accepted: check }
      if (target === 'document') setDocumentFile(picked)
      else setDescriptionPdf(picked)
    },
    [modelId, providerId]
  )

  const pickDocx = useCallback(
    async (file: File) => {
      setStatus(null)
      if (!isArisAiDocxFile(file)) {
        setAttachmentNotice(
          tk('aris.create.docx.notDocx', 'That is not a .docx file; nothing was attached.')
        )
        return
      }
      setBusy(true)
      try {
        const extracted = await extractArisAiDocxText(file, {
          ...(parseDocx ? { parse: parseDocx } : {})
        })
        setDocx({
          fileName: extracted.fileName,
          text: extracted.text,
          characterCount: extracted.characterCount
        })
        setAttachmentNotice(
          tk(
            'aris.create.docx.attached',
            'Attached {name}: {chars} characters were extracted on this device. The file itself is never uploaded.',
            { name: extracted.fileName, chars: extracted.characterCount }
          )
        )
      } catch (error) {
        setDocx(null)
        setAttachmentNotice(
          tk('aris.create.docx.failed', 'The DOCX could not be read: {error}', {
            error: errorText(error)
          })
        )
      } finally {
        setBusy(false)
      }
    },
    [parseDocx]
  )

  // --- the §16.6 sequence ---------------------------------------------------

  const buildSend = useCallback(
    (): ArisAiSend => async (request, signal) => {
      if (callProvider) return callProvider(request, signal)
      const call = makeBrowserCallLLM(
        {
          providerId,
          model: modelId,
          apiKey: getKey(providerId),
          referer: typeof location !== 'undefined' ? location.origin : undefined,
          title: 'OrbitPM ARIS Studio Lite'
        },
        {
          ...(request.attachment ? { attachment: request.attachment } : {}),
          signal
        }
      )
      const result = await call(
        request.messages.map((message) => ({ role: message.role, content: message.content })),
        { maxTokens: MAX_TOKENS }
      )
      return typeof result === 'string' ? result : JSON.stringify(result)
    },
    [callProvider, modelId, providerId]
  )

  const createWithAi = useCallback(async () => {
    if (busy || !consentValid) return
    if (tab === 'document' ? !documentFile : trimmedDescription === '') return
    setRejections([])
    setWarnings([])
    setRecovery(null)
    setStatus(null)
    setBusy(true)
    const controller = new AbortController()
    abortRef.current = controller
    const requestedWorkspaceId = workspaceIdRef.current
    try {
      // §16.6 step 1-2, re-run against the provider/model selected RIGHT NOW:
      // the picker's verdict can be stale if the model changed after picking.
      let encoded: GenAttachment | undefined
      if (attachment) {
        const recheck = checkArisAiAttachment({
          providerId,
          modelId,
          file: attachment.file
        })
        if (!recheck.ok) {
          setAttachmentNotice(recheck.message)
          setStatus(
            tk('aris.create.attachment.blocked', 'Nothing was sent: {reason}', {
              reason: recheck.message
            })
          )
          return
        }
        encoded = await (encodeAttachment
          ? encodeAttachment(attachment.file, recheck, controller.signal)
          : encodeArisAiAttachment(attachment.file, recheck, controller.signal))
      }

      const result = await runArisAiGeneration({
        system: prompt.system,
        user: prompt.user,
        ...(encoded ? { attachment: encoded } : {}),
        send: buildSend(),
        signal: controller.signal,
        onRepairTurn: (attemptNumber) => {
          setStatus(
            tk(
              'aris.create.repairing',
              'The draft was invalid; sending text-only repair turn {attempt} of {max}. The attachment is not sent again.',
              { attempt: attemptNumber, max: 3 }
            )
          )
        }
      })

      if (!result.ok) {
        if (result.reason === 'cancelled') {
          setStatus(tk('aris.ai.cancelled', 'The request was cancelled; nothing was created.'))
          return
        }
        if (result.reason === 'transport') {
          setStatus(
            tk(
              'aris.create.transportFailed',
              'The provider request failed before any draft came back, so no repair attempt was used: {error}',
              { error: errorText(result.error) }
            )
          )
          return
        }
        setRejections(findingLines(result.findings))
        setStatus(
          tk(
            'aris.create.semanticExhausted',
            'The provider still returned an invalid draft after {attempts} repair turns; nothing was created.',
            { attempts: result.semanticAttemptsUsed - 1 }
          )
        )
        return
      }

      setWarnings(findingLines(result.warnings))
      // §16.6 steps 11-14: ids, accounting and geometry are allocated locally.
      const aml = buildAmlFromArisAiDraft(result.draft, {
        ...(name.trim() === '' ? {} : { modelNameFallback: name.trim() })
      })

      // §16.7: never write into a stale destination, and never lose the AML.
      const placement = resolveArisAiPlacement({
        requestedWorkspaceId,
        currentWorkspaceId: workspaceIdRef.current,
        aborted: controller.signal.aborted
      })
      if (placement.status === 'discarded') {
        setRecovery(arisAiRecoveryArtifact(name.trim(), aml.xml, placement.reason))
        setStatus(
          placement.reason === 'cancelled'
            ? tk(
                'aris.create.placement.cancelled',
                'The request was cancelled before placement; nothing was written. The generated AML can still be downloaded below.'
              )
            : tk(
                'aris.create.placement.stale',
                'The workspace changed while the model was being generated, so nothing was written to it. Download the generated AML below to keep it.'
              )
        )
        return
      }

      // One call, one document: a multi-model draft is never placed in pieces.
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
      if (tab === 'description') setDescription('')
    } catch (error) {
      setStatus(tk('aris.ai.failed', 'The request failed: {error}', { error: errorText(error) }))
    } finally {
      abortRef.current = null
      setBusy(false)
    }
  }, [
    attachment,
    busy,
    buildSend,
    consentValid,
    documentFile,
    encodeAttachment,
    modelId,
    name,
    onCreateModel,
    prompt,
    providerId,
    tab,
    trimmedDescription
  ])

  // --- Excel (no AI) --------------------------------------------------------

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
            error: errorText(error)
          })
        )
      } finally {
        setBusy(false)
      }
    },
    [onCreateModel]
  )

  // --- shared AI controls ---------------------------------------------------

  const submitDisabled =
    busy ||
    !consentValid ||
    (!providerReady && !callProvider) ||
    (tab === 'document' ? documentFile === null : trimmedDescription === '')

  const providerControls = (
    <>
      <label style={{ display: 'grid', gap: 4 }}>
        <span style={{ fontSize: 12, color: 'var(--orbitpm-muted)' }}>
          {tk('aris.create.provider', 'Provider')}
        </span>
        <select
          value={providerId}
          data-orbitpm-aris-create-provider=""
          onChange={(event) => selectProvider(event.target.value as LiteProviderId)}
          style={inputStyle}
        >
          {LITE_PROVIDERS.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.label}
            </option>
          ))}
        </select>
      </label>

      <label style={{ display: 'grid', gap: 4 }}>
        <span style={{ fontSize: 12, color: 'var(--orbitpm-muted)' }}>
          {tk('aris.create.model', 'Model')}
        </span>
        <select
          value={modelId}
          data-orbitpm-aris-create-model=""
          onChange={(event) => setModelId(event.target.value)}
          style={inputStyle}
        >
          {provider.models.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.label}
            </option>
          ))}
        </select>
      </label>
    </>
  )

  const reviewAndSubmit = (
    <>
      <details data-orbitpm-aris-create-preview="">
        <summary style={{ fontSize: 12.5, cursor: 'pointer' }}>
          {tk('aris.create.preview', 'Exact outbound request')}
        </summary>
        <p style={{ margin: '6px 0', fontSize: 12, color: 'var(--orbitpm-muted)' }}>
          {tk('aris.create.sensitivity', 'Names detected: {names} · Sensitive metadata: {meta}', {
            names: String(sensitivity.containsNames),
            meta: String(sensitivity.containsSensitiveMetadata)
          })}
          {' · '}
          {tk('aris.create.requestEstimate', 'Up to {count} requests', {
            count: requestEstimate
          })}
        </p>
        {attachment && (
          <p style={{ margin: '6px 0', fontSize: 12 }} data-orbitpm-aris-create-attachment-line="">
            {tk(
              'aris.create.attachment.outbound',
              'Attached with the first request only: {name} ({size}, {type}). Repair turns are text-only.',
              {
                name: attachment.accepted.fileName,
                size: formatBytes(attachment.accepted.sizeBytes),
                type: attachment.accepted.mediaType
              }
            )}
          </p>
        )}
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
          checked={consentValid}
          data-orbitpm-aris-create-consent=""
          onChange={(event) =>
            setConsent(event.target.checked ? grantArisCreateDescriptionConsent(disclosure) : null)
          }
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
          disabled={submitDisabled}
        >
          {busy
            ? t('aris.ai.creating')
            : tab === 'document'
              ? tk('aris.create.document.create', 'Generate from document')
              : t('aris.ai.create')}
        </button>
        {busy && (
          <button
            type="button"
            className="orbitpm-lite-chrome-btn"
            data-orbitpm-aris-create-cancel=""
            onClick={cancel}
          >
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
          data-orbitpm-aris-create-description-tab=""
          onClick={() => setTab('description')}
        >
          {tk('aris.create.tab.description', 'Description')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'document'}
          className="orbitpm-lite-chrome-btn"
          data-orbitpm-aris-create-document-tab=""
          onClick={() => setTab('document')}
        >
          {tk('aris.create.tab.document', 'PDF / Picture')}
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

      {tab === 'description' && (
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

          {providerControls}

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

          <div style={{ display: 'grid', gap: 6 }}>
            <span style={{ fontSize: 12, color: 'var(--orbitpm-muted)' }}>
              {tk(
                'aris.create.attachments.label',
                'Optional attachment — a DOCX is read on this device, a PDF is sent to the provider'
              )}
            </span>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                type="button"
                className="orbitpm-lite-chrome-btn"
                data-orbitpm-aris-create-docx=""
                disabled={busy}
                onClick={() => docxInputRef.current?.click()}
              >
                {tk('aris.create.docx.choose', 'Attach DOCX…')}
              </button>
              <button
                type="button"
                className="orbitpm-lite-chrome-btn"
                data-orbitpm-aris-create-pdf=""
                disabled={busy}
                onClick={() => descriptionPdfInputRef.current?.click()}
              >
                {tk('aris.create.pdf.choose', 'Attach PDF…')}
              </button>
              {(docx !== null || descriptionPdf !== null) && (
                <button
                  type="button"
                  className="orbitpm-lite-chrome-btn"
                  data-orbitpm-aris-create-attachment-clear=""
                  disabled={busy}
                  onClick={() => {
                    setDocx(null)
                    setDescriptionPdf(null)
                    setAttachmentNotice(null)
                  }}
                >
                  {tk('aris.create.attachment.remove', 'Remove attachment')}
                </button>
              )}
            </div>
            <input
              ref={docxInputRef}
              type="file"
              hidden
              accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              onChange={(event) => {
                const [file] = Array.from(event.target.files ?? [])
                event.target.value = ''
                if (file) void pickDocx(file)
              }}
            />
            <input
              ref={descriptionPdfInputRef}
              type="file"
              hidden
              accept="application/pdf,.pdf"
              onChange={(event) => {
                const [file] = Array.from(event.target.files ?? [])
                event.target.value = ''
                if (file) pickAttachment(file, 'description-pdf')
              }}
            />
          </div>

          <label style={{ display: 'flex', gap: 6, alignItems: 'flex-start', fontSize: 12.5 }}>
            <input
              type="checkbox"
              data-orbitpm-aris-create-include-context=""
              checked={includeContext}
              onChange={(event) => setIncludeContext(event.target.checked)}
            />
            <span>{tk('aris.create.includeContext', 'Include relevant workspace context')}</span>
          </label>

          <label
            style={{
              display: 'flex',
              gap: 6,
              alignItems: 'flex-start',
              fontSize: 12.5,
              opacity: includeContext ? 1 : 0.6
            }}
          >
            <input
              type="checkbox"
              data-orbitpm-aris-create-redact-names=""
              checked={redactNames}
              disabled={!includeContext}
              onChange={(event) => setRedactNames(event.target.checked)}
            />
            <span>{tk('aris.create.redactNames', 'Redact names in workspace context')}</span>
          </label>

          {includeContext && (
            <p style={{ margin: 0, fontSize: 11.5 }} data-orbitpm-aris-create-context-status="">
              {context.includedModelIds.length > 0
                ? tk(
                    'aris.create.contextCount',
                    '{count} relevant process(es) matched and will be included',
                    { count: context.includedModelIds.length }
                  )
                : tk(
                    'aris.create.contextNone',
                    'No relevant process matched this description, so no workspace content will be sent.'
                  )}
            </p>
          )}

          {includeContext && context.chips.length > 0 && (
            <div
              data-orbitpm-aris-create-context-chips=""
              style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}
            >
              {context.chips.map((chip) => (
                <span
                  key={chip.modelId}
                  className="orbitpm-lite-chrome-btn"
                  style={{ fontSize: 11 }}
                >
                  {chip.modelName}
                </span>
              ))}
            </div>
          )}

          {reviewAndSubmit}
        </>
      )}

      {tab === 'document' && (
        <>
          <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.5 }}>
            {tk(
              'aris.create.document.body',
              'Attach a PDF or a picture of a process drawing (PNG, JPEG, WebP; GIF only on verified routes). The file is sent to the selected provider only after you review the request and consent.'
            )}
          </p>

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

          {providerControls}

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="orbitpm-lite-chrome-btn"
              data-orbitpm-aris-create-document-open=""
              disabled={busy}
              onClick={() => documentInputRef.current?.click()}
            >
              {tk('aris.create.document.choose', 'Choose PDF or picture…')}
            </button>
            {documentFile && (
              <button
                type="button"
                className="orbitpm-lite-chrome-btn"
                data-orbitpm-aris-create-document-clear=""
                disabled={busy}
                onClick={() => {
                  setDocumentFile(null)
                  setAttachmentNotice(null)
                }}
              >
                {tk('aris.create.attachment.remove', 'Remove attachment')}
              </button>
            )}
          </div>
          <input
            ref={documentInputRef}
            type="file"
            hidden
            accept="application/pdf,image/png,image/jpeg,image/webp,image/gif,.pdf,.png,.jpg,.jpeg,.webp,.gif"
            onChange={(event) => {
              const [file] = Array.from(event.target.files ?? [])
              event.target.value = ''
              if (file) pickAttachment(file, 'document')
            }}
          />
          {documentFile === null && (
            <p style={{ margin: 0, fontSize: 12, color: 'var(--orbitpm-muted)' }}>
              {tk('aris.create.document.none', 'No document is attached yet.')}
            </p>
          )}

          <label style={{ display: 'grid', gap: 4 }}>
            <span style={{ fontSize: 12, color: 'var(--orbitpm-muted)' }}>
              {tk(
                'aris.create.document.hint',
                'Optional hint — model name, orientation, boundaries, or unclear symbols'
              )}
            </span>
            <textarea
              value={hint}
              data-orbitpm-aris-create-hint=""
              onChange={(event) => setHint(event.target.value)}
              placeholder={tk(
                'aris.create.document.hintPlaceholder',
                'e.g. model the permit renewal flow; the diagram reads right to left; the dashed box is a note, not a step.'
              )}
              rows={3}
              style={{ ...inputStyle, minHeight: 70, resize: 'vertical' }}
            />
          </label>

          {reviewAndSubmit}
        </>
      )}

      {tab === 'excel' && (
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
            <ul data-orbitpm-aris-excel-issues="" style={listStyle}>
              {excelIssues.slice(0, 50).map((line, index) => (
                <li key={`${index}:${line}`}>{line}</li>
              ))}
            </ul>
          )}
        </>
      )}

      {attachmentNotice !== null && tab !== 'excel' && (
        <p style={{ margin: 0, fontSize: 12 }} data-orbitpm-aris-create-attachment-notice="">
          {attachmentNotice}
        </p>
      )}

      {rejections.length > 0 && (
        <ul data-orbitpm-aris-create-rejections="" style={listStyle}>
          {rejections.map((line, index) => (
            <li key={`${index}:${line}`}>{line}</li>
          ))}
        </ul>
      )}

      {warnings.length > 0 && (
        <ul data-orbitpm-aris-create-warnings="" style={listStyle}>
          {warnings.map((line, index) => (
            <li key={`${index}:${line}`}>{line}</li>
          ))}
        </ul>
      )}

      {recovery !== null && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="orbitpm-lite-chrome-btn"
            data-orbitpm-aris-create-recovery=""
            onClick={() => onDownloadFile(recovery.fileName, recovery.bytes, recovery.mimeType)}
          >
            {tk('aris.create.recovery.download', 'Download the generated AML ({name})', {
              name: recovery.fileName
            })}
          </button>
          <button
            type="button"
            className="orbitpm-lite-chrome-btn"
            data-orbitpm-aris-create-recovery-discard=""
            onClick={() => setRecovery(null)}
          >
            {tk('aris.create.recovery.discard', 'Discard the generated AML')}
          </button>
        </div>
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
