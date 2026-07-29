/**
 * ArisAiDraftV1 — the AI output contract for Phase 13 ("Create with AI").
 *
 * Source: aris_transformation.md Section 16.4. The `ArisAiObject` and
 * `ArisAiRelation` shapes below are transcribed verbatim from the plan,
 * including field names and the `confidence` union. The plan's code block
 * does not spell out `ArisAiModel`, `ArisAiAttribute`, `ArisAiAssignment`, or
 * `ArisAiUncertainty` — those are designed here to satisfy the surrounding
 * prose:
 *
 *  - `ArisAiModel` — one entry per model the draft proposes to create
 *    (Section 16.1/16.2: Description/PDF/Excel create tabs each target a
 *    model; Section 16.6 step 13 "Generate deterministic clean layout" and
 *    step 14 "canonical AML revision zero" both operate per model).
 *  - `ArisAiAttribute` — reused as both `ArisAiObject.attributes` (inline,
 *    object-owned) and the top-level `ArisAiDraftV1.attributes` (flat list).
 *    Because `ArisAiRelation` and `ArisAiModel` carry no inline `attributes`
 *    field of their own, the flat top-level list is the only way to attach
 *    an attribute to a relation or a model, so `ArisAiAttribute` carries an
 *    explicit `ownerKind`/`ownerLogicalId` pair. When an attribute is
 *    embedded inside `ArisAiObject.attributes`, `ownerKind` must be
 *    `'object'` and `ownerLogicalId` must equal the containing object's
 *    `logicalId` — this is checked by `validateLogicalIdIntegrity`
 *    (see logicalIntegrity.ts).
 *  - `ArisAiAssignment` — Section 11.4 lists "Add/remove linked-model
 *    assignment" as a first-class authoring operation, and Section 16.6
 *    step 15 requires the preview to surface "linked-model candidates"
 *    distinctly from uncertainties. `ArisAiAssignment` models exactly that:
 *    an object linked to a model it does not itself belong to.
 *  - `ArisAiUncertainty` — Section 16.5 requires the model to "mark
 *    uncertainty instead of inventing details" and "mark missing
 *    translations"; Section 16.6 step 15 requires the preview to show
 *    "uncertainties, missing fields". `kind` distinguishes those cases so
 *    the preview can group them.
 *
 * Security property (Section 16.4, closing sentence): "The AI must not emit
 * raw AML, real ARIS IDs, XML, coordinates, or unreviewed executable
 * content." This module defines the shape only. The rejection pass that
 * enforces the security property lives in forbiddenContent.ts and is run by
 * validateDraft.ts before/alongside schema parsing — see that module for
 * the enforcement code and forbiddenContent.test.ts for the adversarial
 * tests.
 *
 * Strictness: every zod object schema below is built with `z.strictObject`
 * (unknown keys rejected) and there is no `.default()`/coercion anywhere.
 * A provider response with an extra field fails validation instead of
 * silently passing.
 */

import { z } from 'zod'

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

/** Section 16.4: every object/relation/attribute/assignment carries this. */
export type ArisAiConfidence = 'high' | 'medium' | 'low'

export const ArisAiConfidenceSchema = z.enum(['high', 'medium', 'low'])

/**
 * Bilingual text carrier. Section 16.5: "Preserve bilingual content found in
 * source" / "Mark missing translations" — both keys are optional so the
 * model can supply one, both, or (with an `ArisAiUncertainty` entry) neither
 * while flagging why.
 */
export interface ArisAiLocalizedText {
  readonly en?: string
  readonly ar?: string
}

export const ArisAiLocalizedTextSchema = z
  .strictObject({
    en: z.string().min(1).optional(),
    ar: z.string().min(1).optional()
  })
  .strict()

/**
 * Supported model types (Section 11.2 / Section 16.4). Defined locally
 * rather than imported from `src/aris/model/types.ts` to keep this lane's
 * contract self-contained while another agent reshapes that module — see
 * the "seams" note in the top-level report.
 *
 * `ArisAiModel.modelType` itself stays a plain `string` at the shape-schema
 * layer (below), matching the pattern the plan's own snippet uses for
 * `ArisAiObject.objectType`/`ArisAiRelation.connectionType` (also plain
 * `string`, not a union): the *shape* schema (`ArisAiDraftV1Schema`, step 7
 * of Section 16.6) intentionally accepts any string, and the *closed*
 * vocabulary is enforced as a separate, structured-finding step 8 check —
 * see typeValidation.ts. This constant is that vocabulary's single source
 * of truth; typeValidation.ts imports it rather than redeclaring it.
 */
export type ArisAiSupportedModelType = 'MT_EEPC' | 'MT_VAL_ADD_CHN_DGM'

export const ARIS_AI_SUPPORTED_MODEL_TYPES = ['MT_EEPC', 'MT_VAL_ADD_CHN_DGM'] as const

// ---------------------------------------------------------------------------
// ArisAiModel
// ---------------------------------------------------------------------------

export interface ArisAiModel {
  readonly logicalId: string
  /** Open string at the shape layer; validated against the closed set in typeValidation.ts (step 8). */
  readonly modelType: string
  readonly names: ArisAiLocalizedText
  readonly confidence: ArisAiConfidence
}

export const ArisAiModelSchema = z
  .strictObject({
    logicalId: z.string().min(1),
    modelType: z.string().min(1),
    names: ArisAiLocalizedTextSchema,
    confidence: ArisAiConfidenceSchema
  })
  .strict()

// ---------------------------------------------------------------------------
// ArisAiAttribute
// ---------------------------------------------------------------------------

export type ArisAiAttributeOwnerKind = 'model' | 'object' | 'relation'

export const ARIS_AI_ATTRIBUTE_OWNER_KINDS = ['model', 'object', 'relation'] as const

