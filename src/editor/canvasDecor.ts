// Canvas-decoration interactivity: one delegated tooltip for every SVG node
// the org renderer stamps with `data-org-tooltip` (missing-info badges,
// sub-process chips, …), a semantic element-ID fallback for ordinary BPMN
// shapes, plus click handling for the missing-info badge.
//
// It binds plain DOM listeners on the canvas container and uses only a tiny
// elementRegistry surface; there is no bpmn-js runtime import. Positioning uses
// getBoundingClientRect(), i.e. SCREEN coordinates that are already correct at
// any zoom/pan level — no viewbox math. Covered by Playwright e2e (the vitest
// suite runs in node without a DOM).

import { getLang } from '../i18n'
import {
  shapeSemanticForElement,
  type ShapeSemanticElementLike
} from '../org/shapeSemantics'

export const TOOLTIP_ATTR = 'data-org-tooltip'
export const MISSING_ATTR = 'data-org-missing'
export const BADGE_CLASS = 'orbitpm-missing-badge'
/** Class of the floating tooltip div (styled in app.css). */
export const TOOLTIP_CLASS = 'orbitpm-canvas-tooltip'

export interface CanvasDecorOptions {
  /** Missing-info badge clicked; caller selects the element + opens the dialog. */
  onBadgeClick?: (elementId: string, missing: string[]) => void
  /** Resolves a `.djs-element` ID for the semantic node-tooltip fallback. */
  elementRegistry?: {
    get(elementId: string): ShapeSemanticElementLike | undefined
  }
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

  const showFor = (anchor: Element, text: string): void => {
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

  const tooltipOf = (
    target: EventTarget | null
  ): { anchor: Element; text: string } | null => {
    const el = target as Element | null
    if (!el || typeof el.closest !== 'function') return null
    const explicit = el.closest('[' + TOOLTIP_ATTR + ']')
    if (explicit) {
      const text = explicit.getAttribute(TOOLTIP_ATTR)
      return text ? { anchor: explicit, text } : null
    }

    const shape = el.closest('.djs-element[data-element-id]')
    const elementId = shape?.getAttribute('data-element-id')
    if (!shape || !elementId) return null
    let diagramElement: ShapeSemanticElementLike | undefined
    try {
      diagramElement = options?.elementRegistry?.get(elementId)
    } catch {
      return null
    }
    const semantic = shapeSemanticForElement(diagramElement, getLang())
    return semantic ? { anchor: shape, text: semantic.explanation } : null
  }

  /**
   * diagram-js paints its transparent `.djs-hit` surface above the visual
   * group. Decorations that sit inside a shape (notably the sub-process chip)
   * therefore cannot become the pointer-event target themselves. Inspect the
   * complete hit stack at the pointer coordinate so their explicit semantic
   * tooltip still wins without disabling the shape's selection surface.
   */
  const explicitTooltipAtPoint = (
    x: number,
    y: number
  ): { anchor: Element; text: string } | null => {
    if (typeof document.elementsFromPoint !== 'function') return null
    for (const candidate of document.elementsFromPoint(x, y)) {
      if (!canvasContainer.contains(candidate)) continue
      const explicit = candidate.closest('[' + TOOLTIP_ATTR + ']')
      if (!explicit || !canvasContainer.contains(explicit)) continue
      const text = explicit.getAttribute(TOOLTIP_ATTR)
      if (text) return { anchor: explicit, text }
    }
    return null
  }

  const onPointerOver = (e: PointerEvent): void => {
    const tooltip = tooltipOf(e.target)
    if (!tooltip || tooltip.anchor === currentAnchor) return
    showFor(tooltip.anchor, tooltip.text)
  }

  const onPointerMove = (e: PointerEvent): void => {
    const tooltip =
      explicitTooltipAtPoint(e.clientX, e.clientY) ?? tooltipOf(e.target)
    if (!tooltip) {
      hide()
      return
    }
    if (tooltip.anchor !== currentAnchor) {
      showFor(tooltip.anchor, tooltip.text)
    }
  }

  const onPointerOut = (e: PointerEvent): void => {
    if (!currentAnchor) return
    const related = e.relatedTarget as Node | null
    if (related && currentAnchor.contains(related)) return
    if (tooltipOf(e.target)?.anchor !== currentAnchor) return
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
  canvasContainer.addEventListener('pointermove', onPointerMove)
  canvasContainer.addEventListener('pointerout', onPointerOut)
  canvasContainer.addEventListener('pointerdown', onPointerDown, { capture: true })
  canvasContainer.addEventListener('wheel', onWheel, { capture: true, passive: true })
  canvasContainer.addEventListener('click', onClick, { capture: true })
  window.addEventListener('blur', onWindowBlur)

  return () => {
    canvasContainer.removeEventListener('pointerover', onPointerOver)
    canvasContainer.removeEventListener('pointermove', onPointerMove)
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
