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
const encode = (xml: string) => new TextEncoder().encode(xml)

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

function preparedWriter(adapter: MemoryWorkspaceAdapter, history: PortableHistoryManager) {
  return async (input: {
    revision: Parameters<PortableHistoryManager['restore']>[0]
    xml: string
    expectedCurrentHash: string | null
  }) => {
    if (input.expectedCurrentHash === null) {
      return {
        outcome: await adapter.writeAtomic(
          input.revision.originalPath,
          encode(input.xml),
          undefined,
          {
            expectedWorkspaceId: adapter.id,
            expectedMissing: true
          }
        )
      }
    }
    return history.writeWithRevision(
      input.revision.originalPath,
      encode(input.xml),
      input.expectedCurrentHash,
      'restore'
    )
  }
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
    expect(store.get(opened.id)).not.toBe(before)
    expect(store.get(opened.id)).toMatchObject({
      currentXml: '<current />',
      lastSavedXml: '<old />',
      dirty: true,
      base: { hash: (await adapter.read('process.bpmn')).hash }
    })
    expect(decode((await adapter.read('process.bpmn')).bytes)).toBe('<old />')
  })

  it('does not overwrite an edit made while the restore is committing', async () => {
    const { adapter, history, revision, current } = await historyFixture()
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
      lastSavedXml: '<old />',
      dirty: true,
      base: { hash: (await adapter.read('process.bpmn')).hash }
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

  it('recreates an observed-missing original and synchronizes its existing session', async () => {
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
    await adapter.remove('process.bpmn')

    const result = await restoreHistoryRevision({
      manager: history,
      store,
      revision,
      workspace,
      expectedCurrentHash: null
    })

    expect(result).toMatchObject({
      status: 'restored',
      sessionId: opened.id,
      previousRevision: undefined,
      outcome: { status: 'success', created: true }
    })
    expect(importXML).toHaveBeenCalledWith('<old />')
    expect(store.get(opened.id)).toMatchObject({
      currentXml: '<old />',
      lastSavedXml: '<old />',
      dirty: false
    })
    expect(decode((await adapter.read('process.bpmn')).bytes)).toBe('<old />')
  })

  it('preserves bytes recreated after an observed-missing restore preflight', async () => {
    const { adapter, history, revision } = await historyFixture()
    await adapter.remove('process.bpmn')
    await expect(adapter.read('process.bpmn')).rejects.toMatchObject({ code: 'not-found' })
    adapter.replaceExternally('process.bpmn', '<recreated />')

    const result = await restoreHistoryRevision({
      manager: history,
      store: new DocumentSessionStore(),
      revision,
      workspace,
      expectedCurrentHash: null
    })

    expect(result).toMatchObject({
      status: 'not-restored',
      sessionId: null,
      previousRevision: undefined,
      outcome: {
        status: 'external-conflict',
        reason: 'already-exists'
      }
    })
    expect(decode((await adapter.read('process.bpmn')).bytes)).toBe('<recreated />')
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

  it('reviews verified history XML before writing and persists the exact transformed XML', async () => {
    const { adapter, history, revision, current } = await historyFixture()
    const store = new DocumentSessionStore()
    const importXML = vi.fn(async () => undefined)
    const opened = store.open({
      id: 'session',
      identity: { workspace, path: revision.originalPath },
      title: revision.originalPath,
      xml: '<current />',
      base: current,
      editor: { modeler: { importXML } }
    })
    const prepareXml = vi.fn(async (xml: string) => ({
      status: 'completed' as const,
      xml: xml.replace('old', 'reviewed')
    }))

    const result = await restoreHistoryRevision({
      manager: history,
      store,
      revision,
      workspace,
      expectedCurrentHash: current.hash,
      prepareXml,
      writePreparedXml: preparedWriter(adapter, history)
    })

    expect(result).toMatchObject({ status: 'restored', sessionId: opened.id })
    expect(prepareXml).toHaveBeenCalledWith(
      '<old />',
      expect.objectContaining({ revision, session: expect.objectContaining({ id: opened.id }) })
    )
    expect(decode((await adapter.read(revision.originalPath)).bytes)).toBe('<reviewed />')
    expect(importXML).toHaveBeenCalledWith('<reviewed />')
    expect(store.get(opened.id)).toMatchObject({
      currentXml: '<reviewed />',
      lastSavedXml: '<reviewed />',
      dirty: false
    })
  })

  it.each(['cancelled', 'review-required'] as const)(
    'performs no write when preparation returns %s',
    async (status) => {
      const { adapter, history, revision, current } = await historyFixture()
      const writePreparedXml = vi.fn(preparedWriter(adapter, history))

      const result = await restoreHistoryRevision({
        manager: history,
        store: new DocumentSessionStore(),
        revision,
        workspace,
        expectedCurrentHash: current.hash,
        prepareXml: async () => ({ status }),
        writePreparedXml
      })

      expect(result).toMatchObject({
        status: 'preparation-not-completed',
        reason: status
      })
      expect(writePreparedXml).not.toHaveBeenCalled()
      expect(decode((await adapter.read(revision.originalPath)).bytes)).toBe('<current />')
    }
  )

  it('performs no write when the captured session becomes stale during review', async () => {
    const { adapter, history, revision, current } = await historyFixture()
    const store = new DocumentSessionStore()
    const opened = store.open({
      id: 'session',
      identity: { workspace, path: revision.originalPath },
      title: revision.originalPath,
      xml: '<current />',
      base: current
    })
    const writePreparedXml = vi.fn(preparedWriter(adapter, history))

    const result = await restoreHistoryRevision({
      manager: history,
      store,
      revision,
      workspace,
      expectedCurrentHash: current.hash,
      prepareXml: async () => {
        store.updateXml(opened.id, '<newer local />')
        return { status: 'completed', xml: '<reviewed />' }
      },
      writePreparedXml
    })

    expect(result).toMatchObject({
      status: 'preparation-not-completed',
      reason: 'stale'
    })
    expect(writePreparedXml).not.toHaveBeenCalled()
    expect(decode((await adapter.read(revision.originalPath)).bytes)).toBe('<current />')
  })

  it('re-verifies revision integrity after review and before calling the writer', async () => {
    const { adapter, history, revision, current } = await historyFixture()
    const preview = await history.preview(revision)
    const integrityError = new Error('history content was tampered with')
    const manager = {
      restore: vi.fn(history.restore.bind(history)),
      preview: vi.fn().mockResolvedValueOnce(preview).mockRejectedValueOnce(integrityError)
    }
    const writePreparedXml = vi.fn(preparedWriter(adapter, history))

    const result = await restoreHistoryRevision({
      manager,
      store: new DocumentSessionStore(),
      revision,
      workspace,
      expectedCurrentHash: current.hash,
      prepareXml: async (xml) => ({ status: 'completed', xml }),
      writePreparedXml
    })

    expect(result).toMatchObject({ status: 'failed', error: integrityError })
    expect(writePreparedXml).not.toHaveBeenCalled()
    expect(decode((await adapter.read(revision.originalPath)).bytes)).toBe('<current />')
  })
})
