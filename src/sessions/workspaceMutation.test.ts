import { describe, expect, it, vi } from 'vitest'
import {
  DocumentSessionController,
  type PersistenceWriteOptions,
  type PersistenceWriteResult,
  type SessionCoordination,
  type SessionPersistence
} from './controller'
import {
  BroadcastWorkspaceCoordinator,
  type BroadcastChannelFactory,
  type BroadcastChannelLike,
  type BroadcastMessageEventLike
} from './workspaceChannel'
import {
  acquireWorkspaceMutationLease,
  runWorkspaceMutation,
  WorkspaceMutationCoordinationUnavailableError,
  WorkspaceMutationLockedError,
  WorkspaceMutationStaleError
} from './workspaceMutation'
import { WORKSPACE_MUTATION_LOCK_PATH } from './workspaceMutationIdentity'
import type { ExternalDocument } from './externalConflict'
import type { DocumentIdentity, FileFingerprint } from './types'

class MemoryBroadcastBus {
  readonly channels = new Set<MemoryBroadcastChannel>()

  readonly factory: BroadcastChannelFactory = (name) => {
    const channel = new MemoryBroadcastChannel(this, name)
    this.channels.add(channel)
    return channel
  }
}

class MemoryBroadcastChannel implements BroadcastChannelLike {
  readonly listeners = new Set<(event: BroadcastMessageEventLike) => void>()

  constructor(
    readonly bus: MemoryBroadcastBus,
    readonly name: string
  ) {}

  postMessage(message: unknown): void {
    for (const channel of this.bus.channels) {
      if (channel === this || channel.name !== this.name) continue
      for (const listener of channel.listeners) listener({ data: message })
    }
  }

  addEventListener(_type: 'message', listener: (event: BroadcastMessageEventLike) => void): void {
    this.listeners.add(listener)
  }

  removeEventListener(
    _type: 'message',
    listener: (event: BroadcastMessageEventLike) => void
  ): void {
    this.listeners.delete(listener)
  }

  close(): void {
    this.bus.channels.delete(this)
    this.listeners.clear()
  }
}

