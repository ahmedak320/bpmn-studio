// The OrbitPM Lite "process assistant" — a floating chat drawer that answers
// "what happens next / who owns this step / which process do I follow" over the
// workspace's own BPMN files.
//
// Two answer paths share one UI:
//   * AI path — when a browser-callable provider key is configured, the top
//     ranked process digests are rendered into a grounded prompt and sent
//     through the SAME transport the AI generation panel uses
//     (makeBrowserCallLLM). Any transport/other failure degrades gracefully to…
//   * Local path — a deterministic, offline "what happens next" answerer over
//     the digests (answerLocally). This is also the whole answer when no key is
//     configured, so the assistant is always useful.
//
// The component is self-contained: it owns its message list + input state and
// picks its own provider (first browser-capable provider with a stored key, in
// LITE_PROVIDERS order). The App only supplies the digests (memoized), an
// open-a-process callback, and the open/close wiring.

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { t } from '../i18n'
import { useLang } from '../i18n/useLang'
import type { ProcessDigest } from './digest'
import { rankDigests, buildContext } from './retrieval'
import { buildAssistantPrompt } from './prompt'
import { answerLocally } from './answerLocal'
import { formatLocalAnswer, type AssistantSource } from './formatLocal'
import { LITE_PROVIDERS, defaultLiteModelId, type LiteProviderId } from '../ai/providersLite'
import { getKey } from '../ai/keys'
import { makeBrowserCallLLM } from '../ai/browserAi'

type Source = AssistantSource
interface Message {
  role: 'user' | 'assistant'
  text: string
  sources?: Source[]
}

interface ChosenProvider {
  id: LiteProviderId
  label: string
  modelId: string
  apiKey: string
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

export function AssistantDrawer({
  open,
  onOpen,
  onClose,
  printing,
  mode,
  keysVersion,
  getDigests,
  onOpenProcess
}: AssistantDrawerProps): JSX.Element | null {
  const lang = useLang()
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const listRef = useRef<HTMLDivElement | null>(null)

  // Re-pick the provider whenever keys change (Settings dialog bumps keysVersion).
  const provider = useMemo(() => pickProvider(), [keysVersion])

  // Auto-scroll the transcript to the newest message.
  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, busy])

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

  const send = async (): Promise<void> => {
    const q = input.trim()
    if (!q || busy) return
    setInput('')
    setMessages((prev) => [...prev, { role: 'user', text: q }])
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
          { role: 'assistant', text, sources: dirChips && local.sources.length ? local.sources : undefined }
        ])
      }

      if (provider) {
        const ranked = rankDigests(digests, q)
        if (ranked.length === 0) {
          pushLocal()
        } else {
          try {
            const call = makeBrowserCallLLM({
              providerId: provider.id,
              model: provider.modelId,
              apiKey: provider.apiKey
            })
            // CallLLM is typed Promise<string | unknown>; the browser adapter
            // always resolves the model's raw text, so coerce to a string.
            const reply = String(
              await call([{ role: 'user', content: buildAssistantPrompt(buildContext(ranked), q, lang) }], {
                maxTokens: 900
              })
            )
            const sources = ranked
              .slice(0, 3)
              .map((r) => ({ processName: r.digest.processName, relPath: r.digest.relPath }))
            setMessages((prev) => [
              ...prev,
              { role: 'assistant', text: reply.trim(), sources: dirChips ? sources : undefined }
            ])
          } catch {
            // Transport or any other failure — inline note, then the local answer.
            pushLocal(t('assist.fellBack'))
          }
        }
      } else {
        pushLocal()
      }
    } catch {
      // getDigests should never reject (buildAllDigests drops failures), but keep
      // the drawer usable if it somehow does.
      setMessages((prev) => [...prev, { role: 'assistant', text: t('assist.local.none') }])
    } finally {
      setBusy(false)
    }
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
    ? t('assist.poweredBy', { provider: provider.label })
    : t('assist.localMode')

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

      <div ref={listRef} style={LIST_STYLE}>
        {messages.length === 0 && (
          <p style={{ margin: 0, color: 'var(--orbitpm-muted)', fontSize: 12.5, lineHeight: 1.6 }}>
            {t('assist.empty')}
          </p>
        )}
        {messages.map((m, i) => (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={m.role === 'user' ? BUBBLE_USER : BUBBLE_ASSISTANT}>{m.text}</div>
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
        {busy && (
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
        <button
          type="button"
          onClick={() => void send()}
          disabled={busy || !input.trim()}
          title={t('assist.send')}
          style={{ ...SEND_STYLE, opacity: busy || !input.trim() ? 0.5 : 1 }}
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

const FOOTER_STYLE: CSSProperties = {
  flex: '0 0 auto',
  padding: '0.35rem 0.8rem',
  borderTop: '1px solid var(--orbitpm-border)',
  fontSize: 11,
  color: 'var(--orbitpm-muted)'
}
