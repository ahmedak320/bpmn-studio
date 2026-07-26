import { describe, expect, it, vi } from 'vitest'
import {
  DocumentSessionController,
  type PersistenceWriteOptions,
  type PersistenceWriteResult,
  type SessionPersistence
} from './controller'
import type { ExternalDocument } from './externalConflict'
import type { DocumentIdentity, FileFingerprint } from './types'

const workspace = { id: 'ws', generation: 1, mode: 'directory' as const }
const identity: DocumentIdentity = { workspace, path: 'a.bpmn' }

function fp(hash: string, modifiedAt = 1): FileFingerprint {
  return { hash, size: hash.length, modifiedAt }
}

function external(xml: string, hash: string, modifiedAt = 1): ExternalDocument {
  return { identity, xml, fingerprint: fp(hash, modifiedAt) }
}

function deferred<T>(): {
  promise: Promise<T>
  resolve(value: T): void
  reject(error: unknown): void
} {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

class FakePersistence implements SessionPersistence {
  inspected: ExternalDocument | null = external('<old/>', 'old')
  writes: Array<{ identity: DocumentIdentity; xml: string; options: PersistenceWriteOptions }> = []
  writeResult: PersistenceWriteResult = { status: 'written', fingerprint: fp('new', 2) }

  async inspect(): Promise<ExternalDocument | null> {
    return this.inspected
  }

  async write(
    target: DocumentIdentity,
    xml: string,
    options: PersistenceWriteOptions
  ): Promise<PersistenceWriteResult> {
    this.writes.push({ identity: target, xml, options })
    return this.writeResult
  }

  async writeAs(source: DocumentIdentity, path: string, xml: string) {
    this.writes.push({ identity: { ...source, path }, xml, options: { expectedBase: null, force: false } })
    return {
      status: 'written' as const,
      identity: { workspace: source.workspace, path },
      fingerprint: fp('copy', 3)
    }
  }
}

function createController(persistence = new FakePersistence()) {
  let id = 0
  const controller = new DocumentSessionController({
    persistence,
    createRequestId: () => `request-${++id}`
  })
  const session = controller.open({
    id: 's',
    identity,
    title: 'a.bpmn',
    xml: '<old/>',
    base: fp('old')
  })
  return { controller, persistence, session }
}

describe('DocumentSessionController saves', () => {
  it('writes the current snapshot with expected base and marks it clean', async () => {
    const { controller, persistence } = createController()
    controller.updateXml('s', '<new/>')

    const outcome = await controller.save('s')

    expect(outcome).toMatchObject({ status: 'success', ok: true, remainingDirty: false })
    expect(persistence.writes).toEqual([
      {
        identity,
        xml: '<new/>',
        options: {
          expectedBase: fp('old'),
          force: false,
          signal: undefined
        }
      }
    ])
    expect(controller.store.get('s')).toMatchObject({
      currentXml: '<new/>',
      lastSavedXml: '<new/>',
      dirty: false,
      base: fp('new', 2),
      save: { phase: 'idle', lastOutcome: 'success' }
    })
  })

  it('does not clear an edit made while the older write is pending', async () => {
    const persistence = new FakePersistence()
    const pending = deferred<PersistenceWriteResult>()
    persistence.write = vi.fn(async (_target, xml) => {
      expect(xml).toBe('<snapshot/>')
      return pending.promise
    })
    const { controller } = createController(persistence)
    controller.updateXml('s', '<snapshot/>')

    const saving = controller.save('s')
    await vi.waitFor(() => expect(persistence.write).toHaveBeenCalled())
    controller.updateXml('s', '<newer-edit/>')
    pending.resolve({ status: 'written', fingerprint: fp('snapshot', 2) })
    const outcome = await saving

    expect(outcome).toMatchObject({
      status: 'success',
      remainingDirty: true,
      savedRevision: 1
    })
    expect(controller.store.get('s')).toMatchObject({
      currentXml: '<newer-edit/>',
      lastSavedXml: '<snapshot/>',
      dirty: true,
      revision: 2,
      lastSavedRevision: 1
    })
  })

  it('classifies a second overlapping save as busy', async () => {
    const persistence = new FakePersistence()
    const pending = deferred<PersistenceWriteResult>()
    persistence.write = async () => pending.promise
    const { controller } = createController(persistence)
    controller.updateXml('s', '<new/>')
    const first = controller.save('s')
    await vi.waitFor(() => expect(controller.store.get('s')?.save.phase).toBe('writing'))

    expect(await controller.save('s')).toEqual({ status: 'busy', ok: false, sessionId: 's' })
    pending.resolve({ status: 'written', fingerprint: fp('new') })
    await first
  })

  it('does not start a save while a path mutation is applying or rolling back', async () => {
    const { controller, persistence } = createController()
    controller.updateXml('s', '<new/>')
    controller.store.setPathMigration('s', {
      transactionId: 'tx',
      phase: 'applying',
      fromPath: 'a.bpmn',
      toPath: 'b.bpmn',
      error: null
    })

    expect(await controller.save('s')).toEqual({
      status: 'busy',
      ok: false,
      sessionId: 's'
    })
    expect(persistence.writes).toHaveLength(0)
  })

  it('never writes through a session whose workspace generation is stale', async () => {
    const persistence = new FakePersistence()
    let generation = 1
    const controller = new DocumentSessionController({
      persistence,
      isWorkspaceCurrent: (target) => target.workspace.generation === generation
    })
    controller.open({ id: 's', identity, title: 'a', xml: '<old/>', base: fp('old') })
    controller.updateXml('s', '<new/>')
    generation = 2

    expect(await controller.save('s')).toEqual({
      status: 'stale-workspace',
      ok: false,
      sessionId: 's'
    })
    expect(persistence.writes).toHaveLength(0)
    expect(controller.store.get('s')?.dirty).toBe(true)
  })

  it('classifies permission loss and preserves the dirty snapshot', async () => {
    const { controller, persistence } = createController()
    controller.updateXml('s', '<new/>')
    persistence.write = async () => {
      throw new DOMException('Permission revoked', 'NotAllowedError')
    }

    const outcome = await controller.save('s')

    expect(outcome).toMatchObject({
      status: 'permission-loss',
      ok: false,
      failure: { code: 'permission-denied', retriable: false }
    })
    expect(controller.store.get('s')?.dirty).toBe(true)
    expect(controller.store.get('s')?.lastSavedXml).toBe('<old/>')
  })

  it('surfaces an external modification without writing', async () => {
    const { controller, persistence } = createController()
    controller.updateXml('s', '<local/>')
    persistence.inspected = external('<external/>', 'external', 3)

    const outcome = await controller.save('s')

    expect(outcome).toMatchObject({
      status: 'external-conflict',
      conflict: {
        reason: 'modified',
        localXml: '<local/>',
        external: { xml: '<external/>' }
      },
      comparisonRequested: false
    })
    expect(persistence.writes).toHaveLength(0)
  })

  it('returns comparison data for the explicit Compare decision', async () => {
    const { controller, persistence } = createController()
    controller.updateXml('s', '<local/>')
    persistence.inspected = external('<external/>', 'external')

    const outcome = await controller.save('s', {
      conflictDecision: { kind: 'compare' }
    })

    expect(outcome).toMatchObject({
      status: 'external-conflict',
      comparisonRequested: true,
      conflict: { localXml: '<local/>', external: { xml: '<external/>' } }
    })
  })

  it('reloads external XML only when no newer local edit arrived during the decision', async () => {
    const persistence = new FakePersistence()
    persistence.inspected = external('<external/>', 'external')
    const decision = deferred<{ kind: 'reload-external' }>()
    const controller = new DocumentSessionController({
      persistence,
      decideConflict: () => decision.promise
    })
    controller.open({ id: 's', identity, title: 'a', xml: '<old/>', base: fp('old') })
    controller.updateXml('s', '<local/>')
    const saving = controller.save('s')
    await vi.waitFor(() =>
      expect(controller.store.get('s')?.save.phase).toBe('awaiting-conflict-decision')
    )
    controller.updateXml('s', '<newer/>')
    decision.resolve({ kind: 'reload-external' })

    expect(await saving).toMatchObject({
      status: 'external-conflict',
      decisionStale: true
    })
    expect(controller.store.get('s')?.currentXml).toBe('<newer/>')
  })

  it('treats a successful external reload as an explicit local-draft discard', async () => {
    const persistence = new FakePersistence()
    persistence.inspected = external('<external/>', 'external')
    const discard = vi.fn()
    const controller = new DocumentSessionController({
      persistence,
      onExplicitDiscard: discard
    })
    controller.open({ id: 's', identity, title: 'a', xml: '<old/>', base: fp('old') })
    controller.updateXml('s', '<local/>')

    expect(
      await controller.save('s', {
        conflictDecision: { kind: 'reload-external' }
      })
    ).toMatchObject({ status: 'reloaded', ok: true })
    expect(discard).toHaveBeenCalledWith('s', 'reload-external')
    expect(controller.store.get('s')).toMatchObject({
      currentXml: '<external/>',
      lastSavedXml: '<external/>',
      dirty: false
    })
  })

  it('overwrites an external change only after an explicit confirmed decision', async () => {
    const { controller, persistence } = createController()
    controller.updateXml('s', '<local/>')
    persistence.inspected = external('<external/>', 'external')

    const outcome = await controller.save('s', {
      conflictDecision: { kind: 'overwrite', confirmed: true }
    })

    expect(outcome.status).toBe('success')
    expect(persistence.writes[0].options.force).toBe(true)
  })

  it('save-as migrates identity while preserving the live modeler', async () => {
    const { controller, persistence } = createController()
    const modeler = {}
    controller.store.bindEditor('s', { modeler })
    controller.updateXml('s', '<local/>')
    persistence.inspected = external('<external/>', 'external')

    const outcome = await controller.save('s', {
      conflictDecision: { kind: 'save-as', path: 'copy.bpmn' }
    })

    expect(outcome).toMatchObject({
      status: 'saved-as',
      identity: { path: 'copy.bpmn' },
      remainingDirty: false
    })
    expect(controller.store.get('s')).toMatchObject({
      identity: { path: 'copy.bpmn' },
      title: 'copy.bpmn',
      modeler
    })
  })

  it('surfaces an atomic expected-hash race as a fresh external conflict', async () => {
    const { controller, persistence } = createController()
    controller.updateXml('s', '<local/>')
    persistence.writeResult = {
      status: 'external-conflict',
      external: external('<raced/>', 'raced')
    }

    const outcome = await controller.save('s')

    expect(outcome).toMatchObject({
      status: 'external-conflict',
      decisionStale: true,
      conflict: { external: { xml: '<raced/>' } }
    })
    expect(controller.store.get('s')?.dirty).toBe(true)
  })

  it('honors cross-tab lock denial and releases an acquired lease', async () => {
    const persistence = new FakePersistence()
    const release = vi.fn()
    const acquire = vi
      .fn()
      .mockResolvedValueOnce({ acquired: false, holderId: 'other', expiresAt: 99 })
      .mockResolvedValueOnce({ acquired: true, lease: { release } })
    const controller = new DocumentSessionController({
      persistence,
      coordination: { acquire }
    })
    controller.open({ id: 's', identity, title: 'a', xml: '<old/>', base: fp('old') })
    controller.updateXml('s', '<new/>')

    expect(await controller.save('s')).toMatchObject({
      status: 'locked',
      holderId: 'other',
      expiresAt: 99
    })
    expect(persistence.writes).toHaveLength(0)
    expect((await controller.save('s')).status).toBe('success')
    expect(release).toHaveBeenCalledOnce()
  })

  it('keeps a confirmed write successful if draft cleanup or lease release fails', async () => {
    const persistence = new FakePersistence()
    const sideEffectError = vi.fn()
    const controller = new DocumentSessionController({
      persistence,
      coordination: {
        acquire: async () => ({
          acquired: true,
          lease: {
            release: async () => {
              throw new Error('channel closed')
            }
          }
        })
      },
      onConfirmedSave: async () => {
        throw new Error('draft database unavailable')
      },
      onPostSaveError: sideEffectError
    })
    controller.open({ id: 's', identity, title: 'a', xml: '<old/>', base: fp('old') })
    controller.updateXml('s', '<new/>')

    expect(await controller.save('s')).toMatchObject({ status: 'success', ok: true })
    expect(controller.store.get('s')?.dirty).toBe(false)
    expect(sideEffectError).toHaveBeenCalledTimes(2)
  })

  it('classifies an aborted save request as cancelled without touching storage', async () => {
    const { controller, persistence } = createController()
    controller.updateXml('s', '<new/>')
    const abort = new AbortController()
    abort.abort()

    expect(await controller.save('s', { signal: abort.signal })).toEqual({
      status: 'cancelled',
      ok: false,
      sessionId: 's'
    })
    expect(persistence.writes).toHaveLength(0)
    expect(controller.store.get('s')?.dirty).toBe(true)
  })

  it('does not let an async serializer replace a newer tracked edit', async () => {
    const { controller } = createController()
    const serialized = deferred<string>()
    controller.store.bindEditor('s', { readXml: () => serialized.promise })
    controller.updateXml('s', '<dirty/>')
    const saving = controller.save('s')
    controller.updateXml('s', '<newer/>')
    serialized.resolve('<possibly-stale/>')

    await saving
    expect(controller.store.get('s')?.currentXml).toBe('<newer/>')
  })
})
