// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'

import { getPaletteSymbols } from '../conventions'
import { bootCanvas, type Harness } from './testing/harness'

let harness: Harness | null = null

afterEach(() => {
  harness?.destroy()
  harness = null
})

const pairKey = (objectType: string, symbolNum: string): string => `${objectType}:${symbolNum}`

describe('catalog-driven palette (Lane C4, plan R1)', () => {
  it('offers exactly one target per catalog symbol for the active model type', () => {
    harness = bootCanvas()
    const targets = harness.canvas.palette.targets()
    const symbols = getPaletteSymbols('MT_EEPC')

    expect(targets).toHaveLength(symbols.length)
    // Same multiset of (objectType, SymbolNum) — duplicate catalog rows included.
    expect(targets.map((target) => pairKey(target.objectType, target.symbolNum)).sort()).toEqual(
      symbols.map((symbol) => pairKey(symbol.objectType, symbol.symbolNum)).sort()
    )
    // Ids are unique even when catalog rows share an object type + SymbolNum.
    expect(new Set(targets.map((target) => target.id)).size).toBe(targets.length)
  })

  it('keeps the default symbol on the stable create.<ot> id and carries the SymbolNum', () => {
    harness = bootCanvas()
    const targets = harness.canvas.palette.targets()

    const funcDefault = targets.find(
      (target) => target.objectType === 'OT_FUNC' && target.symbolNum === 'ST_FUNC'
    )
    expect(funcDefault?.id).toBe('create.ot_func')

    const ruleDefault = targets.find(
      (target) => target.objectType === 'OT_RULE' && target.symbolNum === 'ST_OPR_AND_1'
    )
    expect(ruleDefault?.id).toBe('create.ot_rule')

    // A non-default symbol is a variant keyed create.<ot>.<st>.
    const systemFunction = targets.find(
      (target) => target.objectType === 'OT_FUNC' && target.symbolNum === 'ST_SYS_FUNC_ACT'
    )
    expect(systemFunction?.id).toBe('create.ot_func.st_sys_func_act')
  })

  it('exposes the catalog object type / SymbolNum and group on every create entry', () => {
    harness = bootCanvas()
    const entries = harness.canvas.palette.getPaletteEntries()

    const systemFunction = Object.values(entries).find(
      (entry) => entry.arisObjectType === 'OT_FUNC' && entry.arisSymbolNum === 'ST_SYS_FUNC_ACT'
    )
    expect(systemFunction).toBeTruthy()
    expect(systemFunction?.group).toBe('flow')
    expect(systemFunction?.html).toContain('aris-palette-entry__label')
    expect(systemFunction?.title).toBeTruthy()

    // Organizational groups land under their catalog palette group.
    const role = Object.values(entries).find((entry) => entry.arisObjectType === 'OT_PERS_TYPE')
    expect(role?.group).toBe('org')
  })

  it('offers the value-added-chain symbols in a VACD model', () => {
    harness = bootCanvas({ modelType: 'MT_VAL_ADD_CHN_DGM', modelName: 'VACD' })
    const targets = harness.canvas.palette.targets()
    const symbols = getPaletteSymbols('MT_VAL_ADD_CHN_DGM')

    expect(targets).toHaveLength(symbols.length)
    expect(
      targets.some(
        (target) => target.objectType === 'OT_FUNC' && target.symbolNum === 'ST_VAL_ADD_CHN_SML_1'
      )
    ).toBe(true)
  })
})
