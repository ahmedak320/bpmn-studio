import { describe, expect, it } from 'vitest'

import {
  ARIS_AI_ASSIGNMENT_TYPES,
  ARIS_AI_ATTRIBUTE_OWNER_KINDS,
  ARIS_AI_SUPPORTED_MODEL_TYPES,
  ARIS_AI_UNCERTAINTY_KINDS
} from './contract'
import { buildArisAiDraftJsonSchema } from './draftJsonSchema'
import {
  ARIS_AI_SUPPORTED_CONNECTION_TYPES,
  ARIS_AI_SUPPORTED_OBJECT_TYPES
} from './typeValidation'

type Obj = Record<string, unknown>

const schema = buildArisAiDraftJsonSchema()

function props(node: unknown): Obj {
  return (node as Obj).properties as Obj
}
function itemsProps(arrayNode: unknown): Obj {
  return props((arrayNode as Obj).items)
}

describe('buildArisAiDraftJsonSchema', () => {
  const topProps = props(schema)

  it('locks every enum to its exported vocabulary constant (drift guard)', () => {
    expect((itemsProps(topProps.relations).connectionType as Obj).enum).toEqual(
      ARIS_AI_SUPPORTED_CONNECTION_TYPES
    )
    expect((itemsProps(topProps.objects).objectType as Obj).enum).toEqual(
      ARIS_AI_SUPPORTED_OBJECT_TYPES
    )
    expect((itemsProps(topProps.models).modelType as Obj).enum).toEqual(
      ARIS_AI_SUPPORTED_MODEL_TYPES
    )
    expect((itemsProps(topProps.attributes).ownerKind as Obj).enum).toEqual(
      ARIS_AI_ATTRIBUTE_OWNER_KINDS
    )
    expect((itemsProps(topProps.assignments).assignmentType as Obj).enum).toEqual(
      ARIS_AI_ASSIGNMENT_TYPES
    )
    expect((itemsProps(topProps.uncertainties).kind as Obj).enum).toEqual(ARIS_AI_UNCERTAINTY_KINDS)
  })

  it('pins confidence everywhere to high/medium/low', () => {
    for (const arrayKey of ['models', 'objects', 'relations', 'attributes', 'assignments']) {
      expect((itemsProps(topProps[arrayKey]).confidence as Obj).enum).toEqual([
        'high',
        'medium',
        'low'
      ])
    }
  })

  it('mirrors zod optionality in every required array', () => {
    expect((schema as Obj).required).toEqual([
      'version',
      'models',
      'objects',
      'relations',
      'attributes',
      'assignments',
      'uncertainties'
    ])
    expect(((topProps.models as Obj).items as Obj).required).toEqual([
      'logicalId',
      'modelType',
      'names',
      'confidence'
    ])
    expect(((topProps.objects as Obj).items as Obj).required).toEqual([
      'logicalId',
      'modelLogicalId',
      'objectType',
      'names',
      'attributes',
      'confidence'
    ])
    expect(((topProps.relations as Obj).items as Obj).required).toEqual([
      'logicalId',
      'modelLogicalId',
      'sourceLogicalId',
      'targetLogicalId',
      'connectionType',
      'confidence'
    ])
    expect(((topProps.attributes as Obj).items as Obj).required).toEqual([
      'logicalId',
      'ownerKind',
      'ownerLogicalId',
      'attributeType',
      'values',
      'confidence'
    ])
    expect(((topProps.assignments as Obj).items as Obj).required).toEqual([
      'logicalId',
      'assignmentType',
      'objectLogicalId',
      'assignedModelLogicalId',
      'confidence'
    ])
    expect(((topProps.uncertainties as Obj).items as Obj).required).toEqual([
      'targetLogicalId',
      'kind',
      'message'
    ])
  })

  it('leaves optional fields out of required and does not make them nullable', () => {
    const objectRequired = ((topProps.objects as Obj).items as Obj).required as string[]
    // symbolType stays a free string, absent from required (zod .optional()).
    expect(objectRequired).not.toContain('symbolType')
    expect(objectRequired).not.toContain('suggestedOrder')
    expect(objectRequired).not.toContain('evidence')
    const relationRequired = ((topProps.relations as Obj).items as Obj).required as string[]
    expect(relationRequired).not.toContain('names')
    expect(relationRequired).not.toContain('returnOutcome')
    // symbolType is a plain non-empty string (not an enum, not nullable).
    const symbolType = itemsProps(topProps.objects).symbolType as Obj
    expect(symbolType).toEqual({ type: 'string', minLength: 1 })
  })

  it('pins version to the literal 1 and forbids extra keys', () => {
    expect((topProps.version as Obj).const).toBe(1)
    expect((schema as Obj).additionalProperties).toBe(false)
    expect(((topProps.objects as Obj).items as Obj).additionalProperties).toBe(false)
  })
})
