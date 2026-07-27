import { describe, expect, it } from 'vitest'
import type { LiteTreeNode } from '../fs/fsAccess'
import {
  MemoryWorkspaceAdapter,
  type FileSnapshot,
  type ReadFileOptions,
  type WorkspaceAdapter,
  type WorkspaceEntry
} from './adapters'
import {
  applyCommittedWorkspaceProjectionDelta,
  snapshotAdapterWorkspace,
  type AdapterWorkspaceTreeSnapshot
} from './adapterSnapshot'
import { LiveWorkspaceIndex } from './liveWorkspaceIndex'

function adapterWithRead(
  memory: MemoryWorkspaceAdapter,
  read: (path: string, options?: ReadFileOptions) => Promise<FileSnapshot>
): WorkspaceAdapter {
  return {
    id: memory.id,
    mode: memory.mode,
    storage: memory.storage,
    list: (...args) => memory.list(...args),
    read,
    writeAtomic: (...args) => memory.writeAtomic(...args),
    rename: (...args) => memory.rename(...args),
    move: (...args) => memory.move(...args),
    remove: (...args) => memory.remove(...args),
    removeIfHash: (...args) => memory.removeIfHash(...args),
    removeEmptyFolder: (...args) => memory.removeEmptyFolder(...args),
    createFolder: (...args) => memory.createFolder(...args),
    exportBackup: (...args) => memory.exportBackup(...args)
  }
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
  }
  throw new Error('Timed out waiting for the scan test condition.')
}

function treePaths(tree: LiteTreeNode): string[] {
  const paths: string[] = []
  const pending = [...(tree.children ?? [])]
  while (pending.length > 0) {
    const node = pending.pop()!
    paths.push(node.relPath)
    pending.push(...(node.children ?? []))
  }
  return paths.sort((left, right) => left.localeCompare(right, 'en-US'))
}

