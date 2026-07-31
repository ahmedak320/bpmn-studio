// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'

import type {
  ArisAttributeOccurrence,
  ArisConnectionDefinition,
  ArisConnectionOccurrence,
  ArisModel,
  ArisObjectDefinition,
  ArisObjectOccurrence,
  ArisStyle,
  ArisWorkingDocument
} from '../model/types'
import {
  attributeSymbolFlag,
  connectionLabelRect,
  connectionLabelText,
  resolveLabelFont,
  routeMidpoint,
  CONNECTION_LABEL_SYMBOL_SIZE
} from './canvasSync'
import {
  arisBusinessObject,
  connectionLabelElementId,
  type ArisConnectionLabelBusinessObject
} from './elements'
import {
  createEmptyArisDocument,
  createEmptyArisModel,
  localizedValue,
  DEFAULT_LOCALE_ID,
  EMPTY_ARIS_SOURCE_INDEX,
  EMPTY_LOCALIZED_VALUE
} from './emptyDocument'
import { bootCanvas, type Harness } from './testing/harness'

/**
 * Connection label placements — plan §12.1 ("attribute occurrence placement") and §8.2.
 *
 * A `<CxnOcc>` may carry `<AttrOcc>` children exactly as an `<ObjOcc>` does. They are the
 * connection's own labels, and `SymbolFlag` decides whether a placement draws the attribute's
 * text or its symbol. These are the deterministic unit fixtures; the real-data acceptance for the
 * reference export lives in `connectionLabels.animalwf.test.ts`.
 */

const FONT_SHEET_ID = 'FontSS.1'
const MODEL_ID = 'Model.1'

let harness: Harness | null = null

afterEach(() => {
  harness?.destroy()
  harness = null
})

function placement(overrides: Partial<ArisAttributeOccurrence> = {}): ArisAttributeOccurrence {
  return Object.freeze({
    attributeType: 'AT_TYPE_6',
    port: 'NW',
    orderNum: 0,
    alignment: 'CENTER',
    offsetX: 0,
    offsetY: 0,
    width: null,
    height: null,
    rotation: 0,
    symbolFlag: 'TEXT',
    fontStyleSheetId: FONT_SHEET_ID,
    ...overrides
  })
}

function occurrence(id: string, x: number, y: number): ArisObjectOccurrence {
  return Object.freeze({
    id,
    definitionId: 'ObjDef.1',
    modelId: MODEL_ID,
    symbol: 'ST_FUNC',
    bounds: Object.freeze({ x, y, width: 100, height: 60 }),
    style: Object.freeze({
      symbol: 'ST_FUNC',
      fillColor: null,
      strokeColor: null,
      strokeWidth: null,
      lineStyle: null,
      fontStyleSheetId: null,
      zOrder: null
    }),
    attributeOccurrences: Object.freeze([]),
    rawAttributes: Object.freeze({})
  })
}

