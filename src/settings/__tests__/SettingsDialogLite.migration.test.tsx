// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getKey, resetSessionKeysForTests } from '../../ai/keys'
import { SettingsDialogLite } from '../SettingsDialogLite'

vi.mock('../LocalizationResourcesEditor', () => ({
  LocalizationResourcesEditor: () => null
}))

function installMemoryStorage(removeFailure?: (key: string) => Error | null): Map<string, string> {
  const values = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    get length() {
      return values.size
    },
    key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, String(value)),
    removeItem: (key: string) => {
      const failure = removeFailure?.(key)
      if (failure) throw failure
      values.delete(key)
    },
    clear: () => values.clear()
  })
  return values
}

function renderOpenSettings(): void {
  render(
    <SettingsDialogLite
      open
      onClose={vi.fn()}
      onKeysChanged={vi.fn()}
      onOrgStylingChanged={vi.fn()}
    />
  )
}

describe('SettingsDialogLite legacy credential upgrade', () => {
  beforeEach(() => {
    resetSessionKeysForTests()
  })

  afterEach(() => {
    cleanup()
    resetSessionKeysForTests()
    vi.unstubAllGlobals()
  })

  it('reuses the startup migration for every active key and retired Custom artifact', async () => {
    const storage = installMemoryStorage()
    storage.set('orbitpm.lite.key.openrouter', 'legacy-openrouter')
    storage.set('orbitpm.lite.key.anthropic', 'legacy-anthropic')
    storage.set('orbitpm.lite.key.gemini', 'legacy-gemini')
    storage.set('orbitpm.lite.key.custom', 'retired-custom-key')
    storage.set('orbitpm.lite.key.encrypted.custom', '{"ciphertext":"retired"}')
    storage.set('orbitpm.lite.cfg.custom', '{"extraHeaders":{"Authorization":"secret"}}')

    renderOpenSettings()

    await waitFor(() => {
      expect(getKey('openrouter')).toBe('legacy-openrouter')
      expect(getKey('anthropic')).toBe('legacy-anthropic')
      expect(getKey('gemini')).toBe('legacy-gemini')
      expect(storage.size).toBe(0)
    })
  })

  it('surfaces an incomplete startup cleanup instead of claiming success', async () => {
    const storage = installMemoryStorage((key) =>
      key === 'orbitpm.lite.key.custom' ? new Error('custom cleanup blocked') : null
    )
    storage.set('orbitpm.lite.key.openrouter', 'legacy-openrouter')
    storage.set('orbitpm.lite.key.custom', 'retired-custom-key')
    storage.set('orbitpm.lite.key.encrypted.custom', '{"ciphertext":"retired"}')
    storage.set('orbitpm.lite.cfg.custom', '{"extraHeaders":{"Authorization":"secret"}}')

    renderOpenSettings()

    expect((await screen.findByRole('alert')).textContent).toContain('custom cleanup blocked')
    expect(getKey('openrouter')).toBe('legacy-openrouter')
    expect(storage.has('orbitpm.lite.key.custom')).toBe(true)
    expect(storage.has('orbitpm.lite.key.encrypted.custom')).toBe(false)
    expect(storage.has('orbitpm.lite.cfg.custom')).toBe(false)
  })
})
