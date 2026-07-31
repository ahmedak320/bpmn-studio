import { describe, expect, it } from 'vitest'
import {
  LITE_PROVIDERS,
  OPENROUTER_STRUCTURED_OUTPUT_MODELS,
  defaultLiteModelId,
  firstLiteModelForAttachment,
  getLiteModelCapabilities,
  type LiteProviderId
} from '../providersLite'

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

  describe('Wave 8 — curated vision routes', () => {
    it('keeps z-ai/glm-5.2 as the OpenRouter text default after appending vision routes', () => {
      expect(defaultLiteModelId('openrouter')).toBe('z-ai/glm-5.2')
    })

    it('grants gemini-3.5-flash-lite native PDF + images (google/ prefix rule)', () => {
      expect(getLiteModelCapabilities('openrouter', 'google/gemini-3.5-flash-lite')).toMatchObject({
        pdf: true,
        images: true,
        verified: true
      })
    })

    it('gates qwen3-vl to images only — the ZDR-leak gate: pdf === false', () => {
      const capabilities = getLiteModelCapabilities(
        'openrouter',
        'qwen/qwen3-vl-235b-a22b-instruct'
      )
      expect(capabilities).toMatchObject({ pdf: false, images: true, verified: true })
      // The invariant a PDF must never reach an image-only OpenRouter model.
      expect(getLiteModelCapabilities('openrouter', 'qwen/qwen3-vl-235b-a22b-instruct').pdf).toBe(
        false
      )
    })

    it('lists both A/B routes as structured-output capable', () => {
      expect(OPENROUTER_STRUCTURED_OUTPUT_MODELS.has('google/gemini-3.5-flash-lite')).toBe(true)
      expect(OPENROUTER_STRUCTURED_OUTPUT_MODELS.has('qwen/qwen3-vl-235b-a22b-instruct')).toBe(true)
    })

    it('firstLiteModelForAttachment returns a model that actually grants that kind', () => {
      const pdfModel = firstLiteModelForAttachment('openrouter', 'pdf')
      expect(pdfModel).not.toBeNull()
      expect(getLiteModelCapabilities('openrouter', pdfModel!).pdf).toBe(true)

      const imageModel = firstLiteModelForAttachment('openrouter', 'image')
      expect(imageModel).not.toBeNull()
      expect(getLiteModelCapabilities('openrouter', imageModel!).images).toBe(true)
      // The first curated pdf-capable model is gemini-3.5-flash-lite (the
      // curated text routes carry pdf but the first vision slot is gemini).
      expect(firstLiteModelForAttachment('openrouter', 'image')).toBe('anthropic/claude-opus-4.8')
    })
  })
})
