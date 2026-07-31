/**
 * Deterministic gap scanner — plan section 18.1.
 *
 * Scans an `ArisChatWorkingDocument` for every one of the fifteen gap kinds the plan lists, with
 * no AI and no network. Every gap is structured data (`ArisChatGap`): a kind, a severity, the
 * target ids it applies to, and an i18n message key (never prose — see the module doc in
 * `src/aris/epc/types.ts` for the same convention, which this module follows and, where
 * possible, reuses keys from directly).
 *
 * ## Determinism
 *
 * `scanArisChatGaps` always returns the same gap list, in the same order, for the same document
 * and config. Checks run in the fixed order the plan lists them (18.1, bullet order), and within
 * each check every finding is sorted by its primary target id before being appended — so the
 * result does not depend on `Map` iteration order or object property order.
 *
 * ## What is consumed from `src/aris/epc` vs implemented locally
 *
 * `src/aris/epc/validate.ts` (`validateEpcGraph`) already implements: start/end-event
 * completeness, event/function/rule alternation, rule split/merge conflicts, event-precedes-
 * decision violations, unrecognized rule symbols, orphan/disconnected nodes, untyped
 * connections, and dangling linked-model references. This module consumes all of those through
 * the sanctioned `toEpcGraph` adapter seam and re-exposes their findings as gaps, reusing their
 * `messageKey`s verbatim rather than re-registering new ones. `src/aris/epc/returnPath.ts`
 * (`detectReturnPathOutcomes`) is consumed the same way for "missing return target".
 *
 * Everything else — missing English/Arabic name, missing process code, missing
 * owner/responsibility, missing inputs/outputs/systems, missing decision basis, missing XOR
 * outcomes, missing linked model (the "should have one and doesn't" case, as opposed to the
 * epc-covered "has one but it's dangling" case), missing attachment, unused definition, and
 * unaccounted source content — has no equivalent in `src/aris/epc` and is implemented locally
 * below, all against structural document fields and a caller-overridable `ArisGapScanConfig`
 * (the exact ARIS attribute-type/connection-type vocabulary — e.g. `AT_PROC_CODE`,
 * `AT_PERS_RESP` — is a deployment convention, not a hardcoded assumption).
 *
 * ## Model-type scope (DMT)
 *
 * Checks that encode EPC control-flow semantics — the consumed `validateEpcGraph` findings,
 * missing inputs/outputs/systems, decision basis, XOR outcomes, and return targets — run
 * only on EPC models (`MT_EEPC`), matching the scope `buildArisEpcFindings` already enforces
 * and the DMT convention manual, which documents events, rules, IO/system satellites, and
 * the R/A/C/I executor wiring as EPC (level-4) concepts only. A value-added chain diagram
 * has no events and no satellites by design, so applying these checks to one manufactures
 * findings that are not defects (the AnimalWF VACD alone produced 2 missing-start/end
 * errors, 13 orphan warnings, and 14 missing-IO warnings before this scoping). A model
 * whose `type` is absent (the reduced chat shape makes it optional) is treated as unknown
 * and is still fully checked — only a positively non-EPC type exempts it.
 *
 * ## Deployment vocabulary and advisory severities (DMT)
 *
 * `missingProcessCode` and `missingOwner` are gated on the configured attribute type being
 * in use on at least one `OT_FUNC` definition in the document. The DMT convention defines
 * no process-code or owner ATTRIBUTE on functions — ownership is the RACI executor
 * connection (already covered by `conv.function.noExecutor`) and the function's mandatory
 * code is its Identifier `AT_ID` (covered by `conv.function.missingIdentifier`) — so on a
 * DMT document these checks would flag every function (92+92 false errors on AnimalWF).
 * Where a deployment does use the vocabulary, the checks stay live and flag the functions
 * missing it. Both are warnings: the DMT schema marks these attributes optional, and even
 * the mandatory `AT_ID` is only a warning. Missing English/Arabic names are likewise
 * warnings — the manual's naming guidance is advisory and mandates no bilingual name —
 * while structural violations (dangling references, untyped connections, EPC start/end and
 * alternation findings) remain errors.
 */

