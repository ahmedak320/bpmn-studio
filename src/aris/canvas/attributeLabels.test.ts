// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'

import type {
  ArisAttribute,
  ArisAttributeOccurrence,
  ArisModel,
  ArisObjectDefinition,
  ArisObjectOccurrence,
  ArisSourceAttributeRecordLike,
  ArisWorkingDocument
} from '../model/types'
import {
  createEmptyArisDocument,
  createEmptyArisModel,
  localizedValue,
  EMPTY_ARIS_SOURCE_INDEX
} from './emptyDocument'
import { occurrenceAttributeLabels } from './canvasSync'
import { ensureArrowMarker, SVG_NS, svgElement } from './svg'
import { bootCanvas, type Harness } from './testing/harness'

/**
 * Phase B visual fidelity — the two rendering deliverables that move NO measured fidelity category
 * (they are a disjoint code path from `compare.ts`): a function's `AT_PROC_CODE`/`AT_ID` numbering
 * painted beside its symbol, and a directed arrowhead on every control-flow connection.
 *
 * The numbering is drawn as read-only annotation INSIDE the occurrence's own group — never a
 * separate, selectable/editable label element and never written back — so the derived export
 * (which reads the working document's `attributeOccurrences`, not the canvas) is untouched.
 */

const MODEL_ID = 'Model.1'
const OCC_ID = 'ObjOcc.1'
const DEF_ID = 'ObjDef.1'

let harness: Harness | null = null

afterEach(() => {
  harness?.destroy()
  harness = null
})

function attrOcc(
  attributeType: string,
  offsetX: number | null,
  offsetY: number | null,
  extra: Partial<ArisAttributeOccurrence> = {}
): ArisAttributeOccurrence {
  return Object.freeze({
    attributeType,
    port: null,
    orderNum: null,
    alignment: null,
    offsetX,
    offsetY,
    width: extra.width ?? null,
    height: extra.height ?? null,
    rotation: null,
    symbolFlag: extra.symbolFlag ?? 'TEXT',
    fontStyleSheetId: null
  })
}

function definition(attributes: readonly ArisAttribute[]): ArisObjectDefinition {
  return Object.freeze({
    id: DEF_ID,
    type: 'OT_FUNC',
    defaultSymbol: 'ST_FUNC',
    names: localizedValue('Step'),
    attributes: Object.freeze(attributes),
    linkedModelIds: Object.freeze([]),
    rawAttributes: Object.freeze({})
  })
}

function occurrence(
  attributeOccurrences: readonly ArisAttributeOccurrence[]
): ArisObjectOccurrence {
  return Object.freeze({
    id: OCC_ID,
    definitionId: DEF_ID,
    modelId: MODEL_ID,
    symbol: 'ST_FUNC',
    bounds: Object.freeze({ x: 0, y: 0, width: 100, height: 60 }),
    style: Object.freeze({
      symbol: 'ST_FUNC',
      fillColor: null,
      strokeColor: null,
      strokeWidth: null,
      lineStyle: null,
      fontStyleSheetId: null,
      zOrder: null
    }),
    attributeOccurrences: Object.freeze(attributeOccurrences),
    rawAttributes: Object.freeze({})
  })
}

function sourceAttribute(
  ownerSourceId: string,
  attributeType: string,
  text: string
): ArisSourceAttributeRecordLike {
  return Object.freeze({
    sourceId: `${ownerSourceId}:${attributeType}`,
    rawAttributes: Object.freeze({}),
    parsed: Object.freeze({
      ownerSourceId,
      attributeType,
      values: Object.freeze([Object.freeze({ localeId: 'en-US', text })])
    })
  })
}

function documentWith(
  occ: ArisObjectOccurrence,
  def: ArisObjectDefinition,
  sourceAttributes: readonly ArisSourceAttributeRecordLike[] = []
): ArisWorkingDocument {
  const base = createEmptyArisModel({ id: MODEL_ID, type: 'MT_EEPC', name: 'Numbers' })
  const model: ArisModel = Object.freeze({ ...base, occurrences: Object.freeze([occ]) })
  const empty = createEmptyArisDocument({ models: [model] })
  return Object.freeze({
    ...empty,
    objectDefinitions: Object.freeze(new Map([[def.id, def]])),
    sourceIndex: Object.freeze({
      ...EMPTY_ARIS_SOURCE_INDEX,
      attributes: Object.freeze(sourceAttributes)
    })
  })
}

