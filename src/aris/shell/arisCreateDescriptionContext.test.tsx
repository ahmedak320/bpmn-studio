// @vitest-environment jsdom

/**
 * §16.2 Description input — optional workspace context, name redaction, exact
 * outbound preview, sensitivity classification, request-count estimate, and
 * consent binding.
 *
 * These tests cover both the pure context/consent helpers in
 * `arisCreateDescriptionAi.ts` and the mounted `ArisGenerationPanel` Description
 * tab. Every provider call is injected, so the suite makes zero network
 * requests.
 */

import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ArisGenerationPanel } from '../../ArisGenerationPanel'
import { buildArisAiPrompt } from '../ai/promptBuilder'
import { buildMinimalValidDraft } from '../ai/testFixtures'
import type { ArisProcessDigest } from '../assistant/types'
import {
  buildArisCreateDescriptionContext,
  buildArisCreateDescriptionDisclosure,
  buildArisCreateDescriptionSensitivity,
  grantArisCreateDescriptionConsent,
  hasArisCreateDescriptionConsent
} from './arisCreateDescriptionAi'
import type { ArisAiGenerationRequest } from './arisAiGeneration'

afterEach(() => {
  cleanup()
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

function panel(): HTMLElement {
  return document.querySelector<HTMLElement>('[data-orbitpm-aris-create]')!
}

function typeDescription(text: string): void {
  fireEvent.change(panel().querySelector<HTMLTextAreaElement>('textarea')!, {
    target: { value: text }
  })
}

function consentCheckbox(): HTMLInputElement {
  return panel().querySelector<HTMLInputElement>('[data-orbitpm-aris-create-consent]')!
}

function includeContextCheckbox(): HTMLInputElement {
  return panel().querySelector<HTMLInputElement>('[data-orbitpm-aris-create-include-context]')!
}

function redactNamesCheckbox(): HTMLInputElement {
  return panel().querySelector<HTMLInputElement>('[data-orbitpm-aris-create-redact-names]')!
}

function submitButton(): HTMLButtonElement {
  return panel().querySelector<HTMLButtonElement>('[data-orbitpm-aris-create-submit]')!
}

function previewText(): string {
  return (
    panel().querySelector<HTMLElement>('[data-orbitpm-aris-create-preview] pre')?.textContent ?? ''
  )
}

interface Harness {
  readonly created: { name: string; xml: string }[]
  readonly requests: ArisAiGenerationRequest[]
}

function renderPanel(
  options: {
    digests?: readonly ArisProcessDigest[]
    replies?: readonly string[]
  } = {}
): Harness {
  const harness: Harness = { created: [], requests: [] }
  const replies = options.replies ?? [JSON.stringify(buildMinimalValidDraft())]
  let index = 0

  render(
    <ArisGenerationPanel
      digests={options.digests ?? DIGESTS}
      onCreateModel={(input) => {
        harness.created.push(input)
      }}
      onDownloadFile={() => undefined}
      onOpenAssistant={() => undefined}
      onOpenSettings={() => undefined}
      callProvider={async (request) => {
        harness.requests.push(request)
        const reply = replies[Math.min(index, replies.length - 1)]!
        index += 1
        return reply
      }}
    />
  )
  return harness
}

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

describe('ArisGenerationPanel Description tab — context defaults', () => {
  it('keeps workspace context off and name redaction on by default', () => {
    renderPanel()
    expect(includeContextCheckbox().checked).toBe(false)
    expect(redactNamesCheckbox().checked).toBe(true)
    expect(redactNamesCheckbox().disabled).toBe(true)
  })

  it('enables the redaction checkbox only when context is included', () => {
    renderPanel()
    expect(redactNamesCheckbox().disabled).toBe(true)
    fireEvent.click(includeContextCheckbox())
    expect(redactNamesCheckbox().disabled).toBe(false)
    fireEvent.click(includeContextCheckbox())
    expect(redactNamesCheckbox().disabled).toBe(true)
  })

  it('reports no matched processes for an unrelated description', () => {
    renderPanel()
    fireEvent.click(includeContextCheckbox())
    typeDescription('Describe the quarterly payroll run.')
    expect(
      panel().querySelector('[data-orbitpm-aris-create-context-status]')?.textContent
    ).toContain('No relevant process matched')
    expect(panel().querySelector('[data-orbitpm-aris-create-context-chips]')).toBeNull()
  })

  it('shows matched process chips for a relevant description', () => {
    renderPanel()
    fireEvent.click(includeContextCheckbox())
    typeDescription('How does the permit renewal process work?')
    expect(
      panel().querySelector('[data-orbitpm-aris-create-context-status]')?.textContent
    ).toContain('1 relevant process')
    const chips = panel().querySelectorAll('[data-orbitpm-aris-create-context-chips] span')
    expect(chips.length).toBe(1)
    expect(chips[0].textContent).toBe('Permit Renewal')
  })
})

describe('ArisGenerationPanel Description tab — preview and request', () => {
  it('renders a preview byte-identical to the request that is sent', async () => {
    const harness = renderPanel()
    typeDescription('Create a permit renewal process.')
    fireEvent.click(consentCheckbox())
    // Capture the preview before submit: the panel clears the description on
    // success, which would otherwise make the post-completion preview differ
    // from the request that was actually sent.
    const previewBefore = previewText()
    fireEvent.click(submitButton())

    await waitFor(() => expect(harness.created.length).toBe(1))
    const request = harness.requests[0]!
    expect(previewBefore).toBe(`${request.system}\n\n${request.user}`)
  })

  it('fences included workspace context as untrusted data', async () => {
    const harness = renderPanel()
    fireEvent.click(includeContextCheckbox())
    typeDescription('permit renewal')
    fireEvent.click(consentCheckbox())
    fireEvent.click(submitButton())

    await waitFor(() => expect(harness.created.length).toBe(1))
    const request = harness.requests[0]!
    expect(request.user).toContain('Workspace context')
    expect(request.user).toContain('UNTRUSTED DATA')
    expect(request.user).toContain('Permit Renewal')
  })

  it('omits workspace context from the request when the control is off', async () => {
    const harness = renderPanel()
    typeDescription('permit renewal')
    fireEvent.click(consentCheckbox())
    fireEvent.click(submitButton())

    await waitFor(() => expect(harness.created.length).toBe(1))
    const request = harness.requests[0]!
    expect(request.user).not.toContain('Workspace context')
    expect(request.user).not.toContain('Permit Renewal')
  })

  it('sends redacted names when redaction is on', async () => {
    const harness = renderPanel()
    fireEvent.click(includeContextCheckbox())
    typeDescription('permit renewal')
    fireEvent.click(consentCheckbox())
    fireEvent.click(submitButton())

    await waitFor(() => expect(harness.created.length).toBe(1))
    const request = harness.requests[0]!
    expect(request.user).not.toContain('Alice Johnson')
    expect(request.user).toContain('Person 1')
  })

  it('sends unredacted names when redaction is turned off', async () => {
    const harness = renderPanel()
    fireEvent.click(includeContextCheckbox())
    fireEvent.click(redactNamesCheckbox())
    typeDescription('permit renewal')
    fireEvent.click(consentCheckbox())
    fireEvent.click(submitButton())

    await waitFor(() => expect(harness.created.length).toBe(1))
    const request = harness.requests[0]!
    expect(request.user).toContain('Alice Johnson')
  })
})

describe('ArisGenerationPanel Description tab — consent invalidation matrix', () => {
  it('clears consent when the description changes', () => {
    renderPanel()
    typeDescription('A permit request is received.')
    fireEvent.click(consentCheckbox())
    expect(consentCheckbox().checked).toBe(true)

    typeDescription('A permit request is received and reviewed.')
    expect(consentCheckbox().checked).toBe(false)
    expect(submitButton().disabled).toBe(true)
  })

  it('clears consent when workspace context is toggled', () => {
    renderPanel()
    typeDescription('permit renewal')
    fireEvent.click(consentCheckbox())
    expect(consentCheckbox().checked).toBe(true)

    fireEvent.click(includeContextCheckbox())
    expect(consentCheckbox().checked).toBe(false)
  })

  it('clears consent when name redaction is toggled', () => {
    renderPanel()
    fireEvent.click(includeContextCheckbox())
    typeDescription('permit renewal')
    fireEvent.click(consentCheckbox())
    expect(consentCheckbox().checked).toBe(true)

    fireEvent.click(redactNamesCheckbox())
    expect(consentCheckbox().checked).toBe(false)
  })

  it('clears consent when the selected context models change', () => {
    renderPanel()
    fireEvent.click(includeContextCheckbox())
    typeDescription('permit renewal')
    fireEvent.click(consentCheckbox())
    expect(consentCheckbox().checked).toBe(true)

    typeDescription('inventory audit')
    expect(consentCheckbox().checked).toBe(false)
  })

  it('clears consent when the provider or model changes', () => {
    renderPanel()
    typeDescription('permit renewal')
    fireEvent.click(consentCheckbox())
    expect(consentCheckbox().checked).toBe(true)

    const providerSelect = panel().querySelector<HTMLSelectElement>(
      '[data-orbitpm-aris-create-provider]'
    )!
    fireEvent.change(providerSelect, { target: { value: 'anthropic' } })
    expect(consentCheckbox().checked).toBe(false)

    fireEvent.click(consentCheckbox())
    expect(consentCheckbox().checked).toBe(true)

    const modelSelect = panel().querySelector<HTMLSelectElement>(
      '[data-orbitpm-aris-create-model]'
    )!
    fireEvent.change(modelSelect, { target: { value: 'claude-3-5-sonnet-latest' } })
    expect(consentCheckbox().checked).toBe(false)
  })
})

describe('ArisGenerationPanel Description tab — preview determinism', () => {
  it('matches the exact outbound request built by the same pure function', () => {
    renderPanel()
    typeDescription('permit renewal')
    fireEvent.click(includeContextCheckbox())

    const expected = buildArisAiPrompt({
      modelName: 'Generated draft',
      modelType: 'MT_EEPC',
      description: 'permit renewal',
      workspaceContext: buildArisCreateDescriptionContext(DIGESTS, 'permit renewal', true)
        .contextText
    })
    expect(previewText()).toBe(`${expected.system}\n\n${expected.user}`)
  })
})
