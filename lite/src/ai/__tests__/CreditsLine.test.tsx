import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { CreditsLine } from '../CreditsLine'

const noop = (): void => {}

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
        state={{ kind: 'usage', requests: 3, inputTokens: 1000, outputTokens: 500, estCostUsd: 0.12 }}
        onReset={noop}
      />
    )
    expect(html).toContain('3 requests')
    // 1000 + 500 = 1500 → toLocaleString → "1,500"
    expect(html).toContain('1,500 tokens')
    expect(html).toContain('$0.12')
    expect(html).toContain('Reset')
  })

  it('usage state with a null cost renders "n/a" (never $0)', () => {
    const html = renderToStaticMarkup(
      <CreditsLine
        state={{ kind: 'usage', requests: 1, inputTokens: 100, outputTokens: 50, estCostUsd: null }}
        onReset={noop}
      />
    )
    expect(html).toContain('cost n/a')
    expect(html).not.toContain('$0.00')
  })

  it('usage state shows the no-balance-API note when note is set', () => {
    const html = renderToStaticMarkup(
      <CreditsLine
        state={{ kind: 'usage', requests: 0, inputTokens: 0, outputTokens: 0, estCostUsd: null }}
        onReset={noop}
        note
      />
    )
    expect(html).toContain('does not expose a balance API')
  })
})
