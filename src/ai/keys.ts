import type { LiteProviderId } from './providersLite'

/**
 * Credentials are deliberately kept outside browser storage unless the user
 * explicitly encrypts them. Reloading the page therefore clears the default
 * credential store.
 */
const sessionKeys = new Map<LiteProviderId, string>()

const LEGACY_KEY_PREFIX = 'orbitpm.lite.key.'
const ENCRYPTED_KEY_PREFIX = 'orbitpm.lite.key.encrypted.'
const CFG_PREFIX = 'orbitpm.lite.cfg.'
const ENVELOPE_VERSION = 1
const PBKDF2_ITERATIONS = 310_000

export const KEY_STORAGE_WARNING =
  'API keys are kept only in memory for this browser session by default. ' +
  'Optional persistence encrypts a key with your passphrase; the passphrase is never stored.'

export type KeyStorageErrorCode =
  | 'invalid-input'
  | 'storage-unavailable'
  | 'storage-failed'
  | 'crypto-unavailable'
  | 'invalid-ciphertext'
  | 'unlock-failed'

export type KeyStorageResult<T = undefined> =
  | { ok: true; value: T }
  | { ok: false; code: KeyStorageErrorCode; error: string }

interface EncryptedKeyEnvelope {
  version: typeof ENVELOPE_VERSION
  providerId: LiteProviderId
  algorithm: 'AES-GCM'
  kdf: 'PBKDF2-SHA-256'
  iterations: typeof PBKDF2_ITERATIONS
  salt: string
  iv: string
  ciphertext: string
}

function success<T>(value: T): KeyStorageResult<T> {
  return { ok: true, value }
}

function failure<T>(
  code: KeyStorageErrorCode,
  error: string
): KeyStorageResult<T> {
  return { ok: false, code, error }
}

function browserStorage(): KeyStorageResult<Storage> {
  try {
    if (typeof localStorage === 'undefined') {
      return failure('storage-unavailable', 'Browser storage is unavailable.')
    }
    return success(localStorage)
  } catch (error) {
    return failure(
      'storage-unavailable',
      error instanceof Error ? error.message : 'Browser storage is unavailable.'
    )
  }
}

function browserCrypto(): KeyStorageResult<Crypto> {
  const value = globalThis.crypto
  if (!value?.subtle || typeof value.getRandomValues !== 'function') {
    return failure(
      'crypto-unavailable',
      'WebCrypto is unavailable, so encrypted key persistence cannot be used.'
    )
  }
  return success(value)
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return btoa(binary)
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}

async function deriveEncryptionKey(
  cryptoApi: Crypto,
  passphrase: string,
  salt: ArrayBuffer
): Promise<CryptoKey> {
  const material = await cryptoApi.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey']
  )
  return cryptoApi.subtle.deriveKey(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt,
      iterations: PBKDF2_ITERATIONS
    },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

function additionalData(providerId: LiteProviderId): ArrayBuffer {
  return toArrayBuffer(
    new TextEncoder().encode(`OrbitPM Process Studio Lite credential:${providerId}`)
  )
}

// --- session credentials ---------------------------------------------------

export function getKey(providerId: LiteProviderId): string {
  return sessionKeys.get(providerId) ?? ''
}

export function hasKey(providerId: LiteProviderId): boolean {
  return getKey(providerId).length > 0
}

/**
 * Save a key for this page session only. This function never writes to
 * localStorage; use persistEncryptedKey for explicit encrypted persistence.
 */
export function setKey(
  providerId: LiteProviderId,
  value: string
): KeyStorageResult<undefined> {
  const trimmed = value.trim()
  if (trimmed) sessionKeys.set(providerId, trimmed)
  else sessionKeys.delete(providerId)
  return success(undefined)
}

/**
 * Remove every credential artifact associated with a provider. Memory is
 * cleared even if browser storage refuses the cleanup, and the failure is
 * returned so the UI cannot claim that persisted data was removed.
 */
