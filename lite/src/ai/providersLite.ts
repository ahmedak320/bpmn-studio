// Browser-direct provider registry for OrbitPM Process Studio Lite.
//
// Unlike the desktop app (which runs 7 providers through the Electron main
// process, where CORS never applies), Lite calls providers DIRECTLY from the
// web page. Only providers that send permissive CORS headers can be reached
// this way. Per the verified provider matrix (scratchpad/prep/provider-matrix.md,
// re-verified 2026-07-22):
//
//   - OpenRouter  — CORS-open by design (BYOK browser apps are its use case).
//                   One key reaches GLM-5.2, Kimi K3, DeepSeek V4, Claude and
//                   Gemini (via `provider/model` slugs). PDF via the
//                   `file-parser` plugin. THE flagship Lite provider.
//   - Anthropic   — CORS-open via the `anthropic-dangerous-direct-browser-access`
//                   header. Native PDF (`document` content block).
//   - Gemini      — CORS-workable via RAW fetch to `generateContent` (do NOT use
//                   the @google/genai SDK — its Api-Revision header breaks the
//                   CORS preflight). Native PDF (`inlineData` part).
//   - Custom      — user-supplied OpenAI-compatible endpoint (baseURL/key/model/
//                   extraHeaders): the escape hatch for self-hosted proxies and
//                   any other CORS-enabled OpenAI-shaped API.
//
// Direct-vendor APIs for OpenAI / Azure / GLM / Kimi / DeepSeek are NOT
// browser-callable (no CORS, and several vendors' ToS forbid client-side keys)
// — reach those models through OpenRouter or the Custom endpoint instead.

import { PROVIDERS, type ModelSpec } from '@app/shared/providers'

export type LiteProviderId = 'openrouter' | 'anthropic' | 'gemini' | 'custom'

export interface LiteProviderSpec {
  id: LiteProviderId
  label: string
  /** Curated model list shown in the picker's dropdown. */
  models: ModelSpec[]
  /** Whether the user may also type a free-text model id (OpenRouter / Custom /
   * Gemini, whose ids drift). */
  allowCustomModel: boolean
  /** Whether this provider accepts a PDF document directly from the browser. */
  supportsPdf: boolean
  /** True when the user must configure a base URL (Custom OpenAI-compatible). */
  needsEndpointConfig: boolean
  /**
   * True when this provider CANNOT be reached from the browser under the page's
   * strict CSP connect-src allowlist (only self + OpenRouter/Anthropic/Gemini
   * are whitelisted). The Custom OpenAI-compatible endpoint points at an
   * arbitrary user host that is not — and cannot be — on that allowlist, so it
   * is surfaced as "desktop app only": its Test/Generate actions are disabled in
   * Lite. See index.html's CSP and the note copy in the dictionaries.
   */
  desktopOnly?: boolean
  /** Where to get an API key (link shown in Settings). */
  keysUrl: string
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
    needsEndpointConfig: false,
    keysUrl: 'https://openrouter.ai/keys'
  },
  {
    id: 'anthropic',
    label: PROVIDERS.anthropic.label,
    models: PROVIDERS.anthropic.models,
    allowCustomModel: false,
    supportsPdf: true,
    needsEndpointConfig: false,
    keysUrl: 'https://console.anthropic.com/settings/keys'
  },
  {
    id: 'gemini',
    label: PROVIDERS.gemini.label,
    models: PROVIDERS.gemini.models,
    // Gemini model ids drift often — let users override with a free-text id.
    allowCustomModel: true,
    supportsPdf: true,
    needsEndpointConfig: false,
    keysUrl: 'https://aistudio.google.com/apikey'
  },
  {
    id: 'custom',
    label: 'Custom OpenAI-compatible',
    models: [],
    allowCustomModel: true,
    // A user endpoint MAY support PDF, but we can't assume it — keep PDF to the
    // providers with a verified document path.
    supportsPdf: false,
    needsEndpointConfig: true,
    // An arbitrary user host is not on the page's CSP connect-src allowlist, so
    // it cannot be reached from the browser: desktop app only.
    desktopOnly: true,
    keysUrl: ''
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
 * Providers whose DIRECT vendor API can't be called from a browser (no CORS or
 * ToS-forbidden client-side keys). Shown as a note so users know to reach these
 * models through OpenRouter or the Custom endpoint instead of expecting a
 * built-in direct option. Sourced from the shared desktop catalog labels.
 */
export const DESKTOP_ONLY_PROVIDERS: string[] = [
  PROVIDERS.openai.label,
  PROVIDERS.azure.label,
  PROVIDERS.moonshot.label,
  PROVIDERS.deepseek.label,
  PROVIDERS.glm.label
]
