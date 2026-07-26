import { describe, expect, it, vi } from 'vitest'
import { createBeforeUnloadHandler, hasDirtySessions } from './beforeUnload'
import { ActiveSessionCommandRouter } from './commandRouter'
import {
  classifyExternalState,
  isTerminalConflictDecision,
  type ExternalDocument
} from './externalConflict'
import {
  confirmPathDelete,
  executePathTransaction,
  migratePath,
  pathIsAffected,
  planPathTransaction,
  resolveDirtyPathDecision
} from './pathTransactions'
import { DocumentSessionStore } from './store'
import type { DocumentIdentity, FileFingerprint } from './types'

const workspace = { id: 'ws', generation: 1, mode: 'directory' as const }
const identity = (path: string): DocumentIdentity => ({ workspace, path })
const fp = (hash: string, modifiedAt = 1): FileFingerprint => ({
  hash,
  size: hash.length,
  modifiedAt
})

describe('active-session command routing', () => {
  it('routes Ctrl/Cmd+S only to the active session', () => {
    let active: string | null = 'foreground'
    const router = new ActiveSessionCommandRouter(() => active)
    const foregroundSave = vi.fn()
    const backgroundSave = vi.fn()
    router.register('foreground', { save: foregroundSave })
    router.register('background', { save: backgroundSave })
    const preventDefault = vi.fn()

    const result = router.handleKeyDown({
      key: 's',
      ctrlKey: true,
      metaKey: false,
      preventDefault
    })

    expect(result).toMatchObject({ status: 'invoked', sessionId: 'foreground' })
    expect(foregroundSave).toHaveBeenCalledOnce()
    expect(backgroundSave).not.toHaveBeenCalled()
    expect(preventDefault).toHaveBeenCalledOnce()

    active = 'background'
    router.handleKeyDown({
      key: 'S',
      ctrlKey: false,
      metaKey: true,
      preventDefault
    })
    expect(backgroundSave).toHaveBeenCalledOnce()
  })

  it('does not route Alt/Shift variants or key-repeat', () => {
    const save = vi.fn()
    const router = new ActiveSessionCommandRouter(() => 's')
    router.register('s', { save })
    const event = { key: 's', ctrlKey: true, metaKey: false, preventDefault: vi.fn() }
    expect(router.handleKeyDown({ ...event, altKey: true })).toBeNull()
    expect(router.handleKeyDown({ ...event, shiftKey: true })).toBeNull()
    expect(router.handleKeyDown({ ...event, repeat: true })).toMatchObject({
      status: 'unavailable'
    })
    expect(save).not.toHaveBeenCalled()
  })

  it('protects a newer command registration from stale cleanup', () => {
    const router = new ActiveSessionCommandRouter(() => 's')
    const oldSave = vi.fn()
    const newSave = vi.fn()
    const cleanupOld = router.register('s', { save: oldSave })
    router.register('s', { save: newSave })
    cleanupOld()

    router.route('save')
    expect(oldSave).not.toHaveBeenCalled()
    expect(newSave).toHaveBeenCalledOnce()
  })
})

describe('beforeunload dirty guard', () => {
  it('guards whenever any session is dirty and leaves clean unloads alone', () => {
    let sessions = [{ dirty: false }, { dirty: true }]
    expect(hasDirtySessions(sessions)).toBe(true)
    const handler = createBeforeUnloadHandler(() => sessions)
    const event = { preventDefault: vi.fn(), returnValue: 'untouched' }
    handler(event)
    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(event.returnValue).toBe('')

    sessions = [{ dirty: false }]
    const clean = { preventDefault: vi.fn(), returnValue: 'untouched' }
    handler(clean)
    expect(clean.preventDefault).not.toHaveBeenCalled()
    expect(clean.returnValue).toBe('untouched')
  })
})

