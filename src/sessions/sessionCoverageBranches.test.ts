import { describe, expect, it, vi } from 'vitest'
import { MemoryWorkspaceAdapter } from '../workspace/adapters'
import { PortableHistoryManager } from '../workspace/history/historyManager'
import type { HistoryPreview, HistoryWriteResult } from '../workspace/history/types'
import {
  DocumentSessionController,
  type DocumentSessionControllerOptions,
  type PersistenceWriteOptions,
  type SessionPersistence
} from './controller'
import {
  DraftJournalCoordinator,
  MemoryDraftJournal,
  createDraftRecoveryComparison,
  draftKeyOf,
  findDraftRecoveryComparison,
  type DraftLifecycleTarget,
  type DraftSource,
  type DraftTimer
} from './draftJournal'
import type { ExternalDocument } from './externalConflict'
import { restoreHistoryRevision } from './historyRestore'
import { DocumentSessionStore } from './store'
import type { DocumentIdentity, FileFingerprint, WorkspaceIdentity } from './types'

const workspace: WorkspaceIdentity = {
  id: 'session-coverage-workspace',
  generation: 1,
  mode: 'memory'
}

const encode = (value: string): Uint8Array => new TextEncoder().encode(value)
const decode = (value: Uint8Array): string => new TextDecoder().decode(value)

async function historyFixture() {
  const adapter = new MemoryWorkspaceAdapter({
    id: workspace.id,
    files: { 'process.bpmn': '<old />' }
  })
  const history = new PortableHistoryManager({ adapter })
  const revision = await history.createRevision('process.bpmn', { reason: 'manual' })
  adapter.replaceExternally('process.bpmn', '<current />')
  const current = await adapter.read('process.bpmn')
  return { adapter, history, revision, current }
}

