// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'

import type {
  ArisAttachment,
  ArisAttributeOccurrence,
  ArisConnectionDefinition,
  ArisConnectionOccurrence,
  ArisFreeText,
  ArisGraphicObject,
  ArisModel,
  ArisObjectDefinition,
  ArisObjectOccurrence,
  ArisWorkingDocument
} from '../model/types'
import { createEmptyArisDocument, createEmptyArisModel, localizedValue } from './emptyDocument'
import { arisBusinessObject, connectionLabelElementId } from './elements'
import { ARIS_PRINT_FRAME_LAYER, ArisRenderer } from './renderer'
import { buildPrintFrame, drawPrintFrame, printFrameModelAttributeText } from './printFrame'
import { bootCanvas, type Harness } from './testing/harness'
import { SVG_NS } from './svg'

/**
 * The print frame (plan Wave 6, V5+): header band with the Process Code /
 * Process Name / Organizational Owner rows from the model's own attributes,
 * live `AT_MODEL_AT` placeholders resolved at their source anchors, the
 * organization title block, and the bottom legend — plus the tuple-safe RACI
 * badge on the canvas's connection labels.
 */

const MODEL_ID = 'Model.1'

let harness: Harness | null = null

afterEach(() => {
  harness?.destroy()
  harness = null
})

const STYLE = Object.freeze({
  symbol: null,
  fillColor: null,
  strokeColor: null,
  strokeWidth: null,
  lineStyle: null,
  fontStyleSheetId: null,
  zOrder: null
})

function occurrence(
  id: string,
  definitionId: string,
  x: number,
  y: number,
  symbol = 'ST_FUNC'
): ArisObjectOccurrence {
  return Object.freeze({
    id,
    definitionId,
    modelId: MODEL_ID,
    symbol,
    bounds: Object.freeze({ x, y, width: 670, height: 240 }),
    style: STYLE,
    attributeOccurrences: Object.freeze([]),
    rawAttributes: Object.freeze({})
  })
}

function definition(id: string, type: string, name: string): ArisObjectDefinition {
  return Object.freeze({
    id,
    type,
    defaultSymbol: null,
    names: localizedValue(name),
    attributes: Object.freeze([]),
    linkedModelIds: Object.freeze([]),
    rawAttributes: Object.freeze({})
  })
}

function raciConnection(placements: readonly ArisAttributeOccurrence[]): ArisConnectionOccurrence {
  return Object.freeze({
    id: 'CxnOcc.1',
    definitionId: 'CxnDef.1',
    modelId: MODEL_ID,
    sourceOccurrenceId: 'ObjOcc.person',
    targetOccurrenceId: 'ObjOcc.func',
    route: Object.freeze([
      { x: 900, y: 400 },
      { x: 1100, y: 400 }
    ]),
    style: Object.freeze({
      color: null,
      width: null,
      lineStyle: null,
      srcArrow: null,
      tgtArrow: null,
      fontStyleSheetId: null,
      zOrder: null
    }),
    attributeOccurrences: Object.freeze([...placements]),
    rawAttributes: Object.freeze({})
  })
}

function raciPlacement(
  text: {
    readonly attributeType?: string
    readonly symbolFlag?: string
  } = {}
): ArisAttributeOccurrence {
  return Object.freeze({
    attributeType: text.attributeType ?? 'AT_TYPE_6',
    port: 'NW',
    orderNum: 0,
    alignment: 'CENTER',
    offsetX: 0,
    offsetY: 0,
    width: null,
    height: null,
    rotation: 0,
    symbolFlag: text.symbolFlag ?? 'TEXT',
    fontStyleSheetId: null
  })
}

