import { describe, expect, it } from 'vitest'
import {
  MemoryWorkspaceAdapter,
  WorkspaceOperationError,
  type WorkspaceAdapter
} from '../workspace/adapters'
import { PortableHistoryManager } from '../workspace/history/historyManager'
import {
  PATH_TRANSACTION_STAGING_ROOT,
  createAdapterPathMutation,
  mutateAdapterPath
} from './adapterPathMutations'
import {
  confirmPathDelete,
  executePathTransaction,
  planPathTransaction,
  resolveDirtyPathDecision,
  type PathTransactionPlan
} from './pathTransactions'
import { DocumentSessionStore } from './store'
import type { DocumentIdentity } from './types'

const workspace = { id: 'workspace-uuid', generation: 1, mode: 'directory' as const }
const identity = (path: string): DocumentIdentity => ({ workspace, path })
const decode = (bytes: Uint8Array): string => new TextDecoder().decode(bytes)
const saveSession = async (sessionId: string) => ({
  sessionId,
  ok: true,
  status: 'success'
})

function expectNotFound(promise: Promise<unknown>): Promise<void> {
  return expect(promise).rejects.toMatchObject({ code: 'not-found' })
}

function readyMovePlan(
  store: DocumentSessionStore,
  sourcePath: string,
  destinationPath: string,
  entryKind: 'file' | 'directory' = 'file'
): PathTransactionPlan {
  const plan = planPathTransaction(store.list(), {
    id: `move-${sourcePath}`,
    kind: 'move',
    workspaceId: workspace.id,
    entryKind,
    sourcePath,
    destinationPath
  })
  return plan.phase === 'awaiting-dirty-decision'
    ? resolveDirtyPathDecision(plan, 'continue-without-saving')
    : plan
}

