/**
 * Collision-aware satellite clusters.
 *
 * A cluster is a *view* over satellites that share an owning function
 * occurrence. Individual satellite object identity is preserved; nothing is
 * merged. Clusters are laid out independently from the control-flow backbone so
 * adding metadata never expands the core flow grid.
 */

import type { ArisBounds, ArisPoint } from '../model/types'
import type { ArisControlFlowNode, ArisMetadataCategory, ArisMetadataSatellite } from './seam'

export type ArisClusterLayoutMode = 'source' | 'focusControlFlow'

export interface ArisClusterViewPreferences {
  readonly mode: ArisClusterLayoutMode
  readonly categoryVisibility: Readonly<Record<ArisMetadataCategory, boolean>>
  readonly collapsedClusters: Readonly<Record<string, boolean>>
}

export interface ArisSatelliteCluster {
  readonly ownerOccurrenceId: string
  readonly ownerDefinitionId: string
  readonly ownerBounds: ArisBounds
  readonly satellites: readonly ArisMetadataSatellite[]
  readonly bounds: ArisBounds
  readonly collapsed: boolean
}

export interface ArisClusterLayout {
  readonly mode: ArisClusterLayoutMode
  readonly clusters: ReadonlyMap<string, ArisSatelliteCluster>
  readonly visibleSatellites: readonly ArisMetadataSatellite[]
}

const CLUSTER_MARGIN = 24
const SATELLITE_GAP = 12
const COLUMN_WIDTH = 180

function emptyBounds(): ArisBounds {
  return { x: 0, y: 0, width: 0, height: 0 }
}

