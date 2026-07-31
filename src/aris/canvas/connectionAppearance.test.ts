// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'
import type { Element, Shape } from 'diagram-js/lib/model/Types'

import { buildFromSource } from '../model/buildFromSource'
import { buildSemanticArisDocument } from '../source/semanticIndex'
import { tokenizeXmlDocument } from '../source/xmlTokenizer'
import { arisBusinessObject, freeTextElementId } from './elements'
import { bootCanvas, type Harness } from './testing/harness'

const AML = `<AML>
  <Group Group.ID="Group.Root">
    <ObjDef ObjDef.ID="ObjDef.A" TypeNum="OT_FUNC" SymbolNum="ST_FUNC">
      <CxnDef CxnDef.ID="CxnDef.visible" CxnDef.Type="CT_ACTIV_1" ToObjDef.IdRef="ObjDef.B" />
      <CxnDef CxnDef.ID="CxnDef.hidden" CxnDef.Type="CT_IS_PRCS_ORNT_SUPER" ToObjDef.IdRef="ObjDef.B" />
      <CxnDef CxnDef.ID="CxnDef.keptDefault" CxnDef.Type="CT_HAS_OUT" ToObjDef.IdRef="ObjDef.B" />
      <CxnDef CxnDef.ID="CxnDef.removedDefault" CxnDef.Type="CT_SUPP_3" ToObjDef.IdRef="ObjDef.B" />
    </ObjDef>
    <ObjDef ObjDef.ID="ObjDef.B" TypeNum="OT_EVT" SymbolNum="ST_EV" />
    <Model Model.ID="Model.1" Model.Type="MT_EEPC">
      <ObjOcc ObjOcc.ID="ObjOcc.A" ObjDef.IdRef="ObjDef.A" SymbolNum="ST_FUNC" Zorder="20">
        <Position Pos.X="100" Pos.Y="100" />
        <Size Size.dX="200" Size.dY="80" />
        <CxnOcc CxnOcc.ID="CxnOcc.visible" CxnDef.IdRef="CxnDef.visible"
          ToObjOcc.IdRef="ObjOcc.B" SrcArrow="ST_ARROW_OPEN_PNT"
          TgtArrow="ST_ARROW_FILLED_PNT" Zorder="10">
          <Pen Color="996600" Style="3" Width="3" />
          <Position Pos.X="291" Pos.Y="138" />
          <Position Pos.X="420" Pos.Y="138" />
          <Position Pos.X="420" Pos.Y="342" />
          <Position Pos.X="607" Pos.Y="342" />
          <AttrOcc AttrTypeNum="AT_NAME" Alignment="CENTER" OffsetX="0" OffsetY="0">
            <Size Size.dX="0" Size.dY="0" />
          </AttrOcc>
        </CxnOcc>
        <CxnOcc CxnOcc.ID="CxnOcc.hidden" CxnDef.IdRef="CxnDef.hidden"
          ToObjOcc.IdRef="ObjOcc.B" TgtArrow="ST_ARROW_FILLED_PNT"
          Visible="NO" Zorder="40">
          <Pen Color="666666" Style="0" Width="10" />
          <Position Pos.X="300" Pos.Y="140" />
          <Position Pos.X="600" Pos.Y="340" />
        </CxnOcc>
      </ObjOcc>
      <FFTextOcc FFTextDef.IdRef="FFTextDef.1" Zorder="15">
        <Position Pos.X="350" Pos.Y="50" />
        <Size Size.dX="120" Size.dY="30" />
      </FFTextOcc>
      <ObjOcc ObjOcc.ID="ObjOcc.B" ObjDef.IdRef="ObjDef.B" SymbolNum="ST_EV" Zorder="30">
        <Position Pos.X="600" Pos.Y="300" />
        <Size Size.dX="200" Size.dY="80" />
      </ObjOcc>
    </Model>
    <Model Model.ID="Model.2" Model.Type="MT_EEPC">
      <ObjOcc ObjOcc.ID="ObjOcc.A2" ObjDef.IdRef="ObjDef.A" SymbolNum="ST_FUNC" Zorder="10">
        <Position Pos.X="100" Pos.Y="100" />
        <Size Size.dX="200" Size.dY="80" />
        <CxnOcc CxnOcc.ID="CxnOcc.keptDefault" CxnDef.IdRef="CxnDef.keptDefault"
          ToObjOcc.IdRef="ObjOcc.B2" Zorder="5">
          <Pen Color="0" Style="0" Width="1" />
          <Position Pos.X="300" Pos.Y="140" />
          <Position Pos.X="600" Pos.Y="140" />
        </CxnOcc>
        <CxnOcc CxnOcc.ID="CxnOcc.removedDefault" CxnDef.IdRef="CxnDef.removedDefault"
          ToObjOcc.IdRef="ObjOcc.B2" Zorder="6">
          <Pen Color="0" Style="0" Width="1" />
          <Position Pos.X="300" Pos.Y="160" />
          <Position Pos.X="600" Pos.Y="160" />
        </CxnOcc>
      </ObjOcc>
      <ObjOcc ObjOcc.ID="ObjOcc.B2" ObjDef.IdRef="ObjDef.B" SymbolNum="ST_EV" Zorder="20">
        <Position Pos.X="600" Pos.Y="100" />
        <Size Size.dX="200" Size.dY="80" />
      </ObjOcc>
    </Model>
  </Group>
  <FFTextDef FFTextDef.ID="FFTextDef.1">
    <AttrDef AttrDef.Type="AT_NAME"><AttrValue LocaleId="1033">Note</AttrValue></AttrDef>
  </FFTextDef>
</AML>`