/** A person→Function `CT_EXEC_1` model carrying the given connection placements. */
function raciDocument(
  placements: readonly ArisAttributeOccurrence[],
  connectionType = 'CT_EXEC_1'
): ArisWorkingDocument {
  const base = createEmptyArisModel({ id: MODEL_ID, type: 'MT_EEPC', name: 'RACI' })
  const model: ArisModel = Object.freeze({
    ...base,
    occurrences: Object.freeze([
      occurrence('ObjOcc.person', 'ObjDef.person', 100, 300, 'ST_PERS_EXT'),
      occurrence('ObjOcc.func', 'ObjDef.func', 1000, 300)
    ]),
    connectionOccurrences: Object.freeze([raciConnection(placements)])
  })
  const connectionDefinition: ArisConnectionDefinition = Object.freeze({
    id: 'CxnDef.1',
    type: connectionType,
    fromObjectDefinitionId: 'ObjDef.person',
    toObjectDefinitionId: 'ObjDef.func',
    names: Object.freeze({ values: Object.freeze({}), fallback: null }),
    attributes: Object.freeze([])
  })
  const empty = createEmptyArisDocument({ models: [model] })
  return Object.freeze({
    ...empty,
    objectDefinitions: Object.freeze(
      new Map([
        ['ObjDef.person', definition('ObjDef.person', 'OT_PERS', 'Pet Owner')],
        ['ObjDef.func', definition('ObjDef.func', 'OT_FUNC', 'Register')]
      ])
    ),
    connectionDefinitions: Object.freeze(new Map([[connectionDefinition.id, connectionDefinition]]))
  })
}

function attachment(
  id: string,
  x: number,
  y: number,
  width: number,
  height: number
): ArisAttachment {
  return Object.freeze({
    id,
    modelId: MODEL_ID,
    definitionId: `OLEDef.${id}`,
    bounds: Object.freeze({ x, y, width, height }),
    zOrder: null,
    blobCount: 1,
    rawAttributes: Object.freeze({})
  })
}

/** A `<GfxObj>` graphic frame as `buildFromSource` delivers it on the model. */
function graphicObject(
  id: string,
  bounds: {
    readonly x: number
    readonly y: number
    readonly width: number
    readonly height: number
  },
  penColor: string | null
): ArisGraphicObject {
  return Object.freeze({
    id,
    modelId: MODEL_ID,
    bounds: Object.freeze(bounds),
    shape: 'RoundedRectangle',
    shapeShaded: 'YES',
    hasSymbolEffect: null,
    penColor,
    penStyle: 'solid',
    penWidth: 1,
    fillColor: 'none',
    zOrder: null,
    rawAttributes: Object.freeze({})
  })
}

function boundNote(id: string, attributeType: string, x: number, y: number): ArisFreeText {
  return Object.freeze({
    id,
    modelId: MODEL_ID,
    definitionId: `FFTextDef.${id}`,
    text: Object.freeze({ values: Object.freeze({}), fallback: null }),
    attributes: Object.freeze([
      Object.freeze({
        type: 'AT_MODEL_AT',
        values: Object.freeze([Object.freeze({ localeId: 'en-US', text: attributeType })])
      }),
      Object.freeze({
        type: 'AT_MODEL_AT_GUID',
        values: Object.freeze([
          Object.freeze({ localeId: null, text: '00000000-0000-0000-0000-000000000000;55' })
        ])
      })
    ]),
    bounds: Object.freeze({ x, y, width: 0, height: 0 }),
    style: STYLE
  })
}

function modelWith(overrides: Partial<ArisModel>): ArisModel {
  const base = createEmptyArisModel({ id: MODEL_ID, type: 'MT_EEPC', name: 'Register profile' })
  return Object.freeze({ ...base, ...overrides })
}

