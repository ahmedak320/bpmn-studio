/**
 * Wave 7 — Test Sequence 2 (create-from-PDF) recorded fixture + fuzzy scorers.
 *
 * This file is NOT a test suite (no `*.test.ts` suffix); it holds the RECORDED
 * provider response the mocked Seq-2 test feeds through the real
 * create-from-PDF pipeline, plus the pure similarity helpers the live Seq-2
 * test uses to compare a generated process against the AnimalWF original.
 *
 * ## The recorded response
 *
 * `SEQ2_RECORDED_DRAFT` is a plausible `ArisAiDraftV1` a capable model would
 * produce for the AnimalWF reference PDF
 * `reference/AnimalWF/pdf/Register_Animal_Owner_Profile_Draft03.pdf`. It is
 * hand-authored to mirror the goldens in
 * `reference/AnimalWF/expected/register-owner.expected.json` (same spine
 * wording, same satellite style), but reduced to the individual-applicant
 * branch with the business branch truncated and honestly flagged as an
 * uncertainty — exactly the shape a real model draft takes (partial, marked
 * up with uncertainties, logical ids only). It is fully self-contained so the
 * mocked test runs in CI where the private `reference/` tree does not exist.
 *
 * The draft is deliberately EPC-valid: one start event, explicit end events,
 * functions and events alternating along control flow, pure XOR splits
 * (never merges), and a function before every deciding rule — so it passes
 * `validateArisAiDraft` AND `validateArisAiDraftEpcSemantics` with zero
 * errors.
 */

import type { ArisAiDraftV1 } from './contract'

/** The provider/model the app defaults to for OpenRouter (providersLite.ts). */
export const SEQ2_OPENROUTER_MODEL_ID = 'z-ai/glm-5.2'

/**
 * The recorded draft. Logical ids are human-chosen slugs (never real ARIS
 * source ids — `scanForForbiddenContent` would reject those). Object names
 * reuse the English wording of the reference process verbatim where the PDF
 * is the authority.
 */
