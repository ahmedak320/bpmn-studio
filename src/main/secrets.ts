// Encrypted key vault for provider credentials.
//
// Storage format: <userData>/secrets.json
//   {
//     "encryptionAvailable": boolean,   // safeStorage.isEncryptionAvailable() at last write
//     "providers": {
//       "<providerId>": { "<fieldName>": "<base64 ciphertext or plaintext>" }
//     }
//   }
//
// When OS-level encryption (DPAPI on Windows) is unavailable, we fall back to
// a plaintext file rather than refusing to store keys at all — the UI must
// surface `getStatus().encryptionAvailable === false` as a visible warning
// banner so the user knows keys are stored unencrypted on this machine.
import { app, safeStorage } from 'electron'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { ProviderId } from '../shared/providers'
import { PROVIDERS } from '../shared/providers'

interface SecretsFile {
  encryptionAvailable: boolean
  providers: Partial<Record<ProviderId, Record<string, string>>>
}

const EMPTY_FILE: SecretsFile = { encryptionAvailable: true, providers: {} }

function secretsPath(): string {
  return join(app.getPath('userData'), 'secrets.json')
}

async function readFileSafe(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
}

async function readStore(): Promise<SecretsFile> {
  const raw = await readFileSafe(secretsPath())
  if (!raw) return { ...EMPTY_FILE, providers: {} }
  try {
    const parsed = JSON.parse(raw) as Partial<SecretsFile>
    return {
      encryptionAvailable: parsed.encryptionAvailable ?? true,
      providers: parsed.providers ?? {}
    }
  } catch {
    // Corrupt file — treat as empty rather than crashing the app.
    return { ...EMPTY_FILE, providers: {} }
  }
}

/** Atomic write (temp + rename) so a crash mid-write can't corrupt the vault. */
async function writeStore(store: SecretsFile): Promise<void> {
  const target = secretsPath()
  await mkdir(dirname(target), { recursive: true })
  const tmp = `${target}.${process.pid}.tmp`
  await writeFile(tmp, JSON.stringify(store, null, 2), 'utf8')
  await rename(tmp, target)
}

function encryptionAvailable(): boolean {
  try {
    return safeStorage.isEncryptionAvailable()
  } catch {
    return false
  }
}

function encryptField(value: string): string {
  if (encryptionAvailable()) {
    return safeStorage.encryptString(value).toString('base64')
  }
  return value
}

function decryptField(stored: string, wasEncrypted: boolean): string {
  if (!wasEncrypted) return stored
  try {
    return safeStorage.decryptString(Buffer.from(stored, 'base64'))
  } catch {
    // Ciphertext from a different machine/user, or encryption became
    // unavailable since it was written — surface as empty rather than throw.
    return ''
  }
}

export interface ProviderStatus {
  id: ProviderId
  /** True when every `required` keyField for this provider has a non-empty value. */
  configured: boolean
}

export interface SecretsStatus {
  encryptionAvailable: boolean
  providers: ProviderStatus[]
}

/** Overall vault status + per-provider "is this fully configured" flags. */
export async function getStatus(): Promise<SecretsStatus> {
  const store = await readStore()
  const providers: ProviderStatus[] = (Object.keys(PROVIDERS) as ProviderId[]).map((id) => {
    const spec = PROVIDERS[id]
    const fields = store.providers[id] ?? {}
    const configured = spec.keyFields
      .filter((f) => f.required)
      .every((f) => Boolean(fields[f.name]) || Boolean(f.defaultValue))
    return { id, configured }
  })
  return { encryptionAvailable: store.encryptionAvailable, providers }
}

/** Decrypted field values for one provider (empty object if none stored). */
export async function getKeys(providerId: ProviderId): Promise<Record<string, string>> {
  const store = await readStore()
  const fields = store.providers[providerId] ?? {}
  const out: Record<string, string> = {}
  for (const [name, value] of Object.entries(fields)) {
    out[name] = decryptField(value, store.encryptionAvailable)
  }
  return out
}

/** All providers' decrypted fields — used by providers.ts availableProviders(). */
export async function getAllKeys(): Promise<Partial<Record<ProviderId, Record<string, string>>>> {
  const store = await readStore()
  const out: Partial<Record<ProviderId, Record<string, string>>> = {}
  for (const id of Object.keys(store.providers) as ProviderId[]) {
    const fields = store.providers[id] ?? {}
    const decrypted: Record<string, string> = {}
    for (const [name, value] of Object.entries(fields)) {
      decrypted[name] = decryptField(value, store.encryptionAvailable)
    }
    out[id] = decrypted
  }
  return out
}

/** Encrypt (or store plaintext, see module docblock) and persist one provider's fields. */
export async function setKey(
  providerId: ProviderId,
  fields: Record<string, string>
): Promise<void> {
  const store = await readStore()
  const nowEncrypted = encryptionAvailable()
  const existing = store.providers[providerId] ?? {}
  const merged: Record<string, string> = { ...existing }
  for (const [name, value] of Object.entries(fields)) {
    merged[name] = encryptField(value)
  }
  store.providers[providerId] = merged
  store.encryptionAvailable = nowEncrypted
  await writeStore(store)
}

/** Remove all stored fields for a provider. */
export async function deleteKey(providerId: ProviderId): Promise<void> {
  const store = await readStore()
  delete store.providers[providerId]
  await writeStore(store)
}

/** Test/dev helper: wipes the vault file entirely. Not exposed over IPC. */
export async function clearAll(): Promise<void> {
  try {
    await unlink(secretsPath())
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
  }
}
