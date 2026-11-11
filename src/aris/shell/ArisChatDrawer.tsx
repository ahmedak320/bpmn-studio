// The ARIS Studio Lite "process assistant" — a floating chat drawer with two
// tabs, transcribed from main's BPMN `AssistantDrawer` UX (💬 FAB + right-edge
// sliding panel + role=tab tablist + message bubbles + Enter-to-send) and wired
// to the ARIS backends instead:
//
//   * LIBRARY ("ask the process library") — every question is answered with NO
//     provider and NO key by `routeQuestion` + `formatAnswer` over the indexed
//     process digests (plan §17.4). Chips select the source element via
//     `onOpenChip`. Only when the deterministic router returns `kind: 'none'`
//     AND a provider + API key are already configured is the KEPT consent card
//     (`ArisAssistantAiSection`, plan §17.5) offered — its own §4.3 consent
//     gate is untouched here.
//   * INTERVIEW ("complete this process") — the deterministic gap-completion
//     interview (plan §18) that used to live in `ArisChatImproveRail`, now
//     hosted in the drawer. All logic is the pure session core in
//     `arisChatDrawerSession.ts`; this file only renders its cards and turns
//     its events into status bubbles.
//
// This component is transcribed from `src/assist/AssistantDrawer.tsx` (never
// imported — that module is BPMN-only and pulls in banned runtime deps).

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent
} from 'react'

import { getLang, t, type Key } from '../../i18n'
import { useLang } from '../../i18n/useLang'
import { AccessibleDialog } from '../../common/AccessibleDialog'
import { hasKey } from '../../ai/keys'
import {
  getProviderSelection,
  subscribeProviderSelection,
  type ProviderSelection
} from '../../ai/providerSelection'
import { getLiteProvider } from '../../ai/providersLite'
import { makeFreeTranslateTexts } from '../../ai/freeTranslate'
import { TechnicalErrorDetail } from '../../ai/TechnicalErrorDetail'
import type { ArisAnswerChip } from '../assistant/answer'
import { formatAnswer, type ArisFormattedAnswerLine } from '../assistant/formatAnswer'
import { routeQuestion } from '../assistant/questionRouter'
import type { ArisProcessDigest } from '../assistant/types'
import { TERMINAL_INTERVIEW_STATUSES, type ArisChatQuestion } from '../chat/interviewLoop'
import { ArisAssistantAiSection } from './ArisAssistantAiSection'
import type { ArisAssistantAiTurn } from './arisAssistantAi'
import {
  beginDrawerInterview,
  confirmDrawerSelection,
  createDrawerInterviewHost,
  describeCommandTargets,
  drawerConfirmationPreview,
  submitDrawerAnswers,
  type ArisChatDrawerEvent,
  type ArisChatDrawerInterview
} from './arisChatDrawerSession'
import type { ArisChatDrawerTarget, ArisChatInterviewRequest } from './arisChatDrawerTypes'
import { ARIS_CHAT_REMOVE_ANSWER } from './arisChatProposal'
import {
  countInterviewBands,
  isTranslationQuestion,
  questionAsk,
  questionStepLabel,
  stepNameFor,
  translationSource
} from './arisInterviewChatView'
import { scanArisGaps } from './arisChatHost'
import { tk } from './shellI18n'

export interface ArisChatDrawerProps {
  open: boolean
  onOpen: () => void
  onClose: () => void
  /** Bumped when Settings closes, so the provider/key read below re-runs. */
  keysVersion: number
  digests: readonly ArisProcessDigest[]
  onOpenChip: (chip: ArisAnswerChip) => boolean
  onOpenSettings: () => void
  onChangeWorkspace?: () => void
  /** The active ARIS model the interview works on, re-read at every step. */
  getActiveChatTarget: () => ArisChatDrawerTarget | null
  /** Imperative "start the interview now" request from the shell. */
  interviewRequest?: ArisChatInterviewRequest | null
}

type DrawerTab = 'library' | 'interview'

interface Message {
  role: 'user' | 'assistant'
  kind?: 'chat' | 'status' | 'error'
  text?: string
  technicalDetail?: string
  lines?: readonly ArisFormattedAnswerLine[]
  aiQuestion?: string
}

/** A machine translation offered for a missing-name question, to confirm or edit. */
type InterviewSuggestion =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly text: string }
  | { readonly status: 'failed' }

/** The one provider/model explicitly selected, only when its key is present. */
interface ChosenProvider {
  providerId: ProviderSelection['providerId']
  modelId: string
  label: string
}

/** Prompts that exercise the §17.4 answerers, so the library tab is usable cold. */
const SUGGESTIONS: readonly { readonly key: string; readonly source: string }[] = Object.freeze([
  { key: 'aris.assistant.suggest.processes', source: 'Which processes are available?' },
  { key: 'aris.assistant.suggest.missing', source: 'Which information is missing?' }
])

/** English fallbacks for the interview status events the session core emits. */
const STATUS_FALLBACKS: Readonly<Record<string, string>> = Object.freeze({
  'aris.chatDrawer.interview.clean': 'No gaps found — this model looks complete.',
  'aris.chat.noProposal':
    'Those answers do not map to a change this build can make deterministically.',
  'aris.chat.nothingSelected': 'Select at least one change to apply.',
  'aris.chat.commitFailed': 'The canvas rejected the change; nothing was applied.',
  'aris.chat.provenanceRejected': 'A change receipt was withheld from history.'
})

const useClientLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

export function ArisChatDrawer({
  open,
  onOpen,
  onClose,
  keysVersion,
  digests,
  onOpenChip,
  onOpenSettings,
  onChangeWorkspace,
  getActiveChatTarget,
  interviewRequest
}: ArisChatDrawerProps): JSX.Element | null {
  const lang = useLang()
  const direction = getLang() === 'ar' ? 'rtl' : 'ltr'

  const [tab, setTab] = useState<DrawerTab>('library')
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [aiHistory, setAiHistory] = useState<readonly ArisAssistantAiTurn[]>([])
  const [selection, setSelection] = useState<ProviderSelection | null>(() => getProviderSelection())

  // Interview tab state.
  const [chatTarget, setChatTarget] = useState<ArisChatDrawerTarget | null>(null)
  const [interview, setInterview] = useState<ArisChatDrawerInterview | null>(null)
  const [ivMessages, setIvMessages] = useState<Message[]>([])
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [gapVersion, setGapVersion] = useState(0)
  // The chat asks one question at a time; the round is submitted after the last one.
  const [activeIndex, setActiveIndex] = useState(0)
  const [draft, setDraft] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [focusIds, setFocusIds] = useState<readonly string[]>([])
  const [suggestions, setSuggestions] = useState<Record<string, InterviewSuggestion>>({})
  const suggestionsRef = useRef(suggestions)
  suggestionsRef.current = suggestions

  const libraryListRef = useRef<HTMLDivElement | null>(null)
  const ivListRef = useRef<HTMLDivElement | null>(null)
  const launcherRef = useRef<HTMLButtonElement | null>(null)
  const returnFocusTargetRef = useRef<HTMLElement | null>(null)
  const closeButtonRef = useRef<HTMLButtonElement | null>(null)
  const libraryTabRef = useRef<HTMLButtonElement | null>(null)
  const interviewTabRef = useRef<HTMLButtonElement | null>(null)
  const interviewHostRef = useRef<ReturnType<typeof createDrawerInterviewHost> | null>(null)
  const lastRequestTokenRef = useRef<number | null>(null)
  const wasOpenRef = useRef(false)

  useEffect(() => subscribeProviderSelection(setSelection), [])

  // The prop rerender already invalidates this read; no memoized stale
  // credential is retained.
  void keysVersion
  const provider: ChosenProvider | null =
    selection && hasKey(selection.providerId)
      ? {
          providerId: selection.providerId,
          modelId: selection.modelId,
          label: getLiteProvider(selection.providerId).label
        }
      : null

  // Live gap scan for the interview intro card + count line. Recomputed after
  // every apply/undo (gapVersion bump) and whenever the target changes.
  const gaps = useMemo(() => {
    // `gapVersion` is a recompute token: it is bumped after every apply/undo so
    // the intro count line re-scans the (mutated) live document.
    void gapVersion
    if (!chatTarget) return []
    const document = chatTarget.host.getDocument()
    return document ? scanArisGaps(document) : []
  }, [chatTarget, gapVersion])

  const confirmPreview = useMemo(() => {
    const host = interviewHostRef.current
    if (!host || !interview || interview.state?.status !== 'awaitingConfirmation') return null
    return drawerConfirmationPreview(host, interview, describeCommandTargets)
  }, [interview])

  // Auto-scroll each transcript to the newest message.
  useEffect(() => {
    const library = libraryListRef.current
    if (library) library.scrollTop = library.scrollHeight
    const iv = ivListRef.current
    if (iv) iv.scrollTop = iv.scrollHeight
  }, [messages, ivMessages, tab])

  // Capture the real opener before the modal's passive focus effect runs.
  useClientLayoutEffect(() => {
    const wasOpen = wasOpenRef.current
    wasOpenRef.current = open
    if (open && !wasOpen) {
      const active = document.activeElement
      returnFocusTargetRef.current =
        active instanceof HTMLElement && active !== document.body && active.isConnected
          ? active
          : launcherRef.current
    }
  }, [open])

  // --- library tab -----------------------------------------------------------

  const pushLibraryStatus = (text: string): void => {
    setMessages((prev) => [...prev, { role: 'assistant', kind: 'status', text }])
  }

  const sendLibrary = (raw: string): void => {
    const q = raw.trim()
    if (q === '') return
    setInput('')
    const routed = routeQuestion(digests, q, lang)
    const formatted = formatAnswer(lang, routed)
    setMessages((prev) => {
      const next: Message[] = [
        ...prev,
        { role: 'user', kind: 'chat', text: q },
        { role: 'assistant', kind: 'chat', lines: formatted.lines }
      ]
      // §17.5: the KEPT AI offer, only once the deterministic path is confirmed
      // empty AND a provider + key are configured.
      if (routed.kind === 'none' && selection && hasKey(selection.providerId)) {
        next.push({ role: 'assistant', kind: 'chat', aiQuestion: q })
      }
      return next
    })
  }

  // --- interview tab ---------------------------------------------------------

  const eventToMessage = (event: ArisChatDrawerEvent): Message | null => {
    if (event.kind === 'applied') {
      return {
        role: 'assistant',
        kind: 'status',
        text: tk(
          'aris.chatDrawer.interview.applied',
          'Applied {count} change(s) as one undoable step.',
          {
            count: event.count
          }
        )
      }
    }
    if (event.kind === 'rejected') {
      return {
        role: 'assistant',
        kind: 'error',
        text: tk('aris.chat.rejected', 'The patch was rejected: {error}', { error: event.error })
      }
    }
    if (event.kind === 'status') {
      return {
        role: 'assistant',
        kind: 'status',
        text: tk(
          event.messageKey,
          STATUS_FALLBACKS[event.messageKey] ?? event.messageKey,
          event.params
        )
      }
    }
    // 'terminal' is surfaced by the terminal card below, not as a bubble.
    return null
  }

  const eventsToMessages = (events: readonly ArisChatDrawerEvent[]): Message[] =>
    events.map(eventToMessage).filter((message): message is Message => message !== null)

  const noTargetStatus = (): Message => ({
    role: 'assistant',
    kind: 'status',
    text: tk(
      'aris.chatDrawer.interview.noTarget',
      'Open an ARIS model first, then start the completion interview.'
    )
  })

  const startInterview = (focusTargetIds: readonly string[] = []): void => {
    const target = getActiveChatTarget()
    setChatTarget(target)
    setAnswers({})
    setSelected({})
    setActiveIndex(0)
    setDraft('')
    setFormOpen(false)
    setFocusIds(focusTargetIds)
    setGapVersion((current) => current + 1)
    const document = target?.host.getDocument() ?? null
    if (!target || !document) {
      interviewHostRef.current = null
      setInterview(null)
      setIvMessages([noTargetStatus()])
      return
    }
    const host = createDrawerInterviewHost()
    interviewHostRef.current = host
    const { interview: begun, events } = beginDrawerInterview(host, document, focusTargetIds)
    setInterview(begun)
    setIvMessages(eventsToMessages(events))
  }

  /** Submits one round of answers (blank = skipped) and reports what happened. */
  const submitRound = (roundAnswers: Readonly<Record<string, string>>): void => {
    const host = interviewHostRef.current
    if (!host || !interview || !chatTarget) return
    const result = submitDrawerAnswers(host, interview, chatTarget.host, roundAnswers)
    setInterview(result.interview)
    setIvMessages((prev) => [...prev, ...eventsToMessages(result.events)])
    setAnswers({})
    setSelected({})
    setActiveIndex(0)
    setDraft('')
    setFormOpen(false)
    setGapVersion((current) => current + 1)
  }

  /**
   * Records the answer to the question being asked in the chat. The round is
   * submitted once its last question is answered, so each round still applies as
   * one undoable step.
   */
  const answerActiveQuestion = (
    question: ArisChatQuestion,
    value: string,
    shown: string,
    questionCount: number
  ): void => {
    const nextAnswers = { ...answers, [question.id]: value }
    setAnswers(nextAnswers)
    setIvMessages((prev) => [...prev, { role: 'user', kind: 'chat', text: shown }])
    setDraft('')
    if (activeIndex + 1 < questionCount) {
      setActiveIndex(activeIndex + 1)
      return
    }
    submitRound(nextAnswers)
  }

  const confirmSelected = (): void => {
    const host = interviewHostRef.current
    const state = interview?.state
    if (!host || !interview || !chatTarget || state?.status !== 'awaitingConfirmation') return
    const selectedIds = new Set(
      state.pendingConfirmCommands
        .filter((command) => selected[command.commandId])
        .map((command) => command.commandId)
    )
    const result = confirmDrawerSelection(host, interview, chatTarget.host, selectedIds)
    setInterview(result.interview)
    setIvMessages((prev) => [...prev, ...eventsToMessages(result.events)])
    setSelected({})
    setGapVersion((current) => current + 1)
  }

  const undoLastApplied = (): void => {
    if (!chatTarget) return
    chatTarget.host.undo()
    setGapVersion((current) => current + 1)
  }

  // App fired an interview request (a warning click or "complete this process"):
  // open, switch to the interview tab, and start a fresh session for the active target.
  useEffect(() => {
    if (!interviewRequest) return
    if (lastRequestTokenRef.current === interviewRequest.token) return
    lastRequestTokenRef.current = interviewRequest.token
    onOpen()
    setTab('interview')
    startInterview(interviewRequest.focusTargetIds ?? [])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interviewRequest])

  // Translate the active missing-name question once, so the chat can offer the
  // translation to confirm instead of asking the user to type it.
  useEffect(() => {
    const liveState = interview?.state ?? null
    if (!liveState || liveState.status !== 'awaitingAnswers') return
    const question = liveState.questions[activeIndex]
    if (!question || !isTranslationQuestion(question) || !chatTarget) return
    const known = suggestionsRef.current[question.id]
    if (known?.status === 'ready' || known?.status === 'failed') return
    const source = translationSource(chatTarget.host.getDocument(), question)
    if (!source) return
    const controller = new AbortController()
    setSuggestions((prev) => ({ ...prev, [question.id]: { status: 'loading' } }))
    void makeFreeTranslateTexts({ signal: controller.signal })(
      [source.text],
      source.from,
      source.to,
      controller.signal
    )
      .then(([text]) => {
        if (controller.signal.aborted) return
        const translated = text?.trim() ?? ''
        setSuggestions((prev) => ({
          ...prev,
          [question.id]:
            translated === '' ? { status: 'failed' } : { status: 'ready', text: translated }
        }))
      })
      .catch(() => {
        if (controller.signal.aborted) return
        setSuggestions((prev) => ({ ...prev, [question.id]: { status: 'failed' } }))
      })
    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interview?.state?.status, activeIndex, chatTarget])

  // --- shared chrome ---------------------------------------------------------

  const switchTab = (next: DrawerTab): void => {
    setTab(next)
    if (next === 'interview') setChatTarget(getActiveChatTarget())
  }

  const handleTabKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>): void => {
    let next: DrawerTab | null = null
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      const index = DRAWER_TAB_ORDER.indexOf(tab)
      const towardDomEnd =
        (event.key === 'ArrowRight' && direction === 'ltr') ||
        (event.key === 'ArrowLeft' && direction === 'rtl')
      const offset = towardDomEnd ? 1 : -1
      next =
        DRAWER_TAB_ORDER[(index + offset + DRAWER_TAB_ORDER.length) % DRAWER_TAB_ORDER.length] ??
        null
    }
    if (event.key === 'End') next = 'interview'
    if (event.key === 'Home') next = 'library'
    if (!next) return

    event.preventDefault()
    if (next !== tab) switchTab(next)
    const nextTab = next === 'library' ? libraryTabRef.current : interviewTabRef.current
    nextTab?.focus()
  }

  // Keep the launcher mounted while the modal drawer is open so it remains a
  // valid restoration target when it was the control that opened the drawer.
  const launcher = (
    <button
      ref={launcherRef}
      type="button"
      onClick={(event) => {
        returnFocusTargetRef.current = event.currentTarget
        onOpen()
      }}
      aria-label={t('assist.open')}
      title={t('assist.open')}
      style={FAB_STYLE}
      hidden={open}
    >
      💬
    </button>
  )

  if (!open) return launcher

  const footer = provider
    ? t('assist.model.line', { model: provider.modelId, provider: provider.label })
    : t('assist.localMode')

  const bubbleStyle = (message: Message): CSSProperties => {
    if (message.role === 'user') return BUBBLE_USER
    if (message.kind === 'status') return BUBBLE_STATUS
    return BUBBLE_ASSISTANT
  }

  const renderLibraryMessage = (message: Message, index: number): JSX.Element | null => {
    if (message.aiQuestion) {
      if (!provider) return null
      return (
        <ArisAssistantAiSection
          key={`ai:${index}:${message.aiQuestion}`}
          digests={digests}
          question={message.aiQuestion}
          providerId={provider.providerId}
          modelId={provider.modelId}
          history={aiHistory}
          onOpenChip={onOpenChip}
          onAnswered={(turn) => setAiHistory((prev) => [...prev, turn])}
        />
      )
    }
    if (message.lines) {
      return (
        <div
          key={index}
          data-orbitpm-aris-assistant-answer=""
          style={{ ...BUBBLE_ASSISTANT, display: 'grid', gap: 6 }}
        >
          {message.lines.map((line, lineIndex) => {
            const chip = line.chip
            if (!chip) {
              return (
                <div key={`${lineIndex}:${line.text}`} style={{ fontSize: 13, lineHeight: 1.5 }}>
                  <span>{line.text}</span>
                </div>
              )
            }
            return (
              <div key={`${lineIndex}:${line.text}`} style={{ fontSize: 13, lineHeight: 1.5 }}>
                <button
                  type="button"
                  className="orbitpm-lite-chrome-btn"
                  data-orbitpm-aris-assistant-chip={chip.occurrenceId ?? chip.modelId}
                  style={{ textAlign: 'start', maxWidth: '100%' }}
                  onClick={() => {
                    if (!onOpenChip(chip)) {
                      pushLibraryStatus(
                        tk(
                          'aris.assistant.chip.unavailable',
                          'That element is not on the open models.'
                        )
                      )
                    }
                  }}
                >
                  {line.text}
                </button>
              </div>
            )
          })}
        </div>
      )
    }
    return (
      <div
        key={index}
        style={bubbleStyle(message)}
        role={message.kind === 'error' ? 'alert' : undefined}
        aria-live={message.kind === 'error' ? 'assertive' : undefined}
        aria-atomic={message.kind === 'error' ? 'true' : undefined}
      >
        <span>{message.text}</span>
        <TechnicalErrorDetail detail={message.technicalDetail} />
      </div>
    )
  }

  const libraryContent = (
    <>
      <div
        ref={libraryListRef}
        style={LIST_STYLE}
        role="log"
        aria-live="polite"
        aria-relevant="additions text"
      >
        <p style={{ margin: 0, fontSize: 12, color: 'var(--orbitpm-muted)' }}>
          {tk('aris.assistant.ask.indexed', '{count} indexed models', { count: digests.length })}
        </p>
        {messages.length === 0 && (
          <>
            <p
              style={{ margin: 0, color: 'var(--orbitpm-muted)', fontSize: 12.5, lineHeight: 1.6 }}
            >
              {t('assist.empty')}
            </p>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {SUGGESTIONS.map((suggestion) => {
                const text = tk(suggestion.key, suggestion.source)
                return (
                  <button
                    key={suggestion.key}
                    type="button"
                    className="orbitpm-lite-chrome-btn"
                    onClick={() => sendLibrary(text)}
                  >
                    {text}
                  </button>
                )
              })}
            </div>
          </>
        )}
        {messages.map(renderLibraryMessage)}
      </div>

      <div style={INPUT_ROW_STYLE}>
        <textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              sendLibrary(input)
            }
          }}
          rows={2}
          data-orbitpm-aris-assistant-question=""
          placeholder={t('assist.empty')}
          aria-label={t('assist.tab.library')}
          style={TEXTAREA_STYLE}
        />
        <button
          type="button"
          onClick={() => sendLibrary(input)}
          disabled={input.trim() === ''}
          title={t('assist.send')}
          style={{ ...SEND_STYLE, opacity: input.trim() === '' ? 0.5 : 1 }}
        >
          {t('assist.send')}
        </button>
      </div>

      <div style={FOOTER_STYLE}>{footer}</div>
    </>
  )

  const interviewState = interview?.state ?? null
  const terminal = interviewState !== null && TERMINAL_INTERVIEW_STATUSES.has(interviewState.status)
  const appliedCount = interview?.appliedCount ?? 0
  const canUndo = (chatTarget?.host.getCanUndo() ?? false) && appliedCount > 0
  const questions = interviewState?.status === 'awaitingAnswers' ? interviewState.questions : []
  const activeQuestion = questions[activeIndex] ?? null
  const activeDocument = chatTarget ? chatTarget.host.getDocument() : null
  const bandCounts = countInterviewBands(gaps)
  const focusLabel = stepNameFor(activeDocument, focusIds[0])

  const renderQuestionCard = (question: ArisChatQuestion, index: number, count: number): JSX.Element => {
    const stepLabel = questionStepLabel(activeDocument, question)
    const suggestion = suggestions[question.id]
    const isActive = question.id === activeQuestion?.id
    return (
      <div key={`${question.id}:${index}`} style={{ display: 'grid', gap: 6 }} data-orbitpm-aris-chat-question={question.gapKind}>
        <div style={BUBBLE_ASSISTANT}>
          {stepLabel && <strong style={{ fontSize: 12.5 }}>{tk('aris.chat.step', 'Step: {name}', { name: stepLabel })}</strong>}
          <div style={{ fontSize: 12.5 }}>{t(question.messageKey as Key, question.messageParams)}</div>
          <div style={{ fontSize: 12.5 }}>{questionAsk(question)}</div>
          <div style={{ fontSize: 11, color: 'var(--orbitpm-muted)' }}>
            {tk('aris.chat.progress', 'Question {index} of {count}', { index: index + 1, count })}
          </div>
        </div>
        {isActive && isTranslationQuestion(question) && suggestion && (
          <div style={{ ...BUBBLE_STATUS, display: 'grid', gap: 6 }} data-orbitpm-aris-chat-suggestion={suggestion.status}>
            {suggestion.status === 'loading' && <span>{tk('aris.chat.translating', 'Translating…')}</span>}
            {suggestion.status === 'failed' && (
              <span>{tk('aris.chat.translateFailed', 'No automatic translation. Type it below.')}</span>
            )}
            {suggestion.status === 'ready' && (
              <>
                <span>
                  {tk('aris.chat.suggested', 'Suggested translation: {text}', { text: suggestion.text })}
                </span>
                <span style={{ display: 'flex', gap: 6 }}>
                  <button
                    type="button"
                    className="orbitpm-lite-primary"
                    data-orbitpm-aris-chat-accept=""
                    onClick={() => answerActiveQuestion(question, suggestion.text, suggestion.text, count)}
                  >
                    {tk('aris.chat.accept', 'Accept')}
                  </button>
                  <button
                    type="button"
                    className="orbitpm-lite-chrome-btn"
                    onClick={() => setDraft(suggestion.text)}
                  >
                    {tk('aris.chat.edit', 'Edit')}
                  </button>
                </span>
              </>
            )}
          </div>
        )}
        {isActive && question.gapKind === 'unusedDefinition' && (
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              type="button"
              className="orbitpm-lite-primary"
              onClick={() => answerActiveQuestion(question, ARIS_CHAT_REMOVE_ANSWER, tk('aris.chat.proposeRemoval', 'Propose removing it'), count)}
            >
              {tk('aris.chat.proposeRemoval', 'Propose removing it')}
            </button>
            <button
              type="button"
              className="orbitpm-lite-chrome-btn"
              onClick={() => answerActiveQuestion(question, '', tk('aris.chat.skip', 'Skip'), count)}
            >
              {tk('aris.chat.skip', 'Skip')}
            </button>
          </div>
        )}
        {isActive && question.gapKind !== 'unusedDefinition' && (
          <form
            style={{ display: 'flex', gap: 6 }}
            onSubmit={(event) => {
              event.preventDefault()
              const value = draft.trim()
              answerActiveQuestion(question, value, value === '' ? tk('aris.chat.skip', 'Skip') : value, count)
            }}
          >
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              aria-label={questionAsk(question)}
              data-orbitpm-aris-chat-answer=""
              style={{
                flex: 1,
                font: 'inherit',
                padding: '0.3rem 0.45rem',
                borderRadius: 6,
                border: '1px solid var(--orbitpm-border)',
                background: 'transparent',
                color: 'inherit'
              }}
            />
            <button type="submit" className="orbitpm-lite-primary" data-orbitpm-aris-chat-send="">
              {tk('aris.chat.send', 'Send')}
            </button>
            <button
              type="button"
              className="orbitpm-lite-chrome-btn"
              onClick={() => answerActiveQuestion(question, '', tk('aris.chat.skip', 'Skip'), count)}
            >
              {tk('aris.chat.skip', 'Skip')}
            </button>
          </form>
        )}
      </div>
    )
  }

  const renderFormBlock = (question: ArisChatQuestion, index: number): JSX.Element => {
    const stepLabel = questionStepLabel(activeDocument, question)
    const suggestion = suggestions[question.id]
    const value = answers[question.id] ?? ''
    const inputId = `aris-chat-form-${index}`
    return (
      <>
        {stepLabel && <strong style={{ fontSize: 12.5 }}>{tk('aris.chat.step', 'Step: {name}', { name: stepLabel })}</strong>}
        <span style={{ fontSize: 12.5 }}>{t(question.messageKey as Key, question.messageParams)}</span>
        <label htmlFor={inputId} style={{ fontSize: 12.5 }}>{questionAsk(question)}</label>
        {question.gapKind === 'unusedDefinition' ? (
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12.5 }}>
            <input
              id={inputId}
              type="checkbox"
              checked={value === ARIS_CHAT_REMOVE_ANSWER}
              onChange={(event) =>
                setAnswers((current) => ({
                  ...current,
                  [question.id]: event.target.checked ? ARIS_CHAT_REMOVE_ANSWER : ''
                }))
              }
            />
            <span>{tk('aris.chat.proposeRemoval', 'Propose removing it')}</span>
          </label>
        ) : (
          <input
            id={inputId}
            value={value}
            onChange={(event) =>
              setAnswers((current) => ({ ...current, [question.id]: event.target.value }))
            }
            style={{
              font: 'inherit',
              padding: '0.3rem 0.45rem',
              borderRadius: 6,
              border: '1px solid var(--orbitpm-border)',
              background: 'transparent',
              color: 'inherit'
            }}
          />
        )}
        {isTranslationQuestion(question) && suggestion?.status === 'ready' && (
          <button
            type="button"
            className="orbitpm-lite-chrome-btn"
            style={{ justifySelf: 'start' }}
            onClick={() => setAnswers((current) => ({ ...current, [question.id]: suggestion.text }))}
          >
            {tk('aris.chat.useSuggestion', 'Use suggested translation: {text}', { text: suggestion.text })}
          </button>
        )}
      </>
    )
  }

  const interviewContent = (
    <>
      <div ref={ivListRef} data-orbitpm-aris-chat="" style={{ ...LIST_STYLE, gap: 10 }}>
        {ivMessages.length > 0 && (
          <div
            role="log"
            aria-live="polite"
            aria-relevant="additions text"
            style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
          >
            {ivMessages.map((message, index) => (
              <div
                key={index}
                style={bubbleStyle(message)}
                role={message.kind === 'error' ? 'alert' : undefined}
                aria-live={message.kind === 'error' ? 'assertive' : undefined}
                aria-atomic={message.kind === 'error' ? 'true' : undefined}
              >
                <span>{message.text}</span>
                <TechnicalErrorDetail detail={message.technicalDetail} />
              </div>
            ))}
          </div>
        )}

        {!chatTarget ? (
          <p style={BUBBLE_STATUS}>
            {tk(
              'aris.chatDrawer.interview.noTarget',
              'Open an ARIS model first, then start the completion interview.'
            )}
          </p>
        ) : (
          <>
            <p style={{ margin: 0, fontSize: 12.5, color: 'var(--orbitpm-muted)', lineHeight: 1.5 }}>
              {gaps.length === 0
                ? tk('aris.chatDrawer.interview.clean', 'No gaps found — this model looks complete.')
                : tk(
                    'aris.chatDrawer.interview.summary',
                    'Open items for {name}: {critical} critical, {content} to complete, {simple} simple. I ask the critical ones first.',
                    {
                      name: chatTarget.title,
                      critical: bandCounts.critical,
                      content: bandCounts.content,
                      simple: bandCounts.simple
                    }
                  )}
              {focusLabel && (
                <>
                  {' '}
                  {tk('aris.chat.focus', 'Starting with {name}.', { name: focusLabel })}
                </>
              )}
            </p>

            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button
                type="button"
                className="orbitpm-lite-chrome-btn"
                data-orbitpm-aris-chat-start=""
                disabled={gaps.length === 0}
                onClick={() => startInterview()}
              >
                {tk('aris.chat.start', 'Start completion interview')}
              </button>
              {interviewState?.status === 'awaitingAnswers' && (
                <button
                  type="button"
                  className="orbitpm-lite-chrome-btn"
                  data-orbitpm-aris-chat-form=""
                  onClick={() => setFormOpen(true)}
                >
                  {tk('aris.chat.openForm', 'Open full form')}
                </button>
              )}
              <button
                type="button"
                className="orbitpm-lite-chrome-btn"
                data-orbitpm-aris-chat-undo=""
                disabled={!canUndo}
                onClick={undoLastApplied}
              >
                {tk('aris.chat.undo', 'Undo last applied change')}
              </button>
            </div>

            {questions.length > 0 && (
              <div style={{ display: 'grid', gap: 8 }} data-orbitpm-aris-chat-active="">
                {questions.slice(0, activeIndex + 1).map((question, index) =>
                  renderQuestionCard(question, index, questions.length)
                )}
              </div>
            )}

            {interviewState?.status === 'awaitingConfirmation' && (
              <div data-orbitpm-aris-chat-confirm="" style={{ display: 'grid', gap: 6 }}>
                <strong style={{ fontSize: 12.5 }}>
                  {tk('aris.chat.confirmHeading', 'These changes need confirmation')}
                </strong>
                {interviewState.pendingConfirmCommands.map((command) => (
                  <label
                    key={command.commandId}
                    style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12.5 }}
                  >
                    <input
                      type="checkbox"
                      checked={selected[command.commandId] ?? false}
                      onChange={(event) =>
                        setSelected((current) => ({
                          ...current,
                          [command.commandId]: event.target.checked
                        }))
                      }
                    />
                    <span>
                      {command.kind} · {command.targetIds.join(', ')}
                    </span>
                  </label>
                ))}
                {confirmPreview && (
                  <dl className="orbitpm-aris-defs" data-orbitpm-aris-chat-preview="">
                    <div style={{ display: 'contents' }}>
                      <dt>{tk('aris.chat.preview.before', 'Before')}</dt>
                      <dd>{(confirmPreview.before as string[] | null)?.join(' | ') ?? ''}</dd>
                      <dt>{tk('aris.chat.preview.after', 'After')}</dt>
                      <dd>{(confirmPreview.after as string[] | null)?.join(' | ') ?? ''}</dd>
                    </div>
                  </dl>
                )}
                <button
                  type="button"
                  className="orbitpm-lite-primary"
                  data-orbitpm-aris-chat-confirm-apply=""
                  onClick={confirmSelected}
                >
                  {tk('aris.chat.confirmApply', 'Apply selected changes')}
                </button>
              </div>
            )}

            {interview && interview.provenance.length > 0 && (
              <ul
                data-orbitpm-aris-chat-receipts=""
                style={{ margin: 0, paddingInlineStart: '1.1rem', fontSize: 12 }}
              >
                {interview.provenance.map((entry) => (
                  <li key={entry.commandId}>
                    {entry.kind} · {entry.targetIds.join(', ')} · {entry.origin}
                  </li>
                ))}
              </ul>
            )}

            {terminal && interviewState && (
              <p
                style={{ margin: 0, fontSize: 12 }}
                data-orbitpm-aris-chat-terminal={interviewState.status}
              >
                {interviewState.status === 'clean'
                  ? tk(
                      'aris.chatDrawer.interview.clean',
                      'No gaps found — this model looks complete.'
                    )
                  : interviewState.status === 'roundLimitReached'
                    ? tk(
                        'aris.chatDrawer.interview.roundLimit',
                        'Round limit reached (5 of 5). Remaining gaps stay listed for a new interview.'
                      )
                    : tk('aris.chat.finished', 'Interview finished: {status}', {
                        status: interviewState.status
                      })}
              </p>
            )}
          </>
        )}
      </div>

      {formOpen && questions.length > 0 && (
        <AccessibleDialog
          ariaLabel={tk('aris.chat.form.title', 'Complete this process — all questions')}
          onClose={() => setFormOpen(false)}
          closeOnEscape
          backdropStyle={BACKDROP_STYLE}
          dialogStyle={FULL_FORM_STYLE}
          dir={direction}
        >
          <header style={HEADER_STYLE}>
            <strong style={{ fontSize: 15 }}>
              {tk('aris.chat.form.title', 'Complete this process — all questions')}
            </strong>
            <button type="button" className="orbitpm-lite-chrome-btn" onClick={() => setFormOpen(false)}>
              {t('assist.close')}
            </button>
          </header>
          <div style={{ ...LIST_STYLE, display: 'grid', gap: 14, padding: 16 }}>
            {questions.map((question, index) => (
              <div key={question.id} style={{ display: 'grid', gap: 6 }} data-orbitpm-aris-chat-form-question={question.gapKind}>
                {renderFormBlock(question, index)}
              </div>
            ))}
          </div>
          <footer style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', padding: 12 }}>
            <button type="button" className="orbitpm-lite-chrome-btn" onClick={() => setFormOpen(false)}>
              {tk('aris.chat.cancel', 'Cancel')}
            </button>
            <button
              type="button"
              className="orbitpm-lite-primary"
              data-orbitpm-aris-chat-form-apply=""
              onClick={() => submitRound(answers)}
            >
              {tk('aris.chat.apply', 'Apply answers')}
            </button>
          </footer>
        </AccessibleDialog>
      )}

      <div style={FOOTER_STYLE}>{footer}</div>
    </>
  )

  return (
    <>
      {launcher}
      <AccessibleDialog
        ariaLabel={t('assist.title')}
        onClose={onClose}
        closeOnEscape
        closeOnBackdrop
        initialFocusRef={closeButtonRef}
        returnFocusRef={returnFocusTargetRef}
        backdropStyle={BACKDROP_STYLE}
        dialogStyle={PANEL_STYLE}
        dir={direction}
      >
        <header style={HEADER_STYLE}>
          <strong style={{ fontSize: 13 }}>{t('assist.title')}</strong>
          <button
            type="button"
            onClick={onOpenSettings}
            title={t('app.settings')}
            style={{ ...CHIP_STYLE, marginInlineStart: 'auto' }}
          >
            {t('app.settings')}
          </button>
          {onChangeWorkspace && (
            <button
              type="button"
              onClick={onChangeWorkspace}
              title={t('app.changeFolder.title')}
              style={CHIP_STYLE}
            >
              {t('app.changeFolder')}
            </button>
          )}
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label={t('assist.close')}
            title={t('assist.close')}
            style={CLOSE_STYLE}
          >
            ×
          </button>
        </header>

        <div style={TABS_ROW_STYLE} role="tablist" aria-label={t('assist.title')}>
          <button
            ref={libraryTabRef}
            id={LIBRARY_TAB_ID}
            type="button"
            role="tab"
            aria-selected={tab === 'library'}
            aria-controls={LIBRARY_PANEL_ID}
            tabIndex={tab === 'library' ? 0 : -1}
            onClick={() => switchTab('library')}
            onKeyDown={handleTabKeyDown}
            style={tab === 'library' ? TAB_ACTIVE_STYLE : TAB_STYLE}
          >
            {t('assist.tab.library')}
          </button>
          <button
            ref={interviewTabRef}
            id={INTERVIEW_TAB_ID}
            type="button"
            role="tab"
            aria-selected={tab === 'interview'}
            aria-controls={INTERVIEW_PANEL_ID}
            tabIndex={tab === 'interview' ? 0 : -1}
            onClick={() => switchTab('interview')}
            onKeyDown={handleTabKeyDown}
            style={tab === 'interview' ? TAB_ACTIVE_STYLE : TAB_STYLE}
          >
            {t('assist.tab.interview')}
          </button>
        </div>

        <div
          id={LIBRARY_PANEL_ID}
          role="tabpanel"
          aria-labelledby={LIBRARY_TAB_ID}
          hidden={tab !== 'library'}
          style={TAB_PANEL_STYLE}
        >
          {tab === 'library' ? libraryContent : null}
        </div>
        <div
          id={INTERVIEW_PANEL_ID}
          role="tabpanel"
          aria-labelledby={INTERVIEW_TAB_ID}
          hidden={tab !== 'interview'}
          style={TAB_PANEL_STYLE}
        >
          {tab === 'interview' ? interviewContent : null}
        </div>
      </AccessibleDialog>
    </>
  )
}