function preparedWriter(
  adapter: MemoryWorkspaceAdapter,
  history: PortableHistoryManager
): (input: {
  revision: Parameters<PortableHistoryManager['restore']>[0]
  xml: string
  expectedCurrentHash: string | null
}) => Promise<HistoryWriteResult> {
  return async (input) => {
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

function openHistorySession(
  store: DocumentSessionStore,
  current: Awaited<ReturnType<MemoryWorkspaceAdapter['read']>>,
  editor?: { modeler?: unknown; readXml?: () => Promise<string> }
) {
  return store.open({
    id: 'history-session',
    identity: { workspace, path: 'process.bpmn' },
    title: 'process.bpmn',
    xml: '<current />',
    base: current,
    editor
  })
}

describe('history restore release branch coverage', () => {
  it('fails closed when reviewed history restore lacks either required storage seam', async () => {
    const { history, revision, current } = await historyFixture()
    const prepareXml = vi.fn(async (xml: string) => ({ status: 'completed' as const, xml }))

    const missingWriter = await restoreHistoryRevision({
      manager: history,
      store: new DocumentSessionStore(),
      revision,
      workspace,
      expectedCurrentHash: current.hash,
      prepareXml
    })
    expect(missingWriter).toMatchObject({
      status: 'failed',
      error: expect.objectContaining({
        message: 'Prepared history restore requires preview and writePreparedXml.'
      })
    })
    expect(prepareXml).not.toHaveBeenCalled()

    const missingPreview = await restoreHistoryRevision({
      manager: { restore: history.restore.bind(history) },
      store: new DocumentSessionStore(),
      revision,
      workspace,
      expectedCurrentHash: current.hash,
      prepareXml,
      writePreparedXml: vi.fn()
    })
    expect(missingPreview).toMatchObject({ status: 'failed' })
    expect(prepareXml).not.toHaveBeenCalled()
  })

  it('does not preview or write when review starts cancelled or in a stale workspace', async () => {
    const { adapter, history, revision, current } = await historyFixture()
    const preview = vi.spyOn(history, 'preview')
    const writePreparedXml = vi.fn(preparedWriter(adapter, history))
    const abort = new AbortController()
    abort.abort()

    const cancelled = await restoreHistoryRevision({
      manager: history,
      store: new DocumentSessionStore(),
      revision,
      workspace,
      expectedCurrentHash: current.hash,
      signal: abort.signal,
      prepareXml: async (xml) => ({ status: 'completed', xml }),
      writePreparedXml
    })
    expect(cancelled).toMatchObject({
      status: 'preparation-not-completed',
      reason: 'cancelled'
    })

    const stale = await restoreHistoryRevision({
      manager: history,
      store: new DocumentSessionStore(),
      revision,
      workspace,
      expectedCurrentHash: current.hash,
      isWorkspaceCurrent: () => false,
      prepareXml: async (xml) => ({ status: 'completed', xml }),
      writePreparedXml
    })
    expect(stale).toMatchObject({ status: 'preparation-not-completed', reason: 'stale' })
    expect(preview).not.toHaveBeenCalled()
    expect(writePreparedXml).not.toHaveBeenCalled()
  })

  it('rechecks workspace currency immediately after the verified preview', async () => {
    const { adapter, history, revision, current } = await historyFixture()
    let workspaceCurrent = true
    const manager = {
      restore: history.restore.bind(history),
      preview: vi.fn(async (...args: Parameters<PortableHistoryManager['preview']>) => {
        const preview = await history.preview(...args)
        workspaceCurrent = false
        return preview
      })
    }
    const prepareXml = vi.fn()
    const writePreparedXml = vi.fn(preparedWriter(adapter, history))

    const result = await restoreHistoryRevision({
      manager,
      store: new DocumentSessionStore(),
      revision,
      workspace,
      expectedCurrentHash: current.hash,
      isWorkspaceCurrent: () => workspaceCurrent,
      prepareXml,
      writePreparedXml
    })

    expect(result).toMatchObject({ status: 'preparation-not-completed', reason: 'stale' })
    expect(prepareXml).not.toHaveBeenCalled()
    expect(writePreparedXml).not.toHaveBeenCalled()
  })

  it('rechecks cancellation after the post-review integrity preview', async () => {
    const { adapter, history, revision, current } = await historyFixture()
    const abort = new AbortController()
    let previews = 0
    const manager = {
      restore: history.restore.bind(history),
      preview: vi.fn(async (...args: Parameters<PortableHistoryManager['preview']>) => {
        const preview = await history.preview(...args)
        previews += 1
        if (previews === 2) abort.abort()
        return preview
      })
    }
    const writePreparedXml = vi.fn(preparedWriter(adapter, history))

    const result = await restoreHistoryRevision({
      manager,
      store: new DocumentSessionStore(),
      revision,
      workspace,
      expectedCurrentHash: current.hash,
      signal: abort.signal,
      prepareXml: async (xml) => ({ status: 'completed', xml }),
      writePreparedXml
    })

    expect(result).toMatchObject({
      status: 'preparation-not-completed',
      reason: 'cancelled'
    })
    expect(writePreparedXml).not.toHaveBeenCalled()
  })

  it.each([
    {
      name: 'a different byte length',
      mutate: (preview: HistoryPreview): HistoryPreview => ({
        ...preview,
        bytes: encode('<different-length />')
      })
    },
    {
      name: 'different bytes at the same length',
      mutate: (preview: HistoryPreview): HistoryPreview => ({
        ...preview,
        bytes: encode('<bad />')
      })
    }
  ])('rejects a revision with $name after review', async ({ mutate }) => {
    const { adapter, history, revision, current } = await historyFixture()
    const preview = await history.preview(revision)
    const manager = {
      restore: history.restore.bind(history),
      preview: vi.fn().mockResolvedValueOnce(preview).mockResolvedValueOnce(mutate(preview))
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

    expect(result).toMatchObject({
      status: 'failed',
      error: expect.objectContaining({
        message: 'History revision changed while its restore was being reviewed.'
      })
    })
    expect(writePreparedXml).not.toHaveBeenCalled()
    expect(decode((await adapter.read(revision.originalPath)).bytes)).toBe('<current />')
  })

  it('reports exact-persistence violations after a prepared write commits', async () => {
    const { adapter, history, revision, current } = await historyFixture()
    const write = preparedWriter(adapter, history)

    const result = await restoreHistoryRevision({
      manager: history,
      store: new DocumentSessionStore(),
      revision,
      workspace,
      expectedCurrentHash: current.hash,
      prepareXml: async () => ({ status: 'completed', xml: '<reviewed />' }),
      writePreparedXml: (input) => write({ ...input, xml: '<different />' })
    })

    expect(result).toMatchObject({
      status: 'storage-restored-session-refresh-failed',
      sessionId: null,
      outcome: { status: 'success' },
      error: expect.objectContaining({
        message: 'Prepared history writer did not persist the reviewed XML exactly.'
      })
    })
    expect(decode((await adapter.read(revision.originalPath)).bytes)).toBe('<different />')
  })

  it('uses a custom editor apply seam and also supports sessions without a modeler', async () => {
    const first = await historyFixture()
    const firstStore = new DocumentSessionStore()
    const opened = openHistorySession(firstStore, first.current)
    const applyXml = vi.fn(async () => undefined)

    const applied = await restoreHistoryRevision({
      manager: first.history,
      store: firstStore,
      revision: first.revision,
      workspace,
      expectedCurrentHash: first.current.hash,
      applyXml
    })
    expect(applied).toMatchObject({ status: 'restored', sessionId: opened.id })
    expect(applyXml).toHaveBeenCalledWith(expect.objectContaining({ id: opened.id }), '<old />')

    const second = await historyFixture()
    const secondStore = new DocumentSessionStore()
    const modelerless = openHistorySession(secondStore, second.current)
    expect(modelerless.modeler).toBeNull()
    expect(
      await restoreHistoryRevision({
        manager: second.history,
        store: secondStore,
        revision: second.revision,
        workspace,
        expectedCurrentHash: second.current.hash
      })
    ).toMatchObject({ status: 'restored', sessionId: modelerless.id })
  })

  it('keeps local XML dirty when a live editor cannot import the committed restore', async () => {
    const { adapter, history, revision, current } = await historyFixture()
    const store = new DocumentSessionStore()
    const opened = openHistorySession(store, current, { modeler: {} })

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
      error: expect.objectContaining({
        message: 'The live editor does not expose importXML; its session was left unchanged.'
      })
    })
    expect(store.get(opened.id)).toMatchObject({
      currentXml: '<current />',
      lastSavedXml: '<old />',
      dirty: true
    })
    expect(decode((await adapter.read(revision.originalPath)).bytes)).toBe('<old />')
  })

  it('retains a genuinely newer editor edit when import emits a change before failing', async () => {
    const { adapter, history, revision, current } = await historyFixture()
    const store = new DocumentSessionStore()
    const importError = new Error('editor import failed after publishing a change')
    const opened = openHistorySession(store, current, {
      modeler: {
        importXML: async () => {
          store.updateXml('history-session', '<newer local />')
          throw importError
        }
      }
    })

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
      error: importError
    })
    expect(store.get(opened.id)).toMatchObject({
      currentXml: '<newer local />',
      lastSavedXml: '<old />',
      dirty: true
    })
    expect(decode((await adapter.read(revision.originalPath)).bytes)).toBe('<old />')
  })

  it('does not refresh a session that opens while a closed-document restore writes', async () => {
    const { adapter, history, revision, current } = await historyFixture()
    const store = new DocumentSessionStore()
    const manager = {
      restore: vi.fn(async (...args: Parameters<PortableHistoryManager['restore']>) => {
        const result = await history.restore(...args)
        openHistorySession(store, current)
        return result
      })
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
      sessionId: 'history-session',
      outcome: { status: 'success' },
      error: expect.objectContaining({
        message: 'A session opened while history restore was writing storage.'
      })
    })
    expect(store.get('history-session')).toMatchObject({
      currentXml: '<current />',
      lastSavedXml: '<old />',
      dirty: true
    })
    expect(decode((await adapter.read(revision.originalPath)).bytes)).toBe('<old />')
  })

  it('reports cancellation that happens after storage has committed', async () => {
    const { adapter, history, revision, current } = await historyFixture()
    const abort = new AbortController()
    const manager = {
      restore: vi.fn(async (...args: Parameters<PortableHistoryManager['restore']>) => {
        const result = await history.restore(...args)
        abort.abort()
        return result
      })
    }

    const result = await restoreHistoryRevision({
      manager,
      store: new DocumentSessionStore(),
      revision,
      workspace,
      expectedCurrentHash: current.hash,
      signal: abort.signal
    })

    expect(result).toMatchObject({
      status: 'storage-restored-session-refresh-failed',
      sessionId: null,
      outcome: { status: 'success' },
      error: expect.objectContaining({
        message: 'History restore storage committed after its operation became stale.'
      })
    })
    expect(decode((await adapter.read(revision.originalPath)).bytes)).toBe('<old />')
  })
})

