/**
 * Fuzzy structure-fidelity comparator for AI/Excel-generated ARIS documents
 * (Wave 13, lane P11-runner).
 *
 * Unlike `compare.ts` (exact/near-exact structural equality against a
 * hand-authored expectation, used by the AnimalWF characterization suite),
 * this comparator scores an IMPERFECT, freshly-generated `ArisWorkingDocument`
 * — e.g. the output of `buildAmlFromArisAiDraft` or `buildAmlFromArisWorkbook`
 * — against the SAME `FidelityExpectationDoc` oracle shape (`spine` /
 * `satellites` / `gates` / `counts`, see `expectationTypes.ts`), tolerating
 * renamed/reworded labels, omitted content, and reordered/absent geometry.
 *
 * ## Matching
 * Objects are matched GREEDILY: candidate pairs are formed within the same
 * "objectType family" — control-flow objects use the 3-way function/event/rule
 * kind; satellites use the exact `objectType`, since a system is never
 * interchangeable with a person or a document — and scored by
 * normalized-label similarity (the larger of character-trigram Dice and token
 * containment), which must be >= `SIMILARITY_THRESHOLD` (0.55) to be a
 * candidate at all. Generated and expected English/Arabic readings are
 * compared in every non-empty pairing and the larger score wins. Candidates are sorted by
 * similarity descending and assigned greedily, highest similarity first, each
 * side consumed at most once. Rule labels do not participate: after the label
 * pass, rules are matched 1:1 by operator and their position on the two-hop
 * path between already-matched neighbouring flow objects.
 *
 * ## Reconstructing "expected connections" from a DFS-flattened oracle
 * `FidelityExpectationDoc` has no explicit edge list — `spine` is a geometric
 * depth-first PREORDER over the real control-flow graph (see `compare.ts`'s
 * `buildSpine`), and `gates` separately names each decision rule's predecessor
 * and the first node of every branch. Two facts follow:
 *
 *  - Consecutive non-rule `spine` entries are a TRUE direct or rule-mediated
 *    connection almost everywhere EXCEPT at a
 *    decision's second-and-later branch: DFS finishes branch 1's entire
 *    subtree before resuming branch 2, so branch 2's head sits next to branch
 *    1's LAST node in the flat array — an accidental adjacency, not a real
 *    connection. `deriveExpectedConnections` drops exactly that: an adjacency
 *    pair is excluded when its second element is a KNOWN branch head (appears
 *    in some gate's `branchFirstNamesEn`) other than that gate's OWN
 *    first-listed branch.
 *  - A gate's `(afterNameEn, branchName)` pair is a TWO-HOP fact in the real
 *    graph (`afterName -> the anonymous rule -> branchName`) — the rule node
 *    itself has no stable identity in the oracle, so it can never be named
 *    directly. Every reconstructed pair (both the adjacency-derived and the
 *    gate-derived ones) is therefore verified against the GENERATED graph
 *    through `reachesWithinTwoHops`: a direct edge, OR a path through exactly
 *    one intermediate node. A genuinely one-hop expected pair still passes
 *    this check (one hop is a special case of "at most two"), so the
 *    relaxation only ever makes the recall check MORE lenient than a naive
 *    direct-edge lookup, never less correct for adjacent pairs.
 *
 * `connectionPrecision` reuses the exact sub-edges consumed by every
 * successful two-hop match (both the `after -> rule` and `rule -> branch`
 * hop) as "explained", so a correctly-generated split contributes full
 * precision even though no single expected pair names the rule directly.
 *
 * ## Geometry is excluded
 * The generated document lays out objects in one deterministic column
 * (`buildAmlFromArisAiDraft` / `buildAmlFromArisWorkbook`); this comparator
 * never reads `bounds` / `route` — only object identity (type + label) and
 * connection topology.
 *
 * ## `relativeRecall` (the facts manifest)
 * A full-document recall score is unfair to a short "brief" description that
 * never mentioned most satellites. When a `StructureFactsManifest` is
 * supplied (a human-authored `{objects, connections}` list of what the SOURCE
 * text actually said), `relativeRecall` recomputes recall restricted to the
 * subset of expected objects/connections whose name fuzzy-matches something
 * the manifest mentions — reusing the SAME match results already computed for
 * the full-document metrics above, just filtered down.
 */

import type { ArisWorkingDocument } from '../model/types'
import { ARIS_CONTENT_LOCALE_IDS, readLocalized } from '../canvas/localization'
import { FLOW_NODE_TYPES, OT_FUNC, classifyRuleSymbol } from '../epc/constants'
import type {
  FidelityExpectationDoc,
  GateExpectation,
  SatelliteExpectation
} from './expectationTypes'

