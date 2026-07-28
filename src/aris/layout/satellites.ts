/**
 * Step 10 of the clean-layout algorithm (plan §14.4) and the §13.2 guarantee
 * that metadata never expands the core flow grid.
 *
 * Satellites are placed **after** the control flow is completely fixed and
 * only ever outside it, beyond the return channels, on the far side of the
 * flow axis. Nothing in this module can move a control-flow node, change a
 * rank band, or change the spacing that was derived from the control-flow
 * sizes alone — so the same process laid out with 0 and with 50 satellites has
 * a byte-identical backbone.
 *
 * Geometry
 * --------
 * ```text
 *  core flow  | return   | trunk corridors | satellite column
 *             | channels | (one per group) | (one shared column)
 * ```
 * Every route leaves the core inside a rank gap (no shapes there), crosses the
 * empty corridor band, turns once in its own corridor, and enters its
 * satellite from the near side of the column. No segment can therefore pass
 * through a shape it does not belong to.
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

interface EndpointAnchor {
  /** Where the route leaves/enters the shape. */
  readonly point: FlowPoint
  /** Where the route must be when it reaches the corridor band. */
  readonly corridorAlong: number
  /** Intermediate point between the shape and the corridor band, if any. */
  readonly relay: FlowPoint | null
}

/**
 * Greedy interval partitioning: two routes may share a trunk corridor only
 * when the along ranges they occupy are disjoint. The result is the minimum
 * number of corridors and is fully determined by the input order.
 */
