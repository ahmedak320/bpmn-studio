import { LITE_PROVIDERS, type LiteProviderId } from './providersLite'

/**
 * Credentials are deliberately kept outside browser storage unless the user
 * explicitly encrypts them. Reloading the page therefore clears the default
 * credential store.
 */
interface SessionCredential {
  value: string
  /** Present only when the session copy came from encrypted persistence. */
  encryptedStorageKey?: string
}

const sessionKeys = new Map<LiteProviderId, SessionCredential>()
const credentialMutationVersions = new Map<LiteProviderId, number>()

const LEGACY_KEY_PREFIX = 'orbitpm.lite.key.'
const ENCRYPTED_KEY_PREFIX = 'orbitpm.lite.key.encrypted.'
const ENCRYPTED_SLOT_PREFIX = 'orbitpm.lite.key.encrypted.slot.'
const CREDENTIAL_OPERATION_PREFIX = 'orbitpm.lite.key.operation.'
const CREDENTIAL_OPERATION_SEAL_PREFIX = 'orbitpm.lite.key.operation.seal.'
const CFG_PREFIX = 'orbitpm.lite.cfg.'
const ENVELOPE_VERSION = 1
const CREDENTIAL_RECORD_VERSION = 1
const PBKDF2_ITERATIONS = 310_000
const MAX_ENCRYPTED_SLOTS_PER_PROVIDER = 2
const MAX_OPERATION_RECORDS_PER_PROVIDER = 8

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
  | 'operation-cancelled'

export type KeyStorageResult<T = undefined> =
  { ok: true; value: T } | { ok: false; code: KeyStorageErrorCode; error: string }

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

interface CredentialOperation {
  startedAtMicros: string
  token: string
}

type EncryptedKeyFallback =
  | {
      kind: 'legacy'
    }
  | {
      kind: 'slot'
      token: string
    }

interface PendingCredentialOperationRecord {
  recordVersion: typeof CREDENTIAL_RECORD_VERSION
  kind: 'pending-save'
  operation: CredentialOperation
  fallback?: EncryptedKeyFallback
}

interface FailedCredentialOperationRecord {
  recordVersion: typeof CREDENTIAL_RECORD_VERSION
  kind: 'failed-save'
  operation: CredentialOperation
  fallback?: EncryptedKeyFallback
}

interface ClearCredentialOperationRecord {
  recordVersion: typeof CREDENTIAL_RECORD_VERSION
  kind: 'clear'
  operation: CredentialOperation
}

interface EncryptedSlotRecord extends EncryptedKeyEnvelope {
  recordVersion: typeof CREDENTIAL_RECORD_VERSION
  kind: 'encrypted'
  operation: CredentialOperation
}

interface EncryptedStorageRecord {
  key: string
  raw: string
}

type StoredCredentialOperation =
  | {
      kind: 'pending-save'
      operation: CredentialOperation
      storageKey: string
      fallback?: EncryptedKeyFallback
    }
  | {
      kind: 'failed-save'
      operation: CredentialOperation
      storageKey: string
      fallback?: EncryptedKeyFallback
    }
  | {
      kind: 'clear'
      operation: CredentialOperation
      storageKey: string
    }
  | {
      kind: 'encrypted'
      operation: CredentialOperation
      storageKey: string
      raw: string
    }

function success<T>(value: T): KeyStorageResult<T> {
  return { ok: true, value }
}

function failure<T>(code: KeyStorageErrorCode, error: string): KeyStorageResult<T> {
  return { ok: false, code, error }
}

/**
 * Credential mutations are last-started-wins per provider. WebCrypto work
 * cannot be interrupted once PBKDF2/AES has entered the browser, so every
 * async boundary checks both this generation and the caller's AbortSignal
 * before any ciphertext or session value can be committed.
 */
function beginCredentialMutation(providerId: LiteProviderId): number {
  const version = (credentialMutationVersions.get(providerId) ?? 0) + 1
  credentialMutationVersions.set(providerId, version)
  return version
}

function credentialMutationIsCurrent(
  providerId: LiteProviderId,
  version: number,
  signal?: AbortSignal
): boolean {
  return !signal?.aborted && credentialMutationVersions.get(providerId) === version
}

