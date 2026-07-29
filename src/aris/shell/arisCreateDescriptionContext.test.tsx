/**
 * §16.2 Description input — the pure workspace-context, name-redaction,
 * sensitivity-classification, and disclosure/consent helpers in
 * `arisCreateDescriptionAi.ts`.
 *
 * The panel-driven consent / include-context / exact-outbound-preview cases
 * were removed with authorized product change #1 (the create path no longer
 * has a consent gate, context toggles, or a request preview) and #2 (the
 * model-type control is gone; generation always uses `'auto-detect'`). These
 * pure helpers stay because `arisCreateDescriptionAi.ts` is retained on disk
 * and its function-level contract is unchanged.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ArisProcessDigest } from '../assistant/types'
import {
  buildArisCreateDescriptionContext,
  buildArisCreateDescriptionDisclosure,
  buildArisCreateDescriptionSensitivity,
  grantArisCreateDescriptionConsent,
  hasArisCreateDescriptionConsent
} from './arisCreateDescriptionAi'

afterEach(() => {
  vi.restoreAllMocks()
})

function makeDigest(
  modelName: string,
  options: {
    owners?: readonly string[]
    steps?: ReadonlyArray<{ readonly name: string; readonly responsible?: readonly string[] }>
  } = {}
): ArisProcessDigest {
  const steps = options.steps ?? []
  return {
    relPath: `${modelName}.aml`,
    modelId: `model-${modelName.toLowerCase().replace(/\s+/gu, '-')}`,
    modelType: 'MT_EEPC',
    modelName,
    owners: options.owners ?? [],
    triggers: [],
    steps: steps.map((step, index) => ({
      occurrenceId: `occ-${index}`,
      definitionId: `def-${index}`,
      name: step.name,
      objectType: 'OT_FUNC',
      responsible: step.responsible ?? [],
      inputs: [],
      outputs: [],
      systems: [],
      next: []
    })),
    decisions: [],
    inputs: [],
    outputs: [],
    systems: [],
    assignments: [],
    missingInformation: []
  }
}

const DIGESTS: readonly ArisProcessDigest[] = [
  makeDigest('Permit Renewal', {
    owners: ['Alice Johnson'],
    steps: [
      { name: 'Receive application', responsible: ['Bob Smith'] },
      { name: 'Review documents', responsible: ['Carol White'] }
    ]
  }),
  makeDigest('Inventory Audit', {
    owners: ['Dana Lee'],
    steps: [{ name: 'Count stock' }]
  })
]

describe('buildArisCreateDescriptionContext', () => {
  it('returns an empty context for a description unrelated to every digest', () => {
    const context = buildArisCreateDescriptionContext(
      DIGESTS,
      'Describe the quarterly payroll run.',
      true
    )
    expect(context.includedModelIds).toEqual([])
    expect(context.chips).toEqual([])
    expect(context.contextText).toBe('')
  })

  it('ranks and includes only genuinely relevant digests', () => {
    const context = buildArisCreateDescriptionContext(
      DIGESTS,
      'How does the permit renewal process work?',
      true
    )
    expect(context.includedModelIds).toEqual([DIGESTS[0].modelId])
    expect(context.chips).toHaveLength(1)
    expect(context.chips[0].modelName).toBe('Permit Renewal')
    expect(context.contextText).toContain('Permit Renewal')
  })

  it('redacts owner and responsible person names by default', () => {
    const context = buildArisCreateDescriptionContext(DIGESTS, 'permit renewal', true)
    expect(context.contextText).not.toContain('Alice Johnson')
    expect(context.contextText).not.toContain('Bob Smith')
    expect(context.contextText).not.toContain('Carol White')
    expect(context.contextText).toContain('Person 1')
    expect(context.contextText).toContain('Person 2')
    // Process and step names remain legible.
    expect(context.contextText).toContain('Permit Renewal')
    expect(context.contextText).toContain('Receive application')
  })

  it('leaves person names legible when redaction is off', () => {
    const context = buildArisCreateDescriptionContext(DIGESTS, 'permit renewal', false)
    expect(context.contextText).toContain('Alice Johnson')
    expect(context.contextText).toContain('Bob Smith')
    expect(context.contextText).toContain('Permit Renewal')
  })
})

describe('buildArisCreateDescriptionSensitivity', () => {
  it('flags names when context contains real process names', () => {
    const context = buildArisCreateDescriptionContext(DIGESTS, 'permit renewal', false)
    const sensitivity = buildArisCreateDescriptionSensitivity('Draw a process.', context)
    expect(sensitivity.containsNames).toBe(true)
  })

  it('does not flag names for an empty context', () => {
    const context = buildArisCreateDescriptionContext(DIGESTS, 'unrelated quarterly payroll', true)
    const sensitivity = buildArisCreateDescriptionSensitivity('Draw a process.', context)
    expect(sensitivity.containsNames).toBe(false)
  })
})

describe('ArisCreateDescription disclosure and consent', () => {
  it('invalidates consent when any disclosed input changes', () => {
    const context = buildArisCreateDescriptionContext(DIGESTS, 'permit renewal', true)
    const disclosure = buildArisCreateDescriptionDisclosure({
      tab: 'description',
      providerId: 'openrouter',
      modelId: 'openai/gpt-4o-mini',
      modelName: 'New process',
      modelType: 'MT_EEPC',
      includeContext: true,
      redactNames: true,
      context,
      attachmentName: '',
      attachmentSizeBytes: 0,
      outboundSystem: 'system',
      outboundUser: 'user'
    })
    const consent = grantArisCreateDescriptionConsent(disclosure)
    expect(hasArisCreateDescriptionConsent(disclosure, consent)).toBe(true)

    const variants = [
      { includeContext: false },
      { redactNames: false },
      { modelName: 'Renamed process' },
      { modelType: 'MT_VAL_ADD_CHN_DGM' },
      { providerId: 'anthropic' },
      { modelId: 'claude-sonnet-4' },
      { attachmentName: 'spec.pdf' },
      { outboundUser: 'user v2' }
    ]

    for (const variant of variants) {
      const changed = buildArisCreateDescriptionDisclosure({
        ...{
          tab: 'description',
          providerId: 'openrouter',
          modelId: 'openai/gpt-4o-mini',
          modelName: 'New process',
          modelType: 'MT_EEPC',
          includeContext: true,
          redactNames: true,
          context,
          attachmentName: '',
          attachmentSizeBytes: 0,
          outboundSystem: 'system',
          outboundUser: 'user'
        },
        ...variant
      })
      expect(hasArisCreateDescriptionConsent(changed, consent)).toBe(false)
    }
  })

  it('invalidates consent when the ranked context models change', () => {
    const contextA = buildArisCreateDescriptionContext(DIGESTS, 'permit renewal', true)
    const contextB = buildArisCreateDescriptionContext(DIGESTS, 'inventory audit', true)
    const base = {
      tab: 'description' as const,
      providerId: 'openrouter',
      modelId: 'openai/gpt-4o-mini',
      modelName: 'New process',
      modelType: 'MT_EEPC' as const,
      includeContext: true,
      redactNames: true,
      attachmentName: '',
      attachmentSizeBytes: 0,
      outboundSystem: 'system',
      outboundUser: 'user'
    }
    const disclosureA = buildArisCreateDescriptionDisclosure({ ...base, context: contextA })
    const consent = grantArisCreateDescriptionConsent(disclosureA)
    const disclosureB = buildArisCreateDescriptionDisclosure({ ...base, context: contextB })
    expect(hasArisCreateDescriptionConsent(disclosureB, consent)).toBe(false)
  })
})
