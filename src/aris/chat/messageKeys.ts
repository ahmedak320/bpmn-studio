/**
 * The complete list of i18n message keys this module emits (never hardcoded English strings —
 * see the module doc in `src/aris/epc/types.ts` for the same convention). None of these are
 * registered in `src/i18n/dictionaries.ts` yet: this lane must not touch that file (it belongs
 * to a different wave), so, like `src/aris/epc`, the keys are defined here and used as lookup
 * keys in structured data, ready for a translation wave to register.
 *
 * Two groups:
 *  - `ARIS_CHAT_OWN_MESSAGE_KEYS` — keys this module mints itself (gap kinds with no equivalent
 *    already covered by `src/aris/epc`).
 *  - `ARIS_CHAT_REUSED_EPC_MESSAGE_KEYS` — keys `gapScanner.ts` re-emits verbatim from
 *    `src/aris/epc/validate.ts` findings (start/end completeness, alternation, split/merge
 *    conflicts, event-precedes-decision, unrecognized rule symbols, orphan nodes, untyped
 *    connections, dangling linked-model references) rather than minting duplicates.
 */

export const ARIS_CHAT_OWN_MESSAGE_KEYS = Object.freeze([
  'aris.chat.gap.missingEnglishName',
  'aris.chat.gap.missingArabicName',
  'aris.chat.gap.missingProcessCode',
  'aris.chat.gap.missingOwner',
  'aris.chat.gap.missingInputsOutputsSystems',
  'aris.chat.gap.missingDecisionBasis',
  'aris.chat.gap.missingXorOutcomes',
  'aris.chat.gap.missingReturnTarget',
  'aris.chat.gap.missingReturnTarget.ambiguous',
  'aris.chat.gap.dangling.occurrenceDefinition',
  'aris.chat.gap.dangling.connectionEndpoint',
  'aris.chat.gap.missingLinkedModel',
  'aris.chat.gap.missingAttachment',
  'aris.chat.gap.unusedDefinition',
  'aris.chat.gap.unaccountedSourceContent'
] as const)

export const ARIS_CHAT_REUSED_EPC_MESSAGE_KEYS = Object.freeze([
  'aris.epc.finding.missingStartEvent',
  'aris.epc.finding.missingEndEvent',
  'aris.epc.finding.alternationViolation',
  'aris.epc.finding.ruleSplitMergeConflict',
  'aris.epc.finding.eventPrecedesDecisionSplit',
  'aris.epc.finding.unrecognizedRuleSymbol',
  'aris.epc.finding.orphanNode',
  'aris.epc.finding.missingConnectionType',
  'aris.epc.finding.danglingLinkedModel'
] as const)

export type ArisChatOwnMessageKey = (typeof ARIS_CHAT_OWN_MESSAGE_KEYS)[number]
export type ArisChatReusedEpcMessageKey = (typeof ARIS_CHAT_REUSED_EPC_MESSAGE_KEYS)[number]
