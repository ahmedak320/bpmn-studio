/**
 * The deterministic, no-key half of the ARIS process assistant (plan §17.4),
 * plus the §17.5 AI-grounded offer once that deterministic path comes up
 * empty.
 *
 * Every §17.4 answer this panel shows is produced with NO provider and NO API
 * key: `routeQuestion` picks one of the eleven §17.4 answerers, each of which
 * returns structured DATA (message key + vars + chips), and `formatAnswer`
 * resolves that data into the active language. The panel never writes prose
 * of its own and never falls back to a guess — an unmatched question renders
 * the lane's own `assistant.none` line, which is the honest answer.
 *
 * Chips carry `relPath` + `modelId` + `occurrenceId`, which is exactly what
 * §17.6 requires: activating one selects that element on the canvas.
 *
 * §17.5 wiring: `routeQuestion` returning `kind: 'none'` is the documented
 * signal that no local answerer found a confident match. ONLY THEN — and
 * only when a provider + API key is already configured — does this panel
 * mount `ArisAssistantAiSection`. That gate means a user with no key sees
 * exactly today's behavior: no extra DOM, no extra effect, no network call,
 * no consent prompt, ever (see `ArisAssistantPanel.aiGate.test.tsx`).
 */

import { useCallback, useEffect, useMemo, useState } from 'react'

import { hasKey } from '../../ai/keys'
import {
  getProviderSelection,
  subscribeProviderSelection,
  type ProviderSelection
} from '../../ai/providerSelection'
import type { ArisAnswerChip } from '../assistant/answer'
import { formatAnswer, type ArisFormattedAnswer } from '../assistant/formatAnswer'
import { routeQuestion } from '../assistant/questionRouter'
import type { ArisProcessDigest } from '../assistant/types'
import { ArisAssistantAiSection } from './ArisAssistantAiSection'
import type { ArisAssistantAiTurn } from './arisAssistantAi'
import { tk } from './shellI18n'

export interface ArisAssistantPanelProps {
  readonly digests: readonly ArisProcessDigest[]
  readonly lang: 'en' | 'ar'
  /**
   * Reveal a chip's element. Returns `false` when the model or occurrence is not
   * open on a renderable canvas.
   */
  readonly onOpenChip: (chip: ArisAnswerChip) => boolean
}

/** Prompts that exercise the §17.4 answerers, so the panel is usable cold. */
const SUGGESTIONS: readonly { readonly key: string; readonly source: string }[] = Object.freeze([
  { key: 'aris.assistant.suggest.processes', source: 'Which processes are available?' },
  { key: 'aris.assistant.suggest.missing', source: 'Which information is missing?' }
])

