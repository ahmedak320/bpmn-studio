// Browser-direct provider registry for OrbitPM Process Studio Lite.
//
// Unlike the desktop app (which runs 7 providers through the Electron main
// process, where CORS never applies), Lite calls providers DIRECTLY from the
// web page. Only providers that send permissive CORS headers can be reached
// this way. Per the verified provider matrix (scratchpad/prep/provider-matrix.md,
// re-verified 2026-07-22; image-input shapes re-verified 2026-07-23):
//
//   - OpenRouter  — CORS-open by design (BYOK browser apps are its use case).
//                   One key reaches GLM-5.2, Kimi K3, DeepSeek V4, Claude and
//                   Gemini (via `provider/model` slugs). PDF via the
//                   `file-parser` plugin; images native via `image_url` parts
//                   (vision-capable models). THE flagship Lite provider.
//   - Anthropic   — CORS-open via the `anthropic-dangerous-direct-browser-access`
//                   header. Native PDF (`document` content block) and images
//                   (`image` content block).
//   - Gemini      — CORS-workable via RAW fetch to `generateContent` (do NOT use
//                   the @google/genai SDK — its Api-Revision header breaks the
//                   CORS preflight). Native PDF AND images (same `inlineData`
//                   part, different mime).
// Direct-vendor APIs for OpenAI / Azure / GLM / Kimi / DeepSeek are NOT
// browser-callable (no CORS, and several vendors' ToS forbid client-side keys)
// — reach those models through OpenRouter instead.

import { PROVIDERS, type ModelSpec } from './providerCatalog'

export type LiteProviderId = 'openrouter' | 'anthropic' | 'gemini'

export interface LiteProviderSpec {
  id: LiteProviderId
  label: string
  /** Curated model list shown in the picker's dropdown. */
  models: ModelSpec[]
  /** Whether the user may also type a free-text model id (OpenRouter/Gemini). */
  allowCustomModel: boolean
  /** Whether this provider accepts a PDF document directly from the browser. */
  supportsPdf: boolean
  /** Whether this provider accepts an IMAGE of a process drawing directly from
   * the browser (photo/screenshot of a flowchart or whiteboard). Same trio as
   * PDF: OpenRouter/Anthropic/Gemini have a verified image part. Used by
   * AiPanelLite to gate the image path per provider. */
  supportsImages: boolean
  /** Where to get an API key (link shown in Settings). */
  keysUrl: string
}

export interface LiteModelCapabilities {
  /** Text generation is required for every selectable model. */
  text: true
  /** Direct PDF/document attachment has been verified for this exact model. */
  pdf: boolean
  /** Direct image attachment has been verified for this exact model. */
  images: boolean
  /**
   * False for a free-text model id that is not in the reviewed registry.
   * Attachment controls must fail closed until that model is reviewed.
   */
  verified: boolean
}

// OpenRouter curated slugs — LIVE-VERIFIED against GET
// https://openrouter.ai/api/v1/models on 2026-07-22 (all present, all list
// `response_format` + `structured_outputs` in supported_parameters). Ordered
// by fit for multilingual / Arabic BPMN extraction. The free-text field below
// covers anything not listed (OpenRouter renames/retires ids frequently).
const OPENROUTER_MODELS: ModelSpec[] = [
  { id: 'z-ai/glm-5.2', label: 'GLM-5.2 (Z.ai) — strong Arabic' },
  { id: 'moonshotai/kimi-k3', label: 'Kimi K3 (Moonshot)' },
  { id: 'deepseek/deepseek-v4-pro', label: 'DeepSeek V4 Pro' },
  { id: 'deepseek/deepseek-v4-flash', label: 'DeepSeek V4 Flash' },
  { id: 'anthropic/claude-opus-4.8', label: 'Claude Opus 4.8 (Anthropic)' },
  { id: 'anthropic/claude-sonnet-5', label: 'Claude Sonnet 5 (Anthropic)' },
  { id: 'google/gemini-3.6-flash', label: 'Gemini 3.6 Flash (Google)' }
]

/** Providers reachable directly from the browser. */
export const LITE_PROVIDERS: LiteProviderSpec[] = [
  {
    id: 'openrouter',
    label: 'OpenRouter',
    models: OPENROUTER_MODELS,
    allowCustomModel: true,
    supportsPdf: true,
    // `image_url` parts are native to chat/completions for vision models —
    // no plugin needed (unlike PDFs).
    supportsImages: true,
    keysUrl: 'https://openrouter.ai/keys'
  },
  {
    id: 'anthropic',
    label: PROVIDERS.anthropic.label,
    models: PROVIDERS.anthropic.models,
    allowCustomModel: false,
    supportsPdf: true,
    // Native `image` content block (base64 source, image before text).
    supportsImages: true,
    keysUrl: 'https://console.anthropic.com/settings/keys'
  },
  {
    id: 'gemini',
    label: PROVIDERS.gemini.label,
    models: PROVIDERS.gemini.models,
    // Gemini model ids drift often — let users override with a free-text id.
    allowCustomModel: true,
    supportsPdf: true,
    // Same `inlineData` part as PDFs, with an image mime.
    supportsImages: true,
    keysUrl: 'https://aistudio.google.com/apikey'
  }
]

export function getLiteProvider(id: LiteProviderId): LiteProviderSpec {
  const spec = LITE_PROVIDERS.find((p) => p.id === id)
  if (!spec) throw new Error(`Unknown lite provider: ${id}`)
  return spec
}

export function defaultLiteModelId(id: LiteProviderId): string {
  return getLiteProvider(id).models[0]?.id ?? ''
}

/**
 * Attachment capability is model-specific. In particular, OpenRouter accepts
 * arbitrary model ids, but an OpenRouter route being browser-callable does not
 * imply that the selected model can consume images or documents. Unknown ids
 * therefore remain usable for text while attachment paths fail closed.
 */
export function getLiteModelCapabilities(
  providerId: LiteProviderId,
  modelId: string
): LiteModelCapabilities {
  const normalizedModel = modelId.trim()
  const provider = getLiteProvider(providerId)
  const reviewed = provider.models.some((model) => model.id === normalizedModel)
  if (!reviewed) {
    return { text: true, pdf: false, images: false, verified: false }
  }

  if (providerId === 'anthropic' || providerId === 'gemini') {
    return { text: true, pdf: true, images: true, verified: true }
  }

  // OpenRouter's PDF parser can provide reviewed text models with document
  // content. Native image parts are enabled only for the reviewed Claude and
  // Gemini routes; the remaining curated routes are text-only in Lite.
  const images =
    normalizedModel.startsWith('anthropic/') || normalizedModel.startsWith('google/')
  return { text: true, pdf: true, images, verified: true }
}

/**
 * Providers whose DIRECT vendor API can't be called from a browser (no CORS or
 * ToS-forbidden client-side keys). Shown as a note so users know to reach these
 * models through OpenRouter instead of expecting a built-in direct option.
 * Sourced from the shared catalog labels.
 */
export const DESKTOP_ONLY_PROVIDERS: string[] = [
  PROVIDERS.openai.label,
  PROVIDERS.azure.label,
  PROVIDERS.moonshot.label,
  PROVIDERS.deepseek.label,
  PROVIDERS.glm.label
]