describe('printFrameModelAttributeText — model attribute resolution', () => {
  it('reads AT_ID and AT_PERS_RESP from the model attributes', () => {
    const model = modelWith({
      attributes: Object.freeze([
        Object.freeze({
          type: 'AT_ID',
          values: Object.freeze([Object.freeze({ localeId: 'en-US', text: 'AWF.01.01' })])
        }),
        Object.freeze({
          type: 'AT_PERS_RESP',
          values: Object.freeze([Object.freeze({ localeId: 'en-US', text: 'Animal Welfare' })])
        })
      ])
    })
    expect(printFrameModelAttributeText(model, 'AT_ID')).toBe('AWF.01.01')
    expect(printFrameModelAttributeText(model, 'AT_PERS_RESP')).toBe('Animal Welfare')
  })

  it('resolves AT_NAME from the model display name', () => {
    const model = modelWith({})
    expect(printFrameModelAttributeText(model, 'AT_NAME')).toBe('Register profile')
  })

  it('honours the requested locale and returns empty when unset', () => {
    const model = modelWith({
      attributes: Object.freeze([
        Object.freeze({
          type: 'AT_ID',
          values: Object.freeze([
            Object.freeze({ localeId: 'en-US', text: 'AWF.01.01' }),
            Object.freeze({ localeId: 'ar-AE', text: 'رمز' })
          ])
        })
      ])
    })
    expect(printFrameModelAttributeText(model, 'AT_ID', 'ar-AE')).toBe('رمز')
    expect(printFrameModelAttributeText(model, 'AT_PROC_CODE')).toBe('')
  })
})

