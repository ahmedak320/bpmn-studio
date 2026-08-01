// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'

import type { ArisModel, ArisObjectDefinition, ArisWorkingDocument } from '../model/types'
import {
  createEmptyArisDocument,
  createEmptyArisModel,
  localizedValue,
  EMPTY_ARIS_SOURCE_INDEX
} from './emptyDocument'
import { bootCanvas, type Harness } from './testing/harness'

/**
 * Wave 14 P9 (fixplan §9): `processInterfaceShape` used to draw a hit path that matched neither of
 * its two silhouette polygons, and a "surface" polygon whose grey accent slab filled ~35 % of the
 * shape height directly under the caption — reading as a duplicated grey block rather than the DMT
 * original's single grey right-pointing banner with a white inset panel floating on it. This guards
 * the rebuilt geometry: exactly one silhouette polygon (the grey banner, brush-recolourable) and one
 * rounded-rect white surface strictly inset on all four sides, with the caption centred inside it.
 *
 * 509×299 is the fixture instance size: `ObjOcc.3hdu6F9MD0n-u-L--7w6ZOgNqjLW-x-L-33-c` in the
 * AnimalWF export, the sole ST_PRCS_IF occurrence (not expectation-covered, so the animalwf suites
 * stay green across this redraw).
 */

const MODEL_ID = 'Model.process-interface'
const OCC_ID = 'ObjOcc.process-interface'
const WIDTH = 509
const HEIGHT = 299

let harness: Harness | null = null

afterEach(() => {
  harness?.destroy()
  harness = null
})

function documentWith(fillColor: string | null): ArisWorkingDocument {
  const definition: ArisObjectDefinition = Object.freeze({
    id: 'ObjDef.process-interface',
    type: 'OT_FUNC',
    defaultSymbol: 'ST_PRCS_IF',
    names: localizedValue('Prior process/Subsequent process'),
    attributes: Object.freeze([]),
    linkedModelIds: Object.freeze([]),
    rawAttributes: Object.freeze({})
  })

  const base = createEmptyArisModel({ id: MODEL_ID, type: 'MT_EEPC', name: 'Process interface' })
  const model: ArisModel = Object.freeze({
    ...base,
    occurrences: Object.freeze([
      Object.freeze({
        id: OCC_ID,
        definitionId: definition.id,
        modelId: MODEL_ID,
        symbol: 'ST_PRCS_IF',
        bounds: Object.freeze({ x: 0, y: 0, width: WIDTH, height: HEIGHT }),
        style: Object.freeze({
          symbol: 'ST_PRCS_IF',
          fillColor,
          strokeColor: null,
          strokeWidth: null,
          lineStyle: null,
          fontStyleSheetId: null,
          zOrder: null
        }),
        attributeOccurrences: Object.freeze([]),
        rawAttributes: Object.freeze({})
      })
    ])
  })

  const empty = createEmptyArisDocument({ models: [model] })
  return Object.freeze({
    ...empty,
    objectDefinitions: Object.freeze(new Map([[definition.id, definition]])),
    sourceIndex: EMPTY_ARIS_SOURCE_INDEX
  })
}

function occurrenceGroup(): Element {
  const gfx = harness!.canvas.elementRegistry.getGraphics(OCC_ID)
  const group = gfx.querySelector('[data-aris-kind="occurrence"]')
  if (!group) throw new Error('No process-interface occurrence rendered.')
  return group
}

function polygonBounds(polygon: Element): {
  readonly minX: number
  readonly maxX: number
  readonly minY: number
  readonly maxY: number
} {
  const points = (polygon.getAttribute('points') ?? '')
    .trim()
    .split(/\s+/)
    .map((pair) => {
      const [x, y] = pair.split(',').map(Number)
      return { x: x ?? 0, y: y ?? 0 }
    })
  return {
    minX: Math.min(...points.map((point) => point.x)),
    maxX: Math.max(...points.map((point) => point.x)),
    minY: Math.min(...points.map((point) => point.y)),
    maxY: Math.max(...points.map((point) => point.y))
  }
}

describe('processInterfaceShape — grey banner with an inset white panel (Wave 14 P9)', () => {
  it('renders exactly one silhouette polygon and one rounded-rect surface, strictly inset on all four sides, at 509×299', () => {
    harness = bootCanvas({ document: documentWith(null), modelId: MODEL_ID })
    const group = occurrenceGroup()

    const silhouettes = group.querySelectorAll('polygon[data-aris-part="silhouette"]')
    expect(silhouettes).toHaveLength(1)
    const surfaces = group.querySelectorAll('rect[data-aris-part="surface"]')
    expect(surfaces).toHaveLength(1)
    // The old duplicated-slab geometry drew the surface as a second polygon — confirm there is
    // now only ever the one (the silhouette).
    expect(group.querySelectorAll('polygon')).toHaveLength(1)

    const silhouette = polygonBounds(silhouettes[0]!)
    const surface = surfaces[0]!
    const surfaceX = Number(surface.getAttribute('x'))
    const surfaceY = Number(surface.getAttribute('y'))
    const surfaceWidth = Number(surface.getAttribute('width'))
    const surfaceHeight = Number(surface.getAttribute('height'))

    expect(surfaceX).toBeGreaterThan(silhouette.minX)
    expect(surfaceY).toBeGreaterThan(silhouette.minY)
    expect(surfaceX + surfaceWidth).toBeLessThan(silhouette.maxX)
    expect(surfaceY + surfaceHeight).toBeLessThan(silhouette.maxY)

    // A rounded rect, not a sharp-cornered one.
    expect(Number(surface.getAttribute('rx'))).toBeGreaterThan(0)
    expect(Number(surface.getAttribute('ry'))).toBeGreaterThan(0)
    expect(surface.getAttribute('fill')).toBe('#ffffff')
  })

  it('centers the caption inside the white surface', () => {
    harness = bootCanvas({ document: documentWith(null), modelId: MODEL_ID })
    const group = occurrenceGroup()
    const surface = group.querySelector('rect[data-aris-part="surface"]')!
    const surfaceX = Number(surface.getAttribute('x'))
    const surfaceY = Number(surface.getAttribute('y'))
    const surfaceWidth = Number(surface.getAttribute('width'))
    const surfaceHeight = Number(surface.getAttribute('height'))

    const caption = group.querySelector('[data-aris-part="content"]')
    expect(caption).not.toBeNull()
    const captionX = Number(caption!.getAttribute('x'))
    const captionY = Number(caption!.getAttribute('y'))
    expect(captionX).toBeGreaterThanOrEqual(surfaceX)
    expect(captionX).toBeLessThanOrEqual(surfaceX + surfaceWidth)
    expect(captionY).toBeGreaterThanOrEqual(surfaceY)
    expect(captionY).toBeLessThanOrEqual(surfaceY + surfaceHeight)
  })

  it('lets a source brush (cccccc) recolour the silhouette accent but leaves the white surface untouched', () => {
    harness = bootCanvas({ document: documentWith('cccccc'), modelId: MODEL_ID })
    const group = occurrenceGroup()
    const silhouette = group.querySelector('polygon[data-aris-part="silhouette"]')!
    const surface = group.querySelector('rect[data-aris-part="surface"]')!
    expect(silhouette.getAttribute('fill')).toBe('#cccccc')
    expect(surface.getAttribute('fill')).toBe('#ffffff')
  })
})
