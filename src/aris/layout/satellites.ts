/**
 * Step 10 of the clean-layout algorithm (plan §14.4) and the §13.2 guarantee
 * that metadata never expands the core flow grid.
 *
 * Satellites are placed **after** the control flow is completely fixed and
 * only ever outside it, beyond the return channels. Every satellite is placed
 * in a small local cluster next to the control-flow node it attaches to (its
 * "owner"), matching the classic ARIS convention where a function's satellites
 * sit next to that function rather than being pooled in a single shared column
 * far away. Nothing in this module can move a control-flow node, change a
 * rank band, or change the spacing that was derived from the control-flow
 * sizes alone — so the same process laid out with 0 and with 50 satellites has
 * a byte-identical backbone. Concretely, no satellite (and no satellite route)
 * ever reaches an along coordinate above its owner's top edge, so the layout's
 * `base.y` — and therefore the shift applied to every control-flow node — is
 * decided by the control flow alone.
 *
 * Geometry
 * --------
 * ```text
 *  core flow  | return   | owner_0 col | owner_1 col | ... | orphan col
 *             | channels | + corridor  | + corridor  |     |
 * ```
 * Each owner (a control-flow node that attaches at least one satellite) gets
 * its own dedicated column beyond the reserved routing area. The owner's
 * satellites are stacked in that column, starting at the owner's top edge and
 * running downward one satellite per row. Every route leaves the owner at its
 * near-side (bottom in top-to-bottom, right in left-to-right), turns once in
 * the rank gap immediately after the owner's rank, turns again into the
 * owner's own satellite-corridor (a thin channel just left of the column),
 * turns again into the satellite's own along-row, and enters the satellite
 * from its near-side. Routes for different owners live in different corridors,
 * so long horizontal cross-page connectors — the visual clutter of the
 * shared-column layout — are eliminated by construction. Orphan satellites
 * (no owner in the control flow) keep the shared-column fallback: they are
 * stacked in the last column at the far side of the canvas.
 */

import type { ArisLayoutEdgeInput, ArisLayoutNodeInput } from './types'
import { occupiedBoxOf, type OccupiedBox } from './axis'
import {
  GapSlotAllocator,
  shapeAlongMax,
  simplifyFlowPolyline,
  type FlowGeometry,
  type FlowPoint
} from './routing'

export interface SatellitePlacement {
  /** Occupied-box centre in flow space, per satellite node index. */
  readonly alongOf: readonly number[]
  readonly crossOf: readonly number[]
  readonly boxes: readonly OccupiedBox[]
  /** Route for each satellite edge, keyed by its index in `satelliteEdges`. */
  readonly routes: readonly (readonly FlowPoint[])[]
  /** Outermost cross coordinate the satellite region reaches. */
  readonly crossMax: number
}

