// @vitest-environment jsdom

/**
 * Lane bands — Plan Section 12.4.
 *
 * These assertions are deliberately about *rendered geometry relative to the
 * model's own content*, not about constants. The bug they cover shipped past a
 * green suite: every existing lane test asserted a band's height equalled the
 * `EndBorder` it was given, which is exactly what made a real export's
 * `StartBorder=0 EndBorder=50000` render a 50000-unit frame around 6500 units
 * of content and shrink every symbol to two pixels.
 */

import { afterEach, describe, expect, it } from 'vitest'

import {
  laneBandBounds,
  laneOrientation,
  modelContentBounds,
  LANE_DEFAULT_THICKNESS
} from './canvasSync'
import { arisBusinessObject, laneElementId } from './elements'
import { buildLayoutGraph } from './layoutSeam'
import { bootCanvas, importedLikeDocument, shape, type Harness } from './testing/harness'
import type { ArisLaneBusinessObject } from './elements'

let harness: Harness | null = null

afterEach(() => {
  harness?.destroy()
  harness = null
})

/** The AnimalWF lane pair: one row, one column, both spanning the whole canvas. */
const FULL_CANVAS_LANES = [
  { id: 'Lane.h', orientation: 'HORIZONTAL', startBorder: 0, endBorder: 50000 },
  { id: 'Lane.v', orientation: 'VERTICAL', startBorder: 0, endBorder: 50000 }
] as const

describe('lane orientation is read case-insensitively (D2)', () => {
  it.each([
    ['VERTICAL', 'vertical'],
    ['vertical', 'vertical'],
    ['Vertical', 'vertical'],
    [' VERTICAL ', 'vertical'],
    ['HORIZONTAL', 'horizontal'],
    ['horizontal', 'horizontal'],
    [null, 'horizontal'],
    ['', 'horizontal']
  ])('%s reads as %s', (written, expected) => {
    expect(laneOrientation(written)).toBe(expected)
  })

  it('gives an imported HORIZONTAL/VERTICAL pair two different bands', () => {
    const imported = importedLikeDocument({ lanes: FULL_CANVAS_LANES })
    harness = bootCanvas({ document: imported.document, modelId: imported.modelId })
    const { canvas } = harness

    const bands = FULL_CANVAS_LANES.map((lane) => shape(canvas, laneElementId(lane.id)))
    const orientations = bands.map(
      (band) => (arisBusinessObject(band) as ArisLaneBusinessObject).orientation
    )
    expect(orientations).toEqual(['horizontal', 'vertical'])

    const geometry = bands.map((band) => `${band.x}:${band.y}:${band.width}:${band.height}`)
    expect(new Set(geometry).size).toBe(bands.length)
  })

  it('passes the imported orientation through the clean-layout seam', () => {
    const imported = importedLikeDocument({ lanes: FULL_CANVAS_LANES })
    const model = imported.document.models.get(imported.modelId)
    if (!model) throw new Error('missing model')
    expect(buildLayoutGraph(imported.document, model).lanes).toEqual([
      { id: 'Lane.h', orientation: 'horizontal' },
      { id: 'Lane.v', orientation: 'vertical' }
    ])
  })
})