describe('occurrenceAttributeLabels — AT_PROC_CODE / AT_ID numbering placements', () => {
  it('emits one label per non-name, offset-bearing placement that resolves to text', () => {
    const occ = occurrence([
      attrOcc('AT_NAME', 10, -20), // external caption: owned by the name label, not annotation
      attrOcc('AT_ID', 150, 150),
      attrOcc('AT_PROC_CODE', 150, 180)
    ])
    const doc = documentWith(
      occ,
      definition([
        { type: 'AT_ID', values: [{ localeId: 'en', text: '07' }] },
        { type: 'AT_PROC_CODE', values: [{ localeId: 'en', text: 'P-100' }] }
      ])
    )
    const labels = occurrenceAttributeLabels(doc, occ)
    expect(labels.map((label) => [label.attributeType, label.text])).toEqual([
      ['AT_ID', '07'],
      ['AT_PROC_CODE', 'P-100']
    ])
    // Geometry: the offset is measured from the occurrence's centre and the label box is centred
    // on the offset point — (100/2+150, 60/2+150) = (200,180) — with the default label extent.
    expect(labels[0]).toMatchObject({ x: 140, y: 168, width: 120, height: 24 })
  })

  it('skips AT_NAME, zero-offset placements, and placements with no stored value', () => {
    const occ = occurrence([
      attrOcc('AT_NAME', 40, 40), // AT_NAME is the caption, never an annotation
      attrOcc('AT_ID', 0, 0), // zero offset means "inside" — the caption already owns it
      attrOcc('AT_TIME_AVG_PRCS', 120, 120) // offset, but the definition stores no value
    ])
    const doc = documentWith(
      occ,
      definition([{ type: 'AT_ID', values: [{ localeId: 'en', text: '07' }] }])
    )
    expect(occurrenceAttributeLabels(doc, occ)).toHaveLength(0)
  })

  it('prefers the occurrence-local source attribute value over the definition value', () => {
    const occ = occurrence([attrOcc('AT_ID', 150, 150)])
    const doc = documentWith(
      occ,
      definition([{ type: 'AT_ID', values: [{ localeId: 'en', text: '07' }] }]),
      [sourceAttribute(OCC_ID, 'AT_ID', '99')]
    )
    const labels = occurrenceAttributeLabels(doc, occ)
    expect(labels).toHaveLength(1)
    expect(labels[0].text).toBe('99')
  })

  it('paints the numbering as text nodes inside the occurrence group, distinct from the caption', () => {
    const occ = occurrence([attrOcc('AT_ID', 150, 150), attrOcc('AT_PROC_CODE', 150, 180)])
    const doc = documentWith(
      occ,
      definition([
        { type: 'AT_ID', values: [{ localeId: 'en', text: '07' }] },
        { type: 'AT_PROC_CODE', values: [{ localeId: 'en', text: 'P-100' }] }
      ])
    )
    harness = bootCanvas({ document: doc, modelId: MODEL_ID })
    const gfx = harness.canvas.elementRegistry.getGraphics(OCC_ID)
    const group = gfx.querySelector('[data-aris-kind="occurrence"]')
    if (!group) throw new Error('No occurrence group rendered.')

    const annotations = [...group.querySelectorAll('text[data-aris-attribute-label]')]
    expect(annotations.map((node) => node.textContent).sort()).toEqual(['07', 'P-100'])
    expect(
      annotations.map((node) => node.getAttribute('data-aris-attribute-label')).sort()
    ).toEqual(['AT_ID', 'AT_PROC_CODE'])
    // The editable name caption is a separate node and is never conflated with the numbering.
    const caption = group.querySelector('text[data-aris-caption]')
    expect(caption?.textContent).toBe('Step')
    expect(caption?.getAttribute('data-aris-attribute-label')).toBeNull()
  })
})

describe('ensureArrowMarker — directed control-flow arrowheads', () => {
  it('authors one shared marker per stroke colour and is idempotent', () => {
    const svg = document.createElementNS(SVG_NS, 'svg')
    const group = svg.appendChild(svgElement('g'))

    const first = ensureArrowMarker(group, '#475569')
    const second = ensureArrowMarker(group, '#475569')
    expect(first).toBe(second)

    const markers = svg.querySelectorAll('marker')
    expect(markers).toHaveLength(1)
    const marker = svg.querySelector(`#${first}`)
    expect(marker?.tagName.toLowerCase()).toBe('marker')
    expect(marker?.getAttribute('orient')).toBe('auto')
    expect(marker?.querySelector('path')?.getAttribute('fill')).toBe('#475569')

    // A different stroke colour mints its own marker.
    const other = ensureArrowMarker(group, '#ff0000')
    expect(other).not.toBe(first)
    expect(svg.querySelectorAll('marker')).toHaveLength(2)
  })
})
