// @vitest-environment jsdom

import { useEffect, useState } from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { CreditsLine } from '../CreditsLine'
import { subscribeUsage, type UsageTotals } from '../credits'

const noop = (): void => {}
afterEach(cleanup)
const usage = (
  requests: number,
  inputTokens: number,
  outputTokens: number,
  costUsd: number | null,
  reasoningTokens = 0,
  overflowed = false
): UsageTotals => ({
  requests,
  inputTokens,
  outputTokens,
  reasoningTokens,
  costUsd,
  costKind: costUsd === null ? 'unknown' : 'provider',
  since: 1,
  ...(overflowed ? { overflowed: true } : {})
})

describe('CreditsLine (static render)', () => {
  it('loading state shows the checking-balance text', () => {
    const html = renderToStaticMarkup(<CreditsLine state={{ kind: 'loading' }} onRefresh={noop} />)
    expect(html).toContain('Checking credit balance')
  })

  it('credits state shows the remaining amount, fixed to 2 decimals, with a refresh button', () => {
    const html = renderToStaticMarkup(
      <CreditsLine state={{ kind: 'credits', remaining: 12.5 }} onRefresh={noop} />
    )
    expect(html).toContain('Credits remaining: $12.50')
    // The refresh control carries its aria-label.
    expect(html).toContain('Refresh credit balance')
  })

  it('error state shows the localized message for the kind', () => {
    const auth = renderToStaticMarkup(
      <CreditsLine state={{ kind: 'error', errorKind: 'auth' }} onRefresh={noop} />
    )
    expect(auth).toContain('invalid key')
    const timeout = renderToStaticMarkup(
      <CreditsLine state={{ kind: 'error', errorKind: 'timeout' }} onRefresh={noop} />
    )
    expect(timeout).toContain('timed out')
  })

  it('usage state formats tokens (input+output) and a dollar cost, with a reset link', () => {
    const html = renderToStaticMarkup(
      <CreditsLine
        state={{
          kind: 'usage',
          session: usage(3, 1000, 500, 0.12, 25),
          allTime: usage(5, 2000, 1000, 0.2, 40)
        }}
        onReset={noop}
      />
    )
    expect(html).toContain('Session: 3 requests')
    // 1000 + 500 = 1500 → toLocaleString → "1,500"
    expect(html).toContain('1,500 input/output tokens')
    expect(html).toContain('$0.12')
    expect(html).toContain('25 reasoning tokens')
    expect(html).toContain('All time: 5 requests')
    expect(html).toContain('Reset')
  })

  it('usage state with a null cost renders "n/a" (never $0)', () => {
    const html = renderToStaticMarkup(
      <CreditsLine
        state={{
          kind: 'usage',
          session: usage(1, 100, 50, null),
          allTime: usage(1, 100, 50, null)
        }}
        onReset={noop}
      />
    )
    expect(html).toContain('cost n/a')
    expect(html).not.toContain('$0.00')
  })

  it('does not round a small nonzero cost down to $0.00', () => {
    const html = renderToStaticMarkup(
      <CreditsLine
        state={{
          kind: 'usage',
          session: usage(1, 10, 5, 0.000123),
          allTime: usage(1, 10, 5, 0.000123)
        }}
      />
    )
    expect(html).toContain('$0.000123')
    expect(html).not.toContain('$0.00<')
  })

  it('uses a nonzero scientific currency value below fixed-decimal precision', () => {
    const html = renderToStaticMarkup(
      <CreditsLine
        state={{
          kind: 'usage',
          session: usage(1, 1, 1, 0.000000000001),
          allTime: usage(1, 1, 1, 0.000000000001)
        }}
      />
    )
    expect(html).toContain('$1.00E-12')
    expect(html).not.toContain('$0.0000')
  })

  it('renders incomplete totals as localized lower bounds rather than exact counts', () => {
    const html = renderToStaticMarkup(
      <CreditsLine
        state={{
          kind: 'usage',
          session: usage(1, 1, 1, 0.01),
          allTime: usage(2, 3, 4, null, 1, true)
        }}
      />
    )
    expect(html).toContain('All time: ≥2 requests')
    expect(html).toContain('≥7 input/output tokens')
    expect(html).toContain('Usage is incomplete')
    expect(html).toContain('cost n/a')
  })

  it('usage state shows the no-balance-API note when note is set', () => {
    const html = renderToStaticMarkup(
      <CreditsLine
        state={{
          kind: 'usage',
          session: usage(0, 0, 0, null),
          allTime: usage(0, 0, 0, null)
        }}
        onReset={noop}
        note
      />
    )
    expect(html).toContain('does not expose a balance API')
  })
})

describe('mounted usage refresh subscription', () => {
  function UsageRefreshProbe(): JSX.Element {
    const [providers, setProviders] = useState<string[]>([])
    useEffect(
      () =>
        subscribeUsage((providerId) => {
          setProviders((current) => [...current, providerId])
        }),
      []
    )
    return <span data-testid="providers">{providers.join(',')}</span>
  }

  it('refreshes for overflow markers and storage-clear events', () => {
    render(<UsageRefreshProbe />)

    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: 'orbitpm.lite.usage.openrouter.fallback-overflow'
        })
      )
      window.dispatchEvent(new StorageEvent('storage', { key: null }))
    })

    expect(screen.getByTestId('providers').textContent).toBe(
      'openrouter,openrouter,anthropic,gemini'
    )
  })
})