export const SEQ2_RECORDED_DRAFT: ArisAiDraftV1 = {
  version: 1,
  models: [
    {
      logicalId: 'model-main',
      modelType: 'MT_EEPC',
      names: { en: 'Request to Register Animal Owner Profile' },
      confidence: 'high'
    }
  ],
  objects: [
    {
      logicalId: 'evt-trigger',
      modelLogicalId: 'model-main',
      objectType: 'OT_EVT',
      names: { en: 'Pet owner registration Service triggered' },
      attributes: [],
      suggestedOrder: 1,
      confidence: 'high'
    },
    {
      logicalId: 'func-login',
      modelLogicalId: 'model-main',
      objectType: 'OT_FUNC',
      names: { en: 'Login to TAMM portal and select the Pet Owner Registration Service' },
      attributes: [
        {
          logicalId: 'attr-func-login-desc',
          ownerKind: 'object',
          ownerLogicalId: 'func-login',
          attributeType: 'AT_DESC',
          values: {
            en: 'The applicant logs in to the TAMM portal with UAE Pass and selects the Pet Owner Registration Service.'
          },
          confidence: 'medium'
        }
      ],
      suggestedOrder: 2,
      confidence: 'high'
    },
    {
      logicalId: 'rule-owner-type',
      modelLogicalId: 'model-main',
      objectType: 'OT_RULE',
      symbolType: 'ST_OPR_XOR_1',
      names: { en: 'XOR rule' },
      attributes: [],
      suggestedOrder: 3,
      confidence: 'high'
    },
    {
      logicalId: 'evt-individual',
      modelLogicalId: 'model-main',
      objectType: 'OT_EVT',
      names: { en: 'Pet Owner is individual' },
      attributes: [],
      suggestedOrder: 4,
      confidence: 'high'
    },
    {
      logicalId: 'func-check-eligibility',
      modelLogicalId: 'model-main',
      objectType: 'OT_FUNC',
      names: { en: 'System check the eligibility for Owner to proceed' },
      attributes: [],
      suggestedOrder: 5,
      confidence: 'high'
    },
    {
      logicalId: 'rule-eligibility',
      modelLogicalId: 'model-main',
      objectType: 'OT_RULE',
      symbolType: 'ST_OPR_XOR_1',
      names: { en: 'XOR rule' },
      attributes: [],
      suggestedOrder: 6,
      confidence: 'high'
    },
    {
      logicalId: 'evt-eligible',
      modelLogicalId: 'model-main',
      objectType: 'OT_EVT',
      names: { en: 'Applicant eligible' },
      attributes: [],
      suggestedOrder: 7,
      confidence: 'high'
    },
    {
      logicalId: 'func-verify-residence',
      modelLogicalId: 'model-main',
      objectType: 'OT_FUNC',
      names: { en: 'System verify residence details with Tawtheeq system' },
      attributes: [],
      suggestedOrder: 8,
      confidence: 'high'
    },
    {
      logicalId: 'rule-residence',
      modelLogicalId: 'model-main',
      objectType: 'OT_RULE',
      symbolType: 'ST_OPR_XOR_1',
      names: { en: 'XOR rule' },
      attributes: [],
      suggestedOrder: 9,
      confidence: 'high'
    },
    {
      logicalId: 'evt-verified',
      modelLogicalId: 'model-main',
      objectType: 'OT_EVT',
      names: { en: 'Residence details has been verified' },
      attributes: [],
      suggestedOrder: 10,
      confidence: 'high'
    },
    {
      logicalId: 'func-auto-approve',
      modelLogicalId: 'model-main',
      objectType: 'OT_FUNC',
      names: {
        en: 'Auto approve the request and generate the Owner registration number and details'
      },
      attributes: [],
      suggestedOrder: 11,
      confidence: 'high'
    },
    {
      logicalId: 'evt-registered',
      modelLogicalId: 'model-main',
      objectType: 'OT_EVT',
      names: { en: 'Applicant has been registered' },
      attributes: [],
      suggestedOrder: 12,
      confidence: 'high'
    },
    {
      logicalId: 'evt-not-verified',
      modelLogicalId: 'model-main',
      objectType: 'OT_EVT',
      names: { en: 'Residence details has not been verified' },
      attributes: [],
      suggestedOrder: 13,
      confidence: 'high'
    },
    {
      logicalId: 'func-upload-lease',
      modelLogicalId: 'model-main',
      objectType: 'OT_FUNC',
      names: { en: 'Upload copy of lease/ deed contract' },
      attributes: [],
      suggestedOrder: 14,
      confidence: 'high'
    },
    {
      logicalId: 'evt-lease-uploaded',
      modelLogicalId: 'model-main',
      objectType: 'OT_EVT',
      names: { en: 'Lease contract uploaded' },
      attributes: [],
      suggestedOrder: 15,
      confidence: 'medium'
    },
    {
      logicalId: 'evt-not-eligible',
      modelLogicalId: 'model-main',
      objectType: 'OT_EVT',
      names: { en: 'Applicant not eligible' },
      attributes: [],
      suggestedOrder: 16,
      confidence: 'high'
    },
    {
      logicalId: 'func-terminate',
      modelLogicalId: 'model-main',
      objectType: 'OT_FUNC',
      names: {
        en: 'System terminate the service request and notify the applicant about the reasons'
      },
      attributes: [],
      suggestedOrder: 17,
      confidence: 'high'
    },
    {
      logicalId: 'evt-terminated',
      modelLogicalId: 'model-main',
      objectType: 'OT_EVT',
      names: { en: 'Service terminated' },
      attributes: [],
      suggestedOrder: 18,
      confidence: 'high'
    },
    {
      logicalId: 'evt-business',
      modelLogicalId: 'model-main',
      objectType: 'OT_EVT',
      names: { en: 'Pet Owner is Business Entity' },
      attributes: [],
      suggestedOrder: 19,
      confidence: 'high'
    },
    {
      logicalId: 'func-check-business',
      modelLogicalId: 'model-main',
      objectType: 'OT_FUNC',
      names: { en: 'System checks if the business is a registered entity for DMT services' },
      attributes: [],
      suggestedOrder: 20,
      confidence: 'medium'
    },
    {
      logicalId: 'evt-business-registered',
      modelLogicalId: 'model-main',
      objectType: 'OT_EVT',
      names: { en: 'The Business is a registered entity for DMT services' },
      attributes: [],
      suggestedOrder: 21,
      confidence: 'medium'
    },
    {
      logicalId: 'pers-pet-owner',
      modelLogicalId: 'model-main',
      objectType: 'OT_PERS',
      names: { en: 'Pet Owner' },
      attributes: [],
      confidence: 'high'
    },
    {
      logicalId: 'appl-tamm',
      modelLogicalId: 'model-main',
      objectType: 'OT_APPL_SYS',
      names: { en: 'TAMM' },
      attributes: [],
      confidence: 'high'
    },
    {
      logicalId: 'appl-uae-pass',
      modelLogicalId: 'model-main',
      objectType: 'OT_APPL_SYS',
      names: { en: 'UAE Pass' },
      attributes: [],
      confidence: 'medium'
    },
    {
      logicalId: 'info-lease',
      modelLogicalId: 'model-main',
      objectType: 'OT_INFO_CARR',
      names: { en: 'Copy of lease/ deed contract' },
      attributes: [],
      confidence: 'medium'
    },
    {
      logicalId: 'ent-owner-reg-number',
      modelLogicalId: 'model-main',
      objectType: 'OT_ENT_TYPE',
      names: { en: 'Owner Registration Number' },
      attributes: [],
      confidence: 'medium'
    }
  ],
  relations: [
    {
      logicalId: 'rel-trigger-login',
      modelLogicalId: 'model-main',
      sourceLogicalId: 'evt-trigger',
      targetLogicalId: 'func-login',
      connectionType: 'CT_ACTIV_1',
      confidence: 'high'
    },
    {
      logicalId: 'rel-login-owner-type',
      modelLogicalId: 'model-main',
      sourceLogicalId: 'func-login',
      targetLogicalId: 'rule-owner-type',
      connectionType: 'CT_LEADS_TO_1',
      confidence: 'high'
    },
    {
      logicalId: 'rel-owner-type-individual',
      modelLogicalId: 'model-main',
      sourceLogicalId: 'rule-owner-type',
      targetLogicalId: 'evt-individual',
      connectionType: 'CT_LEADS_TO_2',
      confidence: 'high'
    },
    {
      logicalId: 'rel-owner-type-business',
      modelLogicalId: 'model-main',
      sourceLogicalId: 'rule-owner-type',
      targetLogicalId: 'evt-business',
      connectionType: 'CT_LEADS_TO_2',
      confidence: 'high'
    },
    {
      logicalId: 'rel-individual-eligibility',
      modelLogicalId: 'model-main',
      sourceLogicalId: 'evt-individual',
      targetLogicalId: 'func-check-eligibility',
      connectionType: 'CT_ACTIV_1',
      confidence: 'high'
    },
    {
      logicalId: 'rel-eligibility-rule',
      modelLogicalId: 'model-main',
      sourceLogicalId: 'func-check-eligibility',
      targetLogicalId: 'rule-eligibility',
      connectionType: 'CT_LEADS_TO_1',
      confidence: 'high'
    },
    {
      logicalId: 'rel-eligibility-eligible',
      modelLogicalId: 'model-main',
      sourceLogicalId: 'rule-eligibility',
      targetLogicalId: 'evt-eligible',
      connectionType: 'CT_LEADS_TO_2',
      confidence: 'high'
    },
    {
      logicalId: 'rel-eligibility-not-eligible',
      modelLogicalId: 'model-main',
      sourceLogicalId: 'rule-eligibility',
      targetLogicalId: 'evt-not-eligible',
      connectionType: 'CT_LEADS_TO_2',
      confidence: 'high'
    },
    {
      logicalId: 'rel-eligible-verify',
      modelLogicalId: 'model-main',
      sourceLogicalId: 'evt-eligible',
      targetLogicalId: 'func-verify-residence',
      connectionType: 'CT_ACTIV_1',
      confidence: 'high'
    },
    {
      logicalId: 'rel-verify-rule',
      modelLogicalId: 'model-main',
      sourceLogicalId: 'func-verify-residence',
      targetLogicalId: 'rule-residence',
      connectionType: 'CT_LEADS_TO_1',
      confidence: 'high'
    },
    {
      logicalId: 'rel-residence-verified',
      modelLogicalId: 'model-main',
      sourceLogicalId: 'rule-residence',
      targetLogicalId: 'evt-verified',
      connectionType: 'CT_LEADS_TO_2',
      confidence: 'high'
    },
    {
      logicalId: 'rel-residence-not-verified',
      modelLogicalId: 'model-main',
      sourceLogicalId: 'rule-residence',
      targetLogicalId: 'evt-not-verified',
      connectionType: 'CT_LEADS_TO_2',
      confidence: 'high'
    },
    {
      logicalId: 'rel-verified-auto-approve',
      modelLogicalId: 'model-main',
      sourceLogicalId: 'evt-verified',
      targetLogicalId: 'func-auto-approve',
      connectionType: 'CT_ACTIV_1',
      confidence: 'high'
    },
    {
      logicalId: 'rel-auto-approve-registered',
      modelLogicalId: 'model-main',
      sourceLogicalId: 'func-auto-approve',
      targetLogicalId: 'evt-registered',
      connectionType: 'CT_CRT_1',
      confidence: 'high'
    },
    {
      logicalId: 'rel-not-verified-upload',
      modelLogicalId: 'model-main',
      sourceLogicalId: 'evt-not-verified',
      targetLogicalId: 'func-upload-lease',
      connectionType: 'CT_ACTIV_1',
      confidence: 'high'
    },
    {
      logicalId: 'rel-upload-lease-uploaded',
      modelLogicalId: 'model-main',
      sourceLogicalId: 'func-upload-lease',
      targetLogicalId: 'evt-lease-uploaded',
      connectionType: 'CT_CRT_1',
      confidence: 'medium'
    },
    {
      logicalId: 'rel-not-eligible-terminate',
      modelLogicalId: 'model-main',
      sourceLogicalId: 'evt-not-eligible',
      targetLogicalId: 'func-terminate',
      connectionType: 'CT_ACTIV_1',
      confidence: 'high'
    },
    {
      logicalId: 'rel-terminate-terminated',
      modelLogicalId: 'model-main',
      sourceLogicalId: 'func-terminate',
      targetLogicalId: 'evt-terminated',
      connectionType: 'CT_CRT_1',
      confidence: 'high'
    },
    {
      logicalId: 'rel-business-check-business',
      modelLogicalId: 'model-main',
      sourceLogicalId: 'evt-business',
      targetLogicalId: 'func-check-business',
      connectionType: 'CT_ACTIV_1',
      confidence: 'medium'
    },
    {
      logicalId: 'rel-check-business-registered',
      modelLogicalId: 'model-main',
      sourceLogicalId: 'func-check-business',
      targetLogicalId: 'evt-business-registered',
      connectionType: 'CT_CRT_1',
      confidence: 'medium'
    },
    {
      logicalId: 'rel-owner-executes-login',
      modelLogicalId: 'model-main',
      sourceLogicalId: 'pers-pet-owner',
      targetLogicalId: 'func-login',
      connectionType: 'CT_EXEC_1',
      confidence: 'high'
    },
    {
      logicalId: 'rel-tamm-supports-login',
      modelLogicalId: 'model-main',
      sourceLogicalId: 'appl-tamm',
      targetLogicalId: 'func-login',
      connectionType: 'CT_SUPP_3',
      confidence: 'high'
    },
    {
      logicalId: 'rel-uae-pass-supports-eligibility',
      modelLogicalId: 'model-main',
      sourceLogicalId: 'appl-uae-pass',
      targetLogicalId: 'func-check-eligibility',
      connectionType: 'CT_SUPP_3',
      confidence: 'medium'
    },
    {
      logicalId: 'rel-tamm-supports-verify',
      modelLogicalId: 'model-main',
      sourceLogicalId: 'appl-tamm',
      targetLogicalId: 'func-verify-residence',
      connectionType: 'CT_SUPP_3',
      confidence: 'medium'
    },
    {
      logicalId: 'rel-upload-outputs-lease',
      modelLogicalId: 'model-main',
      sourceLogicalId: 'func-upload-lease',
      targetLogicalId: 'info-lease',
      connectionType: 'CT_CRT_OUT_TO',
      confidence: 'medium'
    },
    {
      logicalId: 'rel-approve-has-reg-number',
      modelLogicalId: 'model-main',
      sourceLogicalId: 'func-auto-approve',
      targetLogicalId: 'ent-owner-reg-number',
      connectionType: 'CT_HAS_OUT',
      confidence: 'medium'
    },
    {
      logicalId: 'rel-owner-informed-approve',
      modelLogicalId: 'model-main',
      sourceLogicalId: 'pers-pet-owner',
      targetLogicalId: 'func-auto-approve',
      connectionType: 'CT_MUST_BE_INFO_ABT_1',
      confidence: 'low'
    }
  ],
  attributes: [
    {
      logicalId: 'attr-model-main-desc',
      ownerKind: 'model',
      ownerLogicalId: 'model-main',
      attributeType: 'AT_DESC',
      values: {
        en: 'Registers a new animal owner profile for an individual or a business applicant through the TAMM portal.'
      },
      confidence: 'medium'
    }
  ],
  assignments: [],
  uncertainties: [
    {
      targetLogicalId: 'model-main',
      kind: 'missing-translation',
      field: 'names.ar',
      message:
        'The source document header is bilingual, but the Arabic process name could not be read with confidence from the PDF.'
    },
    {
      targetLogicalId: 'evt-business-registered',
      kind: 'other',
      message:
        'The business-entity branch continues with further DMT service checks in the source document; only its first step is modelled here.'
    }
  ]
}