describe('external fingerprint decisions', () => {
  const current = (hash: string, modifiedAt = 1): ExternalDocument => ({
    identity: identity('a.bpmn'),
    xml: `<${hash}/>`,
    fingerprint: fp(hash, modifiedAt)
  })

  it('uses hash as authority and treats timestamp-only changes as metadata-only', () => {
    expect(classifyExternalState(fp('same', 1), current('same', 2))).toEqual({
      kind: 'unchanged',
      current: current('same', 2),
      metadataChanged: true
    })
    expect(classifyExternalState(fp('SAME', 1), current('same', 1)).kind).toBe('unchanged')
    expect(classifyExternalState(fp('old'), current('new')).kind).toBe('modified')
  })

  it('distinguishes deleted and pre-existing untracked destinations', () => {
    expect(classifyExternalState(fp('old'), null).kind).toBe('deleted')
    expect(classifyExternalState(null, current('existing')).kind).toBe('untracked-existing')
    expect(classifyExternalState(null, null).kind).toBe('new')
  })

  it('keeps Compare nonterminal and requires confirmed overwrite in the type', () => {
    expect(isTerminalConflictDecision({ kind: 'compare' })).toBe(false)
    expect(isTerminalConflictDecision({ kind: 'overwrite', confirmed: true })).toBe(true)
  })
})

