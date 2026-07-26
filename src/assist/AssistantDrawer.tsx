// The OrbitPM Lite "process assistant" — a floating chat drawer with two tabs:
//
//   * LIBRARY ("ask the process library") — answers "what happens next / who
//     owns this step / which process do I follow" over the workspace's own
//     BPMN files. When a browser-callable provider key is configured, the
//     retrieved process digests are rendered into a grounded prompt (with the
//     prior Q/A turns, bounded — real multi-turn conversation) and sent through
//     the SAME transport the AI generation panel uses (makeBrowserCallLLM).
//     Failures are surfaced as classified chat messages (ai.error.*) and then
//     degrade to the deterministic local answerer (answerLocally), which is
//     also the whole answer when no key is configured.
//   * INTERVIEW ("complete this process") — fills a freshly generated draft's
//     missing information through conversational Q&A: scan the open diagram
//     for gaps (org completeness rules + CC-purpose check), ask the model for
//     the next batch of at most 3 questions (flow gaps in scope), regenerate
//     the diagram from the accumulated conversation via the shared pipeline,
//     apply through onApplyXml, re-scan, repeat. See interview.ts for the pure
//     logic + stop conditions.
//
// The component is self-contained: it owns its message lists + input state and
// reads the shared provider/model choice the user explicitly made (shown in the
// footer). The App
// supplies the digests (memoized), an open-a-process callback, the interview
// target accessors, and the open/close wiring.

import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { t, getLang } from '../i18n'
import { useLang } from '../i18n/useLang'
import {
  composeCreateBpmn,
  generateFromDescription,
  messageHistoryToString,
  type LlmMessage
} from '@/generation'
import type { ProcessDigest } from './digest'
import { selectContextDigests } from './retrieval'
import { extractAssistantAnswer } from './prompt'
import { answerLocally } from './answerLocal'
import { formatLocalAnswer, type AssistantSource } from './formatLocal'
import { toLlmHistory } from './history'
import {
  scanDiagramGaps,
  buildDiagramSummary,
  buildInterviewQuestionPrompt,
  parseInterviewQuestions,
  buildGenerationHistory,
  decideInterviewNext,
  relevantDigestsToCatalog,
  readProcessId,
  QUESTIONS_MAX_TOKENS,
  type InterviewExchange,
  type GapScan,
  type InterviewModeler
} from './interview'
import { getLiteProvider, type LiteProviderId } from '../ai/providersLite'
import { getKey } from '../ai/keys'
import { getProviderSelection } from '../ai/providerSelection'
import { makeBrowserCallLLM, classifyBrowserError, type ErrorCode } from '../ai/browserAi'
import type { RetryAttempt } from '../ai/retry'
import {
  grantExternalRequestConsent,
  hasExternalRequestConsent,
  type ExternalRequestConsent,
  type ExternalRequestDisclosure
} from '../localization/externalRequestReview'
import { buildReviewedLibraryRequest, createLlmMessageDisclosure } from './requestReview'
import { ExternalRequestPreview } from './ExternalRequestPreview'
import { UNTRUSTED_WORKSPACE_SYSTEM_GUARD } from '../ai/untrustedPrompt'

type Source = AssistantSource
interface Message {
  role: 'user' | 'assistant'
  text: string
  /** 'chat' (default) = a real Q/A turn (enters the LLM history); 'error' and
   *  'status' are display-only bubbles. */
  kind?: 'chat' | 'error' | 'status'
  sources?: Source[]
}

interface ChosenProvider {
  id: LiteProviderId
  label: string
  modelId: string
  apiKey: string
}

/** The open generated draft the interview works on. */
export interface InterviewTarget {
  /** App tab key of the diagram (handed back through onApplyXml). */
  tabKey: string
  /** The tab's live bpmn-js modeler (only `get('elementRegistry'|'canvas')`
   *  services are read — see interview.ts's structural typing). */
  modeler: unknown
  /** The original description the draft was generated from ('' if unknown). */
  description: string
}

