// @vitest-environment jsdom

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { afterEach, beforeAll, describe, expect, it } from 'vitest'

import { buildFromSource } from '../model/buildFromSource'
import type { ArisWorkingDocument } from '../model/types'
import { buildSemanticArisDocument } from '../source/semanticIndex'
import { tokenizeXmlDocument } from '../source/xmlTokenizer'
import { ARIS_CONNECTION_LABEL_PREFIX, arisBusinessObject } from './elements'
import {
  CONNECTION_LABEL_NW_INSET_X,
  CONNECTION_LABEL_NW_INSET_Y,
  CONNECTION_LABEL_PORT_NW,
  connectionLabelRect,
  resolveLabelFont,
  routeMidpoint
} from './canvasSync'
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
const PROCESS_MODEL_IDS = Object.freeze([
  'Model.-1rUudxIp-wP-u-L',
  'Model.3xqe8yXO9Z7-u-L',
  'Model.3i-a2j4HRS3-u-L',
  'Model.-778f33baj6c-u-L'
])

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
  readonly port: string | null
  readonly fontStyleSheetId: string | null
  readonly hasText: boolean
  readonly hasSymbol: boolean
  readonly textAnchor: string | null
  readonly text: string
  readonly raci: string | null
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
      port: (businessObject as { readonly port?: string | null }).port ?? null,
      fontStyleSheetId: group.getAttribute('data-aris-font-ss'),
      hasText: text !== null,
      hasSymbol: group.querySelector('[data-aris-attribute-symbol]') !== null,
      textAnchor: text?.getAttribute('text-anchor') ?? null,
      text: text?.textContent ?? '',
      raci: group.getAttribute('data-aris-raci'),
      rect: rectOf(element)
    })
  }
  return drawn
}

function allModelIds(): string[] {
  return [...workingDocument.models.keys()]
}

