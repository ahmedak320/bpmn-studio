/**
 * §17.5 AI-grounded assistant answers — the UI half.
 *
 * Mounted ONLY by `ArisAssistantPanel` when (a) a provider + API key is
 * configured and (b) `questionRouter.routeQuestion` returned `kind: 'none'`
 * for the asked question — see that file for the gating. Because of that
 * gating, nothing in this file ever renders, runs an effect, or does any
 * work on the no-key path: nothing here can add a network call, a consent
 * prompt, or latency to the §17.4 deterministic path.
 *
 * Every checkbox here defaults OFF/ON per §4.3: workspace context starts
 * unchecked (opt-in), name redaction starts checked (on by default whenever
 * context is included). No request is built from a live `fetch` until the
 * operator has reviewed the exact outbound system/user text (always
 * rendered, live, from the same pure `buildArisAssistantAiPrompt` the
 * request itself uses) AND checked consent — which is bound to that exact
 * payload via `hasArisAssistantAiConsent` and silently un-checks itself the
 * moment any input the disclosure depends on changes.
 */

import { useMemo, useRef, useState } from 'react'

import { makeBrowserCallLLM } from '../../ai/browserAi'
import { getKey } from '../../ai/keys'
import { getLiteProvider, type LiteProviderId } from '../../ai/providersLite'
import type { ArisAnswerChip } from '../assistant/answer'
import type { ArisProcessDigest } from '../assistant/types'
import {
  askArisAssistantAi,
  boundArisAssistantAiHistory,
  buildArisAssistantAiContext,
  buildArisAssistantAiDisclosure,
  buildArisAssistantAiPrompt,
  grantArisAssistantAiConsent,
  hasArisAssistantAiConsent,
  type ArisAssistantAiAnswerResult,
  type ArisAssistantAiConsent,
  type ArisAssistantAiTurn
} from './arisAssistantAi'
import { tk } from './shellI18n'

export interface ArisAssistantAiSectionProps {
  readonly digests: readonly ArisProcessDigest[]
  readonly question: string
  readonly providerId: LiteProviderId
  readonly modelId: string
  /** Bounded prior AI turns from this drawer session — §17.5.7. */
  readonly history: readonly ArisAssistantAiTurn[]
  readonly onOpenChip: (chip: ArisAnswerChip) => boolean
  readonly onAnswered: (turn: ArisAssistantAiTurn) => void
}

const chipButtonStyle = { textAlign: 'start' as const, maxWidth: '100%' }
const previewTextAreaStyle = { width: '100%', fontSize: 11, resize: 'vertical' as const }