// --- public types ------------------------------------------------------------

/**
 * A human-authored subset of `expected` that ONE description/workbook actually
 * mentions — powers `relativeRecall` (recall relative to what the SOURCE said,
 * fair to a "brief" 3-6 sentence description that never mentions most
 * satellites, rather than the full oracle). `objects` are object names (or
 * fuzzy-matchable fragments); `connections` are `[fromName, toName]` pairs,
 * matched in either order.
 */
export interface StructureFactsManifest {
  readonly objects: readonly string[]
  readonly connections: readonly (readonly [string, string])[]
}

/** Verbatim per the implementation plan (Wave 13, lane P11-runner), lines 752-764. */
export interface StructureScore {
  controlFlowRecall: number
  controlFlowPrecision: number // OT_FUNC | OT_EVT | OT_RULE
  connectionRecall: number
  connectionPrecision: number
  satelliteRecall: number
  gatewayAccuracy: number
  labelSimilarityMean: number
  relativeRecall?: number // vs the facts-manifest subset when provided
  misses: { objects: string[]; connections: [string, string][] } // the gap list
}

export interface StructureCompareOptions {
  readonly manifest?: StructureFactsManifest
}

const SIMILARITY_THRESHOLD = 0.55

// --- label similarity: character-trigram Sørensen-Dice coefficient ----------

function normalizeLabel(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ')
}

function trigramSet(text: string): Set<string> {
  const grams = new Set<string>()
  if (text.length === 0) return grams
  if (text.length < 3) {
    grams.add(text)
    return grams
  }
  for (let i = 0; i <= text.length - 3; i += 1) grams.add(text.slice(i, i + 3))
  return grams
}

/**
 * Sørensen-Dice coefficient over character trigrams (whole-string fallback for
 * inputs shorter than 3 characters). Case- and whitespace-insensitive. Two
 * empty strings are considered an exact (1) match; one empty and one
 * non-empty is a total (0) mismatch.
 */
export function diceCoefficient(rawA: string, rawB: string): number {
  const a = normalizeLabel(rawA)
  const b = normalizeLabel(rawB)
  if (a.length === 0 || b.length === 0) return a === b ? 1 : 0
  if (a === b) return 1
  const gramsA = trigramSet(a)
  const gramsB = trigramSet(b)
  let overlap = 0
  for (const gram of gramsA) if (gramsB.has(gram)) overlap += 1
  return (2 * overlap) / (gramsA.size + gramsB.size)
}

function tokenSetScore(rawA: string, rawB: string): number {
  const tokens = (raw: string): Set<string> =>
    new Set(
      normalizeLabel(raw)
        .split(/[^\p{L}\p{N}]+/u)
        .filter(Boolean)
    )
  const a = tokens(rawA)
  const b = tokens(rawB)
  if (a.size === 0 || b.size === 0) return a.size === b.size ? 1 : 0
  let overlapWeight = 0
  for (const token of a) if (b.has(token)) overlapWeight += token.length
  const aWeight = [...a].reduce((sum, token) => sum + token.length, 0)
  const bWeight = [...b].reduce((sum, token) => sum + token.length, 0)
  return overlapWeight / Math.min(aWeight, bWeight)
}

function labelSimilarity(a: string, b: string): number {
  return Math.max(diceCoefficient(a, b), tokenSetScore(a, b))
}

/** Best similarity across every non-empty EN/AR candidate-oracle pairing. */
function bestSimilarity(
  candidateEn: string,
  candidateAr: string,
  expectedEn: string,
  expectedAr?: string
): number {
  const candidates = [candidateEn, candidateAr].filter((value) => value.trim().length > 0)
  const expected = [expectedEn, expectedAr ?? ''].filter((value) => value.trim().length > 0)
  let best = 0
  for (const candidate of candidates) {
    for (const oracle of expected) best = Math.max(best, labelSimilarity(candidate, oracle))
  }
  return best
}

// --- generated-side extraction ------------------------------------------------

type FlowKind = 'function' | 'event' | 'rule'

function flowKindForType(type: string): FlowKind | null {
  if (type === 'OT_FUNC') return 'function'
  if (type === 'OT_EVT') return 'event'
  if (type === 'OT_RULE') return 'rule'
  return null
}

interface GeneratedFlowItem {
  readonly occurrenceId: string
  readonly definitionId: string
  readonly kind: FlowKind
  readonly nameEn: string
  readonly nameAr: string
}

interface GeneratedSatelliteItem {
  readonly objectType: string
  readonly nameEn: string
  readonly nameAr: string
}

