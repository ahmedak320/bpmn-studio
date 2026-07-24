// Canvas-decoration interactivity: one delegated tooltip for every SVG node
// the org renderer stamps with `data-org-tooltip` (missing-info badges,
// sub-process chips, …) plus click handling for the missing-info badge.
//
// Deliberately bpmn-js-free: it binds plain DOM listeners on the canvas
// container and reads only the attribute contract the renderer writes
// (TOOLTIP_ATTR / MISSING_ATTR / BADGE_CLASS — literals mirrored in
// org/orgRenderer.ts so org/ never has to import from editor/). Positioning
// uses getBoundingClientRect(), i.e. SCREEN coordinates that are already
// correct at any zoom/pan level — no viewbox math. Covered by Playwright e2e
// (the vitest suite runs in node without a DOM).

export const TOOLTIP_ATTR = 'data-org-tooltip'
export const MISSING_ATTR = 'data-org-missing'
export const BADGE_CLASS = 'orbitpm-missing-badge'
/** Class of the floating tooltip div (styled in app.css). */
export const TOOLTIP_CLASS = 'orbitpm-canvas-tooltip'

export interface CanvasDecorOptions {
  /** Missing-info badge clicked; caller selects the element + opens the dialog. */
  onBadgeClick?: (elementId: string, missing: string[]) => void
}

/**
 * Install the tooltip + badge-click behavior on a canvas container.
 * `tooltipHost` is the element the floating tooltip div is appended to (the
 * editor root). Returns an uninstall function — same convention as
 * installDragWatchdog.
 */
export function installCanvasDecor(
  canvasContainer: HTMLElement,
  tooltipHost: HTMLElement,
  options?: CanvasDecorOptions
): () => void {
  let tip: HTMLDivElement | null = null
  let currentAnchor: Element | null = null

  const ensureTip = (): HTMLDivElement => {
    if (tip && tip.isConnected) return tip
    const el = document.createElement('div')
    el.className = TOOLTIP_CLASS
    // Neutral direction so Arabic tooltip lines lay out correctly even though
    // the canvas itself is always LTR.
    el.setAttribute('dir', 'auto')
    el.setAttribute('role', 'tooltip')
    // Positioning-critical styles inline (the class provides the cosmetics):
    // fixed => viewport coords, matching getBoundingClientRect().
    el.style.position = 'fixed'
    el.style.pointerEvents = 'none'
    el.style.whiteSpace = 'pre-line'
    el.style.display = 'none'
    tooltipHost.appendChild(el)
    tip = el
    return el
  }

  const hide = (): void => {
    currentAnchor = null
    if (tip) tip.style.display = 'none'
  }

  const showFor = (anchor: Element): void => {
    const text = anchor.getAttribute(TOOLTIP_ATTR)
    if (!text) return
    const el = ensureTip()
    currentAnchor = anchor
    el.textContent = text
    // Park off-screen first so the measured size is the real rendered size.
    el.style.display = 'block'
    el.style.left = '-9999px'
    el.style.top = '0px'
    const tipRect = el.getBoundingClientRect()
    const rect = anchor.getBoundingClientRect()
    // Above-centred; flip below when clipped at the top; clamp horizontally.
    let top = rect.top - tipRect.height - 8
    if (top < 8) top = rect.bottom + 8
    const viewportW = document.documentElement.clientWidth
    let left = rect.left + rect.width / 2 - tipRect.width / 2
    left = Math.max(8, Math.min(left, viewportW - tipRect.width - 8))
    el.style.left = left + 'px'
    el.style.top = top + 'px'
  }

  const anchorOf = (target: EventTarget | null): Element | null => {
    const el = target as Element | null
    if (!el || typeof el.closest !== 'function') return null
    return el.closest('[' + TOOLTIP_ATTR + ']')
  }

  const onPointerOver = (e: PointerEvent): void => {
    const anchor = anchorOf(e.target)
    if (!anchor || anchor === currentAnchor) return
    showFor(anchor)
  }

  const onPointerOut = (e: PointerEvent): void => {
    if (!currentAnchor) return
    const related = e.relatedTarget as Node | null
    if (related && currentAnchor.contains(related)) return
    if (anchorOf(e.target) !== currentAnchor) return
    hide()
  }

  // Pan/zoom (and any press) invalidates the fixed-position tooltip: hide
  // immediately rather than track.
  const onPointerDown = (): void => hide()
  const onWheel = (): void => hide()
  const onWindowBlur = (): void => hide()

  const onClick = (e: MouseEvent): void => {
    const target = e.target as Element | null
    if (!target || typeof target.closest !== 'function') return
    const badge = target.closest('.' + BADGE_CLASS)
    if (!badge) return
    // Capture phase is REQUIRED here: diagram-js's own listeners sit on the
    // inner SVG (below this container in the tree), so a bubble-phase stop at
    // the container would run too late. The badge floats OUTSIDE its shape's
    // hit box, so without this stop the click would land on the canvas root
    // and deselect.
    e.stopPropagation()
    hide()
    const elementId = badge.closest('.djs-element')?.getAttribute('data-element-id') ?? ''
    const missing = (badge.getAttribute(MISSING_ATTR) ?? '').split(',').filter(Boolean)
    if (elementId) options?.onBadgeClick?.(elementId, missing)
  }

  canvasContainer.addEventListener('pointerover', onPointerOver)
  canvasContainer.addEventListener('pointerout', onPointerOut)
  canvasContainer.addEventListener('pointerdown', onPointerDown, { capture: true })
  canvasContainer.addEventListener('wheel', onWheel, { capture: true, passive: true })
  canvasContainer.addEventListener('click', onClick, { capture: true })
  window.addEventListener('blur', onWindowBlur)

  return () => {
    canvasContainer.removeEventListener('pointerover', onPointerOver)
    canvasContainer.removeEventListener('pointerout', onPointerOut)
    canvasContainer.removeEventListener('pointerdown', onPointerDown, { capture: true })
    canvasContainer.removeEventListener('wheel', onWheel, { capture: true })
    canvasContainer.removeEventListener('click', onClick, { capture: true })
    window.removeEventListener('blur', onWindowBlur)
    if (tip) {
      tip.remove()
      tip = null
    }
    currentAnchor = null
  }
}