describe('snapshotAdapterWorkspace', () => {
  it('builds a sorted multi-folder tree and loads only BPMN files', async () => {
    const adapter = new MemoryWorkspaceAdapter({
      folders: ['z-empty', 'sales/intake'],
      files: {
        'sales/intake/order.bpmn': '<definitions />',
        'sales/notes.txt': 'private notes',
        'root.bpmn': '<root />'
      }
    })

    const snapshot = await snapshotAdapterWorkspace(adapter, 'Private workspace')
    expect(snapshot.files.map((file) => file.relPath)).toEqual([
      'root.bpmn',
      'sales/intake/order.bpmn'
    ])
    expect(snapshot.tree.children?.map((node) => [node.name, node.type])).toEqual([
      ['sales', 'directory'],
      ['z-empty', 'directory'],
      ['root.bpmn', 'file']
    ])
    expect(snapshot.issues).toEqual([])
  })

  it('isolates listing and read-time file failures', async () => {
    const memory = new MemoryWorkspaceAdapter({
      files: {
        'good.bpmn': '<good />',
        'listed-bad.bpmn': '<bad />',
        'read-bad.bpmn': '<bad />'
      }
    })
    const adapter: WorkspaceAdapter = {
      ...memory,
      id: memory.id,
      mode: memory.mode,
      storage: memory.storage,
      list: async (): Promise<WorkspaceEntry[]> =>
        (await memory.list()).map((entry) =>
          entry.path === 'listed-bad.bpmn'
            ? {
                ...entry,
                readable: false,
                issue: {
                  code: 'permission-loss',
                  operation: 'read',
                  path: entry.path,
                  message: 'Access revoked'
                }
              }
            : entry
        ),
      read: async (path) => {
        if (path === 'read-bad.bpmn') throw new Error('Device failed')
        return memory.read(path)
      },
      writeAtomic: (...args) => memory.writeAtomic(...args),
      rename: (...args) => memory.rename(...args),
      move: (...args) => memory.move(...args),
      remove: (...args) => memory.remove(...args),
      createFolder: (...args) => memory.createFolder(...args),
      exportBackup: (...args) => memory.exportBackup(...args)
    }

    const snapshot = await snapshotAdapterWorkspace(adapter, 'Workspace', {
      readConcurrency: 2
    })
    expect(snapshot.files.map((file) => file.relPath)).toEqual(['good.bpmn'])
    expect(snapshot.issues).toEqual([
      expect.objectContaining({
        code: 'permission-loss',
        path: 'listed-bad.bpmn'
      }),
      expect.objectContaining({
        code: 'storage-failure',
        path: 'read-bad.bpmn'
      })
    ])
    expect(snapshot.tree.children?.map((node) => node.name)).toEqual([
      'good.bpmn',
      'listed-bad.bpmn',
      'read-bad.bpmn'
    ])
  })

  it('isolates a BPMN file whose bytes are not valid UTF-8', async () => {
    const memory = new MemoryWorkspaceAdapter({
      files: {
        'good.bpmn': '<good />',
        'broken.bpmn': '<placeholder />'
      }
    })
    const adapter: WorkspaceAdapter = {
      ...memory,
      id: memory.id,
      mode: memory.mode,
      storage: memory.storage,
      list: (...args) => memory.list(...args),
      read: async (path) => {
        const snapshot = await memory.read(path)
        return path === 'broken.bpmn'
          ? {
              ...snapshot,
              bytes: new Uint8Array([0x3c, 0xff, 0x3e]),
              size: 3
            }
          : snapshot
      },
      writeAtomic: (...args) => memory.writeAtomic(...args),
      rename: (...args) => memory.rename(...args),
      move: (...args) => memory.move(...args),
      remove: (...args) => memory.remove(...args),
      createFolder: (...args) => memory.createFolder(...args),
      exportBackup: (...args) => memory.exportBackup(...args)
    }

    const snapshot = await snapshotAdapterWorkspace(adapter, 'Workspace')

    expect(snapshot.files.map((file) => file.relPath)).toEqual(['good.bpmn'])
    expect(snapshot.issues).toEqual([
      expect.objectContaining({
        code: 'invalid-encoding',
        operation: 'read',
        path: 'broken.bpmn',
        message: 'could not decode'
      })
    ])
    expect(snapshot.tree.children?.map((node) => node.name)).toEqual(['broken.bpmn', 'good.bpmn'])
  })

  it('keeps portable history internals out of the user tree and index', async () => {
    const adapter = new MemoryWorkspaceAdapter({
      files: {
        'current.bpmn': '<definitions id="current"/>',
        '.orbitpm/history/abc/2026-01-01-revision.bpmn': '<definitions id="old"/>',
        '.orbitpm/history/abc/2026-01-01-revision.json': '{"path":"current.bpmn"}'
      }
    })

    const snapshot = await snapshotAdapterWorkspace(adapter, 'Workspace')

    expect(snapshot.files.map((file) => file.relPath)).toEqual(['current.bpmn'])
    expect(snapshot.tree.children?.map((node) => node.relPath)).toEqual(['current.bpmn'])
  })

  it('rejects oversized metadata before invoking adapter.read and isolates the file', async () => {
    const memory = new MemoryWorkspaceAdapter({
      files: {
        'small.bpmn': '<ok/>',
        'oversized.bpmn': '<definitions id="too-large"/>'
      }
    })
    const reads: string[] = []
    const adapter = adapterWithRead(memory, async (path, options) => {
      reads.push(path)
      return memory.read(path, options)
    })

    const snapshot = await snapshotAdapterWorkspace(adapter, 'Workspace', {
      limits: {
        maxFiles: 10,
        maxFileBytes: 8,
        maxTotalBytes: 32
      }
    })

    expect(reads).toEqual(['small.bpmn'])
    expect(snapshot.files.map((file) => file.relPath)).toEqual(['small.bpmn'])
    expect(snapshot.issues).toEqual([
      expect.objectContaining({
        code: 'storage-failure',
        path: 'oversized.bpmn',
        message: expect.stringContaining('per-file scan limit is 8 bytes')
      })
    ])
  })

  it('enforces file-count and aggregate ceilings with path-specific diagnostics', async () => {
    const memory = new MemoryWorkspaceAdapter({
      files: {
        'a.bpmn': '123456',
        'b.bpmn': '123456',
        'c.bpmn': '123456',
        'd.bpmn': '123456'
      }
    })
    const reads: string[] = []
    const adapter = adapterWithRead(memory, async (path, options) => {
      reads.push(path)
      return memory.read(path, options)
    })

    const snapshot = await snapshotAdapterWorkspace(adapter, 'Workspace', {
      limits: {
        maxFiles: 3,
        maxFileBytes: 10,
        maxTotalBytes: 10
      }
    })

    expect(reads).toEqual(['a.bpmn'])
    expect(snapshot.files.map((file) => file.relPath)).toEqual(['a.bpmn'])
    expect(snapshot.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operation: 'list',
          message: expect.stringContaining('4 BPMN files; the scan limit is 3')
        }),
        expect.objectContaining({
          path: 'b.bpmn',
          message: expect.stringContaining('aggregate scan limit is 10 bytes')
        }),
        expect.objectContaining({
          path: 'c.bpmn',
          message: expect.stringContaining('aggregate scan limit is 10 bytes')
        })
      ])
    )
  })

  it('selects the same bounded files from an unsorted conforming listing', async () => {
    const memory = new MemoryWorkspaceAdapter({
      files: {
        'a.bpmn': 'a',
        'b.bpmn': 'b',
        'c.bpmn': 'c'
      }
    })
    const reads: string[] = []
    const base = adapterWithRead(memory, async (path, options) => {
      reads.push(path)
      return memory.read(path, options)
    })
    const adapter: WorkspaceAdapter = {
      ...base,
      list: async (...args) => (await memory.list(...args)).reverse()
    }

    const snapshot = await snapshotAdapterWorkspace(adapter, 'Workspace', {
      limits: {
        maxFiles: 2
      }
    })

    expect(reads).toEqual(['a.bpmn', 'b.bpmn'])
    expect(snapshot.files.map((file) => file.relPath)).toEqual(['a.bpmn', 'b.bpmn'])
  })

  it('rejects an adapter that returns more entries than the recursive listing ceiling', async () => {
    const memory = new MemoryWorkspaceAdapter({
      files: {
        'a.txt': 'a',
        'b.txt': 'b',
        'c.txt': 'c',
        'd.bpmn': 'd'
      }
    })
    let reads = 0
    const base = adapterWithRead(memory, async (...args) => {
      reads += 1
      return memory.read(...args)
    })
    const adapter: WorkspaceAdapter = {
      ...base,
      // Deliberately ignore options to model a third-party adapter. The scan
      // still verifies the returned boundary before building the tree.
      list: () => memory.list()
    }

    await expect(
      snapshotAdapterWorkspace(adapter, 'Workspace', {
        limits: { maxEntries: 3 }
      })
    ).rejects.toMatchObject({
      name: 'WorkspaceListLimitError',
      operation: 'list',
      dimension: 'entries',
      limit: 3
    })
    expect(reads).toBe(0)
  })

  it('propagates cancellation and never starts more than the bounded worker count', async () => {
    const memory = new MemoryWorkspaceAdapter({
      files: Object.fromEntries(
        Array.from({ length: 12 }, (_, index) => [
          `process-${String(index).padStart(2, '0')}.bpmn`,
          `<definitions id="${index}"/>`
        ])
      )
    })
    const started: string[] = []
    const adapter = adapterWithRead(
      memory,
      (path, options) =>
        new Promise<FileSnapshot>((_resolve, reject) => {
          started.push(path)
          const rejectAbort = (): void =>
            reject(options?.signal?.reason ?? new DOMException('cancelled', 'AbortError'))
          if (options?.signal?.aborted) rejectAbort()
          else options?.signal?.addEventListener('abort', rejectAbort, { once: true })
        })
    )
    const controller = new AbortController()
    const pending = snapshotAdapterWorkspace(adapter, 'Workspace', {
      readConcurrency: 3,
      signal: controller.signal
    })

    await waitFor(() => started.length === 3)
    controller.abort('superseded')

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(started).toHaveLength(3)
  })

  it('propagates cancellation into listing and normalizes arbitrary abort reasons', async () => {
    const memory = new MemoryWorkspaceAdapter()
    let receivedSignal: AbortSignal | undefined
    const base = adapterWithRead(memory, (...args) => memory.read(...args))
    const adapter: WorkspaceAdapter = {
      ...base,
      list: (_path, options) =>
        new Promise<WorkspaceEntry[]>((_resolve, reject) => {
          receivedSignal = options?.signal
          const rejectAbort = (): void => reject(options?.signal?.reason)
          if (options?.signal?.aborted) rejectAbort()
          else options?.signal?.addEventListener('abort', rejectAbort, { once: true })
        })
    }
    const controller = new AbortController()
    const pending = snapshotAdapterWorkspace(adapter, 'Workspace', {
      signal: controller.signal
    })

    expect(receivedSignal).toBe(controller.signal)
    controller.abort('replace scan')

    await expect(pending).rejects.toMatchObject({
      name: 'AbortError',
      message: 'replace scan'
    })
  })

  it('applies exact create, relocate, and remove projection deltas', async () => {
    const adapter = new MemoryWorkspaceAdapter({
      folders: ['archive', 'empty'],
      files: {
        'source/one.bpmn': '<one/>',
        'source/nested/two.bpmn': '<two/>'
      }
    })
    const activated = await snapshotAdapterWorkspace(adapter, 'Workspace')
    const initial: AdapterWorkspaceTreeSnapshot = {
      tree: activated.tree,
      issues: activated.issues
    }

    const created = applyCommittedWorkspaceProjectionDelta(initial, {
      kind: 'upsert-bpmn',
      path: 'created/deep/new.bpmn'
    })
    expect(created).not.toBeNull()
    expect(treePaths(created!.tree)).toContain('created/deep/new.bpmn')

    const withDirectory = applyCommittedWorkspaceProjectionDelta(created!, {
      kind: 'create-directory',
      path: 'created/empty'
    })
    expect(treePaths(withDirectory!.tree)).toContain('created/empty')

    const relocated = applyCommittedWorkspaceProjectionDelta(withDirectory!, {
      kind: 'relocate',
      from: 'source',
      to: 'archive/source',
      entryKind: 'directory'
    })
    expect(relocated).not.toBeNull()
    expect(treePaths(relocated!.tree)).toEqual(
      expect.arrayContaining(['archive/source/one.bpmn', 'archive/source/nested/two.bpmn'])
    )
    expect(treePaths(relocated!.tree)).not.toContain('source/one.bpmn')

    const removed = applyCommittedWorkspaceProjectionDelta(relocated!, {
      kind: 'remove',
      path: 'archive/source',
      entryKind: 'directory'
    })
    expect(removed).not.toBeNull()
    expect(treePaths(removed!.tree).some((path) => path.startsWith('archive/source'))).toBe(false)
  })

  it('falls back on collisions, ambiguous diagnostics, inconsistent trees, and invalid no-ops', async () => {
    const adapter = new MemoryWorkspaceAdapter({
      files: {
        'a/one.bpmn': '<one/>',
        'b/taken.bpmn': '<taken/>'
      }
    })
    const activated = await snapshotAdapterWorkspace(adapter, 'Workspace')
    const initial: AdapterWorkspaceTreeSnapshot = {
      tree: activated.tree,
      issues: []
    }

    expect(
      applyCommittedWorkspaceProjectionDelta(initial, {
        kind: 'relocate',
        from: 'a/one.bpmn',
        to: 'b/taken.bpmn',
        entryKind: 'file'
      })
    ).toBeNull()
    expect(
      applyCommittedWorkspaceProjectionDelta(
        {
          ...initial,
          issues: [
            {
              code: 'permission-loss',
              operation: 'read',
              path: 'a',
              message: 'The source directory is unreadable.'
            }
          ]
        },
        {
          kind: 'relocate',
          from: 'a',
          to: 'archive/a',
          entryKind: 'directory'
        }
      )
    ).toBeNull()
    expect(
      applyCommittedWorkspaceProjectionDelta(initial, {
        kind: 'relocate',
        from: 'missing.bpmn',
        to: 'missing.bpmn',
        entryKind: 'file'
      })
    ).toBeNull()
    expect(
      applyCommittedWorkspaceProjectionDelta(initial, {
        kind: 'relocate',
        from: 'a',
        to: 'a',
        entryKind: 'file'
      })
    ).toBeNull()
    expect(
      applyCommittedWorkspaceProjectionDelta(initial, {
        kind: 'relocate',
        from: 'a',
        to: 'a',
        entryKind: 'directory'
      })
    ).not.toBeNull()

    const inconsistent: AdapterWorkspaceTreeSnapshot = {
      tree: {
        name: 'Workspace',
        relPath: '',
        type: 'directory',
        children: [
          {
            name: 'wrong.bpmn',
            relPath: 'different.bpmn',
            type: 'file'
          }
        ]
      },
      issues: []
    }
    expect(
      applyCommittedWorkspaceProjectionDelta(inconsistent, {
        kind: 'upsert-bpmn',
        path: 'new.bpmn'
      })
    ).toBeNull()
  })

  it('activates 1,000 adapter-backed BPMNs once and applies one exact commit without rereads', async () => {
    const files = Object.fromEntries(
      Array.from({ length: 1_000 }, (_, index) => [
        `team/process-${String(index).padStart(4, '0')}.bpmn`,
        `<definitions id="Definitions_${index}"/>`
      ])
    )
    const memory = new MemoryWorkspaceAdapter({ files })
    let reads = 0
    const adapter = adapterWithRead(memory, async (path, options) => {
      reads += 1
      return memory.read(path, options)
    })

    const startedAt = performance.now()
    const activated = await snapshotAdapterWorkspace(adapter, 'Workspace')
    const activationMilliseconds = performance.now() - startedAt
    expect(activated.files).toHaveLength(1_000)
    expect(reads).toBe(1_000)
    expect(activationMilliseconds).toBeLessThan(10_000)

    const write = await memory.writeAtomic(
      'team/process-1000.bpmn',
      new TextEncoder().encode('<definitions id="Definitions_updated"/>')
    )
    if (write.status !== 'success') throw new Error(`Unexpected write status: ${write.status}`)
    const index = new LiveWorkspaceIndex(activated.files)
    index.updateSaved({
      relPath: write.snapshot.path,
      xml: new TextDecoder().decode(write.snapshot.bytes),
      lastModified: write.snapshot.modifiedAt,
      size: write.snapshot.size
    })
    const incrementallyRefreshed = applyCommittedWorkspaceProjectionDelta(
      { tree: activated.tree, issues: activated.issues },
      { kind: 'upsert-bpmn', path: write.snapshot.path }
    )

    expect(incrementallyRefreshed).not.toBeNull()
    expect(incrementallyRefreshed!.tree.children?.[0]?.children).toHaveLength(1_001)
    expect(index.files()).toHaveLength(1_001)
    expect(index.files().at(-1)?.xml).toContain('Definitions_updated')
    expect(reads).toBe(1_000)
  }, 15_000)
})
