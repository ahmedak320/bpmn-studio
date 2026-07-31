import { describe, expect, it } from 'vitest'

import { ARIS_CONVENTION_SYMBOLS } from '../conventions/catalog'
import { UNKNOWN_SYMBOL_DESCRIPTOR } from './fallback'
import { buildSymbolFidelityFindings } from './fidelity'
import { resolveArisCatalogSymbol, resolveArisSymbol } from './registry'
import {
  ARIS_OBJECT_TYPE_DEFAULT_SYMBOL,
  ARIS_SYMBOL_DESCRIPTORS,
  DMT_SYMBOL_FINGERPRINTS,
  isDmtSymbolDescriptor
} from './shapes'
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

  it('gives the Function descriptor a white surface and the DMT accent token', () => {
    const result = resolveArisSymbol({
      modelType: 'MT_EEPC',
      objectType: 'OT_FUNC',
      symbolNum: 'ST_FUNC'
    })
    expect(isDmtSymbolDescriptor(result.descriptor)).toBe(true)
    if (!isDmtSymbolDescriptor(result.descriptor)) throw new Error('Expected a DMT descriptor.')
    const surfaceIndexes =
      result.descriptor.semanticParts.find((part) => part.id === 'surface')?.elementIndexes ?? []
    const accentIndexes =
      result.descriptor.semanticParts.find((part) => part.id === 'accent')?.elementIndexes ?? []
    const surface = result.descriptor.drawing.elements[surfaceIndexes[0]!]
    const accent = result.descriptor.drawing.elements[accentIndexes[0]!]
    expect(surface && 'fill' in surface ? surface.fill : undefined).toBe('#ffffff')
    expect(accent && 'fill' in accent ? accent.fill : undefined).toBe('#339900')
  })

  it('implements the complete reviewed 36-presentation DMT fingerprint set', () => {
    expect(ARIS_SYMBOL_DESCRIPTORS).toHaveLength(36)
    expect(Object.keys(DMT_SYMBOL_FINGERPRINTS)).toHaveLength(36)
    expect(new Set(ARIS_SYMBOL_DESCRIPTORS.map((descriptor) => descriptor.catalogId)).size).toBe(36)
    expect(new Set(Object.values(DMT_SYMBOL_FINGERPRINTS)).size).toBe(36)

    for (const descriptor of ARIS_SYMBOL_DESCRIPTORS) {
      expect(descriptor.accessibleLabel.length).toBeGreaterThan(0)
      expect(descriptor.hitPath).toMatch(/^M /)
      expect(descriptor.ports).toHaveLength(9)
      expect(descriptor.iconBox.width).toBeGreaterThan(0)
      expect(descriptor.iconBox.height).toBeGreaterThan(0)
      expect(descriptor.stretchPolicy).toEqual({
        surface: 'stretch',
        icon: 'uniform',
        stroke: 'non-scaling'
      })
      expect(descriptor.semanticParts.length).toBeGreaterThan(0)
      expect(
        descriptor.semanticParts.flatMap((part) => part.elementIndexes).sort((a, b) => a - b)
      ).toEqual(descriptor.drawing.elements.map((_, index) => index))
    }
  })

  it('keeps catalog discovery metadata and shared preview descriptors in lockstep', () => {
    expect(new Set(ARIS_CONVENTION_SYMBOLS.map((entry) => entry.catalogId))).toEqual(
      new Set(ARIS_SYMBOL_DESCRIPTORS.map((descriptor) => descriptor.catalogId))
    )
    for (const entry of ARIS_CONVENTION_SYMBOLS) {
      const descriptor = resolveArisCatalogSymbol(entry.catalogId)
      expect(descriptor).toMatchObject({
        objectType: entry.objectType,
        symbolNum: entry.symbolNum,
        labelKey: entry.labelKey,
        accessibleLabel: entry.accessibleLabel,
        silhouette: entry.silhouette,
        icon: entry.icon,
        operator: entry.operator,
        roundTripVerified: entry.placementEnabled
      })
    }
  })

  it('keeps catalog variants distinct even when their persisted pair is currently shared', () => {
    const dataEntity = resolveArisCatalogSymbol('data.data-entity')
    const entityType = resolveArisCatalogSymbol('data.entity-type')
    const policy = resolveArisCatalogSymbol('governance.business-policy')
    const sla = resolveArisCatalogSymbol('governance.sla')
    const law = resolveArisCatalogSymbol('governance.law-regulation')

    expect(dataEntity?.key).not.toBe(entityType?.key)
    expect(dataEntity?.icon).toBe('data-entity')
    expect(entityType?.icon).toBe('entity-type')
    expect(policy?.icon).toBe('business-policy')
    expect(sla?.icon).toBe('service-level-shield')
    expect(law?.icon).toBe('law-shield')
    expect(entityType?.roundTripVerified).toBe(false)
    expect(sla?.roundTripVerified).toBe(false)
  })

  it('uses the manual silhouettes and glyphs for representative imported symbols', () => {
    expect(resolveArisCatalogSymbol('epc.event')).toMatchObject({
      silhouette: 'event-chevron',
      icon: 'flag'
    })
    expect(resolveArisCatalogSymbol('epc.function')).toMatchObject({
      silhouette: 'card',
      icon: 'double-chevron'
    })
    expect(resolveArisCatalogSymbol('epc.system-function')).toMatchObject({
      silhouette: 'card',
      icon: 'application-window'
    })
    expect(resolveArisCatalogSymbol('technology.application-system')).toMatchObject({
      silhouette: 'card',
      icon: 'application-window'
    })
    expect(resolveArisCatalogSymbol('organization.role')?.icon).toBe('person')
    expect(resolveArisCatalogSymbol('governance.risk')?.icon).toBe('risk')
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

  it('renders an explicit unknown imported SymbolNum as the visible fidelity fallback', () => {
    const result = resolveArisSymbol({
      modelType: 'MT_EEPC',
      objectType: 'OT_FUNC',
      symbolNum: 'ST_UNKNOWN_FUNC'
    })
    expect(result.descriptor).toBe(UNKNOWN_SYMBOL_DESCRIPTOR)
    expect(result.fidelity).toHaveLength(1)
    expect(result.fidelity[0].kind).toBe('unknown-custom-symbol')
    expect(result.fidelity[0].requestedKey).toBe('MT_EEPC:OT_FUNC:ST_UNKNOWN_FUNC')
    expect(result.fidelity[0].resolvedKey).toBe(UNKNOWN_SYMBOL_DESCRIPTOR.key)
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

    // An absent symbol num on a new authoring request falls back to OT_FUNC default.
    const defaulted = resolveArisSymbol({
      modelType: 'MT_VAL_ADD_CHN_DGM',
      objectType: 'OT_FUNC',
      symbolNum: ''
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
        symbolNum: ''
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