interface GeneratedExtract {
  readonly flow: readonly GeneratedFlowItem[]
  readonly occurrenceIdToDefinitionId: ReadonlyMap<string, string>
  readonly satellitesByFunctionOccurrence: ReadonlyMap<string, readonly GeneratedSatelliteItem[]>
  /** Direct flow-to-flow edges, definition-id -> definition-id (both ends OT_FUNC|OT_EVT|OT_RULE). */
  readonly adjacency: ReadonlyMap<string, ReadonlySet<string>>
  readonly defTypeById: ReadonlyMap<string, string>
  readonly symbolByDefId: ReadonlyMap<string, string | null>
}

function extractGenerated(document: ArisWorkingDocument, modelId: string): GeneratedExtract | null {
  const model = document.models.get(modelId)
  if (!model) return null

  const occurrenceById = new Map(model.occurrences.map((occurrence) => [occurrence.id, occurrence]))

  const flow: GeneratedFlowItem[] = []
  const occurrenceIdToDefinitionId = new Map<string, string>()
  const defTypeById = new Map<string, string>()
  const symbolByDefId = new Map<string, string | null>()

  for (const occurrence of model.occurrences) {
    const definition = document.objectDefinitions.get(occurrence.definitionId)
    if (!definition) continue
    occurrenceIdToDefinitionId.set(occurrence.id, definition.id)
    const kind = flowKindForType(definition.type)
    if (!kind) continue
    flow.push({
      occurrenceId: occurrence.id,
      definitionId: definition.id,
      kind,
      nameEn: readLocalized(definition.names, ARIS_CONTENT_LOCALE_IDS.en),
      nameAr: readLocalized(definition.names, ARIS_CONTENT_LOCALE_IDS.ar)
    })
    defTypeById.set(definition.id, definition.type)
    symbolByDefId.set(definition.id, occurrence.symbol)
  }

  const adjacencyMutable = new Map<string, Set<string>>()
  const addAdjacency = (fromDefId: string, toDefId: string): void => {
    const set = adjacencyMutable.get(fromDefId) ?? new Set<string>()
    set.add(toDefId)
    adjacencyMutable.set(fromDefId, set)
  }

  const satellitesByFunctionOccurrence = new Map<string, GeneratedSatelliteItem[]>()
  const addSatellite = (functionOccurrenceId: string, satellite: GeneratedSatelliteItem): void => {
    const list = satellitesByFunctionOccurrence.get(functionOccurrenceId) ?? []
    list.push(satellite)
    satellitesByFunctionOccurrence.set(functionOccurrenceId, list)
  }

  for (const connection of model.connectionOccurrences) {
    const sourceOccurrence = occurrenceById.get(connection.sourceOccurrenceId)
    const targetOccurrence = occurrenceById.get(connection.targetOccurrenceId)
    if (!sourceOccurrence || !targetOccurrence) continue
    const sourceDefinition = document.objectDefinitions.get(sourceOccurrence.definitionId)
    const targetDefinition = document.objectDefinitions.get(targetOccurrence.definitionId)
    if (!sourceDefinition || !targetDefinition) continue

    const sourceIsFlow = FLOW_NODE_TYPES.has(sourceDefinition.type)
    const targetIsFlow = FLOW_NODE_TYPES.has(targetDefinition.type)

    if (sourceIsFlow && targetIsFlow) {
      addAdjacency(sourceDefinition.id, targetDefinition.id)
      continue
    }
    // Satellite attachment. `expected.satellites` is keyed by FUNCTION name
    // only (compare.ts's own `buildSatellites` restricts owners to OT_FUNC the
    // same way), so only an OT_FUNC endpoint collects a satellite pool.
    if (sourceIsFlow && sourceDefinition.type === OT_FUNC && !targetIsFlow) {
      addSatellite(sourceOccurrence.id, {
        objectType: targetDefinition.type,
        nameEn: readLocalized(targetDefinition.names, ARIS_CONTENT_LOCALE_IDS.en),
        nameAr: readLocalized(targetDefinition.names, ARIS_CONTENT_LOCALE_IDS.ar)
      })
    } else if (targetIsFlow && targetDefinition.type === OT_FUNC && !sourceIsFlow) {
      addSatellite(targetOccurrence.id, {
        objectType: sourceDefinition.type,
        nameEn: readLocalized(sourceDefinition.names, ARIS_CONTENT_LOCALE_IDS.en),
        nameAr: readLocalized(sourceDefinition.names, ARIS_CONTENT_LOCALE_IDS.ar)
      })
    }
  }

  const adjacency = new Map<string, ReadonlySet<string>>(adjacencyMutable)

  return {
    flow,
    occurrenceIdToDefinitionId,
    satellitesByFunctionOccurrence,
    adjacency,
    defTypeById,
    symbolByDefId
  }
}

