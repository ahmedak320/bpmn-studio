import { describe, expect, it } from 'vitest'
import { buildTestDocument } from '../model/testFixture'
import { buildSatelliteDocument } from './testHelpers'
import { adaptWorkingDocument, controlFlowSpine } from './seam'
import {
  buildClusterLayout,
  defaultClusterPreferences,
  detectClusterCollisions,
  setClusterCollapsed,
  setLayoutMode,
  type ArisSatelliteCluster
} from './clusters'

describe('collision-aware clusters', () => {
  it('groups satellites by owning function occurrence', () => {
    const document = buildSatelliteDocument()
    const details = adaptWorkingDocument(document)
    const model = [...details.models.values()][0]
    const layout = buildClusterLayout(
      model.satellites,
      model.controlFlowNodes,
      defaultClusterPreferences()
    )
    expect(layout.clusters.size).toBe(1)
    const cluster = [...layout.clusters.values()][0]
    expect(cluster.ownerOccurrenceId).toBe('occ-func-1')
    expect(cluster.satellites.length).toBe(2)
  })

  it('does not expand the control-flow grid when satellites are added', async () => {
    const { document } = await buildTestDocument()
    const details = adaptWorkingDocument(document)
    const model = [...details.models.values()][0]

    const spineWithSatellites = controlFlowSpine(model.controlFlowNodes)

    // Simulate a view with all satellites hidden.
    const prefsNoSatellites = {
      ...defaultClusterPreferences(),
      categoryVisibility: { ...defaultClusterPreferences().categoryVisibility }
    }
    for (const key of Object.keys(prefsNoSatellites.categoryVisibility)) {
      ;(prefsNoSatellites.categoryVisibility as Record<string, boolean>)[key] = false
    }
    const layoutNoSatellites = buildClusterLayout(
      model.satellites,
      model.controlFlowNodes,
      prefsNoSatellites
    )
    expect(layoutNoSatellites.visibleSatellites.length).toBe(0)

    // The control-flow spine must be identical regardless of satellite visibility.
    expect(controlFlowSpine(model.controlFlowNodes)).toEqual(spineWithSatellites)
  })

  it('preserves individual satellite identity inside a cluster', () => {
    const document = buildSatelliteDocument()
    const details = adaptWorkingDocument(document)
    const model = [...details.models.values()][0]
    const layout = buildClusterLayout(
      model.satellites,
      model.controlFlowNodes,
      defaultClusterPreferences()
    )
    for (const cluster of layout.clusters.values()) {
      const ids = cluster.satellites.map((s) => s.occurrenceId)
      expect(new Set(ids).size).toBe(ids.length)
    }
  })

  it('persists view preferences separately from document semantics', async () => {
    const { document } = await buildTestDocument()
    const details = adaptWorkingDocument(document)
    const model = [...details.models.values()][0]
    const prefs = defaultClusterPreferences()
    const collapsed = setClusterCollapsed(prefs, 'owner-1', true)
    const focused = setLayoutMode(collapsed, 'focusControlFlow')
    expect(focused.mode).toBe('focusControlFlow')
    expect(focused.collapsedClusters['owner-1']).toBe(true)

    // Rebuild the document; view preferences are not part of the document.
    const details2 = adaptWorkingDocument(document)
    const model2 = [...details2.models.values()][0]
    expect(model2.controlFlowNodes).toEqual(model.controlFlowNodes)
  })

  it('detects cluster collisions when clusters overlap', () => {
    const clusterA: ArisSatelliteCluster = {
      ownerOccurrenceId: 'a',
      ownerDefinitionId: 'da',
      ownerBounds: { x: 0, y: 0, width: 100, height: 50 },
      satellites: [],
      bounds: { x: 120, y: 0, width: 100, height: 100 },
      collapsed: false
    }
    const clusterB = {
      ...clusterA,
      ownerOccurrenceId: 'b',
      ownerDefinitionId: 'db',
      bounds: { x: 150, y: 10, width: 100, height: 100 }
    }
    const collisions = detectClusterCollisions(
      new Map([
        ['a', clusterA],
        ['b', clusterB]
      ])
    )
    expect(collisions.length).toBe(1)
    expect(collisions[0].a).toBe('a')
    expect(collisions[0].b).toBe('b')
  })
})
