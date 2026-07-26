import { describe, expect, it } from 'vitest'
import { MemoryWorkspaceAdapter, type WorkspaceAdapter, type WorkspaceEntry } from './adapters'
import { snapshotAdapterWorkspace } from './adapterSnapshot'

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
})
