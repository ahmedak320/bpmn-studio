import { describe, expect, it } from 'vitest'

import { buildDigest } from '../digest'
import { buildSyntheticModel } from './fixtures'

describe('buildDigest — synthetic bilingual ARIS model', () => {
  const digest = buildDigest(buildSyntheticModel())

  it('resolves model identity, process code, and owners', () => {
    expect(digest.relPath).toBe('processes/owner-registration.aml')
    expect(digest.modelId).toBe('m1')
    expect(digest.modelType).toBe('MT_EEPC')
    expect(digest.modelName).toBe('Owner Registration')
    expect(digest.processCode).toBe('REG-001')
    expect(digest.owners).toEqual(['Animal Welfare Division'])
  })

  it('derives triggers from event steps with no incoming control-flow edge', () => {
    expect(digest.triggers).toEqual(['Registration requested'])
  })

  it('only includes OT_FUNC/OT_EVT/OT_RULE occurrences as steps, in source order', () => {
    expect(digest.steps.map((s) => s.occurrenceId)).toEqual([
      'occ-start',
      'occ-fn1',
      'occ-evt2',
      'occ-rule1',
      'occ-evt-approved',
      'occ-evt-rejected',
      'occ-fn2',
      'occ-fn-return',
      'occ-endevt',
      'occ-escalate'
    ])
  })

  it('carries occurrenceId AND definitionId on every step', () => {
    const fn1 = digest.steps.find((s) => s.occurrenceId === 'occ-fn1')
    expect(fn1?.definitionId).toBe('def-fn1')
  })

  it('resolves bilingual step names, falling back to the available locale when one is missing', () => {
    const fn1 = digest.steps.find((s) => s.occurrenceId === 'occ-fn1')
    expect(fn1?.name).toBe('Register owner profile')
    expect(fn1?.nameEn).toBe('Register owner profile')
    expect(fn1?.nameAr).toBe('تسجيل ملف المالك')

    const fnReturn = digest.steps.find((s) => s.occurrenceId === 'occ-fn-return')
    expect(fnReturn?.nameEn).toBeUndefined()
    expect(fnReturn?.nameAr).toBe('طلب مستندات إضافية')
    expect(fnReturn?.name).toBe('طلب مستندات إضافية')
  })

  it('classifies responsible/inputs/outputs/systems from connected metadata occurrences', () => {
    const fn1 = digest.steps.find((s) => s.occurrenceId === 'occ-fn1')
    expect(fn1?.responsible).toEqual(['Veterinarian'])
    expect(fn1?.inputs).toEqual(['Owner ID Document'])
    expect(fn1?.outputs).toEqual(['Registration Certificate'])
    expect(fn1?.systems).toEqual(['Animal Management System'])
  })

  it('builds typed next edges with relationType and optional outcome, only between step occurrences', () => {
    const fn1 = digest.steps.find((s) => s.occurrenceId === 'occ-fn1')
    expect(fn1?.next).toEqual([{ targetOccurrenceId: 'occ-evt2', relationType: 'CT_ACTIV_1' }])

    const rule1 = digest.steps.find((s) => s.occurrenceId === 'occ-rule1')
    expect(rule1?.next).toEqual([
      {
        targetOccurrenceId: 'occ-evt-approved',
        relationType: 'CT_LEADS_TO_1',
        outcome: 'Approved'
      },
      { targetOccurrenceId: 'occ-evt-rejected', relationType: 'CT_LEADS_TO_2', outcome: 'Rejected' }
    ])
  })

  it('models the loop-back (return branch) as a plain next edge from the returning function to the earlier function', () => {
    const fnReturn = digest.steps.find((s) => s.occurrenceId === 'occ-fn-return')
    expect(fnReturn?.next).toEqual([{ targetOccurrenceId: 'occ-fn1', relationType: 'CT_ACTIV_1' }])
  })

  it('builds one decision for the XOR gateway with resolved basis and outcomes', () => {
    expect(digest.decisions).toHaveLength(1)
    const decision = digest.decisions[0]
    expect(decision.occurrenceId).toBe('occ-rule1')
    expect(decision.gatewayType).toBe('XOR')
    expect(decision.basis).toBe('Registration Policy')
    expect(decision.outcomes).toEqual([
      { outcome: 'Approved', targetOccurrenceId: 'occ-evt-approved', targetName: 'Approved' },
      { outcome: 'Rejected', targetOccurrenceId: 'occ-evt-rejected', targetName: 'Rejected' }
    ])
  })

  it('aggregates digest-level inputs/outputs/systems across all steps, deduplicated', () => {
    expect(digest.inputs).toEqual(['Owner ID Document'])
    expect(digest.outputs).toEqual(['Registration Certificate'])
    expect(digest.systems).toEqual(['Animal Management System'])
  })

  it('builds one assignment for the occurrence with a linked model id', () => {
    expect(digest.assignments).toEqual([
      {
        occurrenceId: 'occ-escalate',
        definitionId: 'def-escalate',
        name: 'Escalate to committee',
        nameEn: 'Escalate to committee',
        nameAr: 'التصعيد إلى اللجنة',
        linkedModelId: 'm2-committee-review'
      }
    ])
  })

  it('detects missing information: bilingual name gaps and function I/O/system gaps, but not a fully-described function', () => {
    const kinds = digest.missingInformation.map((g) => g.kind)
    expect(kinds.filter((k) => k === 'missingNameEn')).toHaveLength(1)
    expect(kinds.filter((k) => k === 'missingNameAr')).toHaveLength(0)
    expect(digest.missingInformation).toContainEqual(
      expect.objectContaining({ kind: 'missingNameEn', occurrenceId: 'occ-fn-return' })
    )
    // fn1 is fully described (responsible/inputs/outputs/systems all present).
    expect(digest.missingInformation.some((g) => g.occurrenceId === 'occ-fn1')).toBe(false)
    // fn2/fn-return/escalate each have no recorded inputs/outputs/systems.
    for (const occurrenceId of ['occ-fn2', 'occ-fn-return', 'occ-escalate']) {
      expect(digest.missingInformation).toContainEqual(
        expect.objectContaining({ kind: 'missingInputs', occurrenceId })
      )
      expect(digest.missingInformation).toContainEqual(
        expect.objectContaining({ kind: 'missingOutputs', occurrenceId })
      )
      expect(digest.missingInformation).toContainEqual(
        expect.objectContaining({ kind: 'missingSystem', occurrenceId })
      )
    }
    // The XOR gateway has an explicit basis and explicitly labeled outcomes — no gap.
    expect(kinds).not.toContain('missingDecisionBasis')
    expect(kinds).not.toContain('missingOutcome')
    expect(kinds).not.toContain('danglingConnection')
    expect(digest.missingInformation).toHaveLength(10)
  })

  it('never throws on a model with zero step occurrences', () => {
    const empty = buildDigest({
      relPath: 'empty.aml',
      modelId: 'empty',
      modelType: 'MT_EEPC',
      names: { en: 'Empty', ar: null, fallback: 'Empty' },
      attributes: [],
      occurrences: [],
      connectionOccurrences: [],
      revision: 1,
      sourceDigest: 'x'
    })
    expect(empty.steps).toEqual([])
    expect(empty.decisions).toEqual([])
  })

  it('flags a connection referencing an unknown occurrence as a dangling-connection gap instead of throwing', () => {
    const withDangling = buildDigest({
      ...buildSyntheticModel(),
      connectionOccurrences: [
        ...buildSyntheticModel().connectionOccurrences,
        {
          occurrenceId: 'cxn-dangling',
          definitionId: 'cd-dangling',
          connectionType: 'CT_ACTIV_1',
          sourceOccurrenceId: 'occ-fn1',
          targetOccurrenceId: 'occ-does-not-exist',
          names: { en: null, ar: null, fallback: null }
        }
      ]
    })
    expect(withDangling.missingInformation).toContainEqual(
      expect.objectContaining({ kind: 'danglingConnection', detail: 'cxn-dangling' })
    )
  })
})
