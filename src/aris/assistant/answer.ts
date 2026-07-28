// Deterministic, no-key answerers for Section 17.4. Every answer is DATA — a
// lead message key + interpolation vars, plus a list of items (each either a
// value pulled straight from the process content, or its own message
// key/vars for assistant-authored text) and openable chips carrying
// `relPath` + `modelId` + `occurrenceId`/`definitionId` so the UI can select
// the exact source element (Section 17.6). Nothing here ever returns a
// prose string — `i18n.ts` + a caller-side formatter resolve display text.
//
// Confidence is positive-only (Section 17.3): every answerer either finds a
// confident, unambiguous match (via `matching.bestTokenMatch` /
// `bestDigestMatch`, both of which refuse ties and close cross-model
// rivals) or returns the shared `none` answer. There is no "closest guess"
// path.

import type { ArisAssistantKey } from './i18n'
import { bestTokenMatch, type MatchCandidate } from './matching'
import { expandedTokens, rankDigests } from './retrieval'
import { buildPrevIndex, findBackEdges, stepByOccurrenceId } from './stepGraph'
import type { ArisDigestDecision, ArisDigestStep, ArisProcessDigest } from './types'

export interface ArisAnswerChip {
  readonly relPath: string
  readonly modelId: string
  readonly modelName: string
  readonly occurrenceId?: string
  readonly definitionId?: string
}

export interface ArisAnswerListItem {
  readonly messageKey?: ArisAssistantKey
  readonly vars?: Record<string, string | number>
  readonly text?: string
  readonly detail?: string
  readonly chip?: ArisAnswerChip
}

export interface ArisAnswerPart {
  readonly messageKey: ArisAssistantKey
  readonly vars?: Record<string, string | number>
  readonly items?: readonly ArisAnswerListItem[]
}

export type ArisAnswerKind =
  | 'next'
  | 'before'
  | 'responsible'
  | 'io'
  | 'system'
  | 'xorOutcomes'
  | 'returnBranch'
  | 'assignment'
  | 'missingInfo'
  | 'processList'
  | 'topicMatch'
  | 'none'

export interface ArisAssistantAnswer {
  readonly kind: ArisAnswerKind
  readonly confidence: number
  readonly parts: readonly ArisAnswerPart[]
  readonly chips: readonly ArisAnswerChip[]
}

function chipForStep(digest: ArisProcessDigest, step: { occurrenceId: string; definitionId: string }): ArisAnswerChip {
  return {
    relPath: digest.relPath,
    modelId: digest.modelId,
    modelName: digest.modelName,
    occurrenceId: step.occurrenceId,
    definitionId: step.definitionId
  }
}

function chipForDigest(digest: ArisProcessDigest): ArisAnswerChip {
  return { relPath: digest.relPath, modelId: digest.modelId, modelName: digest.modelName }
}

export function noneAnswer(): ArisAssistantAnswer {
  return { kind: 'none', confidence: 0, parts: [{ messageKey: 'assistant.none' }], chips: [] }
}

function scoreToConfidence(score: number): number {
  return Math.max(0, Math.min(1, score / 5))
}

/** Confident, unique digest-level match (no tie with the runner-up), or `null`. */
export function bestDigestMatch(digests: readonly ArisProcessDigest[], query: string): { digest: ArisProcessDigest; score: number } | null {
  const ranked = rankDigests(digests, query, 2)
  if (ranked.length === 0) return null
  if (ranked.length > 1 && ranked[0].score === ranked[1].score) return null
  return ranked[0]
}

/** Token set covering the plain name plus both locale-specific names, so an Arabic-only or English-only query both work. */
function bilingualTokens(name: string, nameEn?: string, nameAr?: string): string[] {
  const out = [...expandedTokens(name)]
  if (nameEn) out.push(...expandedTokens(nameEn))
  if (nameAr) out.push(...expandedTokens(nameAr))
  return out
}

function stepNameTokens(step: ArisDigestStep): string[] {
  return bilingualTokens(step.name, step.nameEn, step.nameAr)
}

