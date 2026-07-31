// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'

import type {
  ArisConnectionDefinition,
  ArisModel,
  ArisObjectDefinition,
  ArisWorkingDocument
} from '../model/types'
import {
  createEmptyArisDocument,
  createEmptyArisModel,
  localizedValue,
  EMPTY_ARIS_SOURCE_INDEX
} from './emptyDocument'
import { occurrenceColorToCss } from './renderer'
import { bootCanvas, type Harness } from './testing/harness'

/**
 * Occurrence style is *drawn*, not merely stored — plan §12.2 ("use source symbol/style data when
 * present") and §8.2 ("occurrence position/size/symbol/text placement/style affect only that
 * occurrence").
 *
 * The regression this guards: `ArisRenderer` painted straight from the symbol descriptor and never
 * read `occurrence.style`, so `restyleOccurrence` was stored, undoable and exported while having
 * no visual effect whatsoever. Every assertion below reads the emitted SVG rather than the model.
 */

const MODEL_ID = 'Model.1'

let harness: Harness | null = null

afterEach(() => {
  harness?.destroy()
  harness = null
})

interface OccurrenceSpec {
  readonly id: string
  readonly symbol?: string
  readonly x?: number
  readonly fillColor?: string | null
  readonly strokeColor?: string | null
  readonly strokeWidth?: number | null
  readonly lineStyle?: string | null
}

function documentWith(specs: readonly OccurrenceSpec[]): ArisWorkingDocument {
  const definition: ArisObjectDefinition = Object.freeze({
    id: 'ObjDef.1',
    type: 'OT_FUNC',
    defaultSymbol: 'ST_FUNC',
    names: localizedValue('Step'),
    attributes: Object.freeze([]),
    linkedModelIds: Object.freeze([]),
    rawAttributes: Object.freeze({})
  })

  const base = createEmptyArisModel({ id: MODEL_ID, type: 'MT_EEPC', name: 'Styles' })
  const model: ArisModel = Object.freeze({
    ...base,
    occurrences: Object.freeze(
      specs.map((spec, index) =>
        Object.freeze({
          id: spec.id,
          definitionId: definition.id,
          modelId: MODEL_ID,
          symbol: spec.symbol ?? 'ST_FUNC',
          bounds: Object.freeze({ x: spec.x ?? index * 300, y: 0, width: 100, height: 60 }),
          style: Object.freeze({
            symbol: spec.symbol ?? 'ST_FUNC',
            fillColor: spec.fillColor ?? null,
            strokeColor: spec.strokeColor ?? null,
            strokeWidth: spec.strokeWidth ?? null,
            lineStyle: spec.lineStyle ?? null,
            fontStyleSheetId: null,
            zOrder: null
          }),
          attributeOccurrences: Object.freeze([]),
          rawAttributes: Object.freeze({})
        })
      )
    )
  })

  const empty = createEmptyArisDocument({ models: [model] })
  return Object.freeze({
    ...empty,
    objectDefinitions: Object.freeze(new Map([[definition.id, definition]])),
    sourceIndex: EMPTY_ARIS_SOURCE_INDEX
  })
}

/** Every primitive the canvas drew for one occurrence, in draw order. */
function primitivesOf(occurrenceId: string): readonly Element[] {
  const gfx = harness!.canvas.elementRegistry.getGraphics(occurrenceId)
  const group = gfx.querySelector('[data-aris-kind="occurrence"]')
  if (!group) throw new Error(`No occurrence group rendered for ${occurrenceId}.`)
  return [...group.children].filter((child) => child.tagName.toLowerCase() !== 'text')
}

function partOf(occurrenceId: string, part: 'surface' | 'accent' | 'icon'): Element {
  const gfx = harness!.canvas.elementRegistry.getGraphics(occurrenceId)
  const element = gfx.querySelector(`[data-aris-kind="occurrence"] > [data-aris-part="${part}"]`)
  if (!element) throw new Error(`No ${part} primitive rendered for ${occurrenceId}.`)
  return element
}

