// @vitest-environment jsdom

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { afterEach, beforeAll, describe, expect, it } from 'vitest'

import { buildFromSource } from '../model/buildFromSource'
import type { ArisWorkingDocument } from '../model/types'
import { buildSemanticArisDocument } from '../source/semanticIndex'
import { tokenizeXmlDocument } from '../source/xmlTokenizer'
import { bootCanvas, type Harness } from './testing/harness'

/**
 * Real-data acceptance for the VACD overview containers (user issue 3). The
 * value-added-chain overview (`Model.-64xG-AFMIgg-u-L`) carries three
 * `ST_VAL_ADD_CHN_SML_1` grouping chevrons (`Flags=16`, each the source of a
 * `CT_IS_PRCS_ORNT_SUPER` hierarchy edge) that ARIS drew as huge overlapping
 * symbols. The convention manual (p.18) draws them as background frames behind
 * their leaves and hides the hierarchy line; this suite reads the mounted canvas
 * SVG and confirms exactly that.
 *
 * The AnimalWF export is private customer data and is never committed. Only
 * aggregate counts and DOM-order relationships reach the assertions.
 *
 * Naming: `*.animalwf.test.ts` is excluded from the default vitest project and
 * from `check:no-skips`, and runs only via `npm run test:aris:animalwf`. The
 * module-load guard below throws if the private fixture is absent — a loud
 * failure, never a skip and never an early return.
 */
const ANIMAL_WF_PATH = resolve(process.cwd(), '../reference/AnimalWF/ARISAMLExport.xml')
if (!existsSync(ANIMAL_WF_PATH)) {
  throw new Error(
    `AnimalWF fixture not found at ${ANIMAL_WF_PATH}. This suite only runs via ` +
      `\`npm run test:aris:animalwf\` with the private reference export present locally; it is ` +
      'never run as part of the default test suite and never skips.'
  )
}

const VACD = 'Model.-64xG-AFMIgg-u-L'

// Verified ground truth (probed from the export): 23 ObjOccs = 3 grouping
// containers + 11 leaf `ST_VAL_ADD_CHN_SML_1` chevrons + 9 `ST_PERFORM`; all 12
// connection occurrences are `CT_IS_PRCS_ORNT_SUPER` hierarchy edges.
const EXPECTED_CONTAINERS = 3
const EXPECTED_LEAF_CHEVRONS = 11
const EXPECTED_PERFORM = 9
const EXPECTED_HIERARCHY_EDGES = 12

let workingDocument: ArisWorkingDocument
let harness: Harness | null = null

beforeAll(() => {
  const xml = readFileSync(ANIMAL_WF_PATH, 'utf8')
  const index = buildSemanticArisDocument(tokenizeXmlDocument(xml)).index
  workingDocument = buildFromSource(index)
})

afterEach(() => {
  harness?.destroy()
  harness = null
})

function boot() {
  harness = bootCanvas({ document: workingDocument, modelId: VACD })
  return harness.canvas
}

function occurrenceGroup(canvas: ReturnType<typeof boot>, id: string): SVGGElement {
  const gfx = canvas.elementRegistry.getGraphics(id)
  const group = gfx.querySelector<SVGGElement>('[data-aris-kind="occurrence"]')
  if (!group) throw new Error(`No rendered occurrence group for ${id}.`)
  return group
}

describe('AnimalWF VACD overview containers', () => {
  it('renders exactly 3 container frames, tiered behind every leaf, with top captions', () => {
    const canvas = boot()
    const model = workingDocument.models.get(VACD)!

    const containerIds: string[] = []
    const leafChevronIds: string[] = []
    const performIds: string[] = []
    for (const occurrence of model.occurrences) {
      const group = occurrenceGroup(canvas, occurrence.id)
      if (group.getAttribute('data-aris-container') === 'true') {
        containerIds.push(occurrence.id)
      } else if (occurrence.symbol === 'ST_VAL_ADD_CHN_SML_1') {
        leafChevronIds.push(occurrence.id)
      } else if (occurrence.symbol === 'ST_PERFORM') {
        performIds.push(occurrence.id)
      }
    }

    expect(containerIds).toHaveLength(EXPECTED_CONTAINERS)
    expect(leafChevronIds).toHaveLength(EXPECTED_LEAF_CHEVRONS)
    expect(performIds).toHaveLength(EXPECTED_PERFORM)

    // Every container carries a convention-style frame — a white body, an accent
    // top strip + left band, a white double-chevron, and a top-anchored caption —
    // and no silhouette-scale icon or accent-wedge polygon.
    for (const id of containerIds) {
      const group = occurrenceGroup(canvas, id)
      expect(group.querySelector('rect[data-aris-part="surface"]')?.getAttribute('fill')).toBe(
        '#ffffff'
      )
      expect(group.querySelectorAll('rect[data-aris-part="accent"]').length).toBe(2)
      expect(group.querySelectorAll('polyline[data-aris-part="chevron"]').length).toBe(2)
      expect(group.querySelector('[data-aris-part="icon"]')).toBeNull()
      expect(group.querySelector('polygon')).toBeNull()
      expect(group.querySelector('[data-aris-caption]')).not.toBeNull()
    }

    // Every leaf chevron and every ST_PERFORM tile renders its ordinary
    // descriptor (drawing primitives present, never a container frame).
    for (const id of [...leafChevronIds, ...performIds]) {
      const group = occurrenceGroup(canvas, id)
      expect(group.getAttribute('data-aris-container')).toBeNull()
      expect(group.querySelectorAll('[data-aris-part]').length).toBeGreaterThan(0)
    }

    // Draw-order tier: every container graphic precedes every leaf graphic in DOM
    // order, so the leaves paint on top of the frames.
    const precedes = (a: SVGElement, b: SVGElement): boolean =>
      (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
    for (const containerId of containerIds) {
      const containerGfx = canvas.elementRegistry.getGraphics(containerId) as SVGElement
      for (const leafId of [...leafChevronIds, ...performIds]) {
        const leafGfx = canvas.elementRegistry.getGraphics(leafId) as SVGElement
        expect(precedes(containerGfx, leafGfx)).toBe(true)
      }
    }
  })

  it('hides all 12 CT_IS_PRCS_ORNT_SUPER hierarchy edges (element kept, invisible, non-interactive)', () => {
    const canvas = boot()
    const model = workingDocument.models.get(VACD)!

    let hierarchyEdges = 0
    for (const connection of model.connectionOccurrences) {
      const gfx = canvas.elementRegistry.getGraphics(connection.id)
      const line = gfx.querySelector<SVGElement>('[data-aris-connection-type]')
      expect(line, `connection line for ${connection.id}`).not.toBeNull()
      if (line!.getAttribute('data-aris-connection-type') !== 'CT_IS_PRCS_ORNT_SUPER') continue
      hierarchyEdges += 1
      expect(line!.getAttribute('data-aris-visible')).toBe('false')
      expect(line!.getAttribute('visibility')).toBe('hidden')
      expect(line!.getAttribute('pointer-events')).toBe('none')
    }
    expect(hierarchyEdges).toBe(EXPECTED_HIERARCHY_EDGES)
  })
})
