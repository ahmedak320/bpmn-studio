import { describe, expect, it, vi } from 'vitest'
import { MemoryWorkspaceAdapter } from '../workspace/adapters'
import { PortableHistoryManager } from '../workspace/history/historyManager'
import { restoreHistoryRevision } from './historyRestore'
import { DocumentSessionStore } from './store'
import type { WorkspaceIdentity } from './types'

const workspace: WorkspaceIdentity = {
  id: 'workspace-uuid',
  generation: 1,
  mode: 'memory'
}
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes)

async function historyFixture() {
  const adapter = new MemoryWorkspaceAdapter({
    id: workspace.id,
    files: { 'process.bpmn': '<old />' }
  })
  const history = new PortableHistoryManager({
    adapter,
    now: (() => {
      let value = 100
      return () => ++value
    })()
  })
  const revision = await history.createRevision('process.bpmn', {
    reason: 'manual'
  })
  adapter.replaceExternally('process.bpmn', '<current />')
  const current = await adapter.read('process.bpmn')
  return { adapter, history, revision, current }
}

describe('history restore session hook', () => {
  it('updates the matching open session while preserving editor identity and bindings', async () => {
    const { adapter, history, revision, current } = await historyFixture()
    const store = new DocumentSessionStore()
    const importXML = vi.fn(async () => undefined)
    const modeler = { importXML }
    const commandStack = { undo: vi.fn() }
    const readXml = async () => '<current />'
    const opened = store.open({
      id: 'session',
      identity: { workspace, path: 'process.bpmn' },
      title: 'process.bpmn',
      xml: '<current />',
      base: current,
      editor: { modeler, commandStack, readXml }
    })

    const result = await restoreHistoryRevision({
      manager: history,
      store,
      revision,
      workspace,
      expectedCurrentHash: current.hash
    })

    expect(result).toMatchObject({
      status: 'restored',
      sessionId: opened.id,
      outcome: { status: 'success' },
      previousRevision: { reason: 'restore', hash: current.hash }
    })
    expect(importXML).toHaveBeenCalledWith('<old />')
    expect(store.get(opened.id)).toMatchObject({
      id: opened.id,
      identity: { path: 'process.bpmn' },
      currentXml: '<old />',
      lastSavedXml: '<old />',
      dirty: false,
      modeler,
      commandStack,
      readXml,
      base: {
        hash: (await adapter.read('process.bpmn')).hash
      }
    })
    expect(decode((await adapter.read('process.bpmn')).bytes)).toBe('<old />')
  })

  it('leaves the session and editor untouched when the disk CAS conflicts', async () => {
    const { adapter, history, revision, current } = await historyFixture()
    const store = new DocumentSessionStore()
    const importXML = vi.fn(async () => undefined)
    const opened = store.open({
      id: 'session',
      identity: { workspace, path: 'process.bpmn' },
      title: 'process.bpmn',
      xml: '<current />',
      base: current,
      editor: { modeler: { importXML } }
    })
    const before = store.get(opened.id)
    adapter.replaceExternally('process.bpmn', '<newer external />')

    const result = await restoreHistoryRevision({
      manager: history,
      store,
      revision,
      workspace,
      expectedCurrentHash: current.hash
    })

    expect(result).toMatchObject({
      status: 'not-restored',
      outcome: {
        status: 'external-conflict',
        reason: 'hash-mismatch'
      }
    })
    expect(store.get(opened.id)).toBe(before)
    expect(importXML).not.toHaveBeenCalled()
    expect(decode((await adapter.read('process.bpmn')).bytes)).toBe('<newer external />')
  })

  it('reports storage success separately when editor import fails and does not acknowledge the store', async () => {
    const { adapter, history, revision, current } = await historyFixture()
    const store = new DocumentSessionStore()
    const importError = new Error('modeler rejected XML')
    const opened = store.open({
      id: 'session',
      identity: { workspace, path: 'process.bpmn' },
      title: 'process.bpmn',
      xml: '<current />',
      base: current,
      editor: {
        modeler: {
          importXML: vi.fn(async () => {
            throw importError
          })
        }
      }
    })
    const before = store.get(opened.id)

    const result = await restoreHistoryRevision({
      manager: history,
      store,
      revision,
      workspace,
      expectedCurrentHash: current.hash
    })

    expect(result).toMatchObject({
      status: 'storage-restored-session-refresh-failed',
      sessionId: opened.id,
      outcome: { status: 'success' },
      error: importError
    })
    expect(store.get(opened.id)).toBe(before)
    expect(decode((await adapter.read('process.bpmn')).bytes)).toBe('<old />')
  })

  it('does not overwrite an edit made while the restore is committing', async () => {
    const { history, revision, current } = await historyFixture()
    const store = new DocumentSessionStore()
    const opened = store.open({
      id: 'session',
      identity: { workspace, path: 'process.bpmn' },
      title: 'process.bpmn',
      xml: '<current />',
      base: current
    })
    const manager = {
      restore: async (...args: Parameters<PortableHistoryManager['restore']>) => {
        const result = await history.restore(...args)
        store.updateXml(opened.id, '<concurrent edit />')
        return result
      }
    }

    const result = await restoreHistoryRevision({
      manager,
      store,
      revision,
      workspace,
      expectedCurrentHash: current.hash
    })

    expect(result).toMatchObject({
      status: 'storage-restored-session-refresh-failed',
      sessionId: opened.id,
      outcome: { status: 'success' }
    })
    expect(store.get(opened.id)).toMatchObject({
      currentXml: '<concurrent edit />',
      dirty: true
    })
  })

  it('restores closed documents without manufacturing a session', async () => {
    const { adapter, history, revision, current } = await historyFixture()
    const store = new DocumentSessionStore()
    const result = await restoreHistoryRevision({
      manager: history,
      store,
      revision,
      workspace,
      expectedCurrentHash: current.hash
    })

    expect(result).toMatchObject({
      status: 'restored',
      sessionId: null,
      outcome: { status: 'success' }
    })
    expect(store.list()).toEqual([])
    expect(decode((await adapter.read('process.bpmn')).bytes)).toBe('<old />')
  })

  it('requires an explicit SHA-256 CAS value before touching storage', async () => {
    const { adapter, history, revision } = await historyFixture()
    const before = await adapter.read('process.bpmn')
    await expect(
      restoreHistoryRevision({
        manager: history,
        store: new DocumentSessionStore(),
        revision,
        workspace,
        expectedCurrentHash: ''
      })
    ).rejects.toThrow(/SHA-256/)
    expect((await adapter.read('process.bpmn')).hash).toBe(before.hash)
  })
})