export interface AssistantDrawerProps {
  open: boolean
  onOpen: () => void
  onClose: () => void
  /** Hide the floating button + panel while a print job overlays the page. */
  printing: boolean
  /** Directory mode shows source chips (openable); fallback mode hides them. */
  mode: 'directory' | 'fallback'
  /** Bumped by the App when provider keys change, so we re-pick the provider. */
  keysVersion: number
  /** App-memoized digest builder (recomputed when the workspace files change). */
  getDigests: () => Promise<ProcessDigest[]>
  /** Open a workspace process by its relative path (directory mode). */
  onOpenProcess: (relPath: string) => void
  /** Current interview target — the active tab's generated draft — or null
   *  when no diagram is open. Re-read at every interview step so the scan
   *  always sees the LIVE modeler. Optional: without it the interview tab
   *  shows the no-modeler hint. */
  getActiveInterviewTarget?: () => InterviewTarget | null
  /** Imperative "start the interview now" request, fired by the App right
   *  after AI placement. A NEW token starts a FRESH interview for `tabKey`
   *  (opening the drawer + switching to the interview tab). */
  interviewRequest?: { token: number; tabKey: string } | null
  /** Apply regenerated XML to a tab. The App owns the modeler import + dirty
   *  handling; the drawer awaits it before continuing the loop. */
  onApplyXml?: (tabKey: string, xml: string) => Promise<void> | void
}

/** The one provider/model explicitly selected for every AI surface. */
function pickProvider(): ChosenProvider | null {
  const selection = getProviderSelection()
  if (!selection) return null
  const apiKey = getKey(selection.providerId)
  if (!apiKey) return null
  return {
    id: selection.providerId,
    label: getLiteProvider(selection.providerId).label,
    modelId: selection.modelId,
    apiKey
  }
}

/** Map a classified browser error onto the ai.error.* dictionary (the unknown
 *  class shows the raw first-line message the classifier already trimmed). */
const ERROR_KEY: Record<Exclude<ErrorCode, 'unknown'>, Parameters<typeof t>[0]> = {
  auth: 'ai.error.auth',
  rate: 'ai.error.rateLimit',
  cors: 'ai.error.cors',
  network: 'ai.error.network',
  timeout: 'ai.error.timeout',
  cancelled: 'ai.error.cancelled'
}

function errorText(error: unknown): string {
  const classified = classifyBrowserError(error)
  if (classified.code === 'unknown') return classified.message
  return t(ERROR_KEY[classified.code])
}

/** Reply budget for a library answer (the JSON {"answer": …} wrapper included). */
const ANSWER_MAX_TOKENS = 900

type DrawerTab = 'library' | 'interview'

interface InterviewSession {
  started: boolean
  done: boolean
  tabKey: string | null
  description: string
  exchanges: InterviewExchange[]
  pendingQuestions: string | null
  /** Question batches asked so far (1-based round counter). */
  round: number
}

interface ExternalActionPlan {
  disclosure: ExternalRequestDisclosure
  run(signal: AbortSignal, onAttempt: (attempt: RetryAttempt) => void): Promise<void>
}

interface PendingExternalAction {
  id: number
  tab: DrawerTab
  build(includeWorkspaceContext: boolean, redactNames: boolean): ExternalActionPlan
}

function freshSession(): InterviewSession {
  return {
    started: false,
    done: false,
    tabKey: null,
    description: '',
    exchanges: [],
    pendingQuestions: null,
    round: 0
  }
}

function redactInterviewSummary(summary: string): string {
  let labelIndex = 0
  return summary
    .replace(/"[^"\n]*"/g, () => `"Element ${++labelIndex}"`)
    .replace(
      /\b(owner|responsible|systems?|CC):\s*[^|—\n]*/gi,
      (_match, label: string) => `${label}: [redacted]`
    )
}

function redactCatalogNames(
  catalog: readonly { id: string; name: string }[]
): Array<{ id: string; name: string }> {
  return catalog.map((entry, index) => ({
    id: entry.id,
    name: `Process ${index + 1}`
  }))
}

function reviewInterviewScan(
  scan: GapScan,
  includeWorkspaceContext: boolean,
  redactNames: boolean
): GapScan {
  if (!includeWorkspaceContext) return { entries: [], clean: true }
  if (!redactNames) return scan
  return {
    clean: scan.clean,
    entries: scan.entries.map((entry, index) => ({
      ...entry,
      label: `Element ${index + 1}`,
      ccMissingPurpose: entry.ccMissingPurpose.map(() => '[redacted recipient]')
    }))
  }
}

