/**
 * Step 9 of the clean-layout algorithm (plan §14.4) plus the orthogonal
 * routing of forward edges.
 *
 * Two invariants drive every route produced here:
 *
 * * A route only ever runs across the diagram inside a **rank gap** — the band
 *   between two rank bands, which by construction contains no shape. That is
 *   why no route can pass through an unrelated shape.
 * * A return (back) edge and a self loop leave the body entirely and travel in
 *   the nearest outside channel, i.e. a reserved corridor just beyond the
 *   control-flow bounding box on whichever side is closer.
 */

import type { ArisLayoutEdgeClass, ArisLayoutEdgeInput } from './types'
import type { ControlPlacement } from './placement'
import type { OccupiedBox } from './axis'
import {
  LAYOUT_EPSILON,
  freeIntervals,
  intersectIntervals,
  nearestValueInIntervals,
  type Interval
} from './geometry'

/** A point in flow space. */
export interface FlowPoint {
  readonly along: number
  readonly cross: number
}

/** Everything the routers need to know about the placed control flow. */
export interface FlowGeometry {
  readonly placement: ControlPlacement
  /** Shape extent along / across the flow axis (caption excluded). */
  readonly shapeAlong: readonly number[]
  readonly shapeCross: readonly number[]
  /** Shape centre along / across the flow axis (caption excluded). */
  readonly nodeAlong: readonly number[]
  readonly nodeCross: readonly number[]
}

export function buildFlowGeometry(
  placement: ControlPlacement,
  sizes: readonly { width: number; height: number }[]
): FlowGeometry {
  const vertical = placement.orientation === 'top-to-bottom'
  const shapeAlong = sizes.map((size) => (vertical ? size.height : size.width))
  const shapeCross = sizes.map((size) => (vertical ? size.width : size.height))
  const nodeAlong = placement.alongOf.map(
    (value, index) => value + (placement.boxes[index] as OccupiedBox).nodeAlongOffset
  )
  const nodeCross = placement.crossOf.map(
    (value, index) => value + (placement.boxes[index] as OccupiedBox).nodeCrossOffset
  )
  return { placement, shapeAlong, shapeCross, nodeAlong, nodeCross }
}

export function shapeAlongMin(geometry: FlowGeometry, node: number): number {
  return (geometry.nodeAlong[node] as number) - (geometry.shapeAlong[node] as number) / 2
}

export function shapeAlongMax(geometry: FlowGeometry, node: number): number {
  return (geometry.nodeAlong[node] as number) + (geometry.shapeAlong[node] as number) / 2
}

/**
 * Hands out distinct along coordinates inside one rank gap so two routes never
 * become collinear. Slots fan out from the centre of the gap, alternating
 * sides, and are clamped inside the gap so they can never touch a rank band.
 */
export class GapSlotAllocator {
  private readonly counters: number[]
  /**
   * Shared slots, symmetric on both ends of a route.
   *
   * * **Per-source** (key `${sourceNode}@${gap}`, via {@link nextForSource}):
   *   all forward branches that leave the SAME split node share ONE
   *   horizontal-turn slot in a given rank gap, so their L-shaped turns land at
   *   the same cross coordinate instead of fanning out across N slots.
   * * **Per-target** (key `t${targetNode}@${gap}`, via {@link nextForTarget}):
   *   the mirror image — all forward edges that ARRIVE at the SAME merge node
   *   (an XOR/AND gate or a fan-in function with 2+ incoming edges) share ONE
   *   target-side horizontal-turn slot, so their last horizontal segments land
   *   at the same cross coordinate and the merge is a clean 3+-way junction.
   *
   * A DIFFERENT rank gap always allocates independently. The two namespaces
   * never collide: source keys begin with a digit, target keys with `t`.
   */
  private readonly sharedSlots = new Map<string, number>()

  constructor(
    private readonly gapStart: readonly number[],
    private readonly gapEnd: readonly number[],
    private readonly slotsPerSide = 5
  ) {
    this.counters = new Array<number>(gapStart.length).fill(0)
  }

  /**
   * Like {@link next}, but every call with the same `(sourceNode, gap)` pair
   * reuses the FIRST slot handed out for that pair. A single-outgoing source is
   * therefore called exactly once and still gets its own unique slot; a split
   * reuses that one slot across all its branches, so their horizontal turns
   * share a cross coordinate. Deterministic: the same call order yields the
   * same slots.
   */
  nextForSource(gap: number, sourceNode: number): number {
    const key = `${sourceNode}@${gap}`
    const existing = this.sharedSlots.get(key)
    if (existing !== undefined) return existing
    const slot = this.next(gap)
    this.sharedSlots.set(key, slot)
    return slot
  }

