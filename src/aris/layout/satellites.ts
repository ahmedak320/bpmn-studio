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
 * Each owner (a control-flow node that attaches at least one satellite) gets a
 * LOCAL cluster hugging its own cross position — the cluster's near edge is
 * `owner.boxEdge ± crossGap/2` on the chosen side, NOT a shared column parked
 * at the far edge of the canvas. Which side (LEFT or RIGHT) is decided per
 * owner by a crossing-aware scorer (Rule A): the side whose candidate satellite
 * routes cross fewer control-flow edges and overlap fewer sibling shapes wins,
 * falling back to an outer-side-vs-spine-centroid rule only when both sides tie
 * at zero. The owner's satellites stack downward from the owner's top edge, one
 * per row; a per-side along cursor keeps two same-side owners from overlapping
 * vertically. Every route leaves the owner at its near-side (bottom in
 * top-to-bottom), turns once in the rank gap after the owner, turns into the
 * owner's LOCAL corridor (a thin channel between the owner and its cluster),
 * and enters the satellite from its near-side. Because clusters are local and
 * the side is crossing-aware, the long cross-page connectors of the old shared-
 * column layout — and the line-hops they caused — are eliminated. Orphan
 * satellites (no owner in the control flow) keep the shared-column fallback:
 * they are stacked in one column at the far side of the canvas.
 */