describe('buildPrintFrame — header, anchored values, attachments, legend slot', () => {
  it('builds computed rows above the content for an authored model', () => {
    const model = modelWith({
      attributes: Object.freeze([
        Object.freeze({
          type: 'AT_ID',
          values: Object.freeze([Object.freeze({ localeId: 'en-US', text: 'P-1' })])
        })
      ]),
      occurrences: Object.freeze([occurrence('ObjOcc.func', 'ObjDef.func', 1000, 1000)])
    })
    const frame = buildPrintFrame(model)
    expect(frame.header).not.toBeNull()
    expect(frame.header!.rows.map((row) => [row.label, row.value])).toEqual([
      ['Process Code', 'P-1'],
      ['Process Name', 'Register profile']
    ])
    // The band parks directly above the content.
    expect(frame.header!.bounds.y + frame.header!.bounds.height).toBeLessThanOrEqual(1000)
    // The legend slot sits below the content in the source's 3800×622 aspect.
    expect(frame.legend).not.toBeNull()
    expect(frame.legend!.bounds.y).toBeGreaterThanOrEqual(1000 + 240)
    expect(frame.legend!.tiles).toHaveLength(19)
  })

  it('resolves bound free-text notes at their exact source anchors', () => {
    const model = modelWith({
      attributes: Object.freeze([
        Object.freeze({
          type: 'AT_ID',
          values: Object.freeze([Object.freeze({ localeId: 'en-US', text: 'AWF.01.01' })])
        })
      ]),
      freeText: Object.freeze([boundNote('FFTextOcc.1', 'AT_ID', 1823, 122)]),
      attachments: Object.freeze([attachment('logo', 5403, 40, 1194, 320)]),
      occurrences: Object.freeze([occurrence('ObjOcc.func', 'ObjDef.func', 900, 900)])
    })
    const frame = buildPrintFrame(model)
    expect(frame.header!.anchoredValues).toHaveLength(1)
    const value = frame.header!.anchoredValues[0]!
    expect(value.text).toBe('AWF.01.01')
    expect(value.x).toBe(1823)
    expect(value.y).toBe(122)
    // An imported model draws its anchored values, not computed rows.
    expect(frame.header!.rows).toHaveLength(0)
    // The band anchors at the origin and encloses the org block.
    expect(frame.header!.bounds.x).toBe(0)
    expect(frame.header!.bounds.y).toBe(0)
    expect(frame.header!.bounds.width).toBeGreaterThanOrEqual(5403 + 1194)
    expect(frame.header!.bounds.height).toBeGreaterThanOrEqual(40 + 320)
    expect(frame.header!.orgBlock).toEqual({ x: 5403, y: 40, width: 1194, height: 320 })
  })

  it('positions the legend at the bottom-most attachment below the content', () => {
    const model = modelWith({
      occurrences: Object.freeze([occurrence('ObjOcc.func', 'ObjDef.func', 900, 900)]),
      attachments: Object.freeze([
        attachment('logo', 5403, 40, 1194, 320),
        attachment('legend', 450, 8139, 3800, 622)
      ])
    })
    const frame = buildPrintFrame(model)
    expect(frame.legend!.bounds).toEqual({ x: 450, y: 8139, width: 3800, height: 622 })
  })

  it('draws the header band at the authored GfxObj frame that encloses the title block', () => {
    const model = modelWith({
      attributes: Object.freeze([
        Object.freeze({
          type: 'AT_ID',
          values: Object.freeze([Object.freeze({ localeId: 'en-US', text: 'AWF.01.01' })])
        })
      ]),
      freeText: Object.freeze([boundNote('FFTextOcc.1', 'AT_ID', 1823, 122)]),
      attachments: Object.freeze([attachment('logo', 5403, 40, 1194, 320)]),
      graphicObjects: Object.freeze([
        graphicObject('GfxObj.header', { x: 0, y: 0, width: 6700, height: 388 }, '#006699'),
        graphicObject('GfxObj.laws', { x: 5880, y: 487, width: 742, height: 747 }, '#000000')
      ]),
      occurrences: Object.freeze([occurrence('ObjOcc.func', 'ObjDef.func', 900, 900)])
    })
    const frame = buildPrintFrame(model)
    // The band takes the authored frame's exact bounds, not the derived
    // furniture envelope (which measured 6637×400 here).
    expect(frame.header!.bounds).toEqual({ x: 0, y: 0, width: 6700, height: 388 })
    expect(frame.header!.sourceFrameId).toBe('GfxObj.header')
    // The header's own frame is not drawn twice; the Reference-Laws box is the
    // one remaining graphic frame, at its authored bounds and pen.
    expect(frame.graphicFrames.map((graphic) => graphic.id)).toEqual(['GfxObj.laws'])
    expect(frame.graphicFrames[0]).toMatchObject({
      bounds: { x: 5880, y: 487, width: 742, height: 747 },
      penColor: '#000000',
      penWidth: 1,
      fillColor: 'none'
    })
  })

  it('falls back to the derived envelope when no authored frame encloses the title block', () => {
    const model = modelWith({
      attributes: Object.freeze([
        Object.freeze({
          type: 'AT_ID',
          values: Object.freeze([Object.freeze({ localeId: 'en-US', text: 'AWF.01.01' })])
        })
      ]),
      freeText: Object.freeze([boundNote('FFTextOcc.1', 'AT_ID', 1823, 122)]),
      attachments: Object.freeze([attachment('logo', 5403, 40, 1194, 320)]),
      // A frame that sits beside the header area must not capture the band.
      graphicObjects: Object.freeze([
        graphicObject('GfxObj.laws', { x: 5880, y: 487, width: 742, height: 747 }, '#000000')
      ]),
      occurrences: Object.freeze([occurrence('ObjOcc.func', 'ObjDef.func', 900, 900)])
    })
    const frame = buildPrintFrame(model)
    expect(frame.header!.sourceFrameId).toBeNull()
    expect(frame.header!.bounds.width).toBeGreaterThanOrEqual(5403 + 1194)
    expect(frame.graphicFrames.map((graphic) => graphic.id)).toEqual(['GfxObj.laws'])
  })

  it('renders nothing for an empty model', () => {
    const frame = buildPrintFrame(modelWith({}))
    expect(frame.header).toBeNull()
    expect(frame.legend).toBeNull()
  })

  it('omits the legend when the option disables it', () => {
    const model = modelWith({
      occurrences: Object.freeze([occurrence('ObjOcc.func', 'ObjDef.func', 900, 900)])
    })
    const frame = buildPrintFrame(model, { legend: false })
    expect(frame.legend).toBeNull()
  })
})

