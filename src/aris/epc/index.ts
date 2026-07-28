/**
 * Public surface of the EPC semantics module (plan section 14.1–14.3).
 *
 * ## i18n keys used by findings, not yet registered
 *
 * `EpcFinding.messageKey` values are plain string literals, not `keyof typeof en` from
 * `src/i18n`, because this module is forbidden from touching `src/i18n/dictionaries.ts`
 * (owned elsewhere / out of scope for this lane). The keys below need English + Arabic
 * entries added to `src/i18n/dictionaries.ts` before they can be rendered through `t()`:
 *
 *   - aris.epc.finding.alternationViolation
 *   - aris.epc.finding.missingStartEvent
 *   - aris.epc.finding.missingEndEvent
 *   - aris.epc.finding.ruleSplitMergeConflict
 *   - aris.epc.finding.eventPrecedesDecisionSplit
 *   - aris.epc.finding.orphanNode
 *   - aris.epc.finding.unrecognizedRuleSymbol
 *   - aris.epc.finding.missingConnectionType
 *   - aris.epc.finding.danglingLinkedModel
 *
 * Until then, a UI layer can still render every finding safely by falling back to
 * `ruleId` (e.g. via `t(finding.messageKey)` returning the key itself, matching
 * `src/i18n/index.ts`'s existing `raw ?? key` fallback behavior) — nothing here ever
 * produces raw English prose.
 */

export type {
  EpcConnectionType,
  EpcEdge,
  EpcFinding,
  EpcGraph,
  EpcLocalizedNames,
  EpcNode,
  EpcObjectType,
  EpcPoint,
  EpcSeverity,
  EpcSymbolType
} from './types'

export {
  FLOW_CONNECTION_TYPES,
  FLOW_NODE_TYPES,
  OT_EVT,
  OT_FUNC,
  OT_RULE,
  SATELLITE_OBJECT_TYPES,
  classifyRuleSymbol,
  type EpcRuleKind
} from './constants'

export {
  type FlowGraphIndex,
  buildFlowGraphIndex,
  connectedComponents,
  isControlFlowEdge,
  isOnCycle,
  sccMembership,
  stronglyConnectedComponents,
  upstreamDistances
} from './flowGraph'

export {
  checkAlternation,
  checkConnectedComponentIntegrity,
  checkEventPrecedesDecisionSplit,
  checkLinkedModelAssignments,
  checkRuleSplitMergeConflict,
  checkRuleSymbolRecognized,
  checkStartEndCompleteness,
  checkTypedConnections,
  validateEpcGraph,
  type ValidateEpcOptions
} from './validate'

export {
  classifyRule,
  classifyRules,
  isAndRule,
  isMerge,
  isOrRule,
  isSplit,
  isXorRule,
  type RuleClassification,
  type RuleFlowRole
} from './xor'

export { normalizeArabic } from './arabicNormalize'

export {
  findReturnOutcomeMatches,
  isReturnOutcomeName,
  type ReturnOutcomeConcept,
  type ReturnTermMatch
} from './returnTerms'

export {
  buildReturnPathApplyPayload,
  detectReturnPathOutcomes,
  rankCandidates,
  type BuildReturnPathApplyPayloadParams,
  type ExplicitReturnRoute,
  type MissingReturnRoute,
  type ReturnPathApplyPayload,
  type ReturnPathAuditEntry,
  type ReturnPathCandidate,
  type ReturnPathCandidateReason,
  type ReturnPathConnectionDefinitionPayload,
  type ReturnPathConnectionOccurrencePayload,
  type ReturnRouteResult
} from './returnPath'

export {
  type EpcAdapterConnectionDefinition,
  type EpcAdapterConnectionOccurrence,
  type EpcAdapterLocalizedValue,
  type EpcAdapterModel,
  type EpcAdapterObjectDefinition,
  type EpcAdapterObjectOccurrence,
  toEpcGraph
} from './adapter'
