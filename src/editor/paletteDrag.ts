// Makes the bpmn-js draw palette (the `.djs-palette` element diagram-js
// creates inside the canvas container) draggable by a small grip bar at its
// bottom edge. diagram-js ships the palette pinned at a fixed `left: 20px;
// top: 20px` (see node_modules/diagram-js/assets/diagram-js.css) with no
// built-in way to move it; this module adds that, and remembers where the
// user left it across reloads.
//
// Two halves:
//  - Pure geometry/parsing helpers (clampPalettePos, parsePalettePos) with no
//    DOM dependency, exercised directly by src/__tests__/paletteDrag.test.ts
//    (which runs with environment: 'node', no jsdom — DOM code below is
//    intentionally untested there).
//  - installPaletteDrag, the DOM-wiring entry point the editor calls once per
//    modeler instance, after constructing it.
//
// Geometry note: diagram-js's Canvas creates a `.djs-container` wrapper
// (width/height 100%, no border/padding) as the direct child of whatever
// element is passed as bpmn-js's `container` option, and the palette is
// appended into THAT wrapper with `position: absolute`. Because the wrapper
// exactly fills the passed-in container with zero offset, treating pixel
// offsets as relative to the outer `canvasContainer` element (via
// getBoundingClientRect, which is always viewport-relative regardless of
// which ancestor is the CSS containing block) is equivalent to the palette's
// real CSS positioning context — see node_modules/diagram-js/lib/core/Canvas.js
// (createContainer) and .../lib/features/palette/Palette.js (_getParentContainer).

import { t } from '../i18n'

/** A palette position, in pixels, relative to the top-left corner of the
 *  canvas container that hosts it (NOT the viewport). */
export interface PalettePos {
  left: number
  top: number
}

/** The measurements clampPalettePos needs: container size (cw/ch) and
 *  palette size (pw/ph). Palette height in particular is NOT constant — it
 *  grows/shrinks with the entry count and one- vs two-column layout — so
 *  callers must re-measure on every drag step/resize rather than cache this. */
export interface PaletteBounds {
  cw: number
  ch: number
  pw: number
  ph: number
}

const STORAGE_KEY = 'orbitpm.lite.palettePos'
const GRIP_CLASS = 'orbitpm-palette-grip'
const DRAGGING_CLASS = 'orbitpm-palette-grip--dragging'
const PALETTE_SELECTOR = '.djs-palette'

/** Clamps a single axis so `value + paletteSize` never exceeds
 *  `containerSize` and `value` never goes negative. When the container
 *  itself is smaller than the palette on this axis (a narrow/short window)
 *  there is no valid non-negative placement, so the axis pins to 0 — the
 *  same edge the stylesheet default anchors to — rather than pushing the
 *  palette further off-screen with a negative offset. */
function clampAxis(value: number, containerSize: number, paletteSize: number): number {
  const max = containerSize - paletteSize
  if (max <= 0) return 0
  if (value < 0) return 0
  if (value > max) return max
  return value
}

/** Clamps a candidate palette position so it stays fully inside its
 *  container on both axes: left in [0, cw-pw], top in [0, ch-ph], pinned to 0
 *  on an axis where the container is smaller than the palette. Pure and
 *  side-effect-free — safe to call on every pointermove/resize without
 *  touching the DOM. */
export function clampPalettePos(pos: PalettePos, bounds: PaletteBounds): PalettePos {
  return {
    left: clampAxis(pos.left, bounds.cw, bounds.pw),
    top: clampAxis(pos.top, bounds.ch, bounds.ph)
  }
}

/** Parses the JSON persisted under STORAGE_KEY. Returns null for anything
 *  that isn't a `{left: number, top: number}` object with finite numbers —
 *  hand-edited localStorage, a future/foreign payload shape, or plain
 *  corruption — so callers can fall back to the stylesheet default instead of
 *  crashing or placing the palette at NaN/Infinity coordinates. Deliberately
 *  does NOT clamp: that is installPaletteDrag's job, done against the live
 *  container/palette size at restore time. */
export function parsePalettePos(raw: string | null): PalettePos | null {
  if (!raw) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  // typeof null === 'object' is the classic JS quirk — the explicit
  // `parsed === null` check is what actually excludes it here.
  if (typeof parsed !== 'object' || parsed === null) return null
  const { left, top } = parsed as Record<string, unknown>
  if (typeof left !== 'number' || typeof top !== 'number') return null
  if (!Number.isFinite(left) || !Number.isFinite(top)) return null
  return { left, top }
}

function readStoredPos(): PalettePos | null {
  try {
    return parsePalettePos(localStorage.getItem(STORAGE_KEY))
  } catch {
    // Storage may be unavailable (private browsing, disabled cookies, etc.);
    // the palette just starts at its default position for this session.
    return null
  }
}

