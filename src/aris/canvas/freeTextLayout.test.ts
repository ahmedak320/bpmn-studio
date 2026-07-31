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
import { buildFromSource } from '../model/buildFromSource'
import { buildSemanticArisDocument } from '../source/semanticIndex'
import { tokenizeXmlDocument } from '../source/xmlTokenizer'
import { FREE_TEXT_DEFAULT_HEIGHT, freeTextBounds } from './canvasSync'
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

/**
 * Wave 9 P6 (fixplan §3.5) — a note with an explicit `Size.dX>0` anchors its
 * box BY ITS ALIGNMENT at `Position`, instead of always reading `Position` as
 * the box's top-left. The Reference-Laws title is the exact source record
 * that exposed the bug: `FFTextOcc (6267,551) Size.dX=544 dY=0
 * Alignment=CENTER`. Read as a top-left, the box spans 6267..6811 and the
 * PDF's own centred text clips out of its 742-wide frame; ARIS actually
 * centres the box (and the text within it) ON x=6267.
 */
describe('Wave 9 P6: a sized note anchors its box by alignment at Position', () => {
  // The exact numbers off the source record (fixplan §3.5, §0 ground truth).
  const REFERENCE_LAWS_BOUNDS = { x: 6267, y: 551, width: 544, height: 0 }

  it('CENTER anchors the box centre at Position: box.x = pos.x - dX/2', () => {
    expect(freeTextBounds(REFERENCE_LAWS_BOUNDS, 'CENTER')).toEqual({
      x: 5995,
      y: 551,
      width: 544,
      height: FREE_TEXT_DEFAULT_HEIGHT
    })
  })

  it('RIGHT anchors the box at its right edge: box.x = pos.x - dX', () => {
    expect(freeTextBounds(REFERENCE_LAWS_BOUNDS, 'RIGHT')).toMatchObject({
      x: 6267 - 544,
      width: 544
    })
  })

  it("LEFT keeps today's reading: box.x = pos.x, unchanged", () => {
    expect(freeTextBounds(REFERENCE_LAWS_BOUNDS, 'LEFT')).toMatchObject({ x: 6267, width: 544 })
  })

  it('an unknown/absent alignment keeps the LEFT (top-left) reading — the pre-fix default', () => {
    expect(freeTextBounds(REFERENCE_LAWS_BOUNDS, null)).toMatchObject({ x: 6267, width: 544 })
    // The one-argument call (every pre-P6 caller, e.g. `modelContentBounds`
    // and `layoutSeam.buildLayoutGraph`) must keep behaving exactly as before.
    expect(freeTextBounds(REFERENCE_LAWS_BOUNDS)).toMatchObject({ x: 6267, width: 544 })
  })

  it('an unsized note (Size.dX absent/0) never anchors by alignment — Position stays the box origin', () => {
    const unsized = { x: 1000, y: 1000, width: 0, height: 0 }
    expect(freeTextBounds(unsized, 'CENTER')).toMatchObject({ x: 1000 })
    expect(freeTextBounds(unsized, 'RIGHT')).toMatchObject({ x: 1000 })
  })
})

describe('Wave 9 P6: end-to-end — the rendered text centres on Position for a sized CENTER note', () => {
  /** A single model with one sized, CENTER-aligned free-text note, shaped exactly like the
   *  Reference-Laws title (fixplan §3.5) but with placeholder text this suite owns outright —
   *  the private AnimalWF export's own label text never reaches a committed test fixture. */
  const SIZED_CENTER_NOTE_AML = `<AML>
  <Group Group.ID="Group.Root">
    <Model Model.ID="Model.RefLaws" Model.Type="MT_EEPC">
      <FFTextOcc FFTextDef.IdRef="FFTextDef.RefLaws" FontSS.IdRef="FontSS.1" SymbolFlag="TEXT" Alignment="CENTER" Zorder="1">
        <Position Pos.X="6267" Pos.Y="551" />
        <Size Size.dX="544" Size.dY="0" />
      </FFTextOcc>
    </Model>
  </Group>
  <FFTextDef FFTextDef.ID="FFTextDef.RefLaws" IsModelAttr="TEXT">
    <AttrDef AttrDef.Type="AT_NAME">
      <AttrValue LocaleId="1033">
        <StyledElement>
          <Bold/>
            <StyledElement>
              <Paragraph Alignment="UNDEFINED" Indent="0"/>
                <StyledElement>
                  <PlainText TextValue="Sized Note Title" />
                </StyledElement>
            </StyledElement>
        </StyledElement>
      </AttrValue>
    </AttrDef>
  </FFTextDef>
  <FontStyleSheet FontSS.ID="FontSS.1">
    <FontNode LocaleId="1033" FaceName="Arial" Height="-10" Weight="400" Italic="NO" Color="0" />
  </FontStyleSheet>
</AML>`

  it('wraps to width dX and paints its text centre at Position.x (6267), not pos.x + dX/2 (6539)', () => {
    const document = buildFromSource(
      buildSemanticArisDocument(tokenizeXmlDocument(SIZED_CENTER_NOTE_AML)).index
    )
    harness = bootCanvas({ document, modelId: 'Model.RefLaws' })
    const canvas = (harness as Harness).canvas
    const note = document.models.get('Model.RefLaws')!.freeText[0]!
    const elementId = freeTextElementId(note.id)

    // box.x anchored at Position by CENTER alignment: 5995 = 6267 - 544/2.
    const drawnShape = shape(canvas, elementId)
    expect(drawnShape.x).toBe(5995)
    expect(drawnShape.width).toBe(544)

    // No invented border/height: dY=0 draws no rect at all.
    const group = canvas.elementRegistry
      .getGraphics(elementId)
      .querySelector('[data-aris-kind="freeText"]')!
    expect(group.querySelector('rect')).toBeNull()

    // The printed text: text-anchor "middle" (CENTER), horizontally centred
    // within the box at local x = width / 2 = 272 — which lands back on the
    // absolute Position.x (5995 + 272 = 6267), never on the pre-fix
    // top-left reading's 6267 + 272 = 6539 (half the 544-wide box past the
    // source anchor, which is what clipped the title out of its frame).
    const text = group.querySelector('text[data-aris-caption]')!
    expect(text.getAttribute('text-anchor')).toBe('middle')
    const localX = Number(text.getAttribute('x'))
    expect(localX).toBe(272)
    expect(drawnShape.x + localX).toBe(6267)
  })
})
