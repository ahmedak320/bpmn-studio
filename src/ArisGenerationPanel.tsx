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
 * The chrome is transcribed from AiPanelLite's visual system (segmented
 * tablist, provider/model controls, warn/info/error/ok boxes) and simplified
 * to Name + per-tab source + AI provider/model. Generation always uses the
 * `'auto-detect'` model type. The §16.6 ordering is deliberately NOT inlined
 * here: this component owns steps 1–4 (capability → type/size → request) and
 * steps 11–17 (local AML, confirm, commit); steps 5–10 live in
 * `aris/shell/arisAiGeneration.ts`, and placement/recovery (§16.7) lives in
 * `aris/shell/arisAiPlacement.ts`, so each is unit-testable without a DOM.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent
} from 'react'

import type { ArisAiValidationFinding } from './aris/ai'
import { buildArisAiDraftJsonSchema } from './aris/ai/draftJsonSchema'
import { buildArisAiPrompt } from './aris/ai/promptBuilder'
import {
  createArisTemplateWorkbooks,
  parseArisWorkbookInBrowser,
  type ArisExcelIssue,
  type ArisWorkbookParseResult
} from './aris/excel'
import { buildAmlFromArisAiDraft } from './aris/shell/arisAiCreate'
import {
  checkArisAiAttachment,
  classifyArisAiAttachmentFile,
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
import { keyStorageErrorMessage } from './ai/keyStorageErrorMessage'
import { buildImageInstruction, buildPdfInstruction, type GenAttachment } from './ai/pdf'
import {
  getProviderSelection,
  setProviderSelection,
  subscribeProviderSelection
} from './ai/providerSelection'
import {
  LITE_PROVIDERS,
  OPENROUTER_STRUCTURED_OUTPUT_MODELS,
  defaultLiteModelId,
  firstLiteModelForAttachment,
  getLiteProvider,
  type LiteProviderId
} from './ai/providersLite'
import { t, type Key } from './i18n'
import { useLang } from './i18n/useLang'

export interface ArisGenerationPanelProps {
  /** Open a generated AML document as a new source tab. */
  onCreateModel: (input: { name: string; xml: string }) => Promise<void> | void
  /** Download a generated file (the Excel templates, the §16.7 recovery AML). */
  onDownloadFile: (fileName: string, bytes: Uint8Array, mimeType: string) => void
  onOpenAssistant: () => void
  onOpenSettings: () => void
  /** Offered after a successful AI generation: continue filling gaps in chat. */
  onContinueInChat?: () => void
  embedded?: boolean
  /**
   * Identity of the workspace a generated model would be written into. §16.7:
   * if this changes between sending the request and placing the result, the
   * result is NOT written into the stale destination — it is offered as a
   * recoverable download instead.
   */
  workspaceId?: string | null
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

const TAB_ORDER: readonly CreateTab[] = ['description', 'document', 'excel']

const MAX_TOKENS = 8_000
// A full-fidelity attachment draft (a 14-function register process) scales to
// ~8–10k output tokens — over the text cap → truncation → a fake "semantic"
// failure. Attachment runs (and their repair turns, which re-emit the FULL
// draft) get a larger budget. 16k tokens ≈ 64–100 KB, well inside the 1 MiB
// MAX_PROVIDER_RESPONSE_BODY_BYTES bound (Wave 8 M6).
const MAX_ATTACHMENT_TOKENS = 16_000

// --- chrome transcribed from AiPanelLite's visual system -------------------

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
    background: active ? 'var(--orbitpm-primary-bg)' : 'transparent',
    color: active ? 'var(--orbitpm-primary-fg)' : 'inherit',
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
const removeBtn: CSSProperties = {
  border: '1px solid rgba(127,127,127,0.35)',
  background: 'transparent',
  color: 'inherit',
  borderRadius: 6,
  padding: '0.15rem 0.5rem',
  fontSize: 11.5,
  cursor: 'pointer',
  flexShrink: 0
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
const listStyle: CSSProperties = {
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
  onContinueInChat,
  embedded = false,
  workspaceId,
  callProvider,
  parseDocx,
  encodeAttachment
}: ArisGenerationPanelProps): JSX.Element {
  const lang = useLang()
  const [tab, setTab] = useState<CreateTab>('description')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [hint, setHint] = useState('')
  const [providerId, setProviderId] = useState<LiteProviderId>(
    () => getProviderSelection()?.providerId ?? LITE_PROVIDERS[0].id
  )
  const [modelId, setModelId] = useState<string>(
    () => getProviderSelection()?.modelId ?? defaultLiteModelId(LITE_PROVIDERS[0].id)
  )
  const [docx, setDocx] = useState<PickedDocx | null>(null)
  const [descriptionPdf, setDescriptionPdf] = useState<PickedAttachment | null>(null)
  const [documentFile, setDocumentFile] = useState<PickedAttachment | null>(null)
  const [attachmentNotice, setAttachmentNotice] = useState<string | null>(null)
  // §16.6 M7: when the selected model rejects a picked attachment for a
  // capability reason, offer a one-click switch to a curated model that can
  // take it (no silent auto-switch — the panel's "no fallback" stance stands).
  const [attachmentSwitch, setAttachmentSwitch] = useState<{
    readonly suggested: string
    readonly target: 'description-pdf' | 'document'
  } | null>(null)
  const rejectedFileRef = useRef<File | null>(null)
  const [selectionError, setSelectionError] = useState<string | null>(null)
  const [online, setOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine
  )
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [aiCreated, setAiCreated] = useState(false)
  const [rejections, setRejections] = useState<readonly string[]>([])
  const [warnings, setWarnings] = useState<readonly string[]>([])
  const [excelIssues, setExcelIssues] = useState<readonly string[]>([])
  const [recovery, setRecovery] = useState<ArisAiRecoveryArtifact | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const workbookInputRef = useRef<HTMLInputElement | null>(null)
  const docxInputRef = useRef<HTMLInputElement | null>(null)
  const descriptionPdfInputRef = useRef<HTMLInputElement | null>(null)
  const documentInputRef = useRef<HTMLInputElement | null>(null)
  const tabRefs = useRef<Record<CreateTab, HTMLButtonElement | null>>({
    description: null,
    document: null,
    excel: null
  })

  // §16.7 reads this at PLACEMENT time, not at send time, so a workspace swap
  // mid-request is visible to the decision.
  const workspaceIdRef = useRef<string | null>(workspaceId ?? null)
  workspaceIdRef.current = workspaceId ?? null

  const trimmedDescription = description.trim()
  const trimmedHint = hint.trim()
  const attachment = tab === 'document' ? documentFile : descriptionPdf

  const provider = getLiteProvider(providerId)
  const providerReady = hasKey(providerId)
  const noKeysAtAll = LITE_PROVIDERS.every((entry) => !hasKey(entry.id))

  // Keep every AI surface on the one explicit provider/model selection. There
  // is deliberately no provider-order or "first key" fallback.
  useEffect(
    () =>
      subscribeProviderSelection((selection) => {
        if (!selection) return
        setProviderId(selection.providerId)
        setModelId(selection.modelId)
      }),
    []
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

  const prompt = useMemo(
    () =>
      buildArisAiPrompt({
        modelName: name.trim() === '' ? t('aris.generated.fallbackName') : name.trim(),
        modelType: 'auto-detect',
        description: operatorRequest,
        ...(tab === 'description' && docx ? { attachmentText: docx.text } : {})
      }),
    [docx, name, operatorRequest, tab]
  )

  const cancel = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    setBusy(false)
    setAiCreated(false)
    setStatus(tk('aris.ai.cancelled', 'The request was cancelled; nothing was created.'))
  }, [])

  const selectProvider = useCallback((next: LiteProviderId) => {
    const nextModel = defaultLiteModelId(next)
    setProviderId(next)
    setModelId(nextModel)
    // A provider/model swap can invalidate an already-picked attachment, so
    // the capability gate is re-run at pick time AND at send time.
    setAttachmentNotice(null)
    setAttachmentSwitch(null)
    rejectedFileRef.current = null
    const result = setProviderSelection(next, nextModel)
    setSelectionError(
      result.ok
        ? null
        : t('settings.storageError.providerSelection', {
            error: keyStorageErrorMessage(result.code)
          })
    )
  }, [])

  const selectModel = useCallback(
    (nextModel: string) => {
      setModelId(nextModel)
      if (!nextModel.trim()) return
      const result = setProviderSelection(providerId, nextModel)
      setSelectionError(
        result.ok
          ? null
          : t('settings.storageError.providerSelection', {
              error: keyStorageErrorMessage(result.code)
            })
      )
    },
    [providerId]
  )

  const handleTabKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>, current: CreateTab): void => {
      const currentIndex = TAB_ORDER.indexOf(current)
      if (currentIndex < 0) return
      let nextIndex: number | undefined
      if (event.key === 'Home') {
        nextIndex = 0
      } else if (event.key === 'End') {
        nextIndex = TAB_ORDER.length - 1
      } else if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
        const visualForward =
          event.key === 'ArrowRight' ? (lang === 'ar' ? -1 : 1) : lang === 'ar' ? 1 : -1
        nextIndex = (currentIndex + visualForward + TAB_ORDER.length) % TAB_ORDER.length
      }
      if (nextIndex === undefined) return
      event.preventDefault()
      const next = TAB_ORDER[nextIndex]
      setTab(next)
      tabRefs.current[next]?.focus()
    },
    [lang]
  )

  // --- attachment pickers (§16.6 steps 1-2 run before any byte is read) -----

  const pickAttachment = useCallback(
    (file: File, target: 'description-pdf' | 'document', modelOverride?: string) => {
      setStatus(null)
      // `modelOverride` lets the one-click switch re-check against the model it
      // just selected without waiting for the state update to flush (§16.6 M7).
      const effectiveModel = modelOverride ?? modelId
      const check = checkArisAiAttachment({ providerId, modelId: effectiveModel, file })
      if (!check.ok) {
        setAttachmentNotice(check.message)
        if (target === 'document') setDocumentFile(null)
        else setDescriptionPdf(null)
        // Offer a switch to a curated model that CAN take this file, for the
        // three capability rejections, on OpenRouter, when such a model exists.
        const suggestion =
          providerId === 'openrouter' &&
          (check.code === 'pdf-unsupported' ||
            check.code === 'image-unsupported' ||
            check.code === 'model-unverified')
            ? firstLiteModelForAttachment(
                'openrouter',
                classifyArisAiAttachmentFile(file)?.kind ?? 'image'
              )
            : null
        if (suggestion && suggestion.trim() !== effectiveModel.trim()) {
          rejectedFileRef.current = file
          setAttachmentSwitch({ suggested: suggestion, target })
        } else {
          rejectedFileRef.current = null
          setAttachmentSwitch(null)
        }
        return
      }
      // Accepted — any prior switch offer is now moot.
      rejectedFileRef.current = null
      setAttachmentSwitch(null)
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

  // The explicit one-click switch: adopt the suggested model, then re-run the
  // capability gate against the kept file with that model (no auto-send).
  const switchModelAndAttach = useCallback(() => {
    const pending = attachmentSwitch
    const file = rejectedFileRef.current
    if (!pending || !file) return
    selectModel(pending.suggested)
    pickAttachment(file, pending.target, pending.suggested)
  }, [attachmentSwitch, pickAttachment, selectModel])

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
    (hasAttachment: boolean): ArisAiSend =>
      async (request, signal) => {
        if (callProvider) return callProvider(request, signal)
        // Enum-locked json_schema on structured-output OpenRouter routes (M5):
        // CT_FLOW becomes unrepresentable. Every other route keeps json_object.
        const responseSchema =
          providerId === 'openrouter' && OPENROUTER_STRUCTURED_OUTPUT_MODELS.has(modelId.trim())
            ? { name: 'aris_ai_draft_v1', schema: buildArisAiDraftJsonSchema() }
            : undefined
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
            ...(responseSchema ? { responseSchema } : {}),
            signal
          }
        )
        const result = await call(
          request.messages.map((message) => ({ role: message.role, content: message.content })),
          // A larger budget for the whole run when an attachment is in play —
          // repair turns re-emit the full draft, so keying on request.attachment
          // (present on the first turn only) would starve turns 2+ (M6).
          { maxTokens: hasAttachment ? MAX_ATTACHMENT_TOKENS : MAX_TOKENS }
        )
        return typeof result === 'string' ? result : JSON.stringify(result)
      },
    [callProvider, modelId, providerId]
  )

  const createWithAi = useCallback(async () => {
    if (busy) return
    if (tab === 'document' ? !documentFile : trimmedDescription === '') return
    setRejections([])
    setWarnings([])
    setRecovery(null)
    setStatus(null)
    setAiCreated(false)
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
        send: buildSend(encoded !== undefined),
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
      setAiCreated(true)
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
      setAiCreated(false)
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
    (!providerReady && !callProvider) ||
    (tab === 'document' ? documentFile === null : trimmedDescription === '')

  const providerControls = (
    <>
      <label style={labelStyle}>
        <span style={labelText}>{tk('aris.create.provider', 'Provider')}</span>
        <select
          value={providerId}
          data-orbitpm-aris-create-provider=""
          onChange={(event) => selectProvider(event.target.value as LiteProviderId)}
          style={inputStyle}
        >
          {LITE_PROVIDERS.map((entry) => (
            <option key={entry.id} value={entry.id} lang="en" dir="ltr">
              {entry.label}
              {hasKey(entry.id) ? ' ✓' : ''}
            </option>
          ))}
        </select>
      </label>

      {provider.allowCustomModel ? (
        <label style={labelStyle}>
          <span style={labelText}>{tk('aris.create.model', 'Model')}</span>
          <input
            type="text"
            list={`aris-create-models-${providerId}`}
            value={modelId}
            data-orbitpm-aris-create-model=""
            lang="en"
            dir="ltr"
            onChange={(event) => selectModel(event.target.value)}
            placeholder={tk('aris.create.model', 'Model')}
            style={inputStyle}
          />
          <datalist id={`aris-create-models-${providerId}`}>
            {provider.models.map((entry) => (
              <option key={entry.id} value={entry.id} lang="en" dir="ltr">
                {entry.label}
              </option>
            ))}
          </datalist>
        </label>
      ) : (
        <label style={labelStyle}>
          <span style={labelText}>{tk('aris.create.model', 'Model')}</span>
          <select
            value={modelId}
            data-orbitpm-aris-create-model=""
            onChange={(event) => selectModel(event.target.value)}
            style={inputStyle}
          >
            {provider.models.map((entry) => (
              <option key={entry.id} value={entry.id} lang="en" dir="ltr">
                {entry.label}
              </option>
            ))}
          </select>
        </label>
      )}
    </>
  )

  const submitControls = (
    <>
      {!providerReady && !callProvider && !noKeysAtAll && (
        <div style={infoBox}>
          {tk(
            'aris.create.noKey',
            'No API key is stored for this provider. Open Settings to add one.'
          )}{' '}
          <button type="button" onClick={onOpenSettings} style={linkBtn}>
            {t('app.settings')}
          </button>
        </div>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <button
          type="button"
          className="orbitpm-lite-primary"
          data-orbitpm-aris-create-submit=""
          onClick={() => void createWithAi()}
          disabled={submitDisabled}
          style={{ display: 'flex', alignItems: 'center', gap: 8 }}
        >
          {busy && <Spinner />}
          {busy
            ? t('aris.ai.creating')
            : tab === 'document'
              ? tk('aris.create.document.create', 'Generate from document')
              : t('aris.ai.create')}
        </button>
        {busy && (
          <button
            type="button"
            data-orbitpm-aris-create-cancel=""
            onClick={cancel}
            style={ghostBtn}
          >
            {tk('aris.import.review.cancel', 'Cancel')}
          </button>
        )}
        <button type="button" onClick={onOpenAssistant} style={ghostBtn}>
          {t('aris.placeholder.openAssistant')}
        </button>
        <button type="button" onClick={onOpenSettings} style={ghostBtn}>
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
        border: embedded ? 'none' : '1px solid var(--orbitpm-border)',
        borderRadius: embedded ? 0 : 12,
        background: embedded ? 'transparent' : 'var(--orbitpm-panel-bg, var(--orbitpm-bg))'
      }}
    >
      <div style={{ padding: '0.8rem', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'grid', gap: 4 }}>
          <strong style={{ fontSize: 14 }}>{t('ai.header')}</strong>
          <p style={{ margin: 0, fontSize: 12.5, color: 'var(--orbitpm-muted)', lineHeight: 1.5 }}>
            {t('aris.ai.body')}
          </p>
        </div>

        <div
          role="tablist"
          aria-label={tk('aris.create.tabsAria', 'Create input source')}
          aria-orientation="horizontal"
          style={segmentWrap}
        >
          <button
            ref={(node) => {
              tabRefs.current.description = node
            }}
            type="button"
            role="tab"
            aria-selected={tab === 'description'}
            tabIndex={tab === 'description' ? 0 : -1}
            data-orbitpm-aris-create-description-tab=""
            onClick={() => setTab('description')}
            onKeyDown={(event) => handleTabKeyDown(event, 'description')}
            style={segmentBtn(tab === 'description')}
          >
            {tk('aris.create.tab.description', 'Description')}
          </button>
          <button
            ref={(node) => {
              tabRefs.current.document = node
            }}
            type="button"
            role="tab"
            aria-selected={tab === 'document'}
            tabIndex={tab === 'document' ? 0 : -1}
            data-orbitpm-aris-create-document-tab=""
            onClick={() => setTab('document')}
            onKeyDown={(event) => handleTabKeyDown(event, 'document')}
            style={segmentBtn(tab === 'document')}
          >
            {tk('aris.create.tab.document', 'PDF / Picture')}
          </button>
          <button
            ref={(node) => {
              tabRefs.current.excel = node
            }}
            type="button"
            role="tab"
            aria-selected={tab === 'excel'}
            tabIndex={tab === 'excel' ? 0 : -1}
            data-orbitpm-aris-create-excel-tab=""
            onClick={() => setTab('excel')}
            onKeyDown={(event) => handleTabKeyDown(event, 'excel')}
            style={segmentBtn(tab === 'excel')}
          >
            {tk('aris.create.tab.excel', 'Excel')}
          </button>
        </div>

        {tab !== 'excel' && !online && (
          <div role="status" style={warnBox}>
            {t('ai.offlineWarning')}
          </div>
        )}

        {tab !== 'excel' && noKeysAtAll && (
          <div style={infoBox}>
            {t('ai.noKeysAtAll.note').split('{link}')[0]}
            <button type="button" onClick={onOpenSettings} style={linkBtn}>
              {t('ai.noKeysAtAll.link')}
            </button>
            {t('ai.noKeysAtAll.note').split('{link}')[1]}
          </div>
        )}

        {tab === 'description' && (
          <>
            <label style={labelStyle}>
              <span style={labelText}>{t('aris.ai.name')}</span>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={t('aris.ai.namePlaceholder')}
                style={inputStyle}
              />
            </label>

            {providerControls}

            <label style={labelStyle}>
              <span style={labelText}>{t('aris.ai.description')}</span>
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder={t('aris.ai.descriptionPlaceholder')}
                rows={6}
                style={{ ...inputStyle, minHeight: 120, resize: 'vertical' }}
              />
            </label>

            <div style={{ display: 'grid', gap: 6 }}>
              <span style={labelText}>
                {tk(
                  'aris.create.attachments.label',
                  'Optional attachment — a DOCX is read on this device, a PDF is sent to the provider'
                )}
              </span>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  style={ghostBtn}
                  data-orbitpm-aris-create-docx=""
                  disabled={busy}
                  onClick={() => docxInputRef.current?.click()}
                >
                  {tk('aris.create.docx.choose', 'Attach DOCX…')}
                </button>
                <button
                  type="button"
                  style={ghostBtn}
                  data-orbitpm-aris-create-pdf=""
                  disabled={busy}
                  onClick={() => descriptionPdfInputRef.current?.click()}
                >
                  {tk('aris.create.pdf.choose', 'Attach PDF…')}
                </button>
                {(docx !== null || descriptionPdf !== null) && (
                  <button
                    type="button"
                    style={removeBtn}
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

            {submitControls}
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

            <label style={labelStyle}>
              <span style={labelText}>{t('aris.ai.name')}</span>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={t('aris.ai.namePlaceholder')}
                style={inputStyle}
              />
            </label>

            {providerControls}

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                type="button"
                style={ghostBtn}
                data-orbitpm-aris-create-document-open=""
                disabled={busy}
                onClick={() => documentInputRef.current?.click()}
              >
                {tk('aris.create.document.choose', 'Choose PDF or picture…')}
              </button>
              {documentFile && (
                <button
                  type="button"
                  style={removeBtn}
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

            <label style={labelStyle}>
              <span style={labelText}>
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

            {submitControls}
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
                style={ghostBtn}
                data-orbitpm-aris-template-blank=""
                onClick={() => downloadTemplate('blank')}
              >
                {tk('aris.excel.downloadBlank', 'Download blank template')}
              </button>
              <button
                type="button"
                style={ghostBtn}
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

        {attachmentSwitch !== null && tab !== 'excel' && (
          <button
            type="button"
            data-orbitpm-aris-create-attachment-switch=""
            style={removeBtn}
            onClick={switchModelAndAttach}
          >
            {tk('aris.create.attachment.switchModel', 'Switch to {model} and attach', {
              model: attachmentSwitch.suggested
            })}
          </button>
        )}

        {selectionError !== null && (
          <div role="alert" style={errorBox} data-orbitpm-aris-create-selection-error="">
            <span>{selectionError}</span>
          </div>
        )}

        {rejections.length > 0 && (
          <div role="alert" style={errorBox}>
            <ul data-orbitpm-aris-create-rejections="" style={listStyle}>
              {rejections.map((line, index) => (
                <li key={`${index}:${line}`}>{line}</li>
              ))}
            </ul>
          </div>
        )}

        {warnings.length > 0 && (
          <div style={warnBox}>
            <ul data-orbitpm-aris-create-warnings="" style={listStyle}>
              {warnings.map((line, index) => (
                <li key={`${index}:${line}`}>{line}</li>
              ))}
            </ul>
          </div>
        )}

        {recovery !== null && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              style={ghostBtn}
              data-orbitpm-aris-create-recovery=""
              onClick={() => onDownloadFile(recovery.fileName, recovery.bytes, recovery.mimeType)}
            >
              {tk('aris.create.recovery.download', 'Download the generated AML ({name})', {
                name: recovery.fileName
              })}
            </button>
            <button
              type="button"
              style={ghostBtn}
              data-orbitpm-aris-create-recovery-discard=""
              onClick={() => setRecovery(null)}
            >
              {tk('aris.create.recovery.discard', 'Discard the generated AML')}
            </button>
          </div>
        )}

        {status &&
          (aiCreated ? (
            <div role="status" style={okBox}>
              <span>{status}</span>
              {onContinueInChat && (
                <button
                  type="button"
                  data-orbitpm-aris-create-continue-chat=""
                  onClick={onContinueInChat}
                  style={{ ...ghostBtn, alignSelf: 'flex-start' }}
                >
                  {t('ai.continueInChat')}
                </button>
              )}
            </div>
          ) : (
            <p role="status" style={{ margin: 0, fontSize: 12 }}>
              {status}
            </p>
          ))}
      </div>
    </section>
  )
}

export default ArisGenerationPanel
