// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'

import { buildFromSource } from '../model/buildFromSource'
import { buildSemanticArisDocument } from '../source/semanticIndex'
import { tokenizeXmlDocument } from '../source/xmlTokenizer'
import { arisBusinessObject } from './elements'
import { bootCanvas, shape, type Harness } from './testing/harness'

/**
 * VACD grouping-chevron containers (user issue 3). An `ST_VAL_ADD_CHN_SML_1`
 * occurrence that carries the `Flags` bit 16, or that sources a
 * `CT_IS_PRCS_ORNT_SUPER` hierarchy edge, is a grouping container: the
 * convention manual (p.18) draws it as a background frame behind its leaves and
 * hides the hierarchy line. These synthetic AML fixtures exercise the detection,
 * the draw-order tier, the frame painter, and the hierarchy-edge suppression
 * without touching the private AnimalWF export.
 */
const AML = `<AML>
  <Group Group.ID="Group.Root">
    <ObjDef ObjDef.ID="ObjDef.Container1" TypeNum="OT_FUNC" SymbolNum="ST_VAL_ADD_CHN_SML_1">
      <AttrDef AttrDef.Type="AT_NAME"><AttrValue LocaleId="1033">Container One</AttrValue></AttrDef>
    </ObjDef>
    <ObjDef ObjDef.ID="ObjDef.Container2" TypeNum="OT_FUNC" SymbolNum="ST_VAL_ADD_CHN_SML_1">
      <AttrDef AttrDef.Type="AT_NAME"><AttrValue LocaleId="1033">Container Two</AttrValue></AttrDef>
      <CxnDef CxnDef.ID="CxnDef.hier" CxnDef.Type="CT_IS_PRCS_ORNT_SUPER" ToObjDef.IdRef="ObjDef.Leaf" />
    </ObjDef>
    <ObjDef ObjDef.ID="ObjDef.Leaf" TypeNum="OT_FUNC" SymbolNum="ST_FUNC">
      <AttrDef AttrDef.Type="AT_NAME"><AttrValue LocaleId="1033">Leaf</AttrValue></AttrDef>
      <CxnDef CxnDef.ID="CxnDef.pred" CxnDef.Type="CT_IS_PREDEC_OF_1" ToObjDef.IdRef="ObjDef.Leaf" />
    </ObjDef>
    <Model Model.ID="Model.VACD" Model.Type="MT_VAL_ADD_CHN_DGM">
      <ObjOcc ObjOcc.ID="Occ.Container1" ObjDef.IdRef="ObjDef.Container1"
        SymbolNum="ST_VAL_ADD_CHN_SML_1" Flags="16" Zorder="59">
        <Position Pos.X="75" Pos.Y="158" />
        <Size Size.dX="3250" Size.dY="2884" />
        <Pen Color="666666" Style="0" Width="10" />
      </ObjOcc>
      <ObjOcc ObjOcc.ID="Occ.Container2" ObjDef.IdRef="ObjDef.Container2"
        SymbolNum="ST_VAL_ADD_CHN_SML_1" Zorder="58">
        <Position Pos.X="325" Pos.Y="359" />
        <Size Size.dX="2850" Size.dY="1432" />
        <CxnOcc CxnOcc.ID="Cxn.hier" CxnDef.IdRef="CxnDef.hier" ToObjOcc.IdRef="Occ.Leaf" Zorder="30">
          <Position Pos.X="500" Pos.Y="500" />
          <Position Pos.X="700" Pos.Y="700" />
        </CxnOcc>
      </ObjOcc>
      <ObjOcc ObjOcc.ID="Occ.Leaf" ObjDef.IdRef="ObjDef.Leaf" SymbolNum="ST_FUNC" Zorder="46">
        <Position Pos.X="500" Pos.Y="500" />
        <Size Size.dX="648" Size.dY="242" />
        <CxnOcc CxnOcc.ID="Cxn.pred" CxnDef.IdRef="CxnDef.pred" ToObjOcc.IdRef="Occ.Leaf2" Zorder="31">
          <Position Pos.X="900" Pos.Y="600" />
          <Position Pos.X="1400" Pos.Y="600" />
        </CxnOcc>
      </ObjOcc>
      <ObjOcc ObjOcc.ID="Occ.Leaf2" ObjDef.IdRef="ObjDef.Leaf" SymbolNum="ST_FUNC" Zorder="47">
        <Position Pos.X="1400" Pos.Y="500" />
        <Size Size.dX="648" Size.dY="242" />
      </ObjOcc>
    </Model>
    <Model Model.ID="Model.EPC" Model.Type="MT_EEPC">
      <ObjOcc ObjOcc.ID="Occ.EpcChevron" ObjDef.IdRef="ObjDef.Container1"
        SymbolNum="ST_VAL_ADD_CHN_SML_1" Flags="16" Zorder="10">
        <Position Pos.X="100" Pos.Y="100" />
        <Size Size.dX="800" Size.dY="300" />
      </ObjOcc>
    </Model>
  </Group>
</AML>`

let harness: Harness | null = null

afterEach(() => {
  harness?.destroy()
  harness = null
})

function boot(modelId = 'Model.VACD') {
  const index = buildSemanticArisDocument(tokenizeXmlDocument(AML)).index
  const document = buildFromSource(index)
  harness = bootCanvas({ document, modelId })
  return harness.canvas
}

/** The rendered occurrence `<g data-aris-kind="occurrence">` for an occurrence id. */
function occurrenceGroup(canvas: ReturnType<typeof boot>, id: string): SVGGElement {
  const gfx = canvas.elementRegistry.getGraphics(id)
  const group = gfx.querySelector<SVGGElement>('[data-aris-kind="occurrence"]')
  if (!group) throw new Error(`No rendered occurrence group for ${id}.`)
  return group
}