function allStepCandidates(digests: readonly ArisProcessDigest[]): MatchCandidate<ArisDigestStep>[] {
  const out: MatchCandidate<ArisDigestStep>[] = []
  for (const digest of digests) {
    for (const step of digest.steps) out.push({ digest, tokens: stepNameTokens(step), value: step })
  }
  return out
}

// --- 1. What comes next? -----------------------------------------------------

export function answerNext(digests: readonly ArisProcessDigest[], query: string): ArisAssistantAnswer {
  const match = bestTokenMatch(allStepCandidates(digests), query)
  if (!match) return noneAnswer()
  const { digest, value: step, score } = match
  const nameById = stepByOccurrenceId(digest)
  const chip = chipForStep(digest, step)
  if (step.next.length === 0) {
    return {
      kind: 'next',
      confidence: scoreToConfidence(score),
      parts: [{ messageKey: 'assistant.next.complete', vars: { step: step.name } }],
      chips: [chip]
    }
  }
  const items: ArisAnswerListItem[] = step.next.map((n) => {
    const target = nameById.get(n.targetOccurrenceId)
    return {
      text: target?.name ?? n.targetOccurrenceId,
      ...(n.outcome ? { detail: n.outcome } : {}),
      chip: target ? chipForStep(digest, target) : chip
    }
  })
  return {
    kind: 'next',
    confidence: scoreToConfidence(score),
    parts: [{ messageKey: 'assistant.next.forStep', vars: { step: step.name }, items }],
    chips: [chip, ...items.map((i) => i.chip).filter((c): c is ArisAnswerChip => !!c)]
  }
}

// --- 2. What comes before? ---------------------------------------------------

export function answerBefore(digests: readonly ArisProcessDigest[], query: string): ArisAssistantAnswer {
  const match = bestTokenMatch(allStepCandidates(digests), query)
  if (!match) return noneAnswer()
  const { digest, value: step, score } = match
  const chip = chipForStep(digest, step)
  const prevIndex = buildPrevIndex(digest)
  const incoming = prevIndex.get(step.occurrenceId) ?? []
  if (incoming.length === 0) {
    return {
      kind: 'before',
      confidence: scoreToConfidence(score),
      parts: [{ messageKey: 'assistant.before.none', vars: { step: step.name } }],
      chips: [chip]
    }
  }
  const nameById = stepByOccurrenceId(digest)
  const items: ArisAnswerListItem[] = incoming.map((edge) => {
    const source = nameById.get(edge.fromOccurrenceId)
    return {
      text: source?.name ?? edge.fromOccurrenceId,
      ...(edge.outcome ? { detail: edge.outcome } : {}),
      chip: source ? chipForStep(digest, source) : chip
    }
  })
  return {
    kind: 'before',
    confidence: scoreToConfidence(score),
    parts: [{ messageKey: 'assistant.before.forStep', vars: { step: step.name }, items }],
    chips: [chip, ...items.map((i) => i.chip).filter((c): c is ArisAnswerChip => !!c)]
  }
}

// --- 3. Who owns / is responsible? ------------------------------------------

export function answerResponsible(digests: readonly ArisProcessDigest[], query: string): ArisAssistantAnswer {
  const stepMatch = bestTokenMatch(allStepCandidates(digests), query)
  if (stepMatch) {
    const { digest, value: step, score } = stepMatch
    const chip = chipForStep(digest, step)
    if (step.responsible.length === 0) {
      return {
        kind: 'responsible',
        confidence: scoreToConfidence(score),
        parts: [{ messageKey: 'assistant.responsible.none', vars: { step: step.name } }],
        chips: [chip]
      }
    }
    const items: ArisAnswerListItem[] = step.responsible.map((r) => ({ text: r, chip }))
    return {
      kind: 'responsible',
      confidence: scoreToConfidence(score),
      parts: [{ messageKey: 'assistant.responsible.forStep', vars: { step: step.name }, items }],
      chips: [chip]
    }
  }
  const digestMatch = bestDigestMatch(digests, query)
  if (!digestMatch) return noneAnswer()
  const { digest, score } = digestMatch
  const chip = chipForDigest(digest)
  if (digest.owners.length === 0) {
    return {
      kind: 'responsible',
      confidence: scoreToConfidence(score),
      parts: [{ messageKey: 'assistant.responsible.none', vars: { step: digest.modelName } }],
      chips: [chip]
    }
  }
  const items: ArisAnswerListItem[] = digest.owners.map((o) => ({ text: o, chip }))
  return {
    kind: 'responsible',
    confidence: scoreToConfidence(score),
    parts: [{ messageKey: 'assistant.responsible.forProcess', vars: { process: digest.modelName }, items }],
    chips: [chip]
  }
}

