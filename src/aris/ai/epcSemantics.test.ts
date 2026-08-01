import { describe, expect, it } from 'vitest'

import type { ArisAiDraftV1 } from './contract'
import { validateArisAiDraftEpcSemantics } from './epcSemantics'
import { buildMinimalValidDraft } from './testFixtures'

function zeroFlowDraft(): ArisAiDraftV1 {
  const base = buildMinimalValidDraft()
  return {
    version: 1,
    models: [base.models[0]],
    objects: [],
    relations: [],
    attributes: [],
    assignments: [],
    uncertainties: []
  }
}

describe('validateArisAiDraftEpcSemantics — empty models', () => {
  it('reports epc.model.empty when the draft contains no control-flow object', () => {
    const result = validateArisAiDraftEpcSemantics(zeroFlowDraft())

    expect(result.errors).toEqual([
      expect.objectContaining({ code: 'epc.model.empty', path: '$.models[0]' })
    ])
  })

  it('reports an empty primary model when another model contains the flow', () => {
    const base = buildMinimalValidDraft()
    const draft: ArisAiDraftV1 = {
      ...base,
      models: [base.models[1], base.models[0]],
      assignments: []
    }
    const result = validateArisAiDraftEpcSemantics(draft)

    expect(result.errors).toContainEqual(
      expect.objectContaining({ code: 'epc.model.empty', path: '$.models[0]' })
    )
  })

  it('allows an empty non-primary placeholder that is an assignment target', () => {
    const result = validateArisAiDraftEpcSemantics(buildMinimalValidDraft())

    expect(result.errors.map((entry) => entry.code)).not.toContain('epc.model.empty')
  })
})

describe('validateArisAiDraftEpcSemantics — repair detail', () => {
  it('names the offending event and rule labels for a decision violation', () => {
    const base = buildMinimalValidDraft()
    const draft: ArisAiDraftV1 = {
      ...base,
      objects: [
        ...base.objects,
        {
          logicalId: 'rule-eligibility',
          modelLogicalId: 'model-main',
          objectType: 'OT_RULE',
          symbolType: 'ST_OPR_XOR_1',
          names: { en: 'Eligibility split' },
          attributes: [],
          confidence: 'high'
        },
        {
          logicalId: 'func-accept',
          modelLogicalId: 'model-main',
          objectType: 'OT_FUNC',
          names: { en: 'Accept applicant' },
          attributes: [],
          confidence: 'high'
        },
        {
          logicalId: 'func-reject',
          modelLogicalId: 'model-main',
          objectType: 'OT_FUNC',
          names: { en: 'Reject applicant' },
          attributes: [],
          confidence: 'high'
        }
      ],
      relations: [
        ...base.relations,
        {
          logicalId: 'rel-status-rule',
          modelLogicalId: 'model-main',
          sourceLogicalId: 'evt-end',
          targetLogicalId: 'rule-eligibility',
          connectionType: 'CT_IS_EVAL_BY_1',
          confidence: 'high'
        },
        {
          logicalId: 'rel-rule-accept',
          modelLogicalId: 'model-main',
          sourceLogicalId: 'rule-eligibility',
          targetLogicalId: 'func-accept',
          connectionType: 'CT_ACTIV_1',
          confidence: 'high'
        },
        {
          logicalId: 'rel-rule-reject',
          modelLogicalId: 'model-main',
          sourceLogicalId: 'rule-eligibility',
          targetLogicalId: 'func-reject',
          connectionType: 'CT_ACTIV_1',
          confidence: 'high'
        }
      ]
    }

    const violation = validateArisAiDraftEpcSemantics(draft).errors.find(
      (entry) => entry.code === 'epc.event.decisionViolation'
    )
    expect(violation?.message).toContain('Request approved')
    expect(violation?.message).toContain('Eligibility split')
  })
})
