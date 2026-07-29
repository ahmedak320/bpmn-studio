import { describe, expect, it } from 'vitest'

import {
  answerAssignment,
  answerBefore,
  answerIo,
  answerMissingInfo,
  answerNext,
  answerResponsible,
  answerReturnBranch,
  answerSystem,
  answerXorOutcomes
} from '../answer'
import { buildDigest } from '../digest'
import { buildSecondSyntheticModel, buildSyntheticModel } from './fixtures'

const digests = [buildDigest(buildSyntheticModel()), buildDigest(buildSecondSyntheticModel())]
const m1 = digests[0]
const m2 = digests[1]

if (!m1 || !m2) throw new Error('fixture digests missing')

function expectChip(
  chip: unknown,
  expected: {
    relPath: string
    modelId: string
    modelName: string
    occurrenceId?: string
    definitionId?: string
  }
): void {
  expect(chip).toMatchObject(expected)
}

describe('source chip resolution — every answerer returns openable chips tied to the exact ARIS occurrence', () => {
  it('answerNext points to the matched step and its next targets', () => {
    const answer = answerNext(digests, 'Register owner profile')
    expect(answer.kind).toBe('next')
    const sourceChip = answer.chips.find((c) => c.occurrenceId === 'occ-fn1')
    expectChip(sourceChip, {
      relPath: 'processes/owner-registration.aml',
      modelId: 'm1',
      modelName: 'Owner Registration',
      occurrenceId: 'occ-fn1',
      definitionId: 'def-fn1'
    })
    const targetChip = answer.chips.find((c) => c.occurrenceId === 'occ-evt2')
    expectChip(targetChip, {
      relPath: 'processes/owner-registration.aml',
      modelId: 'm1',
      modelName: 'Owner Registration',
      occurrenceId: 'occ-evt2',
      definitionId: 'def-evt2'
    })
  })

  it('answerBefore points to the matched step and its predecessors', () => {
    const answer = answerBefore(digests, 'Profile registered')
    expect(answer.kind).toBe('before')
    const sourceChip = answer.chips.find((c) => c.occurrenceId === 'occ-evt2')
    expectChip(sourceChip, {
      relPath: 'processes/owner-registration.aml',
      modelId: 'm1',
      modelName: 'Owner Registration',
      occurrenceId: 'occ-evt2',
      definitionId: 'def-evt2'
    })
    const predecessorChip = answer.chips.find((c) => c.occurrenceId === 'occ-fn1')
    expectChip(predecessorChip, {
      relPath: 'processes/owner-registration.aml',
      modelId: 'm1',
      modelName: 'Owner Registration',
      occurrenceId: 'occ-fn1',
      definitionId: 'def-fn1'
    })
  })

  it('answerResponsible points to the matched step', () => {
    const answer = answerResponsible(digests, 'Register owner profile')
    expect(answer.kind).toBe('responsible')
    expectChip(answer.chips[0], {
      relPath: 'processes/owner-registration.aml',
      modelId: 'm1',
      modelName: 'Owner Registration',
      occurrenceId: 'occ-fn1',
      definitionId: 'def-fn1'
    })
  })

  it('answerResponsible (digest-level fallback) points to the matched model', () => {
    const answer = answerResponsible(digests, 'Owner Registration')
    expect(answer.kind).toBe('responsible')
    expectChip(answer.chips[0], {
      relPath: 'processes/owner-registration.aml',
      modelId: 'm1',
      modelName: 'Owner Registration'
    })
    expect(answer.chips[0].occurrenceId).toBeUndefined()
  })

  it('answerIo points to the matched step', () => {
    const answer = answerIo(digests, 'Register owner profile')
    expect(answer.kind).toBe('io')
    expectChip(answer.chips[0], {
      relPath: 'processes/owner-registration.aml',
      modelId: 'm1',
      modelName: 'Owner Registration',
      occurrenceId: 'occ-fn1',
      definitionId: 'def-fn1'
    })
  })

  it('answerSystem points to the matched step', () => {
    const answer = answerSystem(digests, 'Register owner profile')
    expect(answer.kind).toBe('system')
    expectChip(answer.chips[0], {
      relPath: 'processes/owner-registration.aml',
      modelId: 'm1',
      modelName: 'Owner Registration',
      occurrenceId: 'occ-fn1',
      definitionId: 'def-fn1'
    })
  })

  it('answerXorOutcomes points to the matched gateway and its outcome targets', () => {
    const answer = answerXorOutcomes(digests, 'Application reviewed')
    expect(answer.kind).toBe('xorOutcomes')
    const gatewayChip = answer.chips.find((c) => c.occurrenceId === 'occ-rule1')
    expectChip(gatewayChip, {
      relPath: 'processes/owner-registration.aml',
      modelId: 'm1',
      modelName: 'Owner Registration',
      occurrenceId: 'occ-rule1',
      definitionId: 'def-rule1'
    })
    const approvedChip = answer.chips.find((c) => c.occurrenceId === 'occ-evt-approved')
    expectChip(approvedChip, {
      relPath: 'processes/owner-registration.aml',
      modelId: 'm1',
      modelName: 'Owner Registration',
      occurrenceId: 'occ-evt-approved',
      definitionId: 'def-evt-approved'
    })
  })

  it('answerReturnBranch points to the matched step and its loop-back target', () => {
    const answer = answerReturnBranch(digests, 'طلب مستندات إضافية')
    expect(answer.kind).toBe('returnBranch')
    const sourceChip = answer.chips.find((c) => c.occurrenceId === 'occ-fn-return')
    expectChip(sourceChip, {
      relPath: 'processes/owner-registration.aml',
      modelId: 'm1',
      modelName: 'Owner Registration',
      occurrenceId: 'occ-fn-return',
      definitionId: 'def-fn-return'
    })
    const targetChip = answer.chips.find((c) => c.occurrenceId === 'occ-fn1')
    expectChip(targetChip, {
      relPath: 'processes/owner-registration.aml',
      modelId: 'm1',
      modelName: 'Owner Registration',
      occurrenceId: 'occ-fn1',
      definitionId: 'def-fn1'
    })
  })

  it('answerAssignment points to the occurrence with a linked model', () => {
    const answer = answerAssignment(digests, 'Escalate to committee')
    expect(answer.kind).toBe('assignment')
    expectChip(answer.chips[0], {
      relPath: 'processes/owner-registration.aml',
      modelId: 'm1',
      modelName: 'Owner Registration',
      occurrenceId: 'occ-escalate',
      definitionId: 'def-escalate'
    })
  })

  it('answerMissingInfo points to the matched model and to specific gap occurrences', () => {
    const answer = answerMissingInfo(digests, 'Owner Registration')
    expect(answer.kind).toBe('missingInfo')
    expectChip(answer.chips[0], {
      relPath: 'processes/owner-registration.aml',
      modelId: 'm1',
      modelName: 'Owner Registration'
    })
    const gapItem = answer.parts[0]?.items?.find((i) => i.chip?.occurrenceId === 'occ-fn-return')
    expect(gapItem).toBeDefined()
    expectChip(gapItem?.chip, {
      relPath: 'processes/owner-registration.aml',
      modelId: 'm1',
      modelName: 'Owner Registration',
      occurrenceId: 'occ-fn-return',
      definitionId: 'def-fn-return'
    })
  })

  it('cross-model chips carry the correct model id and path', () => {
    const answer = answerNext(digests, 'Administer vaccine')
    expect(answer.kind).toBe('next')
    expectChip(answer.chips[0], {
      relPath: 'processes/animal-vaccination.aml',
      modelId: 'm2',
      modelName: 'Animal Vaccination',
      occurrenceId: 'occ2-fn1',
      definitionId: 'def2-fn1'
    })
  })

  it('no-key answerers never require a key and never emit empty chips', () => {
    const answer = answerNext(digests, 'Register owner profile')
    expect(answer.chips.length).toBeGreaterThan(0)
    for (const chip of answer.chips) {
      expect(chip.relPath).toBeTruthy()
      expect(chip.modelId).toBeTruthy()
      expect(chip.modelName).toBeTruthy()
    }
  })
})