const controllerIdentity: DocumentIdentity = {
  workspace,
  path: 'controller.bpmn'
}

function fingerprint(hash: string, modifiedAt = 1): FileFingerprint {
  return { hash, size: hash.length, modifiedAt }
}

function externalDocument(
  xml = '<external />',
  hash = 'external',
  path = 'controller.bpmn'
): ExternalDocument {
  return {
    identity: { workspace, path },
    xml,
    fingerprint: fingerprint(hash)
  }
}

function controllerFixture(
  persistence: SessionPersistence,
  options: Omit<DocumentSessionControllerOptions, 'persistence'> = {}
): DocumentSessionController {
  const controller = new DocumentSessionController({
    persistence,
    createRequestId: () => 'coverage-request',
    ...options
  })
  controller.open({
    id: 'controller-session',
    identity: controllerIdentity,
    title: 'controller.bpmn',
    xml: '<old />',
    base: fingerprint('old')
  })
  controller.updateXml('controller-session', '<local />')
  return controller
}

function writablePersistence(
  inspect: SessionPersistence['inspect'] = async () => externalDocument('<old />', 'old')
) {
  return {
    inspect,
    write: vi.fn<SessionPersistence['write']>(
      async (_identity: DocumentIdentity, _xml: string, _options: PersistenceWriteOptions) => ({
        status: 'written' as const,
        fingerprint: fingerprint('written', 2)
      })
    )
  }
}

