import { useCallback, useState } from 'react'
import { usePaneWidth } from '../../common/PaneResizer'

export const ARIS_RAIL_WIDTH_KEY = 'orbitpm.aris.detailsRailWidth'
export const ARIS_RAIL_COLLAPSED_KEY = 'orbitpm.aris.detailsRailCollapsed'
export const ARIS_RAIL_TAB_KEY = 'orbitpm.aris.railTab'
export const ARIS_RAIL_MIN_WIDTH = 260
export const ARIS_RAIL_MAX_WIDTH = 560
export const ARIS_RAIL_DEFAULT_WIDTH = 340

export type ArisRailTab = 'details' | 'tools'

export function readArisRailTab(): ArisRailTab {
  try {
    return typeof localStorage !== 'undefined' &&
      localStorage.getItem(ARIS_RAIL_TAB_KEY) === 'details'
      ? 'details'
      : 'tools'
  } catch {
    return 'tools'
  }
}

export function useArisRailTab(): readonly [ArisRailTab, (tab: ArisRailTab) => void] {
  const [tab, setTabState] = useState<ArisRailTab>(() => readArisRailTab())
  const setTab = useCallback((next: ArisRailTab): void => {
    setTabState(next)
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem(ARIS_RAIL_TAB_KEY, next)
    } catch {
      /* persistence is best-effort — the in-memory state still applies */
    }
  }, [])
  return [tab, setTab] as const
}

/** '1' means collapsed; anything else (or an unreadable store) means expanded. */
export function readArisRailCollapsed(): boolean {
  try {
    return (
      typeof localStorage !== 'undefined' && localStorage.getItem(ARIS_RAIL_COLLAPSED_KEY) === '1'
    )
  } catch {
    return false
  }
}

export interface ArisRailLayout {
  readonly collapsed: boolean
  readonly setCollapsed: (next: boolean) => void
  /** Concrete pixel width — the stored value or the default. */
  readonly width: number
  readonly setWidth: (width: number) => void
  readonly resetWidth: () => void
}

/** Collapse + width state for the studio details rail, persisted best-effort. */
export function useArisRailLayout(): ArisRailLayout {
  const [collapsed, setCollapsedState] = useState<boolean>(() => readArisRailCollapsed())
  const [storedWidth, setWidth, resetWidth] = usePaneWidth(ARIS_RAIL_WIDTH_KEY, {
    min: ARIS_RAIL_MIN_WIDTH,
    max: ARIS_RAIL_MAX_WIDTH
  })
  const setCollapsed = useCallback((next: boolean): void => {
    setCollapsedState(next)
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(ARIS_RAIL_COLLAPSED_KEY, next ? '1' : '0')
      }
    } catch {
      /* persistence is best-effort — the in-memory state still applies */
    }
  }, [])
  return {
    collapsed,
    setCollapsed,
    width: storedWidth ?? ARIS_RAIL_DEFAULT_WIDTH,
    setWidth,
    resetWidth
  }
}
