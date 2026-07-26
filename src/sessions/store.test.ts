import { describe, expect, it, vi } from 'vitest'
import { DocumentSessionStore } from './store'
import type { DocumentIdentity, FileFingerprint } from './types'

const workspace = { id: 'workspace-a', generation: 3, mode: 'directory' as const }
const identity = (path: string): DocumentIdentity => ({ workspace, path })
const fingerprint = (hash: string): FileFingerprint => ({
  hash,
  size: hash.length,
  modifiedAt: 100
})

describe('DocumentSessionStore', () => {
  it('owns the complete per-tab state and publishes coherent snapshots', () => {
    let now = 10
    const modeler = {}
    const commandStack = {}
    const store = new DocumentSessionStore({
      now: () => now++,
      createId: () => 'session-1'
    })
    const listener = vi.fn()
    store.subscribe(listener)

    const session = store.open({
      identity: identity('sales/order.bpmn'),
      title: 'order.bpmn',
      xml: '<saved/>',
      base: fingerprint('base'),
      editor: { modeler, commandStack }
    })

    expect(session).toMatchObject({
      id: 'session-1',
      identity: identity('sales/order.bpmn'),
      currentXml: '<saved/>',
      lastSavedXml: '<saved/>',
      dirty: false,
      revision: 0,
      base: fingerprint('base'),
      modeler,
      commandStack,
      validation: { status: 'unknown' },
      draftRecovery: { status: 'none' },
      save: { phase: 'idle' },
      pathMigration: { phase: 'idle' }
    })
    expect(store.getSnapshot().activeSessionId).toBe('session-1')
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('derives dirty state from current and last-saved XML', () => {
    const store = new DocumentSessionStore({ createId: () => 's' })
    store.open({ identity: identity('a.bpmn'), title: 'a', xml: 'one' })
    const edited = store.updateXml('s', 'two')
    expect(edited.dirty).toBe(true)
    expect(edited.revision).toBe(1)

    const saved = store.markSaved('s', {
      xml: 'two',
      savedRevision: 1,
      fingerprint: fingerprint('two')
    })
    expect(saved.dirty).toBe(false)
    expect(saved.lastSavedXml).toBe('two')

    expect(store.updateXml('s', 'one').dirty).toBe(true)
    expect(store.updateXml('s', 'two').dirty).toBe(false)
  })

  it('keeps the first session for an already-open identity', () => {
    const store = new DocumentSessionStore({ createId: () => 's' })
    const first = store.open({ identity: identity('a.bpmn'), title: 'a', xml: 'one' })
    const duplicate = store.open({
      id: 'different',
      identity: identity('a.bpmn'),
      title: 'other',
      xml: 'two'
    })
    expect(duplicate).toBe(first)
    expect(store.list()).toHaveLength(1)
  })

  it('allows multiple virtual sessions without a filesystem identity', () => {
    const store = new DocumentSessionStore()
    const virtualIdentity: DocumentIdentity = { workspace, path: null }
    store.open({ id: 'virtual:1', identity: virtualIdentity, title: 'one', xml: 'one' })
    store.open({ id: 'virtual:2', identity: virtualIdentity, title: 'two', xml: 'two' })

    expect(store.list().map((session) => session.id)).toEqual(['virtual:1', 'virtual:2'])
    expect(store.getByIdentity(virtualIdentity)).toBeUndefined()
  })

  it('migrates multiple identities atomically without replacing editor bindings', () => {
    let nextId = 0
    const store = new DocumentSessionStore({ createId: () => `s${++nextId}` })
    const modelerA = {}
    const modelerB = {}
    const a = store.open({
      identity: identity('folder/a.bpmn'),
      title: 'a.bpmn',
      xml: 'a',
      editor: { modeler: modelerA }
    })
    const b = store.open({
      identity: identity('folder/nested/b.bpmn'),
      title: 'b.bpmn',
      xml: 'b',
      editor: { modeler: modelerB }
    })
    store.setActive(b.id)
    const listener = vi.fn()
    store.subscribe(listener)

    store.migrateIdentities([
      {
        sessionId: a.id,
        from: a.identity,
        to: identity('renamed/a.bpmn'),
        transactionId: 'tx'
      },
      {
        sessionId: b.id,
        from: b.identity,
        to: identity('renamed/nested/b.bpmn'),
        transactionId: 'tx'
      }
    ])

    expect(listener).toHaveBeenCalledTimes(1)
    expect(store.get(a.id)?.modeler).toBe(modelerA)
    expect(store.get(b.id)?.modeler).toBe(modelerB)
    expect(store.get(b.id)?.identity.path).toBe('renamed/nested/b.bpmn')
    expect(store.getSnapshot().activeSessionId).toBe(b.id)
    expect(store.getByIdentity(identity('folder/a.bpmn'))).toBeUndefined()
    expect(store.getByIdentity(identity('renamed/a.bpmn'))?.id).toBe(a.id)
  })

  it('rejects stale or colliding identity migrations before changing anything', () => {
    let nextId = 0
    const store = new DocumentSessionStore({ createId: () => `s${++nextId}` })
    const a = store.open({ identity: identity('a.bpmn'), title: 'a', xml: 'a' })
    store.open({ identity: identity('occupied.bpmn'), title: 'occupied', xml: 'b' })

    expect(() =>
      store.migrateIdentities([
        {
          sessionId: a.id,
          from: identity('wrong.bpmn'),
          to: identity('new.bpmn')
        }
      ])
    ).toThrow(/changed during path transaction/)
    expect(() =>
      store.migrateIdentities([
        {
          sessionId: a.id,
          from: identity('a.bpmn'),
          to: identity('occupied.bpmn')
        }
      ])
    ).toThrow(/already open/)
    expect(store.get(a.id)?.identity.path).toBe('a.bpmn')
  })
})