/** A direct edge, or a path through exactly one intermediate node. See the module doc comment. */
function reachesWithinTwoHops(
  adjacency: ReadonlyMap<string, ReadonlySet<string>>,
  from: string,
  to: string,
  explain: (fromDefId: string, toDefId: string) => void
): boolean {
  const direct = adjacency.get(from)
  if (!direct) return false
  if (direct.has(to)) {
    explain(from, to)
    return true
  }
  for (const mid of direct) {
    if (adjacency.get(mid)?.has(to)) {
      explain(from, mid)
      explain(mid, to)
      return true
    }
  }
  return false
}

// --- expected-side extraction --------------------------------------------------

interface ExpectedFlowItem {
  readonly index: number
  readonly kind: FlowKind
  readonly nameEn: string
  readonly nameAr?: string
  readonly symbolNum: string | null
}

function extractExpectedFlow(expected: FidelityExpectationDoc): ExpectedFlowItem[] {
  return expected.spine.map((step, index) => ({
    index,
    kind: step.kind,
    nameEn: step.nameEn,
    ...(step.nameAr ? { nameAr: step.nameAr } : {}),
    symbolNum: step.symbolNum
  }))
}

function findExpectedIndexByName(flow: readonly ExpectedFlowItem[], nameEn: string): number {
  return flow.findIndex((item) => item.nameEn === nameEn)
}

interface ExpectedConnectionPair {
  readonly key: string
  readonly fromIndex: number
  readonly toIndex: number
}

function pairKey(fromIndex: number, toIndex: number): string {
  return `${fromIndex}->${toIndex}`
}

/** See the module doc comment ("Reconstructing expected connections..."). */
function deriveExpectedConnections(
  flow: readonly ExpectedFlowItem[],
  gates: readonly GateExpectation[]
): ExpectedConnectionPair[] {
  const pairs = new Map<string, ExpectedConnectionPair>()
  const addPair = (fromIndex: number, toIndex: number): void => {
    if (fromIndex < 0 || toIndex < 0) return
    const key = pairKey(fromIndex, toIndex)
    if (!pairs.has(key)) pairs.set(key, { key, fromIndex, toIndex })
  }

  // Branch heads that are NOT their gate's first-listed branch — the DFS seam
  // where naive array adjacency would fabricate a sibling-branch edge.
  const nonFirstBranchHeads = new Set<string>()
  for (const gate of gates) {
    for (let i = 1; i < gate.branchFirstNamesEn.length; i += 1) {
      nonFirstBranchHeads.add(gate.branchFirstNamesEn[i])
    }
  }

  const nonRuleFlow = flow.filter((item) => item.kind !== 'rule')
  for (let i = 0; i < nonRuleFlow.length - 1; i += 1) {
    if (nonFirstBranchHeads.has(nonRuleFlow[i + 1].nameEn)) continue
    addPair(nonRuleFlow[i].index, nonRuleFlow[i + 1].index)
  }

  for (const gate of gates) {
    const afterIndex = findExpectedIndexByName(flow, gate.afterNameEn)
    if (afterIndex < 0) continue
    for (const branchName of gate.branchFirstNamesEn) {
      addPair(afterIndex, findExpectedIndexByName(flow, branchName))
    }
  }

  return [...pairs.values()]
}

// --- greedy matching -----------------------------------------------------------

interface FlowMatchResult {
  /** generated occurrenceId -> expected flow index. */
  readonly matchedGenToExp: ReadonlyMap<string, number>
  /** expected flow index -> generated occurrenceId. */
  readonly matchedExpToGen: ReadonlyMap<number, string>
  readonly similarities: readonly number[]
}

