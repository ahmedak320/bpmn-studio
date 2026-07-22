import { describe, expect, it } from 'vitest'
import { PROVIDERS, PROVIDER_LIST, defaultModelId, getProvider } from '../../src/shared/providers'

const EXPECTED_IDS = ['openai', 'anthropic', 'moonshot', 'deepseek', 'gemini', 'azure', 'glm']

describe('provider catalog', () => {
  it('has exactly the seven wired providers', () => {
    expect(Object.keys(PROVIDERS).sort()).toEqual([...EXPECTED_IDS].sort())
    expect(PROVIDER_LIST).toHaveLength(7)
  })

  it('every provider id field matches its key in the record', () => {
    for (const [id, spec] of Object.entries(PROVIDERS)) {
      expect(spec.id).toBe(id)
    }
  })

  it('every provider has at least one required key field', () => {
    for (const spec of PROVIDER_LIST) {
      expect(spec.keyFields.length).toBeGreaterThan(0)
      expect(spec.keyFields.some((f) => f.required)).toBe(true)
    }
  })

  it('openai-compatible providers (moonshot, glm) carry a baseURL field', () => {
    for (const id of ['moonshot', 'glm'] as const) {
      const spec = getProvider(id)
      expect(spec.isOpenAICompatible).toBe(true)
      expect(spec.sdk).toBe('openai-compatible')
      const baseUrlField = spec.keyFields.find((f) => f.name === 'baseURL')
      expect(baseUrlField).toBeDefined()
      expect(baseUrlField?.defaultValue).toMatch(/^https:\/\//)
    }
  })

  it('azure requires apiKey, endpoint, deployment, apiVersion and has no fixed model list', () => {
    const azure = getProvider('azure')
    expect(azure.models).toHaveLength(0)
    expect(azure.allowCustomModel).toBe(true)
    const names = azure.keyFields.map((f) => f.name).sort()
    expect(names).toEqual(['apiKey', 'apiVersion', 'deployment', 'endpoint'].sort())
  })

  it('glm defaults to glm-5.2 and is editable', () => {
    const glm = getProvider('glm')
    expect(defaultModelId('glm')).toBe('glm-5.2')
    expect(glm.allowCustomModel).toBe(true)
  })

  it('moonshot exposes kimi-k3, kimi-k2.5, kimi-latest', () => {
    const moonshot = getProvider('moonshot')
    expect(moonshot.models.map((m) => m.id)).toEqual(['kimi-k3', 'kimi-k2.5', 'kimi-latest'])
  })

  it('non-openai-compatible providers use a first-party AI SDK adapter', () => {
    for (const id of ['openai', 'anthropic', 'deepseek', 'gemini', 'azure'] as const) {
      expect(getProvider(id).isOpenAICompatible).toBe(false)
    }
  })
})
