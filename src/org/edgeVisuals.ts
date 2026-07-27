/**
 * Pure geometry used by the connection-overlay renderer.
 *
 * bpmn-js connection waypoints are ordered source -> target.  That ordering is
 * significant for split/merge detection, but never for crossing detection.
 * All returned collections and edge-id lists have a stable order.
 */

export interface Point {
  x: number
  y: number
}

export interface PolylineEdge {
  id: string
  /** BPMN topology. Present for real diagram elements; optional for geometry
   * utilities and legacy callers. */
  sourceId?: string
  targetId?: string
  waypoints: readonly Point[]
}

export interface Crossing {
  point: Point
  overEdgeId: string
  underEdgeId: string
}

export interface Junction {
  point: Point
  kind: 'split' | 'merge' | 'split-merge'
  edgeIds: string[]
}

export interface EdgeVisualAnalysis {
  crossings: Crossing[]
  junctions: Junction[]
}

const EPSILON = 1e-7
const KEY_DECIMALS = 6

interface Segment {
  edgeId: string
  index: number
  a: Point
  b: Point
}

interface JunctionCandidate {
  point: Point
  kind: Junction['kind']
  edgeIds: readonly [string, string]
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

function compareNumbers(a: number, b: number): number {
  return a < b ? -1 : a > b ? 1 : 0
}

function comparePoints(a: Point, b: Point): number {
  return compareNumbers(a.x, b.x) || compareNumbers(a.y, b.y)
}

function finitePoint(value: Point): boolean {
  return Number.isFinite(value?.x) && Number.isFinite(value?.y)
}

function cleanNumber(value: number): number {
  return Math.abs(value) <= EPSILON ? 0 : value
}

function copyPoint(point: Point): Point {
  return { x: cleanNumber(point.x), y: cleanNumber(point.y) }
}

function almostZero(value: number, scale = 1): boolean {
  return Math.abs(value) <= EPSILON * Math.max(1, scale)
}

function samePoint(a: Point, b: Point): boolean {
  return Math.abs(a.x - b.x) <= EPSILON && Math.abs(a.y - b.y) <= EPSILON
}

function cross(ax: number, ay: number, bx: number, by: number): number {
  return ax * by - ay * bx
}

function dot(ax: number, ay: number, bx: number, by: number): number {
  return ax * bx + ay * by
}

function pointKey(point: Point): string {
  return `${cleanNumber(point.x).toFixed(KEY_DECIMALS)},${cleanNumber(point.y).toFixed(KEY_DECIMALS)}`
}

function segmentVector(segment: Segment): Point {
  return { x: segment.b.x - segment.a.x, y: segment.b.y - segment.a.y }
}

function pointAt(segment: Segment, parameter: number): Point {
  return {
    x: cleanNumber(segment.a.x + (segment.b.x - segment.a.x) * parameter),
    y: cleanNumber(segment.a.y + (segment.b.y - segment.a.y) * parameter)
  }
}

function parameterOnSegment(point: Point, segment: Segment): number | null {
  const vector = segmentVector(segment)
  const lengthSquared = dot(vector.x, vector.y, vector.x, vector.y)
  if (almostZero(lengthSquared)) return null

  const relativeX = point.x - segment.a.x
  const relativeY = point.y - segment.a.y
  const area = cross(relativeX, relativeY, vector.x, vector.y)
  const scale = Math.sqrt(lengthSquared) * Math.hypot(relativeX, relativeY)
  if (!almostZero(area, scale)) return null

  return dot(relativeX, relativeY, vector.x, vector.y) / lengthSquared
}

function pointInsideSegment(point: Point, segment: Segment): boolean {
  const parameter = parameterOnSegment(point, segment)
  return parameter != null && parameter > EPSILON && parameter < 1 - EPSILON
}

function segmentsCollinear(a: Segment, b: Segment): boolean {
  const av = segmentVector(a)
  const bv = segmentVector(b)
  const directionScale = Math.hypot(av.x, av.y) * Math.hypot(bv.x, bv.y)
  if (!almostZero(cross(av.x, av.y, bv.x, bv.y), directionScale)) return false

  const offsetX = b.a.x - a.a.x
  const offsetY = b.a.y - a.a.y
  return almostZero(
    cross(offsetX, offsetY, av.x, av.y),
    Math.hypot(offsetX, offsetY) * Math.hypot(av.x, av.y)
  )
}

function segmentsOverlapWithLength(a: Segment, b: Segment): boolean {
  if (!segmentsCollinear(a, b)) return false

  const first = parameterOnSegment(b.a, a)
  const second = parameterOnSegment(b.b, a)
  if (first == null || second == null) return false

  const overlapStart = Math.max(0, Math.min(first, second))
  const overlapEnd = Math.min(1, Math.max(first, second))
  return overlapEnd - overlapStart > EPSILON
}

function isRedundantMiddle(a: Point, b: Point, c: Point): boolean {
  const abx = b.x - a.x
  const aby = b.y - a.y
  const acx = c.x - a.x
  const acy = c.y - a.y
  const scale = Math.hypot(abx, aby) * Math.hypot(acx, acy)
  if (!almostZero(cross(abx, aby, acx, acy), scale)) return false

  // A reversal is not redundant: B must lie between A and C.
  return dot(b.x - a.x, b.y - a.y, b.x - c.x, b.y - c.y) <= EPSILON
}

/**
 * Return a defensive, minimal copy of a polyline.
 *
 * Malformed points, consecutive duplicates, and collinear points that do not
 * change direction are removed.  Reversal points are retained.
 */
export function normalizePolyline(waypoints: readonly Point[]): Point[] {
  const normalized: Point[] = []

  for (const candidate of waypoints) {
    if (!finitePoint(candidate)) continue
    const point = copyPoint(candidate)
    if (normalized.length > 0 && samePoint(normalized[normalized.length - 1], point)) continue

    normalized.push(point)
    while (
      normalized.length >= 3 &&
      isRedundantMiddle(
        normalized[normalized.length - 3],
        normalized[normalized.length - 2],
        normalized[normalized.length - 1]
      )
    ) {
      normalized.splice(normalized.length - 2, 1)
    }
  }

  return normalized
}

function normalizeEdges(edges: readonly PolylineEdge[]): PolylineEdge[] {
  return edges.map((edge) => ({
    id: edge.id,
    sourceId: edge.sourceId,
    targetId: edge.targetId,
    waypoints: normalizePolyline(edge.waypoints)
  }))
}

function makeSegments(edges: readonly PolylineEdge[]): Segment[] {
  const segments: Segment[] = []
  for (const edge of edges) {
    for (let index = 0; index + 1 < edge.waypoints.length; index += 1) {
      const a = edge.waypoints[index]
      const b = edge.waypoints[index + 1]
      if (samePoint(a, b)) continue
      segments.push({ edgeId: edge.id, index, a, b })
    }
  }
  return segments
}

/**
 * Subdivide collinear partial overlaps at every overlap boundary.
 *
 * This intentionally keeps the newly inserted collinear points.  They are the
 * exact places where two source prefixes can split or two target suffixes can
 * merge, even when the original waypoint exists on only one of the edges.
 */
export function splitPartialOverlaps(edges: readonly PolylineEdge[]): PolylineEdge[] {
  const normalized = normalizeEdges(edges)
  const segments = makeSegments(normalized)
  const splitParameters = new Map<string, number[]>()

  for (let left = 0; left < segments.length; left += 1) {
    const target = segments[left]
    for (let right = 0; right < segments.length; right += 1) {
      if (left === right) continue
      const other = segments[right]
      if (target.edgeId === other.edgeId || !segmentsOverlapWithLength(target, other)) continue

      for (const endpoint of [other.a, other.b]) {
        if (!pointInsideSegment(endpoint, target)) continue
        const parameter = parameterOnSegment(endpoint, target)
        if (parameter == null) continue
        const key = `${target.edgeId}\u0000${target.index}`
        const parameters = splitParameters.get(key) ?? []
        if (!parameters.some((existing) => Math.abs(existing - parameter) <= EPSILON)) {
          parameters.push(parameter)
          splitParameters.set(key, parameters)
        }
      }
    }
  }

  return normalized.map((edge) => {
    const waypoints: Point[] = []
    for (let index = 0; index + 1 < edge.waypoints.length; index += 1) {
      const segment: Segment = {
        edgeId: edge.id,
        index,
        a: edge.waypoints[index],
        b: edge.waypoints[index + 1]
      }
      if (index === 0) waypoints.push(copyPoint(segment.a))

      const parameters = splitParameters.get(`${edge.id}\u0000${index}`) ?? []
      parameters.sort(compareNumbers)
      for (const parameter of parameters) {
        const point = pointAt(segment, parameter)
        if (!samePoint(waypoints[waypoints.length - 1], point)) waypoints.push(point)
      }
      if (!samePoint(waypoints[waypoints.length - 1], segment.b)) {
        waypoints.push(copyPoint(segment.b))
      }
    }

    if (edge.waypoints.length === 1) waypoints.push(copyPoint(edge.waypoints[0]))
    return {
      id: edge.id,
      sourceId: edge.sourceId,
      targetId: edge.targetId,
      waypoints
    }
  })
}

function commonSourceJunction(a: PolylineEdge, b: PolylineEdge): Point | null {
  if (
    a.waypoints.length < 2 ||
    b.waypoints.length < 2 ||
    !samePoint(a.waypoints[0], b.waypoints[0])
  ) {
    return null
  }

  let index = 0
  let sharedSegments = 0
  while (
    index + 1 < a.waypoints.length &&
    index + 1 < b.waypoints.length &&
    samePoint(a.waypoints[index], b.waypoints[index]) &&
    samePoint(a.waypoints[index + 1], b.waypoints[index + 1])
  ) {
    sharedSegments += 1
    index += 1
  }

  if (sharedSegments === 0) return null
  const bothComplete = index === a.waypoints.length - 1 && index === b.waypoints.length - 1
  return bothComplete ? null : copyPoint(a.waypoints[index])
}

function commonTargetJunction(a: PolylineEdge, b: PolylineEdge): Point | null {
  const aLast = a.waypoints.length - 1
  const bLast = b.waypoints.length - 1
  if (aLast < 1 || bLast < 1 || !samePoint(a.waypoints[aLast], b.waypoints[bLast])) {
    return null
  }

  let aIndex = aLast
  let bIndex = bLast
  let sharedSegments = 0
  while (
    aIndex > 0 &&
    bIndex > 0 &&
    samePoint(a.waypoints[aIndex], b.waypoints[bIndex]) &&
    samePoint(a.waypoints[aIndex - 1], b.waypoints[bIndex - 1])
  ) {
    sharedSegments += 1
    aIndex -= 1
    bIndex -= 1
  }

  if (sharedSegments === 0) return null
  const bothComplete = aIndex === 0 && bIndex === 0
  return bothComplete ? null : copyPoint(a.waypoints[aIndex])
}

function findJunctionCandidates(edges: readonly PolylineEdge[]): JunctionCandidate[] {
  const sorted = [...edges].sort(
    (a, b) =>
      compareStrings(a.id, b.id) ||
      compareStrings(a.waypoints.map(pointKey).join(';'), b.waypoints.map(pointKey).join(';'))
  )
  const candidates: JunctionCandidate[] = []

  for (let left = 0; left < sorted.length; left += 1) {
    for (let right = left + 1; right < sorted.length; right += 1) {
      const a = sorted[left]
      const b = sorted[right]
      if (a.id === b.id) continue

      const topologyAwareSource = a.sourceId != null && b.sourceId != null
      const source =
        topologyAwareSource && a.sourceId === b.sourceId
          ? (commonSourceJunction(a, b) ??
            (a.waypoints[0] && b.waypoints[0] && samePoint(a.waypoints[0], b.waypoints[0])
              ? copyPoint(a.waypoints[0])
              : null))
          : topologyAwareSource
            ? null
            : commonSourceJunction(a, b)
      if (source) {
        candidates.push({ point: source, kind: 'split', edgeIds: [a.id, b.id] })
      }

      const topologyAwareTarget = a.targetId != null && b.targetId != null
      const aLast = a.waypoints[a.waypoints.length - 1]
      const bLast = b.waypoints[b.waypoints.length - 1]
      const target =
        topologyAwareTarget && a.targetId === b.targetId
          ? (commonTargetJunction(a, b) ??
            (aLast && bLast && samePoint(aLast, bLast) ? copyPoint(aLast) : null))
          : topologyAwareTarget
            ? null
            : commonTargetJunction(a, b)
      if (target) {
        candidates.push({ point: target, kind: 'merge', edgeIds: [a.id, b.id] })
      }
    }
  }

  return candidates
}

function collapseJunctionCandidates(candidates: readonly JunctionCandidate[]): Junction[] {
  const grouped = new Map<string, { point: Point; kind: Junction['kind']; edgeIds: Set<string> }>()

  for (const candidate of candidates) {
    const key = `${pointKey(candidate.point)}\u0000${candidate.kind}`
    const existing = grouped.get(key)
    if (!existing) {
      grouped.set(key, {
        point: copyPoint(candidate.point),
        kind: candidate.kind,
        edgeIds: new Set(candidate.edgeIds)
      })
      continue
    }

    for (const edgeId of candidate.edgeIds) existing.edgeIds.add(edgeId)
    if (comparePoints(candidate.point, existing.point) < 0) {
      existing.point = copyPoint(candidate.point)
    }
  }

  return [...grouped.values()]
    .map(({ point, kind, edgeIds }) => ({
      point,
      kind,
      edgeIds: [...edgeIds].sort(compareStrings)
    }))
    .sort(
      (a, b) =>
        comparePoints(a.point, b.point) ||
        compareStrings(a.kind, b.kind) ||
        compareStrings(a.edgeIds.join('\u0000'), b.edgeIds.join('\u0000'))
    )
}

/** Find deduplicated source-prefix split and target-suffix merge points. */
export function findJunctions(edges: readonly PolylineEdge[]): Junction[] {
  const splitEdges = splitPartialOverlaps(edges)
  return collapseJunctionCandidates(findJunctionCandidates(splitEdges))
}

function strictInteriorIntersection(a: Segment, b: Segment): Point | null {
  const av = segmentVector(a)
  const bv = segmentVector(b)
  const lengths = Math.hypot(av.x, av.y) * Math.hypot(bv.x, bv.y)
  const denominator = cross(av.x, av.y, bv.x, bv.y)
  if (almostZero(denominator, lengths)) return null

  const offsetX = b.a.x - a.a.x
  const offsetY = b.a.y - a.a.y
  const aParameter = cross(offsetX, offsetY, bv.x, bv.y) / denominator
  const bParameter = cross(offsetX, offsetY, av.x, av.y) / denominator
  if (
    aParameter <= EPSILON ||
    aParameter >= 1 - EPSILON ||
    bParameter <= EPSILON ||
    bParameter >= 1 - EPSILON
  ) {
    return null
  }

  return pointAt(a, aParameter)
}

function isHorizontal(segment: Segment): boolean {
  return (
    Math.abs(segment.b.x - segment.a.x) > EPSILON && Math.abs(segment.b.y - segment.a.y) <= EPSILON
  )
}

function crossingForSegments(a: Segment, b: Segment, point: Point): Crossing {
  const aHorizontal = isHorizontal(a)
  const bHorizontal = isHorizontal(b)

  if (aHorizontal !== bHorizontal) {
    return aHorizontal
      ? { point, overEdgeId: a.edgeId, underEdgeId: b.edgeId }
      : { point, overEdgeId: b.edgeId, underEdgeId: a.edgeId }
  }

  // Orthogonal BPMN paths always take the branch above.  This fallback makes
  // the utility deterministic for perpendicular diagonal segments too.
  return compareStrings(a.edgeId, b.edgeId) <= 0
    ? { point, overEdgeId: a.edgeId, underEdgeId: b.edgeId }
    : { point, overEdgeId: b.edgeId, underEdgeId: a.edgeId }
}

function crossingKey(crossing: Crossing): string {
  const first =
    compareStrings(crossing.overEdgeId, crossing.underEdgeId) <= 0
      ? crossing.overEdgeId
      : crossing.underEdgeId
  const second = first === crossing.overEdgeId ? crossing.underEdgeId : crossing.overEdgeId
  return `${pointKey(crossing.point)}\u0000${first}\u0000${second}`
}

function findCrossingsPrepared(
  edges: readonly PolylineEdge[],
  junctions: readonly Junction[]
): Crossing[] {
  const edgeById = new Map(edges.map((edge) => [edge.id, edge]))
  const segments = makeSegments(edges).sort(
    (a, b) =>
      compareStrings(a.edgeId, b.edgeId) ||
      compareNumbers(a.index, b.index) ||
      comparePoints(a.a, b.a) ||
      comparePoints(a.b, b.b)
  )
  const crossings = new Map<string, Crossing>()

  for (let left = 0; left < segments.length; left += 1) {
    for (let right = left + 1; right < segments.length; right += 1) {
      const a = segments[left]
      const b = segments[right]
      if (a.edgeId === b.edgeId) continue

      const point = strictInteriorIntersection(a, b)
      if (!point) continue
      const junctionAtPoint = junctions.some((junction) => samePoint(junction.point, point))
      const topologyJoin = junctions.some(
        (junction) =>
          samePoint(junction.point, point) &&
          junction.edgeIds.includes(a.edgeId) &&
          junction.edgeIds.includes(b.edgeId)
      )
      const firstEdge = edgeById.get(a.edgeId)
      const secondEdge = edgeById.get(b.edgeId)
      const topologyKnown =
        firstEdge?.sourceId != null &&
        firstEdge.targetId != null &&
        secondEdge?.sourceId != null &&
        secondEdge.targetId != null
      if (topologyJoin || (junctionAtPoint && !topologyKnown)) continue

      const crossing = crossingForSegments(a, b, point)
      const key = crossingKey(crossing)
      if (!crossings.has(key)) crossings.set(key, crossing)
    }
  }

  return [...crossings.values()].sort(
    (a, b) =>
      comparePoints(a.point, b.point) ||
      compareStrings(a.overEdgeId, b.overEdgeId) ||
      compareStrings(a.underEdgeId, b.underEdgeId)
  )
}

/**
 * Find strict-interior crossings, including diagonal custom routes.
 *
 * Endpoint touches and collinear overlaps are not crossings.  A point already
 * classified as a split/merge junction is excluded only for the participating
 * edge pair; an unrelated line crossing at the same coordinate still gets a
 * bridge.
 */
export function findCrossings(
  edges: readonly PolylineEdge[],
  junctions: readonly Junction[] = findJunctions(edges)
): Crossing[] {
  // Crossing analysis must use the original normalized segments.  Splitting
  // collinear overlaps can introduce a waypoint on an otherwise unrelated
  // connector at the exact coordinate of a real junction; treating that
  // synthetic waypoint as an endpoint would incorrectly hide the crossing.
  return findCrossingsPrepared(normalizeEdges(edges), junctions)
}

/** Analyze all connection-overlay geometry in one deterministic pass. */
export function analyzeEdgeVisuals(edges: readonly PolylineEdge[]): EdgeVisualAnalysis {
  const splitEdges = splitPartialOverlaps(edges)
  const junctions = collapseJunctionCandidates(findJunctionCandidates(splitEdges))
  const crossings = findCrossingsPrepared(normalizeEdges(edges), junctions)
  return { crossings, junctions }
}
