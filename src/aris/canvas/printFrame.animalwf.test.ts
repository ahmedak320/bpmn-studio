// @vitest-environment jsdom

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { afterEach, beforeAll, describe, expect, it } from 'vitest'

import { buildFromSource } from '../model/buildFromSource'
import type { ArisWorkingDocument } from '../model/types'
import { buildSemanticArisDocument } from '../source/semanticIndex'
import { tokenizeXmlDocument } from '../source/xmlTokenizer'
import { arisBusinessObject } from './elements'
import { readLocalized } from './localization'
import { ARIS_PRINT_FRAME_LAYER } from './renderer'
import { bootCanvas, type Harness } from './testing/harness'

/**
 * Real-data acceptance for the Wave 6 V5+ page furniture — the print-frame
 * header band with the Process Code / Process Name / Organizational Owner
 * values, the organization title block, the bottom DMT legend with the RACI
 * key, the tuple-safe RACI badges on the role connectors, and the function
 * numbering at the source-resolved bottom edge — all read off the mounted
 * canvas SVG for the two iterate models.
 *
 * The AnimalWF export is private customer data and is never committed or
 * reproduced here — only aggregate counts, letters, and the public process
 * metadata reach the assertions.
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

const RENEW_PROFILE = 'Model.-1rUudxIp-wP-u-L'
const REGISTER_OWNER = 'Model.3xqe8yXO9Z7-u-L'

/** The expected RACI badge multiset per model (plan ledger: R/I counts). */
const EXPECTED_RACI: Readonly<Record<string, readonly string[]>> = Object.freeze({
  [REGISTER_OWNER]: Object.freeze(['R', 'R', 'R', 'R', 'R', 'I', 'I', 'I', 'I', 'I']),
  [RENEW_PROFILE]: Object.freeze(['R', 'R', 'R', 'R', 'R', 'R', 'R', 'I'])
})

/** The expected function-number inventory per model (plan: 14/8, not a guess). */
const EXPECTED_NUMBERS: Readonly<Record<string, number>> = Object.freeze({
  [REGISTER_OWNER]: 14,
  [RENEW_PROFILE]: 8
})

/** The header's three resolved values and their exact source anchors. */
const EXPECTED_HEADER_VALUES: Readonly<
  Record<string, readonly { readonly x: number; readonly y: number }[]>
> = Object.freeze({
  [REGISTER_OWNER]: Object.freeze([
    Object.freeze({ x: 1823, y: 122 }),
    Object.freeze({ x: 1850, y: 200 }),
    Object.freeze({ x: 1839, y: 273 })
  ]),
  [RENEW_PROFILE]: Object.freeze([
    Object.freeze({ x: 1623, y: 122 }),
    Object.freeze({ x: 1650, y: 200 }),
    Object.freeze({ x: 1639, y: 273 })
  ])
})

/** The organization title block and legend anchor rectangles per model. */
const EXPECTED_FURNITURE: Readonly<
  Record<
    string,
    {
      readonly orgBlock: { readonly x: number; readonly y: number }
      readonly legend: {
        readonly x: number
        readonly y: number
        readonly width: number
        readonly height: number
      }
    }
  >
