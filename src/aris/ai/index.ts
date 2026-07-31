/**
 * Public surface for the ARIS AI draft schema, prompt builder, and draft
 * validation (Phase 13 — Sections 16.4, 16.5, and the validation steps of
 * 16.6). See each module for detailed documentation:
 *
 *  - contract.ts          ArisAiDraftV1 and friends, plus their zod schemas.
 *  - findings.ts           Shared structured-finding shape.
 *  - forbiddenContent.ts   Section 16.4 security rejection pass.
 *  - typeValidation.ts     Section 16.6 step 8 object/model/connection types.
 *  - logicalIntegrity.ts   Logical-id graph integrity.
 *  - validateDraft.ts      Top-level orchestration (`validateArisAiDraft`).
 *  - promptBuilder.ts      Section 16.5 system/user prompt construction.
 *  - repairTurn.ts         Section 16.6 step 10 repair-turn state machine.
 */

export type {
  ArisAiAssignment,
  ArisAiAssignmentType,
  ArisAiAttribute,
  ArisAiAttributeOwnerKind,
  ArisAiConfidence,
  ArisAiDraftV1,
  ArisAiLocalizedText,
  ArisAiModel,
  ArisAiObject,
  ArisAiRelation,
  ArisAiSupportedModelType,
  ArisAiUncertainty,
  ArisAiUncertaintyKind
} from './contract'

export {
  ARIS_AI_ASSIGNMENT_TYPES,
  ARIS_AI_ATTRIBUTE_OWNER_KINDS,
  ARIS_AI_SUPPORTED_MODEL_TYPES,
  ARIS_AI_UNCERTAINTY_KINDS,
  ArisAiAssignmentSchema,
  ArisAiAttributeSchema,
  ArisAiConfidenceSchema,
  ArisAiDraftV1Schema,
  ArisAiLocalizedTextSchema,
  ArisAiModelSchema,
  ArisAiObjectSchema,
  ArisAiRelationSchema,
  ArisAiUncertaintySchema
} from './contract'

export type { ArisAiValidationFinding } from './findings'
export { finding } from './findings'

export { scanForForbiddenContent } from './forbiddenContent'

export {
  ARIS_AI_SUPPORTED_CONNECTION_TYPES,
  ARIS_AI_SUPPORTED_OBJECT_TYPES,
  ARIS_AI_SUPPORTED_RULE_SYMBOL_TYPES,
  validateArisAiTypes
} from './typeValidation'

export { validateLogicalIdIntegrity } from './logicalIntegrity'

export {
  NORMALIZED_CONNECTION_FINDING_CODE,
  NORMALIZED_MODEL_TYPE_FINDING_CODE,
  NORMALIZED_VERSION_FINDING_CODE,
  normalizeArisAiDraft
} from './normalizeDraft'

export type { ArisAiEpcSemanticsResult } from './epcSemantics'
export { validateArisAiDraftEpcSemantics } from './epcSemantics'

export type { ArisAiValidationResult } from './validateDraft'
export { validateArisAiDraft } from './validateDraft'

export type { ArisAiPrompt, ArisAiPromptInput, ArisAiPromptModelType } from './promptBuilder'
export { buildArisAiPrompt, fenceUntrustedText } from './promptBuilder'

export type {
  ArisAiRepairAdvanceInput,
  ArisAiRepairAdvanceResult,
  ArisAiRepairFailureClass,
  ArisAiRepairMessageInput,
  ArisAiRepairState
} from './repairTurn'
export {
  INITIAL_ARIS_AI_REPAIR_STATE,
  MAX_SEMANTIC_REPAIR_ATTEMPTS,
  advanceArisAiRepairState,
  buildArisAiRepairMessage
} from './repairTurn'