// --- 4. What inputs/outputs apply? ------------------------------------------

export function answerIo(digests: readonly ArisProcessDigest[], query: string): ArisAssistantAnswer {
  const match = bestTokenMatch(allStepCandidates(digests), query)
  if (!match) return noneAnswer()
  const { digest, value: step, score } = match
  const chip = chipForStep(digest, step)
  if (step.inputs.length === 0 && step.outputs.length === 0) {
    return {
      kind: 'io',
      confidence: scoreToConfidence(score),
      parts: [{ messageKey: 'assistant.io.none', vars: { step: step.name } }],
      chips: [chip]
    }
  }
  const items: ArisAnswerListItem[] = [
    ...step.inputs.map((i) => ({ text: i, detail: 'input', chip })),
    ...step.outputs.map((o) => ({ text: o, detail: 'output', chip }))
  ]
  return {
    kind: 'io',
    confidence: scoreToConfidence(score),
    parts: [{ messageKey: 'assistant.io.forStep', vars: { step: step.name }, items }],
    chips: [chip]
  }
}

// --- 5. Which system is used? ------------------------------------------------

export function answerSystem(digests: readonly ArisProcessDigest[], query: string): ArisAssistantAnswer {
  const match = bestTokenMatch(allStepCandidates(digests), query)
  if (!match) return noneAnswer()
  const { digest, value: step, score } = match
  const chip = chipForStep(digest, step)
  if (step.systems.length === 0) {
    return {
      kind: 'system',
      confidence: scoreToConfidence(score),
      parts: [{ messageKey: 'assistant.system.none', vars: { step: step.name } }],
      chips: [chip]
    }
  }
  const items: ArisAnswerListItem[] = step.systems.map((s) => ({ text: s, chip }))
  return {
    kind: 'system',
    confidence: scoreToConfidence(score),
    parts: [{ messageKey: 'assistant.system.forStep', vars: { step: step.name }, items }],
    chips: [chip]
  }
}

// --- 6. What XOR outcomes exist? ---------------------------------------------

function allDecisionCandidates(digests: readonly ArisProcessDigest[]): MatchCandidate<ArisDigestDecision>[] {
  const out: MatchCandidate<ArisDigestDecision>[] = []
  for (const digest of digests) {
    for (const decision of digest.decisions) {
      out.push({ digest, tokens: bilingualTokens(decision.name, decision.nameEn, decision.nameAr), value: decision })
    }
  }
  return out
}

export function answerXorOutcomes(digests: readonly ArisProcessDigest[], query: string): ArisAssistantAnswer {
  const match = bestTokenMatch(allDecisionCandidates(digests), query)
  if (!match) return noneAnswer()
  const { digest, value: decision, score } = match
  const chip = chipForStep(digest, decision)
  const nameById = stepByOccurrenceId(digest)
  if (decision.outcomes.length === 0) {
    return {
      kind: 'xorOutcomes',
      confidence: scoreToConfidence(score),
      parts: [{ messageKey: 'assistant.xor.none' }],
      chips: [chip]
    }
  }
  const items: ArisAnswerListItem[] = decision.outcomes.map((o) => {
    const target = nameById.get(o.targetOccurrenceId)
    return { text: o.outcome, detail: o.targetName, chip: target ? chipForStep(digest, target) : chip }
  })
  return {
    kind: 'xorOutcomes',
    confidence: scoreToConfidence(score),
    parts: [{ messageKey: 'assistant.xor.forGateway', vars: { gateway: decision.name }, items }],
    chips: [chip, ...items.map((i) => i.chip).filter((c): c is ArisAnswerChip => !!c)]
  }
}

