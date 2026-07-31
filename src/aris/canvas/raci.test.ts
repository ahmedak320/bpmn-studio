import { describe, expect, it } from 'vitest'

import {
  ARIS_RACI_ATTRIBUTE_TYPE,
  derivedRaciLabelText,
  resolveRaciLetter,
  type ArisRaciTuple
} from './raci'

/**
 * The tuple-safe RACI resolver (plan Wave 6, V5+): the letter is a function of
 * the connection type AND the endpoint tuple — eligible executor → Function —
 * never of the connection type alone.
 */

function tuple(
  connectionType: string,
  sourceObjectType: string,
  targetObjectType: string
): ArisRaciTuple {
  return Object.freeze({ connectionType, sourceObjectType, targetObjectType })
}

describe('resolveRaciLetter — tuple-scoped connection-type mapping', () => {
  it('maps each RACI connection type to its letter for an executor→Function tuple', () => {
    expect(resolveRaciLetter(tuple('CT_EXEC_1', 'OT_PERS', 'OT_FUNC'))).toBe('R')
    expect(resolveRaciLetter(tuple('CT_EXEC_2', 'OT_PERS_TYPE', 'OT_FUNC'))).toBe('R')
    expect(resolveRaciLetter(tuple('CT_DECID_ON', 'OT_ORG_UNIT', 'OT_FUNC'))).toBe('A')
    expect(resolveRaciLetter(tuple('CT_MUST_BE_CONSLT_ABT_1', 'OT_POS', 'OT_FUNC'))).toBe('C')
    expect(resolveRaciLetter(tuple('CT_MUST_BE_INFO_ABT_1', 'OT_GRP', 'OT_FUNC'))).toBe('I')
  })

  it('accepts every eligible executor type', () => {
    for (const executor of ['OT_ORG_UNIT', 'OT_POS', 'OT_GRP', 'OT_PERS_TYPE', 'OT_PERS']) {
      expect(resolveRaciLetter(tuple('CT_EXEC_1', executor, 'OT_FUNC'))).toBe('R')
    }
  })

  it('stays silent for a non-RACI connection type', () => {
    expect(resolveRaciLetter(tuple('CT_SUPP_3', 'OT_APPL_SYS', 'OT_FUNC'))).toBeNull()
    expect(resolveRaciLetter(tuple('CT_ACTIV_1', 'OT_EVT', 'OT_FUNC'))).toBeNull()
    expect(resolveRaciLetter(tuple('CT_REFS_TO_2', 'OT_REQUIREMENT', 'OT_FUNC'))).toBeNull()
  })

  it('stays silent when the source is not an eligible executor', () => {
    // A policy "must be informed about" a function is a regulation
    // relationship, not an Informed badge.
    expect(resolveRaciLetter(tuple('CT_MUST_BE_INFO_ABT_1', 'OT_POLICY', 'OT_FUNC'))).toBeNull()
    expect(resolveRaciLetter(tuple('CT_EXEC_1', 'OT_APPL_SYS', 'OT_FUNC'))).toBeNull()
  })

  it('stays silent when the target is not a Function', () => {
    expect(resolveRaciLetter(tuple('CT_EXEC_1', 'OT_PERS', 'OT_EVT'))).toBeNull()
    expect(resolveRaciLetter(tuple('CT_MUST_BE_INFO_ABT_1', 'OT_PERS', 'OT_POS'))).toBeNull()
  })

  it('stays silent for the reversed Function→executor tuple', () => {
    expect(resolveRaciLetter(tuple('CT_EXEC_1', 'OT_FUNC', 'OT_PERS'))).toBeNull()
  })
})

describe('derivedRaciLabelText — placement gating', () => {
  const raciTuple = tuple('CT_EXEC_1', 'OT_PERS', 'OT_FUNC')

  it('derives the letter for an empty TEXT relationship-badge placement', () => {
    expect(
      derivedRaciLabelText(
        { attributeType: ARIS_RACI_ATTRIBUTE_TYPE, symbolFlag: 'TEXT', text: '' },
        raciTuple
      )
    ).toBe('R')
  })

  it('never overrides or duplicates a source-authored value', () => {
    expect(
      derivedRaciLabelText(
        { attributeType: ARIS_RACI_ATTRIBUTE_TYPE, symbolFlag: 'TEXT', text: 'carries out' },
        raciTuple
      )
    ).toBeNull()
  })

  it('ignores non-RACI attribute placements even when empty', () => {
    expect(
      derivedRaciLabelText({ attributeType: 'AT_NAME', symbolFlag: 'TEXT', text: '' }, raciTuple)
    ).toBeNull()
    expect(
      derivedRaciLabelText(
        { attributeType: 'AT_SAP_XI_SYNCHRONOUS_CALL', symbolFlag: 'TEXT', text: '' },
        raciTuple
      )
    ).toBeNull()
  })

  it('ignores SYMBOL placements — they draw a glyph, never text', () => {
    expect(
      derivedRaciLabelText(
        { attributeType: ARIS_RACI_ATTRIBUTE_TYPE, symbolFlag: 'SYMBOL', text: '' },
        raciTuple
      )
    ).toBeNull()
  })

  it('ignores ineligible tuples', () => {
    expect(
      derivedRaciLabelText(
        { attributeType: ARIS_RACI_ATTRIBUTE_TYPE, symbolFlag: 'TEXT', text: '' },
        tuple('CT_SUPP_3', 'OT_APPL_SYS', 'OT_FUNC')
      )
    ).toBeNull()
    expect(
      derivedRaciLabelText(
        { attributeType: ARIS_RACI_ATTRIBUTE_TYPE, symbolFlag: 'TEXT', text: '' },
        null
      )
    ).toBeNull()
  })
})
