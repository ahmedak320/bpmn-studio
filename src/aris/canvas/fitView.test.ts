// @vitest-environment jsdom

/**
 * Fit-to-viewport and rendered legibility — Plan Section 11.1, Section 19.4.
 *
 * The unit suite used to assert that elements existed and that geometry
 * round-tripped, which stayed green while the product rendered every imported
 * model at 1.5% zoom. So these assertions are about *how large a symbol is on
 * screen* after the product's own Zoom Fit, measured against a known viewport.
 */

import { afterEach, describe, expect, it } from 'vitest'

import { externalNamePlacement } from './canvasSync'
import { freeTextElementId, labelElementId, laneElementId } from './elements'
import { arisContentBounds, arisFitViewbox, isArisContentElement } from './fitView'
import { bootCanvas, importedLikeDocument, shape, type Harness } from './testing/harness'
import type { Element, Shape } from 'diagram-js/lib/model/Types'

let harness: Harness | null = null

afterEach(() => {
  harness?.destroy()
  harness = null
})

/** The fixed viewport Phase 16 measures every model at. */
const VIEWPORT = { width: 1600, height: 1000 }

/**
 * The floor Phase 16 uses: a symbol drawn smaller than this cannot carry a
 * legible caption. The models here should clear it by a wide margin.
 */
const MIN_READABLE_SHAPE_PX = 6

const FULL_CANVAS_LANES = [
  { id: 'Lane.h', orientation: 'HORIZONTAL', startBorder: 0, endBorder: 50000 },
  { id: 'Lane.v', orientation: 'VERTICAL', startBorder: 0, endBorder: 50000 }
] as const

function medianShapeHeightPx(canvas: Harness['canvas'], ids: readonly string[]): number {
  const scale = canvas.canvas.zoom()
  const heights = ids
    .map((id) => shape(canvas, id).height * scale)
    .sort((left, right) => left - right)
  return heights[Math.floor(heights.length / 2)] ?? 0
}

describe('Zoom Fit fits the content, not the furniture (D4)', () => {
  it('renders a comfortably legible symbol for an import-sized model', () => {
    const imported = importedLikeDocument({ lanes: FULL_CANVAS_LANES })
    harness = bootCanvas({
      document: imported.document,
      modelId: imported.modelId,
      viewport: VIEWPORT
    })
    const { canvas } = harness

    const scale = canvas.zoom('fit-viewport')
    // Content is 5000x6500 units in a 1600x1000 viewport, so the fit is
    // height-bound at roughly 0.148 — not the 0.015 a 50000-unit frame forced.
    expect(scale).toBeGreaterThan(0.1)
    const median = medianShapeHeightPx(canvas, imported.occurrenceIds)
    expect(median).toBeGreaterThan(MIN_READABLE_SHAPE_PX)
    expect(median).toBeGreaterThan(9.6)
  })

  it('reaches exactly the same zoom with and without lane bands', () => {
    const withLanes = importedLikeDocument({ lanes: FULL_CANVAS_LANES })
    const withoutLanes = importedLikeDocument()

    harness = bootCanvas({
      document: withLanes.document,
      modelId: withLanes.modelId,
      viewport: VIEWPORT
    })
    const banded = harness.canvas.zoom('fit-viewport')
    harness.destroy()

    harness = bootCanvas({
      document: withoutLanes.document,
      modelId: withoutLanes.modelId,
      viewport: VIEWPORT
    })
    const bare = harness.canvas.zoom('fit-viewport')

    // Decoration may never change how large the diagram is drawn.
    expect(banded).toBe(bare)
  })

  it('ignores a frame that reaches far past the content', () => {
    const imported = importedLikeDocument({ lanes: FULL_CANVAS_LANES })
    harness = bootCanvas({
      document: imported.document,
      modelId: imported.modelId,
      viewport: VIEWPORT
    })
    const { canvas } = harness
    const before = canvas.zoom('fit-viewport')

    // Blow one band up to the 50000-unit frame a literal reading of
    // `EndBorder="50000"` produced, and repaint it. Decoration of any size must
    // leave the fit — and therefore the on-screen size of every symbol — alone.
    const band = shape(canvas, laneElementId('Lane.h')) as Shape
    band.width = 1200
    band.height = 50000
    canvas.eventBus.fire('elements.changed', { elements: [band] })

    expect(canvas.zoom('fit-viewport')).toBe(before)
    expect(medianShapeHeightPx(canvas, imported.occurrenceIds)).toBeGreaterThan(9.6)
  })

  it('stays legible when the content is far from the origin', () => {
    const imported = importedLikeDocument({
      lanes: FULL_CANVAS_LANES,
      extent: { x: 24000, y: 31000, width: 4000, height: 5000 }
    })
    harness = bootCanvas({
      document: imported.document,
      modelId: imported.modelId,
      viewport: VIEWPORT
    })
    const { canvas } = harness
    canvas.zoom('fit-viewport')
    expect(medianShapeHeightPx(canvas, imported.occurrenceIds)).toBeGreaterThan(
      MIN_READABLE_SHAPE_PX
    )
  })

  it('does not move the occurrences it zooms to (Section 12.4)', () => {
    const imported = importedLikeDocument({ lanes: FULL_CANVAS_LANES })
    harness = bootCanvas({
      document: imported.document,
      modelId: imported.modelId,
      viewport: VIEWPORT
    })
    const { canvas } = harness
    const model = canvas.document.models.get(imported.modelId)
    if (!model) throw new Error('missing model')
    canvas.zoom('fit-viewport')
    for (const occurrence of model.occurrences) {
      expect(shape(canvas, occurrence.id)).toMatchObject({
        x: occurrence.bounds.x,
        y: occurrence.bounds.y
      })
    }
  })

  it('still fits an empty canvas without dividing by zero', () => {
    harness = bootCanvas({ viewport: VIEWPORT })
    expect(Number.isFinite(harness.canvas.zoom('fit-viewport'))).toBe(true)
  })
})