export function ArisAssistantPanel({
  digests,
  lang,
  onOpenChip
}: ArisAssistantPanelProps): JSX.Element {
  const [question, setQuestion] = useState('')
  const [asked, setAsked] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  // §17.5.7: bounded AI-turn history for this drawer session only (never
  // persisted); read-only synchronous provider/key lookups below decide
  // whether the AI offer can even be shown — no network involved.
  const [aiHistory, setAiHistory] = useState<readonly ArisAssistantAiTurn[]>([])
  const [selection, setSelection] = useState<ProviderSelection | null>(() => getProviderSelection())

  useEffect(() => subscribeProviderSelection(setSelection), [])

  const routed = useMemo(() => {
    if (asked === null || asked.trim() === '') return null
    return routeQuestion(digests, asked, lang)
  }, [asked, digests, lang])

  const answer: ArisFormattedAnswer | null = useMemo(() => {
    if (!routed) return null
    return formatAnswer(lang, routed)
  }, [routed, lang])

  const ask = useCallback((text: string) => {
    setNotice(null)
    setQuestion(text)
    setAsked(text)
  }, [])

  // §17.5: only offered once the deterministic path is confirmed empty
  // (`routed.kind === 'none'`) AND a provider + key is already configured —
  // `hasKey` is a synchronous in-memory read, never a network call.
  const offerAi =
    routed !== null &&
    routed.kind === 'none' &&
    asked !== null &&
    asked.trim() !== '' &&
    selection !== null &&
    hasKey(selection.providerId)

  return (
    <section
      data-orbitpm-aris-assistant-ask=""
      style={{
        border: '1px solid var(--orbitpm-border)',
        borderRadius: 12,
        padding: '0.9rem 1rem',
        display: 'grid',
        gap: 10
      }}
    >
      <h3 style={{ margin: 0, fontSize: 14 }}>
        {tk('aris.assistant.ask.heading', 'Ask the process library')}
      </h3>
      <p style={{ margin: 0, fontSize: 12.5, color: 'var(--orbitpm-muted)', lineHeight: 1.5 }}>
        {tk(
          'aris.assistant.ask.body',
          'Answered locally from the indexed models. No provider and no API key are used.'
        )}
      </p>
      <p style={{ margin: 0, fontSize: 12, color: 'var(--orbitpm-muted)' }}>
        {tk('aris.assistant.ask.indexed', '{count} indexed models', { count: digests.length })}
      </p>

      <form
        style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}
        onSubmit={(event) => {
          event.preventDefault()
          ask(question)
        }}
      >
        <label style={{ flex: '1 1 240px', display: 'grid', gap: 4 }}>
          <span style={{ fontSize: 12, color: 'var(--orbitpm-muted)' }}>
            {tk('aris.assistant.ask.label', 'Question')}
          </span>
          <input
            value={question}
            data-orbitpm-aris-assistant-question=""
            onChange={(event) => setQuestion(event.target.value)}
            style={{
              width: '100%',
              borderRadius: 8,
              border: '1px solid var(--orbitpm-border)',
              background: 'transparent',
              color: 'inherit',
              font: 'inherit',
              padding: '0.4rem 0.5rem'
            }}
          />
        </label>
        <button
          type="submit"
          className="orbitpm-lite-primary"
          style={{ alignSelf: 'end' }}
          disabled={question.trim() === ''}
        >
          {tk('aris.assistant.ask.submit', 'Ask')}
        </button>
      </form>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {SUGGESTIONS.map((suggestion) => {
          const text = tk(suggestion.key, suggestion.source)
          return (
            <button
              key={suggestion.key}
              type="button"
              className="orbitpm-lite-chrome-btn"
              onClick={() => ask(text)}
            >
              {text}
            </button>
          )
        })}
      </div>

      {answer && (
        <div data-orbitpm-aris-assistant-answer="" style={{ display: 'grid', gap: 6 }}>
          {answer.lines.map((line, index) => {
            const chip = line.chip
            return (
              <div key={`${index}:${line.text}`} style={{ fontSize: 13, lineHeight: 1.5 }}>
                {chip ? (
                  <button
                    type="button"
                    className="orbitpm-lite-chrome-btn"
                    data-orbitpm-aris-assistant-chip={chip.occurrenceId ?? chip.modelId}
                    style={{ textAlign: 'start', maxWidth: '100%' }}
                    onClick={() => {
                      const revealed = onOpenChip(chip)
                      setNotice(
                        revealed
                          ? null
                          : tk(
                              'aris.assistant.chip.unavailable',
                              'That element is not open on a renderable canvas.'
                            )
                      )
                    }}
                  >
                    {line.text}
                  </button>
                ) : (
                  <span>{line.text}</span>
                )}
              </div>
            )
          })}
        </div>
      )}

      {offerAi && selection && asked && (
        <ArisAssistantAiSection
          // A fresh question always gets a fresh AI section instance — no
          // stale busy/consent/result state can leak across questions.
          key={asked}
          digests={digests}
          question={asked}
          providerId={selection.providerId}
          modelId={selection.modelId}
          history={aiHistory}
          onOpenChip={onOpenChip}
          onAnswered={(turn) => setAiHistory((prev) => [...prev, turn])}
        />
      )}

      {notice && (
        <p role="status" style={{ margin: 0, fontSize: 12 }}>
          {notice}
        </p>
      )}
    </section>
  )
}