function unionBounds(a: ArisBounds, b: ArisBounds): ArisBounds {
  const minX = Math.min(a.x, b.x)
  const minY = Math.min(a.y, b.y)
  const maxX = Math.max(a.x + a.width, b.x + b.width)
  const maxY = Math.max(a.y + a.height, b.y + b.height)
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

function satelliteVisible(
  satellite: ArisMetadataSatellite,
  prefs: ArisClusterViewPreferences
): boolean {
  return prefs.categoryVisibility[satellite.category] ?? false
}

/**
 * Groups satellites by owning function occurrence.
 *
 * The owner is derived from the relation: the endpoint of the connection that
 * is a control-flow object (OT_FUNC/OT_EVT/OT_RULE).
 */
export function groupSatellitesByOwner(
  satellites: ReadonlyMap<string, ArisMetadataSatellite>,
  controlFlowNodes: ReadonlyMap<string, ArisControlFlowNode>
): ReadonlyMap<string, ArisMetadataSatellite[]> {
  const groups = new Map<string, ArisMetadataSatellite[]>()
  for (const satellite of satellites.values()) {
    const relation = satellite.relation
    const sourceNode = controlFlowNodes.get(relation.sourceOccurrenceId)
    const targetNode = controlFlowNodes.get(relation.targetOccurrenceId)
    const ownerNode = sourceNode ?? targetNode
    if (!ownerNode) continue
    const list = groups.get(ownerNode.occurrenceId) ?? []
    list.push(satellite)
    groups.set(ownerNode.occurrenceId, list)
  }
  return groups
}

function clusterBounds(
  ownerBounds: ArisBounds,
  satellites: readonly ArisMetadataSatellite[]
): ArisBounds {
  if (satellites.length === 0) return emptyBounds()
  let bounds = {
    x: ownerBounds.x + ownerBounds.width + CLUSTER_MARGIN,
    y: ownerBounds.y,
    width: COLUMN_WIDTH,
    height: satellites.length * (satellites[0]?.bounds.height ?? 24 + SATELLITE_GAP)
  }
  for (const satellite of satellites) {
    bounds = unionBounds(bounds, satellite.bounds)
  }
  return bounds
}

/**
 * Builds a cluster layout.
 *
 * In `source` mode clusters sit beside their owner at source coordinates.
 * In `focusControlFlow` mode cluster positions are computed but collapsed to
 * minimal footprints so the control-flow spine dominates.
 */
export function buildClusterLayout(
  satellites: ReadonlyMap<string, ArisMetadataSatellite>,
  controlFlowNodes: ReadonlyArray<ArisControlFlowNode>,
  preferences: ArisClusterViewPreferences
): ArisClusterLayout {
  const nodeMap = new Map(controlFlowNodes.map((n) => [n.occurrenceId, n]))
  const groups = groupSatellitesByOwner(satellites, nodeMap)
  const clusters = new Map<string, ArisSatelliteCluster>()
  const visible: ArisMetadataSatellite[] = []

  for (const [ownerId, group] of groups) {
    const owner = nodeMap.get(ownerId)
    if (!owner) continue

    const visibleGroup = group.filter((s) => satelliteVisible(s, preferences))
    const collapsed = preferences.collapsedClusters[ownerId] ?? false

    if (visibleGroup.length === 0) continue

    clusters.set(ownerId, {
      ownerOccurrenceId: ownerId,
      ownerDefinitionId: owner.definitionId,
      ownerBounds: owner.bounds,
      satellites: visibleGroup,
      bounds: collapsed
        ? {
            x: owner.bounds.x + owner.bounds.width + CLUSTER_MARGIN,
            y: owner.bounds.y,
            width: COLUMN_WIDTH,
            height: 24
          }
        : clusterBounds(owner.bounds, visibleGroup),
      collapsed
    })

    if (!collapsed) {
      visible.push(...visibleGroup)
    }
  }

  return {
    mode: preferences.mode,
    clusters,
    visibleSatellites: visible
  }
}

export function setClusterCollapsed(
  preferences: ArisClusterViewPreferences,
  ownerId: string,
  collapsed: boolean
): ArisClusterViewPreferences {
  return {
    ...preferences,
    collapsedClusters: { ...preferences.collapsedClusters, [ownerId]: collapsed }
  }
}

export function setLayoutMode(
  preferences: ArisClusterViewPreferences,
  mode: ArisClusterLayoutMode
): ArisClusterViewPreferences {
  return { ...preferences, mode }
}

export function defaultClusterPreferences(): ArisClusterViewPreferences {
  const visibility = {} as Record<ArisMetadataCategory, boolean>
  const categories: ArisMetadataCategory[] = [
    'owner',
    'responsible',
    'consulted',
    'informed',
    'input',
    'output',
    'system',
    'businessRule',
    'policy',
    'requirement'
  ]
  for (const category of categories) {
    visibility[category] = true
  }
  return {
    mode: 'source',
    categoryVisibility: visibility,
    collapsedClusters: {}
  }
}

/** Computes the centroid of a cluster, useful for collision tests. */
export function clusterCentroid(cluster: ArisSatelliteCluster): ArisPoint {
  return {
    x: cluster.bounds.x + cluster.bounds.width / 2,
    y: cluster.bounds.y + cluster.bounds.height / 2
  }
}

/** Detects bounding-box overlaps between clusters. */
export function detectClusterCollisions(
  clusters: ReadonlyMap<string, ArisSatelliteCluster>
): ReadonlyArray<{ readonly a: string; readonly b: string; readonly overlap: ArisBounds }> {
  const entries = [...clusters.entries()]
  const collisions: { a: string; b: string; overlap: ArisBounds }[] = []
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const [idA, clusterA] = entries[i]
      const [idB, clusterB] = entries[j]
      const overlap = boundsOverlap(clusterA.bounds, clusterB.bounds)
      if (overlap) {
        collisions.push({ a: idA, b: idB, overlap })
      }
    }
  }
  return collisions
}

function boundsOverlap(a: ArisBounds, b: ArisBounds): ArisBounds | null {
  const x1 = Math.max(a.x, b.x)
  const y1 = Math.max(a.y, b.y)
  const x2 = Math.min(a.x + a.width, b.x + b.width)
  const y2 = Math.min(a.y + a.height, b.y + b.height)
  if (x2 <= x1 || y2 <= y1) return null
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 }
}