import { OT_FUNC, OT_RULE } from '../epc/constants'
import { toEpcGraph, type EpcAdapterModel } from '../epc/adapter'
import { buildFlowGraphIndex } from '../epc/flowGraph'
import { detectReturnPathOutcomes } from '../epc/returnPath'
import type { EpcGraph } from '../epc/types'
import { validateEpcGraph } from '../epc/validate'
import { classifyRule } from '../epc/xor'
import {
  DEFAULT_ARABIC_LOCALE_IDS,
  DEFAULT_ENGLISH_LOCALE_IDS,
  hasArabicName,
  hasEnglishName
} from './locale'
import type { ArisChatModel, ArisChatSeverity, ArisChatWorkingDocument } from './types'

export type ArisChatGapKind =
  | 'missingEnglishName'
  | 'missingArabicName'
  | 'missingProcessCode'
  | 'missingOwner'
  | 'missingInputsOutputsSystems'
  | 'missingDecisionBasis'
  | 'missingXorOutcomes'
  | 'missingReturnTarget'
  | 'missingStartOrEndEvent'
  | 'invalidSequence'
  | 'danglingObjectOrConnection'
  | 'missingLinkedModel'
  | 'missingAttachment'
  | 'unusedDefinition'
  | 'unaccountedSourceContent'

/** The fixed check order, matching plan 18.1's bullet order exactly. */
export const ARIS_CHAT_GAP_KIND_ORDER: readonly ArisChatGapKind[] = Object.freeze([
  'missingEnglishName',
  'missingArabicName',
  'missingProcessCode',
  'missingOwner',
  'missingInputsOutputsSystems',
  'missingDecisionBasis',
  'missingXorOutcomes',
  'missingReturnTarget',
  'missingStartOrEndEvent',
  'invalidSequence',
  'danglingObjectOrConnection',
  'missingLinkedModel',
  'missingAttachment',
  'unusedDefinition',
  'unaccountedSourceContent'
])

export interface ArisChatGap {
  readonly kind: ArisChatGapKind
  readonly severity: ArisChatSeverity
  readonly targetIds: readonly string[]
  readonly messageKey: string
  readonly messageParams?: Readonly<Record<string, string>>
}

export interface ArisGapScanConfig {
  readonly englishLocaleIds: ReadonlySet<string>
  readonly arabicLocaleIds: ReadonlySet<string>
  readonly processCodeAttributeType: string
  readonly ownerAttributeType: string
  readonly decisionBasisAttributeType: string
  /** Connection types treated as an input/output/system relation for an `OT_FUNC` occurrence. */
  readonly ioConnectionTypes: ReadonlySet<string>
  /** Connection types treated as evidence of an XOR/OR rule's decision basis. */
  readonly decisionBasisConnectionTypes: ReadonlySet<string>
  /**
   * Object-definition types that are expected to carry at least one `linkedModelIds` entry
   * (e.g. a process-interface function). Empty by default — deployments must opt in, since
   * "should have a linked model" is a modeling convention, not a universal ARIS rule.
   */
  readonly processInterfaceObjectTypes: ReadonlySet<string>
  /** Object-definition types that are expected to carry at least one attachment. */
  readonly requiredAttachmentObjectTypes: ReadonlySet<string>
}

export const DEFAULT_GAP_SCAN_CONFIG: ArisGapScanConfig = Object.freeze({
  englishLocaleIds: DEFAULT_ENGLISH_LOCALE_IDS,
  arabicLocaleIds: DEFAULT_ARABIC_LOCALE_IDS,
  processCodeAttributeType: 'AT_PROC_CODE',
  ownerAttributeType: 'AT_PERS_RESP',
  decisionBasisAttributeType: 'AT_DESC',
  ioConnectionTypes: Object.freeze(
    new Set(['CT_IS_INP_FOR', 'CT_HAS_OUT', 'CT_SUPP_3', 'CT_CRT_OUT_TO'])
  ),
  decisionBasisConnectionTypes: Object.freeze(new Set(['CT_IS_EVAL_BY_1', 'CT_REFS_TO_2'])),
  processInterfaceObjectTypes: Object.freeze(new Set<string>()),
  requiredAttachmentObjectTypes: Object.freeze(new Set<string>())
}) satisfies ArisGapScanConfig

function compareIds(a: readonly string[], b: readonly string[]): number {
  const left = a[0] ?? ''
  const right = b[0] ?? ''
  return left < right ? -1 : left > right ? 1 : 0
}

