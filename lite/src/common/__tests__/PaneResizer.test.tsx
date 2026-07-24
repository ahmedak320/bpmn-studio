import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { PaneResizer, clampWidth, dragWidth, usePaneWidth } from '../PaneResizer'

// PaneResizer's drag math is pure on purpose — the vitest environment is
// node (no jsdom), so the edge × dir matrix and the clamp carry the test
// weight here; pointer plumbing is exercised by the e2e suite. Component
// coverage is a static server render (same approach as OwnerPicker.test.tsx).

const noop = (): void => {}

describe('clampWidth', () => {
  it('clamps below min and above max', () => {
    expect(clampWidth(100, 200, 560)).toBe(200)
    expect(clampWidth(900, 200, 560)).toBe(560)
    expect(clampWidth(300, 200, 560)).toBe(300)
  })

  it('returns the exact bounds at the edges', () => {
    expect(clampWidth(200, 200, 560)).toBe(200)
    expect(clampWidth(560, 200, 560)).toBe(560)
  })

  it('rounds to whole pixels', () => {
    expect(clampWidth(300.4, 200, 560)).toBe(300)
    expect(clampWidth(300.5, 200, 560)).toBe(301)
  })

  it('falls back to min for NaN', () => {
    expect(clampWidth(Number.NaN, 200, 560)).toBe(200)
  })
})

describe('dragWidth', () => {
  const base = { startWidth: 300, startClientX: 100, min: 200, max: 560 }

  // The full edge × dir matrix, both drag directions each.
  it("edge 'inline-end' + ltr: pane grows with +Δ (left explorer)", () => {
    expect(dragWidth({ ...base, clientX: 140, edge: 'inline-end', dir: 'ltr' })).toBe(340)
    expect(dragWidth({ ...base, clientX: 60, edge: 'inline-end', dir: 'ltr' })).toBe(260)
  })

  it("edge 'inline-end' + rtl: pane shrinks with +Δ", () => {
    expect(dragWidth({ ...base, clientX: 140, edge: 'inline-end', dir: 'rtl' })).toBe(260)
    expect(dragWidth({ ...base, clientX: 60, edge: 'inline-end', dir: 'rtl' })).toBe(340)
  })

  it("edge 'inline-start' + ltr: pane shrinks with +Δ (right properties pane)", () => {
    expect(dragWidth({ ...base, clientX: 140, edge: 'inline-start', dir: 'ltr' })).toBe(260)
    expect(dragWidth({ ...base, clientX: 60, edge: 'inline-start', dir: 'ltr' })).toBe(340)
  })

  it("edge 'inline-start' + rtl: pane grows with +Δ", () => {
    expect(dragWidth({ ...base, clientX: 140, edge: 'inline-start', dir: 'rtl' })).toBe(340)
    expect(dragWidth({ ...base, clientX: 60, edge: 'inline-start', dir: 'rtl' })).toBe(260)
  })

  it('clamps the dragged width into [min, max]', () => {
    expect(dragWidth({ ...base, clientX: 5000, edge: 'inline-end', dir: 'ltr' })).toBe(560)
    expect(dragWidth({ ...base, clientX: -5000, edge: 'inline-end', dir: 'ltr' })).toBe(200)
    expect(dragWidth({ ...base, clientX: 5000, edge: 'inline-start', dir: 'ltr' })).toBe(200)
  })

  it('zero Δ returns the (clamped) start width', () => {
    expect(dragWidth({ ...base, clientX: 100, edge: 'inline-end', dir: 'ltr' })).toBe(300)
    expect(
      dragWidth({ ...base, startWidth: 50, clientX: 100, edge: 'inline-end', dir: 'ltr' })
    ).toBe(200)
  })
})

describe('usePaneWidth (node environment)', () => {
  function Probe(): JSX.Element {
    const [width] = usePaneWidth('orbitpm.lite.test.paneWidth', { min: 100, max: 500 })
    return <span>{String(width)}</span>
  }

  it('yields null (caller falls back to the CSS default) when storage is unavailable', () => {
    // node has no localStorage — the guarded read must not throw.
    expect(renderToStaticMarkup(<Probe />)).toContain('null')
  })
})

describe('PaneResizer (static render)', () => {
  const baseProps = {
    width: 300,
    min: 200,
    max: 560,
    edge: 'inline-end' as const,
    dir: 'ltr' as const,
    onWidthChange: noop,
    onReset: noop,
    ariaLabel: 'Resize the explorer panel'
  }

  it('renders a focusable vertical separator with aria value attributes', () => {
    const html = renderToStaticMarkup(<PaneResizer {...baseProps} />)
    expect(html).toContain('role="separator"')
    expect(html).toContain('aria-orientation="vertical"')
    expect(html).toContain('aria-valuenow="300"')
    expect(html).toContain('aria-valuemin="200"')
    expect(html).toContain('aria-valuemax="560"')
    expect(html).toContain('aria-label="Resize the explorer panel"')
    expect(html).toContain('tabindex="0"')
    expect(html).toContain('orbitpm-lite-resizer')
  })

  it('renders nothing when visible is false', () => {
    expect(renderToStaticMarkup(<PaneResizer {...baseProps} visible={false} />)).toBe('')
  })

  it('renders when visible is true or omitted', () => {
    expect(renderToStaticMarkup(<PaneResizer {...baseProps} visible />)).toContain('role="separator"')
    expect(renderToStaticMarkup(<PaneResizer {...baseProps} />)).toContain('role="separator"')
  })
})