function assignCorridors(ranges: readonly { min: number; max: number }[]): number[] {
  const order = ranges
    .map((range, index) => ({ range, index }))
    .sort((left, right) => left.range.min - right.range.min || left.index - right.index)
  const lastEnd: number[] = []
  const assigned = new Array<number>(ranges.length).fill(0)
  for (const entry of order) {
    let corridor = -1
    for (let index = 0; index < lastEnd.length; index += 1) {
      if ((lastEnd[index] as number) < entry.range.min) {
        corridor = index
        break
      }
    }
    if (corridor === -1) {
      corridor = lastEnd.length
      lastEnd.push(entry.range.max)
    } else {
      lastEnd[corridor] = entry.range.max
    }
    assigned[entry.index] = corridor
  }
  return assigned
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

  // --- group satellites by the first control-flow node they attach to ------
  const ownerOf = new Array<number>(satelliteNodes.length).fill(-1)
  const membersOf = new Map<number, number[]>()
  const orphans: number[] = []
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
  satelliteNodes.forEach((_node, index) => {
    if (ownerOf[index] === -1) orphans.push(index)
  })

  // --- stack one along band per owner, aligned to the owner where possible -
  const groups = [...membersOf.keys()].sort(
    (left, right) =>
      (placement.rankOf[left] as number) - (placement.rankOf[right] as number) ||
      (placement.crossOf[left] as number) - (placement.crossOf[right] as number) ||
      left - right
  )
  const satelliteGap = Math.max(spacing.labelGap * 2, Math.round(spacing.crossGap * 0.25))
  const alongOf = new Array<number>(satelliteNodes.length).fill(0)
  let bandCursor = Number.NEGATIVE_INFINITY
  const layoutBand = (members: readonly number[], preferredStart: number): void => {
    let height = 0
    members.forEach((member, position) => {
      height += (boxes[member] as OccupiedBox).along
      if (position > 0) height += satelliteGap
    })
    const start = Math.max(preferredStart, bandCursor + satelliteGap)
    let cursor = start
    for (const member of members) {
      alongOf[member] = cursor + (boxes[member] as OccupiedBox).along / 2
      cursor += (boxes[member] as OccupiedBox).along + satelliteGap
    }
    bandCursor = start + height
  }
  for (const owner of groups) {
    const members = (membersOf.get(owner) as number[]).slice().sort((left, right) => left - right)
    const preferred =
      (placement.alongOf[owner] as number) - (placement.boxes[owner] as OccupiedBox).along / 2
    layoutBand(members, preferred)
  }
  if (orphans.length > 0) {
    layoutBand(orphans, bandCursor === Number.NEGATIVE_INFINITY ? spacing.margin : bandCursor)
  }

  // --- one shared column, one corridor band in front of it ----------------
  const corridorBase = reservedCrossMax + spacing.crossGap
  const slots = new GapSlotAllocator(placement.gapStart, placement.gapEnd)

  const anchorFor = (
    endpointId: string,
    counterKey: Map<number, number>
  ): EndpointAnchor | null => {
    const control = controlIndexOf.get(endpointId)
    if (control !== undefined) {
      const used = counterKey.get(control) ?? 0
      counterKey.set(control, used + 1)
      const width = geometry.shapeCross[control] as number
      const spread = width * (0.05 + 0.4 * (used % 5) / 5)
      const exitCross = (geometry.nodeCross[control] as number) + spread
      const gapAlong = slots.next((placement.rankOf[control] as number) + 1)
      return {
        point: { along: shapeAlongMax(geometry, control), cross: exitCross },
        relay: { along: gapAlong, cross: exitCross },
        corridorAlong: gapAlong
      }
    }
    const satellite = satelliteIndexOf.get(endpointId)
    if (satellite === undefined) return null
    // A route must attach to the *shape*, not to the occupied box, so the
    // caption reservation is skipped here. The cross coordinate is only known
    // once the shared column has been placed, so `resolve` fills it in below.
    const shapeAlongCenter =
      (alongOf[satellite] as number) + (boxes[satellite] as OccupiedBox).nodeAlongOffset
    return {
      point: { along: shapeAlongCenter, cross: 0 },
      relay: null,
      corridorAlong: shapeAlongCenter
    }
  }

  const exitCounters = new Map<number, number>()
  const anchors: { source: EndpointAnchor | null; target: EndpointAnchor | null }[] = []
  for (const edge of satelliteEdges) {
    anchors.push({
      source: anchorFor(edge.source, exitCounters),
      target: anchorFor(edge.target, exitCounters)
    })
  }

  const ranges = anchors.map((anchor) => {
    const from = anchor.source?.corridorAlong ?? 0
    const to = anchor.target?.corridorAlong ?? 0
    return { min: Math.min(from, to), max: Math.max(from, to) }
  })
  const corridorOf = assignCorridors(ranges)
  const corridorCount = corridorOf.reduce((highest, value) => Math.max(highest, value + 1), 0)
  const columnCross = corridorBase + (corridorCount + 1) * spacing.corridorGap + spacing.crossGap

  const crossOf = new Array<number>(satelliteNodes.length).fill(0)
  let crossMax = columnCross
  satelliteNodes.forEach((_node, index) => {
    crossOf[index] = columnCross + (boxes[index] as OccupiedBox).cross / 2
    crossMax = Math.max(crossMax, columnCross + (boxes[index] as OccupiedBox).cross)
  })

  const satelliteNearCross = (index: number): number =>
    (crossOf[index] as number) +
    (boxes[index] as OccupiedBox).nodeCrossOffset -
    (shapeCrossOf[index] as number) / 2

  const routes: FlowPoint[][] = satelliteEdges.map((edge, edgeIndex) => {
    const anchor = anchors[edgeIndex] as { source: EndpointAnchor | null; target: EndpointAnchor | null }
    if (!anchor.source || !anchor.target) return []
    const corridorCross = corridorBase + ((corridorOf[edgeIndex] as number) + 1) * spacing.corridorGap
    const resolve = (
      endpointId: string,
      value: EndpointAnchor
    ): { shape: FlowPoint; relay: FlowPoint | null } => {
      const satellite = satelliteIndexOf.get(endpointId)
      if (satellite !== undefined && controlIndexOf.get(endpointId) === undefined) {
        return {
          shape: { along: value.corridorAlong, cross: satelliteNearCross(satellite) },
          relay: null
        }
      }
      return { shape: value.point, relay: value.relay }
    }
    const from = resolve(edge.source, anchor.source)
    const to = resolve(edge.target, anchor.target)
    const points: FlowPoint[] = [from.shape]
    if (from.relay) points.push(from.relay)
    points.push({ along: anchor.source.corridorAlong, cross: corridorCross })
    points.push({ along: anchor.target.corridorAlong, cross: corridorCross })
    if (to.relay) points.push(to.relay)
    points.push(to.shape)
    return simplifyFlowPolyline(points)
  })

  return { alongOf, crossOf, boxes, routes, crossMax }
}
