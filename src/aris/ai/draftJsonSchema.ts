/**
 * Enum-locked JSON Schema for `ArisAiDraftV1` (Wave 8 M5).
 *
 * Sent as OpenRouter `response_format: { type: 'json_schema', strict: true }`
 * on routes whose endpoint advertises `structured_outputs`. Its point is the
 * `relation.connectionType` enum: on a schema-enforcing route the classic
 * `CT_FLOW` failure becomes UNREPRESENTABLE, killing the invented-code class at
 * the source. Every other enum (objectType, modelType, ownerKind, assignment
 * type, uncertainty kind, confidence) is locked the same way.
 *
 * This is hand-written to mirror `contract.ts` EXACTLY — no zod-to-json-schema
 * dependency is added (the artifact is a single-file bundle and its size is a
 * shipping constraint). `draftJsonSchema.test.ts` guards drift by asserting each
 * enum equals its exported vocabulary constant.
 *
 * `required` mirrors zod optionality precisely: an OPTIONAL field is omitted
 * from `required` AND is not made nullable — zod `.optional()` rejects an
 * explicit `null`, so a nullable schema would let a model emit drafts the
 * validator then rejects. `symbolType` is deliberately left a FREE string (not
 * locked to the rule operators): `buildAmlFromArisAiDraft` reads
 * `object.symbolType ?? DEFAULT_SYMBOLS[…]` for ALL object types, so locking it
 * would destroy legitimate satellite symbol choices; the rule-symbol vocabulary
 * is still enforced for OT_RULE by typeValidation.ts.
 */

import {
  ARIS_AI_ASSIGNMENT_TYPES,
  ARIS_AI_ATTRIBUTE_OWNER_KINDS,
  ARIS_AI_SUPPORTED_MODEL_TYPES,
  ARIS_AI_UNCERTAINTY_KINDS
} from './contract'
import {
  ARIS_AI_SUPPORTED_CONNECTION_TYPES,
  ARIS_AI_SUPPORTED_OBJECT_TYPES
} from './typeValidation'

/** Confidence union, mirroring `ArisAiConfidenceSchema`. */
const CONFIDENCE_VALUES = ['high', 'medium', 'low'] as const

function nonEmptyString(): Record<string, unknown> {
  return { type: 'string', minLength: 1 }
}

/** `ArisAiLocalizedTextSchema`: optional en/ar, no required keys, strict. */
function localizedTextSchema(): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      en: nonEmptyString(),
      ar: nonEmptyString()
    }
  }
}

function confidenceSchema(): Record<string, unknown> {
  return { type: 'string', enum: [...CONFIDENCE_VALUES] }
}

function attributeSchema(): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['logicalId', 'ownerKind', 'ownerLogicalId', 'attributeType', 'values', 'confidence'],
    properties: {
      logicalId: nonEmptyString(),
      ownerKind: { type: 'string', enum: [...ARIS_AI_ATTRIBUTE_OWNER_KINDS] },
      ownerLogicalId: nonEmptyString(),
      attributeType: nonEmptyString(),
      values: localizedTextSchema(),
      evidence: nonEmptyString(),
      confidence: confidenceSchema()
    }
  }
}

function modelSchema(): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['logicalId', 'modelType', 'names', 'confidence'],
    properties: {
      logicalId: nonEmptyString(),
      modelType: { type: 'string', enum: [...ARIS_AI_SUPPORTED_MODEL_TYPES] },
      names: localizedTextSchema(),
      confidence: confidenceSchema()
    }
  }
}

function objectSchema(): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['logicalId', 'modelLogicalId', 'objectType', 'names', 'attributes', 'confidence'],
    properties: {
      logicalId: nonEmptyString(),
      modelLogicalId: nonEmptyString(),
      objectType: { type: 'string', enum: [...ARIS_AI_SUPPORTED_OBJECT_TYPES] },
      // Free string on purpose — see the module header.
      symbolType: nonEmptyString(),
      names: localizedTextSchema(),
      attributes: { type: 'array', items: attributeSchema() },
      suggestedOrder: { type: 'integer' },
      evidence: nonEmptyString(),
      confidence: confidenceSchema()
    }
  }
}

function relationSchema(): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    required: [
      'logicalId',
      'modelLogicalId',
      'sourceLogicalId',
      'targetLogicalId',
      'connectionType',
      'confidence'
    ],
    properties: {
      logicalId: nonEmptyString(),
      modelLogicalId: nonEmptyString(),
      sourceLogicalId: nonEmptyString(),
      targetLogicalId: nonEmptyString(),
      // The point of the lane: CT_FLOW becomes unrepresentable here.
      connectionType: { type: 'string', enum: [...ARIS_AI_SUPPORTED_CONNECTION_TYPES] },
      names: localizedTextSchema(),
      returnOutcome: { type: 'boolean' },
      confidence: confidenceSchema()
    }
  }
}

function assignmentSchema(): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    required: [
      'logicalId',
      'assignmentType',
      'objectLogicalId',
      'assignedModelLogicalId',
      'confidence'
    ],
    properties: {
      logicalId: nonEmptyString(),
      assignmentType: { type: 'string', enum: [...ARIS_AI_ASSIGNMENT_TYPES] },
      objectLogicalId: nonEmptyString(),
      assignedModelLogicalId: nonEmptyString(),
      confidence: confidenceSchema()
    }
  }
}

function uncertaintySchema(): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['targetLogicalId', 'kind', 'message'],
    properties: {
      targetLogicalId: nonEmptyString(),
      kind: { type: 'string', enum: [...ARIS_AI_UNCERTAINTY_KINDS] },
      field: nonEmptyString(),
      message: nonEmptyString(),
      evidence: nonEmptyString()
    }
  }
}

/** Build the enum-locked JSON Schema mirroring `ArisAiDraftV1Schema`. */
export function buildArisAiDraftJsonSchema(): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    required: [
      'version',
      'models',
      'objects',
      'relations',
      'attributes',
      'assignments',
      'uncertainties'
    ],
    properties: {
      version: { const: 1 },
      models: { type: 'array', items: modelSchema() },
      objects: { type: 'array', items: objectSchema() },
      relations: { type: 'array', items: relationSchema() },
      attributes: { type: 'array', items: attributeSchema() },
      assignments: { type: 'array', items: assignmentSchema() },
      uncertainties: { type: 'array', items: uncertaintySchema() }
    }
  }
}
