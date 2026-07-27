import { describe, expect, it, vi } from 'vitest'
import { MemoryWorkspaceAdapter } from '../workspace/adapters'
import { PortableHistoryManager } from '../workspace/history/historyManager'
import {
  DraftJournalCoordinator,
  MemoryDraftJournal,
  draftKeyOf,
  type DraftJournal,
  type DraftKey,
  type DraftRecord,
  type DraftSource,
  type DraftTimer
} from './draftJournal'
import { restoreHistoryRevision } from './historyRestore'
import { DocumentSessionStore } from './store'
import type { SessionIncarnation, WorkspaceIdentity } from './types'

const workspace: WorkspaceIdentity = {
  id: 'workspace-uuid',
  generation: 1,
  mode: 'memory'
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes)

class InertTimer implements DraftTimer {
  setTimeout(): unknown {
    return Symbol('draft-timer')
  }

  clearTimeout(): void {}
}

class DeferredFirstPutJournal implements DraftJournal {
  readonly inner = new MemoryDraftJournal()
  readonly putStarted = deferred<void>()
  readonly releasePut = deferred<void>()
  readonly putCalls: DraftRecord[] = []
  readonly deleteCalls: DraftKey[] = []
  #shouldDeferPut = true

  async put(record: DraftRecord): Promise<void> {
    this.putCalls.push(record)
    if (this.#shouldDeferPut) {
      this.#shouldDeferPut = false
      this.putStarted.resolve()
      await this.releasePut.promise
    }
    await this.inner.put(record)
  }

  get(key: DraftKey): Promise<DraftRecord | null> {
    return this.inner.get(key)
  }

  listWorkspace(workspaceId: string): Promise<readonly DraftRecord[]> {
    return this.inner.listWorkspace(workspaceId)
  }

  async delete(key: DraftKey): Promise<void> {
    this.deleteCalls.push(key)
    await this.inner.delete(key)
  }

  move(from: DraftKey, to: DraftKey): Promise<void> {
    return this.inner.move(from, to)
  }

  clearWorkspace(workspaceId: string): Promise<void> {
    return this.inner.clearWorkspace(workspaceId)
  }
}

function draftSource(incarnation: SessionIncarnation, currentXml: string): DraftSource {
  return {
    sessionId: 'session',
    incarnation,
    identity: { workspace, path: 'process.bpmn' },
    currentXml,
    dirty: true,
    base: { hash: 'base', size: 4, modifiedAt: 1 }
  }
}