describe('document session controller release branch coverage', () => {
  it('classifies a failure thrown by reviewed external preparation without mutating XML', async () => {
    const persistence = writablePersistence(async () => externalDocument())
    const controller = controllerFixture(persistence, {
      prepareExternal: async () => {
        throw new DOMException('Review storage exhausted', 'QuotaExceededError')
      }
    })
    const reviewed = await controller.save('controller-session')
    if (reviewed.status !== 'external-conflict') throw new Error('Expected conflict fixture')

    const result = await controller.save('controller-session', {
      reviewedConflict: reviewed.conflict,
      conflictDecision: { kind: 'reload-external' }
    })

    expect(result).toMatchObject({
      status: 'storage-failure',
      failure: { code: 'quota-exceeded' }
    })
    expect(controller.store.get('controller-session')).toMatchObject({
      currentXml: '<local />',
      lastSavedXml: '<old />',
      dirty: true
    })
  })

  it.each([false, true])(
    'handles post-review inspection rejection (abort=%s) without applying reviewed XML',
    async (abortDuringInspection) => {
      const abort = new AbortController()
      let inspections = 0
      const persistence = writablePersistence(async () => {
        inspections += 1
        if (inspections === 4) {
          if (abortDuringInspection) abort.abort()
          throw new DOMException(
            abortDuringInspection ? 'Review cancelled' : 'Storage exhausted',
            abortDuringInspection ? 'AbortError' : 'QuotaExceededError'
          )
        }
        return externalDocument()
      })
      const prepared = vi.fn()
      const controller = controllerFixture(persistence, {
        prepareExternal: async () => ({ status: 'completed', xml: '<reviewed />' }),
        onPreparedExternal: prepared
      })
      const reviewed = await controller.save('controller-session')
      if (reviewed.status !== 'external-conflict') throw new Error('Expected conflict fixture')

      const result = await controller.save('controller-session', {
        signal: abort.signal,
        reviewedConflict: reviewed.conflict,
        conflictDecision: { kind: 'reload-external' }
      })

      expect(result).toMatchObject({
        status: abortDuringInspection ? 'cancelled' : 'storage-failure',
        ok: false
      })
      expect(controller.store.get('controller-session')).toMatchObject({
        currentXml: '<local />',
        lastSavedXml: '<old />',
        dirty: true
      })
      expect(prepared).not.toHaveBeenCalled()
    }
  )

  it('invalidates a reload whose post-apply callback closes the captured incarnation', async () => {
    const persistence = writablePersistence(async () => externalDocument())
    const controller = controllerFixture(persistence, {
      prepareExternal: async () => ({ status: 'completed', xml: '<reviewed />' }),
      onPreparedExternal: async (session) => {
        expect(controller.store.close(session.id)).toBe(true)
      }
    })
    const reviewed = await controller.save('controller-session')
    if (reviewed.status !== 'external-conflict') throw new Error('Expected conflict fixture')

    expect(
      await controller.save('controller-session', {
        reviewedConflict: reviewed.conflict,
        conflictDecision: { kind: 'reload-external' }
      })
    ).toEqual({
      status: 'stale-capture',
      ok: false,
      sessionId: 'controller-session'
    })
    expect(controller.store.get('controller-session')).toBeUndefined()
  })

  it.each([
    {
      name: 'missing destination',
      external: null,
      reason: 'deleted'
    },
    {
      name: 'new untracked destination',
      external: externalDocument('<occupied />', 'occupied', 'copy.bpmn'),
      reason: 'untracked-existing'
    }
  ])('turns an atomic Save-As race at a $name into a fresh conflict', async (fixture) => {
    const writeAs = vi.fn(async () => ({
      status: 'external-conflict' as const,
      external: fixture.external
    }))
    const persistence: SessionPersistence = {
      inspect: async () => externalDocument('<old />', 'old'),
      write: vi.fn(),
      writeAs
    }
    const controller = controllerFixture(persistence)

    const result = await controller.save('controller-session', {
      conflictDecision: { kind: 'save-as', path: 'copy.bpmn' }
    })

    expect(result).toMatchObject({
      status: 'external-conflict',
      decisionStale: true,
      conflict: {
        identity: { path: 'copy.bpmn' },
        reason: fixture.reason,
        external: fixture.external
      }
    })
    expect(writeAs).toHaveBeenCalledOnce()
  })

  it('rejects a Save-As adapter that returns a different identity and releases its reservation', async () => {
    const persistence: SessionPersistence = {
      inspect: async () => externalDocument('<old />', 'old'),
      write: vi.fn(),
      writeAs: vi.fn(async () => ({
        status: 'written' as const,
        identity: { workspace, path: 'wrong.bpmn' },
        fingerprint: fingerprint('wrong')
      }))
    }
    const controller = controllerFixture(persistence)

    expect(
      await controller.save('controller-session', {
        conflictDecision: { kind: 'save-as', path: 'copy.bpmn' }
      })
    ).toMatchObject({
      status: 'storage-failure',
      failure: { code: 'invalid-state' }
    })

    expect(() =>
      controller.open({
        id: 'copy-session',
        identity: { workspace, path: 'copy.bpmn' },
        title: 'copy.bpmn',
        xml: '<copy />'
      })
    ).not.toThrow()
  })

  it('does not write after a Save-As destination reservation becomes stale', async () => {
    const writeAs = vi.fn()
    const persistence: SessionPersistence = {
      inspect: async () => externalDocument('<old />', 'old'),
      write: vi.fn(),
      writeAs
    }
    const controller = controllerFixture(persistence)
    vi.spyOn(controller.store, 'isIdentityReservationCurrent').mockReturnValue(false)

    expect(
      await controller.save('controller-session', {
        conflictDecision: { kind: 'save-as', path: 'copy.bpmn' }
      })
    ).toEqual({
      status: 'stale-capture',
      ok: false,
      sessionId: 'controller-session'
    })
    expect(writeAs).not.toHaveBeenCalled()
  })

  it('prefers cancellation when a storage write rejects after its signal aborts', async () => {
    const abort = new AbortController()
    const persistence = writablePersistence()
    persistence.write.mockImplementation(
      async (_identity: DocumentIdentity, _xml: string, _options: PersistenceWriteOptions) => {
        abort.abort()
        throw new DOMException('Write cancelled', 'AbortError')
      }
    )
    const controller = controllerFixture(persistence)

    expect(
      await controller.save('controller-session', {
        signal: abort.signal
      })
    ).toEqual({
      status: 'cancelled',
      ok: false,
      sessionId: 'controller-session'
    })
    expect(controller.store.get('controller-session')?.dirty).toBe(true)
  })
})