function sortedGaps(gaps: readonly ArisChatGap[]): readonly ArisChatGap[] {
  return [...gaps].sort((a, b) => compareIds(a.targetIds, b.targetIds))
}

function hasAttributeText(
  attributes: readonly {
    readonly type: string
    readonly values: readonly { readonly text: string }[]
  }[],
  attributeType: string
): boolean {
  const attribute = attributes.find((candidate) => candidate.type === attributeType)
  if (!attribute) return false
  return attribute.values.some((value) => value.text.trim().length > 0)
}

/** Builds the `EpcGraph` for one model — the single seam into `src/aris/epc`. */
export function toChatEpcGraph(document: ArisChatWorkingDocument, modelId: string): EpcGraph {
  const model = document.models.get(modelId)
  if (!model) return { modelId, nodes: [], edges: [] }
  const adapterInput: EpcAdapterModel = {
    modelId,
    objectOccurrences: model.occurrences,
    objectDefinitionById: document.objectDefinitions,
    connectionOccurrences: model.connectionOccurrences,
    connectionDefinitionById: document.connectionDefinitions
  }
  return toEpcGraph(adapterInput)
}

/**
 * The EPC model type the EPC-semantics checks apply to (mirrors `EPC_MODEL_TYPE` in
 * `../shell/arisEpcFindings`; declared locally because this module deliberately consumes
 * only the narrow chat document shape).
 */
const EPC_MODEL_TYPE = 'MT_EEPC'

/**
 * `true` when `model` is an EPC — or when its type is unknown (the reduced chat shape makes
 * `type` optional). Unknown must NOT exempt a model: suppressing checks on un-typed
 * synthetic documents would hide real findings, so only a positively non-EPC type
 * (e.g. `MT_VAL_ADD_CHN_DGM`) is exempt.
 */
function isEpcModel(model: ArisChatModel): boolean {
  return model.type === undefined || model.type === EPC_MODEL_TYPE
}

/**
 * Deployment-vocabulary gate for the optional-attribute checks (`missingProcessCode`,
 * `missingOwner`): `true` when at least one `OT_FUNC` definition carries a non-blank value
 * for `attributeType`, i.e. the document's deployment actually uses that convention. See
 * the module doc for why the checks go silent otherwise.
 */
function isFuncAttributeVocabularyInUse(
  document: ArisChatWorkingDocument,
  attributeType: string
): boolean {
  for (const definition of document.objectDefinitions.values()) {
    if (definition.type !== OT_FUNC) continue
    if (hasAttributeText(definition.attributes, attributeType)) return true
  }
  return false
}

// --- 1/2: missing English/Arabic name ---------------------------------------------------

/**
 * Name checks apply to models and named objects (functions, events, satellites), but NOT to
 * `OT_RULE` (XOR/AND/OR connector) definitions or to connection definitions — by ARIS
 * convention, rule connectors and control-flow connections are routinely left unnamed (their
 * meaning comes from the symbol/type, not free text), so requiring a name there would flag
 * well-formed models as incomplete. A connection OCCURRENCE'S own label (e.g. an XOR branch
 * outcome) is a different concern, covered by `checkMissingXorOutcomes`.
 *
 * Severity is advisory (`warning`), not an error: the DMT convention manual mandates no
 * bilingual name and its naming guidance is preferential, so a missing translation is a
 * completeness hint for the fix flow, never a structural violation.
 */
function checkMissingNames(
  document: ArisChatWorkingDocument,
  config: ArisGapScanConfig,
  kind: 'missingEnglishName' | 'missingArabicName'
): readonly ArisChatGap[] {
  const check = kind === 'missingEnglishName' ? hasEnglishName : hasArabicName
  const localeIds = kind === 'missingEnglishName' ? config.englishLocaleIds : config.arabicLocaleIds
  const messageKey =
    kind === 'missingEnglishName'
      ? 'aris.chat.gap.missingEnglishName'
      : 'aris.chat.gap.missingArabicName'
  const gaps: ArisChatGap[] = []

  for (const model of document.models.values()) {
    if (!check(model.names, localeIds)) {
      gaps.push({ kind, severity: 'warning', targetIds: [model.id], messageKey })
    }
  }
  for (const definition of document.objectDefinitions.values()) {
    if (definition.type === OT_RULE) continue
    if (!check(definition.names, localeIds)) {
      gaps.push({ kind, severity: 'warning', targetIds: [definition.id], messageKey })
    }
  }
  return sortedGaps(gaps)
}

