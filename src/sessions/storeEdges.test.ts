import { describe, expect, it, vi } from 'vitest'

import { DocumentSessionStore } from './store'
import type { DocumentIdentity } from './types'

const workspace = { id: 'ws', generation: 1, mode: 'directory' as const }
const identity = (path: string): DocumentIdentity => ({ workspace, path })

describe('DocumentSessionStore edge behavior', () => {
  it('covers explicit defaults, duplicate ids, active selection, and close outcomes', () => {
    const store = new DocumentSessionStore({ createId: () => 'generated' })
    const first = store.open({
      id: 'explicit',
      identity: identity('a.bpmn'),
      title: 'a',
      xml: '<current/>',
      lastSavedXml: '<saved/>',
      editor: { readXml: async () => '<current/>' }
    })
    expect(first).toMatchObject({
      id: 'explicit',
      dirty: true,
      modeler: null,
      commandStack: null
    })
    expect(first.readXml).toBeTypeOf('function')

    expect(() =>
      store.open({
        id: 'explicit',
        identity: identity('b.bpmn'),
        title: 'b',
        xml: '<b/>'
      })
    ).toThrow(/already exists/)
    expect(() => store.setActive('missing')).toThrow(/unknown/)
    store.setActive('explicit')
    expect(store.close('missing')).toBe(false)

    const second = store.open({
      identity: identity('b.bpmn'),
      title: 'b',
      xml: '<b/>'
    })
    store.setActive(second.id)
    expect(store.close('explicit')).toBe(true)
    expect(store.getActive()?.id).toBe(second.id)
    expect(store.close(second.id)).toBe(true)
    expect(store.getActive()).toBeUndefined()
    expect(store.getByIdentity(identity('missing.bpmn'))).toBeUndefined()
  })

  it('retains matching validation, updates editor seams, and treats no-op updates as stable', () => {
    const modeler = {}
    const commandStack = {}
    const readXml = async () => '<read/>'
    const store = new DocumentSessionStore({ createId: () => 's' })
    const opened = store.open({
      identity: identity('a.bpmn'),
      title: 'a',
      xml: '<a/>',
      validation: { status: 'valid', revision: 1, issues: [] }
    })

    expect(store.updateXml(opened.id, '<a/>')).toBe(opened)
    const edited = store.updateXml(opened.id, '<edited/>')
    expect(edited.validation).toEqual({
      status: 'valid',
      revision: 1,
      issues: []
    })
    const bound = store.bindEditor(opened.id, {
      modeler,
      commandStack,
      readXml
    })
    expect(bound).toMatchObject({ modeler, commandStack, readXml })
    expect(store.bindEditor(opened.id, {})).toMatchObject({
      modeler,
      commandStack,
      readXml
    })
    expect(store.bindEditor(opened.id, { readXml: null }).readXml).toBeNull()
  })

  it('marks saved under a new identity/title and replaces equal external XML without a revision bump', () => {
    const store = new DocumentSessionStore({ createId: () => 's' })
    const opened = store.open({
      identity: identity('a.bpmn'),
      title: 'a',
      xml: '<a/>'
    })
    const moved = store.markSaved(opened.id, {
      xml: '<a/>',
      savedRevision: 0,
      fingerprint: { hash: 'a', size: 4, modifiedAt: 1 },
      identity: identity('renamed.bpmn'),
      title: 'renamed'
    })
    expect(moved).toMatchObject({
      identity: { path: 'renamed.bpmn' },
      title: 'renamed'
    })
    const same = store.replaceWithExternal(opened.id, {
      xml: '<a/>',
      fingerprint: { hash: 'same', size: 4, modifiedAt: 2 }
    })
    expect(same.revision).toBe(0)
  })

  it('validates every migration and update invariant before publishing', () => {
    let id = 0
    const store = new DocumentSessionStore({ createId: () => `s${++id}` })
    const first = store.open({
      identity: identity('a.bpmn'),
      title: 'a',
      xml: '<a/>'
    })
    const second = store.open({
      identity: identity('b.bpmn'),
      title: 'b',
      xml: '<b/>'
    })

    expect(() =>
      store.migrateIdentities([
        {
          sessionId: 'missing',
          incarnation: 0,
          from: identity('missing.bpmn'),
          to: identity('new.bpmn')
        }
      ])
    ).toThrow(/Unknown document session/)
    expect(() =>
      store.migrateIdentities([
        {
          sessionId: first.id,
          incarnation: first.incarnation,
          from: first.identity,
          to: identity('same.bpmn')
        },
        {
          sessionId: second.id,
          incarnation: second.incarnation,
          from: second.identity,
          to: identity('same.bpmn')
        }
      ])
    ).toThrow(/Duplicate path transaction destination/)

    store.migrateIdentities([
      {
        sessionId: first.id,
        incarnation: first.incarnation,
        from: first.identity,
        to: identity('moved.bpmn')
      }
    ])
    expect(store.get(first.id)?.pathMigration.transactionId).toBeNull()

    expect(() => store.update('missing', (session) => session)).toThrow(/Unknown/)
    const current = store.get(first.id)!
    expect(store.update(first.id, (session) => session)).toBe(current)
    expect(() => store.update(first.id, (session) => ({ ...session, id: 'changed' }))).toThrow(
      /immutable/
    )
    expect(() =>
      store.update(first.id, (session) => ({
        ...session,
        identity: second.identity
      }))
    ).toThrow(/already open/)
  })

  it('batches nested updates into one listener publication', () => {
    let id = 0
    const store = new DocumentSessionStore({ createId: () => `s${++id}` })
    const session = store.open({
      identity: identity('a.bpmn'),
      title: 'a',
      xml: '<a/>'
    })
    const listener = vi.fn()
    store.subscribe(listener)
    store.batch(() => {
      store.batch(() => {
        store.setDraftRecovery(session.id, {
          status: 'error',
          message: 'draft unavailable'
        })
      })
      store.setValidation(session.id, {
        status: 'invalid',
        revision: 0,
        issues: []
      })
    })
    expect(listener).toHaveBeenCalledOnce()
  })
})