function accentOf(occurrenceId: string): Element {
  return partOf(occurrenceId, 'accent')
}

function surfaceOf(occurrenceId: string): Element {
  return partOf(occurrenceId, 'surface')
}

describe('occurrenceColorToCss accepts both spellings that reach the canvas', () => {
  it('byte-swaps an unpadded AML COLORREF and passes CSS/convention colours through', () => {
    // The AML spelling: an unsigned 0xBBGGRR integer serialized without padding.
    expect(occurrenceColorToCss('cccccc')).toBe('#cccccc')
    expect(occurrenceColorToCss('99')).toBe('#990000')
    expect(occurrenceColorToCss('339900')).toBe('#009933')
    expect(occurrenceColorToCss('d7c49d')).toBe('#9dc4d7')
    expect(occurrenceColorToCss('dcbbed')).toBe('#edbbdc')
    // The details rail and convention catalog spelling is already RGB.
    expect(occurrenceColorToCss('#00ff00')).toBe('#00ff00')
    expect(occurrenceColorToCss('#339900')).toBe('#339900')
    // A CSS keyword survives rather than being parsed as hex.
    expect(occurrenceColorToCss('transparent')).toBe('transparent')
  })

  it('treats absent, empty and the -1 sentinel as "no override"', () => {
    expect(occurrenceColorToCss(null)).toBeUndefined()
    expect(occurrenceColorToCss(undefined)).toBeUndefined()
    expect(occurrenceColorToCss('  ')).toBeUndefined()
    expect(occurrenceColorToCss('-1')).toBeUndefined()
  })
})

describe('the canvas draws the occurrence style it was given', () => {
  it('draws decoded AnimalWF app-system, event and function colors without a second swap', () => {
    harness = bootCanvas({
      document: documentWith([
        { id: 'ObjOcc.app-color', fillColor: '#9dc4d7' },
        { id: 'ObjOcc.event-color', fillColor: '#edbbdc' },
        { id: 'ObjOcc.function', symbol: 'ST_FUNC', fillColor: '#009933' },
        { id: 'ObjOcc.default', symbol: 'ST_FUNC' }
      ]),
      modelId: MODEL_ID
    })

    expect(accentOf('ObjOcc.app-color').getAttribute('fill')).toBe('#9dc4d7')
    expect(accentOf('ObjOcc.event-color').getAttribute('fill')).toBe('#edbbdc')
    expect(accentOf('ObjOcc.function').getAttribute('fill')).toBe('#009933')
    // Catalog defaults are authored as RGB and remain byte-for-byte unchanged.
    expect(accentOf('ObjOcc.default').getAttribute('fill')).toBe('#339900')
    expect(surfaceOf('ObjOcc.app-color').getAttribute('fill')).toBe('#ffffff')
  })

  it('paints a source brush colour over the symbol’s authored fill', () => {
    harness = bootCanvas({
      document: documentWith([{ id: 'ObjOcc.1' }, { id: 'ObjOcc.2', fillColor: 'cccccc' }]),
      modelId: MODEL_ID
    })
    // Unstyled: the registry's own fill for ST_FUNC (plan R1 DMT default).
    expect(accentOf('ObjOcc.1').getAttribute('fill')).toBe('#339900')
    // Styled: the occurrence's brush wins (§12.2 "source style data wins when present").
    expect(accentOf('ObjOcc.2').getAttribute('fill')).toBe('#cccccc')
    expect(surfaceOf('ObjOcc.2').getAttribute('fill')).toBe('#ffffff')
  })

  it('paints outline colour, width and line style on every primitive', () => {
    harness = bootCanvas({
      document: documentWith([
        {
          id: 'ObjOcc.1',
          symbol: 'ST_SYS_FUNC_ACT',
          strokeColor: '339900',
          strokeWidth: 4,
          lineStyle: 'dashed'
        }
      ]),
      modelId: MODEL_ID
    })
    const surface = surfaceOf('ObjOcc.1')
    expect(surface.getAttribute('stroke')).toBe('#009933')
    // strokeWidth 4 × ARIS_PEN_UNIT (2.646) — Wave 9 P2 pen-width scale.
    expect(surface.getAttribute('stroke-width')).toBe('10.584')
    expect(surface.getAttribute('stroke-dasharray')).toBe('6 4')
    // DMT icon strokes are always white and non-scaling.
    const icon = partOf('ObjOcc.1', 'icon')
    expect(icon.getAttribute('stroke')).toBe('#ffffff')
    expect(icon.getAttribute('stroke-dasharray')).toBeNull()
    expect(icon.getAttribute('vector-effect')).toBe('non-scaling-stroke')
  })

  it('colours only the DMT accent, leaving the white card and icon intact', () => {
    harness = bootCanvas({
      document: documentWith([{ id: 'ObjOcc.1', symbol: 'ST_SYS_FUNC_ACT', fillColor: '#ff00aa' }]),
      modelId: MODEL_ID
    })
    expect(accentOf('ObjOcc.1').getAttribute('fill')).toBe('#ff00aa')
    expect(surfaceOf('ObjOcc.1').getAttribute('fill')).toBe('#ffffff')
    const icons = primitivesOf('ObjOcc.1').filter(
      (primitive) => primitive.getAttribute('data-aris-part') === 'icon'
    )
    expect(icons.length).toBeGreaterThan(1)
    expect(icons.some((icon) => icon.getAttribute('stroke') === '#ffffff')).toBe(true)
    expect(icons.every((icon) => icon.getAttribute('fill') !== '#ff00aa')).toBe(true)
  })

  it('leaves the symbol geometry to the registry — only the paint changes', () => {
    harness = bootCanvas({
      document: documentWith([{ id: 'ObjOcc.1' }, { id: 'ObjOcc.2', fillColor: '#ff00aa' }]),
      modelId: MODEL_ID
    })
    const shapeOf = (id: string): string => {
      const body = surfaceOf(id)
      return `${body.tagName}|${body.getAttribute('x')}|${body.getAttribute('y')}|${body.getAttribute('width')}|${body.getAttribute('height')}`
    }
    expect(shapeOf('ObjOcc.2')).toBe(shapeOf('ObjOcc.1'))
  })
})