export default ArisChatDrawer

// --- styles (inline; logical props for RTL) ---------------------------------

const LIBRARY_TAB_ID = 'orbitpm-aris-chat-library-tab'
const LIBRARY_PANEL_ID = 'orbitpm-aris-chat-library-panel'
const INTERVIEW_TAB_ID = 'orbitpm-aris-chat-interview-tab'
const INTERVIEW_PANEL_ID = 'orbitpm-aris-chat-interview-panel'
const DRAWER_TAB_ORDER: readonly DrawerTab[] = ['library', 'interview']

const BACKDROP_STYLE: CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 1200,
  background: 'rgba(15, 23, 42, 0.4)'
}

const FAB_STYLE: CSSProperties = {
  position: 'fixed',
  insetBlockEnd: 72,
  insetInlineEnd: 4,
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
  gap: 6,
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
  boxSizing: 'border-box',
  width: 32,
  height: 32,
  padding: 0,
  borderRadius: 4
}

const TABS_ROW_STYLE: CSSProperties = {
  display: 'flex',
  gap: 4,
  padding: '0.4rem 0.8rem 0',
  borderBottom: '1px solid var(--orbitpm-border)',
  flex: '0 0 auto'
}

const TAB_PANEL_STYLE: CSSProperties = {
  display: 'flex',
  flex: '1 1 auto',
  flexDirection: 'column',
  minHeight: 0
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

/** Muted, italic bubble for status notes (applied/clean/no-target). */
const FULL_FORM_STYLE: CSSProperties = Object.freeze({
  ...PANEL_STYLE,
  width: '100vw',
  height: '100vh',
  maxWidth: '100vw',
  maxHeight: '100vh',
  borderRadius: 0
}) as CSSProperties

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
  minHeight: 24,
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

const FOOTER_STYLE: CSSProperties = {
  flex: '0 0 auto',
  padding: '0.35rem 0.8rem',
  borderTop: '1px solid var(--orbitpm-border)',
  fontSize: 11,
  color: 'var(--orbitpm-muted)'
}
