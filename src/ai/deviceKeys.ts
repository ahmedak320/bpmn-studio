/**
 * "Remember this key on this browser", with no passphrase.
 *
 * One non-extractable AES-GCM key is created per browser profile and kept in
 * IndexedDB. A saved API key is encrypted with it and stored in localStorage as
 * ciphertext, so the key loads again on the next visit without being typed.
 *
 * What this protects: the saved key is not readable as plain text in the
 * browser's storage files or a copied localStorage dump, and the device key
 * cannot be exported from IndexedDB.
 *
 * What it does not protect: code that runs on this page, or anyone who uses this
 * browser profile, can use the key. The passphrase option in `keys.ts` is the
 * stronger choice when the key must survive a shared or untrusted profile.
 */
import { LITE_PROVIDERS, type LiteProviderId } from './providersLite'
import { getKey, setKey } from './keys'

export type DeviceKeyResult = { ok: true } | { ok: false; error: string }

const DB_NAME = 'orbitpm-lite-device-keys'
const DB_VERSION = 1
const STORE = 'keys'
const DEVICE_KEY_ID = 'aes-gcm-v1'
const RECORD_PREFIX = 'orbitpm.lite.device.'
const RECORD_VERSION = 1
const IV_BYTES = 12

interface DeviceKeyRecord {
  readonly v: typeof RECORD_VERSION
  readonly iv: string
  readonly ct: string
}

function fail(error: unknown): DeviceKeyResult {
  return { ok: false, error: error instanceof Error ? error.message : String(error) }
}

function recordKey(providerId: LiteProviderId): string {
  return RECORD_PREFIX + providerId
}

function additionalData(providerId: LiteProviderId): ArrayBuffer {
  return new TextEncoder().encode(`orbitpm-lite-device:${providerId}`).buffer as ArrayBuffer
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function base64ToBytes(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text)
  const bytes = new Uint8Array(new ArrayBuffer(binary.length))
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('The key store could not be opened.'))
  })
}

function readDeviceKey(db: IDBDatabase): Promise<CryptoKey | undefined> {
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(DEVICE_KEY_ID)
    request.onsuccess = () => resolve(request.result as CryptoKey | undefined)
    request.onerror = () => reject(request.error)
  })
}

/** Adds the key only when none exists, so two tabs cannot replace each other's key. */
function addDeviceKeyIfAbsent(db: IDBDatabase, key: CryptoKey): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readwrite')
    const request = transaction.objectStore(STORE).add(key, DEVICE_KEY_ID)
    request.onerror = (event) => {
      // ConstraintError: a key already exists. Keep it and do not fail the write.
      event.preventDefault()
    }
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error)
  })
}

async function loadOrCreateDeviceKey(): Promise<CryptoKey> {
  const db = await openDatabase()
  try {
    const existing = await readDeviceKey(db)
    if (existing) return existing
    const fresh = await globalThis.crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    )
    await addDeviceKeyIfAbsent(db, fresh)
    const stored = await readDeviceKey(db)
    if (!stored) throw new Error('The device key could not be stored.')
    return stored
  } finally {
    db.close()
  }
}

function webCryptoAvailable(): boolean {
  return typeof globalThis.crypto?.subtle !== 'undefined' && typeof indexedDB !== 'undefined'
}

/**
 * Encrypts `value` with the device key and stores it for `providerId`. The caller
 * loads the same value into the session with `setKey`.
 */
export async function rememberKeyOnDevice(
  providerId: LiteProviderId,
  value: string
): Promise<DeviceKeyResult> {
  const trimmed = value.trim()
  if (!trimmed) return { ok: false, error: 'Enter an API key to remember.' }
  if (!webCryptoAvailable()) {
    return { ok: false, error: 'This browser cannot store keys on the device.' }
  }
  try {
    const key = await loadOrCreateDeviceKey()
    const iv = globalThis.crypto.getRandomValues(new Uint8Array(IV_BYTES))
    const ciphertext = await globalThis.crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: additionalData(providerId) },
      key,
      new TextEncoder().encode(trimmed)
    )
    const record: DeviceKeyRecord = {
      v: RECORD_VERSION,
      iv: bytesToBase64(iv),
      ct: bytesToBase64(new Uint8Array(ciphertext))
    }
    localStorage.setItem(recordKey(providerId), JSON.stringify(record))
    return { ok: true }
  } catch (error) {
    return fail(error)
  }
}

/** True when a remembered key exists for the provider in this browser. */
export function hasDeviceKey(providerId: LiteProviderId): boolean {
  try {
    return localStorage.getItem(recordKey(providerId)) !== null
  } catch {
    return false
  }
}

/** Removes the remembered key for the provider. */
export function forgetDeviceKey(providerId: LiteProviderId): DeviceKeyResult {
  try {
    localStorage.removeItem(recordKey(providerId))
    return { ok: true }
  } catch (error) {
    return fail(error)
  }
}

async function decryptRecord(providerId: LiteProviderId, record: DeviceKeyRecord): Promise<string> {
  const key = await loadOrCreateDeviceKey()
  const plain = await globalThis.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(record.iv), additionalData: additionalData(providerId) },
    key,
    base64ToBytes(record.ct)
  )
  return new TextDecoder().decode(plain)
}

/**
 * Loads every remembered key into this session. A key that is already loaded is
 * left alone. A record that cannot be decrypted is skipped and kept, so the
 * settings screen can still show that it exists. Returns how many keys loaded.
 */
export async function restoreDeviceKeys(): Promise<number> {
  if (!webCryptoAvailable()) return 0
  let restored = 0
  for (const provider of LITE_PROVIDERS) {
    let record: DeviceKeyRecord | null = null
    try {
      const raw = localStorage.getItem(recordKey(provider.id))
      record = raw === null ? null : (JSON.parse(raw) as DeviceKeyRecord)
    } catch {
      record = null
    }
    if (!record || record.v !== RECORD_VERSION) continue
    if (getKey(provider.id)) continue
    try {
      const value = await decryptRecord(provider.id, record)
      if (setKey(provider.id, value).ok) restored += 1
    } catch {
      // Left in place: the settings screen reports it as remembered but unusable.
    }
  }
  return restored
}
