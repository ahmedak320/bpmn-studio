/**
 * The §19.4 acceptance criteria for free-text notes, on the real AnimalWF
 * export, without a browser.
 *
 * The Phase 16 loop (`npm run test:aris:phase16`) measures the *rendered* SVG
 * and is the authority. It also takes minutes and needs Chromium. This suite
 * reproduces the same node set — every occurrence at the rectangle the clean
 * layout produced, plus every free-text note at the rectangle the canvas
 * draws, plus every external caption — and runs the same `analyzeLayout` /
 * `evaluateLayoutAcceptance` pair over it, so a regression in note placement
 * fails here in a second instead of only in the gate.
 *
 * This file is named `*.animalwf.test.ts` — a convention excluded from the
 * default `vitest run` project and from `check:no-skips`'s scan — so it never
 * runs as part of the ordinary suite and never needs a `.skip` guard. It runs
 * only through `npm run test:aris:animalwf`, and throws loudly at module load
 * if the private fixture is absent.
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { externalNameRect, externalNamePlacement, freeTextBounds } from '../canvas/canvasSync'
import { buildLayoutGraph } from '../canvas/layoutSeam'
import { isSatelliteObjectType } from '../canvas/vocabulary'
import { analyzeLayout, cleanLayout, evaluateLayoutAcceptance } from '../layout'
import type {
  ArisLayoutEdgeRoute,
  ArisLayoutNodePlacement,
  ArisLayoutNodeRole,
  ArisLayoutRect
} from '../layout'
import type { ArisModel, ArisWorkingDocument } from '../model/types'
import { createArisXmlSourcePackage } from '../source/sourcePackage'
import { buildArisStudioDocument } from './arisStudioDocument'

const HERE = dirname(fileURLToPath(import.meta.url))
const FIXTURE = resolve(HERE, '../../../..', 'reference/AnimalWF/ARISAMLExport.xml')
if (!existsSync(FIXTURE)) {
  throw new Error(
    `AnimalWF fixture not found at ${FIXTURE}. This suite only runs via ` +
      '`npm run test:aris:animalwf` with the private reference export present locally; it is ' +
      'never run as part of the default test suite and never skips.'
  )
}

/** The loop's own attachment tolerance, in AML units. */
const ATTACH_TOLERANCE = 0.75

function roleOf(objectType: string): ArisLayoutNodeRole {
  if (objectType === 'OT_FUNC') return 'function'
  if (objectType === 'OT_EVT') return 'event'
  if (objectType === 'OT_RULE') return 'rule'
  return isSatelliteObjectType(objectType) ? 'satellite' : 'other'
}

async function loadDocument(): Promise<ArisWorkingDocument> {
  const pkg = await createArisXmlSourcePackage({
    name: 'ARISAMLExport.xml',
    relPath: 'ARISAMLExport.xml',
    bytes: new Uint8Array(readFileSync(FIXTURE))
  })
  return buildArisStudioDocument(pkg).source
}

/** Everything the canvas draws for one model, after a clean layout. */
function drawnNodes(
  document: ArisWorkingDocument,
  model: ArisModel,
  occurrenceRect: ReadonlyMap<string, ArisLayoutRect>,
  noteRect: ReadonlyMap<string, ArisLayoutRect>
): ArisLayoutNodePlacement[] {
  const nodes: ArisLayoutNodePlacement[] = []
  for (const occurrence of model.occurrences) {
    const rect = occurrenceRect.get(occurrence.id)
    if (!rect) continue
    const role = roleOf(
      document.objectDefinitions.get(occurrence.definitionId)?.type ?? 'OT_UNKNOWN'
    )
    const caption = externalNamePlacement(occurrence)
    nodes.push({
      id: occurrence.id,
      kind: role === 'satellite' ? 'satellite' : 'control-flow',
      role,
      rect,
      labelRect: caption ? externalNameRect(caption, rect) : null,
      componentIndex: -1,
      stronglyConnectedIndex: -1,
      rank: -1,
      laneId: null
    })
  }
  for (const text of model.freeText) {
    nodes.push({
      id: `freeText:${text.id}`,
      kind: 'satellite',
      role: 'satellite',
      rect: noteRect.get(text.id) ?? freeTextBounds(text.bounds),
      labelRect: null,
      componentIndex: -1,
      stronglyConnectedIndex: -1,
      rank: -1,
      laneId: null
    })
  }
  return nodes
}

function measure(
  nodes: readonly ArisLayoutNodePlacement[],
  edges: readonly ArisLayoutEdgeRoute[]
): ReturnType<typeof evaluateLayoutAcceptance> & { readonly noteCount: number } {
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  const grow = (rect: ArisLayoutRect): void => {
    minX = Math.min(minX, rect.x)
    minY = Math.min(minY, rect.y)
    maxX = Math.max(maxX, rect.x + rect.width)
    maxY = Math.max(maxY, rect.y + rect.height)
  }
  for (const node of nodes) {
    grow(node.rect)
    if (node.labelRect) grow(node.labelRect)
  }
  for (const edge of edges) {
    for (const point of edge.points) grow({ x: point.x, y: point.y, width: 0, height: 0 })
  }
  const analysis = analyzeLayout({
    nodes,
    edges,
    canvas: Number.isFinite(minX)
      ? { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
      : { x: 0, y: 0, width: 0, height: 0 },
    expectedEdgeIds: edges.map((edge) => edge.id),
    attachTolerance: ATTACH_TOLERANCE
  })
  return {
    ...evaluateLayoutAcceptance(analysis.metrics, analysis.defects),
    noteCount: nodes.filter((node) => node.id.startsWith('freeText:')).length
  }
}

describe('AnimalWF clean layout places free-text notes', () => {
  it('accepts every model with the notes included in the node set', async () => {
    const document = await loadDocument()
    const models = [...document.models.values()]
    expect(models).toHaveLength(8)

    let totalNotes = 0
    const rejected: string[] = []
    for (const model of models) {
      const result = cleanLayout(buildLayoutGraph(document, model))
      const occurrenceRect = new Map(result.nodes.map((node) => [node.id, node.rect]))
      const noteRect = new Map(result.annotations.map((entry) => [entry.id, entry.rect]))
      expect(noteRect.size).toBe(model.freeText.length)

      const nodes = drawnNodes(document, model, occurrenceRect, noteRect)
      const ids = new Set(nodes.map((node) => node.id))
      const edges = result.edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target))
      const verdict = measure(nodes, edges)
      totalNotes += verdict.noteCount
      if (!verdict.accepted) {
        rejected.push(`${model.id}: ${verdict.findings.map((entry) => entry.code).join(', ')}`)
      }
    }
    expect(rejected).toEqual([])
    expect(totalNotes).toBe(69)
  })

  it('leaves the control-flow backbone identical whether notes are placed or not', async () => {
    const document = await loadDocument()
    for (const model of document.models.values()) {
      const graph = buildLayoutGraph(document, model)
      const withNotes = cleanLayout(graph)
      const withoutNotes = cleanLayout({ ...graph, annotations: [] })
      expect(JSON.stringify(withNotes.nodes)).toBe(JSON.stringify(withoutNotes.nodes))
      expect(JSON.stringify(withNotes.edges)).toBe(JSON.stringify(withoutNotes.edges))
    }
  })

  it('is deterministic across two runs of the same model', async () => {
    const document = await loadDocument()
    for (const model of document.models.values()) {
      const graph = buildLayoutGraph(document, model)
      expect(JSON.stringify(cleanLayout(graph).annotations)).toBe(
        JSON.stringify(cleanLayout(graph).annotations)
      )
    }
  })
})
