import { describe, expect, it } from 'vitest'
import { LITE_PROVIDERS, getLiteModelCapabilities, type LiteProviderId } from '../providersLite'

describe('Lite model capability registry', () => {
  it('offers only current stable direct-Gemini ids', () => {
    const gemini = LITE_PROVIDERS.find((provider) => provider.id === 'gemini')!
    expect(gemini.models.map(({ id }) => id)).toEqual([
      'gemini-3.6-flash',
      'gemini-3.1-pro-preview'
    ])
    expect(gemini.models.map(({ id }) => id)).not.toContain('gemini-3-pro-preview')
    expect(gemini.models.map(({ id }) => id)).not.toContain('gemini-flash-latest')
  })

  it('fails closed for arbitrary custom model ids while retaining text', () => {
    expect(getLiteModelCapabilities('openrouter', 'vendor/unreviewed-model')).toEqual({
      text: true,
      pdf: false,
      images: false,
      verified: false
    })
    expect(getLiteModelCapabilities('gemini', 'gemini-unreviewed-preview')).toEqual({
      text: true,
      pdf: false,
      images: false,
      verified: false
    })
  })

  it('allows reviewed Anthropic and Gemini models to receive PDFs and images', () => {
    for (const providerId of ['anthropic', 'gemini'] satisfies LiteProviderId[]) {
      for (const model of LITE_PROVIDERS.find((provider) => provider.id === providerId)!.models) {
        expect(getLiteModelCapabilities(providerId, model.id)).toEqual({
          text: true,
          pdf: true,
          images: true,
          verified: true
        })
      }
    }
  })

  it('distinguishes image-capable OpenRouter routes from reviewed text routes', () => {
    expect(getLiteModelCapabilities('openrouter', 'anthropic/claude-sonnet-5')).toMatchObject({
      pdf: true,
      images: true,
      verified: true
    })
    expect(getLiteModelCapabilities('openrouter', 'google/gemini-3.6-flash')).toMatchObject({
      pdf: true,
      images: true,
      verified: true
    })
    expect(getLiteModelCapabilities('openrouter', 'deepseek/deepseek-v4-pro')).toMatchObject({
      pdf: true,
      images: false,
      verified: true
    })
  })
})