export function clearKey(
  providerId: LiteProviderId
): KeyStorageResult<undefined> {
  sessionKeys.delete(providerId)
  const storageResult = browserStorage()
  if (!storageResult.ok) return storageResult

  try {
    storageResult.value.removeItem(LEGACY_KEY_PREFIX + providerId)
    storageResult.value.removeItem(ENCRYPTED_KEY_PREFIX + providerId)
    storageResult.value.removeItem(CFG_PREFIX + providerId)
    // 0.4.4 could retain arbitrary Custom-endpoint headers. Remove them while
    // cleaning any provider so an upgrade cannot strand those credentials.
    storageResult.value.removeItem(CFG_PREFIX + 'custom')
    return success(undefined)
  } catch (error) {
    return failure(
      'storage-failed',
      error instanceof Error ? error.message : 'Browser storage refused the cleanup.'
    )
  }
}

/** Last four characters for a non-revealing configured hint. */
export function keyLast4(providerId: LiteProviderId): string {
  const key = getKey(providerId)
  return key ? key.slice(-4) : ''
}

/**
 * Move any 0.4.4 plaintext keys into memory and remove the plaintext copies.
 * This is intentionally explicit so applications can surface a cleanup error.
 */
export function migrateLegacyPlaintextKeys(
  providerIds: readonly LiteProviderId[]
): KeyStorageResult<number> {
  const storageResult = browserStorage()
  if (!storageResult.ok) return storageResult

  const migrated: Array<[LiteProviderId, string]> = []
  try {
    for (const providerId of providerIds) {
      const key = storageResult.value.getItem(LEGACY_KEY_PREFIX + providerId)?.trim()
      if (key) migrated.push([providerId, key])
    }
    for (const [providerId] of migrated) {
      storageResult.value.removeItem(LEGACY_KEY_PREFIX + providerId)
    }
  } catch (error) {
    return failure(
      'storage-failed',
      error instanceof Error ? error.message : 'Could not remove a legacy plaintext key.'
    )
  }

  for (const [providerId, key] of migrated) sessionKeys.set(providerId, key)
  return success(migrated.length)
}

// --- opt-in encrypted persistence -----------------------------------------

export function hasEncryptedKey(providerId: LiteProviderId): boolean {
  const storageResult = browserStorage()
  if (!storageResult.ok) return false
  try {
    return storageResult.value.getItem(ENCRYPTED_KEY_PREFIX + providerId) !== null
  } catch {
    return false
  }
}

export async function persistEncryptedKey(
  providerId: LiteProviderId,
  value: string,
  passphrase: string
): Promise<KeyStorageResult<undefined>> {
  const trimmed = value.trim()
  if (!trimmed) return failure('invalid-input', 'Enter an API key to encrypt.')
  if (!passphrase) return failure('invalid-input', 'Enter an encryption passphrase.')

  const storageResult = browserStorage()
  if (!storageResult.ok) return storageResult
  const cryptoResult = browserCrypto()
  if (!cryptoResult.ok) return cryptoResult

  try {
    const salt = cryptoResult.value.getRandomValues(new Uint8Array(16))
    const iv = cryptoResult.value.getRandomValues(new Uint8Array(12))
    const key = await deriveEncryptionKey(
      cryptoResult.value,
      passphrase,
      toArrayBuffer(salt)
    )
    const ciphertext = await cryptoResult.value.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv: toArrayBuffer(iv),
        additionalData: additionalData(providerId)
      },
      key,
      toArrayBuffer(new TextEncoder().encode(trimmed))
    )
    const envelope: EncryptedKeyEnvelope = {
      version: ENVELOPE_VERSION,
      providerId,
      algorithm: 'AES-GCM',
      kdf: 'PBKDF2-SHA-256',
      iterations: PBKDF2_ITERATIONS,
      salt: bytesToBase64(salt),
      iv: bytesToBase64(iv),
      ciphertext: bytesToBase64(new Uint8Array(ciphertext))
    }
    storageResult.value.setItem(
      ENCRYPTED_KEY_PREFIX + providerId,
      JSON.stringify(envelope)
    )
    // A successful encrypted save also unlocks the key for this session.
    sessionKeys.set(providerId, trimmed)
    // Best-effort cleanup of a possible legacy plaintext copy is part of the
    // same successful storage transaction.
    storageResult.value.removeItem(LEGACY_KEY_PREFIX + providerId)
    return success(undefined)
  } catch (error) {
    return failure(
      'storage-failed',
      error instanceof Error ? error.message : 'The encrypted key could not be stored.'
    )
  }
}

