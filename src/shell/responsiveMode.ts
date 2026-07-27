import { useEffect, useState } from 'react'

export const RESPONSIVE_SHELL_BREAKPOINTS = Object.freeze({
  compactMax: 767,
  overlayMin: 768,
  overlayMax: 1199,
  dockedMin: 1200
})

export const RESPONSIVE_SHELL_MEDIA = Object.freeze({
  compact: `(max-width: ${RESPONSIVE_SHELL_BREAKPOINTS.compactMax}px)`,
  overlay: `(min-width: ${RESPONSIVE_SHELL_BREAKPOINTS.overlayMin}px) and (max-width: ${RESPONSIVE_SHELL_BREAKPOINTS.overlayMax}px)`,
  docked: `(min-width: ${RESPONSIVE_SHELL_BREAKPOINTS.dockedMin}px)`
})

export type ResponsiveShellMode = 'docked' | 'overlay' | 'compact'
export type ResponsivePane = 'explorer' | 'details'

export interface ResponsivePaneVisibility {
  explorerOpen: boolean
  detailsOpen: boolean
}

export function responsiveShellModeForWidth(width: number): ResponsiveShellMode {
  if (!Number.isFinite(width) || width < RESPONSIVE_SHELL_BREAKPOINTS.overlayMin) {
    return 'compact'
  }
  if (width >= RESPONSIVE_SHELL_BREAKPOINTS.dockedMin) return 'docked'
  return 'overlay'
}

/**
 * Opening either side pane outside docked mode closes the other pane.
 * Closing a pane never opens or closes its peer.
 */
export function withResponsivePaneVisibility(
  current: ResponsivePaneVisibility,
  pane: ResponsivePane,
  open: boolean,
  mode: ResponsiveShellMode
): ResponsivePaneVisibility {
  if (pane === 'explorer') {
    return {
      explorerOpen: open,
      detailsOpen: open && mode !== 'docked' ? false : current.detailsOpen
    }
  }
  return {
    explorerOpen: open && mode !== 'docked' ? false : current.explorerOpen,
    detailsOpen: open
  }
}

/**
 * A viewport can cross from docked mode while both panes are open. Resolve
 * that state immediately so an overlay never starts with two modal surfaces.
 */
export function reconcileResponsivePaneVisibility(
  current: ResponsivePaneVisibility,
  mode: ResponsiveShellMode,
  preferredPane: ResponsivePane = 'details'
): ResponsivePaneVisibility {
  if (mode === 'docked' || !current.explorerOpen || !current.detailsOpen) return current
  return preferredPane === 'details'
    ? { explorerOpen: false, detailsOpen: true }
    : { explorerOpen: true, detailsOpen: false }
}

function modeFromWindow(fallback: ResponsiveShellMode): ResponsiveShellMode {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return fallback
  if (window.matchMedia(RESPONSIVE_SHELL_MEDIA.docked).matches) return 'docked'
  if (window.matchMedia(RESPONSIVE_SHELL_MEDIA.compact).matches) return 'compact'
  return 'overlay'
}

export function useResponsiveShellMode(
  fallback: ResponsiveShellMode = 'docked'
): ResponsiveShellMode {
  const [mode, setMode] = useState<ResponsiveShellMode>(() => modeFromWindow(fallback))

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const compact = window.matchMedia(RESPONSIVE_SHELL_MEDIA.compact)
    const docked = window.matchMedia(RESPONSIVE_SHELL_MEDIA.docked)
    const update = (): void => {
      if (docked.matches) setMode('docked')
      else if (compact.matches) setMode('compact')
      else setMode('overlay')
    }

    update()
    compact.addEventListener('change', update)
    docked.addEventListener('change', update)
    return () => {
      compact.removeEventListener('change', update)
      docked.removeEventListener('change', update)
    }
  }, [])

  return mode
}
