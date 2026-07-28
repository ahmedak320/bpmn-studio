/**
 * Shared, minimal, valid `ArisAiDraftV1` fixture for the test suite in this
 * package. Not a `*.test.ts` file itself, so vitest's `src/**\/*.test.ts`
 * include pattern does not pick it up as a test.
 */

import type { ArisAiDraftV1 } from './contract'

/**
 * Two events, one function, chained by two control-flow relations, plus one
 * satellite object (a person) executing the function, one top-level
 * relation attribute, one model attribute, and one linked-model assignment.
 * Every logical id is deliberately simple/human-chosen — nothing here
 * resembles a real ARIS source id.
 */
export function buildMinimalValidDraft(): ArisAiDraftV1 {
  return {
    version: 1,
    models: [
      {
        logicalId: 'model-main',
        modelType: 'MT_EEPC',
        names: { en: 'Approve request', ar: 'الموافقة على الطلب' },
        confidence: 'high'
      },
      {
        logicalId: 'model-sub',
        modelType: 'MT_EEPC',
        names: { en: 'Sub-process' },
        confidence: 'medium'
      }
    ],
    objects: [
      {
        logicalId: 'evt-start',
        modelLogicalId: 'model-main',
        objectType: 'OT_EVT',
        names: { en: 'Request received' },
        attributes: [],
        confidence: 'high'
      },
      {
        logicalId: 'func-approve',
        modelLogicalId: 'model-main',
        objectType: 'OT_FUNC',
        names: { en: 'Approve request', ar: 'الموافقة على الطلب' },
        attributes: [
          {
            logicalId: 'attr-func-approve-desc',
            ownerKind: 'object',
            ownerLogicalId: 'func-approve',
            attributeType: 'AT_DESC',
            values: { en: 'Manager reviews and approves the request.' },
            confidence: 'medium'
          }
        ],
        suggestedOrder: 1,
        confidence: 'high'
      },
      {
        logicalId: 'evt-end',
        modelLogicalId: 'model-main',
        objectType: 'OT_EVT',
        names: { en: 'Request approved' },
        attributes: [],
        confidence: 'high'
      },
      {
        logicalId: 'pers-manager',
        modelLogicalId: 'model-main',
        objectType: 'OT_PERS',
        names: { en: 'Manager' },
        attributes: [],
        confidence: 'medium'
      }
    ],
    relations: [
      {
        logicalId: 'rel-start-to-approve',
        modelLogicalId: 'model-main',
        sourceLogicalId: 'evt-start',
        targetLogicalId: 'func-approve',
        connectionType: 'CT_ACTIV_1',
        confidence: 'high'
      },
      {
        logicalId: 'rel-approve-to-end',
        modelLogicalId: 'model-main',
        sourceLogicalId: 'func-approve',
        targetLogicalId: 'evt-end',
        connectionType: 'CT_LEADS_TO_1',
        confidence: 'high'
      },
      {
        logicalId: 'rel-manager-executes',
        modelLogicalId: 'model-main',
        sourceLogicalId: 'pers-manager',
        targetLogicalId: 'func-approve',
        connectionType: 'CT_EXEC_1',
        confidence: 'medium'
      }
    ],
    attributes: [
      {
        logicalId: 'attr-model-main-desc',
        ownerKind: 'model',
        ownerLogicalId: 'model-main',
        attributeType: 'AT_DESC',
        values: { en: 'Top-level approval process.' },
        confidence: 'medium'
      },
      {
        logicalId: 'attr-rel-manager-executes-note',
        ownerKind: 'relation',
        ownerLogicalId: 'rel-manager-executes',
        attributeType: 'AT_DESC',
        values: { en: 'Manager is the sole approver.' },
        confidence: 'low',
        evidence: 'Only one approver mentioned in the source text.'
      }
    ],
    assignments: [
      {
        logicalId: 'assign-approve-to-sub',
        assignmentType: 'linked-model',
        objectLogicalId: 'func-approve',
        assignedModelLogicalId: 'model-sub',
        confidence: 'low'
      }
    ],
    uncertainties: [
      {
        targetLogicalId: 'pers-manager',
        kind: 'missing-translation',
        field: 'names.ar',
        message: 'No Arabic name was present in the source for this object.'
      }
    ]
  }
}