export function AssistantDrawer({
  open,
  onOpen,
  onClose,
  printing,
  mode,
  keysVersion,
  getDigests,
  onOpenProcess,
  getActiveInterviewTarget,
  interviewRequest,
  onApplyXml
}: AssistantDrawerProps): JSX.Element | null {
  useLang()
  const [tab, setTab] = useState<DrawerTab>('library')
  const [messages, setMessages] = useState<Message[]>([])
  const [ivMessages, setIvMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [ivBusy, setIvBusy] = useState(false)
  const [ivDone, setIvDone] = useState(false)
  const [ivAwaiting, setIvAwaiting] = useState(false)
  const [pendingExternal, setPendingExternal] = useState<PendingExternalAction | null>(null)
  const [includeWorkspaceContext, setIncludeWorkspaceContext] = useState(false)
  const [redactNames, setRedactNames] = useState(true)
  const [externalConsent, setExternalConsent] = useState<ExternalRequestConsent | null>(null)
  const [attemptStatus, setAttemptStatus] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  const sessionRef = useRef<InterviewSession>(freshSession())
  const lastRequestTokenRef = useRef<number | null>(null)
  const externalRequestIdRef = useRef(0)
  const externalAbortRef = useRef<AbortController | null>(null)

  // The prop rerender already invalidates this read; no provider-order fallback
  // or memoized stale credential is retained.
  void keysVersion
  const provider = pickProvider()

  // Auto-scroll the transcript to the newest message.
  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, ivMessages, busy, ivBusy, tab])

  // Escape closes the drawer.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        externalAbortRef.current?.abort()
        externalAbortRef.current = null
        setPendingExternal(null)
        setExternalConsent(null)
        setAttemptStatus(null)
        setBusy(false)
        setIvBusy(false)
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const pushIv = (message: Message): void => {
    setIvMessages((prev) => [...prev, message])
  }

  const makeCall = (
    chosen: ChosenProvider,
    signal?: AbortSignal,
    onAttempt?: (attempt: RetryAttempt) => void
  ): ReturnType<typeof makeBrowserCallLLM> =>
    makeBrowserCallLLM(
      { providerId: chosen.id, model: chosen.modelId, apiKey: chosen.apiKey },
      { signal, onAttempt }
    )

  const queueExternal = (tabForRequest: DrawerTab, build: PendingExternalAction['build']): void => {
    externalAbortRef.current?.abort()
    setAttemptStatus(null)
    setExternalConsent(null)
    setPendingExternal({
      id: ++externalRequestIdRef.current,
      tab: tabForRequest,
      build
    })
  }

  const currentExternalPlan = pendingExternal?.build(includeWorkspaceContext, redactNames)
  const externalConsented = Boolean(
    currentExternalPlan &&
    hasExternalRequestConsent(currentExternalPlan.disclosure, externalConsent)
  )

  const cancelExternal = (): void => {
    externalAbortRef.current?.abort()
    externalAbortRef.current = null
    setPendingExternal(null)
    setExternalConsent(null)
    setAttemptStatus(null)
    setBusy(false)
    setIvBusy(false)
  }

  const confirmExternal = async (): Promise<void> => {
    const pending = pendingExternal
    const plan = currentExternalPlan
    if (!pending || !plan || !hasExternalRequestConsent(plan.disclosure, externalConsent)) {
      return
    }
    const controller = new AbortController()
    externalAbortRef.current?.abort()
    externalAbortRef.current = controller
    setAttemptStatus(null)
    if (pending.tab === 'library') setBusy(true)
    else setIvBusy(true)
    const onAttempt = (attempt: RetryAttempt): void => {
      setAttemptStatus(
        attempt.retryInMs === undefined
          ? t('ai.retry.attempt', {
              attempt: attempt.attempt,
              max: attempt.maxAttempts
            })
          : t('ai.retry.waiting', {
              attempt: attempt.attempt,
              max: attempt.maxAttempts,
              seconds: Math.max(0, Math.ceil(attempt.retryInMs / 1000))
            })
      )
    }
    try {
      await plan.run(controller.signal, onAttempt)
    } catch (error) {
      const failure: Message = {
        role: 'assistant',
        text: errorText(error),
        kind: 'error'
      }
      if (pending.tab === 'library') setMessages((previous) => [...previous, failure])
      else pushIv(failure)
    } finally {
      if (externalAbortRef.current === controller) externalAbortRef.current = null
      if (pending.tab === 'library') setBusy(false)
      else setIvBusy(false)
      setPendingExternal((current) => (current?.id === pending.id ? null : current))
      setExternalConsent(null)
      setAttemptStatus(null)
    }
  }

  useEffect(
    () => () => {
      externalAbortRef.current?.abort()
    },
    []
  )

  // --- library tab -----------------------------------------------------------

  const sendLibrary = async (q: string): Promise<void> => {
    const prior = messages
    setMessages((prev) => [...prev, { role: 'user', text: q, kind: 'chat' }])
    setBusy(true)
    const dirChips = mode === 'directory'
    try {
      const digests = await getDigests()

      // Local formatting shared by the no-key and fell-back paths.
      const pushLocal = (prefix?: string): void => {
        const local = formatLocalAnswer(answerLocally(digests, q))
        const text = prefix ? `${prefix}\n\n${local.text}` : local.text
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            text,
            kind: 'chat',
            sources: dirChips && local.sources.length ? local.sources : undefined
          }
        ])
      }

      if (!provider) {
        pushLocal()
        return
      }

      // Low-confidence retrieval returns no context. The user's question can
      // still be reviewed and sent, but unrelated processes are never used as
      // a fallback and workspace context is always opt-in.
      const chosen = selectContextDigests(digests, q)
      const history = toLlmHistory(prior)
      const chosenProvider = provider
      queueExternal('library', (includeContext, shouldRedactNames) => {
        const reviewed = buildReviewedLibraryRequest({
          providerId: chosenProvider.id,
          modelId: chosenProvider.modelId,
          question: q,
          history,
          rankedDigests: chosen,
          lang: getLang(),
          includeWorkspaceContext: includeContext,
          redactNames: shouldRedactNames,
          estimatedRequests: { min: 1, max: 3 }
        })
        return {
          disclosure: reviewed.disclosure,
          run: async (signal, onAttempt) => {
            const call = makeCall(chosenProvider, signal, onAttempt)
            const reply = String(
              await call(reviewed.messages, {
                maxTokens: ANSWER_MAX_TOKENS
              })
            )
            const text = extractAssistantAnswer(reply)
            const sources = includeContext
              ? chosen.slice(0, 3).map((ranked) => ({
                  processName: ranked.digest.processName,
                  relPath: ranked.digest.relPath
                }))
              : []
            setMessages((previous) => [
              ...previous,
              {
                role: 'assistant',
                text,
                kind: 'chat',
                sources: dirChips && sources.length > 0 ? sources : undefined
              }
            ])
          }
        }
      })
    } catch {
      // getDigests should never reject (buildAllDigests drops failures), but keep
      // the drawer usable if it somehow does.
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', text: t('assist.local.none'), kind: 'status' }
      ])
    } finally {
      setBusy(false)
    }
  }

  // --- interview tab ---------------------------------------------------------

  const runInterviewRound = async (): Promise<void> => {
    const session = sessionRef.current
    if (!session.started || session.done) return
    const target = getActiveInterviewTarget?.() ?? null
    if (!target) {
      pushIv({ role: 'assistant', text: t('assist.interview.noModeler'), kind: 'status' })
      return
    }
    if (!provider) {
      pushIv({ role: 'assistant', text: t('ai.error.noApiKey'), kind: 'error' })
      return
    }
    try {
      const modeler = target.modeler as InterviewModeler
      const scan = scanDiagramGaps(modeler)
      const summary = buildDiagramSummary(modeler)
      const chosenProvider = provider
      const description = session.description || target.description
      const exchanges = [...session.exchanges]
      const lang = getLang()
      queueExternal('interview', (includeContext, shouldRedactNames) => {
        const reviewedSummary = includeContext
          ? shouldRedactNames
            ? redactInterviewSummary(summary)
            : summary
          : '(workspace diagram context excluded by the user)'
        const prompt = buildInterviewQuestionPrompt({
          description,
          summary: reviewedSummary,
          scan: reviewInterviewScan(scan, includeContext, shouldRedactNames),
          exchanges,
          lang
        })
        const outgoing: LlmMessage[] = [
          { role: 'system', content: UNTRUSTED_WORKSPACE_SYSTEM_GUARD },
          { role: 'user', content: prompt }
        ]
        return {
          disclosure: createLlmMessageDisclosure({
            purpose: 'assistant-interview-question',
            providerId: chosenProvider.id,
            modelId: chosenProvider.modelId,
            messages: outgoing,
            sensitiveMessageIndexes: [outgoing.length - 1],
            estimatedRequests: { min: 1, max: 3 }
          }),
          run: async (signal, onAttempt) => {
            const call = makeCall(chosenProvider, signal, onAttempt)
            const reply = String(
              await call(outgoing, {
                maxTokens: QUESTIONS_MAX_TOKENS
              })
            )
            const questions = parseInterviewQuestions(reply)
            if (questions === null) {
              throw new Error(`${chosenProvider.id}: empty response from the model`)
            }
            const liveSession = sessionRef.current
            const nextRound = liveSession.round + 1
            if (decideInterviewNext(nextRound, questions) === 'done') {
              liveSession.done = true
              setIvDone(true)
              setIvAwaiting(false)
              pushIv({
                role: 'assistant',
                text: t('assist.interview.done'),
                kind: 'status'
              })
              return
            }
            liveSession.round = nextRound
            liveSession.pendingQuestions = questions.join('\n')
            setIvAwaiting(true)
            pushIv({
              role: 'assistant',
              text: liveSession.pendingQuestions,
              kind: 'chat'
            })
          }
        }
      })
    } catch (error) {
      pushIv({ role: 'assistant', text: errorText(error), kind: 'error' })
    }
  }

  const startInterview = async (force: boolean): Promise<void> => {
    const session = sessionRef.current
    if (session.started && !force) return
    const target = getActiveInterviewTarget?.() ?? null
    if (!target) {
      sessionRef.current = freshSession()
      setIvDone(false)
      setIvAwaiting(false)
      setIvMessages([{ role: 'assistant', text: t('assist.interview.noModeler'), kind: 'status' }])
      return
    }
    sessionRef.current = {
      started: true,
      done: false,
      tabKey: target.tabKey,
      description: target.description,
      exchanges: [],
      pendingQuestions: null,
      round: 0
    }
    setIvDone(false)
    setIvAwaiting(false)
    setIvMessages([
      { role: 'assistant', text: t('assist.interview.start'), kind: 'chat' },
      { role: 'assistant', text: t('assist.interview.editWarning'), kind: 'status' }
    ])
    await runInterviewRound()
  }

  const sendInterviewAnswer = async (answer: string): Promise<void> => {
    const session = sessionRef.current
    if (!session.started || session.done || !session.pendingQuestions || ivBusy) return
    pushIv({ role: 'user', text: answer, kind: 'chat' })
    setIvBusy(true)
    try {
      const target = getActiveInterviewTarget?.() ?? null
      if (!target) {
        pushIv({ role: 'assistant', text: t('assist.interview.noModeler'), kind: 'status' })
        return
      }
      if (!provider) {
        pushIv({ role: 'assistant', text: t('ai.error.noApiKey'), kind: 'error' })
        return
      }
      const exchanges = [...session.exchanges, { questions: session.pendingQuestions, answer }]
      const digests = await getDigests()
      const modeler = target.modeler as InterviewModeler
      const description = session.description || target.description
      const history = buildGenerationHistory(description, exchanges)
      const fullCatalog = relevantDigestsToCatalog(
        digests,
        messageHistoryToString(history),
        readProcessId(modeler)
      )
      const chosenProvider = provider
      queueExternal('interview', (includeContext, shouldRedactNames) => {
        const catalog = includeContext
          ? shouldRedactNames
            ? redactCatalogNames(fullCatalog)
            : fullCatalog
          : []
        const prompt = composeCreateBpmn(
          messageHistoryToString(history),
          catalog.length > 0 ? catalog : undefined
        )
        const outgoing: LlmMessage[] = [
          { role: 'system', content: UNTRUSTED_WORKSPACE_SYSTEM_GUARD },
          { role: 'user', content: prompt }
        ]
        return {
          disclosure: createLlmMessageDisclosure({
            purpose: 'assistant-interview-regeneration',
            providerId: chosenProvider.id,
            modelId: chosenProvider.modelId,
            messages: outgoing,
            sensitiveMessageIndexes: [outgoing.length - 1],
            // Semantic repair is deliberately limited to one reviewed payload
            // here. The transport may retry that exact payload up to 3 times.
            estimatedRequests: { min: 1, max: 3 }
          }),
          run: async (signal, onAttempt) => {
            pushIv({
              role: 'assistant',
              text: t('assist.interview.applying'),
              kind: 'status'
            })
            const call = makeCall(chosenProvider, signal, onAttempt)
            const result = await generateFromDescription(call, description, history, {
              maxRetries: 1,
              ...(catalog.length > 0 ? { processCatalog: catalog } : {})
            })
            await onApplyXml?.(target.tabKey, result.layoutedXml)
            // Commit the exchange only after the diagram actually updated, so
            // a failed round can simply be answered again.
            const liveSession = sessionRef.current
            liveSession.exchanges = exchanges
            liveSession.pendingQuestions = null
            setIvAwaiting(false)
            pushIv({
              role: 'assistant',
              text: t('assist.interview.applied'),
              kind: 'status'
            })
            await runInterviewRound()
          }
        }
      })
    } catch (error) {
      pushIv({ role: 'assistant', text: errorText(error), kind: 'error' })
    } finally {
      setIvBusy(false)
    }
  }

  const finishInterview = (): void => {
    const session = sessionRef.current
    if (!session.started || session.done) return
    session.done = true
    setIvDone(true)
    setIvAwaiting(false)
    pushIv({ role: 'assistant', text: t('assist.interview.done'), kind: 'status' })
  }

  // App fired an interview request (after AI placement): open, switch, restart.
  useEffect(() => {
    if (!interviewRequest) return
    if (lastRequestTokenRef.current === interviewRequest.token) return
    lastRequestTokenRef.current = interviewRequest.token
    onOpen()
    setTab('interview')
    void startInterview(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interviewRequest])

  const switchTab = (next: DrawerTab): void => {
    setTab(next)
    if (next === 'interview' && !sessionRef.current.started) {
      void startInterview(false)
    }
  }

  // --- shared input ----------------------------------------------------------

  const canSend =
    tab === 'library'
      ? !busy && pendingExternal === null && input.trim() !== ''
      : !ivBusy && pendingExternal === null && !ivDone && ivAwaiting && input.trim() !== ''

  const send = async (): Promise<void> => {
    const text = input.trim()
    if (!text || !canSend) return
    setInput('')
    if (tab === 'library') await sendLibrary(text)
    else await sendInterviewAnswer(text)
  }

  if (printing) return null

  if (!open) {
    return (
      <button
        type="button"
        onClick={onOpen}
        aria-label={t('assist.open')}
        title={t('assist.open')}
        style={FAB_STYLE}
      >
        💬
      </button>
    )
  }

  const footer = provider
    ? t('assist.model.line', { model: provider.modelId, provider: provider.label })
    : t('assist.localMode')

  const activeMessages = tab === 'library' ? messages : ivMessages
  const activeBusy = tab === 'library' ? busy : ivBusy
  const emptyHint = tab === 'library' ? t('assist.empty') : t('assist.interview.noModeler')
  const showFinish = tab === 'interview' && sessionRef.current.started && !ivDone

  const bubbleStyle = (m: Message): CSSProperties => {
    if (m.role === 'user') return BUBBLE_USER
    if (m.kind === 'status') return BUBBLE_STATUS
    return BUBBLE_ASSISTANT
  }

  return (
    <aside style={PANEL_STYLE} aria-label={t('assist.title')}>
      <header style={HEADER_STYLE}>
        <strong style={{ fontSize: 13 }}>{t('assist.title')}</strong>
        <button
          type="button"
          onClick={() => {
            cancelExternal()
            onClose()
          }}
          aria-label={t('assist.close')}
          title={t('assist.close')}
          style={CLOSE_STYLE}
        >
          ×
        </button>
      </header>

      <div style={TABS_ROW_STYLE} role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'library'}
          onClick={() => switchTab('library')}
          style={tab === 'library' ? TAB_ACTIVE_STYLE : TAB_STYLE}
        >
          {t('assist.tab.library')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'interview'}
          onClick={() => switchTab('interview')}
          style={tab === 'interview' ? TAB_ACTIVE_STYLE : TAB_STYLE}
        >
          {t('assist.tab.interview')}
        </button>
      </div>

      <div
        ref={listRef}
        style={LIST_STYLE}
        role="log"
        aria-live="polite"
        aria-relevant="additions text"
      >
        {activeMessages.length === 0 && (
          <p style={{ margin: 0, color: 'var(--orbitpm-muted)', fontSize: 12.5, lineHeight: 1.6 }}>
            {emptyHint}
          </p>
        )}
        {activeMessages.map((m, i) => (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={bubbleStyle(m)}>{m.text}</div>
            {m.sources && m.sources.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 2 }}>
                <span style={{ fontSize: 11, color: 'var(--orbitpm-muted)', alignSelf: 'center' }}>
                  {t('assist.sources')}:
                </span>
                {m.sources.map((s, j) => (
                  <button
                    key={`${s.relPath}-${j}`}
                    type="button"
                    onClick={() => onOpenProcess(s.relPath)}
                    title={s.relPath}
                    style={CHIP_STYLE}
                  >
                    {s.processName}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
        {activeBusy && (
          <div style={{ ...BUBBLE_ASSISTANT, color: 'var(--orbitpm-muted)', fontStyle: 'italic' }}>
            {t('assist.thinking')}
          </div>
        )}
      </div>

      {pendingExternal && pendingExternal.tab === tab && currentExternalPlan && (
        <ExternalRequestPreview
          disclosure={currentExternalPlan.disclosure}
          includeWorkspaceContext={includeWorkspaceContext}
          redactNames={redactNames}
          consented={externalConsented}
          busy={activeBusy}
          attemptStatus={attemptStatus}
          onIncludeWorkspaceContextChange={(value) => {
            setIncludeWorkspaceContext(value)
            setExternalConsent(null)
          }}
          onRedactNamesChange={(value) => {
            setRedactNames(value)
            setExternalConsent(null)
          }}
          onConsentChange={(value) => {
            setExternalConsent(
              value ? grantExternalRequestConsent(currentExternalPlan.disclosure) : null
            )
          }}
          onConfirm={() => void confirmExternal()}
          onCancel={cancelExternal}
        />
      )}

      <div style={INPUT_ROW_STYLE}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void send()
            }
          }}
          rows={2}
          placeholder={t('assist.placeholder')}
          aria-label={t('assist.placeholder')}
          style={TEXTAREA_STYLE}
        />
        {showFinish && (
          <button
            type="button"
            onClick={finishInterview}
            title={t('assist.interview.finish')}
            style={FINISH_STYLE}
          >
            {t('assist.interview.finish')}
          </button>
        )}
        <button
          type="button"
          onClick={() => void send()}
          disabled={!canSend}
          title={t('assist.send')}
          style={{ ...SEND_STYLE, opacity: canSend ? 1 : 0.5 }}
        >
          {t('assist.send')}
        </button>
      </div>

      <div style={FOOTER_STYLE}>{footer}</div>
    </aside>
  )
}

export default AssistantDrawer

// --- styles (inline; logical props for RTL) ---------------------------------

const FAB_STYLE: CSSProperties = {
  position: 'fixed',
  insetBlockEnd: 18,
  insetInlineEnd: 18,
  zIndex: 900,
  width: 44,
  height: 44,
  borderRadius: '50%',
  border: 'none',
  background: 'var(--orbitpm-accent)',
  color: '#fff',
  fontSize: 20,
  lineHeight: 1,
  cursor: 'pointer',
  boxShadow: '0 2px 12px rgba(0,0,0,0.28)'
}

const PANEL_STYLE: CSSProperties = {
  position: 'fixed',
  insetBlockStart: 0,
  insetBlockEnd: 0,
  insetInlineEnd: 0,
  zIndex: 1200,
  width: 'clamp(300px, 30vw, 420px)',
  maxWidth: '100vw',
  background: 'var(--orbitpm-panel-bg)',
  borderInlineStart: '1px solid var(--orbitpm-border)',
  boxShadow: '0 0 24px rgba(0,0,0,0.18)',
  display: 'flex',
  flexDirection: 'column',
  minHeight: 0
}

const HEADER_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '0.6rem 0.8rem',
  borderBottom: '1px solid var(--orbitpm-border)',
  flex: '0 0 auto'
}

