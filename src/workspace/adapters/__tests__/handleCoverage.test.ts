import { describe, expect, it, vi } from 'vitest'
import { DirectoryWorkspaceAdapter, MemoryWorkspaceAdapter } from '..'
import { HandleWorkspaceAdapter } from '../handleAdapter'
import type { WorkspaceAdapter } from '../types'
import {
  asDirectoryHandle,
  type FakeDirectoryHandle,
  type FakeFileHandle,
  fakeRoot
} from './fakeFileSystem'

const text = (value: string) => new TextEncoder().encode(value)
const decode = (value: Uint8Array) => new TextDecoder().decode(value)

function namedError(name: string, message = name): Error {
  const error = new Error(message)
  error.name = name
  return error
}

function directoryAdapter(
  root: FakeDirectoryHandle,
  options: {
    checkPermission?: boolean
    now?: () => number
    backupExporter?: (adapter: WorkspaceAdapter) => Promise<Blob>
  } = {}
): DirectoryWorkspaceAdapter {
  return new DirectoryWorkspaceAdapter(asDirectoryHandle(root), {
    workspaceId: 'directory:coverage',
    ...options
  })
}

function patchCreatedFile(
  directory: FakeDirectoryHandle,
  targetName: string,
  configure: (file: FakeFileHandle) => void
): void {
  const original = directory.getFileHandle.bind(directory)
  let configured = false
  vi.spyOn(directory, 'getFileHandle').mockImplementation(async (name, options = {}) => {
    const handle = await original(name, options)
    if (name === targetName && options.create && !configured) {
      configured = true
      configure(directory.file(name))
    }
    return handle
  })
}

class DefaultHandleAdapter extends HandleWorkspaceAdapter {
  constructor(root: FakeDirectoryHandle) {
    super('directory', asDirectoryHandle(root), {
      id: 'default-handle:coverage',
      storage: {
        persistence: 'external-directory',
        portable: true,
        description: 'Coverage adapter.',
        capabilities: {
          multipleFiles: true,
          directories: true,
          rename: true,
          move: true,
          remove: true,
          backup: true
        }
      }
    })
  }
}

