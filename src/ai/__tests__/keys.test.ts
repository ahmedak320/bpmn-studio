import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  parseHeaderLines,
  headerLinesToText,
  customConfigReady,
  getCustomConfig,
  setCustomConfig,
  getKey,
  setKey,
  hasKey,
  clearKey,
  keyLast4,
  EMPTY_CUSTOM_CONFIG,
  type CustomEndpointConfig
} from '../keys'

// In-memory localStorage stub (vitest env is node — no DOM storage).
function installMemoryStorage(): Map<string, string> {
  const store = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear()
  })
  return store
}

describe('header line parsing (Custom endpoint form)', () => {
  it('parses Key: Value lines, skipping blanks and colon-less lines', () => {
    const headers = parseHeaderLines('X-Org: acme\n\nAuthorization skip-me\nX-Env:  prod \n')
    expect(headers).toEqual({ 'X-Org': 'acme', 'X-Env': 'prod' })
  })

  it('round-trips through headerLinesToText', () => {
    const headers = { 'X-A': '1', 'X-B': '2' }
    expect(parseHeaderLines(headerLinesToText(headers))).toEqual(headers)
  })

  it('keeps colons inside the value (only the first colon splits)', () => {
    expect(parseHeaderLines('X-Url: https://x/y')).toEqual({ 'X-Url': 'https://x/y' })
  })
})

describe('customConfigReady', () => {
  it('requires both a base URL and a model', () => {
    expect(customConfigReady({ baseURL: '', model: 'm', extraHeaders: {} })).toBe(false)
    expect(customConfigReady({ baseURL: 'https://x', model: '', extraHeaders: {} })).toBe(false)
    expect(customConfigReady({ baseURL: 'https://x', model: 'm', extraHeaders: {} })).toBe(true)
  })
})

describe('storage round-trips', () => {
  beforeEach(() => installMemoryStorage())
  afterEach(() => vi.unstubAllGlobals())

  it('stores, reads, masks and clears a provider key', () => {
    expect(hasKey('openrouter')).toBe(false)
    setKey('openrouter', '  sk-abcd1234  ')
    expect(getKey('openrouter')).toBe('sk-abcd1234') // trimmed
    expect(hasKey('openrouter')).toBe(true)
    expect(keyLast4('openrouter')).toBe('1234')
    clearKey('openrouter')
    expect(hasKey('openrouter')).toBe(false)
  })

  it('setKey with a blank value removes the key', () => {
    setKey('anthropic', 'x')
    setKey('anthropic', '   ')
    expect(hasKey('anthropic')).toBe(false)
  })

  it('persists and reloads the custom endpoint config', () => {
    const cfg: CustomEndpointConfig = {
      baseURL: 'https://api.example.com/v1',
      model: 'llama-3.3',
      extraHeaders: { 'X-Org': 'acme' }
    }
    setCustomConfig(cfg)
    expect(getCustomConfig()).toEqual(cfg)
  })

  it('returns the empty config when nothing is stored', () => {
    expect(getCustomConfig()).toEqual(EMPTY_CUSTOM_CONFIG)
  })
})

describe('graceful degradation without storage', () => {
  it('getKey/getCustomConfig do not throw when localStorage is unavailable', () => {
    vi.stubGlobal('localStorage', undefined)
    expect(() => getKey('gemini')).not.toThrow()
    expect(getKey('gemini')).toBe('')
    expect(getCustomConfig()).toEqual(EMPTY_CUSTOM_CONFIG)
    vi.unstubAllGlobals()
  })
})