// --- 3: missing process code -------------------------------------------------------------

/**
 * Fires only when the configured attribute type is in use on at least one `OT_FUNC`
 * definition (`isFuncAttributeVocabularyInUse`) — the DMT convention defines no
 * process-code attribute on functions (the mandatory code is the Identifier `AT_ID`),
 * so an un-gated check flags every function in a DMT document. Severity is a warning:
 * the attribute is optional in the DMT schema even where the vocabulary is live.
 */
function checkMissingProcessCode(
  document: ArisChatWorkingDocument,
  config: ArisGapScanConfig
): readonly ArisChatGap[] {
  if (!isFuncAttributeVocabularyInUse(document, config.processCodeAttributeType)) return []
  const gaps: ArisChatGap[] = []
  for (const definition of document.objectDefinitions.values()) {
    if (definition.type !== OT_FUNC) continue
    if (!hasAttributeText(definition.attributes, config.processCodeAttributeType)) {
      gaps.push({
        kind: 'missingProcessCode',
        severity: 'warning',
        targetIds: [definition.id],
        messageKey: 'aris.chat.gap.missingProcessCode'
      })
    }
  }
  return sortedGaps(gaps)
}

// --- 4: missing owner/responsibility ------------------------------------------------------

/**
 * Same deployment-vocabulary gate and advisory severity as `checkMissingProcessCode`. In
 * the DMT convention a function's responsible party is the RACI `R` executor CONNECTION
 * (checked by `conv.function.noExecutor`), not an attribute — `AT_PERS_RESP` exists only
 * as an optional EPC MODEL attribute.
 */
function checkMissingOwner(
  document: ArisChatWorkingDocument,
  config: ArisGapScanConfig
): readonly ArisChatGap[] {
  if (!isFuncAttributeVocabularyInUse(document, config.ownerAttributeType)) return []
  const gaps: ArisChatGap[] = []
  for (const definition of document.objectDefinitions.values()) {
    if (definition.type !== OT_FUNC) continue
    if (!hasAttributeText(definition.attributes, config.ownerAttributeType)) {
      gaps.push({
        kind: 'missingOwner',
        severity: 'warning',
        targetIds: [definition.id],
        messageKey: 'aris.chat.gap.missingOwner'
      })
    }
  }
  return sortedGaps(gaps)
}

// --- 5: missing inputs/outputs/systems -----------------------------------------------------

/**
 * EPC-scoped: input/output/system satellites are EPC (level-4) wiring in the DMT
 * convention; a value-added chain element never carries them, so non-EPC models are
 * exempt (the AnimalWF VACD otherwise flags all 14 of its chain elements).
 */
function checkMissingInputsOutputsSystems(
  document: ArisChatWorkingDocument,
  config: ArisGapScanConfig
): readonly ArisChatGap[] {
  const gaps: ArisChatGap[] = []
  for (const model of document.models.values()) {
    if (!isEpcModel(model)) continue
    const functionOccurrences = model.occurrences.filter((occurrence) => {
      const definition = document.objectDefinitions.get(occurrence.definitionId)
      return definition?.type === OT_FUNC
    })
    if (functionOccurrences.length === 0) continue

    const hasIo = new Map<string, boolean>()
    for (const occurrence of functionOccurrences) hasIo.set(occurrence.id, false)
    for (const connection of model.connectionOccurrences) {
      const definition = document.connectionDefinitions.get(connection.definitionId)
      if (!definition || !config.ioConnectionTypes.has(definition.type)) continue
      if (hasIo.has(connection.sourceOccurrenceId)) hasIo.set(connection.sourceOccurrenceId, true)
      if (hasIo.has(connection.targetOccurrenceId)) hasIo.set(connection.targetOccurrenceId, true)
    }

    for (const occurrence of functionOccurrences) {
      if (!hasIo.get(occurrence.id)) {
        gaps.push({
          kind: 'missingInputsOutputsSystems',
          severity: 'warning',
          targetIds: [occurrence.id],
          messageKey: 'aris.chat.gap.missingInputsOutputsSystems'
        })
      }
    }
  }
  return sortedGaps(gaps)
}

// --- 6: missing decision basis -------------------------------------------------------------

/**
 * EPC-scoped: a decision basis qualifies an EPC rule (connector) split; rules are an EPC
 * construct, so non-EPC models are exempt.
 */