describe('source connection paint reaches the canvas', () => {
  it('draws a decoded connection Pen color instead of the renderer fallback', () => {
    const base = documentWith([
      { id: 'ObjOcc.1', x: 0 },
      { id: 'ObjOcc.2', x: 300 }
    ])
    const model = base.models.get(MODEL_ID)!
    const connectionDefinition: ArisConnectionDefinition = Object.freeze({
      id: 'CxnDef.1',
      type: 'CT_ACTIV_1',
      fromObjectDefinitionId: 'ObjDef.1',
      toObjectDefinitionId: 'ObjDef.1',
      names: localizedValue(''),
      attributes: Object.freeze([])
    })
    const document: ArisWorkingDocument = Object.freeze({
      ...base,
      models: Object.freeze(
        new Map([
          [
            MODEL_ID,
            Object.freeze({
              ...model,
              connectionOccurrences: Object.freeze([
                Object.freeze({
                  id: 'CxnOcc.1',
                  definitionId: connectionDefinition.id,
                  modelId: MODEL_ID,
                  sourceOccurrenceId: 'ObjOcc.1',
                  targetOccurrenceId: 'ObjOcc.2',
                  route: Object.freeze([]),
                  style: Object.freeze({
                    color: '#006699',
                    width: null,
                    lineStyle: null,
                    srcArrow: null,
                    tgtArrow: null,
                    fontStyleSheetId: null,
                    zOrder: null
                  }),
                  attributeOccurrences: Object.freeze([]),
                  rawAttributes: Object.freeze({})
                })
              ])
            })
          ]
        ])
      ),
      connectionDefinitions: Object.freeze(
        new Map([[connectionDefinition.id, connectionDefinition]])
      )
    })

    harness = bootCanvas({ document, modelId: MODEL_ID })
    const gfx = harness.canvas.elementRegistry.getGraphics('CxnOcc.1')
    const line = gfx.querySelector<SVGElement>('[data-aris-connection-type]')
    expect(line?.style.stroke).toBe('rgb(0, 102, 153)')
  })
})