describe('HandleWorkspaceAdapter edge coverage', () => {
  it('uses base-class defaults and exposes its compatibility directory handle', async () => {
    const root = fakeRoot()
    root.permission = 'denied'
    root.addFile('readable.bpmn', 'ok')
    const adapter = new DefaultHandleAdapter(root)

    expect(adapter.directoryHandle).toBe(asDirectoryHandle(root))
    expect(decode((await adapter.read('readable.bpmn')).bytes)).toBe('ok')
  })

  it('isolates unreadable subtrees while preserving a root enumeration failure', async () => {
    const root = fakeRoot()
    root.addFile('healthy/process.xml', '<ok />', { type: '' })
    const isolated = root.addDirectory('isolated')
    isolated.failEnumeration = namedError('NotReadableError', 'subtree unavailable')
    const adapter = directoryAdapter(root)

    const entries = await adapter.list()
    expect(entries.find((entry) => entry.path === 'isolated')).toMatchObject({
      kind: 'directory',
      readable: false,
      issue: { code: 'storage-failure', operation: 'list', path: 'isolated' }
    })
    expect(entries.find((entry) => entry.path === 'healthy/process.xml')).toMatchObject({
      readable: true,
      mimeType: 'application/xml'
    })

    root.failEnumeration = namedError('NotReadableError', 'root unavailable')
    await expect(adapter.list()).rejects.toMatchObject({
      code: 'storage-failure',
      operation: 'list'
    })
  })

  it('distinguishes files, directories, absent entries, and unknown probe errors', async () => {
    const root = fakeRoot()
    root.addDirectory('folder')
    root.addFile('plain.bin', 'bytes', { type: '' })
    const adapter = directoryAdapter(root)

    await expect(adapter.read('folder')).rejects.toMatchObject({ code: 'not-a-file' })
    await expect(adapter.list('plain.bin')).rejects.toMatchObject({
      code: 'not-a-directory',
      path: 'plain.bin'
    })
    await expect(adapter.read('missing.bin')).rejects.toMatchObject({ code: 'not-found' })
    expect((await adapter.read('plain.bin')).mimeType).toBe('application/octet-stream')

    const guarded = fakeRoot()
    vi.spyOn(guarded, 'entries').mockImplementation(async function* () {
      // Model a handle whose enumeration is filtered while direct access is denied.
    })
    vi.spyOn(guarded, 'getFileHandle').mockRejectedValue(
      namedError('SecurityError', 'direct probe denied')
    )
    await expect(directoryAdapter(guarded).read('hidden.bpmn')).rejects.toMatchObject({
      name: 'SecurityError'
    })
  })

  it('handles prompt, absent permission APIs, and explicitly managed permission', async () => {
    const prompted = fakeRoot()
    prompted.permission = 'prompt'
    const promptedAdapter = directoryAdapter(prompted)
    await expect(promptedAdapter.list()).rejects.toMatchObject({
      code: 'permission-loss',
      message: expect.stringContaining('reconnected')
    })
    expect(await promptedAdapter.writeAtomic('new.bpmn', text('x'))).toMatchObject({
      status: 'permission-loss'
    })

    const apiLess = fakeRoot()
    apiLess.addFile('readable.bpmn', 'ok')
    Object.defineProperty(apiLess, 'queryPermission', {
      configurable: true,
      value: undefined
    })
    expect(decode((await directoryAdapter(apiLess).read('readable.bpmn')).bytes)).toBe('ok')

    const externallyManaged = fakeRoot()
    externallyManaged.permission = 'denied'
    externallyManaged.addFile('readable.bpmn', 'ok')
    expect(
      decode(
        (
          await directoryAdapter(externallyManaged, {
            checkPermission: false
          }).read('readable.bpmn')
        ).bytes
      )
    ).toBe('ok')
  })

  it('rejects contradictory preconditions and invalid write targets', async () => {
    const root = fakeRoot()
    root.addDirectory('folder')
    root.addFile('parent.bin', 'file')
    const adapter = directoryAdapter(root)

    expect(
      await adapter.writeAtomic('new.bpmn', text('x'), 'a'.repeat(64), {
        expectedMissing: true
      })
    ).toMatchObject({ status: 'storage-failure' })
    expect(await adapter.writeAtomic('folder', text('x'))).toMatchObject({
      status: 'storage-failure',
      error: { code: 'not-a-file' }
    })
    expect(await adapter.writeAtomic('parent.bin/child.bpmn', text('x'))).toMatchObject({
      status: 'storage-failure',
      error: { code: 'not-a-directory' }
    })
  })

  it('cancels after permission and after a writable has staged bytes', async () => {
    const permissionRoot = fakeRoot()
    const permissionController = new AbortController()
    vi.spyOn(permissionRoot, 'queryPermission').mockImplementation(async () => {
      permissionController.abort()
      return 'granted'
    })
    expect(
      await directoryAdapter(permissionRoot).writeAtomic('not-created.bpmn', text('x'), undefined, {
        signal: permissionController.signal
      })
    ).toMatchObject({ status: 'cancelled' })
    expect(permissionRoot.children.size).toBe(0)

    const writeRoot = fakeRoot()
    const file = writeRoot.addFile('existing.bpmn', 'safe')
    const writeController = new AbortController()
    const createWritable = file.createWritable.bind(file)
    vi.spyOn(file, 'createWritable').mockImplementation(async () => {
      const writable = await createWritable()
      const write = writable.write.bind(writable)
      return {
        ...writable,
        write: async (chunk: FileSystemWriteChunkType) => {
          await write(chunk)
          writeController.abort()
        }
      } as FileSystemWritableFileStream
    })
    expect(
      await directoryAdapter(writeRoot).writeAtomic('existing.bpmn', text('discarded'), undefined, {
        signal: writeController.signal
      })
    ).toMatchObject({ status: 'cancelled' })
    expect(decode(file.bytes)).toBe('safe')

    const createdRoot = fakeRoot()
    const createdController = new AbortController()
    patchCreatedFile(createdRoot, 'created.bpmn', (created) => {
      vi.spyOn(created, 'createWritable').mockResolvedValue({
        write: async () => {
          createdController.abort()
        },
        close: async () => undefined
      } as unknown as FileSystemWritableFileStream)
    })
    expect(
      await directoryAdapter(createdRoot).writeAtomic(
        'created.bpmn',
        text('discarded'),
        undefined,
        { signal: createdController.signal }
      )
    ).toMatchObject({ status: 'cancelled' })
    expect(createdRoot.children.has('created.bpmn')).toBe(false)
  })

  it('falls back to confirmed bytes when post-close metadata is temporarily unavailable', async () => {
    const root = fakeRoot()
    const file = root.addFile('process.json', 'old', {
      type: 'application/custom+json'
    })
    const createWritable = file.createWritable.bind(file)
    vi.spyOn(file, 'createWritable').mockImplementation(async () => {
      const writable = await createWritable()
      const close = writable.close.bind(writable)
      return {
        ...writable,
        close: async () => {
          await close()
          file.unreadable = true
        }
      } as FileSystemWritableFileStream
    })

    const outcome = await directoryAdapter(root, { now: () => 909 }).writeAtomic(
      'process.json',
      text('new')
    )
    expect(outcome).toMatchObject({
      ok: true,
      status: 'success',
      snapshot: {
        modifiedAt: 909,
        mimeType: 'application/custom+json'
      }
    })
    if (outcome.status === 'success') expect(decode(outcome.snapshot.bytes)).toBe('new')

    const createdRoot = fakeRoot()
    patchCreatedFile(createdRoot, 'created.json', (created) => {
      const createWritable = created.createWritable.bind(created)
      vi.spyOn(created, 'createWritable').mockImplementation(async () => {
        const writable = await createWritable()
        const close = writable.close.bind(writable)
        return {
          ...writable,
          close: async () => {
            await close()
            created.unreadable = true
          }
        } as FileSystemWritableFileStream
      })
    })
    expect(
      await directoryAdapter(createdRoot, { now: () => 910 }).writeAtomic(
        'created.json',
        text('{}')
      )
    ).toMatchObject({
      status: 'success',
      created: true,
      snapshot: { mimeType: 'application/json', modifiedAt: 910 }
    })
  })

  it('detects corrupt persistence and cleans a newly-created target', async () => {
    const root = fakeRoot()
    patchCreatedFile(root, 'corrupt.bpmn', (file) => {
      const createWritable = file.createWritable.bind(file)
      vi.spyOn(file, 'createWritable').mockImplementation(async () => {
        const writable = await createWritable()
        const close = writable.close.bind(writable)
        return {
          ...writable,
          close: async () => {
            await close()
            file.bytes = text('corrupted-on-disk')
          }
        } as FileSystemWritableFileStream
      })
    })

    expect(
      await directoryAdapter(root).writeAtomic('corrupt.bpmn', text('intended'))
    ).toMatchObject({
      status: 'storage-failure',
      error: { code: 'integrity-failure' }
    })
    expect(root.children.has('corrupt.bpmn')).toBe(false)
  })

  it('aborts failed writables and rolls back newly-created parent trees', async () => {
    const root = fakeRoot()
    const getDirectoryHandle = root.getDirectoryHandle.bind(root)
    vi.spyOn(root, 'getDirectoryHandle').mockImplementation(async (name, options = {}) => {
      const handle = await getDirectoryHandle(name, options)
      if (name === 'new-root' && options.create) {
        const created = root.directory('new-root')
        vi.spyOn(created, 'getDirectoryHandle').mockRejectedValueOnce(
          namedError('QuotaExceededError', 'directory quota')
        )
      }
      return handle
    })

    expect(
      await directoryAdapter(root).writeAtomic('new-root/deep/process.bpmn', text('x'))
    ).toMatchObject({
      status: 'storage-failure',
      error: { code: 'quota-exceeded' }
    })
    expect(root.children.has('new-root')).toBe(false)

    const abortRoot = fakeRoot()
    patchCreatedFile(abortRoot, 'fail.bpmn', (file) => {
      vi.spyOn(file, 'createWritable').mockResolvedValue({
        write: async () => {
          throw namedError('QuotaExceededError', 'write quota')
        },
        close: async () => undefined,
        abort: async () => {
          throw namedError('InvalidStateError', 'abort failed')
        }
      } as unknown as FileSystemWritableFileStream)
    })
    expect(await directoryAdapter(abortRoot).writeAtomic('fail.bpmn', text('x'))).toMatchObject({
      status: 'storage-failure',
      error: { code: 'quota-exceeded' }
    })
    expect(abortRoot.children.has('fail.bpmn')).toBe(false)

    const lateFailureRoot = fakeRoot()
    const getTopDirectory = lateFailureRoot.getDirectoryHandle.bind(lateFailureRoot)
    vi.spyOn(lateFailureRoot, 'getDirectoryHandle').mockImplementation(
      async (name, options = {}) => {
        const handle = await getTopDirectory(name, options)
        if (name === 'new-tree' && options.create) {
          const top = lateFailureRoot.directory('new-tree')
          const getNestedDirectory = top.getDirectoryHandle.bind(top)
          vi.spyOn(top, 'getDirectoryHandle').mockImplementation(
            async (nestedName, nestedOptions = {}) => {
              const nestedHandle = await getNestedDirectory(nestedName, nestedOptions)
              if (nestedName === 'deep' && nestedOptions.create) {
                patchCreatedFile(top.directory('deep'), 'late-fail.bpmn', (created) => {
                  vi.spyOn(created, 'createWritable').mockRejectedValue(
                    namedError('QuotaExceededError', 'late file quota')
                  )
                })
              }
              return nestedHandle
            }
          )
        }
        return handle
      }
    )
    expect(
      await directoryAdapter(lateFailureRoot).writeAtomic('new-tree/deep/late-fail.bpmn', text('x'))
    ).toMatchObject({ status: 'storage-failure' })
    expect(lateFailureRoot.children.has('new-tree')).toBe(false)
  })

  it('preserves the source and removes a copied destination when deletion fails', async () => {
    const root = fakeRoot()
    root.addFile('source.bpmn', 'source')
    root.addDirectory('archive')
    const removeEntry = root.removeEntry.bind(root)
    vi.spyOn(root, 'removeEntry').mockImplementation(async (name, options = {}) => {
      if (name === 'source.bpmn') throw namedError('NoModificationAllowedError')
      await removeEntry(name, options)
    })

    await expect(
      directoryAdapter(root).move('source.bpmn', 'archive/source.bpmn')
    ).rejects.toMatchObject({ code: 'storage-failure' })
    expect(decode(root.file('source.bpmn').bytes)).toBe('source')
    expect(root.directory('archive').children.has('source.bpmn')).toBe(false)
  })

  it('detects a source mutation during copy and rolls back the destination', async () => {
    const root = fakeRoot()
    const source = root.addFile('source.bpmn', 'original')
    root.addDirectory('archive')
    const getFile = source.getFile.bind(source)
    let reads = 0
    vi.spyOn(source, 'getFile').mockImplementation(async () => {
      reads += 1
      if (reads === 3) source.bytes = text('changed-externally')
      return getFile()
    })

    await expect(
      directoryAdapter(root).move('source.bpmn', 'archive/source.bpmn')
    ).rejects.toMatchObject({ code: 'integrity-failure' })
    expect(decode(root.file('source.bpmn').bytes)).toBe('changed-externally')
    expect(root.directory('archive').children.has('source.bpmn')).toBe(false)
  })

  it('rolls back file and directory copy failures without touching the source', async () => {
    const fileRoot = fakeRoot()
    fileRoot.addFile('source.bpmn', 'safe')
    const archive = fileRoot.addDirectory('archive')
    patchCreatedFile(archive, 'source.bpmn', (file) => {
      file.failNextClose = namedError('QuotaExceededError', 'copy quota')
    })
    await expect(
      directoryAdapter(fileRoot).move('source.bpmn', 'archive/source.bpmn')
    ).rejects.toMatchObject({ code: 'quota-exceeded' })
    expect(decode(fileRoot.file('source.bpmn').bytes)).toBe('safe')
    expect(archive.children.has('source.bpmn')).toBe(false)

    const directoryRoot = fakeRoot()
    const copiedFile = directoryRoot.addFile('source/child.bpmn', 'safe')
    directoryRoot.addDirectory('archive')
    const getFile = copiedFile.getFile.bind(copiedFile)
    let reads = 0
    vi.spyOn(copiedFile, 'getFile').mockImplementation(async () => {
      reads += 1
      if (reads === 2) throw namedError('NotReadableError', 'copy read failed')
      return getFile()
    })
    await expect(
      directoryAdapter(directoryRoot).move('source', 'archive/source')
    ).rejects.toMatchObject({ code: 'storage-failure' })
    expect(decode(directoryRoot.file('source/child.bpmn').bytes)).toBe('safe')
    expect(directoryRoot.directory('archive').children.has('source')).toBe(false)
  })

  it('supports fallback identity checks and skips occupied staging names', async () => {
    const root = fakeRoot({ caseInsensitive: true })
    const source = root.addFile('Order.bpmn', 'case-safe')
    root.addFile('Order.bpmn.__orbitpm_relocate__1', 'occupied')
    Object.defineProperty(source, 'isSameEntry', {
      configurable: true,
      value: undefined
    })

    await directoryAdapter(root).rename('Order.bpmn', 'order.bpmn')
    expect(decode(root.file('order.bpmn').bytes)).toBe('case-safe')
    expect([...root.children.keys()]).toEqual(['Order.bpmn.__orbitpm_relocate__1', 'order.bpmn'])
  })

  it('cleans the staging copy if a case-only source mutates before removal', async () => {
    const root = fakeRoot({ caseInsensitive: true })
    const source = root.addFile('Order.bpmn', 'original')
    const getFile = source.getFile.bind(source)
    let reads = 0
    vi.spyOn(source, 'getFile').mockImplementation(async () => {
      reads += 1
      if (reads === 3) source.bytes = text('changed')
      return getFile()
    })

    await expect(directoryAdapter(root).rename('Order.bpmn', 'order.bpmn')).rejects.toMatchObject({
      code: 'integrity-failure'
    })
    expect(decode(root.file('Order.bpmn').bytes)).toBe('changed')
    expect([...root.children.keys()].some((name) => name.includes('__orbitpm_relocate__'))).toBe(
      false
    )
  })

  it('restores the original name if the final case-only copy fails', async () => {
    const root = fakeRoot({ caseInsensitive: true })
    root.addFile('Order.bpmn', 'recover-me')
    const getFileHandle = root.getFileHandle.bind(root)
    let injected = false
    vi.spyOn(root, 'getFileHandle').mockImplementation(async (name, options = {}) => {
      const handle = await getFileHandle(name, options)
      if (name === 'order.bpmn' && options.create && !injected) {
        injected = true
        root.file(name).failNextClose = namedError('QuotaExceededError', 'rename quota')
      }
      return handle
    })

    await expect(directoryAdapter(root).rename('Order.bpmn', 'order.bpmn')).rejects.toMatchObject({
      code: 'quota-exceeded'
    })
    expect(decode(root.file('Order.bpmn').bytes)).toBe('recover-me')
    expect([...root.children.keys()]).toEqual(['Order.bpmn'])
  })

  it('keeps a recovery staging copy when restoration also fails', async () => {
    const root = fakeRoot({ caseInsensitive: true })
    root.addFile('Order.bpmn', 'recover-me')
    const getFileHandle = root.getFileHandle.bind(root)
    let destinationFailure = false
    let restorationFailure = false
    vi.spyOn(root, 'getFileHandle').mockImplementation(async (name, options = {}) => {
      const handle = await getFileHandle(name, options)
      if (name === 'order.bpmn' && options.create && !destinationFailure) {
        destinationFailure = true
        root.file(name).failNextClose = namedError('QuotaExceededError', 'final copy failed')
      } else if (name === 'Order.bpmn' && options.create && !restorationFailure) {
        restorationFailure = true
        root.file(name).failNextClose = namedError('QuotaExceededError', 'restoration failed')
      }
      return handle
    })

    await expect(directoryAdapter(root).rename('Order.bpmn', 'order.bpmn')).rejects.toMatchObject({
      code: 'quota-exceeded'
    })
    const stagingName = [...root.children.keys()].find((name) =>
      name.includes('__orbitpm_relocate__')
    )
    expect(stagingName).toBeDefined()
    expect(decode(root.file(stagingName!).bytes)).toBe('recover-me')
  })

  it('handles an externally removed staging copy after the source removal', async () => {
    const root = fakeRoot({ caseInsensitive: true })
    root.addFile('Order.bpmn', 'external-race')
    const removeEntry = root.removeEntry.bind(root)
    vi.spyOn(root, 'removeEntry').mockImplementation(async (name, options = {}) => {
      await removeEntry(name, options)
      if (name === 'Order.bpmn') {
        const stagingName = [...root.children.keys()].find((entryName) =>
          entryName.includes('__orbitpm_relocate__')
        )
        if (stagingName) root.children.delete(stagingName)
      }
    })

    await expect(directoryAdapter(root).rename('Order.bpmn', 'order.bpmn')).rejects.toMatchObject({
      code: 'not-found'
    })
    expect(root.children.size).toBe(0)
  })

  it('refuses a case-only rename when all recovery staging names are occupied', async () => {
    const root = fakeRoot({ caseInsensitive: true })
    root.addFile('Order.bpmn', 'source')
    for (let index = 1; index <= 1000; index += 1) {
      root.addFile(`Order.bpmn.__orbitpm_relocate__${index}`, `staging-${index}`)
    }

    await expect(directoryAdapter(root).rename('Order.bpmn', 'order.bpmn')).rejects.toMatchObject({
      code: 'storage-failure',
      message: expect.stringContaining('temporary relocation name')
    })
    expect(decode(root.file('Order.bpmn').bytes)).toBe('source')
  })

  it('covers internal create resolution used by handle-backed folder operations', async () => {
    const root = fakeRoot()
    root.addDirectory('existing')
    root.addFile('blocking.bin', 'file')
    const adapter = directoryAdapter(root)
    const internal = adapter as unknown as {
      resolveDirectory(
        path: string,
        create: boolean,
        operation: 'create-folder'
      ): Promise<FileSystemDirectoryHandle>
      createDirectoryTree(
        path: string,
        operation: 'create-folder'
      ): Promise<{ directory: FileSystemDirectoryHandle }>
    }

    expect(await internal.resolveDirectory('', true, 'create-folder')).toBe(asDirectoryHandle(root))
    await internal.resolveDirectory('existing/created', true, 'create-folder')
    expect(root.directory('existing/created')).toBeDefined()
    await expect(
      internal.resolveDirectory('blocking.bin/child', true, 'create-folder')
    ).rejects.toMatchObject({ code: 'already-exists' })
    expect((await internal.createDirectoryTree('', 'create-folder')).directory).toBe(
      asDirectoryHandle(root)
    )
    await adapter.createFolder('existing/another')
    await expect(adapter.createFolder('blocking.bin/child')).rejects.toMatchObject({
      code: 'already-exists'
    })
  })

  it('normalizes missing file metadata and exercises directory direct probes and ordering', async () => {
    const metadataRoot = fakeRoot()
    const metadataFile = metadataRoot.addFile('payload.data', 'payload', { type: '' })
    vi.spyOn(metadataFile, 'getFile').mockResolvedValue({
      name: 'payload.data',
      size: metadataFile.bytes.byteLength,
      type: '',
      lastModified: undefined,
      arrayBuffer: async () => metadataFile.bytes.slice().buffer
    } as unknown as File)
    expect(await directoryAdapter(metadataRoot).read('payload.data')).toMatchObject({
      modifiedAt: 0,
      mimeType: 'application/octet-stream'
    })

    const caseRoot = fakeRoot({ caseInsensitive: true })
    caseRoot.addDirectory('Folder')
    expect(await directoryAdapter(caseRoot).list('folder')).toEqual([])

    const fileFirst = fakeRoot()
    fileFirst.addFile('z.bpmn', 'file')
    fileFirst.addDirectory('a-folder')
    expect((await directoryAdapter(fileFirst).list()).map((entry) => entry.path)).toEqual([
      'a-folder',
      'z.bpmn'
    ])
    const folderFirst = fakeRoot()
    folderFirst.addDirectory('z-folder')
    folderFirst.addFile('a.bpmn', 'file')
    expect((await directoryAdapter(folderFirst).list()).map((entry) => entry.path)).toEqual([
      'z-folder',
      'a.bpmn'
    ])
  })

  it('maps an aborted writable to cancellation', async () => {
    const root = fakeRoot()
    patchCreatedFile(root, 'aborted.bpmn', (file) => {
      vi.spyOn(file, 'createWritable').mockResolvedValue({
        write: async () => {
          throw namedError('AbortError', 'browser aborted the stream')
        },
        close: async () => undefined,
        abort: async () => undefined
      } as unknown as FileSystemWritableFileStream)
    })
    expect(await directoryAdapter(root).writeAtomic('aborted.bpmn', text('x'))).toMatchObject({
      status: 'cancelled'
    })
  })

  it('rejects collisions, missing parents, no-op moves, and delete failures', async () => {
    const root = fakeRoot()
    root.addFile('source.bpmn', 'source')
    root.addFile('taken.bpmn', 'taken')
    const adapter = directoryAdapter(root)

    await adapter.move('source.bpmn', 'source.bpmn')
    await expect(adapter.move('source.bpmn', 'missing/source.bpmn')).rejects.toMatchObject({
      code: 'not-found'
    })
    await expect(adapter.rename('source.bpmn', 'taken.bpmn')).rejects.toMatchObject({
      code: 'already-exists'
    })

    const removeEntry = root.removeEntry.bind(root)
    vi.spyOn(root, 'removeEntry').mockImplementation(async (name, options = {}) => {
      if (name === 'source.bpmn') throw namedError('QuotaExceededError', 'delete quota')
      await removeEntry(name, options)
    })
    await expect(adapter.remove('source.bpmn')).rejects.toMatchObject({
      name: 'QuotaExceededError'
    })
  })

  it('uses explicit backup exporters and passes through the workspace', async () => {
    const root = fakeRoot()
    const backupExporter = vi.fn(async (adapter: WorkspaceAdapter) => {
      expect(adapter.id).toBe('directory:coverage')
      return new Blob(['backup'], { type: 'application/zip' })
    })
    const blob = await directoryAdapter(root, { backupExporter }).exportBackup()
    expect(await blob.text()).toBe('backup')
    expect(backupExporter).toHaveBeenCalledOnce()
  })
})