function matchFlowObjects(
  generated: GeneratedExtract,
  expected: readonly ExpectedFlowItem[],
  gates: readonly GateExpectation[]
): FlowMatchResult {
  interface Candidate {
    readonly genIndex: number
    readonly expIndex: number
    readonly similarity: number
  }
  const candidates: Candidate[] = []
  generated.flow.forEach((generatedItem, genIndex) => {
    if (generatedItem.kind === 'rule') return
    expected.forEach((expectedItem) => {
      if (expectedItem.kind === 'rule') return
      if (generatedItem.kind !== expectedItem.kind) return
      const similarity = bestSimilarity(
        generatedItem.nameEn,
        generatedItem.nameAr,
        expectedItem.nameEn,
        expectedItem.nameAr
      )
      if (similarity >= SIMILARITY_THRESHOLD) {
        candidates.push({ genIndex, expIndex: expectedItem.index, similarity })
      }
    })
  })
  candidates.sort((a, b) => b.similarity - a.similarity)

  const matchedGenToExp = new Map<string, number>()
  const matchedExpToGen = new Map<number, string>()
  const usedGen = new Set<number>()
  const usedExp = new Set<number>()
  const similarities: number[] = []

  for (const candidate of candidates) {
    if (usedGen.has(candidate.genIndex) || usedExp.has(candidate.expIndex)) continue
    usedGen.add(candidate.genIndex)
    usedExp.add(candidate.expIndex)
    const occurrenceId = generated.flow[candidate.genIndex].occurrenceId
    matchedGenToExp.set(occurrenceId, candidate.expIndex)
    matchedExpToGen.set(candidate.expIndex, occurrenceId)
    similarities.push(candidate.similarity)
  }

  const neighbourIndex = (ruleIndex: number, direction: -1 | 1): number | undefined => {
    for (
      let index = ruleIndex + direction;
      index >= 0 && index < expected.length;
      index += direction
    ) {
      if (expected[index].kind !== 'rule') return expected[index].index
    }
    return undefined
  }
  const expectedRuleOperator = (rule: ExpectedFlowItem): 'AND' | 'OR' | 'XOR' | 'unknown' => {
    const fromSymbol = classifyRuleSymbol(rule.symbolNum)
    if (fromSymbol !== 'unknown') return fromSymbol
    const beforeIndex = neighbourIndex(rule.index, -1)
    const before = beforeIndex === undefined ? undefined : expected[beforeIndex]
    return gates.find((gate) => gate.afterNameEn === before?.nameEn)?.operator ?? 'unknown'
  }

  interface RuleCandidate {
    readonly genIndex: number
    readonly expIndex: number
  }
  const ruleCandidates: RuleCandidate[] = []
  expected.forEach((expectedRule) => {
    if (expectedRule.kind !== 'rule') return
    const beforeIndex = neighbourIndex(expectedRule.index, -1)
    const afterIndex = neighbourIndex(expectedRule.index, 1)
    if (beforeIndex === undefined || afterIndex === undefined) return
    const beforeOccurrence = matchedExpToGen.get(beforeIndex)
    const afterOccurrence = matchedExpToGen.get(afterIndex)
    const beforeDefinition = beforeOccurrence
      ? generated.occurrenceIdToDefinitionId.get(beforeOccurrence)
      : undefined
    const afterDefinition = afterOccurrence
      ? generated.occurrenceIdToDefinitionId.get(afterOccurrence)
      : undefined
    if (!beforeDefinition || !afterDefinition) return
    const expectedOperator = expectedRuleOperator(expectedRule)
    if (expectedOperator === 'unknown') return

    generated.flow.forEach((generatedRule, genIndex) => {
      if (generatedRule.kind !== 'rule') return
      if (
        classifyRuleSymbol(generated.symbolByDefId.get(generatedRule.definitionId) ?? null) !==
        expectedOperator
      ) {
        return
      }
      const entersRule = generated.adjacency.get(beforeDefinition)?.has(generatedRule.definitionId)
      const leavesRule = generated.adjacency.get(generatedRule.definitionId)?.has(afterDefinition)
      if (entersRule && leavesRule) {
        ruleCandidates.push({ genIndex, expIndex: expectedRule.index })
      }
    })
  })
  ruleCandidates.sort((a, b) => a.expIndex - b.expIndex || a.genIndex - b.genIndex)

  for (const candidate of ruleCandidates) {
    if (usedGen.has(candidate.genIndex) || usedExp.has(candidate.expIndex)) continue
    usedGen.add(candidate.genIndex)
    usedExp.add(candidate.expIndex)
    const occurrenceId = generated.flow[candidate.genIndex].occurrenceId
    matchedGenToExp.set(occurrenceId, candidate.expIndex)
    matchedExpToGen.set(candidate.expIndex, occurrenceId)
  }

  return { matchedGenToExp, matchedExpToGen, similarities }
}

interface SatelliteMatchResult {
  readonly matchedCount: number
  readonly similarities: readonly number[]
  /** `${functionName}::${satelliteNameEn}` for every matched expected satellite. */
  readonly matchedKeys: ReadonlySet<string>
  readonly misses: readonly string[]
}

