import { describe, expect, it } from 'vitest'

import { buildDigest } from '../digest'
import { adaptArisWorkingDocument, type ArisWorkingDocumentLike } from '../seamAdapter'

/**
 * A structurally-shaped stand-in for a real `ArisWorkingDocument` (see
 * `src/aris/model/types.ts`). Uses both a raw AML LCID ("1033") and a
 * BCP-47-ish tag ("ar-AE") as locale keys across different records, since
 * `seamAdapter.ts` documents that `localeKeyToLang` must recognize both
 * conventions.
 */
function buildFakeWorkingDocument(): ArisWorkingDocumentLike {
  return {
    revision: 7,
    objectDefinitions: new Map([
      [
        'od1',
        {
          id: 'od1',
          type: 'OT_FUNC',
          names: { values: { '1033': 'Approve', 'ar-AE': 'موافقة' } as Record<string, string>, fallback: null },
          attributes: [],
          linkedModelIds: ['linked-model-1']
        }
      ],
      [
        'od2',
        {
          id: 'od2',
          type: 'OT_EVT',
          names: { values: { '1033': 'Approved' }, fallback: null },
          attributes: [],
          linkedModelIds: []
        }
      ]
    ]),
    connectionDefinitions: new Map([
      [
        'cd1',
        {
          id: 'cd1',
          type: 'CT_ACTIV_1',
          names: { values: {}, fallback: null }
        }
      ]
    ]),
    models: new Map([
      [
        'm1',
        {
          id: 'm1',
          type: 'MT_EEPC',
          names: { values: { '1033': 'Approval Process', 'ar-AE': 'عملية الموافقة' }, fallback: null },
          attributes: [{ type: 'AT_PROC_CODE', values: [{ localeId: null, text: 'APR-1' }] }],
          occurrences: [
            { id: 'occ1', definitionId: 'od1', symbol: 'ST_FUNC' },
            { id: 'occ2', definitionId: 'od2', symbol: 'ST_EV' }
          ],
          connectionOccurrences: [
            { id: 'cxn1', definitionId: 'cd1', sourceOccurrenceId: 'occ1', targetOccurrenceId: 'occ2' }
          ]
        }
      ]
    ])
  }
}

describe('adaptArisWorkingDocument — the one seam', () => {
  it('resolves both raw-LCID and BCP-47-tag locale keys to en/ar', () => {
    const [model] = adaptArisWorkingDocument(
      buildFakeWorkingDocument(),
      new Map([['m1', 'processes/approval.aml']]),
      new Map([['m1', 'hash-1']])
    )
    expect(model.relPath).toBe('processes/approval.aml')
    expect(model.modelId).toBe('m1')
    expect(model.names.en).toBe('Approval Process')
    expect(model.names.ar).toBe('عملية الموافقة')
    expect(model.revision).toBe(7)
    expect(model.sourceDigest).toBe('hash-1')
  })

  it('denormalizes occurrence definition names/type/linked models onto each occurrence', () => {
    const [model] = adaptArisWorkingDocument(buildFakeWorkingDocument(), new Map(), new Map())
    const occ1 = model.occurrences.find((o) => o.occurrenceId === 'occ1')
    expect(occ1?.objectType).toBe('OT_FUNC')
    expect(occ1?.names.en).toBe('Approve')
    expect(occ1?.names.ar).toBe('موافقة')
    expect(occ1?.linkedModelIds).toEqual(['linked-model-1'])
  })

  it('resolves connection type from the connection definition catalog', () => {
    const [model] = adaptArisWorkingDocument(buildFakeWorkingDocument(), new Map(), new Map())
    expect(model.connectionOccurrences[0]?.connectionType).toBe('CT_ACTIV_1')
  })

  it('falls back to the model id as relPath and empty source digest when the caller has no mapping', () => {
    const [model] = adaptArisWorkingDocument(buildFakeWorkingDocument(), new Map(), new Map())
    expect(model.relPath).toBe('m1')
    expect(model.sourceDigest).toBe('')
  })

  it('produces a model input that buildDigest can consume end-to-end', () => {
    const [model] = adaptArisWorkingDocument(
      buildFakeWorkingDocument(),
      new Map([['m1', 'processes/approval.aml']]),
      new Map([['m1', 'hash-1']])
    )
    const digest = buildDigest(model)
    expect(digest.modelName).toBe('Approval Process')
    expect(digest.processCode).toBe('APR-1')
    expect(digest.steps.map((s) => s.occurrenceId)).toEqual(['occ1', 'occ2'])
    expect(digest.steps[0]?.next).toEqual([{ targetOccurrenceId: 'occ2', relationType: 'CT_ACTIV_1' }])
  })
})
