import { describe, expect, it } from 'vitest'

import {
  ARIS_CONNECTION_RULES,
  RACI_BY_CONNECTION_TYPE,
  isLegalConnection,
  resolveConventionConnection
} from './connectionRules'

/**
 * Existing triples from `src/aris/canvas/vocabulary.ts` at the time this catalog
 * was authored.  They must resolve identically through the convention catalog.
 */
const EXISTING_VOCABULARY_TRIPLES: readonly {
  readonly modelType: string | null
  readonly from: string
  readonly to: string
  readonly connectionType: string
}[] = Object.freeze([
  // EEPC control flow
  { modelType: 'MT_EEPC', from: 'OT_EVT', to: 'OT_FUNC', connectionType: 'CT_ACTIV_1' },
  { modelType: 'MT_EEPC', from: 'OT_RULE', to: 'OT_FUNC', connectionType: 'CT_ACTIV_1' },
  { modelType: 'MT_EEPC', from: 'OT_FUNC', to: 'OT_EVT', connectionType: 'CT_CRT_1' },
  { modelType: 'MT_EEPC', from: 'OT_FUNC', to: 'OT_RULE', connectionType: 'CT_LEADS_TO_1' },
  { modelType: 'MT_EEPC', from: 'OT_RULE', to: 'OT_EVT', connectionType: 'CT_LEADS_TO_2' },
  { modelType: 'MT_EEPC', from: 'OT_RULE', to: 'OT_RULE', connectionType: 'CT_LEADS_TO_2' },
  { modelType: 'MT_EEPC', from: 'OT_EVT', to: 'OT_RULE', connectionType: 'CT_IS_EVAL_BY_1' },

  // Value-added chain
  {
    modelType: 'MT_VAL_ADD_CHN_DGM',
    from: 'OT_FUNC',
    to: 'OT_FUNC',
    connectionType: 'CT_IS_PREDEC_OF_1'
  },

  // Satellite assignments
  { modelType: null, from: 'OT_PERS', to: 'OT_FUNC', connectionType: 'CT_EXEC_1' },
  { modelType: null, from: 'OT_PERS_TYPE', to: 'OT_FUNC', connectionType: 'CT_EXEC_2' },
  { modelType: null, from: 'OT_APPL_SYS', to: 'OT_FUNC', connectionType: 'CT_SUPP_3' },
  { modelType: null, from: 'OT_ENT_TYPE', to: 'OT_FUNC', connectionType: 'CT_IS_INP_FOR' },
  { modelType: null, from: 'OT_FUNC', to: 'OT_ENT_TYPE', connectionType: 'CT_CRT_OUT_TO' },
  { modelType: null, from: 'OT_INFO_CARR', to: 'OT_FUNC', connectionType: 'CT_IS_INP_FOR' },
  { modelType: null, from: 'OT_FUNC', to: 'OT_INFO_CARR', connectionType: 'CT_HAS_OUT' },
  { modelType: null, from: 'OT_FUNC', to: 'OT_PERF', connectionType: 'CT_AFFECTS' },
  { modelType: null, from: 'OT_BUSINESS_RULE', to: 'OT_FUNC', connectionType: 'CT_IS_EVAL_BY_1' },
  { modelType: null, from: 'OT_REQUIREMENT', to: 'OT_FUNC', connectionType: 'CT_REFS_TO_2' },
  { modelType: null, from: 'OT_POLICY', to: 'OT_FUNC', connectionType: 'CT_MUST_BE_INFO_ABT_1' }
])

const ANIMALWF_DMT_EEPC_TUPLES = Object.freeze([
  {
    modelType: 'MT_EEPC',
    from: 'OT_FUNC',
    to: 'OT_ENT_TYPE',
    connectionType: 'CT_HAS_OUT',
    verification: 'aris-doc'
  },
  {
    modelType: 'MT_EEPC',
    from: 'OT_FUNC',
    to: 'OT_INFO_CARR',
    connectionType: 'CT_CRT_OUT_TO',
    verification: 'aris-doc'
  },
  {
    modelType: 'MT_EEPC',
    from: 'OT_FUNC',
    to: 'OT_ENT_TYPE',
    connectionType: 'CT_READ_1',
    verification: 'unverified'
  },
  {
    modelType: 'MT_EEPC',
    from: 'OT_FUNC',
    to: 'OT_FUNC',
    connectionType: 'CT_IS_PREDEC_OF_1',
    verification: 'unverified'
  }
] as const)