> = Object.freeze({
  [REGISTER_OWNER]: Object.freeze({
    orgBlock: Object.freeze({ x: 5403, y: 40 }),
    legend: Object.freeze({ x: 450, y: 8139, width: 3800, height: 622 })
  }),
  [RENEW_PROFILE]: Object.freeze({
    orgBlock: Object.freeze({ x: 3303, y: 40 }),
    legend: Object.freeze({ x: 250, y: 5489, width: 3800, height: 622 })
  })
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

function printFrameLayer(): SVGGElement {
  return harness!.canvas.canvas.getLayer(ARIS_PRINT_FRAME_LAYER) as SVGGElement
}

function rectOf(node: Element | null): {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
} {
  if (!node) throw new Error('Expected an SVG rect.')
  return {
    x: Number(node.getAttribute('x')),
    y: Number(node.getAttribute('y')),
    width: Number(node.getAttribute('width')),
    height: Number(node.getAttribute('height'))
  }
}

describe('AnimalWF V5+: print-frame header band', () => {
  for (const modelId of [REGISTER_OWNER, RENEW_PROFILE]) {
    it(`renders the header values at their source anchors for ${modelId}`, () => {
      harness = bootCanvas({ document: workingDocument, modelId })
      const layer = printFrameLayer()
      const header = layer.querySelector('[data-aris-print-frame-header]')
      expect(header, 'header band').not.toBeNull()

      // The band is a single frame anchored at the page origin, enclosing the
      // header furniture with the source's own inset (within 4% of the
      // authored Gfx frame's 388-unit height).
      const band = rectOf(header!.querySelector('rect'))
      expect(band.x).toBe(0)
      expect(band.y).toBe(0)
      expect(band.height).toBeGreaterThanOrEqual(388 * 0.96)
      expect(band.height).toBeLessThanOrEqual(388 * 1.04)

      // Process Code / Process Name / Organizational Owner, resolved from the
      // model attributes and painted at the exact free-text anchors.
      const values = [...header!.querySelectorAll('[data-aris-print-frame-text="anchored-value"]')]
      expect(values).toHaveLength(3)
      const expected = EXPECTED_HEADER_VALUES[modelId]!
      const model = workingDocument.models.get(modelId)!
      const expectedTexts = [
        'AWF.01.01',
        readLocalized(model.names, 'en-US'),
        'Animal Welfare Division'
      ]
      const positioned = values
        .map((node) => ({
          x: Number(node.getAttribute('x')),
          y: Number(node.getAttribute('y')),
          text: node.textContent
        }))
        .sort((a, b) => a.y - b.y)
      positioned.forEach((value, index) => {
        expect(value.x).toBe(expected[index]!.x)
        expect(value.y).toBe(expected[index]!.y)
        expect(expectedTexts).toContain(value.text)
      })
      expect(positioned.map((value) => value.text).sort()).toEqual([...expectedTexts].sort())

      // The organization title block sits at the OLE attachment's exact
      // position, marked as a pending image rather than invented artwork.
      const orgBlock = header!.querySelector('[data-aris-print-frame-org-block]')
      expect(orgBlock, 'org title block').not.toBeNull()
      expect(orgBlock!.getAttribute('data-aris-ole-pending')).toBe('true')
      const block = rectOf(orgBlock!.querySelector('rect'))
      expect(block.x).toBe(EXPECTED_FURNITURE[modelId]!.orgBlock.x)
      expect(block.y).toBe(EXPECTED_FURNITURE[modelId]!.orgBlock.y)
    })
  }
})

describe('AnimalWF V5+: bottom DMT legend and RACI key', () => {
  for (const modelId of [REGISTER_OWNER, RENEW_PROFILE]) {
    it(`renders the 19-presentation legend at the source anchor for ${modelId}`, () => {
      harness = bootCanvas({ document: workingDocument, modelId })
      const legend = printFrameLayer().querySelector('[data-aris-print-frame-legend]')
      expect(legend, 'legend').not.toBeNull()
      const frame = rectOf(legend!.querySelector('rect'))
      expect(frame).toEqual(EXPECTED_FURNITURE[modelId]!.legend)
      // The DMT set: 19 descriptor-drawn presentations, bilingual names.
      expect(legend!.querySelectorAll('[data-aris-legend-symbol]')).toHaveLength(19)
      expect(legend!.textContent).toContain('Function')
      expect(legend!.textContent).toContain('Application system')
      expect(legend!.textContent).toContain('Event')
      // The RACI key with all four letters.
      const raci = legend!.querySelector('[data-aris-print-frame-raci]')
      expect(raci).not.toBeNull()
      for (const letter of ['R', 'A', 'C', 'I']) {
        expect(raci!.textContent).toContain(letter)
      }
      expect(raci!.textContent).toContain('Responsible')
      expect(raci!.textContent).toContain('Informed')
    })
  }
})

describe('AnimalWF V5+: tuple-safe RACI badges on the role connectors', () => {
  for (const modelId of [REGISTER_OWNER, RENEW_PROFILE]) {
    it(`paints exactly the expected R/I badges for ${modelId}`, () => {
      harness = bootCanvas({ document: workingDocument, modelId })
      const registry = harness.canvas.elementRegistry
      const letters: string[] = []
      for (const element of registry.getAll()) {
        if (arisBusinessObject(element)?.kind !== 'connectionLabel') continue
        const group = registry
          .getGraphics(element.id)
          .querySelector('[data-aris-kind="connectionLabel"]')
        const letter = group?.getAttribute('data-aris-raci')
        if (!letter) continue
        letters.push(letter)
        // The badge is painted as the placement's own text, at the placement.
        const texts = [...group!.querySelectorAll('text')].map((node) => node.textContent)
        expect(texts).toContain(letter)
      }
      expect(letters.sort()).toEqual([...EXPECTED_RACI[modelId]!].sort())
    })
  }
})

describe('AnimalWF V5+: function numbering at the source-resolved bottom edge', () => {
  for (const modelId of [REGISTER_OWNER, RENEW_PROFILE]) {
    it(`places every function number at the card's bottom region for ${modelId}`, () => {
      harness = bootCanvas({ document: workingDocument, modelId })
      const registry = harness.canvas.elementRegistry
      let numbered = 0
      for (const element of registry.getAll()) {
        const businessObject = arisBusinessObject(element)
        if (businessObject?.kind !== 'occurrence') continue
        const shape = element as unknown as { height: number }
        const group = registry
          .getGraphics(element.id)
          .querySelector('[data-aris-kind="occurrence"]')
        for (const node of group?.querySelectorAll('text[data-aris-attribute-label]') ?? []) {
          expect(node.getAttribute('data-aris-attribute-label')).toBe('AT_ID')
          numbered += 1
          // The source AttrOcc places the number at the card's bottom edge:
          // the label's centre sits in the lower half of the card, never at
          // the top and never guessed sequentially.
          expect(Number(node.getAttribute('y'))).toBeGreaterThan(shape.height / 2)
          expect(node.textContent).toMatch(/^\d{2}$/)
        }
      }
      expect(numbered).toBe(EXPECTED_NUMBERS[modelId])
    })
  }
})
