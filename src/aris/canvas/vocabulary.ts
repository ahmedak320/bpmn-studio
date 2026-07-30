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

import { resolveConventionConnection } from '../conventions/connectionRules'
import type { ArisSupportedModelType } from '../model/types'

/** Model types the canvas can author (Section 11.2). */
export const ARIS_CANVAS_MODEL_TYPES: readonly ArisSupportedModelType[] = Object.freeze([
  'MT_EEPC',
  'MT_VAL_ADD_CHN_DGM'
])

export function isSupportedModelType(value: string): value is ArisSupportedModelType {
  return (ARIS_CANVAS_MODEL_TYPES as readonly string[]).includes(value)
}

/**
 * Object types the canvas can create/edit/delete/connect (Section 11.3), plus
 * the plan R1 catalog additions (`OT_ORG_UNIT`, `OT_POS`, `OT_GRP`,
 * `OT_RISK`, `OT_SERVICE` — `conventions/catalog.ts`). `authoring.ts`'s
 * `isSupportedObjectType` gate reads this list directly, and
 * `paletteProvider.ts` now offers a palette entry per `getPaletteSymbols(...)`
 * row regardless of this list (it no longer imports it at all), so every
 * catalog object type is already draggable from the palette — this list is
 * what makes `createObject`/`isSupportedObjectType` agree with what the
 * palette (and an imported document) can already produce, instead of
 * rejecting a subset of them.
 */
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
  'OT_PERS_TYPE',
  // R1 catalog additions.
  'OT_ORG_UNIT',
  'OT_POS',
  'OT_GRP',
  'OT_RISK',
  'OT_SERVICE'
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

/**
 * Object types that hang off the control flow rather than sequencing it.
 *
 * Includes the plan R1 org/governance additions (`OT_ORG_UNIT`, `OT_POS`,
 * `OT_GRP`, `OT_RISK`, `OT_SERVICE`) alongside the original satellite types —
 * none of these are core EPC control-flow elements (`OT_FUNC`/`OT_EVT`/
 * `OT_RULE`), so `layoutSeam.ts` should place all of them the same way.
 */
export const ARIS_SATELLITE_OBJECT_TYPES: ReadonlySet<string> = new Set([
  'OT_ENT_TYPE',
  'OT_INFO_CARR',
  'OT_BUSINESS_RULE',
  'OT_PERF',
  'OT_APPL_SYS',
  'OT_PERS',
  'OT_REQUIREMENT',
  'OT_POLICY',
  'OT_PERS_TYPE',
  'OT_ORG_UNIT',
  'OT_POS',
  'OT_GRP',
  'OT_RISK',
  'OT_SERVICE'
])

export function isSatelliteObjectType(objectType: string): boolean {
  return ARIS_SATELLITE_OBJECT_TYPES.has(objectType)
}

/**
 * Generic association used when no specific triple is registered. Reported as a
 * fallback so the caller can surface "we guessed a connection type".
 */
export const ARIS_FALLBACK_CONNECTION_TYPE = 'CT_REFS_TO_2'

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
 * Delegates to `conventions/connectionRules.resolveConventionConnection`
 * (plan R2), which is now the single policy source for
 * `(modelType, fromType, toType) -> connectionType`. That catalog reproduces
 * every triple this function used to hold verbatim, plus the R2 additions
 * (executor RACI variants for `OT_ORG_UNIT`/`OT_POS`/`OT_GRP`, org-chart,
 * service-tree, and the VACD process-oriented-superior rule) — so behaviour
 * for every triple that existed before R2 is unchanged. Model-type-specific
 * rules still win over model-type-independent ones (that ordering lives in
 * `connectionRules.ts` now). Only the public `{connectionType, fallback}`
 * shape is returned here; the richer `ResolvedConventionConnection` (with its
 * `rule` detail) stays internal to the conventions module so this function's
 * signature and return shape are unchanged for existing callers/tests.
 */
export function resolveConnectionType(
  modelType: string,
  fromObjectType: string,
  toObjectType: string
): ResolvedConnectionType {
  const resolved = resolveConventionConnection(modelType, fromObjectType, toObjectType)
  return Object.freeze({ connectionType: resolved.connectionType, fallback: resolved.fallback })
}

/** Attribute type carrying an object's display name. */
export const AT_NAME = 'AT_NAME'

/** Attribute type carrying canvas-managed attachments (Section 11.4). */
export const AT_ORBITPM_ATTACHMENT = 'AT_ORBITPM_ATTACHMENT'
