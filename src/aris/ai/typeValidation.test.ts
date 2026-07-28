import { describe, expect, it } from 'vitest'
import { buildMinimalValidDraft } from './testFixtures'
import { validateArisAiTypes } from './typeValidation'

describe('validateArisAiTypes', () => {
  it('finds nothing for a fully valid draft', () => {
    expect(validateArisAiTypes(buildMinimalValidDraft())).toEqual([])
  })

  it('flags an unsupported object type', () => {
    const draft = buildMinimalValidDraft()
    const withBadType = {
      ...draft,
      objects: draft.objects.map((object) =>
        object.logicalId === 'func-approve' ? { ...object, objectType: 'OT_UNKNOWN_THING' } : object
      )
    }
    const findings = validateArisAiTypes(withBadType)
    expect(findings.some((f) => f.code === 'unsupported-object-type')).toBe(true)
  })

  it('flags an unsupported model type', () => {
    const draft = buildMinimalValidDraft()
    const withBadType = {
      ...draft,
      models: draft.models.map((model) =>
        model.logicalId === 'model-main' ? { ...model, modelType: 'MT_BOGUS' } : model
      )
    }
    const findings = validateArisAiTypes(withBadType)
    expect(findings.some((f) => f.code === 'unsupported-model-type')).toBe(true)
  })

  it('flags an unsupported connection type', () => {
    const draft = buildMinimalValidDraft()
    const withBadType = {
      ...draft,
      relations: draft.relations.map((relation) =>
        relation.logicalId === 'rel-start-to-approve' ? { ...relation, connectionType: 'CT_MADE_UP' } : relation
      )
    }
    const findings = validateArisAiTypes(withBadType)
    expect(findings.some((f) => f.code === 'unsupported-connection-type')).toBe(true)
  })

  it('flags an OT_RULE symbolType outside the native AND/OR/XOR set', () => {
    const draft = buildMinimalValidDraft()
    const withRule = {
      ...draft,
      objects: [
        ...draft.objects,
        {
          logicalId: 'rule-bad',
          modelLogicalId: 'model-main',
          objectType: 'OT_RULE',
          symbolType: 'ST_OPR_NAND_1',
          names: { en: 'Bad rule' },
          attributes: [],
          confidence: 'low' as const
        }
      ]
    }
    const findings = validateArisAiTypes(withRule)
    expect(findings.some((f) => f.code === 'unsupported-rule-symbol-type')).toBe(true)
  })

  it('accepts every native AND/OR/XOR rule symbol', () => {
    const draft = buildMinimalValidDraft()
    const withRules = {
      ...draft,
      objects: [
        ...draft.objects,
        {
          logicalId: 'rule-and',
          modelLogicalId: 'model-main',
          objectType: 'OT_RULE',
          symbolType: 'ST_OPR_AND_1',
          names: { en: 'AND' },
          attributes: [],
          confidence: 'high' as const
        },
        {
          logicalId: 'rule-or',
          modelLogicalId: 'model-main',
          objectType: 'OT_RULE',
          symbolType: 'ST_OPR_OR_1',
          names: { en: 'OR' },
          attributes: [],
          confidence: 'high' as const
        },
        {
          logicalId: 'rule-xor',
          modelLogicalId: 'model-main',
          objectType: 'OT_RULE',
          symbolType: 'ST_OPR_XOR_1',
          names: { en: 'XOR' },
          attributes: [],
          confidence: 'high' as const
        }
      ]
    }
    expect(validateArisAiTypes(withRules)).toEqual([])
  })
})