/**
 * The recorded model turn as raw text — fenced, the way glm-style models
 * commonly wrap JSON output. `parseArisAiResponseJson` tolerates exactly
 * this shape.
 */
export const SEQ2_RECORDED_RESPONSE_TEXT = `\`\`\`json\n${JSON.stringify(SEQ2_RECORDED_DRAFT, null, 2)}\n\`\`\``

/**
 * A recorded-shaped OpenRouter chat/completions body carrying arbitrary
 * assistant `content`. Returns a fresh object per call so a test can mutate
 * usage counters without cross-test bleed.
 */
export function buildSeq2OpenRouterBody(content: string): Record<string, unknown> {
  return {
    id: 'gen-seq2-recorded-0001',
    model: SEQ2_OPENROUTER_MODEL_ID,
    created: 1_789_000_000,
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content },
        finish_reason: 'stop'
      }
    ],
    usage: { prompt_tokens: 9_820, completion_tokens: 1_940, total_tokens: 11_760 }
  }
}

/**
 * A recorded OpenRouter chat/completions body carrying
 * {@link SEQ2_RECORDED_RESPONSE_TEXT}.
 */
export function buildSeq2RecordedOpenRouterBody(): Record<string, unknown> {
  return buildSeq2OpenRouterBody(SEQ2_RECORDED_RESPONSE_TEXT)
}

