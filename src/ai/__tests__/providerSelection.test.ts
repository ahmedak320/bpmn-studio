import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearProviderSelection,
  getProviderSelection,
  resetProviderSelectionForTests,
  setProviderSelection
} from '../providerSelection'

function installStorage(): Map<string, string> {
  const values = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key)
  })
  return values
}

describe('shared explicit provider selection', () => {
  let values: Map<string, string>

  beforeEach(() => {
    resetProviderSelectionForTests()
    values = installStorage()
  })

  afterEach(() => {
    resetProviderSelectionForTests()
    vi.unstubAllGlobals()
  })

  it('has no implicit first-provider fallback', () => {
    expect(getProviderSelection()).toBeNull()
  })

  it('round-trips an explicit provider and model choice', () => {
    expect(setProviderSelection('gemini', 'gemini-flash-latest')).toEqual({
      ok: true,
      value: undefined
    })
    expect(getProviderSelection()).toEqual({
      providerId: 'gemini',
      modelId: 'gemini-flash-latest'
    })
    expect([...values.values()].join(' ')).toContain('gemini-flash-latest')
  })

  it('rejects an empty model', () => {
    expect(setProviderSelection('openrouter', '  ')).toMatchObject({
      ok: false,
      code: 'invalid-input'
    })
    expect(getProviderSelection()).toBeNull()
  })

  it('ignores malformed persisted preferences', () => {
    values.set(
      'orbitpm.lite.cfg.ai-provider-selection.v1',
      JSON.stringify({ providerId: 'removed-custom', modelId: 'model' })
    )
    expect(getProviderSelection()).toBeNull()
  })

  it('clears the shared selection', () => {
    setProviderSelection('anthropic', 'claude-sonnet-5')
    expect(clearProviderSelection()).toEqual({ ok: true, value: undefined })
    expect(getProviderSelection()).toBeNull()
  })
})