describe('AnimalWF V4+ exact source geometry reaches the mounted canvas', () => {
  it('preserves all 281 bounds and all 269 ordered routes through the SVG projection', () => {
    let bounds = 0
    let routes = 0
    let maxAmlDelta = 0
    let maxCssDelta = 0
    let orthogonal = 0

    const sourceBounds = new Map(
      [...workingDocument.sourceIndex.objectOccurrences.values()].map((record) => [
        record.parsed.objectOccurrenceId,
        {
          x: record.parsed.x ?? 0,
          y: record.parsed.y ?? 0,
          width: record.parsed.dx ?? 0,
          height: record.parsed.dy ?? 0
        }
      ])
    )
    const sourceRoutes = new Map<string, { pointIndex: number; x: number; y: number }[]>()
    for (const point of workingDocument.sourceIndex.routePoints) {
      if (!point.connectionOccurrenceId) continue
      const points = sourceRoutes.get(point.connectionOccurrenceId) ?? []
      points.push({ pointIndex: point.pointIndex, x: point.x ?? 0, y: point.y ?? 0 })
      sourceRoutes.set(point.connectionOccurrenceId, points)
    }
    for (const points of sourceRoutes.values()) {
      points.sort((left, right) => left.pointIndex - right.pointIndex)
    }

    for (const modelId of PROCESS_MODEL_IDS) {
      const model = workingDocument.models.get(modelId)!
      harness = bootCanvas({ document: workingDocument, modelId })
      const registry = harness.canvas.elementRegistry

      for (const occurrence of model.occurrences) {
        const source = sourceBounds.get(occurrence.id)
        const drawn = registry.get(occurrence.id) as unknown as Rect
        expect(source).toBeDefined()
        for (const key of ['x', 'y', 'width', 'height'] as const) {
          const delta = Math.abs(drawn[key] - source![key])
          maxAmlDelta = Math.max(maxAmlDelta, delta)
          maxCssDelta = Math.max(maxCssDelta, delta)
        }
        bounds += 1
      }

      for (const connection of model.connectionOccurrences) {
        const source = sourceRoutes.get(connection.id)
        const drawn = registry.get(connection.id) as unknown as {
          readonly waypoints: readonly { readonly x: number; readonly y: number }[]
        }
        expect(source).toBeDefined()
        expect(drawn.waypoints).toHaveLength(source!.length)
        drawn.waypoints.forEach((point, index) => {
          const expected = source![index]!
          maxAmlDelta = Math.max(
            maxAmlDelta,
            Math.abs(point.x - expected.x),
            Math.abs(point.y - expected.y)
          )
          const graphics = registry.getGraphics(connection.id)
          const matrix = (graphics as SVGGraphicsElement).getScreenCTM()
          if (matrix) {
            const actualX = matrix.a * point.x + matrix.c * point.y + matrix.e
            const actualY = matrix.b * point.x + matrix.d * point.y + matrix.f
            const expectedX = matrix.a * expected.x + matrix.c * expected.y + matrix.e
            const expectedY = matrix.b * expected.x + matrix.d * expected.y + matrix.f
            maxCssDelta = Math.max(
              maxCssDelta,
              Math.abs(actualX - expectedX),
              Math.abs(actualY - expectedY)
            )
          }
        })
        if (
          drawn.waypoints.slice(1).every((point, index) => {
            const previous = drawn.waypoints[index]!
            return point.x === previous.x || point.y === previous.y
          })
        ) {
          orthogonal += 1
        }
        routes += 1
      }

      harness.destroy()
      harness = null
    }

    expect(bounds).toBe(281)
    expect(routes).toBe(269)
    expect(orthogonal).toBe(269)
    expect(maxAmlDelta).toBeLessThanOrEqual(0.01)
    expect(maxCssDelta).toBeLessThanOrEqual(0.5)
  })
})

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

  it('centres every non-NW placement on its route midpoint plus the source offsets', () => {
    // The safety half of the P7 split (fixplan §5.1): CENTER/portless placements keep
    // the EXACT midpoint-centred math — byte-identical to before the NW change.
    let checked = 0
    let nwSkipped = 0
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
          if ((placement.port ?? '').trim().toUpperCase() === CONNECTION_LABEL_PORT_NW) {
            nwSkipped += 1
            return
          }
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
    // 67 of the 123 placements are NW badges, handled by the NW test below.
    expect(nwSkipped).toBe(67)
    expect(checked).toBe(TOTAL_PLACEMENTS - 67)
  })

  it('anchors every NW badge north-west of the source-box contact, above the line (§5.1/§0)', () => {
    // The change half of the P7 split: `Port="NW"` badges hang above-left of the point
    // where the route leaves the source (executor/role) box — the drawn extent's
    // bottom-right pinned inset from that contact — instead of straddling the midpoint.
    // The rule is a PURE function of the drawn route + the letter's own extent: no
    // per-connection constants, no hand-tuned per-letter rects.
    let checked = 0
    for (const modelId of allModelIds()) {
      const model = workingDocument.models.get(modelId)!
      const drawn = new Map(drawLabelsFor(modelId).map((label) => [label.elementId, label]))
      const registry = harness!.canvas.elementRegistry

      model.connectionOccurrences.forEach((connection) => {
        const routeConn = registry.get(connection.id) as unknown as {
          readonly waypoints: readonly { readonly x: number; readonly y: number }[]
        }
        const midpoint = routeMidpoint(routeConn.waypoints)
        connection.attributeOccurrences.forEach((placement, index) => {
          if ((placement.port ?? '').trim().toUpperCase() !== CONNECTION_LABEL_PORT_NW) return
          const id = `${ARIS_CONNECTION_LABEL_PREFIX}${connection.id}:${index}:${placement.attributeType}`
          const label = drawn.get(id)
          expect(label).toBeDefined()
          // A NW badge always draws the derived RACI letter (on `data-aris-raci`),
          // never a symbol. The authored value is empty, so the letter is what the
          // box is sized to — exactly as `syncConnectionLabels` sizes it.
          expect(label!.symbolFlag).toBe('TEXT')
          expect(label!.raci).toMatch(/^[RACI]$/)

          const contact = routeConn.waypoints[0]!
          const font = resolveLabelFont(workingDocument.styleCatalog, placement.fontStyleSheetId)
          expect(font?.fontSize).toBeGreaterThan(0)
          const fontSize = font!.fontSize!
          const expected = connectionLabelRect(
            placement,
            midpoint!,
            { symbolFlag: 'TEXT', text: label!.raci! },
            { point: contact, fontSize }
          )
          // The mounted canvas reproduces the pure-function rect exactly.
          expect(label!.rect.x).toBeCloseTo(expected.x, 6)
          expect(label!.rect.y).toBeCloseTo(expected.y, 6)
          expect(label!.rect.width).toBeCloseTo(expected.width, 6)
          expect(label!.rect.height).toBeCloseTo(expected.height, 6)
          // Bottom-right corner inset up-and-left of the contact point.
          expect(label!.rect.x + label!.rect.width).toBeCloseTo(
            contact.x - CONNECTION_LABEL_NW_INSET_X,
            6
          )
          expect(label!.rect.y + label!.rect.height).toBeCloseTo(
            contact.y - CONNECTION_LABEL_NW_INSET_Y,
            6
          )
          // Never struck through: the whole letter sits above the line …
          expect(label!.rect.y + label!.rect.height).toBeLessThan(contact.y)
          // … and its box is sized to the drawn glyph, not the midpoint caption size.
          expect(label!.rect.height).toBeGreaterThan(20)
          checked += 1
        })
      })
      harness?.destroy()
      harness = null
    }
    expect(checked).toBe(67)
  })

  it('never lets a NW badge rect intersect any occurrence box (fixplan §5.1 risk)', () => {
    // The stated risk of moving all the RACI letters: a badge could collide with a
    // satellite/occurrence box. A box-intersection scan over the synced NW labels
    // proves it does not — across every NW badge in every model, which necessarily
    // covers the register-owner and renew-profile iterate models called out in the
    // brief. Written as a scan, not as hand-authored per-letter rects.
    const overlaps = (a: Rect, b: Rect): boolean =>
      a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
    let nwLabels = 0
    let intersections = 0
    for (const modelId of allModelIds()) {
      const model = workingDocument.models.get(modelId)!
      const nwRects = drawLabelsFor(modelId)
        .filter((label) => (label.port ?? '').trim().toUpperCase() === CONNECTION_LABEL_PORT_NW)
        .map((label) => label.rect)
      nwLabels += nwRects.length
      for (const rect of nwRects) {
        // A non-degenerate letter footprint, or the scan would be vacuous.
        expect(rect.width).toBeGreaterThan(0)
        expect(rect.height).toBeGreaterThan(0)
        for (const occurrence of model.occurrences) {
          if (overlaps(rect, occurrence.bounds)) intersections += 1
        }
      }
      harness?.destroy()
      harness = null
    }
    expect(nwLabels).toBe(67)
    expect(intersections).toBe(0)
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
    // one end — which is where ARIS draws them too. After the P7 change the 67 `Port="NW"` RACI
    // badges now occupy a real letter footprint (they hang above-left of the source-box contact),
    // yet they still overlap nothing — neither another label nor a shape — so both totals hold. The
    // remaining 28 valueless `TEXT` placements draw nothing and occupy nothing.
    expect(labelOnLabel).toBe(0)
    expect(labelOnShape).toBe(7)
  })
})
