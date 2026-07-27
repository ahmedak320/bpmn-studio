import { describe, expect, it, vi } from 'vitest'
import { OpfsWorkspaceAdapter, SingleFileWorkspaceAdapter, opfsSupported } from '..'
import { asDirectoryHandle, fakeRoot } from './fakeFileSystem'

const text = (value: string) => new TextEncoder().encode(value)
const decode = (value: Uint8Array) => new TextDecoder().decode(value)

describe('OpfsWorkspaceAdapter', () => {
  it('opens a scoped persistent workspace with full folder/file behavior', async () => {
    const origin = fakeRoot()
    const persist = vi.fn(async () => true)
    const adapter = await OpfsWorkspaceAdapter.open({
      workspaceId: 'opfs:stable-id',
      directoryName: 'orbitpm-workspace',
      requestPersistence: true,
      storageManager: {
        getDirectory: async () => asDirectoryHandle(origin),
        persisted: async () => false,
        persist
      }
    })

    expect(persist).toHaveBeenCalledOnce()
    expect(adapter.id).toBe('opfs:stable-id')
    expect(adapter.mode).toBe('opfs')
    expect(adapter.persisted).toBe(true)
    expect(adapter.storage.persistence).toBe('origin-private-durable')
    await adapter.createFolder('sales')
    expect(await adapter.writeAtomic('sales/a.bpmn', text('a'))).toMatchObject({
      status: 'success'
    })
    expect(decode((await adapter.read('sales/a.bpmn')).bytes)).toBe('a')
    expect(origin.directory('orbitpm-workspace').directory('sales')).toBeDefined()
  })

  it('detects support and fails explicitly when OPFS is unavailable', async () => {
    expect(opfsSupported({ getDirectory: async () => asDirectoryHandle(fakeRoot()) })).toBe(true)
    expect(opfsSupported({})).toBe(false)
    await expect(OpfsWorkspaceAdapter.open({ storageManager: {} as never })).rejects.toMatchObject({
      code: 'unsupported'
    })
  })
})

describe('SingleFileWorkspaceAdapter', () => {
  it('reports success only after an explicit download completes', async () => {
    const downloads: Array<{ path: string; bytes: Uint8Array }> = []
    const adapter = new SingleFileWorkspaceAdapter({
      workspaceId: 'single:1',
      path: 'process.bpmn',
      bytes: text('base'),
      now: () => 99,
      download: async ({ path, bytes }) => {
        downloads.push({ path, bytes })
      }
    })
    const base = await adapter.read('process.bpmn')
    const outcome = await adapter.writeAtomic('process.bpmn', text('saved'), base.hash)

    expect(outcome).toMatchObject({
      status: 'success',
      disposition: 'download',
      created: false
    })
    expect(downloads).toHaveLength(1)
    expect(downloads[0].path).toBe('process.bpmn')
    expect(decode(downloads[0].bytes)).toBe('saved')
    expect(decode((await adapter.read('process.bpmn')).bytes)).toBe('saved')
    expect(adapter.storage.persistence).toBe('download')
  })

  it('does not mutate saved state when download dispatch fails', async () => {
    const adapter = new SingleFileWorkspaceAdapter({
      path: 'process.bpmn',
      bytes: text('safe'),
      download: async () => {
        throw new Error('downloads blocked')
      }
    })
    const base = await adapter.read('process.bpmn')
    expect(await adapter.writeAtomic('process.bpmn', text('lost'), base.hash)).toMatchObject({
      status: 'storage-failure'
    })
    expect(decode((await adapter.read('process.bpmn')).bytes)).toBe('safe')
  })

  it('detects conflicts and stale/cancelled saves', async () => {
    const adapter = new SingleFileWorkspaceAdapter({
      workspaceId: 'single:current',
      path: 'process.bpmn',
      bytes: text('base'),
      download: vi.fn()
    })
    expect(await adapter.writeAtomic('process.bpmn', text('local'), '0'.repeat(64))).toMatchObject({
      status: 'external-conflict',
      reason: 'hash-mismatch'
    })
    expect(
      await adapter.writeAtomic('process.bpmn', text('local'), undefined, {
        expectedWorkspaceId: 'single:stale'
      })
    ).toMatchObject({ status: 'stale-workspace' })
    const controller = new AbortController()
    controller.abort()
    expect(
      await adapter.writeAtomic('process.bpmn', text('local'), undefined, {
        signal: controller.signal
      })
    ).toMatchObject({ status: 'cancelled' })
  })

  it('re-reads an explicitly writable file handle before saving', async () => {
    const root = fakeRoot()
    const file = root.addFile('process.bpmn', 'base')
    const adapter = await SingleFileWorkspaceAdapter.fromHandle(
      file as unknown as FileSystemFileHandle,
      { workspaceId: 'single:handle' }
    )
    const base = await adapter.read('process.bpmn')
    file.bytes = text('external')

    expect(await adapter.writeAtomic('process.bpmn', text('local'), base.hash)).toMatchObject({
      status: 'external-conflict',
      reason: 'hash-mismatch'
    })
    const external = await adapter.read('process.bpmn')
    expect(await adapter.writeAtomic('process.bpmn', text('saved'), external.hash)).toMatchObject({
      status: 'success',
      disposition: 'workspace'
    })
    expect(decode(file.bytes)).toBe('saved')
    expect(adapter.storage.persistence).toBe('external-file')
  })

  it('renames as a new download target and explicitly rejects folders/deletion', async () => {
    const download = vi.fn()
    const adapter = new SingleFileWorkspaceAdapter({
      path: 'old.bpmn',
      bytes: text('xml'),
      download
    })
    await adapter.rename('old.bpmn', 'new.bpmn')
    expect((await adapter.list())[0].path).toBe('new.bpmn')
    await adapter.writeAtomic('new.bpmn', text('updated'))
    expect(download.mock.calls[0][0].path).toBe('new.bpmn')
    await expect(adapter.createFolder('folder')).rejects.toMatchObject({
      code: 'unsupported'
    })
    await expect(adapter.move('new.bpmn', 'folder/new.bpmn')).rejects.toMatchObject({
      code: 'invalid-path'
    })
    await expect(adapter.remove('new.bpmn')).rejects.toMatchObject({
      code: 'unsupported'
    })
  })
})