const CLOSE_STYLE: CSSProperties = {
  border: 'none',
  background: 'transparent',
  color: 'inherit',
  font: 'inherit',
  fontSize: 20,
  lineHeight: 1,
  cursor: 'pointer',
  padding: '0 4px'
}

const TABS_ROW_STYLE: CSSProperties = {
  display: 'flex',
  gap: 4,
  padding: '0.4rem 0.8rem 0',
  borderBottom: '1px solid var(--orbitpm-border)',
  flex: '0 0 auto'
}

const TAB_STYLE: CSSProperties = {
  border: 'none',
  borderBottom: '2px solid transparent',
  background: 'transparent',
  color: 'var(--orbitpm-muted)',
  fontFamily: 'inherit',
  fontSize: 12.5,
  padding: '0.3rem 0.5rem 0.45rem',
  cursor: 'pointer'
}

const TAB_ACTIVE_STYLE: CSSProperties = {
  ...TAB_STYLE,
  color: 'var(--orbitpm-fg)',
  fontWeight: 600,
  borderBottom: '2px solid var(--orbitpm-accent)'
}

const LIST_STYLE: CSSProperties = {
  flex: '1 1 auto',
  minHeight: 0,
  overflowY: 'auto',
  padding: '0.8rem',
  display: 'flex',
  flexDirection: 'column',
  gap: 12
}

