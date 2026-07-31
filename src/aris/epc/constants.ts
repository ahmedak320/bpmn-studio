/**
 * ARIS object/connection type vocabulary used by the EPC semantics module.
 *
 * The flow-relevant sets below are grounded in a lexical census of
 * `../reference/AnimalWF/ARISAMLExport.xml` (8 models, 494 object occurrences, ~465
 * connection occurrences — see plan section 19.1). That census is summarized in the module
 * report; only the aggregate facts are reproduced here as code, never the source file
 * itself.
 */

/** The three EPC control-flow object types (plan section 11.3 / 14.1). */
export const OT_FUNC = 'OT_FUNC'
export const OT_EVT = 'OT_EVT'
export const OT_RULE = 'OT_RULE'

/** Object types that participate in EPC control flow. Everything else is a satellite. */
export const FLOW_NODE_TYPES: ReadonlySet<string> = new Set([OT_FUNC, OT_EVT, OT_RULE])

/**
 * Connection types that represent EPC control flow (sequencing), as opposed to satellite
 * assignment relations (organizational, data, application, requirement, policy links).
 *
 * Derived from the AnimalWF census of `(CxnDef.Type, fromType, toType)` triples:
 *   - CT_ACTIV_1        OT_EVT  -> OT_FUNC   ("activates", 36x)   and OT_RULE -> OT_FUNC (14x)
 *   - CT_CRT_1          OT_FUNC -> OT_EVT    ("creates", 35x)
 *   - CT_LEADS_TO_1     OT_FUNC -> OT_RULE   ("leads to", into a split/merge rule, 16x)
 *   - CT_LEADS_TO_2     OT_RULE -> OT_EVT    ("leads to", out of a split/merge rule, 36x)
 *   - CT_IS_EVAL_BY_1   OT_EVT  -> OT_RULE   (19x) — see note below.
 *
 * All other observed connection types in the fixture (CT_SUPP_3, CT_EXEC_1, CT_EXEC_2,
 * CT_CRT_OUT_TO, CT_MUST_BE_INFO_ABT_1, CT_HAS_OUT, CT_IS_INP_FOR, CT_REFS_TO_2, CT_READ_1,
 * CT_AFFECTS, CT_IS_PRCS_ORNT_SUPER) connect a control-flow node to a satellite node
 * (OT_APPL_SYS, OT_PERS, OT_ENT_TYPE, OT_REQUIREMENT, OT_POLICY, ...), so none of those are
 * control flow.
 *
 * ADDITION BEYOND THE PLAN: `CT_IS_EVAL_BY_1` is included as control flow only because, in
 * every one of its 19 occurrences in the real fixture, it is the *sole* outgoing edge of an
 * `OT_EVT` node feeding directly into an `OT_RULE` node (e.g. the "Application Returned for
 * modification" event flowing into a merge XOR rule). Treating it as a satellite link would
 * make that event a dead end with no way out, which the source model does not intend. If a
 * future fixture uses `CT_IS_EVAL_BY_1` between an entity type and a rule (its more
 * conventional "decision basis" meaning), the endpoint-type guard below excludes it —
 * `isControlFlowTriple` only classifies it as flow when both endpoints are flow-node types.
 *
 * `CT_IS_PREDEC_OF_1` is deliberately absent from this type-only set. DMT uses it both for
 * value-added chains and for direct Function→Function sequencing inside EEPC models. Its
 * endpoint-sensitive EEPC meaning is represented solely by `isControlFlowTriple`.
 */
export const FLOW_CONNECTION_TYPES: ReadonlySet<string> = new Set([
  'CT_ACTIV_1',
  'CT_CRT_1',
  'CT_LEADS_TO_1',
  'CT_LEADS_TO_2',
  'CT_IS_EVAL_BY_1'
])

/**
 * Canonical EPC control-flow classifier.
 *
 * The established flow connection types remain flow whenever both endpoints are EPC flow
 * nodes. That deliberately keeps malformed Function→Function/Event→Event uses visible to the
 * alternation validator. DMT's predecessor connector is narrower: only its exact
 * Function→Function tuple is EEPC flow. Every other predecessor tuple and every connection
 * with a satellite/missing endpoint type is non-flow.
 */
export function isControlFlowTriple(
  connectionType: string,
  fromObjectType: string,
  toObjectType: string
): boolean {
  if (!FLOW_NODE_TYPES.has(fromObjectType) || !FLOW_NODE_TYPES.has(toObjectType)) return false
  if (connectionType === 'CT_IS_PREDEC_OF_1') {
    return fromObjectType === OT_FUNC && toObjectType === OT_FUNC
  }
  return FLOW_CONNECTION_TYPES.has(connectionType)
}

/** Rule (connector) kinds recognized from `SymbolNum`. */
export type EpcRuleKind = 'XOR' | 'AND' | 'OR' | 'unknown'

/**
 * Classifies a rule's symbol into AND/OR/XOR by tokenizing on `_` and checking for an exact
 * token match. This avoids the classic substring bug (`'OR'` matching inside `'XOR'`): the
 * real fixture's XOR symbol is `ST_OPR_XOR_1`, so a plain `.includes('OR')` would misfire.
 * Order does not matter here because we compare whole tokens, not substrings.
 */
export function classifyRuleSymbol(symbolType: string | null): EpcRuleKind {
  if (!symbolType) return 'unknown'
  const tokens = symbolType.toUpperCase().split('_')
  if (tokens.includes('XOR')) return 'XOR'
  if (tokens.includes('AND')) return 'AND'
  if (tokens.includes('OR')) return 'OR'
  return 'unknown'
}

/** Object types the plan (11.3) lists as satellite/authoring-supported but not control flow. */
export const SATELLITE_OBJECT_TYPES: ReadonlySet<string> = new Set([
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
