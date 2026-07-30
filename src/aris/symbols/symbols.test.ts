import { describe, expect, it } from 'vitest'

import { ARIS_CONVENTION_SYMBOLS } from '../conventions/catalog'
import { UNKNOWN_SYMBOL_DESCRIPTOR } from './fallback'
import { buildSymbolFidelityFindings } from './fidelity'
import { resolveArisSymbol } from './registry'
import { ARIS_OBJECT_TYPE_DEFAULT_SYMBOL, ARIS_SYMBOL_DESCRIPTORS } from './shapes'
import type {
  ArisSymbolDescriptor,
  ArisSymbolFidelityFinding,
  ArisSymbolResolutionRequest
} from './types'

const SECTION_11_3_OBJECT_TYPES = [
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
] as const

function descriptorToString(descriptor: ArisSymbolDescriptor): string {
  return JSON.stringify(descriptor)
}

function drawingToString(drawing: ArisSymbolDescriptor['drawing']): string {
  return JSON.stringify(drawing)
}

function collectGeometryStrings(): string[] {
  const strings: string[] = []
  for (const descriptor of ARIS_SYMBOL_DESCRIPTORS) {
    strings.push(descriptorToString(descriptor))
  }
  strings.push(descriptorToString(UNKNOWN_SYMBOL_DESCRIPTOR))
  return strings
}