function writeStoredPos(pos: PalettePos): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(pos))
  } catch {
    /* position just won't survive a reload; dragging still works this session */
  }
}

function clearStoredPos(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* nothing to reconcile if storage was never reachable */
  }
}

/** Bounds derived from the CURRENT layout — see PaletteBounds for why this is
 *  re-read on every drag step/resize rather than cached once. */
function readBounds(canvasContainer: HTMLElement, palette: HTMLElement): PaletteBounds {
  const containerRect = canvasContainer.getBoundingClientRect()
  const paletteRect = palette.getBoundingClientRect()
  return {
    cw: containerRect.width,
    ch: containerRect.height,
    pw: paletteRect.width,
    ph: paletteRect.height
  }
}

/** Writes a (caller-clamped) position as inline styles. `right` is force-set
 *  to `auto` alongside `left` so no stylesheet rule — present or future —
 *  can anchor the palette from the right and fight the explicit `left`. */
function setPaletteInlinePosition(palette: HTMLElement, pos: PalettePos): void {
  palette.style.left = `${pos.left}px`
  palette.style.top = `${pos.top}px`
  palette.style.right = 'auto'
}

/** Undoes setPaletteInlinePosition, restoring the stylesheet's default
 *  `left: 20px; top: 20px` (diagram-js.css) by REMOVING our overrides rather
 *  than hardcoding that value here — if the upstream default ever changes,
 *  reset keeps tracking it for free. */
function clearPaletteInlinePosition(palette: HTMLElement): void {
  palette.style.removeProperty('left')
  palette.style.removeProperty('top')
  palette.style.removeProperty('right')
}

/** Wires the grip + drag/persist/reset behavior onto an already-existing
 *  `.djs-palette` element. Returns an uninstaller. Split out of
 *  installPaletteDrag so that function can call this either immediately (the
 *  common case — bpmn-js builds the palette synchronously during Modeler
 *  construction, so it is normally already there) or later, once a
 *  MutationObserver sees the palette appear. */