function draftSource(overrides: Partial<DraftSource> = {}): DraftSource {
  return {
    sessionId: 'draft-session',
    incarnation: 1,
    identity: { workspace, path: 'draft.bpmn' },
    currentXml: '<dirty />',
    dirty: true,
    base: { hash: 'base', size: 4, modifiedAt: 1 },
    ...overrides
  }
}

class CapturingTimer implements DraftTimer {
  readonly handles = new Map<number, () => void>()
  readonly cleared: unknown[] = []
  #next = 0

  setTimeout(callback: () => void): unknown {
    const handle = ++this.#next
    this.handles.set(handle, callback)
    return handle
  }

  clearTimeout(handle: unknown): void {
    this.cleared.push(handle)
    this.handles.delete(handle as number)
  }
}

class CapturingLifecycle implements DraftLifecycleTarget {
  readonly listeners = new Map<'blur' | 'pagehide', Set<() => void>>()

  addEventListener(type: 'blur' | 'pagehide', listener: () => void): void {
    const listeners = this.listeners.get(type) ?? new Set()
    listeners.add(listener)
    this.listeners.set(type, listeners)
  }

  removeEventListener(type: 'blur' | 'pagehide', listener: () => void): void {
    this.listeners.get(type)?.delete(listener)
  }
}