// --- fuzzy similarity scorers (live Seq-2) ---------------------------------

/**
 * A countable, nameable summary of one process drawing — built from the
 * AnimalWF `*.expected.json` goldens (expected side) or from a validated
 * `ArisAiDraftV1` (actual side).
 */
export interface Seq2ProcessSummary {
  readonly functions: number
  readonly events: number
  readonly rules: number
  readonly satellites: number
  readonly connections: number
  readonly functionNames: readonly string[]
  readonly eventNames: readonly string[]
}

/**
 * Tokenize a step name for fuzzy matching: lowercase, strip punctuation,
 * drop one-character tokens (articles/prepositions dominate otherwise).
 */
export function seq2NameTokens(name: string): ReadonlySet<string> {
  const tokens = name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 1)
  return new Set(tokens)
}

/** Jaccard similarity over the token sets of two step names, in [0, 1]. */
export function seq2NameSimilarity(left: string, right: string): number {
  const leftTokens = seq2NameTokens(left)
  const rightTokens = seq2NameTokens(right)
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0
  let intersection = 0
  for (const token of leftTokens) {
    if (rightTokens.has(token)) intersection += 1
  }
  return intersection / (leftTokens.size + rightTokens.size - intersection)
}

/**
 * Fraction of `expected` names that have at least one `actual` name whose
 * token-Jaccard similarity reaches `matchThreshold`. `actual` should be the
 * WHOLE spine (function + event names): a model that types a step
 * differently but keeps its wording still counts as recovering the step —
 * the type mix is scored separately by
 * {@link seq2TypeDistributionSimilarity}.
 */