import type { ArisLayoutEdgeInput, ArisLayoutNodeInput, ArisLayoutOrientation } from './types'
import type { ResolvedSpacing } from './placement'
import { occupiedBoxOf, type OccupiedBox } from './axis'
import { LAYOUT_EPSILON } from './geometry'
import { findCrossings, type PolylineEdge } from '../../org/edgeVisuals'
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
 * Per-owner satellite side, decided by the crossing-aware scorer (Rule A) with
 * a deterministic outer-side fallback. Purely a function of the fixed control
 * placement, so it never touches the backbone geometry.
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
  controlIn: readonly (readonly number[])[],
  controlRoutes: readonly (readonly FlowPoint[])[] = []
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

  // Per-owner LOCAL clusters (Rule B): each owner's satellites sit in a small
  // column IMMEDIATELY next to that owner, not pooled in a shared far-side
  // column. A right cluster's near (spine-facing) edge is
  // `owner.boxRight + smallGap`; a left cluster's near edge is
  // `owner.boxLeft - smallGap`. `smallGap` is a MODEST gap (half the full
  // crossGap), so "Manage action plans" (centre-x) gets its cluster hugging its
  // own right/left edge instead of being flung to the canvas' outer extent. The
  // clusters grow strictly OUTWARD from the owner (right cluster to +cross,
  // left cluster to -cross), and the canvas is still anchored on the
  // control-flow bbox in cleanLayout, so §13.2 (spine never moved by a
  // satellite) is preserved: a 0-satellite graph returns before this code runs
  // and is byte-identical.
  const smallGap = spacing.crossGap / 2
  const satelliteGap = satelliteStackGap(spacing)

  const ownerBoxRightOf = (owner: number): number =>
    (placement.crossOf[owner] as number) + (placement.boxes[owner] as OccupiedBox).cross / 2
  const ownerBoxLeftOf = (owner: number): number =>
    (placement.crossOf[owner] as number) - (placement.boxes[owner] as OccupiedBox).cross / 2
  // The near (spine-facing) edge of an owner's cluster on each side.
  const rightBaseOf = (owner: number): number => ownerBoxRightOf(owner) + smallGap
  const leftBaseOf = (owner: number): number => ownerBoxLeftOf(owner) - smallGap
  const clusterWidthOf = (owner: number): number =>
    (membersOf.get(owner) as number[]).reduce(
      (widest, member) => Math.max(widest, (boxes[member] as OccupiedBox).cross),
      0
    )

  // --- fallback OUTER-side decision ---------------------------------------
  // Only consulted when BOTH candidate sides score zero (no crossing, no
  // conflict) — genuine bends keep the classic outer-side aesthetic. Look at
  // the owner's outgoing edge: next node LEFT of owner (spine bends left) ⇒
  // RIGHT; RIGHT ⇒ LEFT. A STRAIGHT continuation (no bend to read) can't tell
  // "outer" from the local edge, so it falls back to the OWNER'S SIDE OF THE
  // SPINE CENTROID: an owner left of the spine's cross-centroid hangs its
  // satellites off the empty LEFT margin, an owner right of it off the RIGHT.
  // This is what puts an off-centre-but-straight branch (e.g. the left-hand
  // "request annual plans" or "share full results" branch) on the outer side
  // instead of blindly defaulting RIGHT into the busy centre. A single-column
  // spine has every node ON the centroid, so it still ties to RIGHT — the
  // historical straight-chain behaviour. No outgoing edge ⇒ mirror on the
  // incoming edge, same centroid tiebreak. Ties ⇒ RIGHT.
  const spineCentroid =
    placement.crossOf.reduce((sum, value) => sum + (value as number), 0) /
    (placement.crossOf.length || 1)
  const outerSideOf = (owner: number): SatelliteSide => {
    const ownerCross = placement.crossOf[owner] as number
    if (ownerCross < spineCentroid - LAYOUT_EPSILON) return 'left'
    if (ownerCross > spineCentroid + LAYOUT_EPSILON) return 'right'
    return 'right'
  }
  const fallbackSideOfOwner = (owner: number): SatelliteSide => {
    const ownerCross = placement.crossOf[owner] as number
    const meanCross = (indices: readonly number[]): number =>
      indices.reduce((sum, index) => sum + (placement.crossOf[index] as number), 0) / indices.length
    const outs = controlOut[owner] ?? []
    if (outs.length > 0) {
      const next = meanCross(outs)
      if (next < ownerCross - LAYOUT_EPSILON) return 'right' // spine bends left
      if (next > ownerCross + LAYOUT_EPSILON) return 'left' // spine bends right
      return outerSideOf(owner) // straight ⇒ outer side vs spine centroid
    }
    const ins = controlIn[owner] ?? []
    if (ins.length > 0) {
      const prev = meanCross(ins)
      if (prev > ownerCross + LAYOUT_EPSILON) return 'right'
      if (prev < ownerCross - LAYOUT_EPSILON) return 'left'
      return outerSideOf(owner)
    }
    return outerSideOf(owner)
  }

  // --- Rule A: crossing-aware L/R side ------------------------------------
  // Score each candidate side by two penalties and pick the cheaper one:
  //   • edgeCrossings — how many control-flow route segments the owner's
  //     candidate satellite routes would cross on that side (via the shared
  //     `edgeVisuals::findCrossings` geometry engine, run over the candidate
  //     routes + the control-flow routes, counting only crossings that involve
  //     a candidate). This is what stops "Report annual plans" going RIGHT into
  //     the neighbouring branches when LEFT is the empty outer side.
  //   • siblingConflicts — the summed rect-overlap AREA between the candidate
  //     cluster and any control node inside its along band (a cluster that
  //     would sit ON a parallel branch's function scores high).
  // The crossing penalty dominates (weighted ×1e6) so a side is chosen to avoid
  // crossings first, using overlap area only to break crossing ties. Ties in
  // the total ⇒ RIGHT. When BOTH sides score exactly 0, defer to the aesthetic
  // fallback rule above. Owners are scored in the deterministic `owners` order.
  const CROSSING_WEIGHT = 1e6
  const overlap1d = (aMin: number, aMax: number, bMin: number, bMax: number): number =>
    Math.max(0, Math.min(aMax, bMax) - Math.max(aMin, bMin))

  // Control-flow routes, projected once into edgeVisuals' (x=along, y=cross)
  // space. Reused for every owner/side crossing probe.
  const controlPolylines: PolylineEdge[] = controlRoutes.map((points, index) => ({
    id: `__cf${index}`,
    waypoints: points.map((point) => ({ x: point.along, y: point.cross }))
  }))

  // Build the owner's candidate satellite routes for `side`, using an
  // owner-LOCAL along stack (from the owner's own top) so the score reflects
  // this owner's geometry independently of the global stack cursor.
  const candidateRoutesFor = (owner: number, side: SatelliteSide): FlowPoint[][] => {
    const members = (membersOf.get(owner) as number[]).slice().sort((left, right) => left - right)
    const ownerBox = placement.boxes[owner] as OccupiedBox
    const ownerAlongTop = (placement.alongOf[owner] as number) - ownerBox.along / 2
    const exitAlong = shapeAlongMax(geometry, owner)
    const exitCross = geometry.nodeCross[owner] as number
    const near = side === 'right' ? rightBaseOf(owner) : leftBaseOf(owner)
    const corridorCross = side === 'right' ? near - smallGap / 2 : near + smallGap / 2
    const gapIndex = Math.max(
      0,
      Math.min((placement.rankOf[owner] as number) + 1, placement.gapStart.length - 1)
    )
    const gapAlong =
      ((placement.gapStart[gapIndex] as number) + (placement.gapEnd[gapIndex] as number)) / 2
    const routes: FlowPoint[][] = []
    let cursor = ownerAlongTop
    for (const member of members) {
      const box = boxes[member] as OccupiedBox
      const satCross =
        side === 'right' ? near + box.cross / 2 : near - box.cross / 2
      const satAlong = cursor + box.along / 2 + box.nodeAlongOffset
      const shapeCross = shapeCrossOf[member] as number
      const satNearCross =
        side === 'right'
          ? satCross + box.nodeCrossOffset - shapeCross / 2
          : satCross + box.nodeCrossOffset + shapeCross / 2
      routes.push(
        simplifyFlowPolyline([
          { along: exitAlong, cross: exitCross },
          { along: gapAlong, cross: exitCross },
          { along: gapAlong, cross: corridorCross },
          { along: satAlong, cross: corridorCross },
          { along: satAlong, cross: satNearCross }
        ])
      )
      cursor += box.along + satelliteGap
    }
    return routes
  }

  const edgeCrossings = (owner: number, side: SatelliteSide): number => {
    if (controlPolylines.length === 0) return 0
    const candidates: PolylineEdge[] = candidateRoutesFor(owner, side).map((points, index) => ({
      id: `__sat${index}`,
      waypoints: points.map((point) => ({ x: point.along, y: point.cross }))
    }))
    if (candidates.length === 0) return 0
    // Empty junction set ⇒ raw geometric crossings, no split/merge suppression.
    const crossings = findCrossings([...candidates, ...controlPolylines], [])
    let count = 0
    for (const crossing of crossings) {
      const overIsSat = crossing.overEdgeId.startsWith('__sat')
      const underIsSat = crossing.underEdgeId.startsWith('__sat')
      // Count only satellite-vs-control crossings (one endpoint each).
      if (overIsSat !== underIsSat) count += 1
    }
    return count
  }

  const siblingConflicts = (owner: number, side: SatelliteSide): number => {
    const members = membersOf.get(owner) as number[]
    const ownerBox = placement.boxes[owner] as OccupiedBox
    const ownerAlongTop = (placement.alongOf[owner] as number) - ownerBox.along / 2
    const width = clusterWidthOf(owner)
    let along = 0
    for (const member of members) along += (boxes[member] as OccupiedBox).along + satelliteGap
    const clusterAlongMin = ownerAlongTop
    const clusterAlongMax = ownerAlongTop + along
    const near = side === 'right' ? rightBaseOf(owner) : leftBaseOf(owner)
    const clusterCrossMin = side === 'right' ? near : near - width
    const clusterCrossMax = side === 'right' ? near + width : near
    let overlap = 0
    for (let index = 0; index < placement.boxes.length; index += 1) {
      if (index === owner) continue
      const box = placement.boxes[index] as OccupiedBox
      const centreAlong = placement.alongOf[index] as number
      const centreCross = placement.crossOf[index] as number
      const oa = overlap1d(
        clusterAlongMin,
        clusterAlongMax,
        centreAlong - box.along / 2,
        centreAlong + box.along / 2
      )
      if (oa <= 0) continue
      const oc = overlap1d(
        clusterCrossMin,
        clusterCrossMax,
        centreCross - box.cross / 2,
        centreCross + box.cross / 2
      )
      if (oc <= 0) continue
      overlap += oa * oc
    }
    return overlap
  }

  const scoreSide = (owner: number, side: SatelliteSide): number =>
    edgeCrossings(owner, side) * CROSSING_WEIGHT + siblingConflicts(owner, side)

  const sideOf = new Map<number, SatelliteSide>()
  for (const owner of owners) {
    const right = scoreSide(owner, 'right')
    const left = scoreSide(owner, 'left')
    if (right === 0 && left === 0) {
      sideOf.set(owner, fallbackSideOfOwner(owner))
    } else if (left < right) {
      sideOf.set(owner, 'left')
    } else {
      sideOf.set(owner, 'right') // ties resolve to RIGHT
    }
  }

  // --- place each owner's satellites stacked next to that owner ------------
  // Each SIDE keeps a global along-stack cursor so a later owner's cluster is
  // packed below the previous same-side cluster (no along overlap between any
  // two same-side satellites). The clusters no longer share ONE cross column —
  // each owner's cross is LOCAL to that owner — so a left-side and a right-side
  // owner (or two owners at different cross positions) can share an along band
  // without colliding. Owner iteration is in rank order (deterministic).
  let stackCursorRight = -Infinity
  let stackCursorLeft = -Infinity
  for (const owner of owners) {
    const members = (membersOf.get(owner) as number[]).slice().sort((left, right) => left - right)
    const ownerBox = placement.boxes[owner] as OccupiedBox
    const ownerAlongTop = (placement.alongOf[owner] as number) - ownerBox.along / 2
    const side = sideOf.get(owner) as SatelliteSide
    const near = side === 'right' ? rightBaseOf(owner) : leftBaseOf(owner)
    let cursor = Math.max(side === 'right' ? stackCursorRight : stackCursorLeft, ownerAlongTop)
    for (const member of members) {
      const box = boxes[member] as OccupiedBox
      if (side === 'right') {
        crossOf[member] = near + box.cross / 2
        crossMax = Math.max(crossMax, near + box.cross)
      } else {
        crossOf[member] = near - box.cross / 2
        crossMin = Math.min(crossMin, near - box.cross)
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
    const orphanColumnStart = reservedCrossMax + spacing.crossGap
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
  // A right-side owner's corridor sits just LEFT of that owner's LOCAL right
  // cluster (between the spine and its satellites); a left-side owner's corridor
  // sits just RIGHT of its local left cluster. Either way the corridor is the
  // thin channel between the owner and its own satellite stack — now local to
  // the owner, not a shared column.
  const corridorCrossFor = (owner: number, side: SatelliteSide): number =>
    side === 'right' ? rightBaseOf(owner) - smallGap / 2 : leftBaseOf(owner) + smallGap / 2

  const ownerTrunk = new Map<number, OwnerTrunk>()
  for (const owner of owners) {
    const side = sideOf.get(owner) as SatelliteSide
    ownerTrunk.set(owner, {
      exitAlong: shapeAlongMax(geometry, owner),
      exitCross: geometry.nodeCross[owner] as number,
      // ONE gap slot for the whole owner: the trunk crosses the rank gap once.
      gapAlong: slots.next((placement.rankOf[owner] as number) + 1),
      corridorCross: corridorCrossFor(owner, side)
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
        corridorCross: corridorCrossFor(owner, side)
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
