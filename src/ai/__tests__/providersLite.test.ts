import { describe, expect, it } from 'vitest'
import {
  LITE_PROVIDERS,
  OPENROUTER_STRUCTURED_OUTPUT_MODELS,
  PDF_CREATE_MODEL,
  PDF_CREATE_MODEL_LABEL,
  PDF_CREATE_PROVIDER,
  defaultLiteModelId,
  firstLiteModelForAttachment,
  getLiteModelCapabilities,
  pdfCreateModel,
  pdfCreateRoute,
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
      // The first image-capable curated route is the Claude Opus 4.8 slug.
      expect(firstLiteModelForAttachment('openrouter', 'image')).toBe('anthropic/claude-opus-4.8')
    })
  })

  describe('L-P13-prod — create-from-PDF is LOCKED to Claude Opus 4.8', () => {
    it('pins the PDF-create route to OpenRouter anthropic/claude-opus-4.8', () => {
      expect(PDF_CREATE_PROVIDER).toBe('openrouter')
      expect(PDF_CREATE_MODEL).toBe('anthropic/claude-opus-4.8')
      expect(pdfCreateModel()).toBe('anthropic/claude-opus-4.8')
      expect(pdfCreateRoute()).toEqual({
        providerId: 'openrouter',
        modelId: 'anthropic/claude-opus-4.8'
      })
    })

    it('the locked model is itself PDF-capable and verified (happy path never fails closed)', () => {
      expect(getLiteModelCapabilities(PDF_CREATE_PROVIDER, PDF_CREATE_MODEL)).toMatchObject({
        pdf: true,
        verified: true
      })
    })

    it('firstLiteModelForAttachment(openrouter, "pdf") is the locked model, not a registry scan', () => {
      // Before the lock the scan returned the first curated text route (glm-5.2);
      // the PDF path must now always resolve to Claude Opus 4.8.
      expect(firstLiteModelForAttachment('openrouter', 'pdf')).toBe('anthropic/claude-opus-4.8')
    })

    it('reuses the catalog label for the locked model (no new label literal)', () => {
      expect(PDF_CREATE_MODEL_LABEL).toBe('Claude Opus 4.8 (Anthropic)')
    })
  })
})
