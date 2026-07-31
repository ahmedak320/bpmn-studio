// @vitest-environment jsdom

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { afterEach, beforeAll, describe, expect, it } from 'vitest'

import { buildFromSource } from '../model/buildFromSource'
import type { ArisWorkingDocument } from '../model/types'
import { buildSemanticArisDocument } from '../source/semanticIndex'
import { tokenizeXmlDocument } from '../source/xmlTokenizer'
import { ARIS_CONNECTION_LABEL_PREFIX, arisBusinessObject } from './elements'
import { connectionLabelRect, routeMidpoint } from './canvasSync'
import { connectionWaypoints } from './waypoints'
import { bootCanvas, type Harness } from './testing/harness'

/**
 * Real-data acceptance for connection label placements — plan §12.1 ("attribute occurrence
 * placement" among the source visual inputs the renderer must read) and §8.2 (a placement is
 * occurrence-local).
 *
 * The model and render layers already carried all 123 `<AttrOcc>` children of `<CxnOcc>`; nothing
 * painted them. This suite measures the *mounted canvas*: it boots a real diagram-js canvas over
 * the real export, one model at a time, and reads the emitted SVG. A regression that stops the
 * canvas drawing them fails here even though every counting test upstream still passes.
 *
 * The AnimalWF export is private customer data and is never committed or reproduced here — only
 * aggregate counts and geometry relationships reach the assertions.
 *
 * Naming: `*.animalwf.test.ts` is excluded from the default vitest project and from
 * `check:no-skips`, and runs only via `npm run test:aris:animalwf`. The module-load guard below
 * throws if the private fixture is absent — a loud failure, never a skip and never an early
 * return.
 */
/**
 * Resolved from the vitest root rather than from `import.meta.url`: this suite runs under the
 * jsdom environment (a real diagram-js canvas needs a DOM), where `import.meta.url` is an
 * `http://` URL and `fileURLToPath` throws.
 */
const ANIMAL_WF_PATH = resolve(process.cwd(), '../reference/AnimalWF/ARISAMLExport.xml')
if (!existsSync(ANIMAL_WF_PATH)) {
  throw new Error(
    `AnimalWF fixture not found at ${ANIMAL_WF_PATH}. This suite only runs via ` +
      `\`npm run test:aris:animalwf\` with the private reference export present locally; it is ` +
      'never run as part of the default test suite and never skips.'
  )
}

/** Fixture-identity anchors, cross-checked against a direct scan of the export. */
const TOTAL_PLACEMENTS = 123
const TEXT_PLACEMENTS = 95
const SYMBOL_PLACEMENTS = 28

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

interface DrawnLabel {
  readonly elementId: string
  readonly attributeType: string
  readonly symbolFlag: string
  readonly fontStyleSheetId: string | null
  readonly hasText: boolean
  readonly hasSymbol: boolean
  readonly textAnchor: string | null
  readonly text: string
  readonly rect: Rect
}

interface Rect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

function rectOf(element: unknown): Rect {
  const shape = element as Rect
  return { x: shape.x, y: shape.y, width: shape.width, height: shape.height }
}

/** Boot one model and read back every connection label the canvas actually drew. */
function drawLabelsFor(modelId: string): DrawnLabel[] {
  harness = bootCanvas({ document: workingDocument, modelId })
  const registry = harness.canvas.elementRegistry
  const drawn: DrawnLabel[] = []
  for (const element of registry.getAll()) {
    const businessObject = arisBusinessObject(element)
    if (businessObject?.kind !== 'connectionLabel') continue
    const gfx = registry.getGraphics(element.id)
    const group = gfx.querySelector('[data-aris-kind="connectionLabel"]')
    if (!group) throw new Error(`Connection label ${element.id} rendered no group.`)
    const text = group.querySelector('text[data-aris-caption]')
    drawn.push({
      elementId: element.id,
      attributeType: group.getAttribute('data-aris-attribute-type') ?? '',
      symbolFlag: group.getAttribute('data-aris-symbol-flag') ?? '',
      fontStyleSheetId: group.getAttribute('data-aris-font-ss'),
      hasText: text !== null,
      hasSymbol: group.querySelector('[data-aris-attribute-symbol]') !== null,
      textAnchor: text?.getAttribute('text-anchor') ?? null,
      text: text?.textContent ?? '',
      rect: rectOf(element)
    })
  }
  return drawn
}

function allModelIds(): string[] {
  return [...workingDocument.models.keys()]
}

