// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'

import type { Element } from 'diagram-js/lib/model/Types'

import { resolveArisSymbol } from '../symbols'
import { findOccurrence } from './commandFactory'
import { bootCanvas, importedLikeDocument, shape, type Harness } from './testing/harness'

let harness: Harness | null = null

afterEach(() => {
  harness?.destroy()
  harness = null
})

/**
 * The registry's real current default bounds for `epc.function`
 * (`MT_EEPC:OT_FUNC:ST_FUNC`), resolved rather than hardcoded so this suite
 * tracks the registry instead of re-asserting a magic number that drifts out
 * from under it (Wave 9 already moved this descriptor's height once).
 */
const FUNCTION_DEFAULT_BOUNDS = resolveArisSymbol({
  modelType: 'MT_EEPC',
  objectType: 'OT_FUNC',
  symbolNum: 'ST_FUNC'
}).descriptor.defaultBounds

describe('ArisResizeBehavior — minimum block size on resize (issue 8)', () => {
  it("sets context.minDimensions to the function descriptor's default bounds on resize.start", () => {
    harness = bootCanvas()
    const { canvas } = harness
    const created = canvas.authoring.createObject({
      objectType: 'OT_FUNC',
      position: { x: 0, y: 0 }
    })
    const element = shape(canvas, created.occurrenceId)

    const context: {
      shape: Element
      direction: string
      minDimensions?: { width: number; height: number }
    } = { shape: element, direction: 'se' }
    canvas.eventBus.fire('resize.start', { context })

    expect(context.minDimensions).toEqual(FUNCTION_DEFAULT_BOUNDS)
  })

  it('floors modeling.resizeShape at the default bounds for an occurrence', () => {
    harness = bootCanvas()
    const { canvas } = harness
    const created = canvas.authoring.createObject({
      objectType: 'OT_FUNC',
      position: { x: 0, y: 0 }
    })
    const element = shape(canvas, created.occurrenceId)

    canvas.modeling.resizeShape(element, { x: 0, y: 0, width: 30, height: 20 })

    expect(findOccurrence(canvas.document, created.occurrenceId)?.bounds).toEqual({
      x: 0,
      y: 0,
      width: FUNCTION_DEFAULT_BOUNDS.width,
      height: FUNCTION_DEFAULT_BOUNDS.height
    })
    const resized = shape(canvas, created.occurrenceId)
    expect([resized.x, resized.y, resized.width, resized.height]).toEqual([
      0,
      0,
      FUNCTION_DEFAULT_BOUNDS.width,
      FUNCTION_DEFAULT_BOUNDS.height
    ])
  })

  it('passes a 400x300 resize through unchanged (above the default bounds)', () => {
    harness = bootCanvas()
    const { canvas } = harness
    const created = canvas.authoring.createObject({
      objectType: 'OT_FUNC',
      position: { x: 0, y: 0 }
    })
    const element = shape(canvas, created.occurrenceId)

    canvas.modeling.resizeShape(element, { x: 0, y: 0, width: 400, height: 300 })

    expect(findOccurrence(canvas.document, created.occurrenceId)?.bounds).toEqual({
      x: 0,
      y: 0,
      width: 400,
      height: 300
    })
  })

  it('leaves an imported 646x150 occurrence verbatim on reload', () => {
    const imported = importedLikeDocument({
      occurrences: 1,
      symbolSize: { width: 646, height: 150 }
    })
    harness = bootCanvas({ document: imported.document, modelId: imported.modelId })
    const { canvas } = harness
    const occurrenceId = imported.occurrenceIds[0]!

    expect(findOccurrence(canvas.document, occurrenceId)?.bounds).toEqual({
      x: imported.extent.x,
      y: imported.extent.y,
      width: 646,
      height: 150
    })
    const element = shape(canvas, occurrenceId)
    expect([element.width, element.height]).toEqual([646, 150])
  })

  it('leaves authoring.resizeOccurrence (the programmatic path) unclamped at 20x20', () => {
    harness = bootCanvas()
    const { canvas } = harness
    const created = canvas.authoring.createObject({
      objectType: 'OT_FUNC',
      position: { x: 0, y: 0 }
    })

    canvas.authoring.resizeOccurrence(created.occurrenceId, { width: 20, height: 20 })

    expect(findOccurrence(canvas.document, created.occurrenceId)?.bounds).toMatchObject({
      width: 20,
      height: 20
    })
  })
})