describe('an edited style changes the rendered output (§11.4 restyle occurrence)', () => {
  it('repaints the shape the moment restyleOccurrence runs, and undo puts it back', () => {
    harness = bootCanvas({ document: documentWith([{ id: 'ObjOcc.1' }]), modelId: MODEL_ID })
    const before = accentOf('ObjOcc.1').getAttribute('fill')
    expect(before).toBe('#339900')

    harness.canvas.authoring.restyleOccurrence('ObjOcc.1', { fillColor: '#00ff00' })
    expect(accentOf('ObjOcc.1').getAttribute('fill')).toBe('#00ff00')

    harness.canvas.authoring.restyleOccurrence('ObjOcc.1', { strokeColor: '#ff0000' })
    expect(surfaceOf('ObjOcc.1').getAttribute('stroke')).toBe('#ff0000')

    harness.canvas.authoring.restyleOccurrence('ObjOcc.1', { lineStyle: 'dotted' })
    expect(surfaceOf('ObjOcc.1').getAttribute('stroke-dasharray')).toBe('2 3')

    harness.canvas.undo()
    expect(surfaceOf('ObjOcc.1').getAttribute('stroke-dasharray')).toBeNull()
    harness.canvas.undo()
    expect(surfaceOf('ObjOcc.1').getAttribute('stroke')).not.toBe('#ff0000')
    harness.canvas.undo()
    expect(accentOf('ObjOcc.1').getAttribute('fill')).toBe(before)
  })

  it('clears an override back to the symbol’s own appearance', () => {
    harness = bootCanvas({
      document: documentWith([{ id: 'ObjOcc.1', fillColor: 'cccccc' }]),
      modelId: MODEL_ID
    })
    expect(accentOf('ObjOcc.1').getAttribute('fill')).toBe('#cccccc')
    harness.canvas.authoring.restyleOccurrence('ObjOcc.1', { fillColor: null })
    expect(accentOf('ObjOcc.1').getAttribute('fill')).toBe('#339900')
  })
})

describe('a style change affects only that occurrence (plan §8.2)', () => {
  it('leaves a sibling occurrence of the same definition, and the definition, untouched', () => {
    harness = bootCanvas({
      document: documentWith([{ id: 'ObjOcc.1' }, { id: 'ObjOcc.2' }, { id: 'ObjOcc.3' }]),
      modelId: MODEL_ID
    })
    const definitionBefore = harness.canvas.document.objectDefinitions.get('ObjDef.1')
    const siblingBefore = accentOf('ObjOcc.2').getAttribute('fill')
    const otherBefore = accentOf('ObjOcc.3').getAttribute('fill')

    harness.canvas.authoring.restyleOccurrence('ObjOcc.1', {
      fillColor: '#ff00aa',
      strokeColor: '#0000ff',
      strokeWidth: 5,
      lineStyle: 'dashed'
    })

    expect(accentOf('ObjOcc.1').getAttribute('fill')).toBe('#ff00aa')
    // Siblings share the definition — and nothing else.
    expect(accentOf('ObjOcc.2').getAttribute('fill')).toBe(siblingBefore)
    expect(surfaceOf('ObjOcc.2').getAttribute('stroke-dasharray')).toBeNull()
    expect(accentOf('ObjOcc.3').getAttribute('fill')).toBe(otherBefore)

    const model = harness.canvas.document.models.get(MODEL_ID)!
    const styles = model.occurrences.map((occurrence) => occurrence.style.fillColor)
    expect(styles).toEqual(['#ff00aa', null, null])

    // The shared definition is byte-identical: no style leaked up to it.
    expect(harness.canvas.document.objectDefinitions.get('ObjDef.1')).toEqual(definitionBefore)
  })
})