function wirePalette(palette: HTMLElement, canvasContainer: HTMLElement): () => void {
  const grip = document.createElement('div')
  grip.className = GRIP_CLASS
  grip.title = t('palette.grip.title')
  // Appended as the LAST child — after .djs-palette-entries and the
  // .djs-palette-toggle collapse button. bpmn-js re-renders only the entries
  // container's contents on palette updates, so a sibling appended here is
  // never touched/removed by those re-renders.
  palette.appendChild(grip)

  // Restore any position saved from a previous session, clamped against the
  // palette's real (just-measured) size in case the window shrank since.
  const stored = readStoredPos()
  if (stored) {
    setPaletteInlinePosition(palette, clampPalettePos(stored, readBounds(canvasContainer, palette)))
  }

  // Tracks an in-progress drag: which pointer started it, and where the
  // palette and pointer both were at pointerdown, so every pointermove can
  // compute an absolute new position from one delta (rather than integrating
  // relative deltas step to step, which would drift if a move event were
  // ever coalesced/skipped).
  let drag: {
    pointerId: number
    startLeft: number
    startTop: number
    startX: number
    startY: number
  } | null = null

  const onPointerDown = (event: PointerEvent): void => {
    if (drag) return // a second simultaneous pointer (e.g. multi-touch) never hijacks an active drag
    if (event.button !== 0) return // primary button only — right/middle-click pass through untouched

    const containerRect = canvasContainer.getBoundingClientRect()
    const paletteRect = palette.getBoundingClientRect()
    drag = {
      pointerId: event.pointerId,
      startLeft: paletteRect.left - containerRect.left,
      startTop: paletteRect.top - containerRect.top,
      startX: event.clientX,
      startY: event.clientY
    }
    grip.classList.add(DRAGGING_CLASS)
    // Pointer capture guarantees this grip keeps receiving move/up events for
    // this pointer even if it leaves the grip/palette/window mid-drag — the
    // drag can never get "stuck" waiting for an event that never arrives.
    grip.setPointerCapture(event.pointerId)
    event.preventDefault()
    event.stopPropagation()
  }

  const onPointerMove = (event: PointerEvent): void => {
    if (!drag || event.pointerId !== drag.pointerId) return
    const dx = event.clientX - drag.startX
    const dy = event.clientY - drag.startY
    // Re-measured on every move (not cached from pointerdown): the palette
    // can change height mid-drag (e.g. a two-column reflow), and the
    // container can be mid-resize too.
    const next = clampPalettePos(
      { left: drag.startLeft + dx, top: drag.startTop + dy },
      readBounds(canvasContainer, palette)
    )
    setPaletteInlinePosition(palette, next)
    event.preventDefault()
    event.stopPropagation()
  }

  const endDrag = (event: PointerEvent): void => {
    if (!drag || event.pointerId !== drag.pointerId) return
    grip.classList.remove(DRAGGING_CLASS)
    if (grip.hasPointerCapture(event.pointerId)) {
      grip.releasePointerCapture(event.pointerId)
    }
    // Persist whatever is actually on screen (read back the inline style we
    // just wrote) rather than recomputing from the event, so storage can
    // never drift from what the user sees. A pointerdown/up with no move in
    // between never set an inline position (style.left is still ''), so
    // parseFloat yields NaN and there is correctly nothing new to save.
    const left = parseFloat(palette.style.left)
    const top = parseFloat(palette.style.top)
    if (Number.isFinite(left) && Number.isFinite(top)) {
      writeStoredPos({ left, top })
    }
    drag = null
    event.preventDefault()
    event.stopPropagation()
  }

  const onDoubleClick = (event: MouseEvent): void => {
    drag = null
    grip.classList.remove(DRAGGING_CLASS)
    clearStoredPos()
    clearPaletteInlinePosition(palette)
    event.preventDefault()
    event.stopPropagation()
  }

  grip.addEventListener('pointerdown', onPointerDown)
  grip.addEventListener('pointermove', onPointerMove)
  grip.addEventListener('pointerup', endDrag)
  grip.addEventListener('pointercancel', endDrag)
  grip.addEventListener('dblclick', onDoubleClick)

  // The container resizes with the window/sidebar, and the palette itself
  // resizes when its entry count/column layout changes — either can leave a
  // previously-valid position hanging partly outside the (now smaller)
  // container, so re-clamp whenever the container's box changes. An
  // untouched palette (no inline `left` yet — still on the stylesheet
  // default) is deliberately left alone so it keeps tracking that default
  // instead of being pinned to an inline 0,0.
  let resizeObserver: ResizeObserver | undefined
  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => {
      if (palette.style.left === '') return
      const current: PalettePos = {
        left: parseFloat(palette.style.left) || 0,
        top: parseFloat(palette.style.top) || 0
      }
      const next = clampPalettePos(current, readBounds(canvasContainer, palette))
      if (next.left !== current.left || next.top !== current.top) {
        setPaletteInlinePosition(palette, next)
      }
    })
    resizeObserver.observe(canvasContainer)
  }

  return () => {
    grip.removeEventListener('pointerdown', onPointerDown)
    grip.removeEventListener('pointermove', onPointerMove)
    grip.removeEventListener('pointerup', endDrag)
    grip.removeEventListener('pointercancel', endDrag)
    grip.removeEventListener('dblclick', onDoubleClick)
    resizeObserver?.disconnect()
    grip.remove()
  }
}

/** Installs the drag grip on the bpmn-js palette hosted inside
 *  `canvasContainer` (the same element passed as bpmn-js's `container`
 *  option) and wires up drag-to-move + double-click-to-reset + persistence.
 *
 *  bpmn-js builds `.djs-palette` synchronously while constructing the
 *  Modeler, so in practice it already exists by the time the editor calls
 *  this — but nothing in the public API guarantees that ordering, so this
 *  also tolerates being called first: it watches the container with a
 *  MutationObserver and wires the grip the moment the palette shows up.
 *
 *  Returns an uninstaller safe to call at any point in that lifecycle
 *  (before the palette ever appeared, mid-drag, or long after a clean
 *  install, and safe to call more than once) — it always leaves no
 *  observers, listeners, or grip DOM behind. */
export function installPaletteDrag(canvasContainer: HTMLElement): () => void {
  let disposed = false
  let uninstallPalette: (() => void) | null = null

  const existing = canvasContainer.querySelector<HTMLElement>(PALETTE_SELECTOR)
  if (existing) {
    uninstallPalette = wirePalette(existing, canvasContainer)
  }

  let observer: MutationObserver | undefined
  if (!existing) {
    observer = new MutationObserver(() => {
      if (disposed) return
      const palette = canvasContainer.querySelector<HTMLElement>(PALETTE_SELECTOR)
      if (!palette) return
      uninstallPalette = wirePalette(palette, canvasContainer)
      // The palette only needs to be caught appearing once; stop watching so
      // the (much more frequent) diagram-rendering mutations inside the
      // container don't keep invoking this callback for nothing.
      observer?.disconnect()
      observer = undefined
    })
    observer.observe(canvasContainer, { childList: true, subtree: true })
  }

  return () => {
    if (disposed) return
    disposed = true
    observer?.disconnect()
    observer = undefined
    uninstallPalette?.()
    uninstallPalette = null
  }
}
