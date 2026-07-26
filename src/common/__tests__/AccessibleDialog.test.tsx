// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRef, useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { AccessibleDialog } from '../AccessibleDialog'

afterEach(cleanup)

function Harness({
  closeOnBackdrop = true,
  closeOnEscape = true
}: {
  closeOnBackdrop?: boolean
  closeOnEscape?: boolean
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const initialFocusRef = useRef<HTMLButtonElement | null>(null)
  return (
    <div data-testid="application">
      <button type="button" onClick={() => setOpen(true)}>
        Open dialog
      </button>
      {open ? (
        <AccessibleDialog
          ariaLabel="Example dialog"
          onClose={() => setOpen(false)}
          closeOnBackdrop={closeOnBackdrop}
          closeOnEscape={closeOnEscape}
          initialFocusRef={initialFocusRef}
          backdropClassName="backdrop"
        >
          <button ref={initialFocusRef} type="button">
            First action
          </button>
          <button type="button">Last action</button>
        </AccessibleDialog>
      ) : null}
    </div>
  )
}

function NestedHarness(): JSX.Element {
  const [outerOpen, setOuterOpen] = useState(true)
  const [innerOpen, setInnerOpen] = useState(false)
  return outerOpen ? (
    <AccessibleDialog ariaLabel="Outer dialog" onClose={() => setOuterOpen(false)}>
      <button type="button" onClick={() => setInnerOpen(true)}>
        Open inner
      </button>
      {innerOpen ? (
        <AccessibleDialog ariaLabel="Inner dialog" onClose={() => setInnerOpen(false)}>
          <button type="button">Inner action</button>
        </AccessibleDialog>
      ) : null}
    </AccessibleDialog>
  ) : (
    <p>Closed</p>
  )
}

describe('AccessibleDialog', () => {
  it('inerts the outside branch, contains Tab, and restores trigger focus on Escape', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const trigger = screen.getByRole('button', { name: 'Open dialog' })
    await user.click(trigger)

    const dialog = screen.getByRole('dialog', { name: 'Example dialog' })
    const first = screen.getByRole('button', { name: 'First action' })
    const last = screen.getByRole('button', { name: 'Last action' })
    expect(document.activeElement).toBe(first)
    expect(trigger.inert).toBe(true)

    last.focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement).toBe(first)
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(last)

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(dialog.isConnected).toBe(false)
    expect(trigger.inert).toBe(false)
    expect(document.activeElement).toBe(trigger)
  })

  it('dismisses only from an enabled topmost backdrop', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<Harness closeOnBackdrop={false} />)
    await user.click(screen.getByRole('button', { name: 'Open dialog' }))
    fireEvent.mouseDown(document.querySelector('.backdrop')!)
    expect(screen.getByRole('dialog', { name: 'Example dialog' })).not.toBeNull()

    rerender(<Harness closeOnBackdrop />)
    fireEvent.mouseDown(screen.getByRole('dialog', { name: 'Example dialog' }))
    expect(screen.getByRole('dialog', { name: 'Example dialog' })).not.toBeNull()
    fireEvent.mouseDown(document.querySelector('.backdrop')!)
    expect(screen.queryByRole('dialog', { name: 'Example dialog' })).toBeNull()
  })

  it('supports non-dismissible alert dialogs', () => {
    const close = vi.fn()
    render(
      <AccessibleDialog
        role="alertdialog"
        ariaLabel="Decision required"
        onClose={close}
        closeOnEscape={false}
      >
        <button type="button">Decide</button>
      </AccessibleDialog>
    )
    expect(screen.getByRole('alertdialog', { name: 'Decision required' })).not.toBeNull()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(close).not.toHaveBeenCalled()
  })

  it('gives Escape and focus ownership to the topmost nested dialog', async () => {
    const user = userEvent.setup()
    render(<NestedHarness />)
    await user.click(screen.getByRole('button', { name: 'Open inner' }))
    expect(screen.getByRole('dialog', { name: 'Inner dialog' })).not.toBeNull()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Inner dialog' })).toBeNull()
    expect(screen.getByRole('dialog', { name: 'Outer dialog' })).not.toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Open inner' }))

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Outer dialog' })).toBeNull()
  })
})