const BUBBLE_BASE: CSSProperties = {
  fontSize: 13,
  lineHeight: 1.55,
  padding: '0.5rem 0.7rem',
  borderRadius: 10,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  maxWidth: '92%'
}

const BUBBLE_USER: CSSProperties = {
  ...BUBBLE_BASE,
  alignSelf: 'flex-end',
  background: 'var(--orbitpm-accent)',
  color: '#fff'
}

const BUBBLE_ASSISTANT: CSSProperties = {
  ...BUBBLE_BASE,
  alignSelf: 'flex-start',
  background: 'var(--orbitpm-hover)',
  color: 'var(--orbitpm-fg)'
}

/** Muted, italic bubble for status notes (edit warning, applying/applied, done). */
const BUBBLE_STATUS: CSSProperties = {
  ...BUBBLE_ASSISTANT,
  background: 'transparent',
  color: 'var(--orbitpm-muted)',
  fontStyle: 'italic',
  fontSize: 12,
  padding: '0.15rem 0.2rem'
}

const CHIP_STYLE: CSSProperties = {
  border: '1px solid var(--orbitpm-border)',
  background: 'transparent',
  color: 'var(--orbitpm-accent)',
  font: 'inherit',
  fontSize: 11.5,
  padding: '0.15rem 0.5rem',
  borderRadius: 999,
  cursor: 'pointer'
}