export function ArisAssistantAiSection({
  digests,
  question,
  providerId,
  modelId,
  history,
  onOpenChip,
  onAnswered
}: ArisAssistantAiSectionProps): JSX.Element {
  // §4.3 defaults: workspace context OFF, name redaction ON (only matters once context is on).
  const [includeContext, setIncludeContext] = useState(false)
  const [redactNames, setRedactNames] = useState(true)
  const [consent, setConsent] = useState<ArisAssistantAiConsent | null>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<ArisAssistantAiAnswerResult | null>(null)
  const [keyMissing, setKeyMissing] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  const boundedHistory = useMemo(() => boundArisAssistantAiHistory(history), [history])

  const context = useMemo(
    () => buildArisAssistantAiContext(digests, question, redactNames),
    [digests, question, redactNames]
  )

  const disclosure = useMemo(
    () =>
      buildArisAssistantAiDisclosure({
        providerId,
        modelId,
        question,
        history: boundedHistory,
        context,
        includeWorkspaceContext: includeContext,
        redactNames
      }),
    [providerId, modelId, question, boundedHistory, context, includeContext, redactNames]
  )

  // §17.5.3: this is rendered VERBATIM below, before any send is possible —
  // it is the exact text `askArisAssistantAi` will submit.
  const prompt = useMemo(
    () =>
      buildArisAssistantAiPrompt({
        question,
        history: boundedHistory,
        contextText: includeContext ? context.contextText : ''
      }),
    [question, boundedHistory, includeContext, context]
  )

  const consentValid = hasArisAssistantAiConsent(disclosure, consent)
  const providerLabel = getLiteProvider(providerId).label

  const ask = async (): Promise<void> => {
    if (!consentValid || busy) return
    const apiKey = getKey(providerId)
    if (!apiKey) {
      setKeyMissing(true)
      return
    }
    setKeyMissing(false)
    setBusy(true)
    setResult(null)
    const controller = new AbortController()
    abortRef.current = controller
    const callLLM = makeBrowserCallLLM(
      {
        providerId,
        model: modelId,
        apiKey,
        referer: typeof location !== 'undefined' ? location.origin : undefined,
        title: 'OrbitPM ARIS Studio Lite'
      },
      { signal: controller.signal }
    )
    const outcome = await askArisAssistantAi({
      callLLM,
      providerId,
      modelId,
      question,
      history: boundedHistory,
      context,
      includeWorkspaceContext: includeContext
    })
    setResult(outcome)
    setBusy(false)
    abortRef.current = null
    if (outcome.kind === 'ok') onAnswered({ question, answer: outcome.text })
  }

  const cancel = (): void => {
    abortRef.current?.abort()
  }

  return (
    <section
      data-orbitpm-aris-assistant-ai=""
      style={{
        border: '1px dashed var(--orbitpm-border)',
        borderRadius: 10,
        padding: '0.75rem 0.85rem',
        display: 'grid',
        gap: 8
      }}
    >
      <h4 style={{ margin: 0, fontSize: 13 }}>
        {tk('aris.assistant.ai.heading', 'Ask AI (grounded in these processes)')}
      </h4>
      <p style={{ margin: 0, fontSize: 12, color: 'var(--orbitpm-muted)', lineHeight: 1.5 }}>
        {tk(
          'aris.assistant.ai.body',
          'Sends your question to the configured AI provider, grounded only in the process content shown below. Nothing is sent until you review the exact request and consent.'
        )}
      </p>

      <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12 }}>
        <input
          type="checkbox"
          data-orbitpm-aris-assistant-ai-include-context=""
          checked={includeContext}
          onChange={(event) => setIncludeContext(event.target.checked)}
        />
        <span>{tk('aris.assistant.ai.includeContext', 'Include relevant process context')}</span>
      </label>
      <label
        style={{
          display: 'flex',
          gap: 8,
          alignItems: 'flex-start',
          fontSize: 12,
          opacity: includeContext ? 1 : 0.6
        }}
      >
        <input
          type="checkbox"
          data-orbitpm-aris-assistant-ai-redact-names=""
          checked={redactNames}
          disabled={!includeContext}
          onChange={(event) => setRedactNames(event.target.checked)}
        />
        <span>{tk('aris.assistant.ai.redactNames', 'Redact names in process context')}</span>
      </label>

      <p style={{ margin: 0, fontSize: 11.5 }}>
        {context.includedModelIds.length > 0
          ? tk(
              'aris.assistant.ai.contextCount',
              '{count} relevant process(es) matched and will be included',
              { count: context.includedModelIds.length }
            )
          : tk(
              'aris.assistant.ai.contextNone',
              'No relevant process matched this question, so no workspace content will be sent.'
            )}
      </p>

      {includeContext && context.chips.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {context.chips.map((chip) => (
            <button
              key={chip.modelId}
              type="button"
              className="orbitpm-lite-chrome-btn"
              style={chipButtonStyle}
              onClick={() => onOpenChip(chip)}
            >
              {chip.modelName}
            </button>
          ))}
        </div>
      )}

      <details>
        <summary style={{ fontSize: 12, cursor: 'pointer' }}>
          {tk('aris.assistant.ai.preview', 'Exact outbound request')}
        </summary>
        <div style={{ display: 'grid', gap: 6, marginTop: 6 }}>
          <label style={{ display: 'grid', gap: 4 }}>
            <span style={{ fontSize: 11, color: 'var(--orbitpm-muted)' }}>
              {tk('aris.assistant.ai.previewSystem', 'System instructions')}
            </span>
            <textarea
              readOnly
              value={prompt.system}
              rows={3}
              dir="auto"
              data-orbitpm-aris-assistant-ai-preview-system=""
              style={previewTextAreaStyle}
            />
          </label>
          <label style={{ display: 'grid', gap: 4 }}>
            <span style={{ fontSize: 11, color: 'var(--orbitpm-muted)' }}>
              {tk('aris.assistant.ai.previewUser', 'User message')}
            </span>
            <textarea
              readOnly
              value={prompt.user}
              rows={6}
              dir="auto"
              data-orbitpm-aris-assistant-ai-preview-user=""
              style={previewTextAreaStyle}
            />
          </label>
        </div>
      </details>

      <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12 }}>
        <input
          type="checkbox"
          data-orbitpm-aris-assistant-ai-consent=""
          checked={consentValid}
          onChange={(event) =>
            setConsent(event.target.checked ? grantArisAssistantAiConsent(disclosure) : null)
          }
        />
        <strong>
          {tk(
            'aris.assistant.ai.consent',
            'I reviewed the exact request above and consent to sending it'
          )}
        </strong>
      </label>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button
          type="button"
          className="orbitpm-lite-primary"
          data-orbitpm-aris-assistant-ai-submit=""
          disabled={!consentValid || busy}
          onClick={() => void ask()}
        >
          {busy
            ? tk('aris.assistant.ai.asking', 'Asking…')
            : tk('aris.assistant.ai.submit', 'Ask AI')}
        </button>
        {busy && (
          <button
            type="button"
            className="orbitpm-lite-chrome-btn"
            data-orbitpm-aris-assistant-ai-cancel=""
            onClick={cancel}
          >
            {tk('aris.assistant.ai.cancel', 'Cancel')}
          </button>
        )}
      </div>

      {keyMissing && (
        <p role="status" style={{ margin: 0, fontSize: 12 }}>
          {tk(
            'aris.create.noKey',
            'No API key is stored for this provider. Open Settings to add one.'
          )}
        </p>
      )}

      {result && result.kind === 'ok' && (
        <div data-orbitpm-aris-assistant-ai-answer="" style={{ display: 'grid', gap: 6 }}>
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
            {result.text}
          </p>
          <p style={{ margin: 0, fontSize: 11, color: 'var(--orbitpm-muted)' }}>
            {tk('aris.assistant.ai.answeredBy', 'Answered by {provider} · {model}', {
              provider: providerLabel,
              model: result.modelId
            })}
          </p>
          {result.chips.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {result.chips.map((chip) => (
                <button
                  key={chip.modelId}
                  type="button"
                  className="orbitpm-lite-chrome-btn"
                  data-orbitpm-aris-assistant-ai-chip={chip.modelId}
                  style={chipButtonStyle}
                  onClick={() => onOpenChip(chip)}
                >
                  {chip.modelName}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {result && result.kind === 'fallback' && (
        <p
          role="status"
          data-orbitpm-aris-assistant-ai-fallback=""
          style={{ margin: 0, fontSize: 12 }}
        >
          {tk(
            'aris.assistant.ai.fallback',
            'The AI request failed, so the local answer above is shown instead.'
          )}
        </p>
      )}

      {result && result.kind === 'cancelled' && (
        <p
          role="status"
          data-orbitpm-aris-assistant-ai-cancelled=""
          style={{ margin: 0, fontSize: 12 }}
        >
          {tk('aris.assistant.ai.cancelled', 'The AI request was cancelled.')}
        </p>
      )}
    </section>
  )
}