describe('MemoryWorkspaceAdapter edge coverage', () => {
  it('accepts binary seed arrays with explicit metadata and covers listing errors', async () => {
    const adapter = new MemoryWorkspaceAdapter({
      id: 'memory:array',
      folders: ['folder', 'empty'],
      files: [
        {
          path: 'folder/process.xml',
          bytes: new Uint8Array([0, 1, 255]),
          modifiedAt: 77,
          mimeType: 'application/custom+xml'
        }
      ]
    })

    expect(await adapter.read('folder/process.xml')).toMatchObject({
      size: 3,
      modifiedAt: 77,
      mimeType: 'application/custom+xml'
    })
    await expect(adapter.list('missing')).rejects.toMatchObject({ code: 'not-found' })
    await expect(adapter.list('folder/process.xml')).rejects.toMatchObject({
      code: 'not-a-directory'
    })
    await expect(adapter.read('folder')).rejects.toMatchObject({ code: 'not-a-file' })

    adapter.replaceExternally('folder/process.xml', new Uint8Array([8, 9]))
    expect([...(await adapter.read('folder/process.xml')).bytes]).toEqual([8, 9])
    adapter.removeExternally('folder')
    expect((await adapter.list()).some((entry) => entry.path.startsWith('folder'))).toBe(false)
  })

  it('maps contradictory conditions, write hooks, aborts, and directory targets', async () => {
    const contradictory = new MemoryWorkspaceAdapter()
    expect(
      await contradictory.writeAtomic('new.bpmn', text('x'), 'a'.repeat(64), {
        expectedMissing: true
      })
    ).toMatchObject({ status: 'storage-failure' })

    const controller = new AbortController()
    const cancelled = new MemoryWorkspaceAdapter({
      beforeWrite: () => controller.abort()
    })
    expect(
      await cancelled.writeAtomic('new.bpmn', text('x'), undefined, {
        signal: controller.signal
      })
    ).toMatchObject({ status: 'cancelled' })

    const abortFailure = new MemoryWorkspaceAdapter({
      beforeWrite: () => {
        throw namedError('AbortError', 'hook cancelled')
      }
    })
    expect(await abortFailure.writeAtomic('new.bpmn', text('x'))).toMatchObject({
      status: 'cancelled'
    })

    const genericFailure = new MemoryWorkspaceAdapter({
      beforeWrite: () => {
        throw new Error('hook failed')
      }
    })
    expect(await genericFailure.writeAtomic('new.bpmn', text('x'))).toMatchObject({
      status: 'storage-failure'
    })

    const directoryTarget = new MemoryWorkspaceAdapter({ folders: ['folder'] })
    expect(await directoryTarget.writeAtomic('folder', text('x'))).toMatchObject({
      status: 'storage-failure',
      error: { code: 'not-a-file' }
    })
  })

  it('guards all relocation parent and collision boundaries', async () => {
    const adapter = new MemoryWorkspaceAdapter({
      folders: ['folder'],
      files: {
        'source.bpmn': 'source',
        'taken.bpmn': 'taken',
        'parent.bin': 'parent',
        'folder/child.bpmn': 'moving child'
      }
    })

    await adapter.move('source.bpmn', 'source.bpmn')
    await expect(adapter.move('missing.bpmn', 'other.bpmn')).rejects.toMatchObject({
      code: 'not-found'
    })
    await expect(adapter.move('source.bpmn', 'missing/child.bpmn')).rejects.toMatchObject({
      code: 'not-found',
      path: 'missing'
    })
    await expect(adapter.move('source.bpmn', 'parent.bin/child.bpmn')).rejects.toMatchObject({
      code: 'not-a-directory'
    })
    await expect(adapter.rename('source.bpmn', 'taken.bpmn')).rejects.toMatchObject({
      code: 'already-exists'
    })

    type PrivateMemoryNode = {
      kind: 'file'
      bytes: Uint8Array
      modifiedAt: number
      mimeType?: string
    }
    const internal = adapter as unknown as { nodes: Map<string, PrivateMemoryNode> }
    internal.nodes.set('orphan/child.bpmn', {
      kind: 'file',
      bytes: text('orphan collision'),
      modifiedAt: 1
    })
    await expect(adapter.move('folder', 'orphan')).rejects.toMatchObject({
      code: 'already-exists',
      path: 'orphan/child.bpmn'
    })
  })

  it('covers folder idempotence, collisions, missing deletes, and revoked permission', async () => {
    const adapter = new MemoryWorkspaceAdapter({
      folders: ['existing'],
      files: { 'file.bin': 'file' }
    })
    await adapter.createFolder('existing/nested')
    await adapter.createFolder('existing/nested')
    await expect(adapter.createFolder('file.bin/child')).rejects.toMatchObject({
      code: 'already-exists'
    })
    await expect(adapter.remove('missing')).rejects.toMatchObject({ code: 'not-found' })

    adapter.setPermission('denied')
    await expect(adapter.list()).rejects.toMatchObject({ code: 'permission-loss' })
    await expect(adapter.read('file.bin')).rejects.toMatchObject({ code: 'permission-loss' })
    expect(() => adapter.replaceExternally('file.bin', 'x')).toThrow(/permission/)
    await expect(adapter.rename('file.bin', 'renamed.bin')).rejects.toMatchObject({
      code: 'permission-loss'
    })
    await expect(adapter.remove('file.bin')).rejects.toMatchObject({
      code: 'permission-loss'
    })
    await expect(adapter.createFolder('blocked')).rejects.toMatchObject({
      code: 'permission-loss'
    })
  })

  it('infers JSON and binary MIME types and uses a custom backup exporter', async () => {
    const backupExporter = vi.fn(async () => new Blob(['memory-backup']))
    const adapter = new MemoryWorkspaceAdapter({ backupExporter })
    const json = await adapter.writeAtomic('manifest.json', text('{}'))
    const binary = await adapter.writeAtomic('payload.data', new Uint8Array([1]))
    expect(json).toMatchObject({
      status: 'success',
      snapshot: { mimeType: 'application/json' }
    })
    expect(binary).toMatchObject({
      status: 'success',
      snapshot: { mimeType: 'application/octet-stream' }
    })
    expect(await (await adapter.exportBackup()).text()).toBe('memory-backup')
    expect(backupExporter).toHaveBeenCalledOnce()
  })

  it('rejects contradictory constructor seeds', () => {
    expect(
      () =>
        new MemoryWorkspaceAdapter({
          folders: ['collision'],
          files: [{ path: 'collision', bytes: 'file' }]
        })
    ).toThrow(/over a directory/)
    expect(
      () =>
        new MemoryWorkspaceAdapter({
          folders: ['file', 'file/child'],
          files: { file: 'file' }
        })
    ).toThrow(/over a directory/)
  })

  it('returns storage failures when Web Crypto is unavailable', async () => {
    const originalCrypto = globalThis.crypto
    vi.stubGlobal('crypto', undefined)
    try {
      expect(
        await new MemoryWorkspaceAdapter().writeAtomic('no-crypto.bpmn', text('x'))
      ).toMatchObject({ status: 'storage-failure' })
      expect(
        await directoryAdapter(fakeRoot()).writeAtomic('no-crypto.bpmn', text('x'))
      ).toMatchObject({ status: 'storage-failure' })
    } finally {
      vi.stubGlobal('crypto', originalCrypto)
    }
  })
})