let harness: Harness | null = null

afterEach(() => {
  harness?.destroy()
  harness = null
})

function boot(modelId = 'Model.1') {
  const index = buildSemanticArisDocument(tokenizeXmlDocument(AML)).index
  const document = buildFromSource(index)
  harness = bootCanvas({ document, modelId })
  return { document, canvas: harness.canvas }
}

function connectionLine(id: string): SVGElement {
  const graphics = harness!.canvas.elementRegistry.getGraphics(id)
  const line = graphics.querySelector<SVGElement>('[data-aris-connection-type]')
  if (!line) throw new Error(`No rendered connection line for ${id}.`)
  return line
}

describe('source connection appearance', () => {
  it('renders Pen width/style/color, endpoint arrows, and visibility from the occurrence', () => {
    boot()
    const visible = connectionLine('CxnOcc.visible')
    expect(visible.style.stroke).toBe('rgb(0, 102, 153)')
    // Pen Width="3" × ARIS_PEN_UNIT (2.646) — Wave 9 P2 pen-width scale.
    expect(visible.style.strokeWidth).toBe('7.938px')
    expect(visible.getAttribute('stroke-dasharray')).toBe('8 3 2 3')
    expect(visible.getAttribute('data-aris-src-arrow')).toBe('open')
    expect(visible.getAttribute('data-aris-tgt-arrow')).toBe('filled')
    expect(visible.getAttribute('marker-start')).toMatch(/^url\(#aris-arrow-open-start-/u)
    expect(visible.getAttribute('marker-end')).toMatch(/^url\(#aris-arrow-filled-end-/u)

    const hidden = connectionLine('CxnOcc.hidden')
    // Pen Width="10" × ARIS_PEN_UNIT (2.646) — Wave 9 P2 pen-width scale.
    expect(hidden.style.strokeWidth).toBe('26.46px')
    expect(hidden.getAttribute('data-aris-visible')).toBe('false')
    expect(hidden.getAttribute('visibility')).toBe('hidden')
    expect(hidden.getAttribute('pointer-events')).toBe('none')
  })

  it('falls back to the type-driven default arrow only for a truth-table type the reference PDF directs (Wave 9 P1)', () => {
    // Both connections below carry no SrcArrow/TgtArrow at all — same "no override" input as the
    // explicit-override case above lacked, but here the DEFAULT is what is under test, i.e.
    // `DIRECTED_CONNECTION_TYPES` membership alone (see `attributeLabels.animalwf.test.ts` for the
    // exhaustive per-type real-data version of this same check).
    boot('Model.2')

    // CT_HAS_OUT is in DIRECTED_CONNECTION_TYPES: the reference PDF draws an arrow into a
    // function's output (e.g. Owner Registration Number), so the default target arrow is 'open'.
    const kept = connectionLine('CxnOcc.keptDefault')
    expect(kept.getAttribute('data-aris-src-arrow')).toBe('none')
    expect(kept.getAttribute('data-aris-tgt-arrow')).toBe('open')
    expect(kept.getAttribute('marker-end')).toMatch(/^url\(#aris-arrow-open-end-/u)

    // CT_SUPP_3 was pruned from DIRECTED_CONNECTION_TYPES (Wave 9 lane P1): the reference PDF
    // draws a plain line for an external application system feeding a function (DED
    // System/TAMM/Smart Hub/UAE Pass all render arrow-less), so no default arrow and no marker.
    const removed = connectionLine('CxnOcc.removedDefault')
    expect(removed.getAttribute('data-aris-src-arrow')).toBe('none')
    expect(removed.getAttribute('data-aris-tgt-arrow')).toBe('none')
    expect(removed.getAttribute('marker-end')).toBeNull()
    expect(removed.getAttribute('marker-start')).toBeNull()
  })

  it('keeps imported occurrence bounds and ordered route points byte-for-number exact on canvas', () => {
    const { document, canvas } = boot()
    const model = document.models.get('Model.1')!
    for (const occurrence of model.occurrences) {
      const shape = canvas.elementRegistry.get(occurrence.id) as Shape
      expect({
        x: shape.x,
        y: shape.y,
        width: shape.width,
        height: shape.height
      }).toEqual(occurrence.bounds)
    }
    for (const connection of model.connectionOccurrences) {
      const element = canvas.elementRegistry.get(connection.id) as unknown as {
        readonly waypoints: readonly { readonly x: number; readonly y: number }[]
      }
      expect(element.waypoints.map(({ x, y }) => ({ x, y }))).toEqual(connection.route)
    }
  })

  it('redocks only after an author move and keeps the edited projection orthogonal', () => {
    const { canvas } = boot()
    const imported = canvas.elementRegistry.get('CxnOcc.visible') as unknown as {
      readonly waypoints: readonly { readonly x: number; readonly y: number }[]
    }
    expect(imported.waypoints[0]).toEqual({ x: 291, y: 138 })

    canvas.authoring.moveOccurrence('ObjOcc.A', { x: 150, y: 100 })
    const moved = canvas.elementRegistry.get('CxnOcc.visible') as unknown as {
      readonly waypoints: readonly { readonly x: number; readonly y: number }[]
    }
    expect(moved.waypoints[0]).toEqual({ x: 350, y: 140 })
    expect(
      moved.waypoints.slice(1).every((point, index) => {
        const previous = moved.waypoints[index]!
        return point.x === previous.x || point.y === previous.y
      })
    ).toBe(true)
  })

  it('uses one z-order across connections, free text, occurrences, and connection labels', () => {
    const { document, canvas } = boot()
    const model = document.models.get('Model.1')!
    const freeTextId = freeTextElementId(model.freeText[0]!.id)
    const root = canvas.canvas.getRootElement() as unknown as {
      readonly children: readonly Element[]
    }
    expect(root.children.map((element) => element.id)).toEqual([
      'CxnOcc.visible',
      'cxnlabel:CxnOcc.visible:0:AT_NAME',
      freeTextId,
      'ObjOcc.A',
      'ObjOcc.B',
      'CxnOcc.hidden'
    ])

    const zOrders = root.children.map((element) => {
      const businessObject = arisBusinessObject(element) as
        ({ readonly zOrder?: number | null } & object) | null
      return businessObject?.zOrder ?? null
    })
    expect(zOrders).toEqual([10, 10, 15, 20, 30, 40])
    for (const element of root.children) {
      expect(canvas.elementRegistry.getGraphics(element.id).getAttribute('data-aris-z-order')).toBe(
        String(
          (
            arisBusinessObject(element) as unknown as {
              readonly zOrder: number
            }
          ).zOrder
        )
      )
    }
  })
})
