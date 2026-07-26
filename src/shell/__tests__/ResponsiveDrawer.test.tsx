// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEffect, useRef, useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ResponsiveDrawer } from '../ResponsiveDrawer'
import type { ResponsiveShellMode } from '../responsiveMode'

afterEach(cleanup)

function DrawerHarness({
  mode,
  side = 'inline-end',
  keepMounted = false,
  onChildMount
}: {
  mode: ResponsiveShellMode
  side?: 'inline-start' | 'inline-end'
  keepMounted?: boolean
  onChildMount?: () => void
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const headingRef = useRef<HTMLHeadingElement | null>(null)
  return (
    <div>
      <button ref={triggerRef} type="button" onClick={() => setOpen(true)}>
        trigger
      </button>
      <ResponsiveDrawer
        open={open}
        mode={mode}
        side={side}
        id="responsive-drawer"
        label="Localized drawer"
        direction="rtl"
        onClose={() => setOpen(false)}
        initialFocusRef={headingRef}
        returnFocusRef={triggerRef}
        keepMounted={keepMounted}
      >
        <h2 ref={headingRef} tabIndex={-1}>
          heading
        </h2>
        <button type="button" onClick={() => setOpen(false)}>
          close
        </button>
        {onChildMount ? <MountProbe onMount={onChildMount} /> : null}
      </ResponsiveDrawer>
    </div>
  )
}

function MountProbe({ onMount }: { onMount: () => void }): JSX.Element {
  useEffect(() => {
    onMount()
  }, [onMount])
  return <span data-testid="persistent-child" />
}

describe('ResponsiveDrawer', () => {
  it('uses a non-modal complementary landmark when docked', () => {
    render(
      <ResponsiveDrawer
        open
        mode="docked"
        side="inline-start"
        id="explorer"
        label="Localized explorer"
        direction="ltr"
        onClose={() => undefined}
      >
        content
      </ResponsiveDrawer>
    )
    const pane = screen.getByRole('complementary', { name: 'Localized explorer' })
    expect(pane.id).toBe('explorer')
    expect(pane.getAttribute('data-side')).toBe('inline-start')
    expect(pane.getAttribute('aria-modal')).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('delegates overlay focus, Escape, inertness, and restoration to the shared dialog', async () => {
    const user = userEvent.setup()
    render(<DrawerHarness mode="overlay" />)
    const trigger = screen.getByRole('button', { name: 'trigger' })
    await user.click(trigger)

    const dialog = screen.getByRole('dialog', { name: 'Localized drawer' })
    const heading = screen.getByRole('heading', { name: 'heading' })
    expect(dialog.id).toBe('responsive-drawer')
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(dialog.getAttribute('dir')).toBe('rtl')
    expect(dialog.classList.contains('orbitpm-responsive-drawer--inline-end')).toBe(true)
    expect(document.activeElement).toBe(heading)
    expect(trigger.inert).toBe(true)

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Localized drawer' })).toBeNull()
    expect(trigger.inert).toBe(false)
    expect(document.activeElement).toBe(trigger)
  })

  it('marks phone drawers as compact and dismisses from the backdrop', async () => {
    const user = userEvent.setup()
    render(<DrawerHarness mode="compact" side="inline-start" />)
    await user.click(screen.getByRole('button', { name: 'trigger' }))

    const dialog = screen.getByRole('dialog', { name: 'Localized drawer' })
    expect(dialog.classList.contains('orbitpm-responsive-drawer--compact')).toBe(true)
    expect(dialog.classList.contains('orbitpm-responsive-drawer--inline-start')).toBe(true)
    fireEvent.mouseDown(document.querySelector('.orbitpm-responsive-drawer__backdrop')!)
    expect(screen.queryByRole('dialog', { name: 'Localized drawer' })).toBeNull()
  })

  it('renders no surface while closed', () => {
    const close = vi.fn()
    const { container } = render(
      <ResponsiveDrawer
        open={false}
        mode="compact"
        side="inline-end"
        id="details"
        label="Localized details"
        direction="ltr"
        onClose={close}
      >
        content
      </ResponsiveDrawer>
    )
    expect(container.innerHTML).toBe('')
    expect(close).not.toHaveBeenCalled()
  })

  it('can preserve externally-owned child DOM while the drawer closes and reopens', async () => {
    const user = userEvent.setup()
    const onChildMount = vi.fn()
    const { container } = render(
      <DrawerHarness mode="compact" keepMounted onChildMount={onChildMount} />
    )
    expect(onChildMount).toHaveBeenCalledTimes(1)
    expect(container.querySelector('#responsive-drawer')?.hasAttribute('hidden')).toBe(true)

    await user.click(screen.getByRole('button', { name: 'trigger' }))
    expect(screen.getByTestId('persistent-child')).not.toBeNull()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onChildMount).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: 'trigger' }))
    expect(onChildMount).toHaveBeenCalledTimes(1)
  })
})
