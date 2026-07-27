// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DetailsResizer, detailsWidthFromPointerDelta } from '../DetailsResizer'

afterEach(cleanup)

describe('detailsWidthFromPointerDelta', () => {
  const base = {
    startWidth: 300,
    startClientX: 100,
    bounds: { min: 240, max: 560 }
  }

  it('uses the logical inline-start edge in LTR and RTL', () => {
    expect(
      detailsWidthFromPointerDelta({
        ...base,
        clientX: 140,
        direction: 'ltr'
      })
    ).toBe(260)
    expect(
      detailsWidthFromPointerDelta({
        ...base,
        clientX: 140,
        direction: 'rtl'
      })
    ).toBe(340)
  })

  it('clamps extreme pointer deltas', () => {
    expect(
      detailsWidthFromPointerDelta({
        ...base,
        clientX: -5000,
        direction: 'ltr'
      })
    ).toBe(560)
    expect(
      detailsWidthFromPointerDelta({
        ...base,
        clientX: 5000,
        direction: 'ltr'
      })
    ).toBe(240)
  })
})

describe('DetailsResizer', () => {
  it('renders a labelled, focusable value separator only while visible', () => {
    const { rerender } = render(
      <DetailsResizer
        visible
        width={300}
        direction="ltr"
        ariaLabel="Localized resize"
        onWidthChange={() => undefined}
        onReset={() => undefined}
      />
    )
    const separator = screen.getByRole('separator', { name: 'Localized resize' })
    expect(separator.getAttribute('tabindex')).toBe('0')
    expect(separator.getAttribute('aria-valuenow')).toBe('300')
    expect(separator.getAttribute('aria-valuemin')).toBe('240')
    expect(separator.getAttribute('aria-valuemax')).toBe('560')

    rerender(
      <DetailsResizer
        visible={false}
        width={300}
        direction="ltr"
        ariaLabel="Localized resize"
        onWidthChange={() => undefined}
        onReset={() => undefined}
      />
    )
    expect(screen.queryByRole('separator')).toBeNull()
  })

  it('supports direction-aware arrows plus Home, End, and reset', () => {
    const onWidthChange = vi.fn()
    const onReset = vi.fn()
    const { rerender } = render(
      <DetailsResizer
        visible
        width={300}
        direction="ltr"
        ariaLabel="Localized resize"
        onWidthChange={onWidthChange}
        onReset={onReset}
      />
    )
    let separator = screen.getByRole('separator', { name: 'Localized resize' })
    fireEvent.keyDown(separator, { key: 'ArrowRight' })
    expect(onWidthChange).toHaveBeenLastCalledWith(284)
    fireEvent.keyDown(separator, { key: 'ArrowLeft' })
    expect(onWidthChange).toHaveBeenLastCalledWith(316)
    fireEvent.keyDown(separator, { key: 'Home' })
    expect(onWidthChange).toHaveBeenLastCalledWith(240)
    fireEvent.keyDown(separator, { key: 'End' })
    expect(onWidthChange).toHaveBeenLastCalledWith(560)
    fireEvent.doubleClick(separator)
    expect(onReset).toHaveBeenCalledTimes(1)

    rerender(
      <DetailsResizer
        visible
        width={300}
        direction="rtl"
        ariaLabel="Localized resize"
        onWidthChange={onWidthChange}
        onReset={onReset}
      />
    )
    separator = screen.getByRole('separator', { name: 'Localized resize' })
    fireEvent.keyDown(separator, { key: 'ArrowRight' })
    expect(onWidthChange).toHaveBeenLastCalledWith(316)
  })

  it('applies RTL-aware pointer deltas through the shared resizer', () => {
    const onWidthChange = vi.fn()
    render(
      <DetailsResizer
        visible
        width={300}
        direction="rtl"
        ariaLabel="Localized resize"
        onWidthChange={onWidthChange}
        onReset={() => undefined}
      />
    )
    const separator = screen.getByRole('separator', { name: 'Localized resize' })
    fireEvent.pointerDown(separator, {
      button: 0,
      clientX: 100,
      pointerId: 1
    })
    fireEvent.pointerMove(separator, { clientX: 140, pointerId: 1 })
    expect(onWidthChange).toHaveBeenLastCalledWith(340)
    fireEvent.pointerUp(separator, { clientX: 140, pointerId: 1 })
  })
})