describe('ARIS convention connection rules', () => {
  it('every existing vocabulary.ts triple resolves identically', () => {
    for (const triple of EXISTING_VOCABULARY_TRIPLES) {
      const modelType = triple.modelType ?? 'MT_EEPC'
      const resolved = resolveConventionConnection(modelType, triple.from, triple.to)
      expect(resolved.fallback).toBe(false)
      expect(resolved.connectionType).toBe(triple.connectionType)
      expect(resolved.rule).not.toBeNull()
    }
  })

  it('every existing vocabulary.ts triple is reported as legal', () => {
    for (const triple of EXISTING_VOCABULARY_TRIPLES) {
      const modelType = triple.modelType ?? 'MT_EEPC'
      expect(isLegalConnection(modelType, triple.from, triple.to, triple.connectionType)).toBe(true)
    }
  })

  it('RACI letters are correct per R2', () => {
    expect(RACI_BY_CONNECTION_TYPE.CT_EXEC_1).toBe('R')
    expect(RACI_BY_CONNECTION_TYPE.CT_EXEC_2).toBe('R')
    expect(RACI_BY_CONNECTION_TYPE.CT_DECID_ON).toBe('A')
    expect(RACI_BY_CONNECTION_TYPE.CT_MUST_BE_CONSLT_ABT_1).toBe('C')
    expect(RACI_BY_CONNECTION_TYPE.CT_MUST_BE_INFO_ABT_1).toBe('I')
  })

  it('every rule with a RACI letter matches RACI_BY_CONNECTION_TYPE', () => {
    for (const rule of ARIS_CONNECTION_RULES) {
      if (rule.raci === null) continue
      expect(RACI_BY_CONNECTION_TYPE[rule.connectionType]).toBe(rule.raci)
    }
  })

  it('legalizes only the four missing AnimalWF DMT EEPC tuples with audited verification', () => {
    for (const tuple of ANIMALWF_DMT_EEPC_TUPLES) {
      expect(isLegalConnection(tuple.modelType, tuple.from, tuple.to, tuple.connectionType)).toBe(
        true
      )
      expect(
        ARIS_CONNECTION_RULES.find(
          (rule) =>
            rule.modelType === tuple.modelType &&
            rule.from === tuple.from &&
            rule.to === tuple.to &&
            rule.connectionType === tuple.connectionType
        )?.verification
      ).toBe(tuple.verification)
    }
  })

  it('keeps non-fixture endpoint and connection-type combinations illegal', () => {
    expect(isLegalConnection('MT_EEPC', 'OT_EVT', 'OT_EVT', 'CT_ACTIV_1')).toBe(false)
    expect(isLegalConnection('MT_EEPC', 'OT_FUNC', 'OT_INFO_CARR', 'CT_READ_1')).toBe(false)
    expect(isLegalConnection('MT_VAL_ADD_CHN_DGM', 'OT_FUNC', 'OT_ENT_TYPE', 'CT_HAS_OUT')).toBe(
      false
    )
  })

  it('falls back to CT_REFS_TO_2 for an unknown from/to pair', () => {
    const resolved = resolveConventionConnection('MT_EEPC', 'OT_EVT', 'OT_EVT')
    expect(resolved.fallback).toBe(true)
    expect(resolved.connectionType).toBe('CT_REFS_TO_2')
    expect(resolved.rule).toBeNull()
  })

  it('resolves model-scoped function sequence rules', () => {
    const vacd = resolveConventionConnection('MT_VAL_ADD_CHN_DGM', 'OT_FUNC', 'OT_FUNC')
    expect(vacd.fallback).toBe(false)
    expect(vacd.connectionType).toBe('CT_IS_PREDEC_OF_1')

    // The real DMT export also uses this direct sequence tuple in EEPC models.
    const eepc = resolveConventionConnection('MT_EEPC', 'OT_FUNC', 'OT_FUNC')
    expect(eepc.fallback).toBe(false)
    expect(eepc.connectionType).toBe('CT_IS_PREDEC_OF_1')
  })
})
