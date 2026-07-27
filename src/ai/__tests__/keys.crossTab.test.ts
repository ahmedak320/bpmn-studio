import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type KeysRealm = typeof import('../keys')

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

function installSharedStorage(): Map<string, string> {
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

function installDeferredCrypto(): {
  derivations: Deferred<CryptoKey>[]
  encrypt: ReturnType<typeof vi.fn>
} {
  const derivations: Deferred<CryptoKey>[] = []
  const encrypt = vi.fn(async () => new Uint8Array([3, 1, 4, 1, 5]).buffer)
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

async function importFreshRealm(realms: KeysRealm[]): Promise<KeysRealm> {
  vi.resetModules()
  const realm = await import('../keys')
  realms.push(realm)
  return realm
}

describe('cross-tab encrypted credential ordering', () => {
  const realms: KeysRealm[] = []
  let storage: Map<string, string>

  beforeEach(() => {
    storage = installSharedStorage()
  })

  afterEach(() => {
    for (const realm of realms) realm.resetSessionKeysForTests()
    realms.length = 0
    vi.resetModules()
    vi.unstubAllGlobals()
  })

  it('makes Tab B Clear authoritative over Tab A PBKDF2 completion', async () => {
    const crypto = installDeferredCrypto()
    const tabA = await importFreshRealm(realms)

    const tabASave = tabA.persistEncryptedKey('openrouter', 'tab-a-key', 'passphrase-a')
    await vi.waitFor(() => expect(crypto.derivations).toHaveLength(1))

    const tabB = await importFreshRealm(realms)
    expect(tabB.clearKey('openrouter')).toEqual({ ok: true, value: undefined })

    crypto.derivations[0]!.resolve({ type: 'secret' } as CryptoKey)
    await expect(tabASave).resolves.toMatchObject({
      ok: false,
      code: 'operation-cancelled'
    })

    expect(crypto.encrypt).not.toHaveBeenCalled()
    expect(tabA.getKey('openrouter')).toBe('')
    expect(tabA.hasEncryptedKey('openrouter')).toBe(false)
    expect(tabB.hasEncryptedKey('openrouter')).toBe(false)
    expect(
      [...storage.keys()].filter((key) =>
        key.startsWith('orbitpm.lite.key.encrypted.slot.openrouter.')
      )
    ).toEqual([])
  })

  it('orders a later Clear ahead when Tab A pauses immediately before its first claim', async () => {
    const crypto = installDeferredCrypto()
    let clock = 0
    vi.stubGlobal('performance', {
      timeOrigin: 1_000,
      now: () => {
        clock += 1
        return clock
      }
    })
    const tabA = await importFreshRealm(realms)
    const tabB = await importFreshRealm(realms)
    let injected = false
    vi.stubGlobal('localStorage', {
      get length() {
        return storage.size
      },
      key: (index: number) => [...storage.keys()][index] ?? null,
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        const record = key.startsWith('orbitpm.lite.key.operation.openrouter.')
          ? (JSON.parse(value) as { kind?: string })
          : null
        if (!injected && record?.kind === 'pending-save') {
          injected = true
          expect(tabB.clearKey('openrouter')).toEqual({ ok: true, value: undefined })
        }
        storage.set(key, String(value))
      },
      removeItem: (key: string) => void storage.delete(key),
      clear: () => storage.clear()
    })

    await expect(
      tabA.persistEncryptedKey('openrouter', 'tab-a-key', 'passphrase-a')
    ).resolves.toMatchObject({
      ok: false,
      code: 'operation-cancelled'
    })

    expect(injected).toBe(true)
    expect(crypto.derivations).toEqual([])
    expect(tabA.hasEncryptedKey('openrouter')).toBe(false)
    expect(tabB.hasEncryptedKey('openrouter')).toBe(false)
  })

  it('uses the token as a deterministic tie-break at the exact same start timestamp', async () => {
    const crypto = installDeferredCrypto()
    vi.stubGlobal('performance', { timeOrigin: 1_000, now: () => 0 })
    const tabA = await importFreshRealm(realms)
    const tabB = await importFreshRealm(realms)
    let injected = false
    vi.stubGlobal('localStorage', {
      get length() {
        return storage.size
      },
      key: (index: number) => [...storage.keys()][index] ?? null,
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        const record = key.startsWith('orbitpm.lite.key.operation.openrouter.')
          ? (JSON.parse(value) as { kind?: string })
          : null
        if (!injected && record?.kind === 'pending-save') {
          injected = true
          expect(tabB.clearKey('openrouter')).toEqual({ ok: true, value: undefined })
        }
        storage.set(key, String(value))
      },
      removeItem: (key: string) => void storage.delete(key),
      clear: () => storage.clear()
    })

    await expect(
      tabA.persistEncryptedKey('openrouter', 'tab-a-key', 'passphrase-a')
    ).resolves.toMatchObject({
      ok: false,
      code: 'operation-cancelled'
    })
    expect(injected).toBe(true)
    expect(crypto.derivations).toEqual([])
    const records = [...storage.values()]
      .map((value) => JSON.parse(value) as { kind?: string; operation?: { token?: string } })
      .filter((record) => record.operation)
    expect(records.find((record) => record.kind === 'clear')?.operation?.token).toMatch(/^02/)
  })

  it('keeps a later failed Save as a barrier so Tab A cannot revive', async () => {
    const crypto = installDeferredCrypto()
    let clock = 0
    vi.stubGlobal('performance', {
      timeOrigin: 1_000,
      now: () => {
        clock += 1
        return clock
      }
    })
    const tabA = await importFreshRealm(realms)
    const tabASave = tabA.persistEncryptedKey('openrouter', 'tab-a-key', 'passphrase-a')
    await vi.waitFor(() => expect(crypto.derivations).toHaveLength(1))

    storage.set('orbitpm.lite.key.openrouter', 'cleanup-refused')
    vi.stubGlobal('localStorage', {
      get length() {
        return storage.size
      },
      key: (index: number) => [...storage.keys()][index] ?? null,
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => void storage.set(key, String(value)),
      removeItem: (key: string) => {
        if (key === 'orbitpm.lite.key.openrouter') throw new Error('cleanup blocked')
        storage.delete(key)
      },
      clear: () => storage.clear()
    })
    const tabB = await importFreshRealm(realms)

    await expect(
      tabB.persistEncryptedKey('openrouter', 'tab-b-key', 'passphrase-b')
    ).resolves.toMatchObject({
      ok: false,
      code: 'storage-failed'
    })
    crypto.derivations[0]!.resolve({ type: 'secret' } as CryptoKey)
    await expect(tabASave).resolves.toMatchObject({
      ok: false,
      code: 'operation-cancelled'
    })

    expect(crypto.encrypt).not.toHaveBeenCalled()
    expect(tabA.hasEncryptedKey('openrouter')).toBe(false)
    expect(tabB.hasEncryptedKey('openrouter')).toBe(false)
  })

  it('never writes a third slot when two tabs race above an existing commit', async () => {
    const initialRealm = await importFreshRealm(realms)
    await expect(
      initialRealm.persistEncryptedKey('openrouter', 'committed-key', 'committed-passphrase')
    ).resolves.toEqual({ ok: true, value: undefined })
    const committedSlot = [...storage.keys()].find((key) =>
      key.startsWith('orbitpm.lite.key.encrypted.slot.openrouter.')
    )
    if (!committedSlot) throw new Error('initial encrypted slot was not stored')

    const crypto = installDeferredCrypto()
    const tabA = await importFreshRealm(realms)
    const tabB = await importFreshRealm(realms)
    let tabBSave: Promise<unknown> | null = null
    vi.stubGlobal('localStorage', {
      get length() {
        return storage.size
      },
      key: (index: number) => [...storage.keys()][index] ?? null,
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        if (
          !tabBSave &&
          key.startsWith('orbitpm.lite.key.encrypted.slot.openrouter.') &&
          key !== committedSlot
        ) {
          tabBSave = tabB.persistEncryptedKey('openrouter', 'tab-b-key', 'passphrase-b')
        }
        storage.set(key, String(value))
      },
      removeItem: (key: string) => {
        if (
          key.startsWith('orbitpm.lite.key.encrypted.slot.openrouter.') &&
          key !== committedSlot
        ) {
          throw new Error('superseded slot cleanup blocked')
        }
        storage.delete(key)
      },
      clear: () => storage.clear()
    })

    const tabASave = tabA.persistEncryptedKey('openrouter', 'tab-a-key', 'passphrase-a')
    await vi.waitFor(() => expect(crypto.derivations).toHaveLength(1))
    crypto.derivations[0]!.resolve({ type: 'secret' } as CryptoKey)

    await expect(tabASave).resolves.toMatchObject({
      ok: false,
      code: 'operation-cancelled'
    })
    if (!tabBSave) throw new Error('Tab B did not start in Tab A slot-commit window')
    await expect(tabBSave).resolves.toMatchObject({
      ok: false,
      code: 'storage-failed'
    })

    for (let attempt = 0; attempt < 20; attempt += 1) {
      await expect(
        tabB.persistEncryptedKey('openrouter', `later-key-${attempt}`, 'passphrase')
      ).resolves.toMatchObject({ ok: false, code: 'storage-failed' })
      expect(
        [...storage.keys()].filter((key) =>
          key.startsWith('orbitpm.lite.key.encrypted.slot.openrouter.')
        )
      ).toHaveLength(2)
    }
    expect(tabA.hasEncryptedKey('openrouter')).toBe(false)
    expect(tabB.hasEncryptedKey('openrouter')).toBe(false)
  })

  it('commits only Tab B when two tabs save and Tab A crypto completes first', async () => {
    const crypto = installDeferredCrypto()
    const tabA = await importFreshRealm(realms)
    const tabASave = tabA.persistEncryptedKey('openrouter', 'tab-a-key', 'passphrase-a')
    await vi.waitFor(() => expect(crypto.derivations).toHaveLength(1))

    const tabB = await importFreshRealm(realms)
    const tabBSave = tabB.persistEncryptedKey('openrouter', 'tab-b-key', 'passphrase-b')
    await vi.waitFor(() => expect(crypto.derivations).toHaveLength(2))

    crypto.derivations[0]!.resolve({ type: 'secret' } as CryptoKey)
    await expect(tabASave).resolves.toMatchObject({
      ok: false,
      code: 'operation-cancelled'
    })
    crypto.derivations[1]!.resolve({ type: 'secret' } as CryptoKey)
    await expect(tabBSave).resolves.toEqual({ ok: true, value: undefined })

    expect(crypto.encrypt).toHaveBeenCalledTimes(1)
    expect(tabA.getKey('openrouter')).toBe('')
    expect(tabB.getKey('openrouter')).toBe('tab-b-key')
    expect(tabA.hasEncryptedKey('openrouter')).toBe(true)
    const encryptedSlots = [...storage.entries()].filter(([key]) =>
      key.startsWith('orbitpm.lite.key.encrypted.slot.openrouter.')
    )
    expect(encryptedSlots).toHaveLength(1)
    expect(encryptedSlots[0]?.[1]).not.toContain('tab-b-key')
    expect(encryptedSlots[0]?.[1]).not.toContain('passphrase-b')
  })

  it('preserves Tab A as Tab B fallback when Tab B starts during Tab A final commit', async () => {
    const crypto = installDeferredCrypto()
    const tabA = await importFreshRealm(realms)
    const tabB = await importFreshRealm(realms)
    let tabBSave: Promise<unknown> | null = null
    vi.stubGlobal('localStorage', {
      get length() {
        return storage.size
      },
      key: (index: number) => [...storage.keys()][index] ?? null,
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, String(value))
        if (!tabBSave && key.startsWith('orbitpm.lite.key.encrypted.slot.openrouter.')) {
          tabBSave = tabB.persistEncryptedKey('openrouter', 'tab-b-key', 'passphrase-b')
        }
      },
      removeItem: (key: string) => void storage.delete(key),
      clear: () => storage.clear()
    })

    const tabASave = tabA.persistEncryptedKey('openrouter', 'tab-a-key', 'passphrase-a')
    await vi.waitFor(() => expect(crypto.derivations).toHaveLength(1))
    crypto.derivations[0]!.resolve({ type: 'secret' } as CryptoKey)

    await expect(tabASave).resolves.toMatchObject({
      ok: false,
      code: 'operation-cancelled'
    })
    await vi.waitFor(() => expect(crypto.derivations).toHaveLength(2))
    if (!tabBSave) throw new Error('Tab B save did not start during Tab A commit')
    expect(tabB.hasEncryptedKey('openrouter')).toBe(true)
    expect(
      [...storage.keys()].filter((key) =>
        key.startsWith('orbitpm.lite.key.encrypted.slot.openrouter.')
      )
    ).toHaveLength(1)

    crypto.derivations[1]!.resolve({ type: 'secret' } as CryptoKey)
    await expect(tabBSave).resolves.toEqual({ ok: true, value: undefined })
    expect(tabB.getKey('openrouter')).toBe('tab-b-key')
    expect(
      [...storage.keys()].filter((key) =>
        key.startsWith('orbitpm.lite.key.encrypted.slot.openrouter.')
      )
    ).toHaveLength(1)
  })

  it('honors Tab B Clear injected between Tab A slot write and final token comparison', async () => {
    const crypto = installDeferredCrypto()
    const tabA = await importFreshRealm(realms)
    const tabB = await importFreshRealm(realms)
    let cleared = false
    vi.stubGlobal('localStorage', {
      get length() {
        return storage.size
      },
      key: (index: number) => [...storage.keys()][index] ?? null,
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, String(value))
        if (!cleared && key.startsWith('orbitpm.lite.key.encrypted.slot.openrouter.')) {
          cleared = true
          expect(tabB.clearKey('openrouter')).toEqual({ ok: true, value: undefined })
        }
      },
      removeItem: (key: string) => void storage.delete(key),
      clear: () => storage.clear()
    })

    const tabASave = tabA.persistEncryptedKey('openrouter', 'tab-a-key', 'passphrase-a')
    await vi.waitFor(() => expect(crypto.derivations).toHaveLength(1))
    crypto.derivations[0]!.resolve({ type: 'secret' } as CryptoKey)

    await expect(tabASave).resolves.toMatchObject({
      ok: false,
      code: 'operation-cancelled'
    })
    expect(cleared).toBe(true)
    expect(tabA.getKey('openrouter')).toBe('')
    expect(tabA.hasEncryptedKey('openrouter')).toBe(false)
    expect(tabB.hasEncryptedKey('openrouter')).toBe(false)
    expect(
      [...storage.keys()].filter((key) =>
        key.startsWith('orbitpm.lite.key.encrypted.slot.openrouter.')
      )
    ).toEqual([])
  })

  it('rechecks after the session commit when Clear starts during the authoritative read', async () => {
    const crypto = installDeferredCrypto()
    const tabA = await importFreshRealm(realms)
    const tabB = await importFreshRealm(realms)
    let cleared = false
    vi.stubGlobal('localStorage', {
      get length() {
        return storage.size
      },
      key: (index: number) => [...storage.keys()][index] ?? null,
      getItem: (key: string) => {
        const value = storage.get(key) ?? null
        const slotExists = [...storage.keys()].some((candidate) =>
          candidate.startsWith('orbitpm.lite.key.encrypted.slot.openrouter.')
        )
        if (key.startsWith('orbitpm.lite.key.operation.openrouter.') && slotExists && !cleared) {
          cleared = true
          expect(tabB.clearKey('openrouter')).toEqual({ ok: true, value: undefined })
        }
        return value
      },
      setItem: (key: string, value: string) => void storage.set(key, String(value)),
      removeItem: (key: string) => void storage.delete(key),
      clear: () => storage.clear()
    })

    const tabASave = tabA.persistEncryptedKey('openrouter', 'tab-a-key', 'passphrase-a')
    await vi.waitFor(() => expect(crypto.derivations).toHaveLength(1))
    crypto.derivations[0]!.resolve({ type: 'secret' } as CryptoKey)

    await expect(tabASave).resolves.toMatchObject({
      ok: false,
      code: 'operation-cancelled'
    })
    expect(cleared).toBe(true)
    expect(tabA.getKey('openrouter')).toBe('')
    expect(tabA.hasEncryptedKey('openrouter')).toBe(false)
    expect(tabB.hasEncryptedKey('openrouter')).toBe(false)
  })
})