describe('content bounds exclude derived furniture', () => {
  it('ignores lane frames and the model root', () => {
    const imported = importedLikeDocument({ lanes: FULL_CANVAS_LANES })
    harness = bootCanvas({
      document: imported.document,
      modelId: imported.modelId,
      viewport: VIEWPORT
    })
    const { canvas } = harness
    const all = canvas.elementRegistry.getAll() as Element[]
    expect(all.some((element) => !isArisContentElement(element))).toBe(true)

    const bounds = arisContentBounds(all)
    expect(bounds).toEqual({ x: 1000, y: 1000, width: 5000, height: 6500 })
  })

  it('has no bounds when nothing is placed', () => {
    expect(arisContentBounds([])).toBeNull()
  })
})

describe('fit viewbox maths', () => {
  const outer = { width: 1600, height: 1000 }

  it('is the smaller of the two axis ratios, with padding', () => {
    const box = arisFitViewbox({ x: 0, y: 0, width: 5000, height: 6500 }, outer)
    const scale = Math.min(outer.width / box.width, outer.height / box.height)
    expect(scale).toBeCloseTo(1000 / (6500 * 1.04), 6)
  })

  it('centres the content it fits', () => {
    const box = arisFitViewbox({ x: 1000, y: 2000, width: 4000, height: 4000 }, outer)
    expect(box.x + box.width / 2).toBeCloseTo(3000, 6)
    expect(box.y + box.height / 2).toBeCloseTo(4000, 6)
  })

  it('never zooms in past 1:1', () => {
    const box = arisFitViewbox({ x: 0, y: 0, width: 40, height: 20 }, outer)
    const scale = Math.min(outer.width / box.width, outer.height / box.height)
    expect(scale).toBeCloseTo(1, 6)
  })

  it('survives a content box with no extent', () => {
    const box = arisFitViewbox({ x: 10, y: 10, width: 0, height: 0 }, outer)
    expect(box.width).toBeGreaterThan(0)
    expect(box.height).toBeGreaterThan(0)
  })
})

describe('captions and notes with no explicit size (D5)', () => {
  it('renders a caption the export sized 0x0 at the default size', () => {
    const imported = importedLikeDocument({
      externalLabel: { offsetX: 200, offsetY: -120, width: 0, height: 0 }
    })
    harness = bootCanvas({ document: imported.document, modelId: imported.modelId })
    const label = shape(harness.canvas, labelElementId(imported.occurrenceIds[0] as string))
    expect(label.width).toBeGreaterThan(0)
    expect(label.height).toBeGreaterThan(0)
    expect(label).toMatchObject({ width: 120, height: 24 })
  })

  it('keeps a caption size the export really did set', () => {
    const imported = importedLikeDocument({
      externalLabel: { offsetX: 200, offsetY: -120, width: 180, height: 40 }
    })
    harness = bootCanvas({ document: imported.document, modelId: imported.modelId })
    const label = shape(harness.canvas, labelElementId(imported.occurrenceIds[0] as string))
    expect(label).toMatchObject({ width: 180, height: 40 })
  })

  it('reports a non-positive size as absent rather than as zero', () => {
    const imported = importedLikeDocument({
      externalLabel: { offsetX: 200, offsetY: -120, width: 0, height: -5 }
    })
    const model = imported.document.models.get(imported.modelId)
    const occurrence = model?.occurrences[0]
    if (!occurrence) throw new Error('missing occurrence')
    expect(externalNamePlacement(occurrence)).toMatchObject({ width: null, height: null })
  })

  it('draws a free-text note the export gave no Size at a default size', () => {
    const imported = importedLikeDocument({
      // Exactly what `<FFTextOcc><Position/></FFTextOcc>` projects to.
      freeText: [{ x: 2000, y: 2000, width: 0, height: 0 }]
    })
    harness = bootCanvas({ document: imported.document, modelId: imported.modelId })
    const note = shape(harness.canvas, freeTextElementId(imported.freeTextIds[0] as string))
    expect(note).toMatchObject({ x: 2000, y: 2000, width: 160, height: 32 })
  })

  it('keeps a free-text size the export really did set', () => {
    const imported = importedLikeDocument({
      freeText: [{ x: 2000, y: 2000, width: 400, height: 90 }]
    })
    harness = bootCanvas({ document: imported.document, modelId: imported.modelId })
    const note = shape(harness.canvas, freeTextElementId(imported.freeTextIds[0] as string))
    expect(note).toMatchObject({ width: 400, height: 90 })
  })

  it('leaves no content shape without an extent', () => {
    const imported = importedLikeDocument({
      externalLabel: { offsetX: 200, offsetY: -120, width: 0, height: 0 },
      freeText: [
        { x: 2000, y: 2000, width: 0, height: 0 },
        { x: 3000, y: 4000, width: 0, height: 0 }
      ]
    })
    harness = bootCanvas({
      document: imported.document,
      modelId: imported.modelId,
      viewport: VIEWPORT
    })
    const { canvas } = harness
    // A 0x0 caption is invisible; no content shape may render with no extent.
    for (const element of canvas.elementRegistry.getAll() as Element[]) {
      if (!isArisContentElement(element)) continue
      const box = element as { width?: number; height?: number; waypoints?: unknown }
      if (box.waypoints) continue
      expect(box.width).toBeGreaterThan(0)
      expect(box.height).toBeGreaterThan(0)
    }
  })
})