describe('session-incarnation ABA guards', () => {
  it('does not refresh a same-id replacement after a deferred history restore', async () => {
    const adapter = new MemoryWorkspaceAdapter({
      id: workspace.id,
      files: { 'process.bpmn': '<old />' }
    })
    const history = new PortableHistoryManager({ adapter })
    const revision = await history.createRevision('process.bpmn', { reason: 'manual' })
    adapter.replaceExternally('process.bpmn', '<current />')
    const current = await adapter.read('process.bpmn')
    const store = new DocumentSessionStore()
    const oldImport = vi.fn(async () => undefined)
    const captured = store.open({
      id: 'session',
      identity: { workspace, path: 'process.bpmn' },
      title: 'process.bpmn',
      xml: '<current />',
      base: current,
      editor: { modeler: { importXML: oldImport } }
    })
    const restoreEntered = deferred<void>()
    const releaseRestore = deferred<void>()
    const manager = {
      restore: vi.fn(async (...args: Parameters<PortableHistoryManager['restore']>) => {
        restoreEntered.resolve()
        await releaseRestore.promise
        return history.restore(...args)
      })
    }

    const restorePromise = restoreHistoryRevision({
      manager,
      store,
      revision,
      workspace,
      expectedCurrentHash: current.hash
    })
    await restoreEntered.promise

    expect(store.close(captured.id)).toBe(true)
    const replacementImport = vi.fn(async () => undefined)
    const replacement = store.open({
      id: captured.id,
      identity: captured.identity,
      title: captured.title,
      xml: captured.currentXml,
      base: captured.base,
      editor: { modeler: { importXML: replacementImport } }
    })
    expect(replacement.revision).toBe(captured.revision)
    expect(replacement.incarnation).not.toBe(captured.incarnation)

    releaseRestore.resolve()
    const result = await restorePromise

    expect(result).toMatchObject({
      status: 'storage-restored-session-refresh-failed',
      sessionId: replacement.id,
      outcome: { status: 'success' }
    })
    expect(oldImport).not.toHaveBeenCalled()
    expect(replacementImport).not.toHaveBeenCalled()
    expect(store.get(replacement.id)).toMatchObject({
      id: replacement.id,
      incarnation: replacement.incarnation,
      currentXml: '<current />',
      modeler: replacement.modeler
    })
    expect(decode((await adapter.read('process.bpmn')).bytes)).toBe('<old />')
  })

  it.each([
    {
      name: 'flush',
      prepare: async (coordinator: DraftJournalCoordinator, _current: DraftSource) => {
        await coordinator.flush('session', 1)
      }
    },
    {
      name: 'confirmed save',
      prepare: async (coordinator: DraftJournalCoordinator, _current: DraftSource) => {
        await coordinator.confirmedSave('session', 1, '<old />')
      }
    },
    {
      name: 'explicit discard',
      prepare: async (coordinator: DraftJournalCoordinator, _current: DraftSource) => {
        await coordinator.explicitDiscard('session', 1)
      }
    },
    {
      name: 'untrack',
      prepare: async (coordinator: DraftJournalCoordinator, _current: DraftSource) => {
        await coordinator.untrack('session', 1)
      }
    }
  ])(
    'does not let a stale old-incarnation $name affect its replacement',
    async ({ name, prepare }) => {
      const journal = new MemoryDraftJournal()
      const coordinator = new DraftJournalCoordinator(journal, {
        appVersion: 'test',
        timer: new InertTimer()
      })
      const oldSource = draftSource(1, '<old />')
      const currentSource = draftSource(2, '<replacement />')
      coordinator.track(oldSource)
      coordinator.track(currentSource)

      if (name !== 'flush') {
        await coordinator.flush(currentSource.sessionId, currentSource.incarnation)
      }
      await prepare(coordinator, currentSource)

      const afterStaleOperation = await journal.get(draftKeyOf(currentSource))
      if (name === 'flush') {
        expect(afterStaleOperation).toBeNull()
        await coordinator.flush(currentSource.sessionId, currentSource.incarnation)
      } else if (name === 'untrack') {
        await journal.delete(draftKeyOf(currentSource))
        await coordinator.flush(currentSource.sessionId, currentSource.incarnation)
      } else {
        expect(afterStaleOperation).toMatchObject({ xml: '<replacement />' })
      }
      expect(await journal.get(draftKeyOf(currentSource))).toMatchObject({
        xml: '<replacement />'
      })
    }
  )

  it('does not let a late old-incarnation track replace the current source', async () => {
    const journal = new MemoryDraftJournal()
    const coordinator = new DraftJournalCoordinator(journal, {
      appVersion: 'test',
      timer: new InertTimer()
    })
    const oldSource = draftSource(1, '<old />')
    const currentSource = draftSource(2, '<replacement />')
    coordinator.track(currentSource)
    coordinator.track(oldSource)

    await coordinator.flush(currentSource.sessionId, currentSource.incarnation)

    expect(await journal.get(draftKeyOf(currentSource))).toMatchObject({
      xml: '<replacement />'
    })
  })

  it.each([
    {
      name: 'confirmed save',
      cleanup: (coordinator: DraftJournalCoordinator, source: DraftSource) =>
        coordinator.confirmedSave(source.sessionId, source.incarnation, source.currentXml)
    },
    {
      name: 'explicit discard',
      cleanup: (coordinator: DraftJournalCoordinator, source: DraftSource) =>
        coordinator.explicitDiscard(source.sessionId, source.incarnation)
    }
  ])(
    'rechecks incarnation before a queued old-incarnation $name cleanup executes',
    async ({ cleanup }) => {
      const journal = new DeferredFirstPutJournal()
      const coordinator = new DraftJournalCoordinator(journal, {
        appVersion: 'test',
        timer: new InertTimer()
      })
      const oldSource = draftSource(1, '<old />')
      const currentSource = draftSource(2, '<replacement />')
      coordinator.track(oldSource)
      const oldFlush = coordinator.flush(oldSource.sessionId, oldSource.incarnation)
      await journal.putStarted.promise

      const staleCleanup = cleanup(coordinator, oldSource)
      coordinator.track(currentSource)
      journal.releasePut.resolve()
      await Promise.all([oldFlush, staleCleanup])

      expect(journal.deleteCalls).toEqual([])
      await coordinator.flush(currentSource.sessionId, currentSource.incarnation)
      expect(await journal.get(draftKeyOf(currentSource))).toMatchObject({
        xml: '<replacement />'
      })
    }
  )

  it('rechecks incarnation before a queued old-incarnation flush executes', async () => {
    const journal = new DeferredFirstPutJournal()
    const coordinator = new DraftJournalCoordinator(journal, {
      appVersion: 'test',
      timer: new InertTimer()
    })
    const firstOldSource = draftSource(1, '<first old />')
    const queuedOldSource = draftSource(1, '<queued old />')
    const currentSource = draftSource(2, '<replacement />')
    coordinator.track(firstOldSource)
    const firstFlush = coordinator.flush(firstOldSource.sessionId, firstOldSource.incarnation)
    await journal.putStarted.promise

    coordinator.track(queuedOldSource)
    const queuedFlush = coordinator.flush(queuedOldSource.sessionId, queuedOldSource.incarnation)
    coordinator.track(currentSource)
    journal.releasePut.resolve()
    await Promise.all([firstFlush, queuedFlush])

    expect(journal.putCalls.map((record) => record.xml)).toEqual(['<first old />'])
    await coordinator.flush(currentSource.sessionId, currentSource.incarnation)
    expect(await journal.get(draftKeyOf(currentSource))).toMatchObject({
      xml: '<replacement />'
    })
  })

  it('does not let an old untrack resume across replacement and remove its source', async () => {
    const journal = new DeferredFirstPutJournal()
    const coordinator = new DraftJournalCoordinator(journal, {
      appVersion: 'test',
      timer: new InertTimer()
    })
    const oldSource = draftSource(1, '<old />')
    const currentSource = draftSource(2, '<replacement />')
    coordinator.track(oldSource)
    const oldFlush = coordinator.flush(oldSource.sessionId, oldSource.incarnation)
    await journal.putStarted.promise

    const staleUntrack = coordinator.untrack(oldSource.sessionId, oldSource.incarnation)
    coordinator.track(currentSource)
    const currentFlush = coordinator.flush(currentSource.sessionId, currentSource.incarnation)
    journal.releasePut.resolve()
    await Promise.all([oldFlush, staleUntrack, currentFlush])

    expect(await journal.get(draftKeyOf(currentSource))).toMatchObject({
      xml: '<replacement />'
    })
  })
})