function matchSatellitesForFunction(
  functionName: string,
  expectedList: readonly SatelliteExpectation[],
  generatedPool: readonly GeneratedSatelliteItem[]
): SatelliteMatchResult {
  interface Candidate {
    readonly expIndex: number
    readonly genIndex: number
    readonly similarity: number
  }
  const candidates: Candidate[] = []
  expectedList.forEach((expectedSatellite, expIndex) => {
    generatedPool.forEach((generatedSatellite, genIndex) => {
      if (expectedSatellite.objectType !== generatedSatellite.objectType) return
      const similarity = bestSimilarity(
        generatedSatellite.nameEn,
        generatedSatellite.nameAr,
        expectedSatellite.nameEn,
        expectedSatellite.nameAr
      )
      if (similarity >= SIMILARITY_THRESHOLD) candidates.push({ expIndex, genIndex, similarity })
    })
  })
  candidates.sort((a, b) => b.similarity - a.similarity)

  const usedExp = new Set<number>()
  const usedGen = new Set<number>()
  const matchedKeys = new Set<string>()
  const similarities: number[] = []

  for (const candidate of candidates) {
    if (usedExp.has(candidate.expIndex) || usedGen.has(candidate.genIndex)) continue
    usedExp.add(candidate.expIndex)
    usedGen.add(candidate.genIndex)
    matchedKeys.add(`${functionName}::${expectedList[candidate.expIndex].nameEn}`)
    similarities.push(candidate.similarity)
  }

  const misses: string[] = []
  expectedList.forEach((expectedSatellite, expIndex) => {
    if (!usedExp.has(expIndex)) {
      misses.push(`satellite:${functionName}:${expectedSatellite.nameEn}`)
    }
  })

  return { matchedCount: usedExp.size, similarities, matchedKeys, misses }
}

// --- gateway accuracy -----------------------------------------------------------

function computeGatewayAccuracy(
  expectedGates: readonly GateExpectation[],
  expectedFlow: readonly ExpectedFlowItem[],
  matchedExpToGen: ReadonlyMap<number, string>,
  generated: GeneratedExtract
): number {
  if (expectedGates.length === 0) return 1

  let correct = 0
  for (const gate of expectedGates) {
    const afterIndex = findExpectedIndexByName(expectedFlow, gate.afterNameEn)
    const afterGenOcc = afterIndex >= 0 ? matchedExpToGen.get(afterIndex) : undefined
    const afterDefId = afterGenOcc
      ? generated.occurrenceIdToDefinitionId.get(afterGenOcc)
      : undefined
    if (!afterDefId) continue

    const branchDefIds: string[] = []
    let allBranchesMatched = true
    for (const branchName of gate.branchFirstNamesEn) {
      const branchIndex = findExpectedIndexByName(expectedFlow, branchName)
      const branchGenOcc = branchIndex >= 0 ? matchedExpToGen.get(branchIndex) : undefined
      const branchDefId = branchGenOcc
        ? generated.occurrenceIdToDefinitionId.get(branchGenOcc)
        : undefined
      if (!branchDefId) {
        allBranchesMatched = false
        break
      }
      branchDefIds.push(branchDefId)
    }
    if (!allBranchesMatched) continue

    const candidateRuleDefIds = generated.adjacency.get(afterDefId) ?? new Set<string>()
    const gateIsCorrect = [...candidateRuleDefIds].some((ruleDefId) => {
      if (generated.defTypeById.get(ruleDefId) !== 'OT_RULE') return false
      if (classifyRuleSymbol(generated.symbolByDefId.get(ruleDefId) ?? null) !== gate.operator) {
        return false
      }
      const ruleOutgoing = generated.adjacency.get(ruleDefId) ?? new Set<string>()
      return branchDefIds.every((branchDefId) => ruleOutgoing.has(branchDefId))
    })
    if (gateIsCorrect) correct += 1
  }

  return correct / expectedGates.length
}

// --- entry point -----------------------------------------------------------------

function manifestObjectMentioned(
  manifest: StructureFactsManifest,
  nameEn: string,
  nameAr?: string
): boolean {
  return manifest.objects.some(
    (mentioned) => bestSimilarity(mentioned, '', nameEn, nameAr) >= SIMILARITY_THRESHOLD
  )
}

function manifestConnectionMentioned(
  manifest: StructureFactsManifest,
  from: ExpectedFlowItem,
  to: ExpectedFlowItem
): boolean {
  const matches = (mentioned: string, expected: ExpectedFlowItem): boolean =>
    bestSimilarity(mentioned, '', expected.nameEn, expected.nameAr) >= SIMILARITY_THRESHOLD
  return manifest.connections.some(
    ([a, b]) => (matches(a, from) && matches(b, to)) || (matches(a, to) && matches(b, from))
  )
}