/** The rendered connection line for a connection occurrence id. */
function connectionLine(canvas: ReturnType<typeof boot>, id: string): SVGElement {
  const gfx = canvas.elementRegistry.getGraphics(id)
  const line = gfx.querySelector<SVGElement>('[data-aris-connection-type]')
  if (!line) throw new Error(`No rendered connection line for ${id}.`)
  return line
}

function businessOf(canvas: ReturnType<typeof boot>, id: string) {
  return arisBusinessObject(canvas.elementRegistry.get(id))
}

describe('VACD container detection', () => {
  it('marks Flags=16 and hierarchy-source grouping chevrons as containers, not the leaf', () => {
    const canvas = boot()

    const container1 = businessOf(canvas, 'Occ.Container1')
    const container2 = businessOf(canvas, 'Occ.Container2')
    const leaf = businessOf(canvas, 'Occ.Leaf')

    expect(container1?.kind).toBe('occurrence')
    expect((container1 as { isContainer?: boolean }).isContainer).toBe(true)
    // Container Two carries no Flags but SOURCES a CT_IS_PRCS_ORNT_SUPER edge.
    expect((container2 as { isContainer?: boolean }).isContainer).toBe(true)
    // The leaf is a plain ST_FUNC — never a container.
    expect((leaf as { isContainer?: boolean }).isContainer).not.toBe(true)
  })

  it('does not treat a Flags=16 ST_VAL_ADD_CHN_SML_1 in an EPC model as a container (scope guard)', () => {
    const canvas = boot('Model.EPC')
    const epcChevron = businessOf(canvas, 'Occ.EpcChevron')
    expect(epcChevron?.kind).toBe('occurrence')
    expect((epcChevron as { isContainer?: boolean }).isContainer).not.toBe(true)
  })
})

describe('VACD container draw-order tier', () => {
  it('tiers container frames behind every leaf in DOM order despite a higher z-order', () => {
    const canvas = boot()
    const gfx = (id: string): SVGElement => canvas.elementRegistry.getGraphics(id) as SVGElement
    // `A` precedes `B` in document order when comparing A against B yields FOLLOWING.
    const precedes = (a: SVGElement, b: SVGElement): boolean =>
      (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
    const containers = ['Occ.Container1', 'Occ.Container2'].map(gfx)
    const leaves = ['Occ.Leaf', 'Occ.Leaf2'].map(gfx)
    // Every container graphic precedes every leaf graphic, so leaves paint on top.
    for (const container of containers) {
      for (const leaf of leaves) {
        expect(precedes(container, leaf)).toBe(true)
      }
    }
  })
})

describe('VACD container frame painter', () => {
  it('draws a convention-style frame — white body, accent strip + band, white chevron, top caption', () => {
    const canvas = boot()
    const group = occurrenceGroup(canvas, 'Occ.Container1')
    const container = shape(canvas, 'Occ.Container1')

    expect(group.getAttribute('data-aris-container')).toBe('true')

    // White body carrying the source pen (Pen 666666 width 10 → 26.5 canvas units).
    const body = group.querySelector<SVGRectElement>('rect[data-aris-part="surface"]')
    expect(body).not.toBeNull()
    expect(body!.getAttribute('fill')).toBe('#ffffff')

    // A thin accent top strip AND an accent left band.
    const accents = group.querySelectorAll<SVGRectElement>('rect[data-aris-part="accent"]')
    expect(accents.length).toBe(2)
    const stripHeight = Number(accents[0]!.getAttribute('height'))
    const bandWidth = Number(accents[1]!.getAttribute('width'))
    // The left band never reaches the old accent-wedge's 34 % of the shape width.
    expect(bandWidth).toBeLessThan(container.width * 0.34)
    expect(stripHeight).toBeLessThanOrEqual(40)

    // A white double-chevron, drawn as open polylines (never a wedge polygon).
    const chevrons = group.querySelectorAll<SVGPolylineElement>(
      'polyline[data-aris-part="chevron"]'
    )
    expect(chevrons.length).toBe(2)
    for (const chevron of chevrons) {
      expect(chevron.getAttribute('stroke')).toBe('#ffffff')
      expect(chevron.getAttribute('fill')).toBe('none')
    }

    // No silhouette-scale icon, and no accent-wedge polygon at all.
    expect(group.querySelector('[data-aris-part="icon"]')).toBeNull()
    expect(group.querySelector('polygon')).toBeNull()

    // Caption anchored in the top region (first text/tspan y < 15 % of the height).
    const caption = group.querySelector('[data-aris-caption]')
    expect(caption).not.toBeNull()
    const firstLine = caption!.querySelector('tspan') ?? caption!
    expect(Number(firstLine.getAttribute('y'))).toBeLessThan(container.height * 0.15)
  })
})

describe('VACD hierarchy-edge suppression', () => {
  it('hides CT_IS_PRCS_ORNT_SUPER edges but keeps CT_IS_PREDEC_OF_1 visible', () => {
    const canvas = boot()

    const hierarchy = connectionLine(canvas, 'Cxn.hier')
    expect(hierarchy.getAttribute('data-aris-connection-type')).toBe('CT_IS_PRCS_ORNT_SUPER')
    expect(hierarchy.getAttribute('data-aris-visible')).toBe('false')
    expect(hierarchy.getAttribute('visibility')).toBe('hidden')
    expect(hierarchy.getAttribute('pointer-events')).toBe('none')

    const predecessor = connectionLine(canvas, 'Cxn.pred')
    expect(predecessor.getAttribute('data-aris-connection-type')).toBe('CT_IS_PREDEC_OF_1')
    expect(predecessor.getAttribute('data-aris-visible')).toBe('true')
    expect(predecessor.getAttribute('visibility')).toBeNull()
  })
})