describe('adapter-backed path transactions', () => {
  it('preserves one live session and editor binding across rename then move', async () => {
    const adapter = new MemoryWorkspaceAdapter({
      id: workspace.id,
      folders: ['archive'],
      files: { 'folder/a.bpmn': '<saved/>' }
    })
    const store = new DocumentSessionStore({ createId: () => 'session-a' })
    const modeler = { name: 'modeler' }
    const commandStack = { name: 'command-stack' }
    const readXml = async () => '<dirty/>'
    const opened = store.open({
      identity: identity('folder/a.bpmn'),
      title: 'a.bpmn',
      xml: '<saved/>',
      editor: { modeler, commandStack, readXml }
    })
    store.updateXml(opened.id, '<dirty/>')

    const rename = resolveDirtyPathDecision(
      planPathTransaction(store.list(), {
        id: 'rename-a',
        kind: 'rename',
        workspaceId: workspace.id,
        entryKind: 'file',
        sourcePath: 'folder/a.bpmn',
        destinationPath: 'folder/renamed.bpmn'
      }),
      'continue-without-saving'
    )
    expect(
      await executePathTransaction(store, rename, {
        saveSession,
        mutateStorage: createAdapterPathMutation(adapter)
      })
    ).toMatchObject({ status: 'committed' })

    const move = readyMovePlan(store, 'folder/renamed.bpmn', 'archive/renamed.bpmn')
    expect(
      await executePathTransaction(store, move, {
        saveSession,
        mutateStorage: createAdapterPathMutation(adapter)
      })
    ).toMatchObject({ status: 'committed' })

    expect(store.get(opened.id)).toMatchObject({
      id: opened.id,
      identity: { path: 'archive/renamed.bpmn' },
      currentXml: '<dirty/>',
      lastSavedXml: '<saved/>',
      dirty: true,
      modeler,
      commandStack,
      readXml
    })
    expect(new TextDecoder().decode((await adapter.read('archive/renamed.bpmn')).bytes)).toBe(
      '<saved/>'
    )
    await expectNotFound(adapter.read('folder/a.bpmn'))
    await expectNotFound(adapter.read('folder/renamed.bpmn'))
  })

  it('rolls storage back before publishing identities when draft migration fails', async () => {
    const adapter = new MemoryWorkspaceAdapter({
      id: workspace.id,
      folders: ['archive'],
      files: { 'folder/a.bpmn': '<saved/>' }
    })
    const store = new DocumentSessionStore({ createId: () => 'session-a' })
    const opened = store.open({
      identity: identity('folder/a.bpmn'),
      title: 'a.bpmn',
      xml: '<saved/>'
    })
    const result = await executePathTransaction(
      store,
      readyMovePlan(store, 'folder/a.bpmn', 'archive/a.bpmn'),
      {
        saveSession,
        mutateStorage: createAdapterPathMutation(adapter),
        migrateDrafts: async () => {
          throw new Error('draft database unavailable')
        }
      }
    )

    expect(result).toMatchObject({ status: 'failed', rolledBack: true })
    expect(store.get(opened.id)?.identity.path).toBe('folder/a.bpmn')
    expect(new TextDecoder().decode((await adapter.read('folder/a.bpmn')).bytes)).toBe('<saved/>')
    await expectNotFound(adapter.read('archive/a.bpmn'))
  })

  it('stages delete, writes history, closes sessions, then prunes hidden payload', async () => {
    const adapter = new MemoryWorkspaceAdapter({
      id: workspace.id,
      files: {
        'folder/a.bpmn': '<a/>',
        'folder/nested/b.bpmn': '<b/>',
        'folder/notes.txt': 'notes'
      }
    })
    const history = new PortableHistoryManager({
      adapter,
      now: (() => {
        let value = 100
        return () => ++value
      })()
    })
    const store = new DocumentSessionStore()
    const a = store.open({
      id: 'a',
      identity: identity('folder/a.bpmn'),
      title: 'a.bpmn',
      xml: '<a/>'
    })
    const b = store.open({
      id: 'b',
      identity: identity('folder/nested/b.bpmn'),
      title: 'b.bpmn',
      xml: '<b/>'
    })
    const deletion = confirmPathDelete(
      planPathTransaction(store.list(), {
        id: '../unsafe/delete-id',
        kind: 'delete',
        workspaceId: workspace.id,
        entryKind: 'directory',
        sourcePath: 'folder'
      })
    )
    const mutate = createAdapterPathMutation(adapter, { history })
    const result = await executePathTransaction(store, deletion, {
      saveSession,
      mutateStorage: async (plan) => {
        const mutation = await mutate(plan)
        return {
          rollback: mutation.rollback,
          finalize: async () => {
            expect(store.get(a.id)).toBeUndefined()
            expect(store.get(b.id)).toBeUndefined()
            expect(
              (await adapter.list()).some(
                (entry) =>
                  entry.path.startsWith(`${PATH_TRANSACTION_STAGING_ROOT}/tx-`) &&
                  entry.path.endsWith('/payload')
              )
            ).toBe(true)
            await mutation.finalize!()
          }
        }
      }
    })

    expect(result).toMatchObject({ status: 'committed' })
    expect(
      (await adapter.list()).some((entry) =>
        entry.path.startsWith(`${PATH_TRANSACTION_STAGING_ROOT}/tx-`)
      )
    ).toBe(false)
    await expectNotFound(adapter.read('folder/a.bpmn'))
    expect((await history.listRevisions('folder/a.bpmn')).revisions).toHaveLength(1)
    expect((await history.listRevisions('folder/nested/b.bpmn')).revisions).toHaveLength(1)
  })

  it('reports a committed delete with finalizeError and preserves staged payload', async () => {
    const memory = new MemoryWorkspaceAdapter({
      id: workspace.id,
      files: { 'folder/a.bpmn': '<a/>' }
    })
    const adapter: WorkspaceAdapter = {
      id: memory.id,
      mode: memory.mode,
      storage: memory.storage,
      list: (path) => memory.list(path),
      read: (path) => memory.read(path),
      writeAtomic: (path, bytes, expectedHash, options) =>
        memory.writeAtomic(path, bytes, expectedHash, options),
      rename: (from, to) => memory.rename(from, to),
      move: (from, to) => memory.move(from, to),
      remove: async (path) => {
        if (path.startsWith(`${PATH_TRANSACTION_STAGING_ROOT}/tx-`)) {
          throw new WorkspaceOperationError({
            code: 'permission-loss',
            operation: 'remove',
            path,
            message: 'final cleanup denied'
          })
        }
        await memory.remove(path)
      },
      createFolder: (path) => memory.createFolder(path),
      exportBackup: (options) => memory.exportBackup(options)
    }
    const history = new PortableHistoryManager({ adapter })
    const store = new DocumentSessionStore()
    const opened = store.open({
      id: 'a',
      identity: identity('folder/a.bpmn'),
      title: 'a.bpmn',
      xml: '<a/>'
    })
    const deletion = confirmPathDelete(
      planPathTransaction(store.list(), {
        id: 'delete-a',
        kind: 'delete',
        workspaceId: workspace.id,
        entryKind: 'file',
        sourcePath: 'folder/a.bpmn'
      })
    )

    const result = await executePathTransaction(store, deletion, {
      saveSession,
      mutateStorage: createAdapterPathMutation(adapter, { history })
    })
    expect(result).toMatchObject({
      status: 'committed',
      finalizeError: { code: 'permission-loss' }
    })
    expect(store.get(opened.id)).toBeUndefined()
    await expectNotFound(memory.read('folder/a.bpmn'))
    const stagedPayload = (await memory.list()).find((entry) => entry.path.endsWith('/payload'))
    expect(stagedPayload?.path).toMatch(/^\.orbitpm\/transactions\/tx-[a-f0-9]+\/payload$/u)
    expect(new TextDecoder().decode((await memory.read(stagedPayload!.path)).bytes)).toBe('<a/>')
  })

  it('refuses a rollback if the destination changed externally', async () => {
    const adapter = new MemoryWorkspaceAdapter({
      id: workspace.id,
      folders: ['archive'],
      files: { 'folder/a.bpmn': '<original/>' }
    })
    const store = new DocumentSessionStore()
    store.open({
      identity: identity('folder/a.bpmn'),
      title: 'a.bpmn',
      xml: '<original/>'
    })
    const mutation = await mutateAdapterPath(
      adapter,
      readyMovePlan(store, 'folder/a.bpmn', 'archive/a.bpmn')
    )
    adapter.replaceExternally('archive/a.bpmn', '<external/>')

    await expect(mutation.rollback()).rejects.toMatchObject({
      code: 'integrity-failure',
      path: 'archive/a.bpmn'
    })
    await expectNotFound(adapter.read('folder/a.bpmn'))
    expect(new TextDecoder().decode((await adapter.read('archive/a.bpmn')).bytes)).toBe(
      '<external/>'
    )
  })

  it('preserves a destination changed exactly at conditional rollback deletion', async () => {
    let injectRace = false
    const adapter = new MemoryWorkspaceAdapter({
      id: workspace.id,
      folders: ['archive'],
      files: { 'folder/a.bpmn': '<original/>' },
      beforeRemoveIfHash: (path) => {
        if (path === 'archive/a.bpmn' && injectRace) {
          adapter.replaceExternally(path, '<newer/>')
        }
      }
    })
    const store = new DocumentSessionStore()
    store.open({
      identity: identity('folder/a.bpmn'),
      title: 'a.bpmn',
      xml: '<original/>'
    })
    const mutation = await mutateAdapterPath(
      adapter,
      readyMovePlan(store, 'folder/a.bpmn', 'archive/a.bpmn')
    )

    injectRace = true
    await expect(mutation.rollback()).rejects.toMatchObject({
      code: 'integrity-failure',
      operation: 'remove',
      path: 'archive/a.bpmn'
    })

    await expectNotFound(adapter.read('folder/a.bpmn'))
    expect(decode((await adapter.read('archive/a.bpmn')).bytes)).toBe('<newer/>')
  })

  it('preserves a concurrent staging child and reports incomplete rollback cleanup', async () => {
    let injectChild = false
    const adapter = new MemoryWorkspaceAdapter({
      id: workspace.id,
      files: { 'notes.txt': 'notes' },
      beforeRemoveEmptyFolder: (path) => {
        if (injectChild && path.startsWith(`${PATH_TRANSACTION_STAGING_ROOT}/tx-`)) {
          injectChild = false
          adapter.replaceExternally(`${path}/concurrent-note.txt`, 'retain me')
        }
      }
    })
    const deletion = confirmPathDelete(
      planPathTransaction([], {
        id: 'delete-notes-with-folder-race',
        kind: 'delete',
        workspaceId: workspace.id,
        entryKind: 'file',
        sourcePath: 'notes.txt'
      })
    )
    const mutation = await mutateAdapterPath(adapter, deletion)

    injectChild = true
    await expect(mutation.rollback()).rejects.toMatchObject({
      code: 'integrity-failure',
      operation: 'remove',
      path: expect.stringMatching(/^\.orbitpm\/transactions\/tx-/u)
    })

    expect(decode((await adapter.read('notes.txt')).bytes)).toBe('notes')
    const concurrent = (await adapter.list()).find((entry) =>
      entry.path.endsWith('/concurrent-note.txt')
    )
    expect(concurrent).toBeDefined()
    expect(decode((await adapter.read(concurrent!.path)).bytes)).toBe('retain me')
  })

  it('rejects reserved metadata paths, stale workspace ids, and BPMN delete without history', async () => {
    const adapter = new MemoryWorkspaceAdapter({
      id: workspace.id,
      folders: ['archive'],
      files: {
        'folder/a.bpmn': '<a/>',
        '.orbitpm/i18n/glossary.json': '{}'
      }
    })
    const store = new DocumentSessionStore()
    store.open({
      identity: identity('folder/a.bpmn'),
      title: 'a.bpmn',
      xml: '<a/>'
    })
    const reserved = planPathTransaction([], {
      id: 'reserved',
      kind: 'move',
      workspaceId: workspace.id,
      entryKind: 'file',
      sourcePath: '.orbitpm/i18n/glossary.json',
      destinationPath: 'glossary.json'
    })
    await expect(mutateAdapterPath(adapter, reserved)).rejects.toMatchObject({
      code: 'unsupported'
    })

    const stale = {
      ...readyMovePlan(store, 'folder/a.bpmn', 'archive/a.bpmn'),
      request: {
        ...readyMovePlan(store, 'folder/a.bpmn', 'archive/a.bpmn').request,
        workspaceId: 'another-workspace'
      }
    }
    await expect(mutateAdapterPath(adapter, stale)).rejects.toMatchObject({
      code: 'stale-workspace'
    })

    const deletion = confirmPathDelete(
      planPathTransaction(store.list(), {
        id: 'delete-without-history',
        kind: 'delete',
        workspaceId: workspace.id,
        entryKind: 'file',
        sourcePath: 'folder/a.bpmn'
      })
    )
    await expect(mutateAdapterPath(adapter, deletion)).rejects.toMatchObject({
      code: 'unsupported',
      operation: 'remove'
    })
    expect(await adapter.read('folder/a.bpmn')).toMatchObject({ path: 'folder/a.bpmn' })
  })
})