describe('ARIS symbol registry', () => {
  it('covers every Section 11.3 object type with a non-fallback default symbol', () => {
    for (const objectType of SECTION_11_3_OBJECT_TYPES) {
      const defaultSymbolNum = ARIS_OBJECT_TYPE_DEFAULT_SYMBOL[objectType]
      expect(
        defaultSymbolNum,
        `object type ${objectType} has a default symbol mapping`
      ).toBeDefined()
      const result = resolveArisSymbol({
        modelType: 'MT_EEPC',
        objectType,
        symbolNum: defaultSymbolNum as string
      })
      expect(result.descriptor.key).not.toBe(UNKNOWN_SYMBOL_DESCRIPTOR.key)
      expect(result.descriptor.objectType).toBe(objectType)
      expect(result.descriptor.symbolNum).toBe(defaultSymbolNum)
      expect(result.fidelity).toHaveLength(0)
    }
  })

  it('resolves every ARIS_CONVENTION_SYMBOLS row (plan R1) with zero fidelity findings', () => {
    for (const symbol of ARIS_CONVENTION_SYMBOLS) {
      for (const modelType of symbol.modelTypes) {
        const result = resolveArisSymbol({
          modelType,
          objectType: symbol.objectType,
          symbolNum: symbol.symbolNum
        })
        expect(
          result.fidelity,
          `${modelType}:${symbol.objectType}:${symbol.symbolNum} (${symbol.labelKey}) should resolve without a fidelity finding`
        ).toHaveLength(0)
        expect(result.descriptor.objectType).toBe(symbol.objectType)
        expect(result.descriptor.symbolNum).toBe(symbol.symbolNum)
      }
    }
  })

  it('gives the Function descriptor the DMT convention default fill (plan R1, #339900)', () => {
    const result = resolveArisSymbol({
      modelType: 'MT_EEPC',
      objectType: 'OT_FUNC',
      symbolNum: 'ST_FUNC'
    })
    const body = result.descriptor.drawing.elements.find(
      (element) => 'fill' in element && element.fill !== 'none' && element.fill !== undefined
    )
    expect(body && 'fill' in body ? body.fill : undefined).toBe('#339900')
  })

  it('resolves AND, OR, and XOR rules to three visually different descriptors', () => {
    const andResult = resolveArisSymbol({
      modelType: 'MT_EEPC',
      objectType: 'OT_RULE',
      symbolNum: 'ST_OPR_AND_1'
    })
    const orResult = resolveArisSymbol({
      modelType: 'MT_EEPC',
      objectType: 'OT_RULE',
      symbolNum: 'ST_OPR_OR_1'
    })
    const xorResult = resolveArisSymbol({
      modelType: 'MT_EEPC',
      objectType: 'OT_RULE',
      symbolNum: 'ST_OPR_XOR_1'
    })

    expect(andResult.descriptor.key).not.toBe(orResult.descriptor.key)
    expect(orResult.descriptor.key).not.toBe(xorResult.descriptor.key)
    expect(xorResult.descriptor.key).not.toBe(andResult.descriptor.key)

    const andGeometry = drawingToString(andResult.descriptor.drawing)
    const orGeometry = drawingToString(orResult.descriptor.drawing)
    const xorGeometry = drawingToString(xorResult.descriptor.drawing)

    expect(andGeometry).not.toBe(orGeometry)
    expect(orGeometry).not.toBe(xorGeometry)
    expect(xorGeometry).not.toBe(andGeometry)
  })

  it('falls back to the visible unknown-symbol descriptor for unknown object types', () => {
    const result = resolveArisSymbol({
      modelType: 'MT_EEPC',
      objectType: 'OT_FOO_UNKNOWN',
      symbolNum: 'ST_BAR_UNKNOWN'
    })
    expect(result.descriptor.key).toBe(UNKNOWN_SYMBOL_DESCRIPTOR.key)
    expect(result.fidelity).toHaveLength(1)
    expect(result.fidelity[0].kind).toBe('unknown-custom-symbol')
    expect(result.fidelity[0].objectType).toBe('OT_FOO_UNKNOWN')
    expect(result.fidelity[0].symbolNum).toBe('ST_BAR_UNKNOWN')
  })

  it('falls back through the documented order for an unknown SymbolNum of a known object type', () => {
    // OT_FUNC default is ST_FUNC; asking for an unknown symbol num should fall back to default.
    const result = resolveArisSymbol({
      modelType: 'MT_EEPC',
      objectType: 'OT_FUNC',
      symbolNum: 'ST_UNKNOWN_FUNC'
    })
    expect(result.descriptor.symbolNum).toBe('ST_FUNC')
    expect(result.fidelity).toHaveLength(1)
    expect(result.fidelity[0].kind).toBe('substituted-visual-resource')
    expect(result.fidelity[0].requestedKey).toBe('MT_EEPC:OT_FUNC:ST_UNKNOWN_FUNC')
    expect(result.fidelity[0].resolvedKey).toBe('MT_EEPC:OT_FUNC:ST_FUNC')
  })

  it('prefers exact triple match, then object-type+SymbolNum across model types, then default', () => {
    // Value-chain function has its own descriptor.
    const exact = resolveArisSymbol({
      modelType: 'MT_VAL_ADD_CHN_DGM',
      objectType: 'OT_FUNC',
      symbolNum: 'ST_VAL_ADD_CHN_SML_1'
    })
    expect(exact.descriptor.key).toBe('MT_VAL_ADD_CHN_DGM:OT_FUNC:ST_VAL_ADD_CHN_SML_1')
    expect(exact.fidelity).toHaveLength(0)

    // Same symbol num under a different model type falls back to object-type+SymbolNum wildcard.
    const crossModel = resolveArisSymbol({
      modelType: 'MT_EEPC',
      objectType: 'OT_FUNC',
      symbolNum: 'ST_VAL_ADD_CHN_SML_1'
    })
    expect(crossModel.descriptor.key).toBe('MT_VAL_ADD_CHN_DGM:OT_FUNC:ST_VAL_ADD_CHN_SML_1')
    expect(crossModel.fidelity).toHaveLength(1)
    expect(crossModel.fidelity[0].kind).toBe('substituted-visual-resource')

    // Unknown symbol num falls back to OT_FUNC default.
    const defaulted = resolveArisSymbol({
      modelType: 'MT_VAL_ADD_CHN_DGM',
      objectType: 'OT_FUNC',
      symbolNum: 'ST_NO_MATCH'
    })
    expect(defaulted.descriptor.symbolNum).toBe('ST_FUNC')
    expect(defaulted.fidelity).toHaveLength(1)
    expect(defaulted.fidelity[0].kind).toBe('substituted-visual-resource')
  })

  it('contains no raster images, external URLs, or http/data:image references in any descriptor', () => {
    const geometryStrings = collectGeometryStrings()
    for (const text of geometryStrings) {
      const lower = text.toLowerCase()
      expect(lower, 'descriptor must not contain http').not.toContain('http')
      expect(lower, 'descriptor must not contain data:image').not.toContain('data:image')
      expect(lower, 'descriptor must not contain an image tag').not.toContain('<image')
      expect(lower, 'descriptor must not contain a url reference').not.toContain('url(')
    }
  })

  it('is a pure function: repeated resolution yields identical descriptors', () => {
    const request: ArisSymbolResolutionRequest = {
      modelType: 'MT_EEPC',
      objectType: 'OT_FUNC',
      symbolNum: 'ST_FUNC',
      source: {
        symbolRef: 'ref-1',
        symbolGuid: 'guid-1',
        geometry: { x: 10, y: 20, dx: 100, dy: 60 },
        style: {
          pen: { color: '0', style: '0', width: 1 },
          brush: { color: 'cccccc', color2: '0', brushType: 'SOLID' }
        },
        zOrder: 5
      }
    }
    const a = resolveArisSymbol(request)
    const b = resolveArisSymbol(request)
    expect(a.descriptor).toBe(b.descriptor)
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })

  it('preserves source geometry, style, and reference material exactly', () => {
    const source: ArisSymbolResolutionRequest['source'] = {
      symbolRef: 'occ-symbol-ref',
      symbolGuid: 'occ-symbol-guid',
      geometry: { x: 123, y: 456, dx: 789, dy: 321 },
      style: {
        pen: { color: '112233', style: '7', width: 2 },
        brush: { color: 'aabbcc', color2: 'ddeeff', brushType: 'GRADIENT' }
      },
      zOrder: 42
    }
    const result = resolveArisSymbol({
      modelType: 'MT_EEPC',
      objectType: 'OT_EVT',
      symbolNum: 'ST_EV',
      source
    })
    expect(result.source).toEqual(source)
  })

  it('does not mutate the input request', () => {
    const request: ArisSymbolResolutionRequest = {
      modelType: 'MT_EEPC',
      objectType: 'OT_RULE',
      symbolNum: 'ST_OPR_XOR_1',
      source: {
        geometry: { x: 1, y: 2 },
        style: { pen: { color: '0' } }
      }
    }
    const before = JSON.stringify(request)
    resolveArisSymbol(request)
    expect(JSON.stringify(request)).toBe(before)
  })

  it('produces a deduplicated fidelity report across many resolved symbols', () => {
    const resolved = [
      resolveArisSymbol({
        modelType: 'MT_EEPC',
        objectType: 'OT_UNKNOWN_TYPE',
        symbolNum: 'ST_UNKNOWN_1'
      }),
      resolveArisSymbol({
        modelType: 'MT_EEPC',
        objectType: 'OT_UNKNOWN_TYPE',
        symbolNum: 'ST_UNKNOWN_1'
      }),
      resolveArisSymbol({
        modelType: 'MT_EEPC',
        objectType: 'OT_FUNC',
        symbolNum: 'ST_UNKNOWN_FUNC'
      })
    ]
    const findings = buildSymbolFidelityFindings(resolved)
    expect(findings).toHaveLength(2)
    expect(
      findings.filter((f: ArisSymbolFidelityFinding) => f.kind === 'unknown-custom-symbol')
    ).toHaveLength(1)
    expect(
      findings.filter((f: ArisSymbolFidelityFinding) => f.kind === 'substituted-visual-resource')
    ).toHaveLength(1)
  })
})