function manifestSubsetTotal(
  manifest: StructureFactsManifest,
  expectedFlow: readonly ExpectedFlowItem[],
  expectedConnections: readonly ExpectedConnectionPair[],
  expected: FidelityExpectationDoc
): number {
  let total = expectedFlow.filter((item) =>
    manifestObjectMentioned(manifest, item.nameEn, item.nameAr)
  ).length

  for (const [functionName, list] of Object.entries(expected.satellites)) {
    const owner = expectedFlow.find(
      (item) => item.kind === 'function' && item.nameEn === functionName
    )
    if (!owner || !manifestObjectMentioned(manifest, owner.nameEn, owner.nameAr)) continue
    total += list.filter((satellite) =>
      manifestObjectMentioned(manifest, satellite.nameEn, satellite.nameAr)
    ).length
  }

  total += expectedConnections.filter((pair) =>
    manifestConnectionMentioned(manifest, expectedFlow[pair.fromIndex], expectedFlow[pair.toIndex])
  ).length
  return total
}

function allZeroScore(
  expectedFlow: readonly ExpectedFlowItem[],
  expectedConnections: readonly ExpectedConnectionPair[],
  expectedSatelliteTotal: number,
  expectedGateCount: number,
  expected: FidelityExpectationDoc,
  manifest: StructureFactsManifest | undefined
): StructureScore {
  const objectMisses: string[] = expectedFlow.map((item) => `${item.kind}:${item.nameEn}`)
  for (const [functionName, list] of Object.entries(expected.satellites)) {
    for (const satellite of list) objectMisses.push(`satellite:${functionName}:${satellite.nameEn}`)
  }
  const connectionMisses: [string, string][] = expectedConnections.map((pair) => [
    expectedFlow[pair.fromIndex].nameEn,
    expectedFlow[pair.toIndex].nameEn
  ])
  const relativeSubsetTotal = manifest
    ? manifestSubsetTotal(manifest, expectedFlow, expectedConnections, expected)
    : 0

  return {
    controlFlowRecall: expectedFlow.length === 0 ? 1 : 0,
    controlFlowPrecision: 1,
    connectionRecall: expectedConnections.length === 0 ? 1 : 0,
    connectionPrecision: 1,
    satelliteRecall: expectedSatelliteTotal === 0 ? 1 : 0,
    gatewayAccuracy: expectedGateCount === 0 ? 1 : 0,
    labelSimilarityMean: 0,
    ...(relativeSubsetTotal > 0 ? { relativeRecall: 0 } : {}),
    misses: { objects: objectMisses, connections: connectionMisses }
  }
}

/**
 * Score a generated `ArisWorkingDocument` model against a hand-authored
 * fidelity expectation, tolerant of renamed labels, missing content, and
 * absent/irrelevant geometry. See the module doc comment for the matching and
 * connection-reconstruction design.
 */