export interface ArisAiAttribute {
  readonly logicalId: string
  readonly ownerKind: ArisAiAttributeOwnerKind
  readonly ownerLogicalId: string
  readonly attributeType: string
  readonly values: ArisAiLocalizedText
  readonly evidence?: string
  readonly confidence: ArisAiConfidence
}

export const ArisAiAttributeSchema = z
  .strictObject({
    logicalId: z.string().min(1),
    ownerKind: z.enum(ARIS_AI_ATTRIBUTE_OWNER_KINDS),
    ownerLogicalId: z.string().min(1),
    attributeType: z.string().min(1),
    values: ArisAiLocalizedTextSchema,
    evidence: z.string().min(1).optional(),
    confidence: ArisAiConfidenceSchema
  })
  .strict()

// ---------------------------------------------------------------------------
// ArisAiObject — transcribed verbatim from Section 16.4
// ---------------------------------------------------------------------------

export interface ArisAiObject {
  readonly logicalId: string
  readonly modelLogicalId: string
  readonly objectType: string
  readonly symbolType?: string
  readonly names: ArisAiLocalizedText
  readonly attributes: readonly ArisAiAttribute[]
  readonly suggestedOrder?: number
  readonly evidence?: string
  readonly confidence: ArisAiConfidence
}

export const ArisAiObjectSchema = z
  .strictObject({
    logicalId: z.string().min(1),
    modelLogicalId: z.string().min(1),
    objectType: z.string().min(1),
    symbolType: z.string().min(1).optional(),
    names: ArisAiLocalizedTextSchema,
    attributes: z.array(ArisAiAttributeSchema),
    suggestedOrder: z.number().int().finite().optional(),
    evidence: z.string().min(1).optional(),
    confidence: ArisAiConfidenceSchema
  })
  .strict()

// ---------------------------------------------------------------------------
// ArisAiRelation — transcribed verbatim from Section 16.4
// ---------------------------------------------------------------------------

export interface ArisAiRelation {
  readonly logicalId: string
  readonly modelLogicalId: string
  readonly sourceLogicalId: string
  readonly targetLogicalId: string
  readonly connectionType: string
  readonly names?: ArisAiLocalizedText
  readonly returnOutcome?: boolean
  readonly confidence: ArisAiConfidence
}

export const ArisAiRelationSchema = z
  .strictObject({
    logicalId: z.string().min(1),
    modelLogicalId: z.string().min(1),
    sourceLogicalId: z.string().min(1),
    targetLogicalId: z.string().min(1),
    connectionType: z.string().min(1),
    names: ArisAiLocalizedTextSchema.optional(),
    returnOutcome: z.boolean().optional(),
    confidence: ArisAiConfidenceSchema
  })
  .strict()

// ---------------------------------------------------------------------------
// ArisAiAssignment — linked-model assignment (Section 11.4, Section 16.6 step 15)
// ---------------------------------------------------------------------------

export type ArisAiAssignmentType = 'linked-model'

export const ARIS_AI_ASSIGNMENT_TYPES = ['linked-model'] as const

export interface ArisAiAssignment {
  readonly logicalId: string
  readonly assignmentType: ArisAiAssignmentType
  readonly objectLogicalId: string
  readonly assignedModelLogicalId: string
  readonly confidence: ArisAiConfidence
}

export const ArisAiAssignmentSchema = z
  .strictObject({
    logicalId: z.string().min(1),
    assignmentType: z.enum(ARIS_AI_ASSIGNMENT_TYPES),
    objectLogicalId: z.string().min(1),
    assignedModelLogicalId: z.string().min(1),
    confidence: ArisAiConfidenceSchema
  })
  .strict()

// ---------------------------------------------------------------------------
// ArisAiUncertainty — Section 16.5 "mark uncertainty"/"mark missing
// translations"; Section 16.6 step 15 preview grouping.
// ---------------------------------------------------------------------------

export type ArisAiUncertaintyKind =
  'missing-field' | 'missing-translation' | 'ambiguous-mapping' | 'unclear-symbol' | 'other'

export const ARIS_AI_UNCERTAINTY_KINDS = [
  'missing-field',
  'missing-translation',
  'ambiguous-mapping',
  'unclear-symbol',
  'other'
] as const

export interface ArisAiUncertainty {
  readonly targetLogicalId: string
  readonly kind: ArisAiUncertaintyKind
  readonly field?: string
  readonly message: string
  readonly evidence?: string
}

export const ArisAiUncertaintySchema = z
  .strictObject({
    targetLogicalId: z.string().min(1),
    kind: z.enum(ARIS_AI_UNCERTAINTY_KINDS),
    field: z.string().min(1).optional(),
    message: z.string().min(1),
    evidence: z.string().min(1).optional()
  })
  .strict()

// ---------------------------------------------------------------------------
// ArisAiDraftV1 — transcribed verbatim from Section 16.4
// ---------------------------------------------------------------------------

export interface ArisAiDraftV1 {
  readonly version: 1
  readonly models: readonly ArisAiModel[]
  readonly objects: readonly ArisAiObject[]
  readonly relations: readonly ArisAiRelation[]
  readonly attributes: readonly ArisAiAttribute[]
  readonly assignments: readonly ArisAiAssignment[]
  readonly uncertainties: readonly ArisAiUncertainty[]
}

export const ArisAiDraftV1Schema = z
  .strictObject({
    version: z.literal(1),
    models: z.array(ArisAiModelSchema),
    objects: z.array(ArisAiObjectSchema),
    relations: z.array(ArisAiRelationSchema),
    attributes: z.array(ArisAiAttributeSchema),
    assignments: z.array(ArisAiAssignmentSchema),
    uncertainties: z.array(ArisAiUncertaintySchema)
  })
  .strict()