describe('lane band extents come from the content (D3)', () => {
  it('never dwarfs the content it decorates', () => {
    const imported = importedLikeDocument({ lanes: FULL_CANVAS_LANES })
    harness = bootCanvas({ document: imported.document, modelId: imported.modelId })
    const { canvas } = harness
    const model = canvas.document.models.get(imported.modelId)
    if (!model) throw new Error('missing model')
    const content = modelContentBounds(model)
    if (!content) throw new Error('missing content bounds')

    for (const lane of FULL_CANVAS_LANES) {
      const band = shape(canvas, laneElementId(lane.id))
      // The band that made the product unreadable was 8x-17x the content
      // height. A band is decoration: it may not exceed what it decorates.
      expect(band.width).toBeLessThanOrEqual(content.width)
      expect(band.height).toBeLessThanOrEqual(content.height)
      // ...and it has to sit on the content, not next to it.
      expect(band.x).toBeGreaterThanOrEqual(content.x)
      expect(band.y).toBeGreaterThanOrEqual(content.y)
      expect(band.x + band.width).toBeLessThanOrEqual(content.x + content.width)
      expect(band.y + band.height).toBeLessThanOrEqual(content.y + content.height)
    }
  })

  it('runs a band the full length of the content, whatever that length is', () => {
    for (const width of [900, 5000, 41000]) {
      const content = { x: 1000, y: 2000, width, height: 6500 }
      const band = laneBandBounds(
        { orientation: 'HORIZONTAL', startBorder: 0, endBorder: 50000 },
        0,
        content
      )
      expect(band.x).toBe(content.x)
      expect(band.width).toBe(content.width)
    }
  })

  it('treats a full-canvas Start/EndBorder as no explicit band', () => {
    const content = { x: 1000, y: 1000, width: 5000, height: 6500 }
    const band = laneBandBounds(
      { orientation: 'HORIZONTAL', startBorder: 0, endBorder: 50000 },
      0,
      content
    )
    expect(band.height).toBe(LANE_DEFAULT_THICKNESS)
    expect(band.y).toBe(content.y)
  })

  it('keeps a Start/EndBorder pair that really does locate a band', () => {
    const content = { x: 1000, y: 1000, width: 5000, height: 6500 }
    const horizontal = laneBandBounds(
      { orientation: 'HORIZONTAL', startBorder: 2000, endBorder: 2600 },
      0,
      content
    )
    expect(horizontal).toMatchObject({ x: 1000, y: 2000, width: 5000, height: 600 })

    const vertical = laneBandBounds(
      { orientation: 'VERTICAL', startBorder: 2000, endBorder: 2600 },
      0,
      content
    )
    expect(vertical).toMatchObject({ x: 2000, y: 1000, width: 600, height: 6500 })
  })

  it('clips a band that overhangs the content and drops one that misses it', () => {
    const content = { x: 1000, y: 1000, width: 5000, height: 6500 }
    const clipped = laneBandBounds(
      { orientation: 'HORIZONTAL', startBorder: 3000, endBorder: 90000 },
      0,
      content
    )
    expect(clipped.y).toBe(3000)
    expect(clipped.y + clipped.height).toBe(content.y + content.height)

    const missed = laneBandBounds(
      { orientation: 'HORIZONTAL', startBorder: 40000, endBorder: 41000 },
      0,
      content
    )
    expect(missed.height).toBe(LANE_DEFAULT_THICKNESS)
    expect(missed.y).toBe(content.y)
  })

  it('stacks same-orientation lanes without an explicit band so none collide', () => {
    const content = { x: 0, y: 0, width: 4000, height: 4000 }
    const lanes = [0, 1, 2].map((index) =>
      laneBandBounds(
        { orientation: 'HORIZONTAL', startBorder: 0, endBorder: 50000 },
        index,
        content
      )
    )
    expect(new Set(lanes.map((band) => band.y)).size).toBe(3)
  })

  it('falls back to a notional canvas when the model places nothing', () => {
    const band = laneBandBounds(
      { orientation: 'horizontal', startBorder: 0, endBorder: 300 },
      0,
      null
    )
    expect(band).toMatchObject({ x: 0, y: 0, width: 1200, height: 300 })
  })

  it('measures content bounds from occurrences, not from lanes', () => {
    const imported = importedLikeDocument({
      lanes: FULL_CANVAS_LANES,
      extent: { x: 1000, y: 2000, width: 5000, height: 6500 },
      symbolSize: { width: 300, height: 150 }
    })
    const model = imported.document.models.get(imported.modelId)
    if (!model) throw new Error('missing model')
    expect(modelContentBounds(model)).toEqual({ x: 1000, y: 2000, width: 5000, height: 6500 })
  })

  it('returns no content bounds for a model that places nothing', () => {
    harness = bootCanvas()
    const model = harness.canvas.document.models.get(harness.canvas.activeModelId)
    if (!model) throw new Error('missing model')
    expect(modelContentBounds(model)).toBeNull()
  })

  it('leaves imported occurrence coordinates untouched (Section 12.4)', () => {
    const imported = importedLikeDocument({ lanes: FULL_CANVAS_LANES })
    harness = bootCanvas({ document: imported.document, modelId: imported.modelId })
    const { canvas } = harness
    const model = canvas.document.models.get(imported.modelId)
    if (!model) throw new Error('missing model')

    for (const occurrence of model.occurrences) {
      expect(shape(canvas, occurrence.id)).toMatchObject({
        x: occurrence.bounds.x,
        y: occurrence.bounds.y,
        width: occurrence.bounds.width,
        height: occurrence.bounds.height
      })
    }
  })
})
