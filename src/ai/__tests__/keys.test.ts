import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearKey,
  getKey,
  hasEncryptedKey,
  hasKey,
  keyLast4,
  migrateLegacyCredentialsOnStartup,
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

  it('migrates every active legacy key and removes all active and Custom plaintext artifacts', () => {
    storage.set('orbitpm.lite.key.openrouter', ' legacy-openrouter ')
    storage.set('orbitpm.lite.key.anthropic', 'legacy-anthropic')
    storage.set('orbitpm.lite.key.gemini', ' legacy-gemini ')
    storage.set('orbitpm.lite.key.custom', 'retired-custom-key')
    storage.set('orbitpm.lite.key.encrypted.custom', '{"ciphertext":"retired"}')
    storage.set(
      'orbitpm.lite.cfg.custom',
      '{"baseURL":"https://retired.invalid","extraHeaders":{"Authorization":"secret"}}'
    )

    expect(migrateLegacyCredentialsOnStartup()).toEqual({ ok: true, value: 3 })
    expect(getKey('openrouter')).toBe('legacy-openrouter')
    expect(getKey('anthropic')).toBe('legacy-anthropic')
    expect(getKey('gemini')).toBe('legacy-gemini')
    expect(storage.size).toBe(0)

    // The exact startup call is safe under StrictMode/re-entry and preserves the
    // already-recovered session vault without claiming another migration.
    expect(migrateLegacyCredentialsOnStartup()).toEqual({ ok: true, value: 0 })
    expect(getKey('openrouter')).toBe('legacy-openrouter')
    expect(getKey('anthropic')).toBe('legacy-anthropic')
    expect(getKey('gemini')).toBe('legacy-gemini')
  })

  it('recovers readable keys, attempts every deletion, and reports a partial cleanup failure', () => {
    storage.set('orbitpm.lite.key.openrouter', 'legacy-openrouter')
    storage.set('orbitpm.lite.key.anthropic', 'legacy-anthropic')
    storage.set('orbitpm.lite.key.gemini', 'legacy-gemini')
    storage.set('orbitpm.lite.key.custom', 'retired-custom-key')
    storage.set('orbitpm.lite.key.encrypted.custom', '{"ciphertext":"retired"}')
    storage.set('orbitpm.lite.cfg.custom', '{"extraHeaders":{"X-Secret":"value"}}')
    const attempted: string[] = []
    let blockAnthropicDelete = true
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      removeItem: (key: string) => {
        attempted.push(key)
        if (blockAnthropicDelete && key === 'orbitpm.lite.key.anthropic') {
          throw new Error('quota policy')
        }
        storage.delete(key)
      }
    })

    const result = migrateLegacyCredentialsOnStartup()
    expect(result).toMatchObject({ ok: false, code: 'storage-failed' })
    expect(result).toMatchObject({ error: expect.stringContaining('quota policy') })
    expect(getKey('openrouter')).toBe('legacy-openrouter')
    expect(getKey('anthropic')).toBe('legacy-anthropic')
    expect(getKey('gemini')).toBe('legacy-gemini')
    expect(new Set(attempted)).toEqual(
      new Set([
        'orbitpm.lite.key.openrouter',
        'orbitpm.lite.key.anthropic',
        'orbitpm.lite.key.gemini',
        'orbitpm.lite.key.custom',
        'orbitpm.lite.key.encrypted.custom',
        'orbitpm.lite.cfg.custom'
      ])
    )
    expect([...storage.keys()]).toEqual(['orbitpm.lite.key.anthropic'])

    // A retry removes the remaining artifact without overwriting a newer
    // session value with the stale legacy copy.
    setKey('anthropic', 'new-session-anthropic')
    blockAnthropicDelete = false
    expect(migrateLegacyCredentialsOnStartup()).toEqual({ ok: true, value: 0 })
    expect(getKey('anthropic')).toBe('new-session-anthropic')
    expect(storage.size).toBe(0)
  })

  it('reports a read failure while recovering and cleaning every other artifact', () => {
    storage.set('orbitpm.lite.key.openrouter', 'legacy-openrouter')
    storage.set('orbitpm.lite.key.anthropic', 'unreadable-anthropic')
    storage.set('orbitpm.lite.key.gemini', 'legacy-gemini')
    storage.set('orbitpm.lite.key.custom', 'retired-custom-key')
    storage.set('orbitpm.lite.key.encrypted.custom', '{"ciphertext":"retired"}')
    storage.set('orbitpm.lite.cfg.custom', '{"extraHeaders":{"X-Secret":"value"}}')
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => {
        if (key === 'orbitpm.lite.key.anthropic') throw new Error('read blocked')
        return storage.get(key) ?? null
      },
      removeItem: (key: string) => void storage.delete(key)
    })

    const result = migrateLegacyCredentialsOnStartup()
    expect(result).toMatchObject({
      ok: false,
      code: 'storage-failed',
      error: expect.stringContaining('read blocked')
    })
    expect(getKey('openrouter')).toBe('legacy-openrouter')
    expect(getKey('anthropic')).toBe('')
    expect(getKey('gemini')).toBe('legacy-gemini')
    expect(storage.size).toBe(0)
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
    expect(await unlockEncryptedKey('openrouter', 'correct horse battery staple')).toEqual({
      ok: true,
      value: undefined
    })
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
    storage.set('orbitpm.lite.key.custom', 'retired-custom-key')
    storage.set('orbitpm.lite.key.encrypted.custom', '{"ciphertext":"retired"}')
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