const INPUT_ROW_STYLE: CSSProperties = {
  display: 'flex',
  gap: 8,
  alignItems: 'flex-end',
  padding: '0.6rem 0.8rem',
  borderTop: '1px solid var(--orbitpm-border)',
  flex: '0 0 auto'
}

const TEXTAREA_STYLE: CSSProperties = {
  flex: '1 1 auto',
  resize: 'none',
  padding: '0.45rem 0.55rem',
  borderRadius: 8,
  border: '1px solid rgba(127,127,127,0.4)',
  background: 'transparent',
  color: 'inherit',
  font: 'inherit',
  fontSize: 13
}

const SEND_STYLE: CSSProperties = {
  flex: '0 0 auto',
  border: 'none',
  background: 'var(--orbitpm-accent)',
  color: '#fff',
  font: 'inherit',
  fontWeight: 600,
  fontSize: 13,
  padding: '0.5rem 0.9rem',
  borderRadius: 8,
  cursor: 'pointer'
}

const FINISH_STYLE: CSSProperties = {
  flex: '0 0 auto',
  border: '1px solid var(--orbitpm-border)',
  background: 'transparent',
  color: 'var(--orbitpm-fg)',
  font: 'inherit',
  fontSize: 12.5,
  padding: '0.45rem 0.7rem',
  borderRadius: 8,
  cursor: 'pointer'
}

const FOOTER_STYLE: CSSProperties = {
  flex: '0 0 auto',
  padding: '0.35rem 0.8rem',
  borderTop: '1px solid var(--orbitpm-border)',
  fontSize: 11,
  color: 'var(--orbitpm-muted)'
}
