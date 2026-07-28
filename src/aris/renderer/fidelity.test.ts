import { describe, expect, it } from 'vitest'

import { buildArisRenderModel } from './buildRenderModel'
import { ARIS_RENDER_FIDELITY_KINDS } from './types'
import { buildEmptyModelInput, rec } from './testFixtures'
import type {
  RenderSourceAttachment,
  RenderSourceAttachmentOccurrence,
  RenderSourceAttribute,
  RenderSourceBrush,
  RenderSourceObjectDefinition,
  RenderSourceObjectOccurrence,
  RenderSourcePen
} from './input'

describe('Section 12.3 fidelity findings — one fixture per kind', () => {
  it('reports unknown-custom-symbol for a symbol triple absent from the registry, with a visible fallback', () => {
    const input = buildEmptyModelInput()
    const objectDefinitions = new Map<string, RenderSourceObjectDefinition>([
      ['ObjDef.1', rec('ObjDef.1', 'p', { objectDefinitionId: 'ObjDef.1', typeNum: 'OT_TOTALLY_UNKNOWN', symbolNum: 'ST_NOPE' })]
    ])
    const objectOccurrences = new Map<string, RenderSourceObjectOccurrence>([
      [
        'ObjOcc.1',
        rec('ObjOcc.1', 'p', {
          objectOccurrenceId: 'ObjOcc.1',
          modelId: 'Model.1',
          objectDefinitionId: 'ObjDef.1',
          symbolNum: 'ST_NOPE',
          zorder: 0,
          x: 0,
          y: 0,
          dx: 100,
          dy: 80,
          symbolGuid: null
        })
      ]
    ])
    const result = buildArisRenderModel({ ...input, objectDefinitions, objectOccurrences })
    const element = result.models[0].elements[0]

    // The visible fallback (rounded rectangle + red hatching + "?"), not a blank/silent drop.
    expect(element.symbol.key).toBe('orbitpm:unknown-symbol')
    expect(element.symbol.drawing.elements.length).toBeGreaterThan(0)
    expect(
      result.fidelity.some((f) => f.kind === 'unknown-custom-symbol' && f.elementId === 'ObjOcc.1')
    ).toBe(true)
  })

  it('reports substituted-visual-resource when a symbol is only known under a different model type', () => {
    const input = buildEmptyModelInput({ modelType: 'MT_VAL_ADD_CHN_DGM' })
    const objectDefinitions = new Map<string, RenderSourceObjectDefinition>([
      ['ObjDef.1', rec('ObjDef.1', 'p', { objectDefinitionId: 'ObjDef.1', typeNum: 'OT_FUNC', symbolNum: 'ST_FUNC' })]
    ])
    const objectOccurrences = new Map<string, RenderSourceObjectOccurrence>([
      [
        'ObjOcc.1',
        rec('ObjOcc.1', 'p', {
          objectOccurrenceId: 'ObjOcc.1',
          modelId: 'Model.1',
          objectDefinitionId: 'ObjDef.1',
          symbolNum: 'ST_FUNC',
          zorder: 0,
          x: 0,
          y: 0,
          dx: 100,
          dy: 80,
          symbolGuid: null
        })
      ]
    ])
    const result = buildArisRenderModel({ ...input, objectDefinitions, objectOccurrences })
    expect(
      result.fidelity.some((f) => f.kind === 'substituted-visual-resource' && f.elementId === 'ObjOcc.1')
    ).toBe(true)
  })

  it('reports missing-template when the model declares a TemplateGUID', () => {
    const input = buildEmptyModelInput({ templateGuid: '4308e940-7cf7-11e2-1759-5cf9dd72f82f' })
    const result = buildArisRenderModel(input)
    expect(
      result.fidelity.some(
        (f) =>
          f.kind === 'missing-template' &&
          f.modelId === 'Model.1' &&
          f.params.templateGuid === '4308e940-7cf7-11e2-1759-5cf9dd72f82f'
      )
    ).toBe(true)
  })

  it('reports unsupported-pen-effect for a pen style code outside the documented PS_* range', () => {
    const input = buildEmptyModelInput()
    const objectOccurrences = new Map<string, RenderSourceObjectOccurrence>([
      [
        'ObjOcc.1',
        rec('ObjOcc.1', 'p', {
          objectOccurrenceId: 'ObjOcc.1',
          modelId: 'Model.1',
          objectDefinitionId: null,
          symbolNum: 'ST_FUNC',
          zorder: 0,
          x: 0,
          y: 0,
          dx: 100,
          dy: 80,
          symbolGuid: null
        })
      ]
    ])
    const pens: RenderSourcePen[] = [rec('Pen.1', 'p', { ownerSourceId: 'ObjOcc.1', color: '0', style: '9', width: 1 })]
    const result = buildArisRenderModel({ ...input, objectOccurrences, styles: { ...input.styles, pens } })
    expect(
      result.fidelity.some((f) => f.kind === 'unsupported-pen-effect' && f.elementId === 'ObjOcc.1' && f.params.style === '9')
    ).toBe(true)
  })

  it('reports unsupported-brush-effect for a hatch/pattern BrushType', () => {
    const input = buildEmptyModelInput()
    const objectOccurrences = new Map<string, RenderSourceObjectOccurrence>([
      [
        'ObjOcc.1',
        rec('ObjOcc.1', 'p', {
          objectOccurrenceId: 'ObjOcc.1',
          modelId: 'Model.1',
          objectDefinitionId: null,
          symbolNum: 'ST_FUNC',
          zorder: 0,
          x: 0,
          y: 0,
          dx: 100,
          dy: 80,
          symbolGuid: null
        })
      ]
    ])
    const brushes: RenderSourceBrush[] = [
      rec('Brush.1', 'p', { ownerSourceId: 'ObjOcc.1', color: '996600', color2: '0', brushType: 'DIAGCROSS' })
    ]
    const result = buildArisRenderModel({ ...input, objectOccurrences, styles: { ...input.styles, brushes } })
    expect(
      result.fidelity.some(
        (f) => f.kind === 'unsupported-brush-effect' && f.elementId === 'ObjOcc.1' && f.params.brushType === 'DIAGCROSS'
      )
    ).toBe(true)
  })

  it('reports unsupported-ole-rendering for every OLE occurrence', () => {
    const input = buildEmptyModelInput()
    const attachments = new Map<string, RenderSourceAttachment>([
      ['OLEDef.1', rec('OLEDef.1', 'p', { attachmentId: 'OLEDef.1', blobCount: 2 })]
    ])
    const attachmentOccurrences: RenderSourceAttachmentOccurrence[] = [
      rec('OLEOcc.1', 'p', { modelId: 'Model.1', attachmentOccurrenceId: 'OLEOcc.1', attachmentId: 'OLEDef.1', zorder: 0, x: 0, y: 0, dx: 40, dy: 40 })
    ]
    const result = buildArisRenderModel({ ...input, attachments, attachmentOccurrences })
    expect(result.fidelity.some((f) => f.kind === 'unsupported-ole-rendering' && f.elementId === 'OLEOcc.1')).toBe(true)
  })

  it('reports missing-reference-export when an attachment definition exported zero blobs', () => {
    const input = buildEmptyModelInput()
    const attachments = new Map<string, RenderSourceAttachment>([
      ['OLEDef.1', rec('OLEDef.1', 'p', { attachmentId: 'OLEDef.1', blobCount: 0 })]
    ])
    const attachmentOccurrences: RenderSourceAttachmentOccurrence[] = [
      rec('OLEOcc.1', 'p', { modelId: 'Model.1', attachmentOccurrenceId: 'OLEOcc.1', attachmentId: 'OLEDef.1', zorder: 0, x: 0, y: 0, dx: 40, dy: 40 })
    ]
    const result = buildArisRenderModel({ ...input, attachments, attachmentOccurrences })
    expect(
      result.fidelity.some((f) => f.kind === 'missing-reference-export' && f.elementId === 'OLEOcc.1')
    ).toBe(true)
  })

  it('reports missing-font for a face name outside the OrbitPM safe-font allowlist', () => {
    const input = buildEmptyModelInput()
    const objectDefinitions = new Map<string, RenderSourceObjectDefinition>([
      ['ObjDef.1', rec('ObjDef.1', 'p', { objectDefinitionId: 'ObjDef.1', typeNum: 'OT_FUNC', symbolNum: 'ST_FUNC' })]
    ])
    const objectOccurrences = new Map<string, RenderSourceObjectOccurrence>([
      [
        'ObjOcc.1',
        rec('ObjOcc.1', 'p', {
          objectOccurrenceId: 'ObjOcc.1',
          modelId: 'Model.1',
          objectDefinitionId: 'ObjDef.1',
          symbolNum: 'ST_FUNC',
          zorder: 0,
          x: 0,
          y: 0,
          dx: 100,
          dy: 80,
          symbolGuid: null
        })
      ]
    ])
    const attributes: RenderSourceAttribute[] = [
      rec('AttrDef.1', 'p', { ownerSourceId: 'ObjDef.1', attributeType: 'AT_NAME', values: [{ locale: 'en', text: 'Legacy Step' }] })
    ]
    const fontStyleSheets = new Map(input.styles.fontStyleSheets)
    fontStyleSheets.set('FontSS.1', rec('FontSS.1', 'p', { fontStyleSheetId: 'FontSS.1' }))
    const fonts = [
      rec('FontNode.1', 'p', {
        ownerSourceId: 'FontSS.1',
        localeId: '1033',
        locale: 'en' as const,
        faceName: 'Wingding-Proprietary-Face',
        height: -12,
        weight: 400,
        italic: 'NO',
        underline: 'NO',
        strikeOut: 'NO',
        color: '0'
      })
    ]
    const attributeOccurrences = [
      rec('AttrOcc.1', 'p', {
        ownerSourceId: 'ObjOcc.1',
        attributeType: 'AT_NAME',
        port: null,
        orderNum: 0,
        alignment: 'CENTER',
        fontStyleSheetId: 'FontSS.1',
        offsetX: 0,
        offsetY: 0,
        rotation: 0,
        dx: 100,
        dy: 40
      })
    ]
    const result = buildArisRenderModel({
      ...input,
      objectDefinitions,
      objectOccurrences,
      attributes,
      attributeOccurrences,
      styles: { ...input.styles, fontStyleSheets, fonts }
    })
    expect(
      result.fidelity.some(
        (f) => f.kind === 'missing-font' && f.params.faceName === 'Wingding-Proprietary-Face' && f.elementId === 'ObjOcc.1'
      )
    ).toBe(true)
  })

  it('reports text-wrap-difference when computed layout requires more than one line', () => {
    const input = buildEmptyModelInput()
    const objectDefinitions = new Map<string, RenderSourceObjectDefinition>([
      ['ObjDef.1', rec('ObjDef.1', 'p', { objectDefinitionId: 'ObjDef.1', typeNum: 'OT_FUNC', symbolNum: 'ST_FUNC' })]
    ])
    const objectOccurrences = new Map<string, RenderSourceObjectOccurrence>([
      [
        'ObjOcc.1',
        rec('ObjOcc.1', 'p', {
          objectOccurrenceId: 'ObjOcc.1',
          modelId: 'Model.1',
          objectDefinitionId: 'ObjDef.1',
          symbolNum: 'ST_FUNC',
          zorder: 0,
          x: 0,
          y: 0,
          dx: 40, // deliberately narrow, to force a wrap of the long name below
          dy: 80,
          symbolGuid: null
        })
      ]
    ])
    const attributes: RenderSourceAttribute[] = [
      rec('AttrDef.1', 'p', {
        ownerSourceId: 'ObjDef.1',
        attributeType: 'AT_NAME',
        values: [{ locale: 'en', text: 'Register and validate the animal owner application form' }]
      })
    ]
    const result = buildArisRenderModel({ ...input, objectDefinitions, objectOccurrences, attributes })
    const element = result.models[0].elements[0]
    expect(element.name?.wrapped).toBe(true)
    expect(element.name?.lines.length).toBeGreaterThan(1)
    expect(result.fidelity.some((f) => f.kind === 'text-wrap-difference' && f.elementId === 'ObjOcc.1')).toBe(true)
  })

  it('lists every Section 12.3 finding kind in ARIS_RENDER_FIDELITY_KINDS', () => {
    expect(ARIS_RENDER_FIDELITY_KINDS).toEqual([
      'missing-font',
      'missing-template',
      'unknown-custom-symbol',
      'substituted-visual-resource',
      'unsupported-pen-effect',
      'unsupported-brush-effect',
      'unsupported-ole-rendering',
      'text-wrap-difference',
      'missing-reference-export'
    ])
  })
})