function deferred(): { promise: Promise<void>; resolve(): void } {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

const workspace = { id: 'ws', generation: 1, mode: 'directory' as const }
const identity: DocumentIdentity = { workspace, path: 'process.bpmn' }
const oldFingerprint: FileFingerprint = { hash: 'old', size: 6, modifiedAt: 1 }
const newFingerprint: FileFingerprint = { hash: 'new', size: 6, modifiedAt: 2 }

function createPair() {
  const bus = new MemoryBroadcastBus()
  const common = {
    workspaceId: workspace.id,
    factory: bus.factory,
    webLocks: null,
    contentionMs: 1,
    leaseMs: 1_000
  }
  return {
    a: new BroadcastWorkspaceCoordinator({ ...common, instanceId: 'a' }),
    b: new BroadcastWorkspaceCoordinator({ ...common, instanceId: 'b' })
  }
}

class RecordingPersistence implements SessionPersistence {
  writes = 0

  async inspect(): Promise<ExternalDocument> {
    return {
      identity,
      xml: '<old/>',
      fingerprint: oldFingerprint
    }
  }

  async write(
    _identity: DocumentIdentity,
    _xml: string,
    _options: PersistenceWriteOptions
  ): Promise<PersistenceWriteResult> {
    this.writes += 1
    return { status: 'written', fingerprint: newFingerprint }
  }
}

function dirtyController(
  coordination: SessionCoordination,
  persistence = new RecordingPersistence()
): { controller: DocumentSessionController; persistence: RecordingPersistence } {
  const controller = new DocumentSessionController({
    coordination,
    persistence,
    requireCoordination: true
  })
  controller.open({
    id: 'session',
    identity,
    title: 'process.bpmn',
    xml: '<old/>',
    base: oldFingerprint
  })
  controller.updateXml('session', '<new/>')
  return { controller, persistence }
}

describe('workspace-wide mutation lease', () => {
  it.each([
    ['import', 'import'],
    ['create', 'create']
  ])('serializes overlapping %s/%s transactions across two coordinators', async (first, second) => {
    const { a, b } = createPair()
    const entered = deferred()
    const release = deferred()
    const peerChanges = vi.fn()
    b.subscribeChanges(peerChanges)

    const winner = runWorkspaceMutation({ coordination: a, workspace }, async (lease) => {
      entered.resolve()
      await release.promise
      lease.publish([{ kind: 'saved', path: `${first}.bpmn`, fingerprint: newFingerprint }])
      return `${first}-success`
    })
    await entered.promise

    const peer = runWorkspaceMutation({ coordination: b, workspace }, async () => {
      return `${second}-success`
    })
    await expect(peer).rejects.toMatchObject({
      name: 'WorkspaceMutationLockedError',
      code: 'locked',
      holderId: 'a'
    })
    release.resolve()
    await expect(winner).resolves.toBe(`${first}-success`)
    expect(peerChanges).toHaveBeenCalledOnce()

    await expect(
      runWorkspaceMutation({ coordination: b, workspace }, async () => `${second}-retry-success`)
    ).resolves.toBe(`${second}-retry-success`)
    a.close()
    b.close()
  })

  it.each(['import', 'path mutation'])(
    'blocks an ordinary save while a peer %s transaction owns the global lease',
    async (operation) => {
      const { a, b } = createPair()
      const entered = deferred()
      const release = deferred()
      const winner = runWorkspaceMutation({ coordination: a, workspace }, async () => {
        entered.resolve()
        await release.promise
        return `${operation}-success`
      })
      await entered.promise

      const { controller, persistence } = dirtyController(b)
      await expect(controller.save('session')).resolves.toMatchObject({
        status: 'locked',
        ok: false,
        holderId: 'a'
      })
      expect(persistence.writes).toBe(0)

      release.resolve()
      await expect(winner).resolves.toBe(`${operation}-success`)
      await expect(controller.save('session')).resolves.toMatchObject({
        status: 'success',
        ok: true
      })
      expect(persistence.writes).toBe(1)
      a.close()
      b.close()
    }
  )

  it('uses the reserved workspace identity for an ordinary document save', async () => {
    const acquire = vi.fn(async () => ({
      acquired: true as const,
      lease: { release: vi.fn() }
    }))
    const { controller } = dirtyController({ acquire })

    await expect(controller.save('session')).resolves.toMatchObject({
      status: 'success',
      ok: true
    })
    expect(acquire).toHaveBeenCalledWith({
      workspace,
      path: WORKSPACE_MUTATION_LOCK_PATH
    })
  })

  it('fails a required coordinated save closed when no cross-tab primitive exists', async () => {
    const persistence = new RecordingPersistence()
    const controller = new DocumentSessionController({
      persistence,
      requireCoordination: true
    })
    controller.open({
      id: 'session',
      identity,
      title: 'process.bpmn',
      xml: '<old/>',
      base: oldFingerprint
    })
    controller.updateXml('session', '<new/>')

    await expect(controller.save('session')).resolves.toMatchObject({
      status: 'locked',
      ok: false,
      holderId: 'coordination-unavailable'
    })
    expect(persistence.writes).toBe(0)
  })

  it('releases after success and failure and does not let release errors falsify success', async () => {
    const release = vi.fn()
    const coordination: SessionCoordination = {
      acquire: async () => ({ acquired: true, lease: { release } })
    }
    await expect(
      runWorkspaceMutation({ coordination, workspace }, async () => 'durable')
    ).resolves.toBe('durable')
    expect(release).toHaveBeenCalledOnce()

    await expect(
      runWorkspaceMutation({ coordination, workspace }, async () => {
        throw new Error('write failed')
      })
    ).rejects.toThrow('write failed')
    expect(release).toHaveBeenCalledTimes(2)

    const releaseError = new Error('channel release failed')
    const onReleaseError = vi.fn()
    await expect(
      runWorkspaceMutation(
        {
          coordination: {
            acquire: async () => ({
              acquired: true,
              lease: { release: async () => Promise.reject(releaseError) }
            })
          },
          workspace,
          onReleaseError
        },
        async () => 'committed'
      )
    ).resolves.toBe('committed')
    expect(onReleaseError).toHaveBeenCalledWith(releaseError)
  })

  it('releases a lease acquired just before cancellation or a workspace switch', async () => {
    const abort = new AbortController()
    const abortRelease = vi.fn()
    await expect(
      acquireWorkspaceMutationLease({
        coordination: {
          acquire: async () => {
            abort.abort()
            return { acquired: true, lease: { release: abortRelease } }
          }
        },
        workspace,
        signal: abort.signal
      })
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(abortRelease).toHaveBeenCalledOnce()

    let current = true
    const staleRelease = vi.fn()
    await expect(
      acquireWorkspaceMutationLease({
        coordination: {
          acquire: async () => {
            current = false
            return { acquired: true, lease: { release: staleRelease } }
          }
        },
        workspace,
        isCurrent: () => current
      })
    ).rejects.toBeInstanceOf(WorkspaceMutationStaleError)
    expect(staleRelease).toHaveBeenCalledOnce()
  })

  it('releases on abort, stale detection, and thrown rollback after entering the operation', async () => {
    const release = vi.fn()
    const coordination: SessionCoordination = {
      acquire: async () => ({ acquired: true, lease: { release } })
    }
    const abort = new AbortController()
    await expect(
      runWorkspaceMutation({ coordination, workspace, signal: abort.signal }, async () => {
        abort.abort()
        abort.signal.throwIfAborted()
        return 'unreachable'
      })
    ).rejects.toMatchObject({ name: 'AbortError' })

    let current = true
    await expect(
      runWorkspaceMutation({ coordination, workspace, isCurrent: () => current }, async () => {
        current = false
        throw new WorkspaceMutationStaleError()
      })
    ).rejects.toBeInstanceOf(WorkspaceMutationStaleError)

    await expect(
      runWorkspaceMutation({ coordination, workspace }, async () => {
        throw new Error('rollback failed truthfully')
      })
    ).rejects.toThrow('rollback failed truthfully')
    expect(release).toHaveBeenCalledTimes(3)
  })

  it('reports unavailable and held coordination as distinct typed failures', async () => {
    await expect(
      acquireWorkspaceMutationLease({ coordination: null, workspace })
    ).rejects.toBeInstanceOf(WorkspaceMutationCoordinationUnavailableError)
    await expect(
      acquireWorkspaceMutationLease({
        coordination: {
          acquire: async () => ({ acquired: false, holderId: 'peer', expiresAt: 99 })
        },
        workspace
      })
    ).rejects.toEqual(
      expect.objectContaining<Partial<WorkspaceMutationLockedError>>({
        code: 'locked',
        holderId: 'peer',
        expiresAt: 99
      })
    )
  })

  it('covers defensive lease cleanup, anonymous contention, and acquisition failures', async () => {
    await expect(
      acquireWorkspaceMutationLease({
        coordination: {
          acquire: async () => ({ acquired: false })
        },
        workspace
      })
    ).rejects.toMatchObject({
      name: 'WorkspaceMutationLockedError',
      message: 'Workspace mutation is locked by another tab.'
    })

    const acquireError = new Error('coordination transport failed')
    await expect(
      acquireWorkspaceMutationLease({
        coordination: {
          acquire: async () => Promise.reject(acquireError)
        },
        workspace,
        isCurrent: () => true
      })
    ).rejects.toBe(acquireError)

    const release = vi.fn(async () => {
      throw new Error('release transport failed')
    })
    await expect(
      runWorkspaceMutation(
        {
          coordination: {
            acquire: async () => ({ acquired: true, lease: { release } })
          },
          workspace,
          onReleaseError: () => {
            throw new Error('diagnostic callback failed')
          }
        },
        async () => 'durable despite cleanup failure'
      )
    ).resolves.toBe('durable despite cleanup failure')
    expect(release).toHaveBeenCalledOnce()
  })

  it('keeps release idempotent and ignores publication after release', async () => {
    const release = vi.fn()
    const publishDocumentChange = vi.fn()
    const lease = await acquireWorkspaceMutationLease({
      coordination: {
        acquire: async () => ({ acquired: true, lease: { release } }),
        publishDocumentChange
      },
      workspace
    })

    await lease.release()
    await lease.release()
    lease.publish([{ kind: 'deleted', path: 'already-released.bpmn' }])

    expect(release).toHaveBeenCalledOnce()
    expect(publishDocumentChange).not.toHaveBeenCalled()
  })

  it('uses the AbortError fallback when throwIfAborted is unavailable', async () => {
    const legacyAbortedSignal = { aborted: true } as AbortSignal

    await expect(
      acquireWorkspaceMutationLease({
        coordination: {
          acquire: async () => ({ acquired: true, lease: { release: vi.fn() } })
        },
        workspace,
        signal: legacyAbortedSignal
      })
    ).rejects.toMatchObject({
      name: 'AbortError',
      message: 'The workspace mutation was cancelled.'
    })
  })
})
