import { describe, expect, it } from 'vitest'

import {
  ARIS_CONVENTION_SYMBOLS,
  conventionDefaultFill,
  conventionSymbol,
  getPaletteSymbols,
  getVariantFamily
} from './catalog'

describe('ARIS convention symbol catalog', () => {
  it('every catalog symbol has a 6-digit hex fill prefixed with #', () => {
    for (const symbol of ARIS_CONVENTION_SYMBOLS) {
      expect(symbol.defaultFill).toMatch(/^#[0-9a-fA-F]{6}$/)
    }
  })

  it('every catalog symbol has the default stroke unless overridden', () => {
    for (const symbol of ARIS_CONVENTION_SYMBOLS) {
      expect(symbol.defaultStroke).toBe('#1a1a1a')
    }
  })

  it('has 36 stable catalog identities without pretending shared persisted pairs are unique', () => {
    expect(ARIS_CONVENTION_SYMBOLS).toHaveLength(36)
    const catalogIds = ARIS_CONVENTION_SYMBOLS.map((symbol) => symbol.catalogId)
    expect(new Set(catalogIds).size).toBe(36)

    const disabled = ARIS_CONVENTION_SYMBOLS.filter((symbol) => !symbol.placementEnabled)
    expect(disabled).toHaveLength(7)
    expect(disabled.every((symbol) => symbol.placementDisabledReason !== null)).toBe(true)
  })

  it('looks up a symbol by objectType + symbolNum', () => {
    const symbol = conventionSymbol('OT_FUNC', 'ST_FUNC')
    expect(symbol).not.toBeNull()
    expect(symbol?.labelKey).toBe('aris.symbol.function')
    expect(symbol?.defaultFill).toBe('#339900')
  })

  it('returns null for an unknown objectType + symbolNum pair', () => {
    expect(conventionSymbol('OT_FUNC', 'ST_DOES_NOT_EXIST')).toBeNull()
  })

  it('returns the default fill for a known pair', () => {
    expect(conventionDefaultFill('OT_EVT', 'ST_EV')).toBe('#edbbdc')
  })

  it('defaults every brush-less governance object to the DMT governance red', () => {
    expect(conventionDefaultFill('OT_BUSINESS_RULE', 'ST_BUSINESS_RULE')).toBe('#c82830')
    expect(conventionDefaultFill('OT_POLICY', 'ST_BUSINESS_POLICY')).toBe('#c82830')
    for (const catalogId of [
      'governance.business-rule',
      'governance.business-policy',
      'governance.sla',
      'governance.law-regulation'
    ]) {
      const symbol = ARIS_CONVENTION_SYMBOLS.find((entry) => entry.catalogId === catalogId)
      expect(symbol?.defaultFill).toBe('#c82830')
      expect(symbol?.verification).toBe('aris-doc')
    }
  })

  it('returns null for an unknown pair', () => {
    expect(conventionDefaultFill('OT_FUNC', 'ST_DOES_NOT_EXIST')).toBeNull()
  })

  it('getPaletteSymbols(MT_EEPC) includes Function, Event and rules', () => {
    const palette = getPaletteSymbols('MT_EEPC')
    const keys = palette.map((s) => s.labelKey)
    expect(keys).toContain('aris.symbol.function')
    expect(keys).toContain('aris.symbol.event')
    expect(keys).toContain('aris.symbol.and')
    expect(keys).toContain('aris.symbol.or')
    expect(keys).toContain('aris.symbol.xor')
  })

  it('getPaletteSymbols(MT_EEPC) excludes VACD-only symbols', () => {
    const palette = getPaletteSymbols('MT_EEPC')
    const keys = palette.map((s) => s.labelKey)
    expect(keys).not.toContain('aris.symbol.valueAddedChain')
    expect(keys).not.toContain('aris.symbol.valueAddedChainStart')
  })

  it('getPaletteSymbols(MT_VAL_ADD_CHN_DGM) includes value-chain symbols', () => {
    const palette = getPaletteSymbols('MT_VAL_ADD_CHN_DGM')
    const keys = palette.map((s) => s.labelKey)
    expect(keys).toContain('aris.symbol.valueAddedChain')
    expect(keys).not.toContain('aris.symbol.valueAddedChainStart')
  })

  it('getVariantFamily(OT_FUNC, ST_FUNC) includes System function + Process interface', () => {
    const family = getVariantFamily('OT_FUNC', 'ST_FUNC')
    const keys = family.map((s) => s.labelKey)
    expect(keys).toContain('aris.symbol.systemFunction')
    expect(keys).toContain('aris.symbol.processInterface')
  })

  it('getVariantFamily returns an empty array for unknown or family-less symbols', () => {
    expect(getVariantFamily('OT_DOES_NOT_EXIST', 'ST_ANY')).toHaveLength(0)
    expect(getVariantFamily('OT_APPL_SYS', 'ST_APPL_SYS')).toHaveLength(0)
  })
})
