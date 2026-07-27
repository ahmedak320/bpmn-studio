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
    this.writes.push({
      identity: { ...source, path },
      xml,
      options: { expectedBase: null, force: false }
    })
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
    const reviewed = await controller.save('s')
    if (reviewed.status !== 'external-conflict') throw new Error('expected conflict fixture')

    expect(
      await controller.save('s', {
        conflictDecision: { kind: 'reload-external' },
        reviewedConflict: reviewed.conflict
      })
    ).toMatchObject({ status: 'reloaded', ok: true })
    expect(discard).toHaveBeenCalledWith(
      expect.objectContaining({ id: 's', incarnation: expect.any(Number) }),
      'reload-external'
    )
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
    const reviewed = await controller.save('s')
    if (reviewed.status !== 'external-conflict') throw new Error('expected conflict fixture')

    const outcome = await controller.save('s', {
      conflictDecision: { kind: 'overwrite', confirmed: true },
      reviewedConflict: reviewed.conflict
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

  it('distinguishes missing, clean, and stale caller snapshots without persistence I/O', async () => {
    const { controller, persistence } = createController()
    const inspect = vi.spyOn(persistence, 'inspect')

    controller.setActive(null)
    expect(await controller.saveActive()).toEqual({
      status: 'missing-session',
      ok: false,
      sessionId: ''
    })
    expect(await controller.save('missing')).toEqual({
      status: 'missing-session',
      ok: false,
      sessionId: 'missing'
    })

    controller.setActive('s')
    expect(await controller.saveActive()).toEqual({
      status: 'clean',
      ok: true,
      sessionId: 's'
    })

    controller.updateXml('s', '<new/>')
    expect(await controller.save('s', { expectedRevision: 0 })).toEqual({
      status: 'stale-capture',
      ok: false,
      sessionId: 's'
    })
    expect(inspect).not.toHaveBeenCalled()
    expect(persistence.writes).toHaveLength(0)
  })

  it('writes an explicit caller snapshot and classifies serializer storage failures', async () => {
    const { controller, persistence } = createController()

    expect(await controller.save('s', { xml: '<captured/>' })).toMatchObject({
      status: 'success',
      savedRevision: 1
    })
    expect(persistence.writes[0]?.xml).toBe('<captured/>')

    const failed = createController()
    failed.controller.store.bindEditor('s', {
      readXml: async () => {
        throw new DOMException('Draft serialization exhausted storage', 'QuotaExceededError')
      }
    })
    failed.controller.updateXml('s', '<dirty/>')

    expect(await failed.controller.save('s')).toMatchObject({
      status: 'storage-failure',
      failure: { code: 'quota-exceeded', retriable: true }
    })
    expect(failed.controller.store.get('s')?.dirty).toBe(true)
    expect(failed.persistence.writes).toHaveLength(0)
  })

  it('honors cancel and refuses to treat a deleted external file as reloadable', async () => {
    const cancelled = createController()
    cancelled.controller.updateXml('s', '<local/>')
    cancelled.persistence.inspected = external('<external/>', 'external')

    expect(
      await cancelled.controller.save('s', {
        conflictDecision: { kind: 'cancel' }
      })
    ).toEqual({ status: 'cancelled', ok: false, sessionId: 's' })
    expect(cancelled.persistence.writes).toHaveLength(0)

    const deleted = createController()
    deleted.controller.updateXml('s', '<local/>')
    deleted.persistence.inspected = null
    const reviewed = await deleted.controller.save('s')
    if (reviewed.status !== 'external-conflict') throw new Error('expected conflict fixture')
    expect(
      await deleted.controller.save('s', {
        conflictDecision: { kind: 'reload-external' },
        reviewedConflict: reviewed.conflict
      })
    ).toMatchObject({
      status: 'external-conflict',
      ok: false,
      conflict: { reason: 'deleted', external: null },
      comparisonRequested: false,
      decisionStale: false
    })
    expect(deleted.controller.store.get('s')?.currentXml).toBe('<local/>')
  })

  it('keeps a dirty session retryable after inspect and write storage failures', async () => {
    const inspecting = createController()
    inspecting.controller.updateXml('s', '<local/>')
    inspecting.persistence.inspect = vi
      .fn()
      .mockRejectedValueOnce(new DOMException('Storage unavailable', 'QuotaExceededError'))
      .mockResolvedValue(external('<old/>', 'old'))

    expect(await inspecting.controller.save('s')).toMatchObject({
      status: 'storage-failure',
      failure: { code: 'quota-exceeded', retriable: true }
    })
    expect(inspecting.controller.store.get('s')?.dirty).toBe(true)
    expect(await inspecting.controller.save('s')).toMatchObject({ status: 'success', ok: true })

    const writing = createController()
    writing.controller.updateXml('s', '<local/>')
    writing.persistence.write = vi
      .fn()
      .mockRejectedValueOnce(new DOMException('Disk is full', 'QuotaExceededError'))
      .mockResolvedValue({ status: 'written', fingerprint: fp('recovered', 4) })

    expect(await writing.controller.save('s')).toMatchObject({
      status: 'storage-failure',
      failure: { code: 'quota-exceeded', retriable: true }
    })
    expect(writing.controller.store.get('s')?.dirty).toBe(true)
    expect(await writing.controller.save('s')).toMatchObject({
      status: 'success',
      fingerprint: fp('recovered', 4)
    })
  })

  it('cancels after external inspection and releases a lock acquired just before abort', async () => {
    const abortAfterInspect = new AbortController()
    const inspected = createController()
    inspected.controller.updateXml('s', '<local/>')
    inspected.persistence.inspect = vi.fn(async () => {
      abortAfterInspect.abort()
      return external('<old/>', 'old')
    })

    expect(await inspected.controller.save('s', { signal: abortAfterInspect.signal })).toEqual({
      status: 'cancelled',
      ok: false,
      sessionId: 's'
    })
    expect(inspected.persistence.writes).toHaveLength(0)

    const abortAfterLock = new AbortController()
    const release = vi.fn()
    const persistence = new FakePersistence()
    const controller = new DocumentSessionController({
      persistence,
      coordination: {
        acquire: async () => {
          abortAfterLock.abort()
          return { acquired: true, lease: { release } }
        }
      }
    })
    controller.open({ id: 's', identity, title: 'a', xml: '<old/>', base: fp('old') })
    controller.updateXml('s', '<local/>')

    expect(await controller.save('s', { signal: abortAfterLock.signal })).toEqual({
      status: 'cancelled',
      ok: false,
      sessionId: 's'
    })
    expect(release).toHaveBeenCalledOnce()
    expect(persistence.writes).toHaveLength(0)
  })

  it('classifies lock acquisition and conflict-decision failures without losing edits', async () => {
    const persistence = new FakePersistence()
    const locked = new DocumentSessionController({
      persistence,
      coordination: {
        acquire: async () => {
          throw new DOMException('Lock storage unavailable', 'QuotaExceededError')
        }
      }
    })
    locked.open({ id: 's', identity, title: 'a', xml: '<old/>', base: fp('old') })
    locked.updateXml('s', '<local/>')
    expect(await locked.save('s')).toMatchObject({
      status: 'storage-failure',
      failure: { code: 'quota-exceeded' }
    })
    expect(locked.store.get('s')?.dirty).toBe(true)

    const decidingPersistence = new FakePersistence()
    decidingPersistence.inspected = external('<external/>', 'external')
    const deciding = new DocumentSessionController({
      persistence: decidingPersistence,
      decideConflict: async () => {
        throw new DOMException('Decision UI closed', 'AbortError')
      }
    })
    deciding.open({ id: 's', identity, title: 'a', xml: '<old/>', base: fp('old') })
    deciding.updateXml('s', '<local/>')
    expect(await deciding.save('s')).toEqual({
      status: 'cancelled',
      ok: false,
      sessionId: 's'
    })
    expect(deciding.store.get('s')?.dirty).toBe(true)
  })

  it('invalidates a save when the workspace changes after asynchronous inspection', async () => {
    const persistence = new FakePersistence()
    const inspected = deferred<ExternalDocument | null>()
    persistence.inspect = vi.fn(async () => inspected.promise)
    let current = true
    const controller = new DocumentSessionController({
      persistence,
      isWorkspaceCurrent: () => current
    })
    controller.open({ id: 's', identity, title: 'a', xml: '<old/>', base: fp('old') })
    controller.updateXml('s', '<local/>')

    const saving = controller.save('s')
    await vi.waitFor(() => expect(controller.store.get('s')?.save.phase).toBe('checking-external'))
    current = false
    inspected.resolve(external('<old/>', 'old'))

    expect(await saving).toEqual({
      status: 'stale-workspace',
      ok: false,
      sessionId: 's'
    })
    expect(controller.store.get('s')?.dirty).toBe(true)
    expect(persistence.writes).toHaveLength(0)
  })

  it('adopts a serializer result when no newer revision wins the capture race', async () => {
    const { controller, persistence } = createController()
    controller.store.bindEditor('s', { readXml: async () => '<serialized/>' })
    controller.updateXml('s', '<dirty/>')

    expect(await controller.save('s')).toMatchObject({
      status: 'success',
      savedRevision: 2
    })
    expect(persistence.writes[0]?.xml).toBe('<serialized/>')
    expect(controller.store.get('s')).toMatchObject({
      currentXml: '<serialized/>',
      lastSavedXml: '<serialized/>',
      dirty: false
    })
  })

  it('keeps external reload successful when post-discard cleanup fails', async () => {
    const persistence = new FakePersistence()
    persistence.inspected = external('<external/>', 'external')
    const postSaveError = vi.fn()
    const controller = new DocumentSessionController({
      persistence,
      onExplicitDiscard: async () => {
        throw new DOMException('Draft database unavailable', 'QuotaExceededError')
      },
      onPostSaveError: postSaveError
    })
    controller.open({ id: 's', identity, title: 'a', xml: '<old/>', base: fp('old') })
    controller.updateXml('s', '<local/>')
    const reviewed = await controller.save('s')
    if (reviewed.status !== 'external-conflict') throw new Error('expected conflict fixture')

    expect(
      await controller.save('s', {
        conflictDecision: { kind: 'reload-external' },
        reviewedConflict: reviewed.conflict
      })
    ).toMatchObject({ status: 'reloaded', ok: true })
    expect(controller.store.get('s')?.dirty).toBe(false)
    expect(postSaveError).toHaveBeenCalledOnce()
  })

  it('reports unsupported save-as as storage failure and preserves the source identity', async () => {
    const persistence: SessionPersistence = {
      inspect: async () => external('<old/>', 'old'),
      write: async () => ({ status: 'written', fingerprint: fp('unused') })
    }
    const controller = new DocumentSessionController({ persistence })
    controller.open({ id: 's', identity, title: 'a.bpmn', xml: '<old/>', base: fp('old') })
    controller.updateXml('s', '<local/>')

    expect(
      await controller.save('s', {
        conflictDecision: { kind: 'save-as', path: 'copy.bpmn' }
      })
    ).toMatchObject({
      status: 'storage-failure',
      failure: { code: 'invalid-state' }
    })
    expect(controller.store.get('s')).toMatchObject({
      identity,
      dirty: true
    })
  })

  it('publishes confirmed writes and rejects a workspace switch after lock acquisition', async () => {
    const published = vi.fn()
    const persistence = new FakePersistence()
    const controller = new DocumentSessionController({
      persistence,
      coordination: {
        acquire: async () => ({ acquired: true, lease: { release: vi.fn() } }),
        publishDocumentChange: published
      }
    })
    controller.open({ id: 's', identity, title: 'a', xml: '<old/>', base: fp('old') })
    controller.updateXml('s', '<local/>')
    expect(await controller.save('s')).toMatchObject({ status: 'success', ok: true })
    expect(published).toHaveBeenCalledWith({
      identity,
      kind: 'saved',
      fingerprint: fp('new', 2)
    })

    let current = true
    const stalePersistence = new FakePersistence()
    const stale = new DocumentSessionController({
      persistence: stalePersistence,
      isWorkspaceCurrent: () => current,
      coordination: {
        acquire: async () => {
          current = false
          return { acquired: true, lease: { release: vi.fn() } }
        }
      }
    })
    stale.open({ id: 's', identity, title: 'a', xml: '<old/>', base: fp('old') })
    stale.updateXml('s', '<local/>')
    expect(await stale.save('s')).toEqual({
      status: 'stale-workspace',
      ok: false,
      sessionId: 's'
    })
    expect(stalePersistence.writes).toHaveLength(0)
  })

  it('keeps raw external XML as the saved baseline and journals reviewed XML as dirty', async () => {
    const persistence = new FakePersistence()
    persistence.inspected = external('<external/>', 'external')
    const discard = vi.fn()
    const preparedExternal = vi.fn()
    const prepareExternal = vi.fn(async () => ({
      status: 'completed' as const,
      xml: '<reviewed-external/>'
    }))
    const controller = new DocumentSessionController({
      persistence,
      prepareExternal,
      onExplicitDiscard: discard,
      onPreparedExternal: preparedExternal
    })
    controller.open({ id: 's', identity, title: 'a', xml: '<old/>', base: fp('old') })
    controller.updateXml('s', '<local/>')
    const reviewed = await controller.save('s')
    if (reviewed.status !== 'external-conflict') throw new Error('expected conflict fixture')

    expect(
      await controller.save('s', {
        conflictDecision: { kind: 'reload-external' },
        reviewedConflict: reviewed.conflict
      })
    ).toMatchObject({ status: 'reloaded', ok: true })

    expect(prepareExternal).toHaveBeenCalledWith(
      expect.objectContaining({ xml: '<external/>', fingerprint: fp('external') }),
      expect.objectContaining({
        session: expect.objectContaining({ id: 's', incarnation: expect.any(Number) }),
        conflict: expect.objectContaining({
          external: expect.objectContaining({ xml: '<external/>' })
        })
      })
    )
    expect(controller.store.get('s')).toMatchObject({
      currentXml: '<reviewed-external/>',
      lastSavedXml: '<external/>',
      dirty: true,
      base: fp('external')
    })
    expect(preparedExternal).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 's',
        currentXml: '<reviewed-external/>',
        lastSavedXml: '<external/>',
        dirty: true
      }),
      expect.objectContaining({ xml: '<external/>' })
    )
    expect(discard).not.toHaveBeenCalled()
  })

  it('does not mutate the session when external preparation is cancelled or becomes stale', async () => {
    const cancelledPersistence = new FakePersistence()
    cancelledPersistence.inspected = external('<external/>', 'external')
    const discarded = vi.fn()
    const cancelled = new DocumentSessionController({
      persistence: cancelledPersistence,
      prepareExternal: async () => ({ status: 'cancelled' }),
      onExplicitDiscard: discarded,
      onPreparedExternal: discarded
    })
    cancelled.open({ id: 's', identity, title: 'a', xml: '<old/>', base: fp('old') })
    cancelled.updateXml('s', '<local/>')
    const cancelledReview = await cancelled.save('s')
    if (cancelledReview.status !== 'external-conflict') {
      throw new Error('expected conflict fixture')
    }
    expect(
      await cancelled.save('s', {
        conflictDecision: { kind: 'reload-external' },
        reviewedConflict: cancelledReview.conflict
      })
    ).toEqual({ status: 'cancelled', ok: false, sessionId: 's' })
    expect(cancelled.store.get('s')).toMatchObject({
      currentXml: '<local/>',
      lastSavedXml: '<old/>',
      dirty: true
    })
    expect(discarded).not.toHaveBeenCalled()

    const stalePersistence = new FakePersistence()
    stalePersistence.inspected = external('<external/>', 'external')
    const preparation = deferred<{ status: 'completed'; xml: string }>()
    const staleCallback = vi.fn()
    const prepareStaleExternal = vi.fn(() => preparation.promise)
    const stale = new DocumentSessionController({
      persistence: stalePersistence,
      prepareExternal: prepareStaleExternal,
      onExplicitDiscard: staleCallback,
      onPreparedExternal: staleCallback
    })
    stale.open({ id: 's', identity, title: 'a', xml: '<old/>', base: fp('old') })
    stale.updateXml('s', '<local/>')
    const staleReview = await stale.save('s')
    if (staleReview.status !== 'external-conflict') throw new Error('expected conflict fixture')
    const reload = stale.save('s', {
      conflictDecision: { kind: 'reload-external' },
      reviewedConflict: staleReview.conflict
    })
    await vi.waitFor(() => expect(prepareStaleExternal).toHaveBeenCalledOnce())
    stale.updateXml('s', '<newer-local/>')
    preparation.resolve({ status: 'completed', xml: '<reviewed-external/>' })

    expect(await reload).toEqual({ status: 'stale-capture', ok: false, sessionId: 's' })
    expect(stale.store.get('s')).toMatchObject({
      currentXml: '<newer-local/>',
      lastSavedXml: '<old/>',
      dirty: true
    })
    expect(staleCallback).not.toHaveBeenCalled()
  })

  it('rechecks the external fingerprint after preparation before mutating the session', async () => {
    const persistence = new FakePersistence()
    persistence.inspected = external('<external/>', 'external')
    const applied = vi.fn()
    const controller = new DocumentSessionController({
      persistence,
      prepareExternal: async () => {
        persistence.inspected = external('<newer-external/>', 'newer-external', 2)
        return { status: 'completed', xml: '<reviewed-external/>' }
      },
      onPreparedExternal: applied
    })
    controller.open({ id: 's', identity, title: 'a', xml: '<old/>', base: fp('old') })
    controller.updateXml('s', '<local/>')
    const reviewed = await controller.save('s')
    if (reviewed.status !== 'external-conflict') throw new Error('expected conflict fixture')

    expect(
      await controller.save('s', {
        conflictDecision: { kind: 'reload-external' },
        reviewedConflict: reviewed.conflict
      })
    ).toMatchObject({
      status: 'external-conflict',
      decisionStale: true,
      conflict: { external: { xml: '<newer-external/>' } }
    })
    expect(controller.store.get('s')).toMatchObject({
      currentXml: '<local/>',
      lastSavedXml: '<old/>',
      dirty: true
    })
    expect(applied).not.toHaveBeenCalled()
  })

  it('rechecks the local revision after the post-preparation fingerprint inspection', async () => {
    const persistence = new FakePersistence()
    const pendingFinalInspection = deferred<ExternalDocument | null>()
    let inspections = 0
    persistence.inspect = vi.fn(async () => {
      inspections += 1
      return inspections === 4
        ? pendingFinalInspection.promise
        : external('<external/>', 'external')
    })
    const controller = new DocumentSessionController({
      persistence,
      prepareExternal: async () => ({
        status: 'completed',
        xml: '<reviewed-external/>'
      })
    })
    controller.open({ id: 's', identity, title: 'a', xml: '<old/>', base: fp('old') })
    controller.updateXml('s', '<local/>')
    const reviewed = await controller.save('s')
    if (reviewed.status !== 'external-conflict') throw new Error('expected conflict fixture')

    const reload = controller.save('s', {
      conflictDecision: { kind: 'reload-external' },
      reviewedConflict: reviewed.conflict
    })
    await vi.waitFor(() => expect(inspections).toBe(4))
    controller.updateXml('s', '<newer-local/>')
    pendingFinalInspection.resolve(external('<external/>', 'external'))

    expect(await reload).toEqual({ status: 'stale-capture', ok: false, sessionId: 's' })
    expect(controller.store.get('s')).toMatchObject({
      currentXml: '<newer-local/>',
      lastSavedXml: '<old/>',
      dirty: true
    })
  })
})