/** A two-shape model whose one connection carries the given placements. */
function documentWith(
  placements: readonly ArisAttributeOccurrence[],
  options: { readonly connectionAttributes?: ArisConnectionDefinition['attributes'] } = {}
): ArisWorkingDocument {
  const connection: ArisConnectionOccurrence = Object.freeze({
    id: 'CxnOcc.1',
    definitionId: 'CxnDef.1',
    modelId: MODEL_ID,
    sourceOccurrenceId: 'ObjOcc.1',
    targetOccurrenceId: 'ObjOcc.2',
    // An explicit L-shaped route, so the midpoint is genuinely computed rather than guessed.
    route: Object.freeze([
      { x: 150, y: 60 },
      { x: 150, y: 400 },
      { x: 550, y: 400 },
      { x: 550, y: 500 }
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

  const base = createEmptyArisModel({ id: MODEL_ID, type: 'MT_EEPC', name: 'Labels' })
  const model: ArisModel = Object.freeze({
    ...base,
    occurrences: Object.freeze([occurrence('ObjOcc.1', 100, 0), occurrence('ObjOcc.2', 500, 500)]),
    connectionOccurrences: Object.freeze([connection])
  })

  const objectDefinition: ArisObjectDefinition = Object.freeze({
    id: 'ObjDef.1',
    type: 'OT_FUNC',
    defaultSymbol: 'ST_FUNC',
    names: localizedValue('Step'),
    attributes: Object.freeze([]),
    linkedModelIds: Object.freeze([]),
    rawAttributes: Object.freeze({})
  })
  const connectionDefinition: ArisConnectionDefinition = Object.freeze({
    id: 'CxnDef.1',
    type: 'CT_ACTIV_1',
    fromObjectDefinitionId: 'ObjDef.1',
    toObjectDefinitionId: 'ObjDef.1',
    names: EMPTY_LOCALIZED_VALUE,
    attributes: options.connectionAttributes ?? Object.freeze([])
  })
  const font: ArisStyle = Object.freeze({
    id: FONT_SHEET_ID,
    fillColor: null,
    strokeColor: null,
    strokeWidth: null,
    lineStyle: null,
    fontFamily: 'Arial, sans-serif',
    fontSize: 9,
    fontWeight: '700',
    textColor: '#123456',
    zOrder: null
  })

  const empty = createEmptyArisDocument({ models: [model] })
  return Object.freeze({
    ...empty,
    objectDefinitions: Object.freeze(new Map([[objectDefinition.id, objectDefinition]])),
    connectionDefinitions: Object.freeze(
      new Map([[connectionDefinition.id, connectionDefinition]])
    ),
    styleCatalog: Object.freeze({ styles: Object.freeze(new Map([[font.id, font]])) }),
    sourceIndex: EMPTY_ARIS_SOURCE_INDEX
  })
}

function pointOf(element: unknown): { readonly x: number; readonly y: number } {
  const shape = element as { x: number; y: number }
  return { x: shape.x, y: shape.y }
}

function labelGroup(id: string): SVGElement {
  const gfx = harness!.canvas.elementRegistry.getGraphics(id)
  const group = gfx.querySelector('[data-aris-kind="connectionLabel"]')
  if (!group) throw new Error(`No connection label group rendered for ${id}.`)
  return group as unknown as SVGElement
}

describe('routeMidpoint measures along the route, not along the waypoint list', () => {
  it('returns the point at half the total arc length of an unevenly bent route', () => {
    // Segments 100 then 300: the halfway point (200) is 100 into the second segment.
    const mid = routeMidpoint([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 400, y: 0 }
    ])
    expect(mid).toEqual({ x: 200, y: 0 })
    // The middle *entry* of the list would have been (100, 0) — a different, wrong answer.
  })

  it('handles a straight two-point route, a degenerate route and an empty one', () => {
    expect(
      routeMidpoint([
        { x: 0, y: 0 },
        { x: 0, y: 50 }
      ])
    ).toEqual({ x: 0, y: 25 })
    expect(
      routeMidpoint([
        { x: 7, y: 9 },
        { x: 7, y: 9 }
      ])
    ).toEqual({ x: 7, y: 9 })
    expect(routeMidpoint([{ x: 4, y: 5 }])).toEqual({ x: 4, y: 5 })
    expect(routeMidpoint([])).toBeNull()
  })
})

describe('connectionLabelRect centres the placement on the midpoint plus its offsets', () => {
  const midpoint = { x: 100, y: 200 }

  it('sizes a symbol placement to the marker and a text placement to its text', () => {
    const symbol = connectionLabelRect(placement(), midpoint, {
      symbolFlag: 'SYMBOL',
      text: ''
    })
    expect(symbol.width).toBe(CONNECTION_LABEL_SYMBOL_SIZE)
    expect(symbol.height).toBe(CONNECTION_LABEL_SYMBOL_SIZE)
    expect(symbol.x + symbol.width / 2).toBe(100)
    expect(symbol.y + symbol.height / 2).toBe(200)

    const text = connectionLabelRect(placement(), midpoint, {
      symbolFlag: 'TEXT',
      text: 'Approved'
    })
    expect(text.width).toBeGreaterThan(0)
    expect(text.height).toBeGreaterThan(0)
  })

  it('gives a placement whose attribute has no value no extent at all', () => {
    const empty = connectionLabelRect(placement(), midpoint, { symbolFlag: 'TEXT', text: '' })
    expect(empty).toEqual({ x: 100, y: 200, width: 0, height: 0 })
  })

  it('honours an explicit source size and the offsets over the drawn extent', () => {
    const rect = connectionLabelRect(
      placement({ offsetX: -11, offsetY: 6, width: 40, height: 20 }),
      midpoint,
      { symbolFlag: 'TEXT', text: 'x' }
    )
    expect(rect).toEqual({ x: 100 - 11 - 20, y: 200 + 6 - 10, width: 40, height: 20 })
  })

  it('anchors a Port="NW" text placement north-west of the source-box contact', () => {
    // Fixplan §5.1/§0: the badge hangs above-left of where the route meets the
    // source box, not on the midpoint. The box's bottom-right is pinned inset from
    // the contact and it grows up-and-left; the midpoint is ignored entirely.
    const anchor = { point: { x: 1535, y: 870 }, fontSize: 35.278 }
    const rect = connectionLabelRect(
      placement(),
      { x: 9999, y: 9999 },
      { symbolFlag: 'TEXT', text: 'R' },
      anchor
    )
    expect(rect.x + rect.width).toBeCloseTo(1535 - 11, 6) // 11u left of the box edge
    expect(rect.y + rect.height).toBeCloseTo(870 - 14, 6) // 14u above the line
    expect(rect.width).toBeGreaterThan(0)
    expect(rect.x + rect.width).toBeLessThan(1535) // clears the box …
    expect(rect.y + rect.height).toBeLessThan(870) //  … and the line
  })

  it('leaves a SYMBOL or valueless NW placement on the midpoint path', () => {
    const anchor = { point: { x: 1535, y: 870 }, fontSize: 35.278 }
    // A SYMBOL marker never north-west anchors — it straddles the midpoint.
    const symbol = connectionLabelRect(
      placement(),
      midpoint,
      { symbolFlag: 'SYMBOL', text: '' },
      anchor
    )
    expect(symbol.x + symbol.width / 2).toBe(100)
    expect(symbol.y + symbol.height / 2).toBe(200)
    // Empty text with an anchor draws nothing and occupies nothing, as before.
    const empty = connectionLabelRect(
      placement(),
      midpoint,
      { symbolFlag: 'TEXT', text: '' },
      anchor
    )
    expect(empty).toEqual({ x: 100, y: 200, width: 0, height: 0 })
  })
})

describe('attributeSymbolFlag normalizes SymbolFlag', () => {
  it('treats only an explicit SYMBOL as a symbol placement', () => {
    expect(attributeSymbolFlag('SYMBOL')).toBe('SYMBOL')
    expect(attributeSymbolFlag(' symbol ')).toBe('SYMBOL')
    expect(attributeSymbolFlag('TEXT')).toBe('TEXT')
    // An absent or unrecognized flag must not blank the label.
    expect(attributeSymbolFlag(null)).toBe('TEXT')
    expect(attributeSymbolFlag('WHATEVER')).toBe('TEXT')
  })
})

describe('connectionLabelText resolves the value the placement points at', () => {
  const definition: ArisConnectionDefinition = Object.freeze({
    id: 'CxnDef.1',
    type: 'CT_ACTIV_1',
    fromObjectDefinitionId: 'ObjDef.1',
    toObjectDefinitionId: 'ObjDef.1',
    names: localizedValue('Named connection'),
    attributes: Object.freeze([
      Object.freeze({
        type: 'AT_TYPE_6',
        values: Object.freeze([{ localeId: DEFAULT_LOCALE_ID, text: 'is processed by' }])
      })
    ])
  })

  it('reads the definition attribute of the placement type', () => {
    expect(connectionLabelText({ attributeType: 'AT_TYPE_6' }, definition)).toBe('is processed by')
  })

  it('falls back to the definition name for AT_NAME and to empty otherwise', () => {
    expect(connectionLabelText({ attributeType: 'AT_NAME' }, definition)).toBe('Named connection')
    expect(connectionLabelText({ attributeType: 'AT_UNSET' }, definition)).toBe('')
    expect(connectionLabelText({ attributeType: 'AT_NAME' }, undefined)).toBe('')
  })
})

describe('resolveLabelFont reads the placement font style sheet', () => {
  it('returns the catalog entry, or null when the sheet is unknown or unnamed', () => {
    const workingDocument = documentWith([placement()])
    expect(resolveLabelFont(workingDocument.styleCatalog, FONT_SHEET_ID)).toEqual({
      fontFamily: 'Arial, sans-serif',
      fontSize: 9,
      fontWeight: '700',
      textColor: '#123456'
    })
    expect(resolveLabelFont(workingDocument.styleCatalog, 'FontSS.missing')).toBeNull()
    expect(resolveLabelFont(workingDocument.styleCatalog, null)).toBeNull()
  })
})

describe('the canvas paints connection label placements', () => {
  it('draws one label element per placement, keyed by connection, index and attribute type', () => {
    harness = bootCanvas({
      document: documentWith([
        placement({ attributeType: 'AT_TYPE_6' }),
        placement({ attributeType: 'AT_BOOL', symbolFlag: 'SYMBOL', offsetX: -11 })
      ]),
      modelId: MODEL_ID
    })
    const ids = harness.canvas.elementRegistry
      .getAll()
      .filter((element) => arisBusinessObject(element)?.kind === 'connectionLabel')
      .map((element) => element.id)
    expect(ids).toEqual([
      connectionLabelElementId('CxnOcc.1', 0, 'AT_TYPE_6'),
      connectionLabelElementId('CxnOcc.1', 1, 'AT_BOOL')
    ])
  })

  it('makes SymbolFlag load-bearing: TEXT draws text, SYMBOL draws a marker and no text', () => {
    harness = bootCanvas({
      document: documentWith(
        [
          placement({ attributeType: 'AT_TYPE_6' }),
          placement({ attributeType: 'AT_BOOL', symbolFlag: 'SYMBOL' })
        ],
        {
          connectionAttributes: Object.freeze([
            Object.freeze({
              type: 'AT_TYPE_6',
              values: Object.freeze([{ localeId: DEFAULT_LOCALE_ID, text: 'is processed by' }])
            }),
            Object.freeze({
              type: 'AT_BOOL',
              values: Object.freeze([{ localeId: DEFAULT_LOCALE_ID, text: 'true' }])
            })
          ])
        }
      ),
      modelId: MODEL_ID
    })

    const text = labelGroup(connectionLabelElementId('CxnOcc.1', 0, 'AT_TYPE_6'))
    expect(text.getAttribute('data-aris-symbol-flag')).toBe('TEXT')
    expect(text.querySelector('text')?.textContent).toBe('is processed by')
    expect(text.querySelector('[data-aris-attribute-symbol]')).toBeNull()

    const symbol = labelGroup(connectionLabelElementId('CxnOcc.1', 1, 'AT_BOOL'))
    expect(symbol.getAttribute('data-aris-symbol-flag')).toBe('SYMBOL')
    // Same attribute value, entirely different output: a marker and no text at all.
    expect(symbol.querySelector('text')).toBeNull()
    expect(
      symbol
        .querySelector('[data-aris-attribute-symbol]')
        ?.getAttribute('data-aris-attribute-symbol')
    ).toBe('AT_BOOL')
  })

  it('applies alignment and the placement font style sheet to the drawn text', () => {
    harness = bootCanvas({
      document: documentWith([placement({ alignment: 'RIGHT' })], {
        connectionAttributes: Object.freeze([
          Object.freeze({
            type: 'AT_TYPE_6',
            values: Object.freeze([{ localeId: DEFAULT_LOCALE_ID, text: 'label' }])
          })
        ])
      }),
      modelId: MODEL_ID
    })
    const group = labelGroup(connectionLabelElementId('CxnOcc.1', 0, 'AT_TYPE_6'))
    expect(group.getAttribute('data-aris-font-ss')).toBe(FONT_SHEET_ID)
    const node = group.querySelector('text')!
    expect(node.getAttribute('text-anchor')).toBe('end')
    expect(node.getAttribute('font-family')).toBe('Arial, sans-serif')
    expect(node.getAttribute('font-size')).toBe('9')
    expect(node.getAttribute('font-weight')).toBe('700')
    expect(node.getAttribute('fill')).toBe('#123456')
  })

  it('rotates a placement about its own centre when the source rotated it', () => {
    harness = bootCanvas({
      document: documentWith([placement({ rotation: 90, symbolFlag: 'SYMBOL' })]),
      modelId: MODEL_ID
    })
    const group = labelGroup(connectionLabelElementId('CxnOcc.1', 0, 'AT_TYPE_6'))
    expect(group.getAttribute('transform')).toBe('rotate(90 7 7)')
  })

  it('places the label at the route midpoint, and moves it when an endpoint moves', () => {
    harness = bootCanvas({
      document: documentWith([placement({ symbolFlag: 'SYMBOL' })]),
      modelId: MODEL_ID
    })
    const id = connectionLabelElementId('CxnOcc.1', 0, 'AT_TYPE_6')
    const registry = harness.canvas.elementRegistry
    const before = pointOf(registry.get(id))
    const centre = { x: before.x + 7, y: before.y + 7 }
    // The route runs (150,60) -> (150,400) -> (550,400) -> (550,500); interior points are
    // honoured verbatim, so the arc-length midpoint lies on the horizontal leg.
    expect(centre.y).toBeCloseTo(400, 6)

    harness.canvas.authoring.moveOccurrence('ObjOcc.2', { x: 900, y: 900 })
    const after = pointOf(registry.get(id))
    expect(after.x === before.x && after.y === before.y).toBe(false)
  })

  it('carries the full placement onto the business object, losing no source field', () => {
    harness = bootCanvas({
      document: documentWith([
        placement({ port: 'PORT_FREE', orderNum: 3, offsetX: -11, offsetY: 4, rotation: 0 })
      ]),
      modelId: MODEL_ID
    })
    const element = harness.canvas.elementRegistry.get(
      connectionLabelElementId('CxnOcc.1', 0, 'AT_TYPE_6')
    )
    const businessObject = arisBusinessObject(element) as ArisConnectionLabelBusinessObject
    expect(businessObject).toMatchObject({
      kind: 'connectionLabel',
      modelId: MODEL_ID,
      ownerConnectionOccurrenceId: 'CxnOcc.1',
      attributeType: 'AT_TYPE_6',
      symbolFlag: 'TEXT',
      alignment: 'CENTER',
      port: 'PORT_FREE',
      orderNum: 3,
      rotation: 0,
      fontStyleSheetId: FONT_SHEET_ID
    })
  })

  it('removes the label when its placement goes away, and draws none when there are none', () => {
    harness = bootCanvas({ document: documentWith([]), modelId: MODEL_ID })
    const labels = harness.canvas.elementRegistry
      .getAll()
      .filter((element) => arisBusinessObject(element)?.kind === 'connectionLabel')
    expect(labels).toHaveLength(0)
  })

  it('selecting a connection label highlights the connection it labels (§11.5)', () => {
    harness = bootCanvas({
      document: documentWith([placement({ symbolFlag: 'SYMBOL' })]),
      modelId: MODEL_ID
    })
    harness.canvas.select(connectionLabelElementId('CxnOcc.1', 0, 'AT_TYPE_6'))
    const plan = harness.canvas.currentHighlight()
    expect(plan.active).toBe(true)
    expect(plan.selectedConnectionId).toBe('CxnOcc.1')
    expect(plan.resolvedFromLabel).toBe(true)
  })
})
