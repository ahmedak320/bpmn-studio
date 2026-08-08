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

import type { ArisLayoutEdgeInput, ArisLayoutNodeInput, ArisLayoutOrientation } from './types'
import type { ResolvedSpacing } from './placement'
import { occupiedBoxOf, type OccupiedBox } from './axis'
import { LAYOUT_EPSILON } from './geometry'
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
  /** Outermost cross coordinate the satellite region reaches on the max side. */
  readonly crossMax: number
  /** Outermost cross coordinate the satellite region reaches on the min side. */
  readonly crossMin: number
}

/**
 * Per-owner satellite side. Satellites hang off the OUTER side of the spine at
 * the owner's position: if the spine bends left there, they go RIGHT (max
 * cross); if it bends right, they go LEFT (min cross); a straight spine defaults
 * to RIGHT. Ties resolve to RIGHT. This is purely a function of the control
 * placement (deterministic), so it never touches the backbone geometry.
 */
type SatelliteSide = 'left' | 'right'

/**
 * The along-axis gap between two stacked satellites in an owner's column. Kept
 * as a single exported constant so the rank-band sizing pass
 * (`satelliteVerticalLoad`) and the placement pass below can never disagree on
 * how tall an owner's stack will be.
 */
export function satelliteStackGap(spacing: ResolvedSpacing): number {
  return Math.max(spacing.labelGap * 2, Math.round(spacing.crossGap * 0.25))
}

/**
 * Density-expansion input for the rank-band sizing stage: the along-axis height
 * each owner's satellite stack will occupy, keyed by the owner's CONTROL-node
 * index. Mirrors `placeSatellites`' owner resolution EXACTLY — the first
 * control<->satellite edge claims the satellite, and a satellite that is both an
 * input and an output of the same owner is counted once — so the sizing pass
 * and the placement pass agree on which owners are dense and by how much. An
 * owner with no satellites is absent from the map (treated as zero load), which
 * is what keeps sparse layouts byte-identical to the pre-expansion engine.
 */
export function satelliteVerticalLoad(
  satelliteNodes: readonly ArisLayoutNodeInput[],
  satelliteEdges: readonly ArisLayoutEdgeInput[],
  controlIndexOf: ReadonlyMap<string, number>,
  orientation: ArisLayoutOrientation,
  spacing: ResolvedSpacing
): Map<number, number> {
  const load = new Map<number, number>()
  if (satelliteNodes.length === 0) return load
  const satelliteIndexOf = new Map<string, number>()
  satelliteNodes.forEach((node, index) => satelliteIndexOf.set(node.id, index))
  const boxes = satelliteNodes.map((node) => occupiedBoxOf(node, orientation, spacing.labelGap))
  const gap = satelliteStackGap(spacing)
  const claimed = new Array<boolean>(satelliteNodes.length).fill(false)
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
    if (claimed[satellite]) continue
    claimed[satellite] = true
    load.set(owner, (load.get(owner) ?? 0) + (boxes[satellite] as OccupiedBox).along + gap)
  }
  return load
}

