import { type CSSProperties } from 'react'
import { t, type Key } from '../i18n'
import { useLang } from '../i18n/useLang'
import type { CreditsErrorKind } from './credits'

/**
 * Discriminated display state for {@link CreditsLine}. The first three are the
 * OpenRouter balance states (loading / a remaining figure / a fetch error); the
 * `usage` variant is the locally-tracked ledger shown for providers with no
 * balance API (Anthropic / Gemini).
 */
export type CreditsLineState =
  | { kind: 'loading' }
  | { kind: 'credits'; remaining: number }
  | { kind: 'error'; errorKind: CreditsErrorKind }
  | {
      kind: 'usage'
      requests: number
      inputTokens: number
      outputTokens: number
      /** null ⇒ cost is unknown for this model — render "n/a", never $0. */
      estCostUsd: number | null
    }

export interface CreditsLineProps {
  state: CreditsLineState
  /** Balance states show a refresh button when provided. */
  onRefresh?: () => void
  /** The usage state shows a reset link when provided. */
  onReset?: () => void
  /** Append the muted "no balance API" note (Settings usage line). */
  note?: boolean
}

function creditsErrorKey(kind: CreditsErrorKind): Key {
  switch (kind) {
    case 'auth':
      return 'ai.credits.error.auth'
    case 'network':
      return 'ai.credits.error.network'
    case 'timeout':
      return 'ai.credits.error.timeout'
    default:
      return 'ai.credits.error.unexpected'
  }
}

/**
 * A single status line under the provider selector: OpenRouter's remaining
 * balance (with a refresh button) or the local session usage ledger (with a
 * reset link). Purely props-driven so it renders identically in the AI panel
 * and in Settings, and so each state can be unit-tested via renderToStaticMarkup.
 */
export function CreditsLine({ state, onRefresh, onReset, note }: CreditsLineProps): JSX.Element {
  useLang()

  if (state.kind === 'usage') {
    const tokens = (state.inputTokens + state.outputTokens).toLocaleString()
    const cost = state.estCostUsd === null ? t('ai.usage.costNa') : `$${state.estCostUsd.toFixed(2)}`
    return (
      <div style={wrap}>
        <span style={textStyle}>
          {t('ai.usage.session', { requests: state.requests, tokens, cost })}
        </span>
        {onReset && (
          <button type="button" onClick={onReset} style={linkBtn}>
            {t('ai.usage.reset')}
          </button>
        )}
        {note && <span style={noteStyle}>{t('settings.credits.noBalanceApi')}</span>}
      </div>
    )
  }

  let text: string
  if (state.kind === 'loading') text = t('ai.credits.loading')
  else if (state.kind === 'credits') text = t('ai.credits.remaining', { amount: state.remaining.toFixed(2) })
  else text = t(creditsErrorKey(state.errorKind))

  return (
    <div style={wrap}>
      <span style={{ ...textStyle, color: state.kind === 'error' ? '#dc2626' : 'var(--orbitpm-muted)' }}>
        {text}
      </span>
      {onRefresh && (
        <button
          type="button"
          onClick={onRefresh}
          aria-label={t('ai.credits.refresh')}
          title={t('ai.credits.refresh')}
          style={refreshBtn}
        >
          ⟳
        </button>
      )}
    </div>
  )
}

const wrap: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: 6,
  fontSize: 12
}
const textStyle: CSSProperties = { color: 'var(--orbitpm-muted)' }
const noteStyle: CSSProperties = { flexBasis: '100%', fontSize: 11, color: 'var(--orbitpm-muted)' }
const refreshBtn: CSSProperties = {
  border: '1px solid rgba(127,127,127,0.35)',
  background: 'transparent',
  color: 'inherit',
  cursor: 'pointer',
  borderRadius: 6,
  lineHeight: 1,
  padding: '0.1rem 0.35rem',
  font: 'inherit'
}
const linkBtn: CSSProperties = {
  border: 'none',
  background: 'transparent',
  color: 'var(--orbitpm-accent)',
  textDecoration: 'underline',
  cursor: 'pointer',
  font: 'inherit',
  fontSize: 12,
  padding: 0
}

export default CreditsLine
