// @vitest-environment jsdom

import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  RESPONSIVE_SHELL_MEDIA,
  reconcileResponsivePaneVisibility,
  responsiveShellModeForWidth,
  useResponsiveShellMode,
  withResponsivePaneVisibility
} from '../responsiveMode'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('responsiveShellModeForWidth', () => {
  it('uses the exact compact, overlay, and docked boundaries', () => {
    expect(responsiveShellModeForWidth(320)).toBe('compact')
    expect(responsiveShellModeForWidth(767)).toBe('compact')
    expect(responsiveShellModeForWidth(768)).toBe('overlay')
    expect(responsiveShellModeForWidth(1199)).toBe('overlay')
    expect(responsiveShellModeForWidth(1200)).toBe('docked')
    expect(responsiveShellModeForWidth(1920)).toBe('docked')
  })

  it('fails safely to compact for an invalid viewport width', () => {
    expect(responsiveShellModeForWidth(Number.NaN)).toBe('compact')
    expect(responsiveShellModeForWidth(-1)).toBe('compact')
  })
})

describe('responsive pane coordination', () => {
  const bothClosed = { explorerOpen: false, detailsOpen: false }

  it('allows both panes to remain docked', () => {
    const explorer = withResponsivePaneVisibility(bothClosed, 'explorer', true, 'docked')
    expect(withResponsivePaneVisibility(explorer, 'details', true, 'docked')).toEqual({
      explorerOpen: true,
      detailsOpen: true
    })
  })

  it.each(['overlay', 'compact'] as const)(
    'closes the peer when a pane opens in %s mode',
    (mode) => {
      expect(
        withResponsivePaneVisibility(
          { explorerOpen: true, detailsOpen: false },
          'details',
          true,
          mode
        )
      ).toEqual({ explorerOpen: false, detailsOpen: true })
      expect(
        withResponsivePaneVisibility(
          { explorerOpen: false, detailsOpen: true },
          'explorer',
          true,
          mode
        )
      ).toEqual({ explorerOpen: true, detailsOpen: false })
    }
  )

  it('does not disturb the peer when closing a pane', () => {
    expect(
      withResponsivePaneVisibility(
        { explorerOpen: true, detailsOpen: true },
        'details',
        false,
        'overlay'
      )
    ).toEqual({ explorerOpen: true, detailsOpen: false })
  })

  it('reconciles two docked panes when the viewport becomes an overlay', () => {
    const bothOpen = { explorerOpen: true, detailsOpen: true }
    expect(reconcileResponsivePaneVisibility(bothOpen, 'overlay')).toEqual({
      explorerOpen: false,
      detailsOpen: true
    })
    expect(reconcileResponsivePaneVisibility(bothOpen, 'compact', 'explorer')).toEqual({
      explorerOpen: true,
      detailsOpen: false
    })
    expect(reconcileResponsivePaneVisibility(bothOpen, 'docked')).toBe(bothOpen)
  })
})

class FakeMediaQueryList {
  readonly media: string
  matches: boolean
  private readonly listeners = new Set<() => void>()

  constructor(media: string, matches: boolean) {
    this.media = media
    this.matches = matches
  }

  addEventListener(_type: 'change', listener: () => void): void {
    this.listeners.add(listener)
  }

  removeEventListener(_type: 'change', listener: () => void): void {
    this.listeners.delete(listener)
  }

  setMatches(matches: boolean): void {
    this.matches = matches
    for (const listener of this.listeners) listener()
  }
}

function ModeProbe(): JSX.Element {
  return <output>{useResponsiveShellMode('docked')}</output>
}

describe('useResponsiveShellMode', () => {
  it('tracks media-query changes without relying on a reload', () => {
    const compact = new FakeMediaQueryList(RESPONSIVE_SHELL_MEDIA.compact, false)
    const docked = new FakeMediaQueryList(RESPONSIVE_SHELL_MEDIA.docked, false)
    vi.spyOn(window, 'matchMedia').mockImplementation((query) => {
      if (query === RESPONSIVE_SHELL_MEDIA.compact) {
        return compact as unknown as MediaQueryList
      }
      return docked as unknown as MediaQueryList
    })

    render(<ModeProbe />)
    expect(screen.getByText('overlay')).not.toBeNull()

    act(() => compact.setMatches(true))
    expect(screen.getByText('compact')).not.toBeNull()

    act(() => {
      compact.setMatches(false)
      docked.setMatches(true)
    })
    expect(screen.getByText('docked')).not.toBeNull()
  })
})