  /**
   * Mirror of {@link nextForSource} on the TARGET side. Every call with the
   * same `(targetNode, gap)` pair reuses the FIRST slot handed out for that
   * pair, so all forward edges arriving at one merge node in a given rank gap
   * share a single target-side horizontal-turn slot. A single-incoming target
   * is called exactly once and still gets its own unique slot; a merge reuses
   * that one slot across all its incoming edges. Deterministic: same call order
   * yields the same slots.
   */
  nextForTarget(gap: number, targetNode: number): number {
    const key = `t${targetNode}@${gap}`
    const existing = this.sharedSlots.get(key)
    if (existing !== undefined) return existing
    const slot = this.next(gap)
    this.sharedSlots.set(key, slot)
    return slot
  }

  /**
   * An adjacent-rank edge has a SINGLE horizontal turn that must serve whichever
   * junction it belongs to: a split (share per source, so branch turns stack on
   * one line) OR a merge (share per target, so incoming turns stack on one
   * line). This resolves both incrementally without any degree lookup:
   *
   * 1. If the source already owns a slot in this gap, reuse it (the edge is a
   *    branch of an already-seen split). Source alignment wins ties, so a
   *    split's alignment never regresses — the §v35 invariant holds.
   * 2. Otherwise, if the target already owns a slot in this gap, reuse it (the
   *    edge is an incoming edge of an already-seen merge).
   * 3. Otherwise allocate a fresh slot.
   *
   * The chosen slot is then registered under BOTH the source and target keys, so
   * a later sibling arriving from the OTHER side of the same junction reuses it.
   * The keys share the exact namespaces of {@link nextForSource} /
   * {@link nextForTarget}, so an adjacent branch and a non-adjacent branch of
   * the same split (or merge) still land on one line.
   */
  nextForJunction(gap: number, sourceNode: number, targetNode: number): number {
    const sourceKey = `${sourceNode}@${gap}`
    const targetKey = `t${targetNode}@${gap}`
    const slot =
      this.sharedSlots.get(sourceKey) ?? this.sharedSlots.get(targetKey) ?? this.next(gap)
    if (!this.sharedSlots.has(sourceKey)) this.sharedSlots.set(sourceKey, slot)
    if (!this.sharedSlots.has(targetKey)) this.sharedSlots.set(targetKey, slot)
    return slot
  }

  next(gap: number): number {
    const index = Math.max(0, Math.min(gap, this.counters.length - 1))
    const ticket = this.counters[index] as number
    this.counters[index] = ticket + 1
    const start = this.gapStart[index] as number
    const end = this.gapEnd[index] as number
    const height = end - start
    const center = (start + end) / 2
    if (ticket === 0) return center
    const ring = ((Math.ceil(ticket / 2) - 1) % this.slotsPerSide) + 1
    const sign = ticket % 2 === 1 ? 1 : -1
    const step = height / (2 * (this.slotsPerSide + 1))
    const offset = sign * ring * step
    const pad = height * 0.05
    return Math.min(Math.max(center + offset, start + pad), end - pad)
  }
}

/** Reserved return channels, expressed as cross coordinates. */
export interface ChannelPlan {
  /** Channel cross coordinate for each back/self edge index. */
  readonly channelOf: ReadonlyMap<number, number>
  /** Outermost cross coordinate used by a channel on each side. */
  readonly minSideCross: number
  readonly maxSideCross: number
}

/**
 * Step 9. Every back edge and self loop is assigned to the closer side and
 * given its own channel. Wider spans sit further out so nested loops nest
 * instead of crossing.
 */
