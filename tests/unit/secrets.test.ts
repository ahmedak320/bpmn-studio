import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let userDataDir = ''
let encryptionAvailable = true

vi.mock('electron', () => {
  return {
    app: {
      getPath: (_name: string) => userDataDir
    },
    safeStorage: {
      isEncryptionAvailable: () => encryptionAvailable,
      // Fake reversible "encryption": base64 with a marker prefix, so tests
      // can prove decrypt(encrypt(x)) === x without real OS DPAPI.
      encryptString: (value: string) => Buffer.from(`ENC:${value}`, 'utf8'),
      decryptString: (buf: Buffer) => {
        const raw = buf.toString('utf8')
        if (!raw.startsWith('ENC:')) throw new Error('bad ciphertext')
        return raw.slice(4)
      }
    }
  }
})

describe('secrets vault', () => {
  beforeEach(async () => {
    userDataDir = await mkdtemp(join(tmpdir(), 'orbitpm-secrets-'))
    encryptionAvailable = true
    vi.resetModules()
  })

  afterEach(async () => {
    await rm(userDataDir, { recursive: true, force: true })
  })

  it('round-trips a key through set/get when encryption is available', async () => {
    const secrets = await import('../../src/main/secrets')
    await secrets.setKey('openai', { apiKey: 'sk-test-123' })
    const keys = await secrets.getKeys('openai')
    expect(keys.apiKey).toBe('sk-test-123')
  })

  it('reports configured=true only once required fields are set', async () => {
    const secrets = await import('../../src/main/secrets')
    let status = await secrets.getStatus()
    expect(status.providers.find((p) => p.id === 'openai')?.configured).toBe(false)

    await secrets.setKey('openai', { apiKey: 'sk-test' })
    status = await secrets.getStatus()
    expect(status.providers.find((p) => p.id === 'openai')?.configured).toBe(true)
  })

  it('azure is only configured once all four required fields are present', async () => {
    const secrets = await import('../../src/main/secrets')
    await secrets.setKey('azure', { apiKey: 'k', endpoint: 'https://x.openai.azure.com' })
    let status = await secrets.getStatus()
    expect(status.providers.find((p) => p.id === 'azure')?.configured).toBe(false)

    await secrets.setKey('azure', { deployment: 'gpt-deploy' })
    // apiVersion has a defaultValue in the catalog, so it counts as satisfied
    // even without an explicit stored value.
    status = await secrets.getStatus()
    expect(status.providers.find((p) => p.id === 'azure')?.configured).toBe(true)
  })

  it('deleteKey clears stored fields', async () => {
    const secrets = await import('../../src/main/secrets')
    await secrets.setKey('anthropic', { apiKey: 'ant-123' })
    await secrets.deleteKey('anthropic')
    const keys = await secrets.getKeys('anthropic')
    expect(keys.apiKey).toBeUndefined()
    const status = await secrets.getStatus()
    expect(status.providers.find((p) => p.id === 'anthropic')?.configured).toBe(false)
  })

  it('falls back to a plaintext store (with a visible flag) when encryption is unavailable', async () => {
    encryptionAvailable = false
    const secrets = await import('../../src/main/secrets')
    await secrets.setKey('deepseek', { apiKey: 'ds-plain' })

    const status = await secrets.getStatus()
    expect(status.encryptionAvailable).toBe(false)

    const keys = await secrets.getKeys('deepseek')
    expect(keys.apiKey).toBe('ds-plain')

    const raw = await (await import('node:fs/promises')).readFile(
      join(userDataDir, 'secrets.json'),
      'utf8'
    )
    expect(raw).toContain('ds-plain')
    expect(raw).not.toContain('ENC:')
  })

  it('getAllKeys returns decrypted fields for every stored provider', async () => {
    const secrets = await import('../../src/main/secrets')
    await secrets.setKey('openai', { apiKey: 'a' })
    await secrets.setKey('glm', { apiKey: 'b', baseURL: 'https://x' })

    const all = await secrets.getAllKeys()
    expect(all.openai?.apiKey).toBe('a')
    expect(all.glm?.apiKey).toBe('b')
    expect(all.glm?.baseURL).toBe('https://x')
  })
})
