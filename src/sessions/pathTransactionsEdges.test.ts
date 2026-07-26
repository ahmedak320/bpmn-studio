import { describe, expect, it, vi } from 'vitest'

import {
  confirmPathDelete,
  executePathTransaction,
  migratePath,
  normalizeWorkspacePath,
  planPathTransaction,
  resolveDirtyPathDecision,
  type PathTransactionPlan
} from './pathTransactions'
import { DocumentSessionStore } from './store'
import type { DocumentIdentity } from './types'

const workspace = { id: 'ws', generation: 1, mode: 'directory' as const }
const identity = (path: string | null): DocumentIdentity => ({ workspace, path })

function oneSession(dirty = false) {
  const store = new DocumentSessionStore({ createId: () => 'session' })
  const session = store.open({
    identity: identity('folder/a.bpmn'),
    title: 'a.bpmn',
    xml: '<saved/>'
  })
  if (dirty) store.updateXml(session.id, '<dirty/>')
  return { store, session: store.get(session.id)! }
}

function movePlan(
  store: DocumentSessionStore,
  dirtyDecision?: 'save-and-continue' | 'continue-without-saving'
) {
  const planned = planPathTransaction(store.list(), {
    id: 'move',
    kind: 'move',
    workspaceId: 'ws',
    entryKind: 'directory',
    sourcePath: 'folder',
    destinationPath: 'archive'
  })
  return dirtyDecision ? resolveDirtyPathDecision(planned, dirtyDecision) : planned
}

const successfulDependencies = {
  saveSession: async (sessionId: string) => ({
    sessionId,
    ok: true,
    status: 'success'
  }),
  mutateStorage: async () => ({ rollback: async () => undefined })
}

