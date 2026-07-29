/**
 * Free-text annotations — plan §14.4 steps 10-12 and §13.2.
 *
 * An ARIS free-text note (`<FFTextOcc>`) is not a graph object: it has no
 * connections, no definition-level identity in the flow, and in a real export
 * no `<Size>` at all. It is a *caption* — a sentence the modeller parked next
 * to whatever it comments on. Clean Layout re-places every occurrence, so a
 * note left at its imported coordinates ends up commenting on empty space, or
 * worse, on top of an unrelated shape.
 *
 * This module answers that with one rule:
 *
 * > A note stays a caption of the thing it was nearest to in the source, on the
 * > side it was on, at the smallest displacement that clears every drawn thing.
 *
 * Concretely, per note:
 *
 * 1. **Anchor** — the graph node whose *source* rectangle centre is nearest to
 *    the note's *source* rectangle centre (§14.4 step 10 places satellites
 *    after the core flow, so the anchor's final rectangle is already fixed).
 * 2. **Side** — the compass direction of the note relative to that anchor in
 *    the source layout, so "the note above the start event" is still above it.
 * 3. **Search** — concentric rings around the anchor's *clean* rectangle,
 *    nearest ring first and, within a ring, the source-side direction first.
 *    The first candidate that clears every shape, every reserved caption box,
 *    every already-placed note and every routed connector wins (§14.4 step 12).
 * 4. **Fallback** — if no ring clears, the note is stacked in a column butted
 *    directly against the right edge of the drawn content. That column is one
 *    gap wide, so it cannot read as unexplained whitespace.
 *
 * Two properties matter as much as the placement itself:
 *
 * * **Nothing here can move a control-flow node** (§13.2). Notes are not in the
 *   layout graph at all — they are neither control-flow nodes nor satellites,
 *   they take part in no component, no rank and no corridor allocation. The
 *   same model laid out with 0 and with 50 notes has a byte-identical spine.
 * * **Nothing here decides a note's size.** The caller passes the rectangle the
 *   renderer draws and gets a rectangle of exactly that size back; only the
 *   position changes. A source that carries no `<Size>` still carries none
 *   afterwards.
 */

import type {
  ArisLayoutAnnotationInput,
  ArisLayoutAnnotationPlacement,
  ArisLayoutEdgeRoute,
  ArisLayoutNodePlacement,
  ArisLayoutPoint,
  ArisLayoutRect
} from './types'
import { rectCenter, rectsOverlap, segmentIntersectsRectInterior, unionRect } from './geometry'

/**
 * The eight candidate sides, in the tie-break order used when a note sits
 * exactly on top of its anchor in the source and has no side to prefer.
 * Right/left come first because clean layouts run the flow down a spine, so
 * the cross axis is where the free space is.
 */
const DIRECTIONS: readonly ArisLayoutPoint[] = Object.freeze([
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: -1 },
  { x: 0, y: 1 },
  { x: 1, y: -1 },
  { x: -1, y: -1 },
  { x: 1, y: 1 },
  { x: -1, y: 1 }
])

/** Hard cap on the ring search, so a pathological input cannot spin. */
const MAX_RINGS = 400

export interface ArisLayoutAnnotationInputSet {
  readonly annotations: readonly ArisLayoutAnnotationInput[]
  /** Source rectangle of every graph node, by node id. */
  readonly sourceRects: ReadonlyMap<string, ArisLayoutRect>
  /** Final clean-layout placements, already translated to canvas space. */
  readonly placed: readonly ArisLayoutNodePlacement[]
  /**
   * Rectangles that are drawn but are not node placements — an occurrence's
   * external caption, for example, which the canvas draws at a fixed offset
   * from its owner. Treated as keep-out only.
   */
  readonly obstacles: readonly ArisLayoutRect[]
  readonly edges: readonly ArisLayoutEdgeRoute[]
  /** Clearance kept between a note and anything else. */
  readonly gap: number
  /** Distance added to the search radius per ring. */
  readonly step: number
}

interface Segment {
  readonly a: ArisLayoutPoint
  readonly b: ArisLayoutPoint
  readonly minX: number
  readonly maxX: number
  readonly minY: number
  readonly maxY: number
}

function segmentsOf(edges: readonly ArisLayoutEdgeRoute[]): Segment[] {
  const segments: Segment[] = []
  for (const edge of edges) {
    for (let index = 1; index < edge.points.length; index += 1) {
      const a = edge.points[index - 1] as ArisLayoutPoint
      const b = edge.points[index] as ArisLayoutPoint
      segments.push({
        a,
        b,
        minX: Math.min(a.x, b.x),
        maxX: Math.max(a.x, b.x),
        minY: Math.min(a.y, b.y),
        maxY: Math.max(a.y, b.y)
      })
    }
  }
  return segments
}

function inflate(rect: ArisLayoutRect, by: number): ArisLayoutRect {
  return {
    x: rect.x - by,
    y: rect.y - by,
    width: rect.width + by * 2,
    height: rect.height + by * 2
  }
}

/**
 * Order the eight sides so the one the note occupied in the source comes
 * first. `offset` is the note's source position relative to its anchor's; a
 * near-zero offset falls back to {@link DIRECTIONS} order.
 */