describe('AnimalWF connection label placements are painted on the canvas (plan §12.1)', () => {
  it('draws all 123 placements across the eight models, none missing and none invented', () => {
    let drawnTotal = 0
    let modelTotal = 0
    for (const modelId of allModelIds()) {
      const model = workingDocument.models.get(modelId)!
      const expected = model.connectionOccurrences.reduce(
        (total, connection) => total + connection.attributeOccurrences.length,
        0
      )
      const drawn = drawLabelsFor(modelId)
      expect(drawn).toHaveLength(expected)
      // Every drawn label belongs to a connection occurrence of *this* model.
      for (const label of drawn) {
        expect(label.elementId.startsWith(ARIS_CONNECTION_LABEL_PREFIX)).toBe(true)
      }
      // Ids are unique inside a model, so two placements on one connection never collapse.
      expect(new Set(drawn.map((label) => label.elementId)).size).toBe(drawn.length)
      drawnTotal += drawn.length
      modelTotal += expected
      harness?.destroy()
      harness = null
    }
    expect(modelTotal).toBe(TOTAL_PLACEMENTS)
    expect(drawnTotal).toBe(TOTAL_PLACEMENTS)
  })

  it('makes SymbolFlag load-bearing: TEXT draws text, SYMBOL draws a symbol and no text', () => {
    const drawn = allModelIds().flatMap((modelId) => {
      const labels = drawLabelsFor(modelId)
      harness?.destroy()
      harness = null
      return labels
    })
    expect(drawn).toHaveLength(TOTAL_PLACEMENTS)

    const text = drawn.filter((label) => label.symbolFlag === 'TEXT')
    const symbol = drawn.filter((label) => label.symbolFlag === 'SYMBOL')
    expect(text).toHaveLength(TEXT_PLACEMENTS)
    expect(symbol).toHaveLength(SYMBOL_PLACEMENTS)

    // The two flags must not render the same thing — that is the whole point of the flag.
    expect(text.every((label) => label.hasText && !label.hasSymbol)).toBe(true)
    expect(symbol.every((label) => label.hasSymbol && !label.hasText)).toBe(true)

    // Alignment reaches the SVG: every AnimalWF placement is CENTER.
    expect(new Set(text.map((label) => label.textAnchor))).toEqual(new Set(['middle']))

    // Every placement names a font style sheet, and the canvas preserves the reference.
    expect(drawn.every((label) => label.fontStyleSheetId !== null)).toBe(true)
  })

  it('centres every placement on its route midpoint plus the source offsets', () => {
    let checked = 0
    for (const modelId of allModelIds()) {
      const model = workingDocument.models.get(modelId)!
      const occurrenceById = new Map(model.occurrences.map((entry) => [entry.id, entry]))
      const drawn = new Map(drawLabelsFor(modelId).map((label) => [label.elementId, label]))

      model.connectionOccurrences.forEach((connection) => {
        const source = occurrenceById.get(connection.sourceOccurrenceId)
        const target = occurrenceById.get(connection.targetOccurrenceId)
        if (!source || !target) return
        const midpoint = routeMidpoint(
          connectionWaypoints(source.bounds, target.bounds, connection.route, {
            selfLoop: source.id === target.id
          })
        )
        if (!midpoint) return
        connection.attributeOccurrences.forEach((placement, index) => {
          const id = `${ARIS_CONNECTION_LABEL_PREFIX}${connection.id}:${index}:${placement.attributeType}`
          const label = drawn.get(id)
          expect(label).toBeDefined()
          const expected = connectionLabelRect(placement, midpoint, {
            symbolFlag: label!.symbolFlag === 'SYMBOL' ? 'SYMBOL' : 'TEXT',
            text: label!.text
          })
          expect(label!.rect.x).toBeCloseTo(expected.x, 6)
          expect(label!.rect.y).toBeCloseTo(expected.y, 6)
          // The box straddles the offset point rather than hanging off it.
          expect(label!.rect.x + label!.rect.width / 2).toBeCloseTo(
            midpoint.x + (placement.offsetX ?? 0),
            6
          )
          expect(label!.rect.y + label!.rect.height / 2).toBeCloseTo(
            midpoint.y + (placement.offsetY ?? 0),
            6
          )
          checked += 1
        })
      })
      harness?.destroy()
      harness = null
    }
    expect(checked).toBe(TOTAL_PLACEMENTS)
  })

  it('keeps every placement occurrence-local, never on the definition (plan §8.2)', () => {
    let connections = 0
    const arrays = new Set<unknown>()
    for (const modelId of allModelIds()) {
      const model = workingDocument.models.get(modelId)!
      for (const connection of model.connectionOccurrences) {
        connections += 1
        // No connection *definition* ever grew a placement field.
        const definition = workingDocument.connectionDefinitions.get(connection.definitionId)
        if (definition) expect('attributeOccurrences' in (definition as object)).toBe(false)
        // No two occurrences share a placement array by reference, so editing one can never
        // reach another even when they descend from the same definition.
        expect(arrays.has(connection.attributeOccurrences)).toBe(false)
        arrays.add(connection.attributeOccurrences)
      }
    }
    expect(connections).toBe(465)
    expect(arrays.size).toBe(465)
  })

  it('restyles one occurrence without touching a sibling occurrence or the definition (§8.2)', () => {
    // Real-data proof for plan §8.2's "occurrence style affects only that occurrence": AnimalWF's
    // 279 object definitions carry 494 occurrences, so definitions with siblings genuinely exist.
    const target = allModelIds()
      .map((modelId) => {
        const model = workingDocument.models.get(modelId)!
        const byDefinition = new Map<string, string[]>()
        for (const occurrence of model.occurrences) {
          const siblings = byDefinition.get(occurrence.definitionId) ?? []
          siblings.push(occurrence.id)
          byDefinition.set(occurrence.definitionId, siblings)
        }
        for (const [definitionId, ids] of byDefinition) {
          if (ids.length > 1) return { modelId, definitionId, first: ids[0]!, second: ids[1]! }
        }
        return null
      })
      .find((entry) => entry !== null)
    expect(target).not.toBeNull()

    harness = bootCanvas({ document: workingDocument, modelId: target!.modelId })
    const registry = harness.canvas.elementRegistry
    const accentFill = (occurrenceId: string): string | null => {
      const gfx = registry.getGraphics(occurrenceId)
      return (
        gfx
          .querySelector('[data-aris-kind="occurrence"] > [data-aris-part="accent"]')
          ?.getAttribute('fill') ?? null
      )
    }
    const definitionBefore = harness.canvas.document.objectDefinitions.get(target!.definitionId)

    const siblingBefore = accentFill(target!.second)
    harness.canvas.authoring.restyleOccurrence(target!.first, { fillColor: '#ff00aa' })

    expect(accentFill(target!.first)).toBe('#ff00aa')
    expect(accentFill(target!.second)).toBe(siblingBefore)
    // The definition is untouched: same names and attributes, no style leaked onto it.
    const definitionAfter = harness.canvas.document.objectDefinitions.get(target!.definitionId)
    expect(definitionAfter).toEqual(definitionBefore)
  })

  it('reports how much of the canvas the new labels overlap, for the §19.4 acceptance record', () => {
    // The Phase 16 acceptance gate measures object-owned external labels, not connection labels,
    // so the overlap they introduce is measured here instead of going unmeasured. The numbers are
    // asserted rather than merely printed so a change in them is a failing test, not a silent
    // drift.
    let labelOnLabel = 0
    let labelOnShape = 0
    let totalLabels = 0
    for (const modelId of allModelIds()) {
      const model = workingDocument.models.get(modelId)!
      const labels = drawLabelsFor(modelId).map((label) => label.rect)
      totalLabels += labels.length
      const overlaps = (a: Rect, b: Rect): boolean =>
        a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

      for (let i = 0; i < labels.length; i += 1) {
        for (let j = i + 1; j < labels.length; j += 1) {
          if (overlaps(labels[i]!, labels[j]!)) labelOnLabel += 1
        }
        for (const occurrence of model.occurrences) {
          if (overlaps(labels[i]!, occurrence.bounds)) {
            labelOnShape += 1
            break
          }
        }
      }
      harness?.destroy()
      harness = null
    }
    expect(totalLabels).toBe(TOTAL_PLACEMENTS)
    // Measured, then pinned: no connection label overlaps another, and the only seven that reach
    // into a shape are `SYMBOL` markers whose route midpoint genuinely falls inside the shape at
    // one end — which is where ARIS draws them too. The 95 valueless `TEXT` placements draw
    // nothing and therefore occupy nothing, so they cannot overlap anything at all.
    expect(labelOnLabel).toBe(0)
    expect(labelOnShape).toBe(7)
  })
})
