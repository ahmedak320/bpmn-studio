import { describe, expect, it, vi } from 'vitest'
import {
  DocumentSessionController,
  type PersistenceWriteResult,
  type SessionPersistence
} from './controller'
import type { ExternalDocument } from './externalConflict'
import type { DocumentIdentity, FileFingerprint } from './types'

const workspace = { id: 'ws', generation: 1, mode: 'directory' as const }

function identity(path: string): DocumentIdentity {
  return { workspace, path }
}

function fingerprint(hash: string, modifiedAt = 1): FileFingerprint {
  return { hash, size: hash.length, modifiedAt }
}

function external(path: string, xml = '<old/>'): ExternalDocument {
  return {
    identity: identity(path),
    xml,
    fingerprint: fingerprint('old')
  }
}

function deferred<T>(): {
  promise: Promise<T>
  resolve(value: T): void
  reject(error: unknown): void
} {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function openSource(controller: DocumentSessionController): void {
  controller.open({
    id: 'source',
    identity: identity('source.bpmn'),
    title: 'source.bpmn',
    xml: '<old/>',
    base: fingerprint('old')
  })
  controller.updateXml('source', '<local/>')
}

function unchangedInspect(target: DocumentIdentity): Promise<ExternalDocument | null> {
  return Promise.resolve(target.path === 'source.bpmn' ? external('source.bpmn') : null)
}

describe('session incarnation and Save-As reservations', () => {
  it('does not let a deferred write completion acknowledge a reopened same-id session', async () => {
    const pendingWrite = deferred<PersistenceWriteResult>()
    const write = vi.fn(async () => pendingWrite.promise)
    const onConfirmedSave = vi.fn()
    const persistence: SessionPersistence = {
      inspect: unchangedInspect,
      write
    }
    const controller = new DocumentSessionController({ persistence, onConfirmedSave })
    openSource(controller)
    const originalIncarnation = controller.store.get('source')?.incarnation

    const saving = controller.save('source')
    await vi.waitFor(() => expect(write).toHaveBeenCalledOnce())

    expect(controller.store.close('source')).toBe(true)
    const replacement = controller.open({
      id: 'source',
      identity: identity('source.bpmn'),
      title: 'replacement.bpmn',
      xml: '<replacement-local/>',
      lastSavedXml: '<replacement-base/>',
      base: fingerprint('replacement')
    })
    expect(replacement.incarnation).not.toBe(originalIncarnation)

    pendingWrite.resolve({
      status: 'written',
      fingerprint: fingerprint('old-operation-write', 2)
    })
    const outcome = await saving

    expect(outcome).toMatchObject({ status: 'stale-capture', ok: false, sessionId: 'source' })
    expect(controller.store.get('source')).toBe(replacement)
    expect(replacement).toMatchObject({
      title: 'replacement.bpmn',
      currentXml: '<replacement-local/>',
      lastSavedXml: '<replacement-base/>',
      dirty: true,
      base: fingerprint('replacement'),
      save: { phase: 'idle', lastOutcome: null }
    })
    expect(onConfirmedSave).not.toHaveBeenCalled()
  })

  it('does not stamp a reopened same-id session when deferred inspection rejects', async () => {
    const pendingInspect = deferred<ExternalDocument | null>()
    const persistence: SessionPersistence = {
      inspect: vi.fn(async () => pendingInspect.promise),
      write: vi.fn()
    }
    const controller = new DocumentSessionController({ persistence })
    openSource(controller)

    const saving = controller.save('source')
    await vi.waitFor(() =>
      expect(controller.store.get('source')?.save.phase).toBe('checking-external')
    )

    expect(controller.store.close('source')).toBe(true)
    const replacement = controller.open({
      id: 'source',
      identity: identity('source.bpmn'),
      title: 'replacement.bpmn',
      xml: '<replacement-local/>',
      lastSavedXml: '<replacement-base/>',
      base: fingerprint('replacement')
    })

    pendingInspect.reject(new Error('inspection failed after the original session closed'))
    expect((await saving).ok).toBe(false)

    expect(controller.store.get('source')).toBe(replacement)
    expect(replacement).toMatchObject({
      currentXml: '<replacement-local/>',
      lastSavedXml: '<replacement-base/>',
      dirty: true,
      base: fingerprint('replacement'),
      save: { phase: 'idle', lastOutcome: null }
    })
  })

  it('does not write Save-As bytes when the destination identity is already open', async () => {
    const write = vi.fn()
    const writeAs = vi.fn(async () => ({
      status: 'written' as const,
      identity: identity('copy.bpmn'),
      fingerprint: fingerprint('copy', 2)
    }))
    const persistence: SessionPersistence = {
      inspect: unchangedInspect,
      write,
      writeAs
    }
    const controller = new DocumentSessionController({ persistence })
    openSource(controller)
    const destination = controller.open({
      id: 'destination',
      identity: identity('copy.bpmn'),
      title: 'copy.bpmn',
      xml: '<destination/>',
      base: fingerprint('destination')
    })

    const outcome = await controller.save('source', {
      conflictDecision: { kind: 'save-as', path: 'copy.bpmn' }
    })

    expect(outcome).toMatchObject({
      status: 'locked',
      ok: false,
      sessionId: 'source',
      holderId: 'destination'
    })
    expect(write).not.toHaveBeenCalled()
    expect(writeAs).not.toHaveBeenCalled()
    expect(controller.store.get('destination')).toBe(destination)
    expect(controller.store.get('source')).toMatchObject({
      identity: identity('source.bpmn'),
      currentXml: '<local/>',
      lastSavedXml: '<old/>',
      dirty: true
    })
  })

  it('prevents opening a Save-As destination while its write reservation is pending', async () => {
    const pendingWriteAs = deferred<{
      status: 'written'
      identity: DocumentIdentity
      fingerprint: FileFingerprint
    }>()
    const writeAs = vi.fn(async () => pendingWriteAs.promise)
    const persistence: SessionPersistence = {
      inspect: unchangedInspect,
      write: vi.fn(),
      writeAs
    }
    const controller = new DocumentSessionController({ persistence })
    openSource(controller)

    const saving = controller.save('source', {
      conflictDecision: { kind: 'save-as', path: 'copy.bpmn' }
    })
    await vi.waitFor(() => expect(writeAs).toHaveBeenCalledOnce())

    expect(() =>
      controller.open({
        id: 'destination',
        identity: identity('copy.bpmn'),
        title: 'copy.bpmn',
        xml: '<destination/>',
        base: fingerprint('destination')
      })
    ).toThrow(/reserved|destination|open/i)
    expect(controller.store.get('destination')).toBeUndefined()

    pendingWriteAs.resolve({
      status: 'written',
      identity: identity('copy.bpmn'),
      fingerprint: fingerprint('copy', 2)
    })

    expect(await saving).toMatchObject({
      status: 'saved-as',
      ok: true,
      sessionId: 'source',
      identity: identity('copy.bpmn')
    })
    expect(controller.store.getByIdentity(identity('copy.bpmn'))?.id).toBe('source')
  })
})
