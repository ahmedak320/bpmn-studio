import { describe, expect, it } from 'vitest'

import {
  ARIS_DEFAULT_SYMBOL_BY_OBJECT_TYPE,
  ARIS_KNOWN_SYMBOL_TYPES,
  ARIS_MODEL_TYPES,
  ARIS_OBJECT_TYPES,
  ARIS_SHEET_NAMES,
  ARIS_SHEET_SPECS,
  ARIS_TEMPLATE_IDENTITY,
  arisSheetSpec,
  formatRoutePoints,
  inferSymbolType,
  isControlFlowObjectType,
  parseRoutePoints,
  type ArisSheetName
} from './templateSchema'
import { ARIS_SYMBOL_DESCRIPTORS } from '../symbols/shapes'

function columnNames(sheet: ArisSheetName, presence?: 'required' | 'optional'): string[] {
  const spec = arisSheetSpec(sheet)
  expect(spec).toBeDefined()
  return spec!.columns
    .filter((column) => presence === undefined || column.presence === presence)
    .map((column) => column.name)
}

describe('ARIS template schema (§15.2)', () => {
  it('declares exactly the nine plan sheets, in plan order', () => {
    expect([...ARIS_SHEET_NAMES]).toEqual([
      'Models',
      'Objects',
      'Connections',
      'Attributes',
      'Assignments',
      'Lanes',
      'FreeText',
      'Styles',
      'Glossary'
    ])
    expect(ARIS_SHEET_SPECS.map((spec) => spec.name)).toEqual([...ARIS_SHEET_NAMES])
  })

  it('declares the Models columns and allowed model types verbatim', () => {
    expect(columnNames('Models')).toEqual([
      'model_id',
      'model_type',
      'name_en',
      'name_ar',
      'process_code',
      'description_en',
      'description_ar',
      'orientation'
    ])
    expect([...ARIS_MODEL_TYPES]).toEqual(['MT_EEPC', 'MT_VAL_ADD_CHN_DGM'])
  })

  it('splits the Objects columns into the plan required and optional sets', () => {
    expect(columnNames('Objects', 'required')).toEqual([
      'model_id',
      'object_id',
      'occurrence_id',
      'object_type',
      'symbol_type',
      'name_en',
      'name_ar'
    ])
    expect(columnNames('Objects', 'optional')).toEqual([
      'lane_id',
      'order',
      'x',
      'y',
      'width',
      'height',
      'assigned_model_id',
      'style_id'
    ])
  })

  it('splits the Connections columns into the plan required and optional sets', () => {
    expect(columnNames('Connections', 'required')).toEqual([
      'model_id',
      'connection_id',
      'source_occurrence_id',
      'target_occurrence_id',
      'connection_type'
    ])
    expect(columnNames('Connections', 'optional')).toEqual([
      'name_en',
      'name_ar',
      'route_points',
      'style_id'
    ])
  })

  it('declares the remaining sheet columns verbatim', () => {
    expect(columnNames('Attributes')).toEqual([
      'owner_kind',
      'owner_id',
      'attribute_type',
      'language',
      'value',
      'value_type',
      'sequence'
    ])
    expect(columnNames('Assignments')).toEqual([
      'source_object_id',
      'target_model_id',
      'assignment_type'
    ])
    expect(columnNames('Lanes')).toEqual([
      'model_id',
      'lane_id',
      'name_en',
      'name_ar',
      'x',
      'y',
      'width',
      'height',
      'orientation'
    ])
    expect(columnNames('FreeText')).toEqual([
      'model_id',
      'text_id',
      'text_en',
      'text_ar',
      'x',
      'y',
      'width',
      'height',
      'style_id'
    ])
    expect(columnNames('Styles')).toEqual([
      'style_id',
      'fill_color',
      'stroke_color',
      'stroke_width',
      'line_style',
      'font_family',
      'font_size',
      'font_weight',
      'text_color',
      'z_order'
    ])
    expect(columnNames('Glossary')).toEqual([
      'english',
      'arabic',
      'do_not_translate',
      'case_sensitive'
    ])
  })

  it('supports the twelve AnimalWF object types and marks the control-flow subset', () => {
    expect([...ARIS_OBJECT_TYPES]).toEqual([
      'OT_FUNC',
      'OT_EVT',
      'OT_RULE',
      'OT_ENT_TYPE',
      'OT_INFO_CARR',
      'OT_BUSINESS_RULE',
      'OT_PERF',
      'OT_APPL_SYS',
      'OT_PERS',
      'OT_REQUIREMENT',
      'OT_POLICY',
      'OT_PERS_TYPE'
    ])
    expect(ARIS_OBJECT_TYPES.filter(isControlFlowObjectType)).toEqual([
      'OT_FUNC',
      'OT_EVT',
      'OT_RULE'
    ])
  })

  it('maps all twelve Excel object types to descriptor-backed default symbols', () => {
    expect(Object.keys(ARIS_DEFAULT_SYMBOL_BY_OBJECT_TYPE).sort()).toEqual(
      [...ARIS_OBJECT_TYPES].sort()
    )
    const descriptorSymbols = new Set(
      ARIS_SYMBOL_DESCRIPTORS.map((descriptor) => descriptor.symbolNum)
    )
    for (const symbolType of Object.values(ARIS_DEFAULT_SYMBOL_BY_OBJECT_TYPE)) {
      expect(descriptorSymbols, symbolType).toContain(symbolType)
    }
    expect(ARIS_DEFAULT_SYMBOL_BY_OBJECT_TYPE.OT_RULE).toBe('ST_OPR_XOR_1')
  })

  it('keeps every shape-catalog symbol in the known-symbol vocabulary', () => {
    const descriptorSymbols = new Set(
      ARIS_SYMBOL_DESCRIPTORS.map((descriptor) => descriptor.symbolNum)
    )
    for (const symbolType of descriptorSymbols) {
      if (symbolType === 'DMT_UNVERIFIED_ARIS_MODEL') continue
      expect(ARIS_KNOWN_SYMBOL_TYPES, symbolType).toContain(symbolType)
    }
  })

  it('infers whole-token rule operators and otherwise uses object defaults', () => {
    expect(inferSymbolType('OT_RULE', 'XOR rule')).toBe('ST_OPR_XOR_1')
    expect(inferSymbolType('OT_RULE', 'Approve AND archive')).toBe('ST_OPR_AND_1')
    expect(inferSymbolType('OT_RULE', 'Either OR both')).toBe('ST_OPR_OR_1')
    expect(inferSymbolType('OT_RULE', 'Coordinator review')).toBe('ST_OPR_XOR_1')
    expect(inferSymbolType('OT_APPL_SYS', 'XOR gateway service')).toBe('ST_APPL_SYS')
  })

  it('pins the template identity string', () => {
    expect(ARIS_TEMPLATE_IDENTITY).toBe('OrbitPMArisTemplateVersion=1')
  })
})

