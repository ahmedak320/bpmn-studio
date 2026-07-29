/**
 * Fit-to-viewport that fits the **content** — Plan Section 11.1, Section 19.4.
 *
 * diagram-js's own `canvas.zoom('fit-viewport')` fits the active layer's SVG
 * bounding box, which is every rendered node without distinction: a decorative
 * lane band that reaches past the diagram drags the whole fit out with it. On
 * the AnimalWF export that put the zoom at 0.015 and rendered the median symbol
 * about two CSS pixels tall — the diagram was on screen, and unreadable.
 *
 * So the fit is computed here instead, from the elements that carry meaning:
 * occurrences, free text, external captions and connection routes. Frames are
 * excluded by construction, which makes the readable size a function of the
 * content alone and independent of how large a band happens to be.
 *
 * The maths is deliberately pure and exported (`arisContentBounds`,
 * `arisFitViewbox`) so the resulting scale — and therefore the on-screen size
 * of a symbol — can be asserted in a unit test rather than eyeballed.
 */

import type Canvas from 'diagram-js/lib/core/Canvas'
import type ElementRegistry from 'diagram-js/lib/core/ElementRegistry'
import type { Element } from 'diagram-js/lib/model/Types'

import { arisBusinessObject } from './elements'

export interface ArisFitRect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface ArisFitSize {
  readonly width: number
  readonly height: number
}

/** Breathing room around the content, as a fraction of the content's extent. */
export const ARIS_FIT_PADDING_RATIO = 0.02

/**
 * The fit never zooms in past 1:1, matching diagram-js's own ceiling. A tiny
 * model is shown at its natural size rather than blown up to fill the screen.
 */
export const ARIS_MAX_FIT_SCALE = 1

/** Guards against a zero-extent content box dividing the scale by zero. */
const MIN_FIT_EXTENT = 1

interface PointLike {
  readonly x: number
  readonly y: number
}

interface ElementGeometry {
  readonly x?: number
  readonly y?: number
  readonly width?: number
  readonly height?: number
  readonly waypoints?: readonly PointLike[]
}

/**
 * Does this element define what "the diagram" is?
 *
 * Occurrences, free text, external captions and connections do. The model root
 * and lane bands do not: a band is derived decoration, and letting it drive the
 * fit is exactly the defect this module exists to prevent.
 */
export function isArisContentElement(element: Element): boolean {
  if ((element as { isFrame?: boolean }).isFrame === true) return false
  const businessObject = arisBusinessObject(element)
  if (!businessObject) return false
  return (
    businessObject.kind === 'occurrence' ||
    businessObject.kind === 'freeText' ||
    businessObject.kind === 'label' ||
    businessObject.kind === 'connection'
  )
}

/** The union of every content element's extent, or `null` when there is none. */
export function arisContentBounds(elements: readonly Element[]): ArisFitRect | null {
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  const grow = (x: number, y: number): void => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
  }

  for (const element of elements) {
    if (!isArisContentElement(element)) continue
    const geometry = element as ElementGeometry
    if (geometry.waypoints) {
      for (const point of geometry.waypoints) grow(point.x, point.y)
      continue
    }
    const { x, y } = geometry
    if (typeof x !== 'number' || typeof y !== 'number') continue
    const width = typeof geometry.width === 'number' ? geometry.width : 0
    const height = typeof geometry.height === 'number' ? geometry.height : 0
    grow(x, y)
    grow(x + width, y + height)
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null
  return Object.freeze({ x: minX, y: minY, width: maxX - minX, height: maxY - minY })
}

/**
 * The viewbox that shows `content` centred in an `outer`-sized viewport.
 *
 * diagram-js derives the scale from a viewbox as
 * `min(outer.width / box.width, outer.height / box.height)`, so capping the
 * scale means widening the box rather than post-processing the zoom.
 */
export function arisFitViewbox(
  content: ArisFitRect,
  outer: ArisFitSize,
  options: { readonly paddingRatio?: number; readonly maxScale?: number } = {}
): ArisFitRect {
  const paddingRatio = options.paddingRatio ?? ARIS_FIT_PADDING_RATIO
  const maxScale = options.maxScale ?? ARIS_MAX_FIT_SCALE
  const centerX = content.x + content.width / 2
  const centerY = content.y + content.height / 2

  let width = Math.max(content.width * (1 + 2 * paddingRatio), MIN_FIT_EXTENT)
  let height = Math.max(content.height * (1 + 2 * paddingRatio), MIN_FIT_EXTENT)

  const scale = Math.min(outer.width / width, outer.height / height)
  if (Number.isFinite(scale) && scale > maxScale) {
    width = outer.width / maxScale
    height = outer.height / maxScale
  }

  return Object.freeze({
    x: centerX - width / 2,
    y: centerY - height / 2,
    width,
    height
  })
}

/**
 * Fit the canvas viewport to its content and return the resulting scale.
 *
 * Falls back to diagram-js's own fit when there is nothing to fit or the
 * container has no measurable size, so an empty canvas still behaves.
 */
export function fitCanvasToContent(canvas: Canvas, elementRegistry: ElementRegistry): number {
  const content = arisContentBounds(elementRegistry.getAll() as Element[])
  const outer = canvas.viewbox().outer
  if (!content || !(outer.width > 0) || !(outer.height > 0)) {
    return canvas.zoom('fit-viewport')
  }
  // `viewbox(box)` resets the cached viewbox, so the next read reports the
  // scale diagram-js actually applied rather than the one asked for.
  canvas.viewbox({ ...arisFitViewbox(content, outer) })
  return canvas.viewbox().scale
}
