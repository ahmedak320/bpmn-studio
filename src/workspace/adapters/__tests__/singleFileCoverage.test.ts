import { afterEach, describe, expect, it, vi } from 'vitest'
import { SingleFileWorkspaceAdapter, type WorkspaceAdapter } from '..'
import { FakeFileHandle } from './fakeFileSystem'

const text = (value: string) => new TextEncoder().encode(value)
const decode = (value: Uint8Array) => new TextDecoder().decode(value)

function asFileHandle(handle: object): FileSystemFileHandle {
  return handle as FileSystemFileHandle
}

function abortOnRead(readToAbort: number): AbortSignal {
  let reads = 0
  return {
    get aborted() {
      reads += 1
      return reads >= readToAbort
    }
  } as AbortSignal
}

function throwOnCheck(checkToAbort: number): AbortSignal {
  let checks = 0
  return {
    aborted: false,
    throwIfAborted() {
      checks += 1
      if (checks === checkToAbort) {
        const error = new Error('cancelled by deterministic test signal')
        error.name = 'AbortError'
        throw error
      }
    }
  } as AbortSignal
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('SingleFileWorkspaceAdapter edge coverage', () => {
  it('opens File objects and handle-backed files with truthful metadata fallbacks', async () => {
    const fromFile = await SingleFileWorkspaceAdapter.fromFile(
      new File([text('binary')], 'plain.bin', { lastModified: 7 }),
      { workspaceId: 'single:file', download: vi.fn() }
    )
    expect(await fromFile.list()).toEqual([
      expect.objectContaining({
        path: 'plain.bin',
        size: 6,
        modifiedAt: 7,
        mimeType: 'application/octet-stream'
      })
    ])

    const fallbackFile = new File([text('<xml />')], '', { lastModified: 8 })
    const handle = asFileHandle({
      kind: 'file',
      name: 'fallback.xml',
      getFile: async () => fallbackFile,
      createWritable: vi.fn()
    })
    const fromHandle = await SingleFileWorkspaceAdapter.fromHandle(handle)

    expect(fromHandle.id).toBe('single-file:fallback.xml')
    expect(await fromHandle.list()).toEqual([
      expect.objectContaining({
        path: 'fallback.xml',
        size: 7,
        modifiedAt: 8,
        mimeType: 'application/xml'
      })
    ])
    expect(fromHandle.storage).toMatchObject({
      persistence: 'external-file',
      description: expect.stringContaining('explicitly opened')
    })
  })

  it('rejects non-root listing, missing reads, and both in-memory and handle read overruns', async () => {
    const memory = new SingleFileWorkspaceAdapter({
      path: 'process.bpmn',
      bytes: text('base'),
      download: vi.fn()
    })
    await expect(memory.list('folder')).rejects.toMatchObject({
      code: 'not-a-directory',
      operation: 'list'
    })
    await expect(memory.read('missing.bpmn')).rejects.toMatchObject({
      code: 'not-found',
      operation: 'read'
    })
    await expect(memory.read('process.bpmn', { maxBytes: 3 })).rejects.toMatchObject({
      name: 'WorkspaceReadLimitError',
      maxBytes: 3,
      actualBytes: 4
    })

    const file = new FakeFileHandle('process.bpmn', 'handle')
    const direct = await SingleFileWorkspaceAdapter.fromHandle(asFileHandle(file))
    await expect(direct.read('process.bpmn', { maxBytes: 5 })).rejects.toMatchObject({
      name: 'WorkspaceReadLimitError',
      maxBytes: 5,
      actualBytes: 6
    })
  })

  it('observes cancellation at each post-validation snapshot boundary', async () => {
    const memory = new SingleFileWorkspaceAdapter({
      path: 'process.bpmn',
      bytes: text('base'),
      download: vi.fn()
    })
    await expect(memory.read('process.bpmn', { signal: throwOnCheck(3) })).rejects.toMatchObject({
      name: 'AbortError'
    })
    await expect(memory.read('process.bpmn', { signal: throwOnCheck(4) })).rejects.toMatchObject({
      name: 'AbortError'
    })

    const file = new FakeFileHandle('process.bpmn', 'base')
    const direct = await SingleFileWorkspaceAdapter.fromHandle(asFileHandle(file))
    for (const check of [4, 5, 6]) {
      await expect(
        direct.read('process.bpmn', { signal: throwOnCheck(check) })
      ).rejects.toMatchObject({ name: 'AbortError' })
    }
  })

  it('enforces write preconditions without dispatching a download', async () => {
    const download = vi.fn()
    const adapter = new SingleFileWorkspaceAdapter({
      workspaceId: 'single:preconditions',
      path: 'process.bpmn',
      bytes: text('base'),
      download
    })
    const base = await adapter.read('process.bpmn')

    expect(await adapter.writeAtomic('missing.bpmn', text('next'))).toMatchObject({
      status: 'storage-failure',
      error: { code: 'not-found' }
    })
    expect(
      await adapter.writeAtomic('process.bpmn', text('next'), base.hash, {
        expectedMissing: true
      })
    ).toMatchObject({ status: 'storage-failure' })
    expect(
      await adapter.writeAtomic('process.bpmn', text('next'), undefined, {
        expectedMissing: true
      })
    ).toMatchObject({
      status: 'external-conflict',
      reason: 'already-exists'
    })
    expect(download).not.toHaveBeenCalled()
  })

  it('cancels after conflict checks and aborts a staged handle write', async () => {
    const memoryDownload = vi.fn()
    const memory = new SingleFileWorkspaceAdapter({
      path: 'process.bpmn',
      bytes: text('base'),
      download: memoryDownload
    })
    expect(
      await memory.writeAtomic('process.bpmn', text('next'), undefined, {
        signal: abortOnRead(2)
      })
    ).toMatchObject({ status: 'cancelled' })
    expect(memoryDownload).not.toHaveBeenCalled()

    const file = new FakeFileHandle('process.bpmn', 'base')
    const direct = await SingleFileWorkspaceAdapter.fromHandle(asFileHandle(file))
    expect(
      await direct.writeAtomic('process.bpmn', text('next'), undefined, {
        signal: abortOnRead(3)
      })
    ).toMatchObject({ status: 'cancelled' })
    expect(decode(file.bytes)).toBe('base')
  })

  it('reports prompt and denied handle permissions distinctly', async () => {
    for (const [state, message] of [
      ['prompt', 'reconnected'],
      ['denied', 'no longer granted']
    ] as const) {
      const file = new FakeFileHandle('process.bpmn', 'base')
      const handle = Object.assign(file, {
        queryPermission: vi.fn(async () => state)
      })
      const adapter = await SingleFileWorkspaceAdapter.fromHandle(asFileHandle(handle))

      expect(await adapter.writeAtomic('process.bpmn', text('next'))).toMatchObject({
        status: 'permission-loss',
        error: { message: expect.stringContaining(message) }
      })
      expect(decode(file.bytes)).toBe('base')
    }
  })

  it('preserves the authoritative write error when abort is absent or also fails', async () => {
    for (const abort of [
      undefined,
      vi.fn(async () => {
        throw new Error('secondary abort failure')
      })
    ]) {
      const file = new FakeFileHandle('process.bpmn', 'base')
      vi.spyOn(file, 'createWritable').mockResolvedValue({
        write: async () => {
          throw new Error('authoritative write failure')
        },
        close: vi.fn(),
        ...(abort ? { abort } : {})
      } as unknown as FileSystemWritableFileStream)
      const adapter = await SingleFileWorkspaceAdapter.fromHandle(asFileHandle(file))

      expect(await adapter.writeAtomic('process.bpmn', text('next'))).toMatchObject({
        status: 'storage-failure',
        error: { message: 'authoritative write failure' }
      })
      if (abort) expect(abort).toHaveBeenCalledOnce()
    }
  })

  it('falls back after a verified close becomes unreadable and rejects corrupted closes', async () => {
    const unreadable = new FakeFileHandle('process.bpmn', 'base')
    const unreadableCreateWritable = unreadable.createWritable.bind(unreadable)
    vi.spyOn(unreadable, 'createWritable').mockImplementation(async () => {
      const writable = await unreadableCreateWritable()
      const close = writable.close.bind(writable)
      return {
        ...writable,
        close: async () => {
          await close()
          unreadable.unreadable = true
        }
      } as FileSystemWritableFileStream
    })
    const fallback = await SingleFileWorkspaceAdapter.fromHandle(asFileHandle(unreadable))
    expect(await fallback.writeAtomic('process.bpmn', text('saved'))).toMatchObject({
      status: 'success',
      disposition: 'workspace',
      snapshot: { modifiedAt: expect.any(Number) }
    })

    const corrupted = new FakeFileHandle('process.bpmn', 'base')
    const corruptedCreateWritable = corrupted.createWritable.bind(corrupted)
    vi.spyOn(corrupted, 'createWritable').mockImplementation(async () => {
      const writable = await corruptedCreateWritable()
      const close = writable.close.bind(writable)
      return {
        ...writable,
        close: async () => {
          await close()
          corrupted.bytes = text('corrupted')
        }
      } as FileSystemWritableFileStream
    })
    const guarded = await SingleFileWorkspaceAdapter.fromHandle(asFileHandle(corrupted))
    expect(await guarded.writeAtomic('process.bpmn', text('saved'))).toMatchObject({
      status: 'storage-failure',
      error: { code: 'integrity-failure' }
    })
  })

  it('maps download cancellation and unavailable Web Crypto to safe outcomes', async () => {
    const cancelled = new SingleFileWorkspaceAdapter({
      path: 'process.bpmn',
      bytes: text('base'),
      download: async () => {
        const error = new Error('download cancelled')
        error.name = 'AbortError'
        throw error
      }
    })
    expect(await cancelled.writeAtomic('process.bpmn', text('next'))).toMatchObject({
      status: 'cancelled',
      error: { code: 'cancelled', name: 'AbortError' }
    })

    vi.stubGlobal('crypto', undefined)
    const unavailableHash = new SingleFileWorkspaceAdapter({
      path: 'process.bpmn',
      bytes: text('base'),
      download: vi.fn()
    })
    expect(await unavailableHash.writeAtomic('process.bpmn', text('next'))).toMatchObject({
      status: 'storage-failure',
      error: { message: expect.stringContaining('Web Crypto') }
    })
  })

  it('uses the default browser download sink and always revokes its object URL', async () => {
    const anchor = {
      href: '',
      download: '',
      style: { display: '' },
      click: vi.fn(),
      remove: vi.fn()
    }
    const append = vi.fn()
    const createObjectURL = vi.fn(() => 'blob:single-file')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('document', {
      createElement: vi.fn(() => anchor),
      body: { append }
    })
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL })

    const adapter = new SingleFileWorkspaceAdapter({
      path: 'process.bpmn',
      bytes: text('base')
    })
    expect(await adapter.writeAtomic('process.bpmn', text('saved'))).toMatchObject({
      status: 'success',
      disposition: 'download'
    })
    expect(createObjectURL).toHaveBeenCalledOnce()
    expect(append).toHaveBeenCalledWith(anchor)
    expect(anchor).toMatchObject({
      href: 'blob:single-file',
      download: 'process.bpmn',
      style: { display: 'none' }
    })
    expect(anchor.click).toHaveBeenCalledOnce()
    expect(anchor.remove).toHaveBeenCalledOnce()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:single-file')
  })

  it('fails closed for every unavailable default-download surface', async () => {
    const run = async () => {
      const adapter = new SingleFileWorkspaceAdapter({
        path: 'process.bpmn',
        bytes: text('base')
      })
      expect(await adapter.writeAtomic('process.bpmn', text('next'))).toMatchObject({
        status: 'storage-failure',
        error: { code: 'unsupported' }
      })
    }

    await run()
    vi.stubGlobal('document', {})
    vi.stubGlobal('URL', undefined)
    await run()
    vi.stubGlobal('URL', {})
    await run()
  })

  it('covers rename, removal, folder, backup, and path-validation alternatives', async () => {
    const backup = new Blob(['backup'])
    const backupExporter = vi.fn(
      async (_adapter: WorkspaceAdapter, _options?: { generatedAt?: Date }) => backup
    )
    const file = new FakeFileHandle('process.bpmn', 'base')
    const adapter = await SingleFileWorkspaceAdapter.fromHandle(asFileHandle(file), {
      backupExporter
    })

    await expect(adapter.rename('missing.bpmn', 'other.bpmn')).rejects.toMatchObject({
      code: 'not-found'
    })
    await adapter.rename('process.bpmn', 'process.bpmn')
    expect(adapter.storage.persistence).toBe('external-file')
    await adapter.move('process.bpmn', 'renamed.bpmn')
    expect(adapter.storage.persistence).toBe('download')

    await expect(adapter.remove('missing.bpmn')).rejects.toMatchObject({ code: 'not-found' })
    await expect(adapter.removeIfHash('missing.bpmn', '0'.repeat(64))).rejects.toMatchObject({
      code: 'not-found'
    })
    await expect(adapter.removeIfHash('renamed.bpmn', '0'.repeat(64))).rejects.toMatchObject({
      code: 'unsupported'
    })
    await expect(adapter.createFolder('')).resolves.toBeUndefined()
    await expect(adapter.createFolderIfMissing('')).resolves.toBe('existing')
    await expect(adapter.createFolderIfMissing('folder')).rejects.toMatchObject({
      code: 'unsupported'
    })
    await expect(adapter.move('renamed.bpmn', 'folder/renamed.bpmn')).rejects.toMatchObject({
      code: 'invalid-path'
    })

    const generatedAt = new Date('2026-07-27T00:00:00.000Z')
    await expect(adapter.exportBackup({ generatedAt })).resolves.toBe(backup)
    expect(backupExporter).toHaveBeenCalledWith(adapter, { generatedAt })
  })
})
