/**
 * The ARIS vocabulary the canvas authors natively — Plan Sections 11.2 / 11.3.
 *
 * The connection-type table below reproduces the `(CxnDef.Type, fromType,
 * toType)` triples the EPC semantics lane already documented in
 * `src/aris/epc/constants.ts` from the AnimalWF census. It is *policy* for
 * authoring (which type to mint when a user draws an edge), not a re-derivation
 * of that census — `src/aris/epc` stays the authority on what counts as control
 * flow, and this module never imports it, so the two lanes stay decoupled.
 */

import type { ArisSupportedModelType } from '../model/types'

/** Model types the canvas can author (Section 11.2). */
export const ARIS_CANVAS_MODEL_TYPES: readonly ArisSupportedModelType[] = Object.freeze([
  'MT_EEPC',
  'MT_VAL_ADD_CHN_DGM'
])

export function isSupportedModelType(value: string): value is ArisSupportedModelType {
  return (ARIS_CANVAS_MODEL_TYPES as readonly string[]).includes(value)
}

/** Object types the canvas can create/edit/delete/connect (Section 11.3). */
export const ARIS_CANVAS_OBJECT_TYPES: readonly string[] = Object.freeze([
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

export function isSupportedObjectType(value: string): boolean {
  return ARIS_CANVAS_OBJECT_TYPES.includes(value)
}

export type ArisRuleOperator = 'AND' | 'OR' | 'XOR'

/** Native rule symbols (Section 11.3, "Support native AND, OR, and XOR rule symbols"). */
export const ARIS_RULE_SYMBOLS: Readonly<Record<ArisRuleOperator, string>> = Object.freeze({
  AND: 'ST_OPR_AND_1',
  OR: 'ST_OPR_OR_1',
  XOR: 'ST_OPR_XOR_1'
})

/**
 * Classify a rule SymbolNum back into its operator.
 *
 * Tokenized on `_` so `OR` never matches inside `XOR` — the same guard the EPC
 * lane documents for `classifyRuleSymbol`.
 */
export function ruleOperatorOfSymbol(symbolNum: string | null): ArisRuleOperator | null {
  if (!symbolNum) return null
  const tokens = symbolNum.toUpperCase().split('_')
  if (tokens.includes('XOR')) return 'XOR'
  if (tokens.includes('AND')) return 'AND'
  if (tokens.includes('OR')) return 'OR'
  return null
}

/** Object types that hang off the control flow rather than sequencing it. */
export const ARIS_SATELLITE_OBJECT_TYPES: ReadonlySet<string> = new Set([
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

export function isSatelliteObjectType(objectType: string): boolean {
  return ARIS_SATELLITE_OBJECT_TYPES.has(objectType)
}

/**
 * Generic association used when no specific triple is registered. Reported as a
 * fallback so the caller can surface "we guessed a connection type".
 */
export const ARIS_FALLBACK_CONNECTION_TYPE = 'CT_REFS_TO_2'

interface ConnectionRule {
  readonly modelType: ArisSupportedModelType | null
  readonly from: string
  readonly to: string
  readonly connectionType: string
}

const CONNECTION_RULES: readonly ConnectionRule[] = Object.freeze([
  // --- EEPC control flow -------------------------------------------------
  { modelType: 'MT_EEPC', from: 'OT_EVT', to: 'OT_FUNC', connectionType: 'CT_ACTIV_1' },
  { modelType: 'MT_EEPC', from: 'OT_RULE', to: 'OT_FUNC', connectionType: 'CT_ACTIV_1' },
  { modelType: 'MT_EEPC', from: 'OT_FUNC', to: 'OT_EVT', connectionType: 'CT_CRT_1' },
  { modelType: 'MT_EEPC', from: 'OT_FUNC', to: 'OT_RULE', connectionType: 'CT_LEADS_TO_1' },
  { modelType: 'MT_EEPC', from: 'OT_RULE', to: 'OT_EVT', connectionType: 'CT_LEADS_TO_2' },
  { modelType: 'MT_EEPC', from: 'OT_RULE', to: 'OT_RULE', connectionType: 'CT_LEADS_TO_2' },
  { modelType: 'MT_EEPC', from: 'OT_EVT', to: 'OT_RULE', connectionType: 'CT_IS_EVAL_BY_1' },

  // --- Value-added chain -------------------------------------------------
  { modelType: 'MT_VAL_ADD_CHN_DGM', from: 'OT_FUNC', to: 'OT_FUNC', connectionType: 'CT_IS_PREDEC_OF_1' },

  // --- Satellite assignments (model-type independent) --------------------
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

export interface ResolvedConnectionType {
  readonly connectionType: string
  /**
   * `true` when no registered triple matched and the generic association type
   * was used instead. Callers surface this so authors can correct the type.
   */
  readonly fallback: boolean
}

/**
 * Choose the connection type for a newly drawn edge.
 *
 * Model-type-specific rules win over model-type-independent ones so an EEPC
 * `OT_FUNC -> OT_FUNC` edge does not silently become the VACD predecessor type.
 */
export function resolveConnectionType(
  modelType: string,
  fromObjectType: string,
  toObjectType: string
): ResolvedConnectionType {
  const exact = CONNECTION_RULES.find(
    (rule) => rule.modelType === modelType && rule.from === fromObjectType && rule.to === toObjectType
  )
  if (exact) return Object.freeze({ connectionType: exact.connectionType, fallback: false })

  const generic = CONNECTION_RULES.find(
    (rule) => rule.modelType === null && rule.from === fromObjectType && rule.to === toObjectType
  )
  if (generic) return Object.freeze({ connectionType: generic.connectionType, fallback: false })

  return Object.freeze({ connectionType: ARIS_FALLBACK_CONNECTION_TYPE, fallback: true })
}

/** Attribute type carrying an object's display name. */
export const AT_NAME = 'AT_NAME'

/** Attribute type carrying canvas-managed attachments (Section 11.4). */
export const AT_ORBITPM_ATTACHMENT = 'AT_ORBITPM_ATTACHMENT'
