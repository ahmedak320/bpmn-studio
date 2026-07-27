// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DetailsRail, type DetailsRailInput } from '../DetailsRail'

afterEach(cleanup)

function RailHarness({
  direction = 'ltr',
  onChange,
  onPaneFocus,
  onToggleFocus
}: {
  direction?: 'ltr' | 'rtl'
  onChange?: (open: boolean, input: DetailsRailInput) => void
  onPaneFocus?: () => void
  onToggleFocus?: (toggle: HTMLButtonElement) => void
}): JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <DetailsRail
      open={open}
      controlsId="details-pane"
      label="Localized details"
      title="Localized details title"
      direction={direction}
      onOpenChange={(next, input) => {
        setOpen(next)
        onChange?.(next, input)
      }}
      onRequestPaneFocus={onPaneFocus}
      onRequestToggleFocus={onToggleFocus}
    />
  )
}

describe('DetailsRail', () => {
  it('renders one localized native toggle with the disclosure relationship', () => {
    render(<RailHarness direction="rtl" />)
    const button = screen.getByRole('button', { name: 'Localized details' })
    expect(button.tagName).toBe('BUTTON')
    expect(button.getAttribute('type')).toBe('button')
    expect(button.getAttribute('title')).toBe('Localized details title')
    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(button.getAttribute('aria-controls')).toBe('details-pane')
    expect(button.closest('.orbitpm-details-rail')?.getAttribute('dir')).toBe('rtl')
    expect(button.querySelector('[aria-hidden="true"]')?.textContent).toBe('‹')
  })

  it('uses native Enter and Space activation and requests focus at the right transitions', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const onPaneFocus = vi.fn()
    const onToggleFocus = vi.fn()
    render(
      <RailHarness onChange={onChange} onPaneFocus={onPaneFocus} onToggleFocus={onToggleFocus} />
    )
    const button = screen.getByRole('button', { name: 'Localized details' })
    button.focus()

    await user.keyboard('{Enter}')
    expect(button.getAttribute('aria-expanded')).toBe('true')
    expect(onChange).toHaveBeenLastCalledWith(true, 'keyboard')
    expect(onPaneFocus).toHaveBeenCalledTimes(1)

    await user.keyboard(' ')
    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(onChange).toHaveBeenLastCalledWith(false, 'keyboard')
    expect(onToggleFocus).toHaveBeenCalledWith(button)
  })

  it('does not request pane focus for a pointer expansion', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const onPaneFocus = vi.fn()
    render(<RailHarness onChange={onChange} onPaneFocus={onPaneFocus} />)

    await user.click(screen.getByRole('button', { name: 'Localized details' }))
    expect(onChange).toHaveBeenLastCalledWith(true, 'pointer')
    expect(onPaneFocus).not.toHaveBeenCalled()
  })
})
