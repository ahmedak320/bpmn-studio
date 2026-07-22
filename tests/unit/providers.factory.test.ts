import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock every AI SDK constructor: each returns a "provider" function that,
// called with a modelId, returns a plain object recording how it was built.
// This lets us assert createModel() picked the right adapter + config
// without hitting any real network or Electron API.
function fakeFactory(kind: string) {
  return vi.fn((options: Record<string, unknown>) =>
    vi.fn((modelId: string) => ({ kind, options, modelId }))
  )
}

const createOpenAI = fakeFactory('openai')
const createAnthropic = fakeFactory('anthropic')
const createAzure = fakeFactory('azure')
const createGoogle = fakeFactory('google')
const createDeepSeek = fakeFactory('deepseek')
const createOpenAICompatible = fakeFactory('openai-compatible')

vi.mock('@ai-sdk/openai', () => ({ createOpenAI }))
vi.mock('@ai-sdk/anthropic', () => ({ createAnthropic }))
vi.mock('@ai-sdk/azure', () => ({ createAzure }))
vi.mock('@ai-sdk/google', () => ({ createGoogle }))
vi.mock('@ai-sdk/deepseek', () => ({ createDeepSeek }))
vi.mock('@ai-sdk/openai-compatible', () => ({ createOpenAICompatible }))
vi.mock('electron', () => ({
  net: { fetch: vi.fn() }
}))
vi.mock('../../src/main/secrets', () => ({
  getAllKeys: vi.fn(async () => ({}))
}))

describe('providers.createModel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('builds an OpenAI model with the stored apiKey', async () => {
    const { createModel } = await import('../../src/main/providers')
    const model = (await createModel('openai', 'gpt-5.6-sol', {
      keysByProvider: { openai: { apiKey: 'sk-abc' } },
      fetch: vi.fn() as never
    })) as unknown as { kind: string; modelId: string; options: { apiKey: string } }

    expect(createOpenAI).toHaveBeenCalledTimes(1)
    expect(model.kind).toBe('openai')
    expect(model.modelId).toBe('gpt-5.6-sol')
    expect(model.options.apiKey).toBe('sk-abc')
  })

  it('builds an Anthropic model', async () => {
    const { createModel } = await import('../../src/main/providers')
    const model = (await createModel('anthropic', 'claude-sonnet-5', {
      keysByProvider: { anthropic: { apiKey: 'ant-1' } },
      fetch: vi.fn() as never
    })) as unknown as { kind: string }
    expect(model.kind).toBe('anthropic')
    expect(createAnthropic).toHaveBeenCalledTimes(1)
  })

  it('builds a DeepSeek model', async () => {
    const { createModel } = await import('../../src/main/providers')
    const model = (await createModel('deepseek', 'deepseek-chat', {
      keysByProvider: { deepseek: { apiKey: 'ds-1' } },
      fetch: vi.fn() as never
    })) as unknown as { kind: string }
    expect(model.kind).toBe('deepseek')
  })

  it('builds a Google model', async () => {
    const { createModel } = await import('../../src/main/providers')
    const model = (await createModel('gemini', 'gemini-flash-latest', {
      keysByProvider: { gemini: { apiKey: 'g-1' } },
      fetch: vi.fn() as never
    })) as unknown as { kind: string }
    expect(model.kind).toBe('google')
  })

  it('builds an Azure model with deployment-based URLs and apiVersion default', async () => {
    const { createModel } = await import('../../src/main/providers')
    const model = (await createModel('azure', 'ignored-modelid', {
      keysByProvider: {
        azure: { apiKey: 'az-1', endpoint: 'https://res.openai.azure.com', deployment: 'my-deploy' }
      },
      fetch: vi.fn() as never
    })) as unknown as {
      kind: string
      modelId: string
      options: { apiVersion: string; useDeploymentBasedUrls: boolean; baseURL: string }
    }
    expect(model.kind).toBe('azure')
    expect(model.modelId).toBe('my-deploy')
    expect(model.options.apiVersion).toBe('2024-10-21')
    expect(model.options.useDeploymentBasedUrls).toBe(true)
    expect(model.options.baseURL).toBe('https://res.openai.azure.com')
  })

  it('routes Moonshot through openai-compatible with its default base URL', async () => {
    const { createModel } = await import('../../src/main/providers')
    const model = (await createModel('moonshot', 'kimi-k3', {
      keysByProvider: { moonshot: { apiKey: 'km-1' } },
      fetch: vi.fn() as never
    })) as unknown as { kind: string; modelId: string; options: { baseURL: string; name: string } }
    expect(model.kind).toBe('openai-compatible')
    expect(model.modelId).toBe('kimi-k3')
    expect(model.options.baseURL).toBe('https://api.moonshot.ai/v1')
    expect(model.options.name).toBe('moonshot')
  })

  it('routes GLM through openai-compatible, honoring a user-overridden baseURL', async () => {
    const { createModel } = await import('../../src/main/providers')
    const model = (await createModel('glm', 'glm-5.2', {
      keysByProvider: { glm: { apiKey: 'zh-1', baseURL: 'https://api.z.ai/api/paas/v4/' } },
      fetch: vi.fn() as never
    })) as unknown as { kind: string; options: { baseURL: string } }
    expect(model.kind).toBe('openai-compatible')
    expect(model.options.baseURL).toBe('https://api.z.ai/api/paas/v4/')
  })

  it('throws ProviderConfigError when a required field is missing', async () => {
    const { createModel, ProviderConfigError } = await import('../../src/main/providers')
    await expect(
      createModel('openai', 'gpt-5.6-sol', { keysByProvider: {}, fetch: vi.fn() as never })
    ).rejects.toBeInstanceOf(ProviderConfigError)
  })

  it('availableProviders reports configured=true only for fully-filled providers', async () => {
    const { availableProviders } = await import('../../src/main/providers')
    const result = await availableProviders({
      openai: { apiKey: 'sk' },
      anthropic: {}
    })
    expect(result.find((p) => p.id === 'openai')?.configured).toBe(true)
    expect(result.find((p) => p.id === 'anthropic')?.configured).toBe(false)
  })
})