function checkMissingDecisionBasis(
  document: ArisChatWorkingDocument,
  config: ArisGapScanConfig
): readonly ArisChatGap[] {
  const gaps: ArisChatGap[] = []
  for (const [modelId, model] of document.models) {
    if (!isEpcModel(model)) continue
    const graph = toChatEpcGraph(document, modelId)
    const index = buildFlowGraphIndex(graph)
    for (const node of graph.nodes) {
      if (node.objectType !== OT_RULE) continue
      const classification = classifyRule(index, node.id)
      if (classification.role !== 'split' && classification.role !== 'both') continue

      const occurrence = model.occurrences.find((candidate) => candidate.id === node.id)
      const definition = occurrence
        ? document.objectDefinitions.get(occurrence.definitionId)
        : undefined
      const hasAttributeBasis = definition
        ? hasAttributeText(definition.attributes, config.decisionBasisAttributeType)
        : false

      const hasConnectionBasis = model.connectionOccurrences.some((connection) => {
        if (connection.sourceOccurrenceId !== node.id && connection.targetOccurrenceId !== node.id)
          return false
        const connectionDefinition = document.connectionDefinitions.get(connection.definitionId)
        return (
          !!connectionDefinition &&
          config.decisionBasisConnectionTypes.has(connectionDefinition.type)
        )
      })

      if (!hasAttributeBasis && !hasConnectionBasis) {
        gaps.push({
          kind: 'missingDecisionBasis',
          severity: 'warning',
          targetIds: [node.id],
          messageKey: 'aris.chat.gap.missingDecisionBasis'
        })
      }
    }
  }
  return sortedGaps(gaps)
}

// --- 7: missing XOR outcomes -----------------------------------------------------------------

/**
 * EPC-scoped: XOR/OR branch outcomes are labels on an EPC rule's outgoing control-flow
 * edges; rules are an EPC construct, so non-EPC models are exempt.
 */
function checkMissingXorOutcomes(document: ArisChatWorkingDocument): readonly ArisChatGap[] {
  const gaps: ArisChatGap[] = []
  for (const [modelId, model] of document.models) {
    if (!isEpcModel(model)) continue
    const graph = toChatEpcGraph(document, modelId)
    const index = buildFlowGraphIndex(graph)
    for (const node of graph.nodes) {
      if (node.objectType !== OT_RULE) continue
      const classification = classifyRule(index, node.id)
      if (classification.role !== 'split' && classification.role !== 'both') continue
      if (classification.outgoingEdgeIds.length < 2) continue

      const outgoingEdges = graph.edges.filter((edge) =>
        classification.outgoingEdgeIds.includes(edge.id)
      )
      const labels = outgoingEdges.map((edge) =>
        edge.names ? (Object.values(edge.names).find((text) => text.trim().length > 0) ?? '') : ''
      )
      const hasUnlabeled = labels.some((label) => label.trim().length === 0)
      const hasDuplicate =
        new Set(labels.filter((label) => label.trim().length > 0)).size <
        labels.filter((label) => label.trim().length > 0).length

      if (hasUnlabeled || hasDuplicate) {
        gaps.push({
          kind: 'missingXorOutcomes',
          severity: 'warning',
          targetIds: [node.id, ...outgoingEdges.map((edge) => edge.id)],
          messageKey: 'aris.chat.gap.missingXorOutcomes'
        })
      }
    }
  }
  return sortedGaps(gaps)
}

// --- 8: missing return target -----------------------------------------------------------------

/**
 * EPC-scoped: a return path leads a reject/return-worded EPC outcome back into the control
 * flow; non-EPC models are exempt.
 */
function checkMissingReturnTarget(document: ArisChatWorkingDocument): readonly ArisChatGap[] {
  const gaps: ArisChatGap[] = []
  for (const [modelId, model] of document.models) {
    if (!isEpcModel(model)) continue
    const graph = toChatEpcGraph(document, modelId)
    const results = detectReturnPathOutcomes(graph)
    for (const result of results) {
      if (result.status !== 'missing') continue
      gaps.push({
        kind: 'missingReturnTarget',
        severity: 'warning',
        targetIds: [result.outcomeNodeId],
        messageKey: result.requiresManualSelection
          ? 'aris.chat.gap.missingReturnTarget.ambiguous'
          : 'aris.chat.gap.missingReturnTarget'
      })
    }
  }
  return sortedGaps(gaps)
}

