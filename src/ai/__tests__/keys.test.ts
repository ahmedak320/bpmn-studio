import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearKey,
  getKey,
  hasEncryptedKey,
  hasKey,
  keyLast4,
  migrateLegacyPlaintextKeys,
  persistEncryptedKey,
  resetSessionKeysForTests,
  setKey,
  unlockEncryptedKey
} from '../keys'

function installMemoryStorage(): Map<string, string> {
  const values = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    get length() {
      return values.size
    },
    key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, String(value)),
    removeItem: (key: string) => void values.delete(key),
    clear: () => values.clear()
  })
  return values
}

describe('session-only credentials', () => {
  let storage: Map<string, string>

  beforeEach(() => {
    resetSessionKeysForTests()
    storage = installMemoryStorage()
  })

  afterEach(() => {
    resetSessionKeysForTests()
    vi.unstubAllGlobals()
  })

  it('keeps the default key in memory and never writes browser storage', () => {
    expect(setKey('openrouter', '  sk-abcd1234  ')).toEqual({
      ok: true,
      value: undefined
    })
    expect(getKey('openrouter')).toBe('sk-abcd1234')
    expect(hasKey('openrouter')).toBe(true)
    expect(keyLast4('openrouter')).toBe('1234')
    expect(storage.size).toBe(0)

    resetSessionKeysForTests()
    expect(getKey('openrouter')).toBe('')
  })

  it('treats a blank session value as removal', () => {
    setKey('anthropic', 'secret')
    setKey('anthropic', '   ')
    expect(hasKey('anthropic')).toBe(false)
  })

  it('migrates legacy plaintext into memory and deletes its stored copy', () => {
    storage.set('orbitpm.lite.key.gemini', ' legacy-secret ')
    const result = migrateLegacyPlaintextKeys(['openrouter', 'anthropic', 'gemini'])
    expect(result).toEqual({ ok: true, value: 1 })
    expect(getKey('gemini')).toBe('legacy-secret')
    expect(storage.has('orbitpm.lite.key.gemini')).toBe(false)
  })

  it('reports a migration cleanup failure instead of claiming success', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => 'legacy',
      removeItem: () => {
        throw new Error('quota policy')
      }
    })
    const result = migrateLegacyPlaintextKeys(['openrouter'])
    expect(result).toMatchObject({ ok: false, code: 'storage-failed' })
    expect(getKey('openrouter')).toBe('')
  })
})

describe('opt-in encrypted persistence', () => {
  let storage: Map<string, string>

  beforeEach(() => {
    resetSessionKeysForTests()
    storage = installMemoryStorage()
  })

  afterEach(() => {
    resetSessionKeysForTests()
    vi.unstubAllGlobals()
  })

  it('stores only an AES-GCM envelope and unlocks it after session reset', async () => {
    const result = await persistEncryptedKey(
      'openrouter',
      'sk-private-value',
      'correct horse battery staple'
    )
    expect(result.ok).toBe(true)
    const raw = storage.get('orbitpm.lite.key.encrypted.openrouter')
    expect(raw).toBeTruthy()
    expect(raw).not.toContain('sk-private-value')
    expect(raw).not.toContain('correct horse battery staple')
    expect(JSON.parse(raw ?? '{}')).toMatchObject({
      version: 1,
      providerId: 'openrouter',
      algorithm: 'AES-GCM',
      kdf: 'PBKDF2-SHA-256',
      iterations: 310000
    })
    expect(hasEncryptedKey('openrouter')).toBe(true)

    resetSessionKeysForTests()
    expect(getKey('openrouter')).toBe('')
    expect(
      await unlockEncryptedKey('openrouter', 'correct horse battery staple')
    ).toEqual({ ok: true, value: undefined })
    expect(getKey('openrouter')).toBe('sk-private-value')
  })

  it('rejects a wrong passphrase without exposing or loading a key', async () => {
    await persistEncryptedKey('anthropic', 'sk-secret', 'right passphrase')
    resetSessionKeysForTests()
    const result = await unlockEncryptedKey('anthropic', 'wrong passphrase')
    expect(result).toMatchObject({ ok: false, code: 'unlock-failed' })
    expect(getKey('anthropic')).toBe('')
  })

  it('detects authenticated-ciphertext tampering', async () => {
    await persistEncryptedKey('gemini', 'secret', 'passphrase')
    const storageKey = 'orbitpm.lite.key.encrypted.gemini'
    const envelope = JSON.parse(storage.get(storageKey) ?? '{}') as {
      ciphertext: string
    }
    const tail = envelope.ciphertext.endsWith('A') ? 'B' : 'A'
    envelope.ciphertext = envelope.ciphertext.slice(0, -1) + tail
    storage.set(storageKey, JSON.stringify(envelope))
    resetSessionKeysForTests()

    const result = await unlockEncryptedKey('gemini', 'passphrase')
    expect(result).toMatchObject({ ok: false, code: 'unlock-failed' })
    expect(getKey('gemini')).toBe('')
  })

  it('truthfully reports a storage write failure', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {
        throw new Error('storage disabled')
      },
      removeItem: () => undefined
    })
    const result = await persistEncryptedKey('openrouter', 'secret', 'passphrase')
    expect(result).toMatchObject({
      ok: false,
      code: 'storage-failed',
      error: 'storage disabled'
    })
    expect(getKey('openrouter')).toBe('')
  })

  it('clears session, ciphertext, legacy plaintext, and legacy Custom headers', async () => {
    await persistEncryptedKey('openrouter', 'secret', 'passphrase')
    storage.set('orbitpm.lite.key.openrouter', 'old-plaintext')
    storage.set('orbitpm.lite.cfg.openrouter', '{"model":"old"}')
    storage.set('orbitpm.lite.cfg.custom', '{"extraHeaders":{"Authorization":"x"}}')

    expect(clearKey('openrouter')).toEqual({ ok: true, value: undefined })
    expect(getKey('openrouter')).toBe('')
    expect([...storage.keys()]).toEqual([])
  })

  it('reports a cleanup failure while still removing the session copy', () => {
    setKey('openrouter', 'secret')
    vi.stubGlobal('localStorage', {
      removeItem: () => {
        throw new Error('blocked')
      }
    })
    const result = clearKey('openrouter')
    expect(result).toMatchObject({ ok: false, code: 'storage-failed' })
    expect(getKey('openrouter')).toBe('')
  })
})
