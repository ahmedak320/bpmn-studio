import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getKey, resetSessionKeysForTests, setKey } from '../keys'
import { forgetDeviceKey, hasDeviceKey, rememberKeyOnDevice, restoreDeviceKeys } from '../deviceKeys'
import { installFakeIndexedDb } from './fakeIndexedDb'

function installMemoryStorage(): Map<string, string> {
  const values = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, String(value)),
    removeItem: (key: string) => void values.delete(key)
  })
  return values
}

describe('remembered API keys on this browser', () => {
  let storage: Map<string, string>

  beforeEach(() => {
    storage = installMemoryStorage()
    installFakeIndexedDb()
    resetSessionKeysForTests()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    resetSessionKeysForTests()
  })

  it('remembers a key without a passphrase and loads it again in a new session', async () => {
    const saved = await rememberKeyOnDevice('openrouter', '  sk-test-remembered-123  ')
    expect(saved.ok).toBe(true)
    expect(hasDeviceKey('openrouter')).toBe(true)

    const stored = storage.get('orbitpm.lite.device.openrouter') ?? ''
    expect(stored).not.toContain('sk-test-remembered-123')

    resetSessionKeysForTests()
    expect(getKey('openrouter')).toBe('')
    expect(await restoreDeviceKeys()).toBe(1)
    expect(getKey('openrouter')).toBe('sk-test-remembered-123')
  })

  it('leaves a key that is already loaded alone and restores nothing without a record', async () => {
    expect(await restoreDeviceKeys()).toBe(0)
    setKey('openrouter', 'sk-one')
    await rememberKeyOnDevice('openrouter', 'sk-one')
    expect(await restoreDeviceKeys()).toBe(0)
    expect(getKey('openrouter')).toBe('sk-one')
  })

  it('forgets a remembered key so the next session does not load it', async () => {
    await rememberKeyOnDevice('openrouter', 'sk-to-forget')
    expect(forgetDeviceKey('openrouter').ok).toBe(true)
    expect(hasDeviceKey('openrouter')).toBe(false)

    resetSessionKeysForTests()
    expect(await restoreDeviceKeys()).toBe(0)
    expect(getKey('openrouter')).toBe('')
  })

  it('keeps a record it cannot decrypt instead of loading garbage', async () => {
    await rememberKeyOnDevice('openrouter', 'sk-tampered')
    const record = JSON.parse(storage.get('orbitpm.lite.device.openrouter') ?? '{}') as {
      v: number
      iv: string
      ct: string
    }
    storage.set(
      'orbitpm.lite.device.openrouter',
      JSON.stringify({ ...record, ct: btoa('not the real ciphertext at all') })
    )

    resetSessionKeysForTests()
    expect(await restoreDeviceKeys()).toBe(0)
    expect(getKey('openrouter')).toBe('')
    expect(hasDeviceKey('openrouter')).toBe(true)
  })

  it('will not load a key under a different provider than the one it was saved for', async () => {
    await rememberKeyOnDevice('openrouter', 'sk-bound-to-openrouter')
    storage.set('orbitpm.lite.device.anthropic', storage.get('orbitpm.lite.device.openrouter') ?? '')

    resetSessionKeysForTests()
    expect(await restoreDeviceKeys()).toBe(1)
    expect(getKey('openrouter')).toBe('sk-bound-to-openrouter')
    expect(getKey('anthropic')).toBe('')
  })

  it('refuses an empty key', async () => {
    const result = await rememberKeyOnDevice('openrouter', '   ')
    expect(result.ok).toBe(false)
    expect(hasDeviceKey('openrouter')).toBe(false)
  })
})