describe('drawPrintFrame — SVG furniture', () => {
  it('draws the band, the org block, the rows, and the legend into one group', () => {
    const model = modelWith({
      attributes: Object.freeze([
        Object.freeze({
          type: 'AT_ID',
          values: Object.freeze([Object.freeze({ localeId: 'en-US', text: 'P-1' })])
        })
      ]),
      occurrences: Object.freeze([occurrence('ObjOcc.func', 'ObjDef.func', 1000, 1000)])
    })
    const parent = document.createElementNS(SVG_NS, 'g')
    drawPrintFrame(parent, buildPrintFrame(model), { modelName: 'Register profile' })
    const group = parent.querySelector('[data-aris-print-frame]')
    expect(group).not.toBeNull()
    expect(group!.querySelector('[data-aris-print-frame-header]')).not.toBeNull()
    expect(group!.querySelector('[data-aris-print-frame-legend]')).not.toBeNull()
    const texts = [...group!.querySelectorAll('text')].map((node) => node.textContent)
    expect(texts).toContain('Process Code')
    expect(texts).toContain('P-1')
    expect(texts).toContain('Process Name')
    expect(texts).toContain('Register profile')
  })

  it('paints anchored values and marks the org block as an OLE placeholder', () => {
    const model = modelWith({
      attributes: Object.freeze([
        Object.freeze({
          type: 'AT_ID',
          values: Object.freeze([Object.freeze({ localeId: 'en-US', text: 'AWF.01.01' })])
        })
      ]),
      freeText: Object.freeze([boundNote('FFTextOcc.1', 'AT_ID', 1823, 122)]),
      attachments: Object.freeze([attachment('logo', 5403, 40, 1194, 320)]),
      occurrences: Object.freeze([occurrence('ObjOcc.func', 'ObjDef.func', 900, 900)])
    })
    const parent = document.createElementNS(SVG_NS, 'g')
    drawPrintFrame(parent, buildPrintFrame(model), { modelName: 'Register profile' })
    const value = parent.querySelector('[data-aris-print-frame-text="anchored-value"]')
    expect(value?.textContent).toBe('AWF.01.01')
    expect(parent.querySelector('[data-aris-ole-pending]')).not.toBeNull()
  })

  it('draws each non-header graphic frame as an outline at its authored bounds and pen', () => {
    const model = modelWith({
      attributes: Object.freeze([
        Object.freeze({
          type: 'AT_ID',
          values: Object.freeze([Object.freeze({ localeId: 'en-US', text: 'AWF.01.01' })])
        })
      ]),
      freeText: Object.freeze([boundNote('FFTextOcc.1', 'AT_ID', 1823, 122)]),
      attachments: Object.freeze([attachment('logo', 5403, 40, 1194, 320)]),
      graphicObjects: Object.freeze([
        graphicObject('GfxObj.header', { x: 0, y: 0, width: 6700, height: 388 }, '#006699'),
        graphicObject('GfxObj.laws', { x: 5880, y: 487, width: 742, height: 747 }, '#000000')
      ]),
      occurrences: Object.freeze([occurrence('ObjOcc.func', 'ObjDef.func', 900, 900)])
    })
    const parent = document.createElementNS(SVG_NS, 'g')
    drawPrintFrame(parent, buildPrintFrame(model), { modelName: 'Register profile' })

    const frames = [...parent.querySelectorAll('[data-aris-graphic-frame]')]
    expect(frames.map((node) => node.getAttribute('data-aris-graphic-frame-id'))).toEqual([
      'GfxObj.laws'
    ])
    const rect = frames[0]!.querySelector('rect')!
    expect({
      x: Number(rect.getAttribute('x')),
      y: Number(rect.getAttribute('y')),
      width: Number(rect.getAttribute('width')),
      height: Number(rect.getAttribute('height'))
    }).toEqual({ x: 5880, y: 487, width: 742, height: 747 })
    expect(rect.getAttribute('stroke')).toBe('#000000')
    expect(rect.getAttribute('fill')).toBe('none')
    expect(frames[0]!.getAttribute('data-aris-graphic-frame-shape')).toBe('RoundedRectangle')
  })
})

