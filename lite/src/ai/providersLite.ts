// The subset of the desktop app's provider catalog that Lite can actually use
// from a browser (CORS-capable), plus the labels for the providers that are
// intentionally NOT available in the web build. Reuses the shared PROVIDERS
// catalog (src/shared/providers.ts) for model ids/labels so the two stay in
// sync — Lite never re-declares a model list.

import { PROVIDERS, type ModelSpec } from '@app/shared/providers'
import type { LiteProviderId } from './browserAi'

export interface LiteProviderSpec {
  id: LiteProviderId
  label: string
  models: ModelSpec[]
  /** Where to get an API key (shown in Settings). */
  keysUrl: string
}

/** Providers reachable directly from the browser. */
export const LITE_PROVIDERS: LiteProviderSpec[] = [
  {
    id: 'anthropic',
    label: PROVIDERS.anthropic.label,
    models: PROVIDERS.anthropic.models,
    keysUrl: 'https://console.anthropic.com/settings/keys'
  },
  {
    id: 'gemini',
    label: PROVIDERS.gemini.label,
    models: PROVIDERS.gemini.models,
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

/** Providers that require the desktop app or a future web backend (no browser
 * CORS). Shown as a note in the AI panel so users aren't surprised. */
export const DESKTOP_ONLY_PROVIDERS: string[] = [
  PROVIDERS.openai.label,
  PROVIDERS.moonshot.label,
  PROVIDERS.deepseek.label,
  PROVIDERS.azure.label,
  PROVIDERS.glm.label
]
