// @vitest-environment jsdom

/**
 * Free-text notes under the three layout modes — plan §12.4, §14.4 step 10.
 *
 * Clean Layout re-places every occurrence, so a note that keeps its imported
 * coordinates ends up commenting on empty space or sitting on top of a shape.
 * These tests pin the three things that has to be true of the fix:
 *
 * 1. Clean Layout moves notes, as one undoable gesture with everything else.
 * 2. Moving a note never writes a size. A real `<FFTextOcc>` carries no
 *    `<Size>`; if the layout wrote one, the derived AML export would insert an
 *    element the source never had.
 * 3. Reset to Source Layout puts every note back on its imported coordinates
 *    exactly, not approximately.
 */

import { afterEach, describe, expect, it } from 'vitest'

import { cleanLayout } from '../layout'
import { freeTextBounds } from './canvasSync'
import { freeTextElementId } from './elements'
import type { ArisLayoutSeamGraph, ArisLayoutSeamResult } from './layoutSeam'
import { buildLayoutGraph } from './layoutSeam'
import { bootCanvas, importedLikeDocument, shape, type Harness } from './testing/harness'
import type { ArisModel } from '../model/types'

let harness: Harness | null = null

afterEach(() => {
  harness?.destroy()
  harness = null
})

/** The engine `ArisStudioTab` installs for "Reset to Source Layout". */
function resetEngine(original: ArisModel): (graph: ArisLayoutSeamGraph) => ArisLayoutSeamResult {
  return () => ({
    nodes: original.occurrences.map((occurrence) => ({
      id: occurrence.id,
      rect: occurrence.bounds
    })),
    edges: original.connectionOccurrences.map((connection) => ({
      id: connection.id,
      points: connection.route
    })),
    annotations: original.freeText.map((text) => ({ id: text.id, rect: text.bounds }))
  })
}

function importedHarness(): {
  readonly imported: ReturnType<typeof importedLikeDocument>
  readonly original: ArisModel
} {
  const imported = importedLikeDocument({
    occurrences: 9,
    // Every note starts on top of the first occurrence, which is the shape the
    // clean layout is most likely to move somewhere else.
    freeText: [
      { x: 1000, y: 1000, width: 0, height: 0 },
      { x: 1020, y: 1020, width: 0, height: 0 },
      { x: 1040, y: 1040, width: 420, height: 80 }
    ]
  })
  harness = bootCanvas({ document: imported.document, modelId: imported.modelId })
  const original = imported.document.models.get(imported.modelId) as ArisModel
  return { imported, original }
}

describe('free-text notes and the layout modes', () => {
  it('hands the layout the box the canvas draws, not the empty source size', () => {
    const { imported, original } = importedHarness()
    const graph = buildLayoutGraph(imported.document, original)
    expect(graph.annotations).toHaveLength(3)
    // An unsized note is handed to the layout at its rendered extent, so the
    // engine reserves the space the user actually sees.
    expect(graph.annotations?.[0]?.rect).toEqual(freeTextBounds(original.freeText[0]!.bounds))
    expect(graph.annotations?.[0]?.rect.width).toBeGreaterThan(0)
    expect(graph.annotations?.[2]?.rect).toMatchObject({ width: 420, height: 80 })
  })

  it('moves notes as part of the one clean-layout gesture, without sizing them', () => {
    const { original } = importedHarness()
    const canvas = (harness as Harness).canvas
    const before = canvas.commandLog.length

    canvas.applyCleanLayout((graph) => cleanLayout(graph))

    const live = canvas.document.models.get(canvas.activeModelId) as ArisModel
    expect(live.freeText).toHaveLength(3)
    // The stored extent is byte-identical: an unsized note is still unsized,
    // so the derived export never gains a `<Size>` element.
    original.freeText.forEach((note, index) => {
      expect(live.freeText[index]?.bounds.width).toBe(note.bounds.width)
      expect(live.freeText[index]?.bounds.height).toBe(note.bounds.height)
    })
    // …and at least one of them actually moved.
    expect(
      live.freeText.some(
        (note, index) =>
          note.bounds.x !== original.freeText[index]?.bounds.x ||
          note.bounds.y !== original.freeText[index]?.bounds.y
      )
    ).toBe(true)

    // One undoable gesture, and undo restores the imported coordinates.
    expect(canvas.commandLog.length).toBeGreaterThan(before)
    canvas.undo()
    const undone = canvas.document.models.get(canvas.activeModelId) as ArisModel
    expect(undone.freeText.map((note) => note.bounds)).toEqual(
      original.freeText.map((note) => note.bounds)
    )
  })

  it('renders every note where the clean layout put it', () => {
    const { original } = importedHarness()
    const canvas = (harness as Harness).canvas
    canvas.applyCleanLayout((graph) => cleanLayout(graph))
    const live = canvas.document.models.get(canvas.activeModelId) as ArisModel
    for (const note of live.freeText) {
      const drawn = shape(canvas, freeTextElementId(note.id))
      const expected = freeTextBounds(note.bounds)
      expect({ x: drawn.x, y: drawn.y, width: drawn.width, height: drawn.height }).toEqual(expected)
    }
    expect(live.freeText.length).toBe(original.freeText.length)
  })

  it('restores every imported note coordinate exactly on reset', () => {
    const { original } = importedHarness()
    const canvas = (harness as Harness).canvas

    canvas.applyCleanLayout((graph) => cleanLayout(graph))
    canvas.applyCleanLayout((graph) => cleanLayout(graph))
    canvas.applyCleanLayout(resetEngine(original))

    const live = canvas.document.models.get(canvas.activeModelId) as ArisModel
    expect(live.freeText.map((note) => note.bounds)).toEqual(
      original.freeText.map((note) => note.bounds)
    )
    expect(live.occurrences.map((occurrence) => occurrence.bounds)).toEqual(
      original.occurrences.map((occurrence) => occurrence.bounds)
    )
  })

  it('ignores a note the engine invented and leaves the rest alone', () => {
    const { original } = importedHarness()
    const canvas = (harness as Harness).canvas
    expect(() =>
      canvas.applyCleanLayout(() => ({
        nodes: [],
        edges: [],
        annotations: [
          { id: 'FFTextOcc.does-not-exist', rect: { x: 1, y: 2, width: 3, height: 4 } },
          { id: original.freeText[0]!.id, rect: { x: 77, y: 88, width: 3, height: 4 } }
        ]
      }))
    ).not.toThrow()
    const live = canvas.document.models.get(canvas.activeModelId) as ArisModel
    expect(live.freeText[0]?.bounds).toMatchObject({ x: 77, y: 88, width: 0, height: 0 })
  })
})