describe('path transaction planning and execution', () => {
  function sessions() {
    let n = 0
    const store = new DocumentSessionStore({ createId: () => `s${++n}` })
    const modeler = {}
    const a = store.open({
      identity: identity('folder/a.bpmn'),
      title: 'a.bpmn',
      xml: '<a/>',
      editor: { modeler }
    })
    const b = store.open({
      identity: identity('folder/nested/b.bpmn'),
      title: 'b.bpmn',
      xml: '<b/>'
    })
    store.updateXml(a.id, '<dirty-a/>')
    store.setActive(a.id)
    return { store, a, b, modeler }
  }

  it('detects every affected nested dirty session and preserves suffixes', () => {
    const { store, a, b } = sessions()
    const plan = planPathTransaction(store.list(), {
      id: 'tx',
      kind: 'move',
      workspaceId: 'ws',
      entryKind: 'directory',
      sourcePath: 'folder',
      destinationPath: 'archive/folder'
    })

    expect(plan.phase).toBe('awaiting-dirty-decision')
    expect(plan.affectedSessionIds).toEqual([a.id, b.id])
    expect(plan.dirtySessionIds).toEqual([a.id])
    expect(plan.migrations.map((migration) => migration.to?.path)).toEqual([
      'archive/folder/a.bpmn',
      'archive/folder/nested/b.bpmn'
    ])
    expect(pathIsAffected('folderish/a.bpmn', 'folder', 'directory')).toBe(false)
    expect(migratePath('folder/x/a.bpmn', 'folder', 'new', 'directory')).toBe(
      'new/x/a.bpmn'
    )
  })

  it('requires both typed/UI delete confirmation and a dirty-work decision', () => {
    const { store } = sessions()
    let plan = planPathTransaction(store.list(), {
      id: 'delete',
      kind: 'delete',
      workspaceId: 'ws',
      entryKind: 'directory',
      sourcePath: 'folder'
    })
    expect(plan.phase).toBe('needs-delete-confirmation')
    plan = confirmPathDelete(plan)
    expect(plan.phase).toBe('awaiting-dirty-decision')
    expect(resolveDirtyPathDecision(plan, 'cancel').phase).toBe('cancelled')
    expect(resolveDirtyPathDecision(plan, 'continue-without-saving').phase).toBe('ready')
  })

  it('aborts the storage mutation if saving any affected dirty session fails', async () => {
    const { store } = sessions()
    const readyToSave = resolveDirtyPathDecision(
      planPathTransaction(store.list(), {
        id: 'tx',
        kind: 'move',
        workspaceId: 'ws',
        entryKind: 'directory',
        sourcePath: 'folder',
        destinationPath: 'new'
      }),
      'save-and-continue'
    )
    const mutateStorage = vi.fn()
    const result = await executePathTransaction(store, readyToSave, {
      saveSession: async (sessionId) => ({ sessionId, ok: false, status: 'permission-loss' }),
      mutateStorage
    })
    expect(result.status).toBe('save-failed')
    expect(mutateStorage).not.toHaveBeenCalled()
    expect(store.list().map((session) => session.identity.path)).toEqual([
      'folder/a.bpmn',
      'folder/nested/b.bpmn'
    ])
  })

  it('commits all live identities at once without replacing the modeler or active id', async () => {
    const { store, a, modeler } = sessions()
    const plan = resolveDirtyPathDecision(
      planPathTransaction(store.list(), {
        id: 'tx',
        kind: 'rename',
        workspaceId: 'ws',
        entryKind: 'directory',
        sourcePath: 'folder',
        destinationPath: 'renamed'
      }),
      'continue-without-saving'
    )
    const publishedPaths: Array<Array<string | null>> = []
    store.subscribe(() => {
      publishedPaths.push(store.list().map((session) => session.identity.path))
    })
    const result = await executePathTransaction(store, plan, {
      saveSession: async (sessionId) => ({ sessionId, ok: true, status: 'success' }),
      mutateStorage: async () => ({ rollback: async () => undefined }),
      migrateDrafts: async () => ({ rollback: async () => undefined })
    })

    expect(result.status).toBe('committed')
    expect(store.get(a.id)).toMatchObject({
      identity: { path: 'renamed/a.bpmn' },
      modeler,
      pathMigration: { transactionId: 'tx', phase: 'committed' }
    })
    expect(store.getSnapshot().activeSessionId).toBe(a.id)
    // State phases may publish, but no observer can ever see a half-migrated
    // pair (one old path and one new path).
    expect(publishedPaths).not.toContainEqual([
      'renamed/a.bpmn',
      'folder/nested/b.bpmn'
    ])
    expect(publishedPaths).not.toContainEqual([
      'folder/a.bpmn',
      'renamed/nested/b.bpmn'
    ])
    expect(publishedPaths.at(-1)).toEqual([
      'renamed/a.bpmn',
      'renamed/nested/b.bpmn'
    ])
  })

  it('rolls storage back and leaves session identities untouched if draft migration fails', async () => {
    const { store } = sessions()
    const plan = resolveDirtyPathDecision(
      planPathTransaction(store.list(), {
        id: 'tx',
        kind: 'move',
        workspaceId: 'ws',
        entryKind: 'directory',
        sourcePath: 'folder',
        destinationPath: 'new'
      }),
      'continue-without-saving'
    )
    const rollbackStorage = vi.fn(async () => undefined)
    const result = await executePathTransaction(store, plan, {
      saveSession: async (sessionId) => ({ sessionId, ok: true, status: 'success' }),
      mutateStorage: async () => ({ rollback: rollbackStorage }),
      migrateDrafts: async () => {
        throw new Error('draft failure')
      }
    })

    expect(result).toMatchObject({ status: 'failed', rolledBack: true })
    expect(rollbackStorage).toHaveBeenCalledOnce()
    expect(store.list().map((session) => session.identity.path)).toEqual([
      'folder/a.bpmn',
      'folder/nested/b.bpmn'
    ])
  })

  it('will not mutate paths while an affected session save is still in flight', async () => {
    const { store, a } = sessions()
    store.setSaveState(a.id, {
      phase: 'writing',
      requestId: 'save',
      startedRevision: a.revision,
      startedAt: 1,
      lastOutcome: null
    })
    const plan = resolveDirtyPathDecision(
      planPathTransaction(store.list(), {
        id: 'tx',
        kind: 'move',
        workspaceId: 'ws',
        entryKind: 'directory',
        sourcePath: 'folder',
        destinationPath: 'new'
      }),
      'continue-without-saving'
    )
    const mutateStorage = vi.fn()

    expect(
      await executePathTransaction(store, plan, {
        saveSession: async (sessionId) => ({ sessionId, ok: true, status: 'success' }),
        mutateStorage
      })
    ).toMatchObject({ status: 'failed', rolledBack: false })
    expect(mutateStorage).not.toHaveBeenCalled()
  })

  it('rolls the storage mutation back if a live editor changes during path I/O', async () => {
    const { store, a } = sessions()
    const plan = resolveDirtyPathDecision(
      planPathTransaction(store.list(), {
        id: 'tx',
        kind: 'move',
        workspaceId: 'ws',
        entryKind: 'directory',
        sourcePath: 'folder',
        destinationPath: 'new'
      }),
      'continue-without-saving'
    )
    const rollback = vi.fn(async () => undefined)
    const result = await executePathTransaction(store, plan, {
      saveSession: async (sessionId) => ({ sessionId, ok: true, status: 'success' }),
      mutateStorage: async () => {
        store.updateXml(a.id, '<edit-during-move/>')
        return { rollback }
      }
    })

    expect(result).toMatchObject({ status: 'failed', rolledBack: true })
    expect(rollback).toHaveBeenCalledOnce()
    expect(store.get(a.id)).toMatchObject({
      identity: { path: 'folder/a.bpmn' },
      currentXml: '<edit-during-move/>',
      dirty: true
    })
  })
})