export function compareStructure(
  document: ArisWorkingDocument,
  modelId: string,
  expected: FidelityExpectationDoc,
  options: StructureCompareOptions = {}
): StructureScore {
  const expectedFlow = extractExpectedFlow(expected)
  const expectedConnections = deriveExpectedConnections(expectedFlow, expected.gates)
  const expectedSatelliteTotal = Object.values(expected.satellites).reduce(
    (sum, list) => sum + list.length,
    0
  )

  const generated = extractGenerated(document, modelId)
  if (!generated) {
    return allZeroScore(
      expectedFlow,
      expectedConnections,
      expectedSatelliteTotal,
      expected.gates.length,
      expected,
      options.manifest
    )
  }

  const objectMisses: string[] = []
  const connectionMisses: [string, string][] = []
  const allSimilarities: number[] = []

  // --- 1. control-flow object matching -----------------------------------
  const flowMatch = matchFlowObjects(generated, expectedFlow, expected.gates)
  allSimilarities.push(...flowMatch.similarities)

  const controlFlowRecall =
    expectedFlow.length === 0 ? 1 : flowMatch.matchedExpToGen.size / expectedFlow.length
  const controlFlowPrecision =
    generated.flow.length === 0
      ? expectedFlow.length === 0
        ? 1
        : 0
      : flowMatch.matchedGenToExp.size / generated.flow.length

  for (const item of expectedFlow) {
    if (!flowMatch.matchedExpToGen.has(item.index)) objectMisses.push(`${item.kind}:${item.nameEn}`)
  }

  // --- 2. satellites, per matched function --------------------------------
  let satelliteMatchedTotal = 0
  const matchedSatelliteKeys = new Set<string>()
  for (const [functionName, list] of Object.entries(expected.satellites)) {
    const expFunctionIndex = expectedFlow.findIndex(
      (item) => item.kind === 'function' && item.nameEn === functionName
    )
    const genFunctionOccId =
      expFunctionIndex >= 0 ? flowMatch.matchedExpToGen.get(expFunctionIndex) : undefined
    const pool = genFunctionOccId
      ? (generated.satellitesByFunctionOccurrence.get(genFunctionOccId) ?? [])
      : []
    const result = matchSatellitesForFunction(functionName, list, pool)
    satelliteMatchedTotal += result.matchedCount
    allSimilarities.push(...result.similarities)
    for (const key of result.matchedKeys) matchedSatelliteKeys.add(key)
    objectMisses.push(...result.misses)
  }
  const satelliteRecall =
    expectedSatelliteTotal === 0 ? 1 : satelliteMatchedTotal / expectedSatelliteTotal

  // --- 3. connections --------------------------------------------------------
  const explainedGenEdges = new Set<string>()
  const explain = (fromDefId: string, toDefId: string): void => {
    explainedGenEdges.add(pairKey0(fromDefId, toDefId))
  }
  const matchedConnectionPairKeys = new Set<string>()
  let connectionMatchedCount = 0
  for (const pair of expectedConnections) {
    const genFrom = flowMatch.matchedExpToGen.get(pair.fromIndex)
    const genTo = flowMatch.matchedExpToGen.get(pair.toIndex)
    const fromDefId = genFrom ? generated.occurrenceIdToDefinitionId.get(genFrom) : undefined
    const toDefId = genTo ? generated.occurrenceIdToDefinitionId.get(genTo) : undefined
    const matched =
      fromDefId !== undefined &&
      toDefId !== undefined &&
      reachesWithinTwoHops(generated.adjacency, fromDefId, toDefId, explain)
    if (matched) {
      connectionMatchedCount += 1
      matchedConnectionPairKeys.add(pair.key)
    } else {
      connectionMisses.push([
        expectedFlow[pair.fromIndex].nameEn,
        expectedFlow[pair.toIndex].nameEn
      ])
    }
  }
  const connectionRecall =
    expectedConnections.length === 0 ? 1 : connectionMatchedCount / expectedConnections.length

  let generatedDirectEdgeCount = 0
  let explainedDirectEdgeCount = 0
  for (const [from, targets] of generated.adjacency) {
    for (const to of targets) {
      generatedDirectEdgeCount += 1
      if (explainedGenEdges.has(pairKey0(from, to))) explainedDirectEdgeCount += 1
    }
  }
  const connectionPrecision =
    generatedDirectEdgeCount === 0
      ? expectedConnections.length === 0
        ? 1
        : 0
      : explainedDirectEdgeCount / generatedDirectEdgeCount

  // --- 4. gateway accuracy -----------------------------------------------------
  const gatewayAccuracy = computeGatewayAccuracy(
    expected.gates,
    expectedFlow,
    flowMatch.matchedExpToGen,
    generated
  )

  // --- 5. label similarity mean --------------------------------------------------
  const labelSimilarityMean =
    allSimilarities.length === 0
      ? 0
      : allSimilarities.reduce((sum, value) => sum + value, 0) / allSimilarities.length

  // --- 6. relativeRecall (optional) ------------------------------------------------
  let relativeRecall: number | undefined
  if (options.manifest) {
    const manifest = options.manifest

    let subsetTotal = 0
    let subsetMatched = 0

    for (const item of expectedFlow) {
      if (!manifestObjectMentioned(manifest, item.nameEn, item.nameAr)) continue
      subsetTotal += 1
      if (flowMatch.matchedExpToGen.has(item.index)) subsetMatched += 1
    }

    for (const [functionName, list] of Object.entries(expected.satellites)) {
      const owner = expectedFlow.find(
        (item) => item.kind === 'function' && item.nameEn === functionName
      )
      if (!owner || !manifestObjectMentioned(manifest, owner.nameEn, owner.nameAr)) continue
      for (const satellite of list) {
        if (!manifestObjectMentioned(manifest, satellite.nameEn, satellite.nameAr)) continue
        subsetTotal += 1
        if (matchedSatelliteKeys.has(`${functionName}::${satellite.nameEn}`)) subsetMatched += 1
      }
    }

    for (const pair of expectedConnections) {
      if (
        !manifestConnectionMentioned(
          manifest,
          expectedFlow[pair.fromIndex],
          expectedFlow[pair.toIndex]
        )
      ) {
        continue
      }
      subsetTotal += 1
      if (matchedConnectionPairKeys.has(pair.key)) subsetMatched += 1
    }

    relativeRecall = subsetTotal === 0 ? undefined : subsetMatched / subsetTotal
  }

  return {
    controlFlowRecall,
    controlFlowPrecision,
    connectionRecall,
    connectionPrecision,
    satelliteRecall,
    gatewayAccuracy,
    labelSimilarityMean,
    ...(relativeRecall !== undefined ? { relativeRecall } : {}),
    misses: { objects: objectMisses, connections: connectionMisses }
  }
}

/** Definition-id edge key — distinct name from the expected-index `pairKey` above. */
function pairKey0(fromDefId: string, toDefId: string): string {
  return `${fromDefId}->${toDefId}`
}