export async function unlockEncryptedKey(
  providerId: LiteProviderId,
  passphrase: string
): Promise<KeyStorageResult<undefined>> {
  if (!passphrase) return failure('invalid-input', 'Enter the encryption passphrase.')

  const storageResult = browserStorage()
  if (!storageResult.ok) return storageResult
  const cryptoResult = browserCrypto()
  if (!cryptoResult.ok) return cryptoResult

  let envelope: EncryptedKeyEnvelope
  try {
    const raw = storageResult.value.getItem(ENCRYPTED_KEY_PREFIX + providerId)
    if (!raw) return failure('invalid-ciphertext', 'No encrypted key is stored for this provider.')
    const candidate = JSON.parse(raw) as Partial<EncryptedKeyEnvelope>
    if (
      candidate.version !== ENVELOPE_VERSION ||
      candidate.providerId !== providerId ||
      candidate.algorithm !== 'AES-GCM' ||
      candidate.kdf !== 'PBKDF2-SHA-256' ||
      candidate.iterations !== PBKDF2_ITERATIONS ||
      typeof candidate.salt !== 'string' ||
      typeof candidate.iv !== 'string' ||
      typeof candidate.ciphertext !== 'string'
    ) {
      return failure('invalid-ciphertext', 'The encrypted key record is invalid.')
    }
    envelope = candidate as EncryptedKeyEnvelope
  } catch {
    return failure('invalid-ciphertext', 'The encrypted key record is invalid.')
  }

  try {
    const salt = base64ToBytes(envelope.salt)
    const iv = base64ToBytes(envelope.iv)
    if (salt.byteLength !== 16 || iv.byteLength !== 12) {
      return failure('invalid-ciphertext', 'The encrypted key record is invalid.')
    }
    const key = await deriveEncryptionKey(
      cryptoResult.value,
      passphrase,
      toArrayBuffer(salt)
    )
    const plaintext = await cryptoResult.value.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: toArrayBuffer(iv),
        additionalData: additionalData(providerId)
      },
      key,
      toArrayBuffer(base64ToBytes(envelope.ciphertext))
    )
    const value = new TextDecoder().decode(plaintext).trim()
    if (!value) return failure('invalid-ciphertext', 'The encrypted key record is empty.')
    sessionKeys.set(providerId, value)
    return success(undefined)
  } catch {
    return failure(
      'unlock-failed',
      'The passphrase is incorrect or the encrypted key has been changed.'
    )
  }
}

// --- non-secret preferences ------------------------------------------------

export function getPref(name: string): string {
  const storageResult = browserStorage()
  if (!storageResult.ok) return ''
  try {
    return storageResult.value.getItem(CFG_PREFIX + name) ?? ''
  } catch {
    return ''
  }
}

export function setPref(
  name: string,
  value: string
): KeyStorageResult<undefined> {
  const storageResult = browserStorage()
  if (!storageResult.ok) return storageResult
  try {
    if (value) storageResult.value.setItem(CFG_PREFIX + name, value)
    else storageResult.value.removeItem(CFG_PREFIX + name)
    return success(undefined)
  } catch (error) {
    return failure(
      'storage-failed',
      error instanceof Error ? error.message : 'The preference could not be stored.'
    )
  }
}

/** Test seam; production code should clear individual providers instead. */
export function resetSessionKeysForTests(): void {
  sessionKeys.clear()
}