// --- 7. Where does a return branch go? ---------------------------------------

export function answerReturnBranch(digests: readonly ArisProcessDigest[], query: string): ArisAssistantAnswer {
  const stepMatch = bestTokenMatch(allStepCandidates(digests), query)
  if (stepMatch) {
    const { digest, value: step, score } = stepMatch
    const chip = chipForStep(digest, step)
    const backEdges = findBackEdges(digest).filter((e) => e.fromOccurrenceId === step.occurrenceId)
    if (backEdges.length === 0) {
      return {
        kind: 'returnBranch',
        confidence: scoreToConfidence(score),
        parts: [{ messageKey: 'assistant.return.none', vars: { step: step.name } }],
        chips: [chip]
      }
    }
    const nameById = stepByOccurrenceId(digest)
    const edge = backEdges[0]
    const target = nameById.get(edge.targetOccurrenceId)
    const targetChip = target ? chipForStep(digest, target) : chip
    return {
      kind: 'returnBranch',
      confidence: scoreToConfidence(score),
      parts: [
        {
          messageKey: 'assistant.return.found',
          vars: { step: step.name, target: target?.name ?? edge.targetOccurrenceId },
          items: [{ text: target?.name ?? edge.targetOccurrenceId, chip: targetChip }]
        }
      ],
      chips: [chip, targetChip]
    }
  }
  const digestMatch = bestDigestMatch(digests, query)
  if (!digestMatch) return noneAnswer()
  const { digest, score } = digestMatch
  const chip = chipForDigest(digest)
  const backEdges = findBackEdges(digest)
  if (backEdges.length === 0) {
    return {
      kind: 'returnBranch',
      confidence: scoreToConfidence(score),
      parts: [{ messageKey: 'assistant.return.none', vars: { step: digest.modelName } }],
      chips: [chip]
    }
  }
  const nameById = stepByOccurrenceId(digest)
  const items: ArisAnswerListItem[] = backEdges.map((edge) => {
    const from = nameById.get(edge.fromOccurrenceId)
    const target = nameById.get(edge.targetOccurrenceId)
    return {
      text: `${from?.name ?? edge.fromOccurrenceId} -> ${target?.name ?? edge.targetOccurrenceId}`,
      chip: target ? chipForStep(digest, target) : chip
    }
  })
  return {
    kind: 'returnBranch',
    confidence: scoreToConfidence(score),
    parts: [{ messageKey: 'assistant.return.found', vars: { step: digest.modelName, target: '' }, items }],
    chips: [chip, ...items.map((i) => i.chip).filter((c): c is ArisAnswerChip => !!c)]
  }
}

// --- 8. Which model is assigned? ---------------------------------------------

interface AssignmentGroup {
  readonly occurrenceId: string
  readonly definitionId: string
  readonly name: string
  readonly nameEn?: string
  readonly nameAr?: string
  readonly linkedModelIds: readonly string[]
}

function allAssignmentCandidates(digests: readonly ArisProcessDigest[]): MatchCandidate<AssignmentGroup>[] {
  const out: MatchCandidate<AssignmentGroup>[] = []
  for (const digest of digests) {
    const byOccurrence = new Map<string, AssignmentGroup>()
    for (const a of digest.assignments) {
      const existing = byOccurrence.get(a.occurrenceId)
      if (existing) {
        byOccurrence.set(a.occurrenceId, { ...existing, linkedModelIds: [...existing.linkedModelIds, a.linkedModelId] })
      } else {
        byOccurrence.set(a.occurrenceId, {
          occurrenceId: a.occurrenceId,
          definitionId: a.definitionId,
          name: a.name,
          ...(a.nameEn ? { nameEn: a.nameEn } : {}),
          ...(a.nameAr ? { nameAr: a.nameAr } : {}),
          linkedModelIds: [a.linkedModelId]
        })
      }
    }
    for (const group of byOccurrence.values()) {
      out.push({ digest, tokens: bilingualTokens(group.name, group.nameEn, group.nameAr), value: group })
    }
  }
  return out
}

