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

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

function installDeferredCrypto(): {
  derivations: Deferred<CryptoKey>[]
  encrypt: ReturnType<typeof vi.fn>
} {
  const derivations: Deferred<CryptoKey>[] = []
  const encrypt = vi.fn(async () => new Uint8Array([1, 2, 3, 4]).buffer)
  let randomCall = 0
  vi.stubGlobal('crypto', {
    getRandomValues: <T extends ArrayBufferView>(value: T): T => {
      randomCall += 1
      new Uint8Array(value.buffer, value.byteOffset, value.byteLength).fill(randomCall)
      return value
    },
    subtle: {
      importKey: vi.fn(async () => ({ type: 'secret' }) as CryptoKey),
      deriveKey: vi.fn(() => {
        const operation = deferred<CryptoKey>()
        derivations.push(operation)
        return operation.promise
      }),
      encrypt
    }
  } as unknown as Crypto)
  return { derivations, encrypt }
}

function encryptedSlotEntries(storage: Map<string, string>): Array<[string, string]> {
  return [...storage.entries()].filter(([key]) =>
    key.startsWith('orbitpm.lite.key.encrypted.slot.')
  )
}

function operationMetadataEntries(storage: Map<string, string>): Array<[string, string]> {
  return [...storage.entries()].filter(([key]) => key.startsWith('orbitpm.lite.key.operation.'))
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
    const raw = encryptedSlotEntries(storage)[0]?.[1]
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
    const storageKey = encryptedSlotEntries(storage)[0]?.[0]
    if (!storageKey) throw new Error('encrypted slot was not stored')
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

  it('does not report a false failure when obsolete ciphertext cleanup is refused post-commit', async () => {
    expect(await persistEncryptedKey('openrouter', 'older-key', 'older-passphrase')).toEqual({
      ok: true,
      value: undefined
    })
    const olderSlot = encryptedSlotEntries(storage)[0]?.[0]
    if (!olderSlot) throw new Error('older encrypted slot was not stored')
    vi.stubGlobal('localStorage', {
      get length() {
        return storage.size
      },
      key: (index: number) => [...storage.keys()][index] ?? null,
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => void storage.set(key, String(value)),
      removeItem: (key: string) => {
        if (key === olderSlot) throw new Error('obsolete cleanup blocked')
        storage.delete(key)
      },
      clear: () => storage.clear()
    })

    expect(await persistEncryptedKey('openrouter', 'newer-key', 'newer-passphrase')).toEqual({
      ok: true,
      value: undefined
    })
    expect(getKey('openrouter')).toBe('newer-key')
    expect(hasEncryptedKey('openrouter')).toBe(true)
    expect(encryptedSlotEntries(storage)).toHaveLength(2)

    for (let attempt = 0; attempt < 20; attempt += 1) {
      await expect(
        persistEncryptedKey('openrouter', `refused-key-${attempt}`, 'another-passphrase')
      ).resolves.toMatchObject({
        ok: false,
        code: 'storage-failed'
      })
      expect(encryptedSlotEntries(storage)).toHaveLength(2)
      expect(getKey('openrouter')).toBe('newer-key')
    }
    expect(operationMetadataEntries(storage)).toHaveLength(1)
  })

  it('fails legacy plaintext cleanup before creating an encrypted commit', async () => {
    storage.set('orbitpm.lite.key.openrouter', 'legacy-plaintext')
    vi.stubGlobal('localStorage', {
      get length() {
        return storage.size
      },
      key: (index: number) => [...storage.keys()][index] ?? null,
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => void storage.set(key, String(value)),
      removeItem: (key: string) => {
        if (key === 'orbitpm.lite.key.openrouter') throw new Error('plaintext cleanup blocked')
        storage.delete(key)
      },
      clear: () => storage.clear()
    })

    await expect(
      persistEncryptedKey('openrouter', 'new-key', 'new-passphrase')
    ).resolves.toMatchObject({
      ok: false,
      code: 'storage-failed',
      error: 'plaintext cleanup blocked'
    })
    expect(encryptedSlotEntries(storage)).toEqual([])
    const failedSaveBarrier = operationMetadataEntries(storage)
    expect(failedSaveBarrier).toHaveLength(1)
    expect(JSON.parse(failedSaveBarrier[0]?.[1] ?? '{}')).toMatchObject({
      kind: 'failed-save'
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
    expect(encryptedSlotEntries(storage)).toEqual([])
    const clearBarrier = operationMetadataEntries(storage)
    expect(clearBarrier).toHaveLength(1)
    expect(clearBarrier[0]?.[0]).toMatch(/^orbitpm\.lite\.key\.operation\.openrouter\./)
    expect(JSON.parse(clearBarrier[0]?.[1] ?? '{}')).toMatchObject({ kind: 'clear' })
  })

  it('reuses one Clear barrier when repeated cleanup attempts are refused', async () => {
    expect(await persistEncryptedKey('openrouter', 'stored-key', 'passphrase')).toEqual({
      ok: true,
      value: undefined
    })
    vi.stubGlobal('localStorage', {
      get length() {
        return storage.size
      },
      key: (index: number) => [...storage.keys()][index] ?? null,
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => void storage.set(key, String(value)),
      removeItem: (key: string) => {
        if (
          key.startsWith('orbitpm.lite.key.operation.') ||
          key.startsWith('orbitpm.lite.key.encrypted.slot.')
        ) {
          throw new Error('cleanup blocked')
        }
        storage.delete(key)
      },
      clear: () => storage.clear()
    })

    for (let attempt = 0; attempt < 40; attempt += 1) {
      expect(clearKey('openrouter')).toMatchObject({
        ok: false,
        code: 'storage-failed'
      })
    }

    expect(operationMetadataEntries(storage)).toHaveLength(1)
    expect(encryptedSlotEntries(storage)).toHaveLength(1)
    expect(hasEncryptedKey('openrouter')).toBe(false)
    expect(getKey('openrouter')).toBe('')
  })

  it('seals at a fixed metadata cap when operation cleanup is repeatedly refused', async () => {
    expect(await persistEncryptedKey('openrouter', 'initial-key', 'passphrase')).toEqual({
      ok: true,
      value: undefined
    })
    storage.set('orbitpm.lite.key.openrouter', 'cleanup-refused')
    vi.stubGlobal('localStorage', {
      get length() {
        return storage.size
      },
      key: (index: number) => [...storage.keys()][index] ?? null,
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => void storage.set(key, String(value)),
      removeItem: (key: string) => {
        if (
          key.startsWith('orbitpm.lite.key.operation.') ||
          key === 'orbitpm.lite.key.openrouter'
        ) {
          throw new Error('metadata cleanup blocked')
        }
        storage.delete(key)
      },
      clear: () => storage.clear()
    })

    const results = []
    for (let attempt = 0; attempt < 20; attempt += 1) {
      results.push(await persistEncryptedKey('openrouter', `replacement-${attempt}`, 'passphrase'))
    }
    expect(results.some((result) => !result.ok && result.code === 'storage-failed')).toBe(true)
    expect(operationMetadataEntries(storage)).toHaveLength(9)
    expect(storage.get('orbitpm.lite.key.operation.seal.openrouter')).toBe('1')

    for (let attempt = 0; attempt < 20; attempt += 1) {
      clearKey('openrouter')
    }
    expect(operationMetadataEntries(storage)).toHaveLength(9)
    expect(hasEncryptedKey('openrouter')).toBe(false)
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

  it('prevents a late encrypted save from recreating a credential after Clear', async () => {
    setKey('openrouter', 'existing-session-key')
    storage.set('orbitpm.lite.key.encrypted.openrouter', '{"existing":true}')
    const crypto = installDeferredCrypto()

    const olderSave = persistEncryptedKey('openrouter', 'late-key', 'passphrase')
    await vi.waitFor(() => expect(crypto.derivations).toHaveLength(1))

    expect(clearKey('openrouter')).toEqual({ ok: true, value: undefined })
    crypto.derivations[0]!.resolve({ type: 'secret' } as CryptoKey)

    await expect(olderSave).resolves.toMatchObject({
      ok: false,
      code: 'operation-cancelled'
    })
    expect(crypto.encrypt).not.toHaveBeenCalled()
    expect(getKey('openrouter')).toBe('')
    expect(encryptedSlotEntries(storage)).toEqual([])
  })

  it('commits only the newest encrypted save regardless of crypto completion order', async () => {
    const crypto = installDeferredCrypto()

    const olderSave = persistEncryptedKey('openrouter', 'older-key', 'old-passphrase')
    await vi.waitFor(() => expect(crypto.derivations).toHaveLength(1))
    const newerSave = persistEncryptedKey('openrouter', 'newer-key', 'new-passphrase')
    await vi.waitFor(() => expect(crypto.derivations).toHaveLength(2))

    crypto.derivations[1]!.resolve({ type: 'secret' } as CryptoKey)
    await expect(newerSave).resolves.toEqual({ ok: true, value: undefined })
    crypto.derivations[0]!.resolve({ type: 'secret' } as CryptoKey)
    await expect(olderSave).resolves.toMatchObject({
      ok: false,
      code: 'operation-cancelled'
    })

    expect(crypto.encrypt).toHaveBeenCalledTimes(1)
    expect(getKey('openrouter')).toBe('newer-key')
    expect(encryptedSlotEntries(storage)).toHaveLength(1)
  })
})
