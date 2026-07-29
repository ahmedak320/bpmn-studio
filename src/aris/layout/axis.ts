/**
 * Orientation abstraction (plan §14.4 step 5) and minimal label reservation
 * (step 11).
 *
 * The whole placement engine works in *flow space*: `along` runs with the
 * control flow and `cross` runs perpendicular to it. A single conversion at
 * the very end turns flow space into screen space, so top-to-bottom and
 * left-to-right models share one code path and one set of tests.
 */

import type {
  ArisLayoutLabelBox,
  ArisLayoutNodeInput,
  ArisLayoutOrientation,
  ArisLayoutPoint,
  ArisLayoutRect
} from './types'
import { LAYOUT_EPSILON } from './geometry'

/**
 * The space one node occupies in flow space, caption included.
 *
 * A caption that fits inside the shape reserves nothing at all; that is what
 * "reserve labels minimally" means. Only an overflowing caption extends the
 * occupied box, and only on the screen-downward side of the shape.
 */
export interface OccupiedBox {
  /** Extent along the flow axis, caption included. */
  readonly along: number
  /** Extent across the flow axis, caption included. */
  readonly cross: number
  /** Shape centre relative to the occupied-box centre. */
  readonly nodeAlongOffset: number
  readonly nodeCrossOffset: number
  /** Caption centre relative to the occupied-box centre, or `null`. */
  readonly labelAlongOffset: number | null
  readonly labelCrossOffset: number | null
  readonly labelAlong: number
  readonly labelCross: number
}

export function labelFitsInside(
  size: { width: number; height: number },
  label?: ArisLayoutLabelBox
): boolean {
  if (!label) return true
  return label.width <= size.width + LAYOUT_EPSILON && label.height <= size.height + LAYOUT_EPSILON
}

/** Compute the occupied box of one node for a given orientation. */
export function occupiedBoxOf(
  node: ArisLayoutNodeInput,
  orientation: ArisLayoutOrientation,
  labelGap: number
): OccupiedBox {
  const shapeAlong = orientation === 'top-to-bottom' ? node.size.height : node.size.width
  const shapeCross = orientation === 'top-to-bottom' ? node.size.width : node.size.height
  if (labelFitsInside(node.size, node.label)) {
    return {
      along: shapeAlong,
      cross: shapeCross,
      nodeAlongOffset: 0,
      nodeCrossOffset: 0,
      labelAlongOffset: null,
      labelCrossOffset: null,
      labelAlong: 0,
      labelCross: 0
    }
  }
  const label = node.label as ArisLayoutLabelBox
  // The caption is always reserved on the screen-downward side of the shape.
  // For top-to-bottom that is the `along` axis; for left-to-right it is `cross`.
  if (orientation === 'top-to-bottom') {
    const along = shapeAlong + labelGap + label.height
    const cross = Math.max(shapeCross, label.width)
    return {
      along,
      cross,
      nodeAlongOffset: -(labelGap + label.height) / 2,
      nodeCrossOffset: 0,
      labelAlongOffset: (shapeAlong + labelGap) / 2,
      labelCrossOffset: 0,
      labelAlong: label.height,
      labelCross: label.width
    }
  }
  const cross = shapeCross + labelGap + label.height
  const along = Math.max(shapeAlong, label.width)
  return {
    along,
    cross,
    nodeAlongOffset: 0,
    nodeCrossOffset: -(labelGap + label.height) / 2,
    labelAlongOffset: 0,
    labelCrossOffset: (shapeCross + labelGap) / 2,
    labelAlong: label.width,
    labelCross: label.height
  }
}

/** Flow space -> screen space for a point. */
export function pointFromFlow(
  along: number,
  cross: number,
  orientation: ArisLayoutOrientation
): ArisLayoutPoint {
  return orientation === 'top-to-bottom' ? { x: cross, y: along } : { x: along, y: cross }
}

/** Flow space -> screen space for a centred rectangle. */
export function rectFromFlow(
  alongCenter: number,
  crossCenter: number,
  alongExtent: number,
  crossExtent: number,
  orientation: ArisLayoutOrientation
): ArisLayoutRect {
  if (orientation === 'top-to-bottom') {
    return {
      x: crossCenter - crossExtent / 2,
      y: alongCenter - alongExtent / 2,
      width: crossExtent,
      height: alongExtent
    }
  }
  return {
    x: alongCenter - alongExtent / 2,
    y: crossCenter - crossExtent / 2,
    width: alongExtent,
    height: crossExtent
  }
}