// --- 9-11: consumed from src/aris/epc/validate.ts -----------------------------------------

const START_END_RULE_IDS = new Set(['epc.startEnd.missingStart', 'epc.startEnd.missingEnd'])
const INVALID_SEQUENCE_RULE_IDS = new Set([
  'epc.alternation',
  'epc.rule.splitMergeConflict',
  'epc.event.decisionViolation',
  'epc.rule.unrecognizedSymbol'
])
const DANGLING_RULE_IDS = new Set([
  'epc.connectivity.orphanNode',
  'epc.connection.missingType',
  'epc.linkedModel.danglingReference'
])

function checkEpcFindings(
  document: ArisChatWorkingDocument,
  kind: ArisChatGapKind,
  ruleIds: ReadonlySet<string>
): readonly ArisChatGap[] {
  const gaps: ArisChatGap[] = []
  const knownModelIds = new Set(document.models.keys())
  for (const [modelId, model] of document.models) {
    // The §14.1 rule table describes event-driven process chains; applying it to a
    // value-added chain diagram manufactures findings that are not defects (the AnimalWF
    // VACD produced 2 missing-start/end errors and 13 orphan warnings this way) — the
    // same scope `buildArisEpcFindings` already enforces.
    if (!isEpcModel(model)) continue
    const graph = toChatEpcGraph(document, modelId)
    const findings = validateEpcGraph(graph, { knownModelIds })
    for (const finding of findings) {
      if (!ruleIds.has(finding.ruleId)) continue
      gaps.push({
        kind,
        severity: finding.severity,
        targetIds: finding.nodeIds.length > 0 ? finding.nodeIds : finding.edgeIds,
        messageKey: finding.messageKey,
        messageParams: finding.messageParams
      })
    }
  }
  return sortedGaps(gaps)
}

// --- 11 (local half): dangling occurrence/connection references ---------------------------

function checkLocalDanglingReferences(document: ArisChatWorkingDocument): readonly ArisChatGap[] {
  const gaps: ArisChatGap[] = []
  for (const model of document.models.values()) {
    for (const occurrence of model.occurrences) {
      if (!document.objectDefinitions.has(occurrence.definitionId)) {
        gaps.push({
          kind: 'danglingObjectOrConnection',
          severity: 'error',
          targetIds: [occurrence.id],
          messageKey: 'aris.chat.gap.dangling.occurrenceDefinition'
        })
      }
    }
    for (const connection of model.connectionOccurrences) {
      const missingDefinition = !document.connectionDefinitions.has(connection.definitionId)
      const missingSource = !model.occurrences.some(
        (occurrence) => occurrence.id === connection.sourceOccurrenceId
      )
      const missingTarget = !model.occurrences.some(
        (occurrence) => occurrence.id === connection.targetOccurrenceId
      )
      if (missingDefinition || missingSource || missingTarget) {
        gaps.push({
          kind: 'danglingObjectOrConnection',
          severity: 'error',
          targetIds: [connection.id],
          messageKey: 'aris.chat.gap.dangling.connectionEndpoint'
        })
      }
    }
  }
  return sortedGaps(gaps)
}

// --- 12: missing linked model (expected but absent) ----------------------------------------

function checkMissingLinkedModel(
  document: ArisChatWorkingDocument,
  config: ArisGapScanConfig
): readonly ArisChatGap[] {
  if (config.processInterfaceObjectTypes.size === 0) return []
  const gaps: ArisChatGap[] = []
  for (const definition of document.objectDefinitions.values()) {
    if (!config.processInterfaceObjectTypes.has(definition.type)) continue
    if (definition.linkedModelIds.length === 0) {
      gaps.push({
        kind: 'missingLinkedModel',
        severity: 'warning',
        targetIds: [definition.id],
        messageKey: 'aris.chat.gap.missingLinkedModel'
      })
    }
  }
  return sortedGaps(gaps)
}

// --- 13: missing attachment ------------------------------------------------------------------