export function placeSatellites(
  satelliteNodes: readonly ArisLayoutNodeInput[],
  satelliteEdges: readonly ArisLayoutEdgeInput[],
  controlIndexOf: ReadonlyMap<string, number>,
  geometry: FlowGeometry,
  reservedCrossMax: number,
  reservedCrossMin: number,
  controlOut: readonly (readonly number[])[],
  controlIn: readonly (readonly number[])[]
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
  let crossMin = reservedCrossMin

  if (satelliteNodes.length === 0) {
    return { alongOf, crossOf, boxes, routes: [], crossMax, crossMin }
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

  // Per-owner column fanout is gone: with satellites duplicated per owner in
  // projectToEpc.ts, we only need ONE column per SIDE for every owner's
  // satellites. The full-column-per-owner policy (an earlier version of this
  // file) blew up the canvas: 20-step process × 15 owners × ~350px column
  // stride pushed width past 7000px, so the container rasterizer needed
  // ~200MP of memory and OOM'd. Two shared columns (one just outside each
  // return-channel band) keeps total canvas width ~ core-flow width and stays
  // fast under the 2GB container budget — but now the space is split so a
  // bending spine's satellites sit on the OUTER side of the bend.
  //
  // `rightBase` is the near (spine-facing) edge of the right column; a
  // right-side satellite's box occupies [rightBase, rightBase + box.cross].
  // `leftBase` is the near (spine-facing) edge of the left column; a left-side
  // satellite's box occupies [leftBase - box.cross, leftBase]. Both columns
  // grow strictly OUTWARD, so a right satellite can never push the spine left
  // and a left satellite can never push it right (§13.2, preserved
  // conceptually by anchoring the canvas on the control flow in cleanLayout).
  const rightBase = reservedCrossMax + spacing.crossGap
  const leftBase = reservedCrossMin - spacing.crossGap

  // --- per-owner OUTER-side decision --------------------------------------
  // Look at the owner's outgoing edge: if the next node sits LEFT of the owner
  // (spine bends left), satellites go RIGHT (outside the bend); if it sits
  // RIGHT, satellites go LEFT. A straight continuation defaults to RIGHT. When
  // an owner has no outgoing edge (an end event) we mirror the same rule on its
  // incoming edge. Multiple neighbours are reduced by their mean cross so a
  // symmetric split reads as "straight" → RIGHT. Ties resolve to RIGHT.
  const sideOfOwner = (owner: number): SatelliteSide => {
    const ownerCross = placement.crossOf[owner] as number
    const meanCross = (indices: readonly number[]): number =>
      indices.reduce((sum, index) => sum + (placement.crossOf[index] as number), 0) / indices.length
    const outs = controlOut[owner] ?? []
    if (outs.length > 0) {
      const next = meanCross(outs)
      if (next < ownerCross - LAYOUT_EPSILON) return 'right' // spine bends left
      if (next > ownerCross + LAYOUT_EPSILON) return 'left' // spine bends right
      return 'right'
    }
    const ins = controlIn[owner] ?? []
    if (ins.length > 0) {
      const prev = meanCross(ins)
      // Mirror of the outgoing rule: arriving FROM the right ⇒ bending left.
      if (prev > ownerCross + LAYOUT_EPSILON) return 'right'
      if (prev < ownerCross - LAYOUT_EPSILON) return 'left'
      return 'right'
    }
    return 'right'
  }
  const sideOf = new Map<number, SatelliteSide>()
  for (const owner of owners) sideOf.set(owner, sideOfOwner(owner))

  // --- place each owner's satellites stacked next to that owner ------------
  // Each side has its own shared column and its own stack cursor. Within a
  // column, each owner's satellites stack downward from that owner's along-top,
  // and the per-side cursor packs a later owner tight below the previous stack
  // so along-overlaps are impossible. The two columns live at different cross
  // coordinates, so a left-side and a right-side owner can share an along band
  // without colliding. Owner iteration is in rank order (deterministic).
  const satelliteGap = satelliteStackGap(spacing)
  let stackCursorRight = -Infinity
  let stackCursorLeft = -Infinity
  for (const owner of owners) {
    const members = (membersOf.get(owner) as number[]).slice().sort((left, right) => left - right)
    const ownerBox = placement.boxes[owner] as OccupiedBox
    const ownerAlongTop = (placement.alongOf[owner] as number) - ownerBox.along / 2
    const side = sideOf.get(owner) as SatelliteSide
    let cursor = Math.max(side === 'right' ? stackCursorRight : stackCursorLeft, ownerAlongTop)
    for (const member of members) {
      const box = boxes[member] as OccupiedBox
      if (side === 'right') {
        crossOf[member] = rightBase + box.cross / 2
        crossMax = Math.max(crossMax, rightBase + box.cross)
      } else {
        crossOf[member] = leftBase - box.cross / 2
        crossMin = Math.min(crossMin, leftBase - box.cross)
      }
      alongOf[member] = cursor + box.along / 2
      cursor += box.along + satelliteGap
    }
    if (side === 'right') stackCursorRight = cursor
    else stackCursorLeft = cursor
  }

  // --- orphans stacked in the RIGHT column, after all owners --------------
  // With per-owner duplication in the projection, real orphans are rare (a
  // satellite with no control-flow connection at all). They have no owner, so
  // no bend to read: they default to the RIGHT column and stack below every
  // right-side owner stack so they can't collide with one.
  if (orphans.length > 0) {
    // Start orphans at the control-flow's first band, not `spacing.margin`,
    // so an orphan-only satellite set never lowers `base.y` below the
    // control-flow's top and shifts the whole backbone (§13.2).
    const orphanColumnStart = rightBase
    const orphanTop =
      (placement.bandStart[0] as number | undefined) ?? spacing.margin + spacing.rankGap
    // Stack orphans after the lowest right-side owner satellite.
    let cursor = Math.max(orphanTop, stackCursorRight)
    for (const orphan of orphans.slice().sort((left, right) => left - right)) {
      const box = boxes[orphan] as OccupiedBox
      alongOf[orphan] = cursor + box.along / 2
      crossOf[orphan] = orphanColumnStart + box.cross / 2
      cursor += box.along + satelliteGap
      crossMax = Math.max(crossMax, orphanColumnStart + box.cross)
    }
  }

  // --- routes: ONE shared trunk per owner, branching at each satellite -----
  // Item 1 (trunk-and-branch). Every satellite route for one owner shares an
  // identical prefix — a single exit at the owner's near-side centre and a
  // single gap crossing into that owner's corridor — so the N routes overlap
  // into ONE trunk line near the owner instead of the previous fan of N
  // near-parallel staggered stubs. The routes only diverge once they are in
  // the corridor, branching off at each satellite's own along-row very close
  // to that satellite (a short horizontal stub). The corridor's vertical run
  // is a shared cross coordinate, so the corridor segments overlap into the
  // trunk's spine too; the visible split happens at each satellite's row.
  const slots = new GapSlotAllocator(placement.gapStart, placement.gapEnd)

  interface OwnerTrunk {
    readonly exitAlong: number
    readonly exitCross: number
    readonly gapAlong: number
    readonly corridorCross: number
  }
  // A right-side owner's corridor sits just LEFT of the right column (between
  // the spine and its satellites); a left-side owner's corridor sits just RIGHT
  // of the left column. Either way the corridor is the thin channel between the
  // spine and that owner's satellite stack.
  const corridorCrossFor = (side: SatelliteSide): number =>
    side === 'right' ? rightBase - spacing.crossGap / 2 : leftBase + spacing.crossGap / 2

  const ownerTrunk = new Map<number, OwnerTrunk>()
  for (const owner of owners) {
    const side = sideOf.get(owner) as SatelliteSide
    ownerTrunk.set(owner, {
      exitAlong: shapeAlongMax(geometry, owner),
      exitCross: geometry.nodeCross[owner] as number,
      // ONE gap slot for the whole owner: the trunk crosses the rank gap once.
      gapAlong: slots.next((placement.rankOf[owner] as number) + 1),
      corridorCross: corridorCrossFor(side)
    })
  }

  const shapeLeftCrossOf = (index: number): number =>
    (crossOf[index] as number) +
    (boxes[index] as OccupiedBox).nodeCrossOffset -
    (shapeCrossOf[index] as number) / 2

  const shapeRightCrossOf = (index: number): number =>
    (crossOf[index] as number) +
    (boxes[index] as OccupiedBox).nodeCrossOffset +
    (shapeCrossOf[index] as number) / 2

  const shapeAlongCentreOf = (index: number): number =>
    (alongOf[index] as number) + (boxes[index] as OccupiedBox).nodeAlongOffset

  const routeForOwnerSatellite = (owner: number, satellite: number): FlowPoint[] => {
    const side = sideOf.get(owner) ?? 'right'
    const trunk =
      ownerTrunk.get(owner) ??
      ({
        exitAlong: shapeAlongMax(geometry, owner),
        exitCross: geometry.nodeCross[owner] as number,
        gapAlong: slots.next((placement.rankOf[owner] as number) + 1),
        corridorCross: corridorCrossFor(side)
      } satisfies OwnerTrunk)
    const satAlong = shapeAlongCentreOf(satellite)
    // Enter the satellite on the edge facing the spine: its LEFT edge on the
    // right side, its RIGHT edge on the left side.
    const satNearCross =
      side === 'right' ? shapeLeftCrossOf(satellite) : shapeRightCrossOf(satellite)

    return simplifyFlowPolyline([
      { along: trunk.exitAlong, cross: trunk.exitCross },
      { along: trunk.gapAlong, cross: trunk.exitCross },
      { along: trunk.gapAlong, cross: trunk.corridorCross },
      { along: satAlong, cross: trunk.corridorCross },
      { along: satAlong, cross: satNearCross }
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

  return { alongOf, crossOf, boxes, routes, crossMax, crossMin }
}
