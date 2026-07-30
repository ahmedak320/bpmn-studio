// @vitest-environment jsdom

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { afterEach, beforeAll, describe, expect, it } from 'vitest'

import { buildFromSource } from '../model/buildFromSource'
import type { ArisWorkingDocument } from '../model/types'
import { buildSemanticArisDocument } from '../source/semanticIndex'
import { tokenizeXmlDocument } from '../source/xmlTokenizer'
import { arisBusinessObject } from './elements'
import { bootCanvas, type Harness } from './testing/harness'

/**
 * Real-data acceptance for the Phase-B visual deliverables — a function's `AT_ID` numbering painted
 * beside its symbol, and a directed arrowhead on every control-flow connection. Both are a code
 * path DISJOINT from the fidelity comparator (`compare.ts`): they move no measured category, so this
 * suite reads the *mounted canvas* SVG directly, one model at a time, exactly as
 * `connectionLabels.animalwf.test.ts` does.
 *
 * The AnimalWF export is private customer data and is never committed or reproduced here — only the
 * numbering strings (which equal the hand-authored expectation spine's numbering) and aggregate
 * counts reach the assertions.
 *
 * Naming: `*.animalwf.test.ts` is excluded from the default vitest project and from
 * `check:no-skips`, and runs only via `npm run test:aris:animalwf`. The module-load guard below
 * throws if the private fixture is absent — a loud failure, never a skip and never an early return.
 */
const ANIMAL_WF_PATH = resolve(process.cwd(), '../reference/AnimalWF/ARISAMLExport.xml')
if (!existsSync(ANIMAL_WF_PATH)) {
  throw new Error(
    `AnimalWF fixture not found at ${ANIMAL_WF_PATH}. This suite only runs via ` +
      `\`npm run test:aris:animalwf\` with the private reference export present locally; it is ` +
      'never run as part of the default test suite and never skips.'
  )
}

/** The two iterate models and their function `AT_ID` numbering, cross-checked against the export. */
const RENEW_PROFILE = 'Model.-1rUudxIp-wP-u-L'
const REGISTER_OWNER = 'Model.3xqe8yXO9Z7-u-L'
const NUMBERING: Readonly<Record<string, readonly string[]>> = Object.freeze({
  [RENEW_PROFILE]: ['01', '02', '03', '04', '05', '06', '07', '08'],
  [REGISTER_OWNER]: [
    '01',
    '02',
    '03',
    '04',
    '05',
    '06',
    '07',
    '08',
    '09',
    '10',
    '11',
    '12',
    '13',
    '14'
  ]
})

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

function annotationTextsFor(modelId: string): string[] {
  harness = bootCanvas({ document: workingDocument, modelId })
  const registry = harness.canvas.elementRegistry
  const texts: string[] = []
  for (const element of registry.getAll()) {
    if (arisBusinessObject(element)?.kind !== 'occurrence') continue
    const gfx = registry.getGraphics(element.id)
    const group = gfx.querySelector('[data-aris-kind="occurrence"]')
    if (!group) continue
    for (const node of group.querySelectorAll('text[data-aris-attribute-label]')) {
      expect(node.getAttribute('data-aris-attribute-label')).toBe('AT_ID')
      texts.push(node.textContent ?? '')
    }
  }
  return texts
}

describe('AnimalWF Phase-B: function numbering painted beside the symbol', () => {
  for (const modelId of [RENEW_PROFILE, REGISTER_OWNER]) {
    it(`paints each function's AT_ID numbering for ${modelId}`, () => {
      const expected = NUMBERING[modelId]
      const texts = annotationTextsFor(modelId)
      // One AT_ID annotation per numbered function, and the set is the full run 01..N.
      expect(texts).toHaveLength(expected.length)
      expect([...new Set(texts)].sort()).toEqual([...expected])
    })
  }
})

describe('AnimalWF Phase-B: directed arrowhead on every control-flow connection', () => {
  for (const modelId of [RENEW_PROFILE, REGISTER_OWNER]) {
    it(`draws a marker-end arrowhead on every connection for ${modelId}`, () => {
      harness = bootCanvas({ document: workingDocument, modelId })
      const registry = harness.canvas.elementRegistry
      let connections = 0
      for (const element of registry.getAll()) {
        if (arisBusinessObject(element)?.kind !== 'connection') continue
        connections += 1
        const gfx = registry.getGraphics(element.id)
        const marked = gfx.querySelector('[marker-end]')
        expect(marked, `connection ${element.id} has no arrowhead`).not.toBeNull()
        expect(marked?.getAttribute('marker-end')).toMatch(/^url\(#aris-arrow-/)
      }
      expect(connections).toBeGreaterThan(0)
      // The arrowheads reference a single shared marker authored in the diagram's <defs>.
      const svg = harness.container.querySelector('svg')
      expect(svg?.querySelectorAll('marker').length ?? 0).toBeGreaterThanOrEqual(1)
    })
  }
})
