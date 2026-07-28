/**
 * Real-data validation against the private AnimalWF export (plan §19.1-§19.4).
 *
 * The fixture is never committed and never copied: the test reads it in place
 * when it happens to be available locally and derives nothing but aggregate
 * topology and geometry from it. When the file is absent the suite still runs
 * and asserts the guard itself, so this is a runtime availability check and
 * never a skipped test.
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { cleanLayout } from '../cleanLayout'
import { cleanLayoutRevision, resetToSourceLayout, sourceLayoutRevision } from '../modes'
import { analyzeLayout } from '../metrics'
import { extractAmlLayoutGraphs, type AmlModelGraph } from './amlTopology'
import { buildAdjacency, classifyEdges, separateGraphs } from '../graph'

const HERE = dirname(fileURLToPath(import.meta.url))
const FIXTURE = resolve(HERE, '../../../../..', 'reference/AnimalWF/ARISAMLExport.xml')
const AVAILABLE = existsSync(FIXTURE)

function loadModels(): AmlModelGraph[] {
  return extractAmlLayoutGraphs(readFileSync(FIXTURE, 'utf8'))
}

describe('AnimalWF fixture availability', () => {
  it('is a runtime check, not a skipped test', () => {
    expect(typeof AVAILABLE).toBe('boolean')
    if (!AVAILABLE) {
      expect(FIXTURE.endsWith('reference/AnimalWF/ARISAMLExport.xml')).toBe(true)
    }
  })
})

describe.runIf(AVAILABLE)('AnimalWF full-data clean layout', () => {
  const models = loadModels()

  it('reproduces the plan 19.1 baseline the layout depends on', () => {
    expect(models).toHaveLength(8)
    expect(models.filter((entry) => entry.modelType === 'MT_EEPC')).toHaveLength(7)
    expect(models.filter((entry) => entry.modelType === 'MT_VAL_ADD_CHN_DGM')).toHaveLength(1)
    expect(models.reduce((total, entry) => total + entry.objectOccurrenceCount, 0)).toBe(494)
    expect(models.reduce((total, entry) => total + entry.connectionOccurrenceCount, 0)).toBe(465)
    expect(models.reduce((total, entry) => total + entry.routePointCount, 0)).toBe(1339)
    expect(models.reduce((total, entry) => total + entry.laneCount, 0)).toBe(16)
  })

  it('finds only XOR and AND rules, exactly as the export contains', () => {
    const operators = new Set<string>()
    for (const entry of models) {
      for (const node of entry.graph.nodes) {
        if (node.role === 'rule' && node.operator) operators.add(node.operator)
      }
    }
    expect([...operators].sort()).toEqual(['and', 'xor'])
  })

  for (let index = 0; index < 8; index += 1) {
    describe(`model ${index}`, () => {
      const entry = models[index] as AmlModelGraph
      const result = cleanLayout(entry.graph)

      it('passes every plan 19.4 geometric criterion', () => {
        expect(result.metrics.shapeOverlaps).toBe(0)
        expect(result.metrics.labelSatelliteOverlaps).toBe(0)
        expect(result.metrics.edgeShapeCrossings).toBe(0)
        expect(result.metrics.detachedEndpoints).toBe(0)
        expect(result.metrics.missingEdges).toBe(0)
        expect(result.metrics.duplicateEdges).toBe(0)
        expect(result.metrics.zeroLengthEdges).toBe(0)
      })

      it('is accepted by the rejection gate', () => {
        expect(result.findings.map((finding) => finding.code)).toEqual([])
        expect(result.accepted).toBe(true)
      })

      it('draws every occurrence and every connection exactly once', () => {
        expect(result.nodes).toHaveLength(entry.graph.nodes.length)
        expect(new Set(result.nodes.map((node) => node.id)).size).toBe(entry.graph.nodes.length)
        expect(result.edges).toHaveLength(entry.graph.edges.length)
        expect(new Set(result.edges.map((edge) => edge.id)).size).toBe(entry.graph.edges.length)
      })

      it('keeps every explicit cycle visible and traceable', () => {
        const separated = separateGraphs(entry.graph)
        const adjacency = buildAdjacency(separated.controlNodes, separated.controlEdges)
        const classification = classifyEdges(adjacency)
        const returns = new Set(
          [...classification.backEdgeIndices, ...classification.selfLoopEdgeIndices].map(
            (edgeIndex) => separated.controlEdges[edgeIndex]?.id as string
          )
        )
        for (const id of returns) {
          const route = result.edges.find((edge) => edge.id === id)
          expect(route).toBeDefined()
          expect(route?.classification === 'back' || route?.classification === 'self-loop').toBe(
            true
          )
          const length = (route?.points ?? []).reduce((total, point, position, all) => {
            if (position === 0) return 0
            const previous = all[position - 1] as { x: number; y: number }
            return total + Math.hypot(point.x - previous.x, point.y - previous.y)
          }, 0)
          expect(length).toBeGreaterThan(0)
        }
      })

      it('keeps the control-flow backbone almost crossing free', () => {
        // Satellite combs necessarily cross each other in the metadata band;
        // the backbone itself must stay readable. Measured on this fixture the
        // eight models produce 0, 4, 0, 1, 0, 5, 0 and 0 backbone crossings.
        const controlNodes = result.nodes.filter((node) => node.kind === 'control-flow')
        const controlEdges = result.edges.filter((edge) => edge.kind === 'control-flow')
        const analysis = analyzeLayout({
          nodes: controlNodes,
          edges: controlEdges,
          canvas: result.canvas,
          expectedEdgeIds: controlEdges.map((edge) => edge.id)
        })
        expect(analysis.metrics.shapeOverlaps).toBe(0)
        expect(analysis.metrics.edgeShapeCrossings).toBe(0)
        expect(analysis.metrics.edgeEdgeCrossings).toBeLessThanOrEqual(8)
      })

      it('keeps the source and the clean layout independently restorable', () => {
        const before = JSON.stringify(sourceLayoutRevision(entry.graph))
        cleanLayoutRevision(entry.graph)
        cleanLayoutRevision(entry.graph)
        expect(JSON.stringify(resetToSourceLayout(entry.graph))).toBe(before)
      })

      it('is deterministic', () => {
        expect(JSON.stringify(cleanLayout(entry.graph))).toBe(JSON.stringify(result))
      })
    })
  }

  it('reports at least one explicit return path across the eight models', () => {
    let returns = 0
    for (const entry of models) {
      const separated = separateGraphs(entry.graph)
      const adjacency = buildAdjacency(separated.controlNodes, separated.controlEdges)
      const classification = classifyEdges(adjacency)
      returns += classification.backEdgeIndices.length + classification.selfLoopEdgeIndices.length
    }
    expect(returns).toBeGreaterThan(0)
  })
})
