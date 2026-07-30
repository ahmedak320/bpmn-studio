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

  it('has exactly one catalog row for every persisted objectType + symbolNum identity', () => {
    const identities = ARIS_CONVENTION_SYMBOLS.map(
      (symbol) => `${symbol.objectType}:${symbol.symbolNum}`
    )

    expect(new Set(identities).size).toBe(identities.length)
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
    expect(conventionDefaultFill('OT_EVT', 'ST_EV')).toBe('#dcbbed')
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
