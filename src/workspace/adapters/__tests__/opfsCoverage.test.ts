import { afterEach, describe, expect, it, vi } from 'vitest'
import { OpfsWorkspaceAdapter, opfsSupported } from '..'
import { asDirectoryHandle, fakeRoot } from './fakeFileSystem'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('OpfsWorkspaceAdapter edge coverage', () => {
  it('derives default identities and describes granted persistence truthfully', () => {
    const named = new OpfsWorkspaceAdapter(asDirectoryHandle(fakeRoot()))
    expect(named.id).toBe('opfs:workspace')
    expect(named.directoryName).toBe('workspace')
    expect(named.persisted).toBe(false)
    expect(named.storage).toMatchObject({
      persistence: 'origin-private-best-effort',
      description: expect.stringContaining('may evict')
    })

    const namelessRoot = fakeRoot()
    Object.defineProperty(namelessRoot, 'name', {
      configurable: true,
      value: undefined
    })
    const durable = new OpfsWorkspaceAdapter(asDirectoryHandle(namelessRoot), {
      persisted: true
    })
    expect(durable.id).toBe('opfs:orbitpm')
    expect(durable.directoryName).toBe('orbitpm')
    expect(durable.storage).toMatchObject({
      persistence: 'origin-private-durable',
      description: expect.stringContaining('durable storage granted')
    })
  })

  it('uses navigator storage, the default directory, and absent persistence APIs safely', async () => {
    const origin = fakeRoot()
    const storage = {
      getDirectory: vi.fn(async () => asDirectoryHandle(origin))
    }
    vi.stubGlobal('navigator', { storage })

    expect(opfsSupported()).toBe(true)
    const adapter = await OpfsWorkspaceAdapter.open()

    expect(storage.getDirectory).toHaveBeenCalledOnce()
    expect(adapter.directoryName).toBe('orbitpm')
    expect(adapter.persisted).toBe(false)
    expect(origin.directory('orbitpm')).toBeDefined()
  })

  it('rejects nested workspace directory names before touching storage', async () => {
    const getDirectory = vi.fn(async () => asDirectoryHandle(fakeRoot()))
    await expect(
      OpfsWorkspaceAdapter.open({
        directoryName: 'nested/orbitpm',
        storageManager: { getDirectory }
      })
    ).rejects.toMatchObject({
      code: 'invalid-path',
      operation: 'open',
      path: 'nested/orbitpm'
    })
    expect(getDirectory).not.toHaveBeenCalled()
  })

  it('falls back to best-effort storage when persistence probing throws', async () => {
    const origin = fakeRoot()
    const persist = vi.fn(async () => true)
    const adapter = await OpfsWorkspaceAdapter.open({
      requestPersistence: true,
      storageManager: {
        getDirectory: async () => asDirectoryHandle(origin),
        persisted: async () => {
          throw new Error('persistence state unavailable')
        },
        persist
      }
    })

    expect(adapter.persisted).toBe(false)
    expect(persist).not.toHaveBeenCalled()
    expect(adapter.storage.persistence).toBe('origin-private-best-effort')
  })

  it('honors an explicit persistence state without querying browser persistence', async () => {
    const origin = fakeRoot()
    const persisted = vi.fn(async () => false)
    const persist = vi.fn(async () => false)
    const adapter = await OpfsWorkspaceAdapter.open({
      directoryName: 'explicit',
      persisted: true,
      storageManager: {
        getDirectory: async () => asDirectoryHandle(origin),
        persisted,
        persist
      }
    })

    expect(adapter.persisted).toBe(true)
    expect(persisted).not.toHaveBeenCalled()
    expect(persist).not.toHaveBeenCalled()
  })
})
