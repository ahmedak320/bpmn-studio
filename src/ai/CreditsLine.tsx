import { type CSSProperties } from 'react'
import { t, type Key } from '../i18n'
import { useLang } from '../i18n/useLang'
import type { CreditsErrorKind } from './credits'
import { ESTIMATED_PRICE_AS_OF, type UsageTotals } from './credits'

/**
 * Discriminated display state for {@link CreditsLine}. The first three are the
 * OpenRouter balance states (loading / a remaining figure / a fetch error); the
 * `usage` variant is the locally-tracked ledger shown for providers with no
 * balance API (Anthropic / Gemini).
 */
export type CreditsLineState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'credits'; remaining: number }
  | { kind: 'error'; errorKind: CreditsErrorKind }
  | {
      kind: 'usage'
      session: UsageTotals
      allTime: UsageTotals
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
  const lang = useLang()

  if (state.kind === 'usage') {
    const number = new Intl.NumberFormat(lang)
    const formatCost = (value: number | null): string => {
      if (value === null) return t('ai.usage.costNa')
      return new Intl.NumberFormat(lang, {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: value > 0 && value < 0.01 ? 4 : 2,
        maximumFractionDigits: value > 0 && value < 0.01 ? 8 : 2
      }).format(value)
    }
    const sessionTokens = state.session.inputTokens + state.session.outputTokens
    const allTimeTokens = state.allTime.inputTokens + state.allTime.outputTokens
    const estimated =
      state.session.costKind === 'estimated' ||
      state.session.costKind === 'mixed' ||
      state.allTime.costKind === 'estimated' ||
      state.allTime.costKind === 'mixed'
    return (
      <div style={wrap}>
        <span style={textStyle}>
          {t('ai.usage.sessionDetailed', {
            requests: number.format(state.session.requests),
            tokens: number.format(sessionTokens),
            reasoning: number.format(state.session.reasoningTokens),
            cost: formatCost(state.session.costUsd)
          })}
        </span>
        <span style={{ ...textStyle, flexBasis: '100%' }}>
          {t('ai.usage.allTimeDetailed', {
            requests: number.format(state.allTime.requests),
            tokens: number.format(allTimeTokens),
            reasoning: number.format(state.allTime.reasoningTokens),
            cost: formatCost(state.allTime.costUsd)
          })}
        </span>
        {estimated && (
          <span style={noteStyle}>{t('ai.usage.priceAsOf', { date: ESTIMATED_PRICE_AS_OF })}</span>
        )}
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
  if (state.kind === 'idle') text = t('ai.credits.refreshHint')
  else if (state.kind === 'loading') text = t('ai.credits.loading')
  else if (state.kind === 'credits')
    text = t('ai.credits.remaining', { amount: state.remaining.toFixed(2) })
  else text = t(creditsErrorKey(state.errorKind))

  return (
    <div style={wrap}>
      <span
        style={{ ...textStyle, color: state.kind === 'error' ? '#dc2626' : 'var(--orbitpm-muted)' }}
      >
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
