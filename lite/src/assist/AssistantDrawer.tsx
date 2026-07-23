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
// picks its own provider (first browser-capable provider with a stored key, in
// LITE_PROVIDERS order, with its default model — shown in the footer). The App
// supplies the digests (memoized), an open-a-process callback, the interview
// target accessors, and the open/close wiring.

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { t, getLang } from '../i18n'
import { useLang } from '../i18n/useLang'
import { generateFromDescription, type LlmMessage } from '@app/gen'
import type { ProcessDigest } from './digest'
import { selectContextDigests, buildContext } from './retrieval'
import { buildAssistantPrompt, extractAssistantAnswer } from './prompt'
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
  digestsToCatalog,
  readProcessId,
  QUESTIONS_MAX_TOKENS,
  type InterviewExchange,
  type InterviewModeler
} from './interview'
import { LITE_PROVIDERS, defaultLiteModelId, type LiteProviderId } from '../ai/providersLite'
import { getKey } from '../ai/keys'
import { makeBrowserCallLLM, classifyBrowserError, type ErrorCode } from '../ai/browserAi'

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

/** First browser-callable provider (skips the desktop-only Custom endpoint) that
 *  has a stored key, in LITE_PROVIDERS order, with its default model. */
function pickProvider(): ChosenProvider | null {
  for (const p of LITE_PROVIDERS) {
    if (p.desktopOnly) continue
    const apiKey = getKey(p.id)
    if (!apiKey) continue
    const modelId = defaultLiteModelId(p.id)
    if (!modelId) continue
    return { id: p.id, label: p.label, modelId, apiKey }
  }
  return null
}

/** Map a classified browser error onto the ai.error.* dictionary (the unknown
 *  class shows the raw first-line message the classifier already trimmed). */
const ERROR_KEY: Record<Exclude<ErrorCode, 'unknown'>, Parameters<typeof t>[0]> = {
  auth: 'ai.error.auth',
  rate: 'ai.error.rateLimit',
  cors: 'ai.error.cors',
  network: 'ai.error.network',
  timeout: 'ai.error.timeout'
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
  const lang = useLang()
  const [tab, setTab] = useState<DrawerTab>('library')
  const [messages, setMessages] = useState<Message[]>([])
  const [ivMessages, setIvMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [ivBusy, setIvBusy] = useState(false)
  const [ivDone, setIvDone] = useState(false)
  const [ivAwaiting, setIvAwaiting] = useState(false)
  const listRef = useRef<HTMLDivElement | null>(null)
  const sessionRef = useRef<InterviewSession>(freshSession())
  const lastRequestTokenRef = useRef<number | null>(null)

  // Re-pick the provider whenever keys change (Settings dialog bumps keysVersion).
  const provider = useMemo(() => pickProvider(), [keysVersion])

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
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const pushIv = (message: Message): void => {
    setIvMessages((prev) => [...prev, message])
  }

  const makeCall = (chosen: ChosenProvider): ReturnType<typeof makeBrowserCallLLM> =>
    makeBrowserCallLLM({ providerId: chosen.id, model: chosen.modelId, apiKey: chosen.apiKey })

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

      if (provider) {
        // Retrieval never silently skips the AI anymore: when ranking finds
        // nothing (or the workspace is small) ALL digests go in, capped by
        // buildContext (2,400 chars per digest, 12,000 chars total).
        const chosen = selectContextDigests(digests, q)
        if (chosen.length === 0) {
          // Workspace has no parseable processes at all.
          pushLocal()
        } else {
          try {
            const call = makeCall(provider)
            const history = toLlmHistory(prior)
            const outgoing: LlmMessage[] = [
              ...history,
              { role: 'user', content: buildAssistantPrompt(buildContext(chosen), q, getLang()) }
            ]
            // CallLLM is typed Promise<string | unknown>; the browser adapter
            // always resolves the model's raw text, so coerce to a string.
            const reply = String(await call(outgoing, { maxTokens: ANSWER_MAX_TOKENS }))
            const text = extractAssistantAnswer(reply)
            const sources = chosen
              .slice(0, 3)
              .map((r) => ({ processName: r.digest.processName, relPath: r.digest.relPath }))
            setMessages((prev) => [
              ...prev,
              { role: 'assistant', text, kind: 'chat', sources: dirChips ? sources : undefined }
            ])
          } catch (error) {
            // Surface the REAL failure (auth / rate limit / CORS / offline /
            // timeout) as a chat message, then still give the local answer.
            setMessages((prev) => [
              ...prev,
              { role: 'assistant', text: errorText(error), kind: 'error' }
            ])
            pushLocal(t('assist.fellBack'))
          }
        }
      } else {
        pushLocal()
      }
    } catch {
      // getDigests should never reject (buildAllDigests drops failures), but keep
      // the drawer usable if it somehow does.
      setMessages((prev) => [...prev, { role: 'assistant', text: t('assist.local.none'), kind: 'status' }])
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
    setIvBusy(true)
    try {
      const modeler = target.modeler as InterviewModeler
      const scan = scanDiagramGaps(modeler)
      const summary = buildDiagramSummary(modeler)
      const prompt = buildInterviewQuestionPrompt({
        description: session.description || target.description,
        summary,
        scan,
        exchanges: session.exchanges,
        lang: getLang()
      })
      const call = makeCall(provider)
      const reply = String(await call([{ role: 'user', content: prompt }], { maxTokens: QUESTIONS_MAX_TOKENS }))
      const questions = parseInterviewQuestions(reply)
      if (questions === null) {
        pushIv({
          role: 'assistant',
          text: errorText(new Error(`${provider.id}: empty response from the model`)),
          kind: 'error'
        })
        return
      }
      const nextRound = session.round + 1
      if (decideInterviewNext(nextRound, questions) === 'done') {
        session.done = true
        setIvDone(true)
        setIvAwaiting(false)
        pushIv({ role: 'assistant', text: t('assist.interview.done'), kind: 'status' })
        return
      }
      session.round = nextRound
      session.pendingQuestions = questions.join('\n')
      setIvAwaiting(true)
      pushIv({ role: 'assistant', text: session.pendingQuestions, kind: 'chat' })
    } catch (error) {
      pushIv({ role: 'assistant', text: errorText(error), kind: 'error' })
    } finally {
      setIvBusy(false)
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
    let applied = false
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
      pushIv({ role: 'assistant', text: t('assist.interview.applying'), kind: 'status' })
      const digests = await getDigests()
      const modeler = target.modeler as InterviewModeler
      const catalog = digestsToCatalog(digests, readProcessId(modeler))
      const description = session.description || target.description
      const history = buildGenerationHistory(description, exchanges)
      const call = makeCall(provider)
      const result = await generateFromDescription(
        call,
        description,
        history,
        catalog.length ? { processCatalog: catalog } : undefined
      )
      await onApplyXml?.(target.tabKey, result.layoutedXml)
      // Commit the exchange only after the diagram actually updated, so a
      // failed round can simply be answered again.
      session.exchanges = exchanges
      session.pendingQuestions = null
      setIvAwaiting(false)
      pushIv({ role: 'assistant', text: t('assist.interview.applied'), kind: 'status' })
      applied = true
    } catch (error) {
      pushIv({ role: 'assistant', text: errorText(error), kind: 'error' })
    } finally {
      setIvBusy(false)
    }
    if (applied) await runInterviewRound()
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
      ? !busy && input.trim() !== ''
      : !ivBusy && !ivDone && ivAwaiting && input.trim() !== ''

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
          onClick={onClose}
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

      <div ref={listRef} style={LIST_STYLE}>
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
  font: 'inherit',
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
