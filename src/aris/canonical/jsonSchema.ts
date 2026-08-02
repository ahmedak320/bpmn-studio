/**
 * Enum-locked JSON Schema for `CanonicalProcessV1` (Lane L-SCHEMA, Wave 18).
 *
 * Hand-written to mirror `src/aris/ai/draftJsonSchema.ts` EXACTLY (same
 * function-per-object-type shape, `additionalProperties:false` everywhere,
 * `required` arrays that mirror zod optionality precisely) — no
 * zod-to-json-schema dependency is added (ZERO new deps is a hard campaign
 * target). `jsonSchema.test.ts` guards drift two ways: (a) every enum here
 * equals the vocabulary constant exported by `contract.ts`, the same
 * constant `contract.ts` feeds into `z.enum(...)`; (b) a structural
 * comparison of `required`/`properties` keys here against
 * `Object.keys(Schema.shape)` / zod optionality for every object type in the
 * contract.
 *
 * `CanonicalText` is the one place this schema is looser than the zod
 * contract: JSON Schema has no first-class "at least one of these optional
 * keys" beyond `anyOf`, so the "at least one of en/ar" invariant
 * (`CanonicalTextSchema`'s own `.superRefine`) is expressed as an `anyOf`
 * hint rather than folded into `required` (which stays empty, matching
 * `Object.keys` optionality exactly for the drift guard).
 */

import {
  CANONICAL_CONFIDENCE_VALUES,
  CANONICAL_CONTROL_KINDS,
  CANONICAL_EDGE_KINDS,
  CANONICAL_NODE_KINDS,
  CANONICAL_UNKNOWN_KINDS
} from './contract'

function nonEmptyString(): Record<string, unknown> {
  return { type: 'string', minLength: 1 }
}

function confidenceSchema(): Record<string, unknown> {
  return { type: 'string', enum: [...CANONICAL_CONFIDENCE_VALUES] }
}

/** `CanonicalTextSchema`: optional en/ar, no required keys, at least one populated. */
function localizedTextSchema(): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      en: nonEmptyString(),
      ar: nonEmptyString()
    },
    anyOf: [{ required: ['en'] }, { required: ['ar'] }]
  }
}

function identitySchema(): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'names', 'confidence'],
    properties: {
      id: nonEmptyString(),
      names: localizedTextSchema(),
      purpose: localizedTextSchema(),
      code: nonEmptyString(),
      processVersion: nonEmptyString(),
      confidence: confidenceSchema()
    }
  }
}

function nodeIdArraySchema(): Record<string, unknown> {
  return { type: 'array', items: nonEmptyString() }
}

function nodeSchema(): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'kind', 'names', 'confidence'],
    properties: {
      id: nonEmptyString(),
      kind: { type: 'string', enum: [...CANONICAL_NODE_KINDS] },
      names: localizedTextSchema(),
      description: localizedTextSchema(),
      waitDetail: localizedTextSchema(),
      targetProcessRef: nonEmptyString(),
      factIds: nodeIdArraySchema(),
      confidence: confidenceSchema()
    }
  }
}

function decisionOutcomeSchema(): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'names', 'targetNodeId'],
    properties: {
      id: nonEmptyString(),
      names: localizedTextSchema(),
      targetNodeId: nonEmptyString()
    }
  }
}

function decisionSchema(): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'nodeId', 'outcomes', 'confidence'],
    properties: {
      id: nonEmptyString(),
      nodeId: nonEmptyString(),
      criteria: localizedTextSchema(),
      outcomes: { type: 'array', items: decisionOutcomeSchema(), minItems: 2 },
      factIds: nodeIdArraySchema(),
      confidence: confidenceSchema()
    }
  }
}

function edgeSchema(): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'kind', 'sourceNodeId', 'targetNodeId', 'confidence'],
    properties: {
      id: nonEmptyString(),
      kind: { type: 'string', enum: [...CANONICAL_EDGE_KINDS] },
      sourceNodeId: nonEmptyString(),
      targetNodeId: nonEmptyString(),
      condition: localizedTextSchema(),
      factIds: nodeIdArraySchema(),
      confidence: confidenceSchema()
    }
  }
}

function roleSchema(): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'names', 'nodeIds', 'confidence'],
    properties: {
      id: nonEmptyString(),
      names: localizedTextSchema(),
      unit: localizedTextSchema(),
      nodeIds: nodeIdArraySchema(),
      owner: { type: 'boolean' },
      factIds: nodeIdArraySchema(),
      confidence: confidenceSchema()
    }
  }
}

function systemSchema(): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'names', 'nodeIds', 'confidence'],
    properties: {
      id: nonEmptyString(),
      names: localizedTextSchema(),
      nodeIds: nodeIdArraySchema(),
      factIds: nodeIdArraySchema(),
      confidence: confidenceSchema()
    }
  }
}

function informationObjectSchema(): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'names', 'inputToNodeIds', 'outputOfNodeIds', 'confidence'],
    properties: {
      id: nonEmptyString(),
      names: localizedTextSchema(),
      inputToNodeIds: nodeIdArraySchema(),
      outputOfNodeIds: nodeIdArraySchema(),
      factIds: nodeIdArraySchema(),
      confidence: confidenceSchema()
    }
  }
}

function controlSchema(): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'names', 'kind', 'nodeIds', 'confidence'],
    properties: {
      id: nonEmptyString(),
      names: localizedTextSchema(),
      kind: { type: 'string', enum: [...CANONICAL_CONTROL_KINDS] },
      nodeIds: nodeIdArraySchema(),
      factIds: nodeIdArraySchema(),
      confidence: confidenceSchema()
    }
  }
}

function factSchema(): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'statement', 'evidenceRefs', 'confidence'],
    properties: {
      id: nonEmptyString(),
      statement: localizedTextSchema(),
      evidenceRefs: nodeIdArraySchema(),
      confidence: confidenceSchema()
    }
  }
}

function unknownSchema(): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['targetId', 'kind', 'message'],
    properties: {
      targetId: nonEmptyString(),
      kind: { type: 'string', enum: [...CANONICAL_UNKNOWN_KINDS] },
      field: nonEmptyString(),
      message: localizedTextSchema(),
      factIds: nodeIdArraySchema()
    }
  }
}

/** Build the enum-locked JSON Schema mirroring `CanonicalProcessV1Schema`. */
export function buildCanonicalProcessJsonSchema(): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    required: [
      'version',
      'identity',
      'nodes',
      'decisions',
      'edges',
      'roles',
      'systems',
      'informationObjects',
      'controls',
      'facts',
      'unknowns'
    ],
    properties: {
      version: { const: 1 },
      identity: identitySchema(),
      nodes: { type: 'array', items: nodeSchema() },
      decisions: { type: 'array', items: decisionSchema() },
      edges: { type: 'array', items: edgeSchema() },
      roles: { type: 'array', items: roleSchema() },
      systems: { type: 'array', items: systemSchema() },
      informationObjects: { type: 'array', items: informationObjectSchema() },
      controls: { type: 'array', items: controlSchema() },
      facts: { type: 'array', items: factSchema() },
      unknowns: { type: 'array', items: unknownSchema() }
    }
  }
}