export function answerAssignment(digests: readonly ArisProcessDigest[], query: string): ArisAssistantAnswer {
  const match = bestTokenMatch(allAssignmentCandidates(digests), query)
  if (!match) return noneAnswer()
  const { digest, value: group, score } = match
  const chip = chipForStep(digest, group)
  const items: ArisAnswerListItem[] = group.linkedModelIds.map((modelId) => ({ text: modelId, chip }))
  return {
    kind: 'assignment',
    confidence: scoreToConfidence(score),
    parts: [{ messageKey: 'assistant.assignment.forStep', vars: { step: group.name }, items }],
    chips: [chip]
  }
}

// --- 9. Which information is missing? ----------------------------------------

export function answerMissingInfo(digests: readonly ArisProcessDigest[], query: string): ArisAssistantAnswer {
  const digestMatch = bestDigestMatch(digests, query)
  if (!digestMatch) return noneAnswer()
  const { digest, score } = digestMatch
  const chip = chipForDigest(digest)
  if (digest.missingInformation.length === 0) {
    return {
      kind: 'missingInfo',
      confidence: scoreToConfidence(score),
      parts: [{ messageKey: 'assistant.missing.none', vars: { process: digest.modelName } }],
      chips: [chip]
    }
  }
  const gapKeyByKind: Record<string, ArisAssistantKey> = {
    missingNameEn: 'assistant.gap.missingNameEn',
    missingNameAr: 'assistant.gap.missingNameAr',
    missingProcessCode: 'assistant.gap.missingProcessCode',
    missingOwner: 'assistant.gap.missingOwner',
    missingInputs: 'assistant.gap.missingInputs',
    missingOutputs: 'assistant.gap.missingOutputs',
    missingSystem: 'assistant.gap.missingSystem',
    missingDecisionBasis: 'assistant.gap.missingDecisionBasis',
    missingOutcome: 'assistant.gap.missingOutcome',
    danglingConnection: 'assistant.gap.danglingConnection'
  }
  const items: ArisAnswerListItem[] = digest.missingInformation.map((gap) => ({
    messageKey: gapKeyByKind[gap.kind],
    vars: { step: gap.stepName ?? '', detail: gap.detail ?? '' },
    chip: gap.occurrenceId
      ? { ...chip, occurrenceId: gap.occurrenceId, ...(gap.definitionId ? { definitionId: gap.definitionId } : {}) }
      : chip
  }))
  return {
    kind: 'missingInfo',
    confidence: scoreToConfidence(score),
    parts: [{ messageKey: 'assistant.missing.forProcess', vars: { process: digest.modelName }, items }],
    chips: [chip]
  }
}

// --- 10. Which processes are available? --------------------------------------

export function answerProcessList(digests: readonly ArisProcessDigest[]): ArisAssistantAnswer {
  if (digests.length === 0) {
    return {
      kind: 'processList',
      confidence: 1,
      parts: [{ messageKey: 'assistant.processList.empty' }],
      chips: []
    }
  }
  const items: ArisAnswerListItem[] = digests.map((d) => ({ text: d.modelName, chip: chipForDigest(d) }))
  return {
    kind: 'processList',
    confidence: 1,
    parts: [{ messageKey: 'assistant.processList.title', items }],
    chips: items.map((i) => i.chip).filter((c): c is ArisAnswerChip => !!c)
  }
}

// --- 11. Which process matches a topic? --------------------------------------

export function answerTopicMatch(digests: readonly ArisProcessDigest[], query: string): ArisAssistantAnswer {
  const ranked = rankDigests(digests, query, 5)
  if (ranked.length === 0) return noneAnswer()
  const items: ArisAnswerListItem[] = ranked.map((r) => ({ text: r.digest.modelName, chip: chipForDigest(r.digest) }))
  return {
    kind: 'topicMatch',
    confidence: scoreToConfidence(ranked[0].score),
    parts: [{ messageKey: 'assistant.topic.title', vars: { query }, items }],
    chips: items.map((i) => i.chip).filter((c): c is ArisAnswerChip => !!c)
  }
}
