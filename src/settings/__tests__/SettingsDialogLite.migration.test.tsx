// @vitest-environment jsdom

import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setLang, t } from '../../i18n'
import { getKey, resetSessionKeysForTests } from '../../ai/keys'
import { resetProviderSelectionForTests } from '../../ai/providerSelection'
import { SettingsDialogLite } from '../SettingsDialogLite'

vi.mock('../LocalizationResourcesEditor', () => ({
  LocalizationResourcesEditor: () => null
}))

function installMemoryStorage(
  removeFailure?: (key: string) => Error | null,
  setFailure?: (key: string) => Error | null
): Map<string, string> {
  const values = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    get length() {
      return values.size
    },
    key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      const failure = setFailure?.(key)
      if (failure) throw failure
      values.set(key, String(value))
    },
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
    resetProviderSelectionForTests()
    setLang('en')
  })

  afterEach(() => {
    cleanup()
    resetSessionKeysForTests()
    resetProviderSelectionForTests()
    setLang('en')
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

    setLang('ar')
    renderOpenSettings()

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain(
      t('settings.storageError.startup', {
        error: t('settings.storageError.failed')
      })
    )
    const detail = within(alert).getByLabelText(t('settings.storageError.technicalDetail'))
    expect(detail.tagName).toBe('CODE')
    expect(detail.getAttribute('lang')).toBe('en')
    expect(detail.getAttribute('dir')).toBe('ltr')
    expect(detail.textContent).toContain('custom cleanup blocked')
    expect(getKey('openrouter')).toBe('legacy-openrouter')
    expect(storage.has('orbitpm.lite.key.custom')).toBe(true)
    expect(storage.has('orbitpm.lite.key.encrypted.custom')).toBe(false)
    expect(storage.has('orbitpm.lite.cfg.custom')).toBe(false)
  })

  it('localizes an Arabic provider-selection storage failure and isolates browser detail', async () => {
    installMemoryStorage(undefined, (key) =>
      key === 'orbitpm.lite.cfg.ai-provider-selection.v1'
        ? new Error('native preference write blocked')
        : null
    )
    setLang('ar')
    const user = userEvent.setup()
    renderOpenSettings()

    await user.selectOptions(screen.getByLabelText(t('ai.provider.label')), 'openrouter')
    await user.click(screen.getByRole('button', { name: t('settings.saveKeys') }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain(
      t('settings.storageError.providerSelection', {
        error: t('settings.storageError.failed')
      })
    )
    const detail = within(alert).getByLabelText(t('settings.storageError.technicalDetail'))
    expect(detail.tagName).toBe('CODE')
    expect(detail.getAttribute('lang')).toBe('en')
    expect(detail.textContent).toBe('native preference write blocked')
  })
})
