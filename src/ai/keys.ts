// API-key + endpoint-config storage for Lite. Unlike the desktop app
// (OS-encrypted safeStorage in the main process), a pure browser page has no
// secure vault — values live in localStorage, scoped to this browser profile +
// origin. The Settings dialog surfaces the warning below prominently so the
// user makes an informed choice.

import type { LiteProviderId } from './providersLite'

const KEY_PREFIX = 'orbitpm.lite.key.'
const CFG_PREFIX = 'orbitpm.lite.cfg.'

export const KEY_STORAGE_WARNING =
  'Your API key is stored unencrypted in this browser profile (localStorage). ' +
  'Anyone with access to this computer profile can read it. Use only on a machine you trust, ' +
  'and clear the key when you are done on a shared computer.'

// --- per-provider API keys -------------------------------------------------

export function getKey(providerId: LiteProviderId): string {
  try {
    return localStorage.getItem(KEY_PREFIX + providerId) ?? ''
  } catch {
    return ''
  }
}

export function hasKey(providerId: LiteProviderId): boolean {
  return getKey(providerId).length > 0
}

export function setKey(providerId: LiteProviderId, value: string): void {
  try {
    const trimmed = value.trim()
    if (trimmed) localStorage.setItem(KEY_PREFIX + providerId, trimmed)
    else localStorage.removeItem(KEY_PREFIX + providerId)
  } catch {
    // localStorage can throw in private-mode / disabled-storage; ignore.
  }
}

export function clearKey(providerId: LiteProviderId): void {
  try {
    localStorage.removeItem(KEY_PREFIX + providerId)
  } catch {
    /* ignore */
  }
}

/** Last 4 chars of a stored key, for a non-revealing "Configured (••••1234)" hint. */
export function keyLast4(providerId: LiteProviderId): string {
  const k = getKey(providerId)
  return k ? k.slice(-4) : ''
}

// --- custom OpenAI-compatible endpoint config ------------------------------

export interface CustomEndpointConfig {
  /** Root of the OpenAI-compatible API, WITHOUT a trailing /chat/completions. */
  baseURL: string
  /** Model id understood by that endpoint. */
  model: string
  /** Optional vendor-specific headers (besides Authorization). */
  extraHeaders: Record<string, string>
}

export const EMPTY_CUSTOM_CONFIG: CustomEndpointConfig = {
  baseURL: '',
  model: '',
  extraHeaders: {}
}

export function getCustomConfig(): CustomEndpointConfig {
  try {
    const raw = localStorage.getItem(CFG_PREFIX + 'custom')
    if (!raw) return { ...EMPTY_CUSTOM_CONFIG }
    const parsed = JSON.parse(raw) as Partial<CustomEndpointConfig>
    return {
      baseURL: typeof parsed.baseURL === 'string' ? parsed.baseURL : '',
      model: typeof parsed.model === 'string' ? parsed.model : '',
      extraHeaders:
        parsed.extraHeaders && typeof parsed.extraHeaders === 'object'
          ? (parsed.extraHeaders as Record<string, string>)
          : {}
    }
  } catch {
    return { ...EMPTY_CUSTOM_CONFIG }
  }
}

export function setCustomConfig(cfg: CustomEndpointConfig): void {
  try {
    localStorage.setItem(CFG_PREFIX + 'custom', JSON.stringify(cfg))
  } catch {
    /* ignore */
  }
}

/** Custom endpoint is "usable" once it has a base URL and a model id. */
export function customConfigReady(cfg: CustomEndpointConfig): boolean {
  return cfg.baseURL.trim().length > 0 && cfg.model.trim().length > 0
}

// --- generic per-provider string preference (e.g. last free-text model) ----

export function getPref(name: string): string {
  try {
    return localStorage.getItem(CFG_PREFIX + name) ?? ''
  } catch {
    return ''
  }
}

export function setPref(name: string, value: string): void {
  try {
    if (value) localStorage.setItem(CFG_PREFIX + name, value)
    else localStorage.removeItem(CFG_PREFIX + name)
  } catch {
    /* ignore */
  }
}

/**
 * Parse a free-text "Key: Value" (one per line) blob into a header map. Blank
 * lines and lines without a colon are skipped; the first colon splits. Used by
 * the Custom-endpoint form so users can add vendor headers without JSON.
 */
export function parseHeaderLines(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const idx = trimmed.indexOf(':')
    if (idx <= 0) continue
    const name = trimmed.slice(0, idx).trim()
    const value = trimmed.slice(idx + 1).trim()
    if (name) out[name] = value
  }
  return out
}

/** Inverse of parseHeaderLines — render a header map as "Key: Value" lines. */
export function headerLinesToText(headers: Record<string, string>): string {
  return Object.entries(headers)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n')
}