function cancelledCredentialMutation<T>(): KeyStorageResult<T> {
  return failure(
    'operation-cancelled',
    'A newer credential operation replaced this operation before it completed.'
  )
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

let fallbackOperationCounter = 0

function createOperationToken(): string {
  try {
    const bytes = globalThis.crypto?.getRandomValues(new Uint8Array(16))
    if (bytes) {
      return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
    }
  } catch {
    // Clear must still be able to invalidate work if WebCrypto is unavailable.
  }
  fallbackOperationCounter += 1
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${fallbackOperationCounter.toString(36)}`
    .padEnd(32, '0')
    .slice(0, 128)
}

function createCredentialOperation(): CredentialOperation {
  const performanceApi = globalThis.performance
  const highResolutionNow = performanceApi?.now()
  const highResolutionEpochMillis =
    performanceApi &&
    Number.isFinite(performanceApi.timeOrigin) &&
    Number.isFinite(highResolutionNow)
      ? performanceApi.timeOrigin + highResolutionNow
      : Number.NaN
  const startedAtMicros = Number.isFinite(highResolutionEpochMillis)
    ? Math.floor(highResolutionEpochMillis * 1_000).toString()
    : (BigInt(Date.now()) * 1_000n).toString()
  return { startedAtMicros, token: createOperationToken() }
}

function operationStoragePrefix(providerId: LiteProviderId): string {
  return `${CREDENTIAL_OPERATION_PREFIX}${providerId}.`
}

function operationStorageKey(providerId: LiteProviderId, operation: CredentialOperation): string {
  return operationStoragePrefix(providerId) + operation.token
}

function operationSealStorageKey(providerId: LiteProviderId): string {
  return CREDENTIAL_OPERATION_SEAL_PREFIX + providerId
}

function encryptedSlotStorageKey(providerId: LiteProviderId, token: string): string {
  return `${ENCRYPTED_SLOT_PREFIX}${providerId}.${token}`
}

function isValidOperationToken(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{16,128}$/.test(value)
}

function isValidCredentialOperation(value: unknown): value is CredentialOperation {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<CredentialOperation>
  return (
    typeof candidate.startedAtMicros === 'string' &&
    /^\d{1,20}$/.test(candidate.startedAtMicros) &&
    isValidOperationToken(candidate.token)
  )
}

function isValidEncryptedKeyFallback(value: unknown): value is EncryptedKeyFallback {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<EncryptedKeyFallback>
  return (
    candidate.kind === 'legacy' ||
    (candidate.kind === 'slot' && isValidOperationToken(candidate.token))
  )
}

function compareCredentialOperations(
  left: CredentialOperation,
  right: CredentialOperation
): number {
  const leftStartedAt = BigInt(left.startedAtMicros)
  const rightStartedAt = BigInt(right.startedAtMicros)
  if (leftStartedAt !== rightStartedAt) return leftStartedAt < rightStartedAt ? -1 : 1
  if (left.token === right.token) return 0
  return left.token < right.token ? -1 : 1
}

function storageKeysWithPrefix(storage: Storage, prefix: string): string[] {
  const keys: string[] = []
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index)
    if (key?.startsWith(prefix)) keys.push(key)
  }
  return keys
}

function operationRecordKeys(storage: Storage, providerId: LiteProviderId): string[] {
  return storageKeysWithPrefix(storage, operationStoragePrefix(providerId))
}

function encryptedSlotKeys(storage: Storage, providerId: LiteProviderId): string[] {
  return storageKeysWithPrefix(storage, `${ENCRYPTED_SLOT_PREFIX}${providerId}.`)
}

function credentialStorageIsSealed(storage: Storage, providerId: LiteProviderId): boolean {
  return storage.getItem(operationSealStorageKey(providerId)) !== null
}

function sealCredentialStorage(storage: Storage, providerId: LiteProviderId): void {
  storage.setItem(operationSealStorageKey(providerId), '1')
}

function parsePendingOrClearOperation(
  raw: string,
  storageKey: string,
  expectedToken: string
): StoredCredentialOperation {
  const candidate = JSON.parse(raw) as Partial<
    | PendingCredentialOperationRecord
    | FailedCredentialOperationRecord
    | ClearCredentialOperationRecord
  >
  if (
    candidate.recordVersion !== CREDENTIAL_RECORD_VERSION ||
    !isValidCredentialOperation(candidate.operation) ||
    candidate.operation.token !== expectedToken
  ) {
    throw new Error('The credential operation record is invalid.')
  }
  if (candidate.kind === 'clear') {
    return { kind: 'clear', operation: candidate.operation, storageKey }
  }
  if (
    (candidate.kind !== 'pending-save' && candidate.kind !== 'failed-save') ||
    (candidate.fallback !== undefined && !isValidEncryptedKeyFallback(candidate.fallback))
  ) {
    throw new Error('The credential operation record is invalid.')
  }
  return {
    kind: candidate.kind,
    operation: candidate.operation,
    storageKey,
    ...(candidate.fallback ? { fallback: candidate.fallback } : {})
  }
}

function parseEncryptedOperation(
  raw: string,
  storageKey: string,
  expectedToken: string
): StoredCredentialOperation {
  const candidate = JSON.parse(raw) as Partial<EncryptedSlotRecord>
  if (
    candidate.recordVersion !== CREDENTIAL_RECORD_VERSION ||
    candidate.kind !== 'encrypted' ||
    !isValidCredentialOperation(candidate.operation) ||
    candidate.operation.token !== expectedToken
  ) {
    throw new Error('The encrypted credential record is invalid.')
  }
  return {
    kind: 'encrypted',
    operation: candidate.operation,
    storageKey,
    raw
  }
}

function readStoredOperationRecords(
  storage: Storage,
  providerId: LiteProviderId
): StoredCredentialOperation[] {
  const operationPrefix = operationStoragePrefix(providerId)
  const operations: StoredCredentialOperation[] = []
  for (const storageKey of operationRecordKeys(storage, providerId)) {
    const raw = storage.getItem(storageKey)
    if (raw === null) continue
    operations.push(
      parsePendingOrClearOperation(raw, storageKey, storageKey.slice(operationPrefix.length))
    )
  }
  return operations
}

function readStoredCredentialOperations(
  storage: Storage,
  providerId: LiteProviderId
): StoredCredentialOperation[] {
  const operations = new Map<string, StoredCredentialOperation>()
  for (const operation of readStoredOperationRecords(storage, providerId)) {
    operations.set(operation.operation.token, operation)
  }

  const slotPrefix = `${ENCRYPTED_SLOT_PREFIX}${providerId}.`
  for (const storageKey of encryptedSlotKeys(storage, providerId)) {
    const raw = storage.getItem(storageKey)
    if (raw === null) continue
    const operation = parseEncryptedOperation(raw, storageKey, storageKey.slice(slotPrefix.length))
    const existing = operations.get(operation.operation.token)
    if (existing && compareCredentialOperations(existing.operation, operation.operation) !== 0) {
      throw new Error('The encrypted credential operation identity is invalid.')
    }
    // The operation's ciphertext is authoritative as soon as its unique slot
    // exists; a same-token pending marker only carries its pre-commit fallback.
    operations.set(operation.operation.token, operation)
  }

  return [...operations.values()].sort((left, right) =>
    compareCredentialOperations(right.operation, left.operation)
  )
}

function activeEncryptedStorageRecord(
  storage: Storage,
  providerId: LiteProviderId,
  beforeOperation?: CredentialOperation
): EncryptedStorageRecord | null {
  if (credentialStorageIsSealed(storage, providerId)) return null
  const operation = readStoredCredentialOperations(storage, providerId).find(
    (candidate) =>
      !beforeOperation || compareCredentialOperations(candidate.operation, beforeOperation) < 0
  )
  if (!operation) {
    const key = ENCRYPTED_KEY_PREFIX + providerId
    const raw = storage.getItem(key)
    return raw === null ? null : { key, raw }
  }

  if (operation.kind === 'clear') return null
  if (operation.kind === 'encrypted') {
    return { key: operation.storageKey, raw: operation.raw }
  }
  if (operation.fallback?.kind === 'legacy') {
    const key = ENCRYPTED_KEY_PREFIX + providerId
    const raw = storage.getItem(key)
    return raw === null ? null : { key, raw }
  }
  if (operation.fallback?.kind === 'slot') {
    const key = encryptedSlotStorageKey(providerId, operation.fallback.token)
    const raw = storage.getItem(key)
    return raw === null ? null : { key, raw }
  }
  return null
}

function fallbackForEncryptedRecord(
  providerId: LiteProviderId,
  record: EncryptedStorageRecord | null
): EncryptedKeyFallback | undefined {
  if (!record) return undefined
  if (record.key === ENCRYPTED_KEY_PREFIX + providerId) return { kind: 'legacy' }
  const prefix = `${ENCRYPTED_SLOT_PREFIX}${providerId}.`
  const token = record.key.startsWith(prefix) ? record.key.slice(prefix.length) : ''
  return isValidOperationToken(token) ? { kind: 'slot', token } : undefined
}

function registerPendingCredentialMutation(
  storage: Storage,
  providerId: LiteProviderId,
  operation: CredentialOperation
): EncryptedStorageRecord | null {
  if (credentialStorageIsSealed(storage, providerId)) {
    throw new Error(
      'Encrypted credential storage is locked because obsolete operation metadata could not be removed.'
    )
  }
  if (operationRecordKeys(storage, providerId).length >= MAX_OPERATION_RECORDS_PER_PROVIDER) {
    sealCredentialStorage(storage, providerId)
    throw new Error(
      'Encrypted credential storage was locked before operation metadata could grow further.'
    )
  }

  const storageKey = operationStorageKey(providerId, operation)
  const pendingRecord: PendingCredentialOperationRecord = {
    recordVersion: CREDENTIAL_RECORD_VERSION,
    kind: 'pending-save',
    operation
  }
  // This unique immutable ordering identity is the first storage mutation.
  // A later-started realm therefore cannot be erased when this realm resumes
  // after pausing immediately before setItem.
  storage.setItem(storageKey, JSON.stringify(pendingRecord))

  if (operationRecordKeys(storage, providerId).length > MAX_OPERATION_RECORDS_PER_PROVIDER) {
    sealCredentialStorage(storage, providerId)
    throw new Error(
      'Encrypted credential storage was locked before operation metadata could grow further.'
    )
  }

  const previousEncryptedRecord = activeEncryptedStorageRecord(storage, providerId, operation)
  const fallback = fallbackForEncryptedRecord(providerId, previousEncryptedRecord)
  if (fallback) {
    storage.setItem(storageKey, JSON.stringify({ ...pendingRecord, fallback }))
  }
  return previousEncryptedRecord
}

function persistentCredentialMutationIsCurrent(
  storage: Storage,
  providerId: LiteProviderId,
  operation: CredentialOperation
): boolean {
  try {
    if (credentialStorageIsSealed(storage, providerId)) return false
    const current = readStoredCredentialOperations(storage, providerId)[0]
    return current !== undefined && compareCredentialOperations(current.operation, operation) === 0
  } catch {
    return false
  }
}

function markCredentialMutationFailed(
  storage: Storage,
  providerId: LiteProviderId,
  operation: CredentialOperation
): void {
  try {
    if (credentialStorageIsSealed(storage, providerId)) return
    const storageKey = operationStorageKey(providerId, operation)
    const raw = storage.getItem(storageKey)
    if (raw === null) return
    const stored = parsePendingOrClearOperation(raw, storageKey, operation.token)
    if (stored.kind !== 'pending-save') return
    const failedRecord: FailedCredentialOperationRecord = {
      recordVersion: CREDENTIAL_RECORD_VERSION,
      kind: 'failed-save',
      operation,
      ...(stored.fallback ? { fallback: stored.fallback } : {})
    }
    storage.setItem(storageKey, JSON.stringify(failedRecord))
  } catch {
    // Keeping the pending record is safer: it continues reserving capacity.
  }
}

function encryptedSlotIsReferencedAsFallback(
  storage: Storage,
  providerId: LiteProviderId,
  token: string
): boolean {
  try {
    return readStoredCredentialOperations(storage, providerId).some(
      (operation) =>
        (operation.kind === 'pending-save' || operation.kind === 'failed-save') &&
        operation.fallback?.kind === 'slot' &&
        operation.fallback.token === token
    )
  } catch {
    return true
  }
}

function removeOlderOperationRecords(
  storage: Storage,
  providerId: LiteProviderId,
  operation: CredentialOperation
): void {
  let storedOperations: StoredCredentialOperation[]
  try {
    storedOperations = readStoredOperationRecords(storage, providerId)
  } catch {
    return
  }
  for (const stored of storedOperations) {
    if (
      stored.kind === 'pending-save' ||
      compareCredentialOperations(stored.operation, operation) >= 0
    ) {
      continue
    }
    try {
      storage.removeItem(stored.storageKey)
    } catch {
      // The fixed metadata cap installs a sticky seal if cleanup cannot keep up.
    }
  }
}

interface ClearCredentialRegistration {
  operation?: CredentialOperation
  storageKey?: string
  sealed: boolean
}

function registerClearCredentialMutation(
  storage: Storage,
  providerId: LiteProviderId,
  operation: CredentialOperation
): ClearCredentialRegistration {
  if (credentialStorageIsSealed(storage, providerId)) return { sealed: true }

  // Repeated Clear needs no newer timestamp while the current authority is
  // already a tombstone. Reusing it prevents cleanup failures from appending
  // an unbounded series of equivalent records.
  try {
    const current = readStoredCredentialOperations(storage, providerId)[0]
    if (current?.kind === 'clear') {
      return {
        operation: current.operation,
        storageKey: current.storageKey,
        sealed: false
      }
    }
  } catch {
    // A malformed/full record set is handled by the fixed fail-closed seal.
  }

  if (operationRecordKeys(storage, providerId).length >= MAX_OPERATION_RECORDS_PER_PROVIDER) {
    sealCredentialStorage(storage, providerId)
    return { sealed: true }
  }

  const storageKey = operationStorageKey(providerId, operation)
  const record: ClearCredentialOperationRecord = {
    recordVersion: CREDENTIAL_RECORD_VERSION,
    kind: 'clear',
    operation
  }
  storage.setItem(storageKey, JSON.stringify(record))
  if (operationRecordKeys(storage, providerId).length > MAX_OPERATION_RECORDS_PER_PROVIDER) {
    sealCredentialStorage(storage, providerId)
    return { sealed: true }
  }
  return { operation, storageKey, sealed: false }
}

function prepareEncryptedSlotCapacity(
  storage: Storage,
  providerId: LiteProviderId,
  operation: CredentialOperation,
  protectedRecord: EncryptedStorageRecord | null
): void {
  const slotPrefix = `${ENCRYPTED_SLOT_PREFIX}${providerId}.`
  for (const storageKey of encryptedSlotKeys(storage, providerId)) {
    if (storageKey === protectedRecord?.key) continue
    const raw = storage.getItem(storageKey)
    if (raw === null) continue
    try {
      const stored = parseEncryptedOperation(raw, storageKey, storageKey.slice(slotPrefix.length))
      if (compareCredentialOperations(stored.operation, operation) >= 0) continue
      storage.removeItem(storageKey)
    } catch {
      // An invalid or undeletable slot consumes capacity rather than risking
      // an overwrite of a concurrently committed credential.
    }
  }
  const slots = encryptedSlotKeys(storage, providerId)
  const slotTokens = new Set(slots.map((storageKey) => storageKey.slice(slotPrefix.length)))
  const pendingReservations = readStoredOperationRecords(storage, providerId).filter(
    (stored) =>
      stored.kind === 'pending-save' &&
      compareCredentialOperations(stored.operation, operation) < 0 &&
      !slotTokens.has(stored.operation.token)
  ).length
  if (slots.length + pendingReservations >= MAX_ENCRYPTED_SLOTS_PER_PROVIDER) {
    throw new Error(
      'Encrypted credential storage could not make room without overwriting a committed key.'
    )
  }
}

function obsoleteEncryptedSlotKeys(
  storage: Storage,
  providerId: LiteProviderId,
  operation: CredentialOperation
): string[] {
  const slotPrefix = `${ENCRYPTED_SLOT_PREFIX}${providerId}.`
  return encryptedSlotKeys(storage, providerId).filter((storageKey) => {
    const raw = storage.getItem(storageKey)
    if (raw === null) return false
    try {
      const stored = parseEncryptedOperation(raw, storageKey, storageKey.slice(slotPrefix.length))
      return compareCredentialOperations(stored.operation, operation) < 0
    } catch {
      return true
    }
  })
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
  const credential = sessionKeys.get(providerId)
  if (!credential) return ''
  if (credential.encryptedStorageKey) {
    const storageResult = browserStorage()
    if (!storageResult.ok) return ''
    try {
      if (
        activeEncryptedStorageRecord(storageResult.value, providerId)?.key !==
        credential.encryptedStorageKey
      ) {
        return ''
      }
    } catch {
      return ''
    }
  }
  return credential.value
}

export function hasKey(providerId: LiteProviderId): boolean {
  return getKey(providerId).length > 0
}

/**
 * Save a key for this page session only. This function never writes to
 * localStorage; use persistEncryptedKey for explicit encrypted persistence.
 */
export function setKey(providerId: LiteProviderId, value: string): KeyStorageResult<undefined> {
  beginCredentialMutation(providerId)
  const trimmed = value.trim()
  if (trimmed) sessionKeys.set(providerId, { value: trimmed })
  else sessionKeys.delete(providerId)
  return success(undefined)
}

/**
 * Remove every credential artifact associated with a provider. Memory is
 * cleared even if browser storage refuses the cleanup, and the failure is
 * returned so the UI cannot claim that persisted data was removed.
 */
export function clearKey(providerId: LiteProviderId): KeyStorageResult<undefined> {
  const operation = createCredentialOperation()
  beginCredentialMutation(providerId)
  sessionKeys.delete(providerId)
  const storageResult = browserStorage()
  if (!storageResult.ok) return storageResult

  const storage = storageResult.value
  let registration: ClearCredentialRegistration
  try {
    // The unique tombstone (or fixed seal at the metadata cap) is written
    // before cleanup. Older realms can resume and register, but their earlier
    // start tuple can no longer become authoritative.
    registration = registerClearCredentialMutation(storage, providerId, operation)
  } catch (error) {
    return failure(
      'storage-failed',
      error instanceof Error ? error.message : 'Browser storage refused the Clear barrier.'
    )
  }

  const failures: string[] = []
  const encryptedArtifacts =
    registration.sealed || !registration.operation
      ? encryptedSlotKeys(storage, providerId)
      : obsoleteEncryptedSlotKeys(storage, providerId, registration.operation)
  let operationArtifacts: string[] = []
  try {
    operationArtifacts = readStoredOperationRecords(storage, providerId)
      .filter(
        (stored) =>
          stored.kind !== 'pending-save' &&
          (registration.sealed ||
            !registration.operation ||
            compareCredentialOperations(stored.operation, registration.operation) < 0)
      )
      .map((stored) => stored.storageKey)
  } catch {
    // The Clear barrier remains authoritative even if malformed metadata
    // prevents best-effort metadata compaction.
  }
  const artifacts = [
    LEGACY_KEY_PREFIX + providerId,
    ENCRYPTED_KEY_PREFIX + providerId,
    CFG_PREFIX + providerId,
    // Remove the retired shared-pointer prototype if a prerelease build wrote it.
    CREDENTIAL_OPERATION_PREFIX + providerId,
    // 0.4.4 could retain a Custom endpoint key and arbitrary endpoint headers.
    LEGACY_KEY_PREFIX + 'custom',
    ENCRYPTED_KEY_PREFIX + 'custom',
    CFG_PREFIX + 'custom',
    ...encryptedArtifacts,
    ...operationArtifacts
  ]
  for (const artifact of new Set(artifacts)) {
    try {
      storage.removeItem(artifact)
    } catch (error) {
      failures.push(`${artifact}: ${storageErrorText(error)}`)
    }
  }

  if (failures.length > 0) {
    return failure(
      'storage-failed',
      `Browser storage refused part of the credential cleanup. ${failures.join(' ')}`
    )
  }
  return success(undefined)
}

/** Last four characters for a non-revealing configured hint. */
export function keyLast4(providerId: LiteProviderId): string {
  const key = getKey(providerId)
  return key ? key.slice(-4) : ''
}

function storageErrorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * One idempotent startup upgrade for every retired 0.4.4 credential artifact.
 *
 * Every readable active-provider key is recovered into the session vault before
 * cleanup begins (without overwriting a newer in-memory value). Cleanup then
 * attempts every active plaintext slot plus the retired Custom provider's key,
 * defensive ciphertext slot, and header-bearing config, even after an earlier
 * read/delete failed. Any failed storage operation makes the result a truthful
 * failure; callers must surface it because credential artifacts may remain.
 *
 * Safe to call again (Settings uses this same API): once cleanup succeeds, a
 * repeated call migrates zero keys and performs only idempotent removals.
 * The success value is the number of legacy values newly loaded into memory.
 */
export function migrateLegacyCredentialsOnStartup(): KeyStorageResult<number> {
  const storageResult = browserStorage()
  if (!storageResult.ok) return storageResult

  const storage = storageResult.value
  const recovered: Array<[LiteProviderId, string]> = []
  const failures: string[] = []
  const providerIds = LITE_PROVIDERS.map((provider) => provider.id)

  for (const providerId of providerIds) {
    const artifact = LEGACY_KEY_PREFIX + providerId
    try {
      const key = storage.getItem(artifact)?.trim()
      if (key) recovered.push([providerId, key])
    } catch (error) {
      failures.push(`Could not read ${artifact}: ${storageErrorText(error)}`)
    }
  }

  let migrated = 0
  for (const [providerId, key] of recovered) {
    if (sessionKeys.has(providerId)) continue
    sessionKeys.set(providerId, { value: key })
    migrated += 1
  }

  const legacyArtifacts = [
    ...providerIds.map((providerId) => LEGACY_KEY_PREFIX + providerId),
    LEGACY_KEY_PREFIX + 'custom',
    ENCRYPTED_KEY_PREFIX + 'custom',
    CFG_PREFIX + 'custom'
  ]
  for (const artifact of legacyArtifacts) {
    try {
      storage.removeItem(artifact)
    } catch (error) {
      failures.push(`Could not remove ${artifact}: ${storageErrorText(error)}`)
    }
  }

  if (failures.length > 0) {
    return failure(
      'storage-failed',
      `Legacy credential cleanup was incomplete. ${failures.join(' ')}`
    )
  }

  return success(migrated)
}

// --- opt-in encrypted persistence -----------------------------------------

export function hasEncryptedKey(providerId: LiteProviderId): boolean {
  const storageResult = browserStorage()
  if (!storageResult.ok) return false
  try {
    return activeEncryptedStorageRecord(storageResult.value, providerId) !== null
  } catch {
    return false
  }
}

export async function persistEncryptedKey(
  providerId: LiteProviderId,
  value: string,
  passphrase: string,
  signal?: AbortSignal
): Promise<KeyStorageResult<undefined>> {
  const trimmed = value.trim()
  if (!trimmed) return failure('invalid-input', 'Enter an API key to encrypt.')
  if (!passphrase) return failure('invalid-input', 'Enter an encryption passphrase.')

  // Capture start order before any storage access. The unique record written
  // below retains this identity even if this realm pauses before setItem.
  const operation = createCredentialOperation()
  const mutationVersion = beginCredentialMutation(providerId)
  if (!credentialMutationIsCurrent(providerId, mutationVersion, signal)) {
    return cancelledCredentialMutation()
  }
  const storageResult = browserStorage()
  if (!storageResult.ok) return storageResult
  const storage = storageResult.value

  let previousEncryptedRecord: EncryptedStorageRecord | null
  let pendingRegistered = false
  try {
    previousEncryptedRecord = registerPendingCredentialMutation(storage, providerId, operation)
    pendingRegistered = true
    if (
      !credentialMutationIsCurrent(providerId, mutationVersion, signal) ||
      !persistentCredentialMutationIsCurrent(storage, providerId, operation)
    ) {
      markCredentialMutationFailed(storage, providerId, operation)
      return cancelledCredentialMutation()
    }
    // Plaintext cleanup is authoritative and happens before the async commit.
    // A cleanup refusal therefore cannot produce a stored ciphertext followed
    // by a false failure result.
    storage.removeItem(LEGACY_KEY_PREFIX + providerId)
    removeOlderOperationRecords(storage, providerId, operation)
    prepareEncryptedSlotCapacity(storage, providerId, operation, previousEncryptedRecord)
  } catch (error) {
    if (pendingRegistered) markCredentialMutationFailed(storage, providerId, operation)
    return failure(
      'storage-failed',
      error instanceof Error ? error.message : 'The encrypted key could not be prepared.'
    )
  }

  const cryptoResult = browserCrypto()
  if (!cryptoResult.ok) {
    markCredentialMutationFailed(storage, providerId, operation)
    return cryptoResult
  }
  const mutationIsCurrent = (): boolean =>
    credentialMutationIsCurrent(providerId, mutationVersion, signal) &&
    persistentCredentialMutationIsCurrent(storage, providerId, operation)
  const encryptedStorageKey = encryptedSlotStorageKey(providerId, operation.token)

  try {
    const salt = cryptoResult.value.getRandomValues(new Uint8Array(16))
    const iv = cryptoResult.value.getRandomValues(new Uint8Array(12))
    const key = await deriveEncryptionKey(cryptoResult.value, passphrase, toArrayBuffer(salt))
    if (!mutationIsCurrent()) {
      markCredentialMutationFailed(storage, providerId, operation)
      return cancelledCredentialMutation()
    }
    const ciphertext = await cryptoResult.value.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv: toArrayBuffer(iv),
        additionalData: additionalData(providerId)
      },
      key,
      toArrayBuffer(new TextEncoder().encode(trimmed))
    )
    if (!mutationIsCurrent()) {
      markCredentialMutationFailed(storage, providerId, operation)
      return cancelledCredentialMutation()
    }
    // Pending records are physical-slot reservations. Rechecking immediately
    // before the unique write covers an older realm that passed its final token
    // check and then paused while this operation performed WebCrypto.
    prepareEncryptedSlotCapacity(storage, providerId, operation, previousEncryptedRecord)
    if (!mutationIsCurrent()) {
      markCredentialMutationFailed(storage, providerId, operation)
      return cancelledCredentialMutation()
    }
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
    const encryptedRecord: EncryptedSlotRecord = {
      recordVersion: CREDENTIAL_RECORD_VERSION,
      kind: 'encrypted',
      operation,
      ...envelope
    }
    storage.setItem(encryptedStorageKey, JSON.stringify(encryptedRecord))
    if (!mutationIsCurrent()) {
      let cleanupFailed = false
      if (!encryptedSlotIsReferencedAsFallback(storage, providerId, operation.token)) {
        try {
          storage.removeItem(encryptedStorageKey)
        } catch {
          cleanupFailed = true
        }
      }
      markCredentialMutationFailed(storage, providerId, operation)
      if (cleanupFailed) {
        try {
          sealCredentialStorage(storage, providerId)
        } catch {
          // A newer immutable operation still keeps this slot non-authoritative.
        }
      }
      return cancelledCredentialMutation()
    }
    // A successful encrypted save also unlocks the exact authoritative slot
    // for this session. getKey revalidates this identity across tabs.
    const committedSessionCredential: SessionCredential = {
      value: trimmed,
      encryptedStorageKey
    }
    sessionKeys.set(providerId, committedSessionCredential)
    if (!mutationIsCurrent()) {
      if (sessionKeys.get(providerId) === committedSessionCredential) {
        sessionKeys.delete(providerId)
      }
      return cancelledCredentialMutation()
    }

    // Old encrypted data is no longer authoritative after the commit. Cleanup
    // is deliberately non-authoritative: failure cannot turn a successful,
    // usable commit into a false error state.
    for (const storageKey of obsoleteEncryptedSlotKeys(storage, providerId, operation)) {
      try {
        storage.removeItem(storageKey)
      } catch {
        // The next Save checks capacity before it creates another unique slot.
      }
    }
    if (
      previousEncryptedRecord?.key === ENCRYPTED_KEY_PREFIX + providerId &&
      previousEncryptedRecord.key !== encryptedStorageKey
    ) {
      try {
        storage.removeItem(previousEncryptedRecord.key)
      } catch {
        // The slot commit remains truthful and authoritative.
      }
    }
    removeOlderOperationRecords(storage, providerId, operation)
    try {
      storage.removeItem(operationStorageKey(providerId, operation))
    } catch {
      // The encrypted slot duplicates this ordering identity; the metadata cap
      // prevents an undeletable pending marker from accumulating forever.
    }
    return success(undefined)
  } catch (error) {
    markCredentialMutationFailed(storage, providerId, operation)
    if (!mutationIsCurrent()) {
      return cancelledCredentialMutation()
    }
    return failure(
      'storage-failed',
      error instanceof Error ? error.message : 'The encrypted key could not be stored.'
    )
  }
}

export async function unlockEncryptedKey(
  providerId: LiteProviderId,
  passphrase: string,
  signal?: AbortSignal
): Promise<KeyStorageResult<undefined>> {
  if (!passphrase) return failure('invalid-input', 'Enter the encryption passphrase.')

  const mutationVersion = beginCredentialMutation(providerId)
  if (!credentialMutationIsCurrent(providerId, mutationVersion, signal)) {
    return cancelledCredentialMutation()
  }
  const storageResult = browserStorage()
  if (!storageResult.ok) return storageResult
  const cryptoResult = browserCrypto()
  if (!cryptoResult.ok) return cryptoResult

  let envelope: EncryptedKeyEnvelope
  let encryptedRecord: EncryptedStorageRecord
  try {
    const activeRecord = activeEncryptedStorageRecord(storageResult.value, providerId)
    if (!activeRecord) {
      return failure('invalid-ciphertext', 'No encrypted key is stored for this provider.')
    }
    encryptedRecord = activeRecord
    const candidate = JSON.parse(activeRecord.raw) as Partial<EncryptedKeyEnvelope>
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

  const encryptedRecordIsCurrent = (): boolean => {
    if (!credentialMutationIsCurrent(providerId, mutationVersion, signal)) return false
    try {
      const activeRecord = activeEncryptedStorageRecord(storageResult.value, providerId)
      return activeRecord?.key === encryptedRecord.key && activeRecord.raw === encryptedRecord.raw
    } catch {
      return false
    }
  }

  try {
    const salt = base64ToBytes(envelope.salt)
    const iv = base64ToBytes(envelope.iv)
    if (salt.byteLength !== 16 || iv.byteLength !== 12) {
      return failure('invalid-ciphertext', 'The encrypted key record is invalid.')
    }
    const key = await deriveEncryptionKey(cryptoResult.value, passphrase, toArrayBuffer(salt))
    if (!encryptedRecordIsCurrent()) {
      return cancelledCredentialMutation()
    }
    const plaintext = await cryptoResult.value.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: toArrayBuffer(iv),
        additionalData: additionalData(providerId)
      },
      key,
      toArrayBuffer(base64ToBytes(envelope.ciphertext))
    )
    if (!encryptedRecordIsCurrent()) {
      return cancelledCredentialMutation()
    }
    const value = new TextDecoder().decode(plaintext).trim()
    if (!value) return failure('invalid-ciphertext', 'The encrypted key record is empty.')
    const unlockedSessionCredential: SessionCredential = {
      value,
      encryptedStorageKey: encryptedRecord.key
    }
    sessionKeys.set(providerId, unlockedSessionCredential)
    if (!encryptedRecordIsCurrent()) {
      if (sessionKeys.get(providerId) === unlockedSessionCredential) {
        sessionKeys.delete(providerId)
      }
      return cancelledCredentialMutation()
    }
    return success(undefined)
  } catch {
    if (!encryptedRecordIsCurrent()) {
      return cancelledCredentialMutation()
    }
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

export function setPref(name: string, value: string): KeyStorageResult<undefined> {
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
  credentialMutationVersions.clear()
}