function directionsFor(offset: ArisLayoutPoint): readonly ArisLayoutPoint[] {
  const magnitude = Math.hypot(offset.x, offset.y)
  if (magnitude < 1) return DIRECTIONS
  const unit = { x: offset.x / magnitude, y: offset.y / magnitude }
  return DIRECTIONS.map((direction, index) => {
    const length = Math.hypot(direction.x, direction.y)
    return {
      direction,
      index,
      affinity: (direction.x * unit.x + direction.y * unit.y) / length
    }
  })
    .sort((left, right) => right.affinity - left.affinity || left.index - right.index)
    .map((entry) => entry.direction)
}

/**
 * Place every free-text note. Deterministic: the notes are consumed in the
 * order given, every candidate order is fixed, and no clock or RNG is read.
 */
export function placeAnnotations(
  input: ArisLayoutAnnotationInputSet
): readonly ArisLayoutAnnotationPlacement[] {
  if (input.annotations.length === 0) return Object.freeze([])

  const gap = Math.max(1, Math.round(input.gap))
  const step = Math.max(gap, Math.round(input.step))
  const clearance = Math.max(1, Math.round(gap / 2))
  const segments = segmentsOf(input.edges)

  const blocked: ArisLayoutRect[] = []
  let content: ArisLayoutRect | null = null
  for (const node of input.placed) {
    blocked.push(node.rect)
    content = content ? unionRect(content, node.rect) : node.rect
    if (node.labelRect) {
      blocked.push(node.labelRect)
      content = unionRect(content, node.labelRect)
    }
  }
  for (const rect of input.obstacles) {
    blocked.push(rect)
    content = content ? unionRect(content, rect) : rect
  }
  for (const segment of segments) {
    const rect = {
      x: segment.minX,
      y: segment.minY,
      width: segment.maxX - segment.minX,
      height: segment.maxY - segment.minY
    }
    content = content ? unionRect(content, rect) : rect
  }
  const bounds = content ?? { x: 0, y: 0, width: 0, height: 0 }

  const placedRect = new Map<string, ArisLayoutRect>()
  for (const node of input.placed) placedRect.set(node.id, node.rect)

  /** Anchor candidates: nodes that exist in both the source and the result. */
  const anchors: { id: string; source: ArisLayoutPoint }[] = []
  for (const node of input.placed) {
    const source = input.sourceRects.get(node.id)
    if (!source) continue
    anchors.push({ id: node.id, source: rectCenter(source) })
  }

  const taken: ArisLayoutRect[] = []
  const isFree = (candidate: ArisLayoutRect): boolean => {
    if (candidate.x < 0 || candidate.y < 0) return false
    const probe = inflate(candidate, clearance)
    for (const rect of blocked) if (rectsOverlap(probe, rect)) return false
    for (const rect of taken) if (rectsOverlap(probe, rect)) return false
    for (const segment of segments) {
      if (segment.maxX <= probe.x || segment.minX >= probe.x + probe.width) continue
      if (segment.maxY <= probe.y || segment.minY >= probe.y + probe.height) continue
      if (segmentIntersectsRectInterior(segment.a, segment.b, probe)) return false
    }
    return true
  }

  /**
   * Last resort: a column butted against the right edge of the drawn content,
   * stacked downward. Only a note the ring search could not seat anywhere
   * reaches this, and the column is one `gap` clear of the content, so it adds
   * one note's width to the canvas rather than a whitespace band. The loop runs
   * one more time than there are notes, which is enough for every note to find
   * an unused slot; the final unguarded step exists only so the function is
   * total.
   */
  let fallbackY = bounds.y
  const fallback = (width: number, height: number): ArisLayoutRect => {
    const x = Math.round(bounds.x + bounds.width + gap)
    let candidate = { x, y: Math.round(fallbackY), width, height }
    for (let attempt = 0; attempt <= input.annotations.length; attempt += 1) {
      candidate = { x, y: Math.round(fallbackY), width, height }
      fallbackY += height + gap
      if (isFree(candidate)) return candidate
    }
    return candidate
  }

  const placements: ArisLayoutAnnotationPlacement[] = []
  for (const annotation of input.annotations) {
    const width = annotation.rect.width
    const height = annotation.rect.height
    const noteCenter = rectCenter(annotation.rect)

    let anchorId: string | null = null
    let best = Number.POSITIVE_INFINITY
    for (const anchor of anchors) {
      const distance = Math.hypot(anchor.source.x - noteCenter.x, anchor.source.y - noteCenter.y)
      if (distance < best) {
        best = distance
        anchorId = anchor.id
      }
    }

    let chosen: ArisLayoutRect | null = null
    const anchorRect = anchorId === null ? null : (placedRect.get(anchorId) ?? null)
    if (anchorRect) {
      const anchorSource = input.sourceRects.get(anchorId as string) as ArisLayoutRect
      const anchorSourceCenter = rectCenter(anchorSource)
      const directions = directionsFor({
        x: noteCenter.x - anchorSourceCenter.x,
        y: noteCenter.y - anchorSourceCenter.y
      })
      const center = rectCenter(anchorRect)
      const reachX = anchorRect.width / 2 + width / 2 + gap
      const reachY = anchorRect.height / 2 + height / 2 + gap
      for (let ring = 0; ring < MAX_RINGS && chosen === null; ring += 1) {
        const push = ring * step
        for (const direction of directions) {
          const candidate = {
            x: Math.round(center.x + direction.x * (reachX + push) - width / 2),
            y: Math.round(center.y + direction.y * (reachY + push) - height / 2),
            width,
            height
          }
          if (!isFree(candidate)) continue
          chosen = candidate
          break
        }
      }
    }

    const rect = chosen ?? fallback(width, height)
    taken.push(rect)
    placements.push({ id: annotation.id, rect })
  }

  return Object.freeze(placements)
}