function checkMissingAttachment(
  document: ArisChatWorkingDocument,
  config: ArisGapScanConfig
): readonly ArisChatGap[] {
  if (config.requiredAttachmentObjectTypes.size === 0) return []
  const gaps: ArisChatGap[] = []
  const attachmentsByOwner = new Map<string, number>()
  for (const attachment of document.attachments?.values() ?? []) {
    attachmentsByOwner.set(
      attachment.ownerId,
      (attachmentsByOwner.get(attachment.ownerId) ?? 0) + 1
    )
  }
  for (const definition of document.objectDefinitions.values()) {
    if (!config.requiredAttachmentObjectTypes.has(definition.type)) continue
    if (!attachmentsByOwner.get(definition.id)) {
      gaps.push({
        kind: 'missingAttachment',
        severity: 'warning',
        targetIds: [definition.id],
        messageKey: 'aris.chat.gap.missingAttachment'
      })
    }
  }
  return sortedGaps(gaps)
}

// --- 14: unused definition --------------------------------------------------------------------

function checkUnusedDefinition(document: ArisChatWorkingDocument): readonly ArisChatGap[] {
  const usedObjectDefinitionIds = new Set<string>()
  const usedConnectionDefinitionIds = new Set<string>()
  for (const model of document.models.values()) {
    for (const occurrence of model.occurrences) usedObjectDefinitionIds.add(occurrence.definitionId)
    for (const connection of model.connectionOccurrences)
      usedConnectionDefinitionIds.add(connection.definitionId)
  }

  const gaps: ArisChatGap[] = []
  for (const definition of document.objectDefinitions.values()) {
    if (!usedObjectDefinitionIds.has(definition.id)) {
      gaps.push({
        kind: 'unusedDefinition',
        severity: 'warning',
        targetIds: [definition.id],
        messageKey: 'aris.chat.gap.unusedDefinition'
      })
    }
  }
  for (const definition of document.connectionDefinitions.values()) {
    if (!usedConnectionDefinitionIds.has(definition.id)) {
      gaps.push({
        kind: 'unusedDefinition',
        severity: 'warning',
        targetIds: [definition.id],
        messageKey: 'aris.chat.gap.unusedDefinition'
      })
    }
  }
  return sortedGaps(gaps)
}

// --- 15: unaccounted source content -------------------------------------------------------

function checkUnaccountedSourceContent(document: ArisChatWorkingDocument): readonly ArisChatGap[] {
  const ids = document.unaccountedSourceIds
  if (!ids || ids.length === 0) return []
  return [
    {
      kind: 'unaccountedSourceContent',
      severity: 'warning',
      targetIds: [...ids].sort(),
      messageKey: 'aris.chat.gap.unaccountedSourceContent'
    }
  ]
}

/**
 * Scans `document` for every gap kind in plan 18.1. Deterministic: the same document and config
 * always produce the same gap list, in the same order (see module doc).
 */
export function scanArisChatGaps(
  document: ArisChatWorkingDocument,
  config: ArisGapScanConfig = DEFAULT_GAP_SCAN_CONFIG
): readonly ArisChatGap[] {
  return [
    ...checkMissingNames(document, config, 'missingEnglishName'),
    ...checkMissingNames(document, config, 'missingArabicName'),
    ...checkMissingProcessCode(document, config),
    ...checkMissingOwner(document, config),
    ...checkMissingInputsOutputsSystems(document, config),
    ...checkMissingDecisionBasis(document, config),
    ...checkMissingXorOutcomes(document),
    ...checkMissingReturnTarget(document),
    ...checkEpcFindings(document, 'missingStartOrEndEvent', START_END_RULE_IDS),
    ...checkEpcFindings(document, 'invalidSequence', INVALID_SEQUENCE_RULE_IDS),
    ...sortedGaps([
      ...checkEpcFindings(document, 'danglingObjectOrConnection', DANGLING_RULE_IDS),
      ...checkLocalDanglingReferences(document)
    ]),
    ...checkMissingLinkedModel(document, config),
    ...checkMissingAttachment(document, config),
    ...checkUnusedDefinition(document),
    ...checkUnaccountedSourceContent(document)
  ]
}

export {
  checkMissingNames,
  checkMissingProcessCode,
  checkMissingOwner,
  checkMissingInputsOutputsSystems,
  checkMissingDecisionBasis,
  checkMissingXorOutcomes,
  checkMissingReturnTarget,
  checkEpcFindings,
  checkLocalDanglingReferences,
  checkMissingLinkedModel,
  checkMissingAttachment,
  checkUnusedDefinition,
  checkUnaccountedSourceContent
}