export function planReturnChannels(
  geometry: FlowGeometry,
  edges: readonly ArisLayoutEdgeInput[],
  classOf: readonly ArisLayoutEdgeClass[],
  indexOf: ReadonlyMap<string, number>
): ChannelPlan {
  const { placement } = geometry
  const candidates: {
    edgeIndex: number
    side: 'min' | 'max'
    span: number
  }[] = []
  edges.forEach((edge, edgeIndex) => {
    const value = classOf[edgeIndex]
    if (value !== 'back' && value !== 'self-loop') return
    const source = indexOf.get(edge.source)
    const target = indexOf.get(edge.target)
    if (source === undefined || target === undefined) return
    const low = Math.min(geometry.nodeCross[source] as number, geometry.nodeCross[target] as number)
    const high = Math.max(
      geometry.nodeCross[source] as number,
      geometry.nodeCross[target] as number
    )
    const distanceToMin = low - placement.crossMin
    const distanceToMax = placement.crossMax - high
    const side: 'min' | 'max' = distanceToMax <= distanceToMin ? 'max' : 'min'
    const span = Math.abs(
      (placement.rankOf[source] as number) - (placement.rankOf[target] as number)
    )
    candidates.push({ edgeIndex, side, span })
  })

  const channelOf = new Map<number, number>()
  let minSideCross = placement.crossMin
  let maxSideCross = placement.crossMax
  for (const side of ['min', 'max'] as const) {
    const members = candidates
      .filter((candidate) => candidate.side === side)
      .sort((left, right) => right.span - left.span || left.edgeIndex - right.edgeIndex)
    members.forEach((member, position) => {
      const offset = (position + 1) * placement.spacing.channelGap
      const cross = side === 'min' ? placement.crossMin - offset : placement.crossMax + offset
      channelOf.set(member.edgeIndex, cross)
      if (side === 'min') minSideCross = Math.min(minSideCross, cross)
      else maxSideCross = Math.max(maxSideCross, cross)
    })
  }
  return { channelOf, minSideCross, maxSideCross }
}

/** Drop points that repeat or that sit on a straight run. */
export function simplifyFlowPolyline(points: readonly FlowPoint[]): FlowPoint[] {
  const deduped: FlowPoint[] = []
  for (const point of points) {
    const previous = deduped[deduped.length - 1]
    if (
      previous &&
      Math.abs(previous.along - point.along) < LAYOUT_EPSILON &&
      Math.abs(previous.cross - point.cross) < LAYOUT_EPSILON
    ) {
      continue
    }
    deduped.push(point)
  }
  const result: FlowPoint[] = []
  for (let index = 0; index < deduped.length; index += 1) {
    if (index === 0 || index === deduped.length - 1) {
      result.push(deduped[index] as FlowPoint)
      continue
    }
    const previous = deduped[index - 1] as FlowPoint
    const current = deduped[index] as FlowPoint
    const next = deduped[index + 1] as FlowPoint
    const collinearAlong =
      Math.abs(previous.along - current.along) < LAYOUT_EPSILON &&
      Math.abs(current.along - next.along) < LAYOUT_EPSILON
    const collinearCross =
      Math.abs(previous.cross - current.cross) < LAYOUT_EPSILON &&
      Math.abs(current.cross - next.cross) < LAYOUT_EPSILON
    if (collinearAlong || collinearCross) continue
    result.push(current)
  }
  return result
}

/**
 * A cross coordinate that is free of shapes on every rank strictly between
 * `fromRank` and `toRank`. Long edges use it as their vertical corridor, which
 * is what keeps them out of the shapes they fly over.
 */
export function freeCorridorCross(
  geometry: FlowGeometry,
  fromRank: number,
  toRank: number,
  preferred: number
): number | null {
  const { placement } = geometry
  const low = Math.min(fromRank, toRank)
  const high = Math.max(fromRank, toRank)
  if (high - low <= 1) return preferred
  const clearance = placement.spacing.crossGap * 0.4
  const bounds: Interval = {
    min: placement.crossMin - placement.spacing.crossGap * 4,
    max: placement.crossMax + placement.spacing.crossGap * 4
  }
  let available: readonly Interval[] = [bounds]
  for (let rank = low + 1; rank < high; rank += 1) {
    const blocked = (placement.rankNodes[rank] as readonly number[]).map((member) => ({
      min:
        (placement.crossOf[member] as number) -
        (placement.boxes[member] as OccupiedBox).cross / 2 -
        clearance,
      max:
        (placement.crossOf[member] as number) +
        (placement.boxes[member] as OccupiedBox).cross / 2 +
        clearance
    }))
    available = intersectIntervals(available, freeIntervals(bounds, blocked))
    if (available.length === 0) return null
  }
  return nearestValueInIntervals(available, preferred, placement.spacing.crossGap * 0.25)
}

export interface RoutedEdge {
  readonly edgeIndex: number
  readonly points: readonly FlowPoint[]
}

/**
 * Route one forward edge with an orthogonal, shape-free polyline.
 *
 * `ordinal` distinguishes parallel connections between the same ordered pair:
 * the second and later ones are pushed off the shared centre line so no two
 * routes can ever come out geometrically identical (a §14.4 rejection).
 */
