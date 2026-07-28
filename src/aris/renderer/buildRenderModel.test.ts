import { describe, expect, it } from 'vitest'

import { buildArisRenderModel } from './buildRenderModel'
import { buildHappyPathInput } from './testFixtures'

describe('buildArisRenderModel — Section 12.1 source visual inputs', () => {
  it('maps ObjOcc position and size exactly (no rounding, no defaulting over real values)', () => {
    const result = buildArisRenderModel(buildHappyPathInput())
    const model = result.models[0]
    const func = model.elements.find((e) => e.id === 'ObjOcc.1')!
    expect(func.sourceBounds).toEqual({ x: 100, y: 200, width: 140, height: 60 })
    const evt = model.elements.find((e) => e.id === 'ObjOcc.2')!
    expect(evt.sourceBounds).toEqual({ x: 100, y: 400, width: 100, height: 100 })
  })

  it('resolves the symbol number (and object type) via the symbol registry', () => {
    const result = buildArisRenderModel(buildHappyPathInput())
    const model = result.models[0]
    const func = model.elements.find((e) => e.id === 'ObjOcc.1')!
    expect(func.symbol.key).toBe('MT_EEPC:OT_FUNC:ST_FUNC')
    const evt = model.elements.find((e) => e.id === 'ObjOcc.2')!
    expect(evt.symbol.key).toBe('MT_EEPC:OT_EVT:ST_EV')
    // Known triples never produce a symbol fidelity finding.
    expect(result.fidelity.some((f) => f.kind === 'unknown-custom-symbol' || f.kind === 'substituted-visual-resource')).toBe(
      false
    )
  })

  it('respects z-order in the emitted draw order across elements, connections, free text, and attachments', () => {
    const result = buildArisRenderModel(buildHappyPathInput())
    const model = result.models[0]
    expect(model.drawOrder.map((e) => `${e.kind}:${e.id}`)).toEqual([
      'element:ObjOcc.2',
      'element:ObjOcc.1',
      'connection:CxnOcc.1',
      'attachment:OLEOcc.1',
      'freeText:FFTextOcc.1',
      'element:ObjOcc.3'
    ])
  })

  it('maps pen and brush color/style faithfully (RRGGBB hex, no leading-zero loss)', () => {
    const result = buildArisRenderModel(buildHappyPathInput())
    const model = result.models[0]
    const func = model.elements.find((e) => e.id === 'ObjOcc.1')!
    expect(func.pen?.color).toBe('#339900')
    expect(func.pen?.style).toBe('solid')
    expect(func.brush?.fill).toBe('#b6dce9')
    expect(func.brush?.kind).toBe('solid')

    const cxn = model.connections.find((c) => c.id === 'CxnOcc.1')!
    // Pen Color="0" is literal black — not the "-1" no-color sentinel.
    expect(cxn.pen?.color).toBe('#000000')
  })

  it('maps connection route points, sorted by point index regardless of source array order', () => {
    const result = buildArisRenderModel(buildHappyPathInput())
    const cxn = result.models[0].connections.find((c) => c.id === 'CxnOcc.1')!
    expect(cxn.sourceRoutePoints).toEqual([
      { x: 170, y: 260 },
      { x: 170, y: 330 },
      { x: 150, y: 400 }
    ])
  })

  it('maps attribute occurrence placement (offset/rotation/size) onto the owning element', () => {
    const result = buildArisRenderModel(buildHappyPathInput())
    const func = result.models[0].elements.find((e) => e.id === 'ObjOcc.1')!
    expect(func.attributeOccurrences).toHaveLength(1)
    expect(func.attributeOccurrences[0]).toMatchObject({
      attributeType: 'AT_NAME',
      alignment: 'CENTER',
      offsetX: 0,
      offsetY: 0,
      rotation: 0,
      bounds: { width: 140, height: 40 }
    })
  })

  it('maps fonts/font styles, choosing the FontNode matching the resolved text locale', () => {
    const result = buildArisRenderModel(buildHappyPathInput())
    const func = result.models[0].elements.find((e) => e.id === 'ObjOcc.1')!
    // Name has both en/ar values; en is preferred, so the Arial FontNode is used.
    expect(func.name?.font.requestedFaceName).toBe('Arial')
    expect(func.name?.font.faceAvailable).toBe(true)
    expect(func.name?.font.sizePx).toBe(13)
    expect(func.name?.font.weight).toBe(400)
    expect(func.name?.direction).toBe('ltr')
  })

  it('maps model background/scale/grid', () => {
    const result = buildArisRenderModel(buildHappyPathInput())
    const model = result.models[0]
    expect(model.scale).toBe(80)
    expect(model.printScale).toBe(54)
    expect(model.gridSize).toBe(50)
    expect(model.gridUse).toBe(true)
    // BackColor="-1" is the "no override" sentinel, not a color.
    expect(model.background).toEqual({ color: undefined, isDefault: true })
  })

  it('maps lanes with their own pen/brush/name', () => {
    const result = buildArisRenderModel(buildHappyPathInput())
    const lane = result.models[0].lanes[0]
    expect(lane.laneType).toBe('LT_DEFAULT')
    expect(lane.orientation).toBe('VERTICAL')
    expect(lane.startBorder).toBe(0)
    expect(lane.endBorder).toBe(50000)
    expect(lane.name?.rawText).toBe('Operations')
  })

  it('maps free text placement and content', () => {
    const result = buildArisRenderModel(buildHappyPathInput())
    const freeText = result.models[0].freeText[0]
    expect(freeText.sourceBounds).toEqual({ x: 400, y: 100, width: 120, height: 40 })
    expect(freeText.text?.rawText).toBe('Note: manual step')
  })

  it('maps OLE/blob attachment placement and reports unsupported OLE rendering', () => {
    const result = buildArisRenderModel(buildHappyPathInput())
    const attachment = result.models[0].attachments[0]
    expect(attachment.sourceBounds).toEqual({ x: 500, y: 500, width: 64, height: 64 })
    expect(attachment.blobCount).toBe(2)
    expect(
      result.fidelity.some(
        (f) => f.kind === 'unsupported-ole-rendering' && f.elementId === 'OLEOcc.1'
      )
    ).toBe(true)
    // Content is present (blobCount 2), so no missing-reference-export finding for this one.
    expect(result.fidelity.some((f) => f.kind === 'missing-reference-export' && f.elementId === 'OLEOcc.1')).toBe(
      false
    )
  })

  it('resolves Arabic-only text to RTL direction and reports the missing proprietary font honestly', () => {
    const result = buildArisRenderModel(buildHappyPathInput())
    const arabicFunc = result.models[0].elements.find((e) => e.id === 'ObjOcc.3')!
    expect(arabicFunc.name?.direction).toBe('rtl')
    expect(arabicFunc.name?.font.requestedFaceName).toBe('Simplified Arabic')
    expect(arabicFunc.name?.font.faceAvailable).toBe(false)
    expect(
      result.fidelity.some(
        (f) => f.kind === 'missing-font' && f.params.faceName === 'Simplified Arabic' && f.elementId === 'ObjOcc.3'
      )
    ).toBe(true)
  })

  it('preserves the source symbol reference, id, geometry, and style through rendering', () => {
    const result = buildArisRenderModel(buildHappyPathInput())
    const func = result.models[0].elements.find((e) => e.id === 'ObjOcc.1')!
    expect(func.anchor.sourceId).toBe('ObjOcc.1')
    expect(func.anchor.path).toBe('AML[1]/Group[1]/Model[1]/ObjOcc[1]')
    expect(func.symbolSource?.geometry).toEqual({ x: 100, y: 200, dx: 140, dy: 60 })
  })
})
