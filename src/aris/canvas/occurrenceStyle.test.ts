// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'

import type { ArisModel, ArisObjectDefinition, ArisWorkingDocument } from '../model/types'
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

function bodyOf(occurrenceId: string): Element {
  const first = primitivesOf(occurrenceId)[0]
  if (!first) throw new Error(`No body primitive rendered for ${occurrenceId}.`)
  return first
}

describe('occurrenceColorToCss accepts both spellings that reach the canvas', () => {
  it('parses an unpadded ARIS hex integer and passes a CSS colour through', () => {
    // The AML spelling: an unsigned 0xRRGGBB integer serialized without padding.
    expect(occurrenceColorToCss('cccccc')).toBe('#cccccc')
    expect(occurrenceColorToCss('99')).toBe('#000099')
    expect(occurrenceColorToCss('339900')).toBe('#339900')
    // The details rail's spelling.
    expect(occurrenceColorToCss('#00ff00')).toBe('#00ff00')
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
  it('paints a source brush colour over the symbol’s authored fill', () => {
    harness = bootCanvas({
      document: documentWith([{ id: 'ObjOcc.1' }, { id: 'ObjOcc.2', fillColor: 'cccccc' }]),
      modelId: MODEL_ID
    })
    // Unstyled: the registry's own fill for ST_FUNC.
    expect(bodyOf('ObjOcc.1').getAttribute('fill')).toBe('#f3f4f6')
    // Styled: the occurrence's brush wins (§12.2 "source style data wins when present").
    expect(bodyOf('ObjOcc.2').getAttribute('fill')).toBe('#cccccc')
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
    const primitives = primitivesOf('ObjOcc.1')
    expect(primitives.length).toBeGreaterThan(1)
    for (const primitive of primitives) {
      expect(primitive.getAttribute('stroke')).toBe('#339900')
      expect(primitive.getAttribute('stroke-width')).toBe('4')
      expect(primitive.getAttribute('stroke-dasharray')).toBe('6 4')
    }
  })

  it('colours the symbol body only, leaving its accents intact', () => {
    // ST_SYS_FUNC_ACT is a body rect plus a cog path and a hub circle. A brush that flooded every
    // filled primitive would erase the cog, which is what makes the symbol recognizable.
    harness = bootCanvas({
      document: documentWith([{ id: 'ObjOcc.1', symbol: 'ST_SYS_FUNC_ACT', fillColor: '#ff00aa' }]),
      modelId: MODEL_ID
    })
    const [body, ...accents] = primitivesOf('ObjOcc.1')
    expect(body!.getAttribute('fill')).toBe('#ff00aa')
    const accentFills = accents.map((accent) => accent.getAttribute('fill'))
    expect(accentFills).toContain('#d1d5db')
    expect(accentFills).toContain('#9ca3af')
    expect(accentFills).not.toContain('#ff00aa')
  })

  it('leaves the symbol geometry to the registry — only the paint changes', () => {
    harness = bootCanvas({
      document: documentWith([{ id: 'ObjOcc.1' }, { id: 'ObjOcc.2', fillColor: '#ff00aa' }]),
      modelId: MODEL_ID
    })
    const shapeOf = (id: string): string => {
      const body = bodyOf(id)
      return `${body.tagName}|${body.getAttribute('x')}|${body.getAttribute('y')}|${body.getAttribute('width')}|${body.getAttribute('height')}`
    }
    expect(shapeOf('ObjOcc.2')).toBe(shapeOf('ObjOcc.1'))
  })
})

describe('an edited style changes the rendered output (§11.4 restyle occurrence)', () => {
  it('repaints the shape the moment restyleOccurrence runs, and undo puts it back', () => {
    harness = bootCanvas({ document: documentWith([{ id: 'ObjOcc.1' }]), modelId: MODEL_ID })
    const before = bodyOf('ObjOcc.1').getAttribute('fill')
    expect(before).toBe('#f3f4f6')

    harness.canvas.authoring.restyleOccurrence('ObjOcc.1', { fillColor: '#00ff00' })
    expect(bodyOf('ObjOcc.1').getAttribute('fill')).toBe('#00ff00')

    harness.canvas.authoring.restyleOccurrence('ObjOcc.1', { strokeColor: '#ff0000' })
    expect(bodyOf('ObjOcc.1').getAttribute('stroke')).toBe('#ff0000')

    harness.canvas.authoring.restyleOccurrence('ObjOcc.1', { lineStyle: 'dotted' })
    expect(bodyOf('ObjOcc.1').getAttribute('stroke-dasharray')).toBe('2 3')

    harness.canvas.undo()
    expect(bodyOf('ObjOcc.1').getAttribute('stroke-dasharray')).toBeNull()
    harness.canvas.undo()
    expect(bodyOf('ObjOcc.1').getAttribute('stroke')).not.toBe('#ff0000')
    harness.canvas.undo()
    expect(bodyOf('ObjOcc.1').getAttribute('fill')).toBe(before)
  })

  it('clears an override back to the symbol’s own appearance', () => {
    harness = bootCanvas({
      document: documentWith([{ id: 'ObjOcc.1', fillColor: 'cccccc' }]),
      modelId: MODEL_ID
    })
    expect(bodyOf('ObjOcc.1').getAttribute('fill')).toBe('#cccccc')
    harness.canvas.authoring.restyleOccurrence('ObjOcc.1', { fillColor: null })
    expect(bodyOf('ObjOcc.1').getAttribute('fill')).toBe('#f3f4f6')
  })
})

describe('a style change affects only that occurrence (plan §8.2)', () => {
  it('leaves a sibling occurrence of the same definition, and the definition, untouched', () => {
    harness = bootCanvas({
      document: documentWith([{ id: 'ObjOcc.1' }, { id: 'ObjOcc.2' }, { id: 'ObjOcc.3' }]),
      modelId: MODEL_ID
    })
    const definitionBefore = harness.canvas.document.objectDefinitions.get('ObjDef.1')
    const siblingBefore = bodyOf('ObjOcc.2').getAttribute('fill')
    const otherBefore = bodyOf('ObjOcc.3').getAttribute('fill')

    harness.canvas.authoring.restyleOccurrence('ObjOcc.1', {
      fillColor: '#ff00aa',
      strokeColor: '#0000ff',
      strokeWidth: 5,
      lineStyle: 'dashed'
    })

    expect(bodyOf('ObjOcc.1').getAttribute('fill')).toBe('#ff00aa')
    // Siblings share the definition — and nothing else.
    expect(bodyOf('ObjOcc.2').getAttribute('fill')).toBe(siblingBefore)
    expect(bodyOf('ObjOcc.2').getAttribute('stroke-dasharray')).toBeNull()
    expect(bodyOf('ObjOcc.3').getAttribute('fill')).toBe(otherBefore)

    const model = harness.canvas.document.models.get(MODEL_ID)!
    const styles = model.occurrences.map((occurrence) => occurrence.style.fillColor)
    expect(styles).toEqual(['#ff00aa', null, null])

    // The shared definition is byte-identical: no style leaked up to it.
    expect(harness.canvas.document.objectDefinitions.get('ObjDef.1')).toEqual(definitionBefore)
  })
})