describe('draft journal release branch coverage', () => {
  it('covers unknown-base comparison variants and a missing recovery record', async () => {
    const draft = {
      ...draftKeyOf(draftSource()),
      id: 'draft-id',
      xml: '<draft />',
      baseHash: 'base',
      timestamp: 1,
      appVersion: '0.4.5'
    }
    expect(createDraftRecoveryComparison(draft, '<loaded />', null).relation).toBe('unknown-base')
    expect(
      createDraftRecoveryComparison({ ...draft, baseHash: null }, '<loaded />', 'base').relation
    ).toBe('unknown-base')
    expect(
      await findDraftRecoveryComparison(
        new MemoryDraftJournal(),
        draftKeyOf(draftSource()),
        '<loaded />',
        'base'
      )
    ).toBeNull()
  })

  it('treats moving a draft to the same key or from a missing key as a no-op', async () => {
    const journal = new MemoryDraftJournal()
    const from = draftKeyOf(draftSource())
    const to = draftKeyOf(draftSource({ identity: { workspace, path: 'another-draft.bpmn' } }))

    await journal.move(from, from)
    await journal.move(from, to)

    expect(await journal.get(from)).toBeNull()
    expect(await journal.get(to)).toBeNull()
  })

  it('tracks full document sessions and persists a null base hash', async () => {
    const store = new DocumentSessionStore()
    store.open({
      id: 'document-session',
      identity: { workspace, path: 'document.bpmn' },
      title: 'document.bpmn',
      xml: '<saved />',
      base: null
    })
    const dirty = store.updateXml('document-session', '<dirty />')
    const journal = new MemoryDraftJournal()
    const coordinator = new DraftJournalCoordinator(journal, { appVersion: '0.4.5' })

    coordinator.track(dirty)
    await coordinator.flush(dirty.id, dirty.incarnation)

    expect(
      await journal.get({
        workspaceId: workspace.id,
        path: 'document.bpmn',
        sessionId: dirty.id
      })
    ).toMatchObject({ xml: '<dirty />', baseHash: null })
    coordinator.dispose()
  })

  it('rolls a delete migration back once and makes repeated rollback idempotent', async () => {
    const journal = new MemoryDraftJournal()
    const coordinator = new DraftJournalCoordinator(journal, { appVersion: '0.4.5' })
    const source = draftSource()
    coordinator.track(source)
    await coordinator.flush(source.sessionId, source.incarnation)

    const migration = await coordinator.migrateDraftRecords([
      {
        sessionId: source.sessionId,
        incarnation: source.incarnation,
        from: source.identity,
        to: null
      }
    ])
    expect(await journal.get(draftKeyOf(source))).toBeNull()

    await migration.rollback()
    expect(await journal.get(draftKeyOf(source))).toMatchObject({ xml: source.currentXml })
    await migration.rollback()
    expect(await journal.get(draftKeyOf(source))).toMatchObject({ xml: source.currentXml })
  })

  it('dispose cancels pending timers and detaches every lifecycle listener', () => {
    const timer = new CapturingTimer()
    const lifecycle = new CapturingLifecycle()
    const coordinator = new DraftJournalCoordinator(new MemoryDraftJournal(), {
      appVersion: '0.4.5',
      timer
    })
    coordinator.attachLifecycle(lifecycle)
    coordinator.track(draftSource())

    expect(timer.handles.size).toBe(1)
    expect(lifecycle.listeners.get('blur')?.size).toBe(1)
    expect(lifecycle.listeners.get('pagehide')?.size).toBe(1)

    coordinator.dispose()

    expect(timer.handles.size).toBe(0)
    expect(timer.cleared).toHaveLength(1)
    expect(lifecycle.listeners.get('blur')?.size).toBe(0)
    expect(lifecycle.listeners.get('pagehide')?.size).toBe(0)
  })
})
