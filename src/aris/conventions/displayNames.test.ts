import { afterEach, describe, expect, it } from 'vitest'

import { setLang } from '../../i18n'
import { conventionSymbolByCatalogId } from './catalog'
import {
  arisAttributeTypeName,
  arisConnectionTypeName,
  arisModelTypeName,
  arisObjectBlockName,
  arisObjectTypeName,
  conventionRowFor,
  humanizeArisCode
} from './displayNames'

afterEach(() => {
  setLang('en')
})

describe('humanizeArisCode', () => {
  it('strips a known ARIS prefix, lowercases, and title-cases each word', () => {
    expect(humanizeArisCode('OT_ENT_TYPE')).toBe('Ent Type')
  })

  it('strips the AT_ prefix for an attribute code', () => {
    expect(humanizeArisCode('AT_CUSTOM_X')).toBe('Custom X')
  })

  it('humanizes a multi-word unregistered code word by word', () => {
    expect(humanizeArisCode('OT_WEIRD_THING')).toBe('Weird Thing')
  })
})

describe('conventionRowFor', () => {
  it('resolves an exact (objectType, symbolNum) pair', () => {
    const logRow = conventionSymbolByCatalogId('information.log')
    expect(logRow).not.toBeNull()
    const resolved = conventionRowFor({
      objectType: logRow!.objectType,
      symbolNum: logRow!.symbolNum
    })
    expect(resolved?.catalogId).toBe('information.log')
  })

  it('prefers an explicit catalogId over a (objectType, symbolNum) match', () => {
    const emailRow = conventionSymbolByCatalogId('information.email')
    expect(emailRow).not.toBeNull()
    // symbolNum deliberately points at the Log row, not Email, to prove
    // catalogId wins outright rather than merely being tried first.
    const resolved = conventionRowFor({
      objectType: emailRow!.objectType,
      symbolNum: 'ST_LOG',
      catalogId: 'information.email'
    })
    expect(resolved?.catalogId).toBe('information.email')
  })

  it('falls through to (objectType, symbolNum) when catalogId is unknown', () => {
    const logRow = conventionSymbolByCatalogId('information.log')
    expect(logRow).not.toBeNull()
    const resolved = conventionRowFor({
      objectType: logRow!.objectType,
      symbolNum: logRow!.symbolNum,
      catalogId: 'does.not.exist'
    })
    expect(resolved?.catalogId).toBe('information.log')
  })

  it('falls through to the lowest-paletteOrder objectType row when symbolNum is unknown', () => {
    const resolved = conventionRowFor({ objectType: 'OT_FUNC', symbolNum: 'ST_DOES_NOT_EXIST' })
    expect(resolved?.catalogId).toBe('epc.function')
  })

  it('resolves a bare objectType to its lowest-paletteOrder row', () => {
    const resolved = conventionRowFor({ objectType: 'OT_FUNC' })
    expect(resolved?.catalogId).toBe('epc.function')
  })

  it('returns null for an objectType absent from the catalog entirely', () => {
    expect(conventionRowFor({ objectType: 'OT_WEIRD_THING' })).toBeNull()
  })
})

describe('arisObjectTypeName', () => {
  it('resolves Log via objectType + symbolNum', () => {
    const logRow = conventionSymbolByCatalogId('information.log')
    expect(logRow).not.toBeNull()
    expect(
      arisObjectTypeName({ objectType: logRow!.objectType, symbolNum: logRow!.symbolNum })
    ).toBe('Log')
  })

  it('resolves Email via catalogId', () => {
    expect(arisObjectTypeName({ objectType: 'OT_INFO_CARR', catalogId: 'information.email' })).toBe(
      'Email'
    )
  })

  it('resolves a bare OT_FUNC to Function', () => {
    expect(arisObjectTypeName({ objectType: 'OT_FUNC' })).toBe('Function')
  })

  it('humanizes an unregistered object type', () => {
    expect(arisObjectTypeName({ objectType: 'OT_WEIRD_THING' })).toBe('Weird Thing')
  })

  it('returns the Arabic label when the active language is Arabic', () => {
    const logRow = conventionSymbolByCatalogId('information.log')
    expect(logRow).not.toBeNull()
    setLang('ar')
    expect(
      arisObjectTypeName({ objectType: logRow!.objectType, symbolNum: logRow!.symbolNum })
    ).toBe('سجل')
  })
})

describe('arisObjectBlockName', () => {
  it('wraps the friendly object type name in the registered English block template', () => {
    expect(arisObjectBlockName({ objectType: 'OT_FUNC' })).toBe('Function block')
  })

  it('wraps the friendly object type name in the registered Arabic block template', () => {
    setLang('ar')
    expect(arisObjectBlockName({ objectType: 'OT_FUNC' })).toBe('عنصر وظيفة')
  })
})

describe('arisModelTypeName', () => {
  it('resolves MT_EEPC to the registered Process (EPC) label', () => {
    expect(arisModelTypeName('MT_EEPC')).toBe('Process (EPC)')
  })

  it('resolves MT_VAL_ADD_CHN_DGM to the registered value-added chain diagram label', () => {
    expect(arisModelTypeName('MT_VAL_ADD_CHN_DGM')).toBe('Value-added chain diagram')
  })

  it('humanizes an unregistered model type', () => {
    expect(arisModelTypeName('MT_WEIRD_MODEL')).toBe('Weird Model')
  })
})

describe('arisConnectionTypeName', () => {
  it("resolves CT_IS_PREDEC_OF_1 to the registered rule's label", () => {
    expect(arisConnectionTypeName('CT_IS_PREDEC_OF_1')).toBe('is predecessor of')
  })

  it('humanizes an unregistered connection type', () => {
    expect(arisConnectionTypeName('CT_WEIRD_LINK')).toBe('Weird Link')
  })
})

describe('arisAttributeTypeName', () => {
  it('resolves a schema-registered attribute via its owner object type', () => {
    expect(arisAttributeTypeName('AT_ID', 'OT_FUNC')).toBe('Identifier')
  })

  it('humanizes an attribute with no owner object type given', () => {
    expect(arisAttributeTypeName('AT_CUSTOM_X')).toBe('Custom X')
  })

  it('humanizes a real attribute code when the owner object type does not carry it', () => {
    expect(arisAttributeTypeName('AT_ID', 'OT_EVT')).toBe('Id')
  })
})