export function routeForwardEdge(
  geometry: FlowGeometry,
  source: number,
  target: number,
  slots: GapSlotAllocator,
  fallbackChannelCross: number,
  ordinal = 0
): FlowPoint[] {
  const { placement } = geometry
  const sourceRank = placement.rankOf[source] as number
  const targetRank = placement.rankOf[target] as number
  const narrowest = Math.min(
    geometry.shapeCross[source] as number,
    geometry.shapeCross[target] as number
  )
  const rawStep =
    ordinal === 0 ? 0 : (ordinal % 2 === 1 ? 1 : -1) * Math.ceil(ordinal / 2) * narrowest * 0.15
  // Never leave the shape outline: the stub must stay attached (§14.4).
  const limit = narrowest * 0.45
  const parallelStep = Math.min(Math.max(rawStep, -limit), limit)
  const sourceCross = (geometry.nodeCross[source] as number) + parallelStep
  const targetCross = (geometry.nodeCross[target] as number) + parallelStep
  const exitAlong = shapeAlongMax(geometry, source)
  const entryAlong = shapeAlongMin(geometry, target)

  if (
    ordinal === 0 &&
    targetRank === sourceRank + 1 &&
    Math.abs(sourceCross - targetCross) < LAYOUT_EPSILON
  ) {
    return [
      { along: exitAlong, cross: sourceCross },
      { along: entryAlong, cross: targetCross }
    ]
  }

  // Adjacent-rank edge: one horizontal turn only. It has to serve both roles a
  // route can play at once — a split branch (align per source) and a merge
  // incoming edge (align per target). `nextForJunction` picks a shared slot for
  // whichever junction this edge belongs to, so a split's branches AND a merge's
  // incoming edges each stack onto one clean line.
  if (targetRank === sourceRank + 1) {
    const turnGap = slots.nextForJunction(sourceRank + 1, source, target)
    return simplifyFlowPolyline([
      { along: exitAlong, cross: sourceCross },
      { along: turnGap, cross: sourceCross },
      { along: turnGap, cross: targetCross },
      { along: entryAlong, cross: targetCross }
    ])
  }

  // Long edge: two turns. The source-side turn is shared per source (all
  // branches leaving the SAME split reuse ONE slot, a clean split). The
  // target-side turn is shared per target (all edges arriving at the SAME merge
  // reuse ONE slot, so their last horizontal segments land at one cross coord —
  // a clean 3+-way merge junction). The two ends are keyed independently.
  const firstGap = slots.nextForSource(sourceRank + 1, source)
  const secondGap = slots.nextForTarget(targetRank, target)
  const corridor =
    freeCorridorCross(geometry, sourceRank, targetRank, (sourceCross + targetCross) / 2) ??
    fallbackChannelCross
  return simplifyFlowPolyline([
    { along: exitAlong, cross: sourceCross },
    { along: firstGap, cross: sourceCross },
    { along: firstGap, cross: corridor },
    { along: secondGap, cross: corridor },
    { along: secondGap, cross: targetCross },
    { along: entryAlong, cross: targetCross }
  ])
}

/**
 * Route one return edge or self loop through its reserved outside channel.
 * The stub leaves the shape at 30% of its half width so it never sits on top
 * of the forward connector that leaves the same edge of the same shape.
 */
export function routeReturnEdge(
  geometry: FlowGeometry,
  source: number,
  target: number,
  channelCross: number,
  slots: GapSlotAllocator
): FlowPoint[] {
  const { placement } = geometry
  const sourceRank = placement.rankOf[source] as number
  const targetRank = placement.rankOf[target] as number
  const sign = channelCross >= (geometry.nodeCross[source] as number) ? 1 : -1
  const exitCross =
    (geometry.nodeCross[source] as number) +
    ((sign * (geometry.shapeCross[source] as number)) / 2) * 0.6
  const entryCross =
    (geometry.nodeCross[target] as number) +
    ((sign * (geometry.shapeCross[target] as number)) / 2) * 0.6
  const exitAlong = shapeAlongMax(geometry, source)
  const entryAlong = shapeAlongMin(geometry, target)
  const outGap = slots.next(sourceRank + 1)
  const inGap = slots.next(targetRank)
  return simplifyFlowPolyline([
    { along: exitAlong, cross: exitCross },
    { along: outGap, cross: exitCross },
    { along: outGap, cross: channelCross },
    { along: inGap, cross: channelCross },
    { along: inGap, cross: entryCross },
    { along: entryAlong, cross: entryCross }
  ])
}