export function seq2NameRecall(
  expected: readonly string[],
  actual: readonly string[],
  matchThreshold = 0.5
): number {
  if (expected.length === 0) return 1
  let hits = 0
  for (const name of expected) {
    if (actual.some((candidate) => seq2NameSimilarity(name, candidate) >= matchThreshold)) {
      hits += 1
    }
  }
  return hits / expected.length
}

/**
 * Similarity of the object-type mix over [functions, events, rules,
 * satellites]: one minus the total-variation distance of the two
 * distributions, in [0, 1]. Empty/empty compares as identical.
 */
export function seq2TypeDistributionSimilarity(
  expected: Seq2ProcessSummary,
  actual: Seq2ProcessSummary
): number {
  const pick = (summary: Seq2ProcessSummary): readonly number[] => [
    summary.functions,
    summary.events,
    summary.rules,
    summary.satellites
  ]
  const expectedCounts = pick(expected)
  const actualCounts = pick(actual)
  const expectedTotal = expectedCounts.reduce((sum, count) => sum + count, 0)
  const actualTotal = actualCounts.reduce((sum, count) => sum + count, 0)
  if (expectedTotal === 0 && actualTotal === 0) return 1
  if (expectedTotal === 0 || actualTotal === 0) return 0
  let distance = 0
  for (let index = 0; index < expectedCounts.length; index += 1) {
    distance += Math.abs(expectedCounts[index] / expectedTotal - actualCounts[index] / actualTotal)
  }
  return 1 - distance / 2
}