describe('route point syntax x:y|x:y|x:y', () => {
  it('parses well-formed routes, including negative and decimal coordinates', () => {
    expect(parseRoutePoints('10:20')).toEqual({ ok: true, points: [{ x: 10, y: 20 }] })
    expect(parseRoutePoints('10:20|30:40|50:60')).toEqual({
      ok: true,
      points: [
        { x: 10, y: 20 },
        { x: 30, y: 40 },
        { x: 50, y: 60 }
      ]
    })
    expect(parseRoutePoints(' -12:3.5 | 4:5 ')).toEqual({
      ok: true,
      points: [
        { x: -12, y: 3.5 },
        { x: 4, y: 5 }
      ]
    })
  })

  it('rejects malformed routes', () => {
    expect(parseRoutePoints('')).toEqual({ ok: false, reason: 'empty-segment' })
    expect(parseRoutePoints('10:20|')).toEqual({ ok: false, reason: 'empty-segment' })
    expect(parseRoutePoints('10,20')).toEqual({ ok: false, reason: 'malformed-point' })
    expect(parseRoutePoints('10:20:30')).toEqual({ ok: false, reason: 'malformed-point' })
    expect(parseRoutePoints('x:y')).toEqual({ ok: false, reason: 'malformed-point' })
    expect(parseRoutePoints('10:')).toEqual({ ok: false, reason: 'malformed-point' })
  })

  it('round-trips through the serializer', () => {
    const parsed = parseRoutePoints('10:20|30:40')
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(formatRoutePoints(parsed.points)).toBe('10:20|30:40')
  })
})