describe('canvas integration — print-frame layer and RACI badges', () => {
  function printFrameLayer(): SVGGElement {
    return harness!.canvas.canvas.getLayer(ARIS_PRINT_FRAME_LAYER) as SVGGElement
  }

  it('draws the print frame into its own layer on boot', () => {
    harness = bootCanvas({ document: raciDocument([raciPlacement()]) })
    const layer = printFrameLayer()
    expect(layer.querySelector('[data-aris-print-frame-header]')).not.toBeNull()
    expect(layer.querySelector('[data-aris-print-frame-legend]')).not.toBeNull()
  })

  it('paints the tuple-safe RACI letter on the empty badge placement', () => {
    harness = bootCanvas({ document: raciDocument([raciPlacement()]) })
    const id = connectionLabelElementId('CxnOcc.1', 0, 'AT_TYPE_6')
    const gfx = harness.canvas.elementRegistry.getGraphics(id)
    const group = gfx.querySelector('[data-aris-kind="connectionLabel"]')!
    expect(group.getAttribute('data-aris-raci')).toBe('R')
    const letters = [...group.querySelectorAll('text')].map((node) => node.textContent)
    expect(letters).toContain('R')
  })

  it('derives I for an informed-about connection and stays silent for non-RACI types', () => {
    harness = bootCanvas({
      document: raciDocument([raciPlacement()], 'CT_MUST_BE_INFO_ABT_1')
    })
    const id = connectionLabelElementId('CxnOcc.1', 0, 'AT_TYPE_6')
    const gfx = harness.canvas.elementRegistry.getGraphics(id)
    const group = gfx.querySelector('[data-aris-kind="connectionLabel"]')!
    expect(group.getAttribute('data-aris-raci')).toBe('I')
  })

  it('never invents a badge for a non-RACI connection type', () => {
    harness = bootCanvas({ document: raciDocument([raciPlacement()], 'CT_SUPP_3') })
    const id = connectionLabelElementId('CxnOcc.1', 0, 'AT_TYPE_6')
    const gfx = harness.canvas.elementRegistry.getGraphics(id)
    const group = gfx.querySelector('[data-aris-kind="connectionLabel"]')!
    expect(group.getAttribute('data-aris-raci')).toBeNull()
  })

  it('never invents a badge on a non-RACI attribute placement', () => {
    harness = bootCanvas({ document: raciDocument([raciPlacement({ attributeType: 'AT_NAME' })]) })
    const id = connectionLabelElementId('CxnOcc.1', 0, 'AT_NAME')
    const gfx = harness.canvas.elementRegistry.getGraphics(id)
    const group = gfx.querySelector('[data-aris-kind="connectionLabel"]')!
    expect(group.getAttribute('data-aris-raci')).toBeNull()
  })

  it('hides and restores the print frame through the renderer toggle', () => {
    harness = bootCanvas({ document: raciDocument([raciPlacement()]) })
    const renderer = harness.canvas.get<ArisRenderer>('arisRenderer')
    expect(renderer.printFrameVisible).toBe(true)
    renderer.setPrintFrameVisible(false)
    expect(printFrameLayer().querySelector('[data-aris-print-frame]')).toBeNull()
    renderer.setPrintFrameVisible(true)
    expect(printFrameLayer().querySelector('[data-aris-print-frame]')).not.toBeNull()
  })

  it('rebuilds the frame on a model switch', () => {
    const second = modelWith({
      id: 'Model.2',
      attributes: Object.freeze([
        Object.freeze({
          type: 'AT_ID',
          values: Object.freeze([Object.freeze({ localeId: 'en-US', text: 'SECOND-9' })])
        })
      ]),
      occurrences: Object.freeze([
        Object.freeze({
          ...occurrence('ObjOcc.other', 'ObjDef.func', 5000, 5000),
          modelId: 'Model.2'
        })
      ])
    })
    const base = raciDocument([raciPlacement()])
    const models = new Map(base.models)
    models.set(second.id, second)
    harness = bootCanvas({
      document: Object.freeze({ ...base, models: Object.freeze(models) })
    })
    expect(printFrameLayer().textContent).not.toContain('SECOND-9')
    harness.canvas.setActiveModel('Model.2')
    expect(printFrameLayer().textContent).toContain('SECOND-9')
    // The diagram content itself is unaffected by the furniture.
    const occurrenceIds = harness.canvas.elementRegistry
      .getAll()
      .filter((element) => arisBusinessObject(element)?.kind === 'occurrence')
      .map((element) => element.id)
    expect(occurrenceIds).toEqual(['ObjOcc.other'])
  })
})
