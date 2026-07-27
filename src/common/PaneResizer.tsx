// lite/src/common/PaneResizer.tsx — a keyboard-accessible vertical drag
// handle for resizing the app's side panes (left explorer, right properties
// pane). The drag math lives in PURE functions (`clampWidth` / `dragWidth`)
// with an explicit edge × direction matrix so the RTL cases are unit-testable
// in the node vitest environment (no jsdom); `usePaneWidth` adds localStorage
// persistence with every storage access guarded, so the hook also renders
// safely where storage does not exist. Visual styling beyond the structural
// minimum (hover accent, center line) belongs to `.orbitpm-lite-resizer` in
// app.css — only properties the handle cannot function without are inlined
// here, so the stylesheet keeps the last word on looks.

import {
  useCallback,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent
} from 'react'
import { t } from '../i18n'

// --- pure math ---------------------------------------------------------------

/**
 * Clamp a pane width into [min, max], rounded to whole pixels (keeps
 * persisted values clean). A NaN input falls back to `min`.
 */
export function clampWidth(w: number, min: number, max: number): number {
  const rounded = Math.round(w)
  if (Number.isNaN(rounded)) return min
  return Math.min(max, Math.max(min, rounded))
}

/**
 * The width a drag currently implies. `edge` is which INLINE edge of the
 * RESIZED pane the handle sits on; `dir` is the surrounding layout direction.
 * With Δ = clientX − startClientX:
 *   edge 'inline-end'   (left explorer):  ltr ⇒ start + Δ,  rtl ⇒ start − Δ
 *   edge 'inline-start' (right props):    ltr ⇒ start − Δ,  rtl ⇒ start + Δ
 * The result is clamped into [min, max].
 */
export function dragWidth(args: {
  startWidth: number
  startClientX: number
  clientX: number
  edge: 'inline-start' | 'inline-end'
  dir: 'ltr' | 'rtl'
  min: number
  max: number
}): number {
  const delta = args.clientX - args.startClientX
  const grows = (args.edge === 'inline-end') === (args.dir === 'ltr')
  return clampWidth(args.startWidth + (grows ? delta : -delta), args.min, args.max)
}

// --- persistence hook --------------------------------------------------------

function readStoredWidth(storageKey: string, min: number, max: number): number | null {
  try {
    if (typeof localStorage === 'undefined') return null
    const raw = localStorage.getItem(storageKey)
    if (raw == null || raw === '') return null
    const parsed = Number(raw)
    if (!Number.isFinite(parsed)) return null
    return clampWidth(parsed, min, max)
  } catch {
    return null
  }
}

/**
 * Controlled pane width with localStorage persistence. `null` means "no
 * stored value" — the caller falls back to its CSS default width. `set()`
 * clamps and persists; `reset()` clears the stored key back to `null`. All
 * storage access is try/catch-guarded (private modes, node tests).
 */
export function usePaneWidth(
  storageKey: string,
  opts: { min: number; max: number }
): [number | null, (w: number) => void, () => void] {
  const { min, max } = opts
  const [width, setWidth] = useState<number | null>(() => readStoredWidth(storageKey, min, max))

  const set = useCallback(
    (w: number): void => {
      const clamped = clampWidth(w, min, max)
      setWidth(clamped)
      try {
        if (typeof localStorage !== 'undefined') localStorage.setItem(storageKey, String(clamped))
      } catch {
        /* persistence is best-effort — the in-memory width still applies */
      }
    },
    [storageKey, min, max]
  )

  const reset = useCallback((): void => {
    setWidth(null)
    try {
      if (typeof localStorage !== 'undefined') localStorage.removeItem(storageKey)
    } catch {
      /* best-effort */
    }
  }, [storageKey])

  return [width, set, reset]
}

// --- the handle --------------------------------------------------------------

export interface PaneResizerProps {
  width: number
  min: number
  max: number
  /** Which inline edge of the RESIZED pane this handle sits on. */
  edge: 'inline-start' | 'inline-end'
  /** Surrounding layout direction (the editor island hardcodes 'ltr'). */
  dir: 'ltr' | 'rtl'
  onWidthChange: (w: number) => void
  /** Double-click / stored-width clear — caller pairs it with usePaneWidth's reset. */
  onReset: () => void
  ariaLabel: string
  /** false renders nothing (pane collapsed); default true. */
  visible?: boolean
}

/** Keyboard arrow step in px (direction-aware via dragWidth's synthetic Δ). */
const KEY_STEP = 16

/** Only what the handle cannot function without — looks live in app.css. */
const resizerStyle: CSSProperties = {
  flex: '0 0 6px',
  alignSelf: 'stretch',
  cursor: 'col-resize',
  touchAction: 'none'
}

export function PaneResizer(props: PaneResizerProps): JSX.Element | null {
  const { width, min, max, edge, dir, onWidthChange, onReset, ariaLabel, visible } = props
  const dragRef = useRef<{ startClientX: number; startWidth: number } | null>(null)

  if (visible === false) return null

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return
    e.preventDefault()
    dragRef.current = { startClientX: e.clientX, startWidth: width }
    const el = e.currentTarget
    try {
      el.setPointerCapture(e.pointerId)
    } catch {
      /* pointer capture unsupported — move/up on the handle still work */
    }
    el.classList.add('orbitpm-lite-resizer--dragging')
    try {
      document.body.style.userSelect = 'none'
    } catch {
      /* no document */
    }
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current
    if (!drag) return
    onWidthChange(
      dragWidth({
        startWidth: drag.startWidth,
        startClientX: drag.startClientX,
        clientX: e.clientX,
        edge,
        dir,
        min,
        max
      })
    )
  }

  const endDrag = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (!dragRef.current) return
    dragRef.current = null
    const el = e.currentTarget
    try {
      el.releasePointerCapture(e.pointerId)
    } catch {
      /* already released */
    }
    el.classList.remove('orbitpm-lite-resizer--dragging')
    try {
      document.body.style.userSelect = ''
    } catch {
      /* no document */
    }
  }

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault()
      // A synthetic Δ through dragWidth keeps the arrows direction-aware:
      // "right" always means "pointer moved right", whatever that does to
      // this pane's width in the current edge × dir configuration.
      onWidthChange(
        dragWidth({
          startWidth: width,
          startClientX: 0,
          clientX: e.key === 'ArrowRight' ? KEY_STEP : -KEY_STEP,
          edge,
          dir,
          min,
          max
        })
      )
    } else if (e.key === 'Home') {
      e.preventDefault()
      onWidthChange(min)
    } else if (e.key === 'End') {
      e.preventDefault()
      onWidthChange(max)
    } else if (e.key === 'Enter' || e.key === 'Escape') {
      e.currentTarget.blur()
    }
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={ariaLabel}
      aria-valuenow={width}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      title={t('pane.resize.hint')}
      className="orbitpm-lite-resizer"
      style={resizerStyle}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={onReset}
      onKeyDown={onKeyDown}
    />
  )
}

export default PaneResizer
