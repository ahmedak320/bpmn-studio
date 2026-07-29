import { describe, expect, it, vi } from 'vitest'

import {
  askArisAssistantAi,
  buildArisAssistantAiContext,
  buildArisAssistantAiDisclosure,
  buildArisAssistantAiPrompt,
  grantArisAssistantAiConsent,
  hasArisAssistantAiConsent,
  type ArisAssistantAiTurn
} from '../../shell/arisAssistantAi'
import { buildDigest } from '../digest'
import { buildSecondSyntheticModel, buildSyntheticModel } from './fixtures'

const digests = [buildDigest(buildSyntheticModel()), buildDigest(buildSecondSyntheticModel())]

describe('AI-grounded answers use assistant digests and enforce consent/privacy', () => {
  it('builds grounded context from the current workspace digests, including only relevant models', () => {
    const context = buildArisAssistantAiContext(digests, 'owner registration profile', false)
    expect(context.includedModelIds).toEqual(['m1'])
    expect(context.contextText).toContain('Owner Registration')
    expect(context.contextText).toContain('Register owner profile')
    expect(context.contextText).not.toContain('Animal Vaccination')
    expect(context.chips).toEqual([
      {
        relPath: 'processes/owner-registration.aml',
        modelId: 'm1',
        modelName: 'Owner Registration'
      }
    ])
  })

  it('returns empty context for an unrelated question so no workspace data leaks', () => {
    const context = buildArisAssistantAiContext(digests, 'quantum computing', false)
    expect(context.includedModelIds).toEqual([])
    expect(context.contextText).toBe('')
    expect(context.chips).toEqual([])
  })

  it('includes digest chips in the context so the AI answer can cite sources', () => {
    const context = buildArisAssistantAiContext(digests, 'administer vaccine', false)
    expect(context.chips).toContainEqual({
      relPath: 'processes/animal-vaccination.aml',
      modelId: 'm2',
      modelName: 'Animal Vaccination'
    })
  })

  it('includes relevant digest context in the AI prompt when workspace context is opted in', () => {
    const context = buildArisAssistantAiContext(digests, 'owner registration', false)
    const prompt = buildArisAssistantAiPrompt({
      question: 'what happens next?',
      history: [],
      contextText: context.contextText
    })
    expect(prompt.system).toMatch(/ONLY the process information supplied/)
    expect(prompt.user).toContain('what happens next?')
    expect(prompt.user).toContain('ARIS process context')
    expect(prompt.user).toContain('Owner Registration')
  })

  it('states plainly when no workspace context is supplied', () => {
    const prompt = buildArisAssistantAiPrompt({
      question: 'what happens next?',
      history: [],
      contextText: ''
    })
    expect(prompt.user).toContain('No workspace process context was supplied')
  })

  it('requires user consent bound to the exact outbound disclosure', () => {
    const context = buildArisAssistantAiContext(digests, 'owner registration', true)
    const disclosure = buildArisAssistantAiDisclosure({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-5',
      question: 'what happens next?',
      history: [],
      context,
      includeWorkspaceContext: true,
      redactNames: true
    })

    // No consent yet.
    expect(hasArisAssistantAiConsent(disclosure, null)).toBe(false)

    // Grant consent for exactly this disclosure.
    const consent = grantArisAssistantAiConsent(disclosure)
    expect(hasArisAssistantAiConsent(disclosure, consent)).toBe(true)

    // Any change to the payload invalidates consent.
    const changedQuestion = buildArisAssistantAiDisclosure({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-5',
      question: 'a different question',
      history: [],
      context,
      includeWorkspaceContext: true,
      redactNames: true
    })
    expect(hasArisAssistantAiConsent(changedQuestion, consent)).toBe(false)

    const toggledContext = buildArisAssistantAiDisclosure({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-5',
      question: 'what happens next?',
      history: [],
      context,
      includeWorkspaceContext: false,
      redactNames: true
    })
    expect(hasArisAssistantAiConsent(toggledContext, consent)).toBe(false)
  })

  it('does not include workspace context in the disclosure when opted out', () => {
    const context = buildArisAssistantAiContext(digests, 'owner registration', true)
    const disclosure = buildArisAssistantAiDisclosure({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-5',
      question: 'what happens next?',
      history: [],
      context,
      includeWorkspaceContext: false,
      redactNames: true
    })
    expect(disclosure.outbound.some((item) => item.id === 'context')).toBe(false)
  })

  it('redacts person names by default while keeping process content legible', () => {
    const redacted = buildArisAssistantAiContext(digests, 'owner registration', true)
    expect(redacted.contextText).not.toContain('Animal Welfare Division')
    expect(redacted.contextText).not.toContain('Veterinarian')
    expect(redacted.contextText).toMatch(/Person \d+/)
    expect(redacted.contextText).toContain('Owner Registration')
    expect(redacted.contextText).toContain('Register owner profile')
  })

  it('bounds conversation history so the payload stays predictable', () => {
    const history: ArisAssistantAiTurn[] = Array.from({ length: 10 }, (_, i) => ({
      question: `q${i}`,
      answer: `a${i}`
    }))
    const context = buildArisAssistantAiContext(digests, 'owner registration', false)
    const disclosure = buildArisAssistantAiDisclosure({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-5',
      question: 'what happens next?',
      history,
      context,
      includeWorkspaceContext: true,
      redactNames: false
    })
    const historyItems = disclosure.outbound.filter((item) => item.id.startsWith('history'))
    expect(historyItems.length).toBeGreaterThan(0)
    expect(historyItems.length).toBeLessThanOrEqual(12) // 6 turns x 2 items per turn
  })

  it('sends the grounded request only when asked, returning the model answer and source chips', async () => {
    const context = buildArisAssistantAiContext(digests, 'owner registration', false)
    const callLLM = vi.fn().mockResolvedValue('The next step is certificate issuance.')
    const result = await askArisAssistantAi({
      callLLM,
      providerId: 'anthropic',
      modelId: 'claude-sonnet-5',
      question: 'what happens next?',
      history: [],
      context,
      includeWorkspaceContext: true
    })
    expect(result.kind).toBe('ok')
    if (result.kind !== 'ok') throw new Error('unexpected result')
    expect(result.text).toBe('The next step is certificate issuance.')
    expect(result.providerId).toBe('anthropic')
    expect(result.modelId).toBe('claude-sonnet-5')
    expect(result.chips).toEqual(context.chips)
    expect(callLLM).toHaveBeenCalledTimes(1)
    const messages = callLLM.mock.calls[0]?.[0] as { role: string; content: string }[]
    expect(messages?.[0]?.role).toBe('system')
    expect(messages?.[1]?.role).toBe('user')
    expect(messages?.[1]?.content).toContain('Owner Registration')
  })

  it('omits context chips when workspace context is not included in the request', async () => {
    const context = buildArisAssistantAiContext(digests, 'owner registration', false)
    const result = await askArisAssistantAi({
      callLLM: vi.fn().mockResolvedValue('answer'),
      providerId: 'anthropic',
      modelId: 'claude-sonnet-5',
      question: 'q',
      history: [],
      context,
      includeWorkspaceContext: false
    })
    expect(result.kind).toBe('ok')
    if (result.kind !== 'ok') throw new Error('unexpected result')
    expect(result.chips).toEqual([])
  })

  it('falls back to the local answer path on provider failure without exposing data', async () => {
    const context = buildArisAssistantAiContext(digests, 'owner registration', false)
    const result = await askArisAssistantAi({
      callLLM: vi.fn().mockRejectedValue(new Error('network error')),
      providerId: 'anthropic',
      modelId: 'claude-sonnet-5',
      question: 'q',
      history: [],
      context,
      includeWorkspaceContext: false
    })
    expect(result.kind).toBe('fallback')
  })
})