describe('path transaction edge behavior', () => {
  it('normalizes portable separators and rejects every unsafe path shape', () => {
    expect(normalizeWorkspacePath('./folder\\\\nested//a.bpmn')).toBe('folder/nested/a.bpmn')
    for (const path of ['', '/', '/absolute', 'trailing/', '.', '..', 'a/./b', 'a/../b']) {
      expect(() => normalizeWorkspacePath(path)).toThrow(/Invalid workspace path/)
    }
    expect(migratePath('unrelated/a.bpmn', 'folder', 'new', 'directory')).toBe('unrelated/a.bpmn')
    expect(migratePath('folder/a.bpmn', 'folder/a.bpmn', 'renamed.bpmn', 'file')).toBe(
      'renamed.bpmn'
    )
  })

  it('rejects missing/identical destinations and ignores unrelated workspaces and virtual paths', () => {
    const { store, session } = oneSession()
    expect(() =>
      planPathTransaction(store.list(), {
        id: 'missing',
        kind: 'move',
        workspaceId: 'ws',
        entryKind: 'file',
        sourcePath: 'folder/a.bpmn'
      })
    ).toThrow(/Invalid workspace path/)
    expect(() =>
      planPathTransaction(store.list(), {
        id: 'same',
        kind: 'rename',
        workspaceId: 'ws',
        entryKind: 'file',
        sourcePath: 'folder/a.bpmn',
        destinationPath: 'folder/a.bpmn'
      })
    ).toThrow(/identical/)

    const unrelated = {
      ...session,
      id: 'other-workspace',
      identity: {
        workspace: { ...workspace, id: 'other' },
        path: 'folder/other.bpmn'
      }
    }
    const virtual = {
      ...session,
      id: 'virtual',
      identity: identity(null)
    }
    const outside = {
      ...session,
      id: 'outside',
      identity: identity('elsewhere/outside.bpmn')
    }
    const plan = planPathTransaction([unrelated, virtual, outside], {
      id: 'none',
      kind: 'move',
      workspaceId: 'ws',
      entryKind: 'directory',
      sourcePath: 'folder',
      destinationPath: 'archive'
    })
    expect(plan.affectedSessionIds).toEqual([])
    expect(plan.phase).toBe('ready')
  })

  it('rejects duplicate planned destinations before any transaction starts', () => {
    const { session } = oneSession()
    expect(() =>
      planPathTransaction(
        [
          session,
          {
            ...session,
            id: 'duplicate',
            identity: identity('folder/a.bpmn')
          }
        ],
        {
          id: 'duplicate',
          kind: 'move',
          workspaceId: 'ws',
          entryKind: 'directory',
          sourcePath: 'folder',
          destinationPath: 'archive'
        }
      )
    ).toThrow(/duplicate sessions/)
  })

  it('handles clean/non-delete confirmation and invalid dirty decisions', () => {
    const { store } = oneSession()
    const move = movePlan(store)
    expect(move.phase).toBe('ready')
    expect(confirmPathDelete(move)).toBe(move)
    expect(() => resolveDirtyPathDecision(move, 'continue-without-saving')).toThrow(
      /Cannot resolve/
    )

    const deletion = planPathTransaction(store.list(), {
      id: 'delete',
      kind: 'delete',
      workspaceId: 'ws',
      entryKind: 'directory',
      sourcePath: 'folder'
    })
    expect(confirmPathDelete(deletion).phase).toBe('ready')
  })

  it('returns every pre-mutation terminal outcome truthfully', async () => {
    const { store } = oneSession(true)
    const unconfirmed = planPathTransaction(store.list(), {
      id: 'delete',
      kind: 'delete',
      workspaceId: 'ws',
      entryKind: 'directory',
      sourcePath: 'folder'
    })
    await expect(
      executePathTransaction(store, unconfirmed, successfulDependencies)
    ).resolves.toMatchObject({ status: 'needs-delete-confirmation' })

    const awaiting = movePlan(store)
    await expect(executePathTransaction(store, awaiting, successfulDependencies)).rejects.toThrow(
      /decision is required/
    )

    const cancelled = resolveDirtyPathDecision(awaiting, 'cancel')
    await expect(
      executePathTransaction(store, cancelled, successfulDependencies)
    ).resolves.toMatchObject({ status: 'cancelled' })

    const invalid = { ...cancelled, phase: 'failed' as const }
    await expect(executePathTransaction(store, invalid, successfulDependencies)).rejects.toThrow(
      /not ready/
    )
  })

  it('continues after successful dirty saves and blocks still-dirty outcomes', async () => {
    const first = oneSession(true)
    const saving = movePlan(first.store, 'save-and-continue')
    const committed = await executePathTransaction(first.store, saving, {
      ...successfulDependencies,
      saveSession: async (sessionId) => {
        const live = first.store.get(sessionId)!
        first.store.markSaved(sessionId, {
          xml: live.currentXml,
          savedRevision: live.revision,
          fingerprint: { hash: 'saved', size: 8, modifiedAt: 2 }
        })
        return { sessionId, ok: true, status: 'success' }
      }
    })
    expect(committed.status).toBe('committed')

    const second = oneSession(true)
    const remainsDirty = await executePathTransaction(
      second.store,
      movePlan(second.store, 'save-and-continue'),
      {
        ...successfulDependencies,
        saveSession: async (sessionId) => ({
          sessionId,
          ok: true,
          status: 'success',
          remainingDirty: true
        })
      }
    )
    expect(remainsDirty.status).toBe('save-failed')
  })

  it('commits a confirmed clean delete and skips sessions already closed from phase publication', async () => {
    const { store, session } = oneSession()
    const deletion = confirmPathDelete(
      planPathTransaction(store.list(), {
        id: 'delete',
        kind: 'delete',
        workspaceId: 'ws',
        entryKind: 'directory',
        sourcePath: 'folder'
      })
    )
    const result = await executePathTransaction(store, deletion, successfulDependencies)
    expect(result.status).toBe('committed')
    expect(store.get(session.id)).toBeUndefined()

    const another = oneSession()
    const stale = movePlan(another.store)
    another.store.close(another.session.id)
    await expect(
      executePathTransaction(another.store, stale, successfulDependencies)
    ).resolves.toMatchObject({ status: 'failed', rolledBack: false })
  })

  it('rolls back both layers and reports rollback failures without hiding the cause', async () => {
    const { store, session } = oneSession()
    const plan = movePlan(store)
    const draftRollback = vi.fn(async () => {
      throw new Error('draft rollback failed')
    })
    const storageRollback = vi.fn(async () => {
      throw new Error('storage rollback failed')
    })
    const result = await executePathTransaction(store, plan, {
      saveSession: successfulDependencies.saveSession,
      mutateStorage: async () => ({ rollback: storageRollback }),
      migrateDrafts: async () => {
        store.updateXml(session.id, '<changed-during-migration/>')
        return { rollback: draftRollback }
      }
    })
    expect(result).toMatchObject({ status: 'failed', rolledBack: false })
    expect(draftRollback).toHaveBeenCalledOnce()
    expect(storageRollback).toHaveBeenCalledOnce()
  })

  it('handles a malformed non-delete migration and non-Error storage failures', async () => {
    const { store } = oneSession()
    const valid = movePlan(store)
    const malformed: PathTransactionPlan = {
      ...valid,
      migrations: valid.migrations.map((migration) => ({
        ...migration,
        to: null
      }))
    }
    await expect(
      executePathTransaction(store, malformed, successfulDependencies)
    ).resolves.toMatchObject({ status: 'failed', rolledBack: true })

    const another = oneSession()
    const nonError = await executePathTransaction(another.store, movePlan(another.store), {
      saveSession: successfulDependencies.saveSession,
      mutateStorage: async () => {
        throw 'storage unavailable'
      }
    })
    expect(nonError).toMatchObject({
      status: 'failed',
      rolledBack: true,
      error: 'storage unavailable',
      plan: { error: 'storage unavailable' }
    })
  })
})