export function placeSatellites(
  satelliteNodes: readonly ArisLayoutNodeInput[],
  satelliteEdges: readonly ArisLayoutEdgeInput[],
  controlIndexOf: ReadonlyMap<string, number>,
  geometry: FlowGeometry,
  reservedCrossMax: number
): SatellitePlacement {
  const { placement } = geometry
  const spacing = placement.spacing
  const orientation = placement.orientation
  const boxes = satelliteNodes.map((node) => occupiedBoxOf(node, orientation, spacing.labelGap))
  const shapeCrossOf = satelliteNodes.map((node) =>
    orientation === 'top-to-bottom' ? node.size.width : node.size.height
  )
  const satelliteIndexOf = new Map<string, number>()
  satelliteNodes.forEach((node, index) => satelliteIndexOf.set(node.id, index))

  const alongOf = new Array<number>(satelliteNodes.length).fill(0)
  const crossOf = new Array<number>(satelliteNodes.length).fill(0)
  let crossMax = reservedCrossMax

  if (satelliteNodes.length === 0) {
    return { alongOf, crossOf, boxes, routes: [], crossMax }
  }

  // --- group satellites by the first control-flow node they attach to ------
  // A satellite whose only connections are to other satellites has no owner
  // and falls through to the shared orphan column below.
  const ownerOf = new Array<number>(satelliteNodes.length).fill(-1)
  const membersOf = new Map<number, number[]>()
  for (const edge of satelliteEdges) {
    const sourceControl = controlIndexOf.get(edge.source)
    const targetControl = controlIndexOf.get(edge.target)
    const sourceSatellite = satelliteIndexOf.get(edge.source)
    const targetSatellite = satelliteIndexOf.get(edge.target)
    let owner = -1
    let satellite = -1
    if (sourceControl !== undefined && targetSatellite !== undefined) {
      owner = sourceControl
      satellite = targetSatellite
    } else if (targetControl !== undefined && sourceSatellite !== undefined) {
      owner = targetControl
      satellite = sourceSatellite
    }
    if (owner < 0 || satellite < 0) continue
    if (ownerOf[satellite] !== -1) continue
    ownerOf[satellite] = owner
    const list = membersOf.get(owner)
    if (list) list.push(satellite)
    else membersOf.set(owner, [satellite])
  }
  const orphans: number[] = []
  satelliteNodes.forEach((_node, index) => {
    if (ownerOf[index] === -1) orphans.push(index)
  })

  // --- assign a dedicated column to each owner, in a deterministic order ---
  const owners = [...membersOf.keys()].sort(
    (left, right) =>
      (placement.rankOf[left] as number) - (placement.rankOf[right] as number) ||
      (placement.crossOf[left] as number) - (placement.crossOf[right] as number) ||
      left - right
  )

  const baseCross = reservedCrossMax + spacing.crossGap
  const maxSatCross = boxes.reduce((highest, box) => Math.max(highest, box.cross), 0)
  // Each column reserves the widest satellite plus one crossGap of clearance,
  // so the corridor of the *next* column has room to breathe without touching
  // the previous column's satellites.
  const columnStride = Math.max(maxSatCross + spacing.crossGap, spacing.crossGap * 2)
  const columnStartOf = new Map<number, number>()
  const corridorCrossOf = new Map<number, number>()
  owners.forEach((owner, ordinal) => {
    const columnStart = baseCross + ordinal * columnStride
    columnStartOf.set(owner, columnStart)
    // Corridor sits half a crossGap left of the column, comfortably clear of
    // both the previous column's satellites and this column's satellites.
    corridorCrossOf.set(owner, columnStart - spacing.crossGap / 2)
  })

  // --- place each owner's satellites in its column, stacked at owner's top -
  // Stacking downward from `owner.alongTop` (never above it) is what keeps
  // `base.y` — and therefore every control-flow node's shifted `rect.y` —
  // decided by the control flow alone. Extending past the owner's bottom is
  // fine; only the *upper* extent participates in the shift.
  const satelliteGap = Math.max(spacing.labelGap * 2, Math.round(spacing.crossGap * 0.25))
  for (const owner of owners) {
    const members = (membersOf.get(owner) as number[]).slice().sort((left, right) => left - right)
    const columnStart = columnStartOf.get(owner) as number
    const ownerBox = placement.boxes[owner] as OccupiedBox
    const ownerAlongTop = (placement.alongOf[owner] as number) - ownerBox.along / 2
    let cursor = ownerAlongTop
    for (const member of members) {
      const box = boxes[member] as OccupiedBox
      crossOf[member] = columnStart + box.cross / 2
      alongOf[member] = cursor + box.along / 2
      cursor += box.along + satelliteGap
      crossMax = Math.max(crossMax, columnStart + box.cross)
    }
  }

  // --- orphans stacked in a final shared column at the far side -----------
  if (orphans.length > 0) {
    const orphanColumnStart = baseCross + owners.length * columnStride
    // Start orphans at the control-flow's first band, not `spacing.margin`,
    // so an orphan-only satellite set never lowers `base.y` below the
    // control-flow's top and shifts the whole backbone (§13.2).
    const orphanTop =
      (placement.bandStart[0] as number | undefined) ?? spacing.margin + spacing.rankGap
    let cursor = orphanTop
    for (const orphan of orphans.slice().sort((left, right) => left - right)) {
      const box = boxes[orphan] as OccupiedBox
      alongOf[orphan] = cursor + box.along / 2
      crossOf[orphan] = orphanColumnStart + box.cross / 2
      cursor += box.along + satelliteGap
      crossMax = Math.max(crossMax, orphanColumnStart + box.cross)
    }
  }

  // --- routes: one owner-local L-shape per satellite edge -----------------
  const slots = new GapSlotAllocator(placement.gapStart, placement.gapEnd)
  const exitCounters = new Map<number, number>()

  const shapeLeftCrossOf = (index: number): number =>
    (crossOf[index] as number) +
    (boxes[index] as OccupiedBox).nodeCrossOffset -
    (shapeCrossOf[index] as number) / 2

  const shapeAlongCentreOf = (index: number): number =>
    (alongOf[index] as number) + (boxes[index] as OccupiedBox).nodeAlongOffset

  const routeForOwnerSatellite = (owner: number, satellite: number): FlowPoint[] => {
    const columnStart = columnStartOf.get(owner) ?? baseCross
    const corridorCross = corridorCrossOf.get(owner) ?? columnStart - spacing.crossGap / 2

    // Stagger exits along the owner's near-side (bottom edge in TTB), so two
    // routes leaving the same owner do not sit on top of each other.
    const used = exitCounters.get(owner) ?? 0
    exitCounters.set(owner, used + 1)
    const ownerShapeCross = geometry.shapeCross[owner] as number
    const ownerNodeCross = geometry.nodeCross[owner] as number
    const spread = ownerShapeCross * (0.05 + (0.4 * (used % 5)) / 5)
    const exitCross = ownerNodeCross + spread
    const exitAlong = shapeAlongMax(geometry, owner)

    const gapAlong = slots.next((placement.rankOf[owner] as number) + 1)
    const satAlong = shapeAlongCentreOf(satellite)
    const satLeftCross = shapeLeftCrossOf(satellite)

    return simplifyFlowPolyline([
      { along: exitAlong, cross: exitCross },
      { along: gapAlong, cross: exitCross },
      { along: gapAlong, cross: corridorCross },
      { along: satAlong, cross: corridorCross },
      { along: satAlong, cross: satLeftCross }
    ])
  }

  const routeForSatelliteSatellite = (source: number, target: number): FlowPoint[] => {
    // A satellite-to-satellite edge has no owner corridor to share; route it
    // through a corridor left of both endpoints so it can never overlap a
    // satellite of the same or a different owner.
    const sourceAlong = shapeAlongCentreOf(source)
    const targetAlong = shapeAlongCentreOf(target)
    const sourceLeft = shapeLeftCrossOf(source)
    const targetLeft = shapeLeftCrossOf(target)
    const corridorCross = Math.min(sourceLeft, targetLeft) - spacing.crossGap / 2
    return simplifyFlowPolyline([
      { along: sourceAlong, cross: sourceLeft },
      { along: sourceAlong, cross: corridorCross },
      { along: targetAlong, cross: corridorCross },
      { along: targetAlong, cross: targetLeft }
    ])
  }

  const routes: FlowPoint[][] = satelliteEdges.map((edge) => {
    const sourceControl = controlIndexOf.get(edge.source)
    const targetControl = controlIndexOf.get(edge.target)
    const sourceSatellite = satelliteIndexOf.get(edge.source)
    const targetSatellite = satelliteIndexOf.get(edge.target)

    if (sourceControl !== undefined && targetSatellite !== undefined) {
      const points = routeForOwnerSatellite(sourceControl, targetSatellite)
      // The polyline was authored owner -> satellite; the edge asks the same
      // direction, so leave it alone.
      return points
    }
    if (targetControl !== undefined && sourceSatellite !== undefined) {
      // Author the geometry owner -> satellite for determinism, then reverse
      // it so `points[0]` sits on the *source* shape as the metric contract
      // requires.
      const points = routeForOwnerSatellite(targetControl, sourceSatellite).slice().reverse()
      return points
    }
    if (sourceSatellite !== undefined && targetSatellite !== undefined) {
      return routeForSatelliteSatellite(sourceSatellite, targetSatellite)
    }
    // An edge referencing an id that separateGraphs already filtered out
    // (dangling) cannot happen here, but return an empty polyline defensively.
    return []
  })

  return { alongOf, crossOf, boxes, routes, crossMax }
}