/** Ratio of two counts in [0, 1]: min/max, with 0/0 defined as identical. */
export function seq2CountRatio(expected: number, actual: number): number {
  if (expected === 0 && actual === 0) return 1
  const larger = Math.max(expected, actual)
  return larger === 0 ? 1 : Math.min(expected, actual) / larger
}

export interface Seq2SimilarityBreakdown {
  /** How many original spine FUNCTION steps reappear (fuzzy) in the draft. */
  readonly functionNameRecall: number
  /** How many original spine EVENT steps reappear (fuzzy) in the draft. */
  readonly eventNameRecall: number
  /** Object-type mix agreement. */
  readonly typeDistribution: number
  /** Connection-count agreement (min/max). */
  readonly connectionRatio: number
  /** Weighted composite in [0, 1]. */
  readonly score: number
}

/**
 * Composite "same drawing" score for the live Seq-2 comparison. Weights
 * favour recovering the named steps of the process (0.35 functions + 0.25
 * events) over the aggregate shape (0.20 type mix + 0.20 connection count):
 * a draft that re-found the actual business steps but drew slightly fewer
 * satellites still demonstrates the PDF was understood.
 */
export function seq2SimilarityScore(
  expected: Seq2ProcessSummary,
  actual: Seq2ProcessSummary
): Seq2SimilarityBreakdown {
  const actualSpineNames = [...actual.functionNames, ...actual.eventNames]
  const parts = {
    functionNameRecall: seq2NameRecall(expected.functionNames, actualSpineNames),
    eventNameRecall: seq2NameRecall(expected.eventNames, actualSpineNames),
    typeDistribution: seq2TypeDistributionSimilarity(expected, actual),
    connectionRatio: seq2CountRatio(expected.connections, actual.connections)
  }
  const score =
    0.35 * parts.functionNameRecall +
    0.25 * parts.eventNameRecall +
    0.2 * parts.typeDistribution +
    0.2 * parts.connectionRatio
  return { ...parts, score }
}

/**
 * Project a validated draft onto the fuzzy-comparison summary. Exported so
 * the live test and its mocked sibling summarize drafts identically.
 */
export function seq2SummaryFromDraft(draft: ArisAiDraftV1): Seq2ProcessSummary {
  const byType = (type: string) => draft.objects.filter((object) => object.objectType === type)
  const functions = byType('OT_FUNC')
  const events = byType('OT_EVT')
  const rules = byType('OT_RULE')
  return {
    functions: functions.length,
    events: events.length,
    rules: rules.length,
    satellites: draft.objects.length - functions.length - events.length - rules.length,
    connections: draft.relations.length,
    functionNames: functions.map((object) => object.names.en ?? ''),
    eventNames: events.map((object) => object.names.en ?? '')
  }
}
