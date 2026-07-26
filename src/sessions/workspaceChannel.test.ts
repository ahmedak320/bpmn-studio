import { describe, expect, it, vi } from 'vitest'
import {
  BroadcastWorkspaceCoordinator,
  WORKSPACE_CHANNEL_PROTOCOL,
  WORKSPACE_CHANNEL_VERSION,
  isWorkspaceChannelMessage,
  type BroadcastChannelFactory,
  type BroadcastChannelLike,
  type BroadcastMessageEventLike
} from './workspaceChannel'
import type { DocumentIdentity } from './types'

class MemoryBroadcastBus {
  channels = new Set<MemoryBroadcastChannel>()

  factory: BroadcastChannelFactory = (name) => {
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
      if (channel !== this && channel.name === this.name) {
        for (const listener of channel.listeners) listener({ data: message })
      }
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

const workspace = { id: 'ws', generation: 1, mode: 'directory' as const }
const identity = (path: string): DocumentIdentity => ({ workspace, path })

function createPair(options: { leaseMs?: number; now?: () => number } = {}) {
  const bus = new MemoryBroadcastBus()
  const common = {
    workspaceId: 'ws',
    factory: bus.factory,
    contentionMs: 1,
    leaseMs: options.leaseMs ?? 1000,
    now: options.now
  }
  const a = new BroadcastWorkspaceCoordinator({ ...common, instanceId: 'a' })
  const b = new BroadcastWorkspaceCoordinator({ ...common, instanceId: 'b' })
  return { bus, a, b }
}

describe('workspace BroadcastChannel protocol', () => {
  it('validates the versioned protocol and rejects malformed payloads', () => {
    const base = {
      protocol: WORKSPACE_CHANNEL_PROTOCOL,
      version: WORKSPACE_CHANNEL_VERSION,
      workspaceId: 'ws',
      senderId: 'a',
      sentAt: 1
    }
    expect(isWorkspaceChannelMessage({ ...base, type: 'hello' })).toBe(true)
    expect(
      isWorkspaceChannelMessage({
        ...base,
        type: 'lock-request',
        path: 'a.bpmn',
        requestId: 'request',
        requestedAt: 1,
        expiresAt: 2
      })
    ).toBe(true)
    for (const type of ['lock-held', 'lock-acquired', 'lock-renewed']) {
      expect(
        isWorkspaceChannelMessage({
          ...base,
          type,
          path: 'a.bpmn',
          requestId: 'request',
          expiresAt: 2
        })
      ).toBe(true)
    }
    expect(
      isWorkspaceChannelMessage({
        ...base,
        type: 'lock-released',
        path: 'a.bpmn',
        requestId: 'request'
      })
    ).toBe(true)
    expect(
      isWorkspaceChannelMessage({
        ...base,
        type: 'document-change',
        change: 'saved',
        path: 'a.bpmn',
        fingerprint: { hash: 'x', size: 1, modifiedAt: 1 }
      })
    ).toBe(true)
    expect(
      isWorkspaceChannelMessage({
        ...base,
        type: 'document-change',
        change: 'deleted',
        path: 'a.bpmn'
      })
    ).toBe(true)
    expect(
      isWorkspaceChannelMessage({
        ...base,
        type: 'document-change',
        change: 'moved',
        path: 'new.bpmn',
        previousPath: 'old.bpmn'
      })
    ).toBe(true)

    for (const malformed of [
      null,
      'message',
      { ...base, protocol: 'wrong', type: 'hello' },
      { ...base, version: 99, type: 'hello' },
      { ...base, workspaceId: 1, type: 'hello' },
      { ...base, senderId: null, type: 'hello' },
      { ...base, sentAt: 'now', type: 'hello' },
      { ...base, type: 1 },
      { ...base, type: 'unknown' },
      { ...base, type: 'lock-request', path: 1, requestId: 'r', requestedAt: 1, expiresAt: 2 },
      { ...base, type: 'lock-request', path: 'a', requestId: 1, requestedAt: 1, expiresAt: 2 },
      { ...base, type: 'lock-request', path: 'a', requestId: 'r', requestedAt: 'x', expiresAt: 2 },
      { ...base, type: 'lock-request', path: 'a', requestId: 'r', requestedAt: 1, expiresAt: 'x' },
      { ...base, type: 'lock-held', path: 1, requestId: 'r', expiresAt: 2 },
      { ...base, type: 'lock-acquired', path: 'a', requestId: 1, expiresAt: 2 },
      { ...base, type: 'lock-renewed', path: 'a', requestId: 'r', expiresAt: 'x' },
      { ...base, type: 'lock-released', path: 1, requestId: 'r' },
      { ...base, type: 'lock-released', path: 'a', requestId: 1 },
      { ...base, type: 'document-change', change: 'unknown', path: 'a' },
      { ...base, type: 'document-change', change: 'saved', path: 1 },
      { ...base, type: 'document-change', change: 'saved', path: 'a', previousPath: 1 },
      {
        ...base,
        type: 'document-change',
        change: 'saved',
        path: 'a',
        fingerprint: { hash: 1, size: 1, modifiedAt: 1 }
      },
      {
        ...base,
        type: 'document-change',
        change: 'saved',
        path: 'a',
        fingerprint: { hash: 'x', size: Number.NaN, modifiedAt: 1 }
      },
      {
        ...base,
        type: 'document-change',
        change: 'saved',
        path: 'a',
        fingerprint: { hash: 'x', size: 1, modifiedAt: Number.NaN }
      }
    ]) {
      expect(isWorkspaceChannelMessage(malformed)).toBe(false)
    }
    expect(isWorkspaceChannelMessage({ type: 'document-change' })).toBe(false)
  })

  it('prevents a second tab from taking a held document lock', async () => {
    const { a, b } = createPair()
    const first = await a.acquire(identity('a.bpmn'))
    const second = await b.acquire(identity('a.bpmn'))

    expect(first.acquired).toBe(true)
    expect(second).toMatchObject({ acquired: false, holderId: 'a' })

    if (first.acquired) await first.lease.release()
    const afterRelease = await b.acquire(identity('a.bpmn'))
    expect(afterRelease.acquired).toBe(true)
    if (afterRelease.acquired) await afterRelease.lease.release()
    a.close()
    b.close()
  })

  it('uses deterministic contention priority for near-simultaneous requests', async () => {
    const { a, b } = createPair({ now: () => 100 })
    const [fromA, fromB] = await Promise.all([
      a.acquire(identity('same.bpmn')),
      b.acquire(identity('same.bpmn'))
    ])

    expect([fromA.acquired, fromB.acquired].filter(Boolean)).toHaveLength(1)
    expect(fromA.acquired).toBe(true)
    expect(fromB).toMatchObject({ acquired: false, holderId: 'a' })
    if (fromA.acquired) await fromA.lease.release()
    a.close()
    b.close()
  })

  it('notifies other tabs of saved, moved, and deleted documents', () => {
    const { a, b } = createPair()
    const listener = vi.fn()
    b.subscribeChanges(listener)
    const fingerprint = { hash: 'new', size: 3, modifiedAt: 5 }

    a.publishDocumentChange({
      identity: identity('new.bpmn'),
      kind: 'moved',
      previousPath: 'old.bpmn',
      fingerprint
    })

    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        protocol: WORKSPACE_CHANNEL_PROTOCOL,
        version: 1,
        senderId: 'a',
        type: 'document-change',
        change: 'moved',
        path: 'new.bpmn',
        previousPath: 'old.bpmn',
        fingerprint
      })
    )
    a.close()
    b.close()
  })

  it('allows another tab to acquire after a lost holder lease expires', async () => {
    let now = 0
    const { a, b } = createPair({ leaseMs: 5, now: () => now })
    expect((await a.acquire(identity('a.bpmn'))).acquired).toBe(true)
    now = 6
    const afterExpiry = await b.acquire(identity('a.bpmn'))
    expect(afterExpiry.acquired).toBe(true)
    if (afterExpiry.acquired) await afterExpiry.lease.release()
    a.close()
    b.close()
  })

  it('isolates messages by workspace and ignores self messages', () => {
    const bus = new MemoryBroadcastBus()
    const a = new BroadcastWorkspaceCoordinator({
      workspaceId: 'ws-a',
      instanceId: 'a',
      factory: bus.factory
    })
    const b = new BroadcastWorkspaceCoordinator({
      workspaceId: 'ws-b',
      instanceId: 'b',
      factory: bus.factory
    })
    const listener = vi.fn()
    b.subscribeChanges(listener)
    a.publishDocumentChange({
      identity: { ...identity('a.bpmn'), workspace: { ...workspace, id: 'ws-a' } },
      kind: 'saved'
    })
    expect(listener).not.toHaveBeenCalled()
    a.close()
    b.close()
  })

  it('covers virtual locks, lease renew/release idempotence, unsubscribe, and closed guards', async () => {
    const { a, b } = createPair()
    const listener = vi.fn()
    const unsubscribe = b.subscribeChanges(listener)
    unsubscribe()
    a.publishDocumentChange({ identity: identity('a.bpmn'), kind: 'saved' })
    expect(listener).not.toHaveBeenCalled()

    const virtual = await a.acquire({ workspace, path: null })
    expect(virtual.acquired).toBe(true)
    if (virtual.acquired) await virtual.lease.release()

    const held = await a.acquire(identity('held.bpmn'))
    expect(held.acquired).toBe(true)
    if (held.acquired) {
      await held.lease.renew?.()
      await held.lease.release()
      await held.lease.release()
      await held.lease.renew?.()
    }

    await expect(
      a.acquire({
        workspace: { ...workspace, id: 'different' },
        path: 'a.bpmn'
      })
    ).rejects.toThrow(/different workspace/)
    a.close()
    a.close()
    await expect(a.acquire(identity('a.bpmn'))).rejects.toThrow(/closed/)
    b.close()
  })

  it('ignores publication for a different workspace and virtual documents', () => {
    const { a, b } = createPair()
    const listener = vi.fn()
    b.subscribeChanges(listener)
    a.publishDocumentChange({
      identity: {
        workspace: { ...workspace, id: 'different' },
        path: 'a.bpmn'
      },
      kind: 'saved'
    })
    a.publishDocumentChange({
      identity: { workspace, path: null },
      kind: 'deleted'
    })
    expect(listener).not.toHaveBeenCalled()
    a.close()
    b.close()
  })

  it('announces an already-held lock to a tab that opens later', async () => {
    const bus = new MemoryBroadcastBus()
    const common = {
      workspaceId: 'ws',
      factory: bus.factory,
      contentionMs: 1,
      leaseMs: 100
    }
    const a = new BroadcastWorkspaceCoordinator({
      ...common,
      instanceId: 'a'
    })
    const held = await a.acquire(identity('late.bpmn'))
    const b = new BroadcastWorkspaceCoordinator({
      ...common,
      instanceId: 'b'
    })
    await expect(b.acquire(identity('late.bpmn'))).resolves.toMatchObject({
      acquired: false,
      holderId: 'a'
    })
    if (held.acquired) await held.lease.release()
    a.close()
    b.close()
  })

  it('prunes expired local/request state and makes stale lease methods harmless', async () => {
    let now = 0
    const bus = new MemoryBroadcastBus()
    const coordinator = new BroadcastWorkspaceCoordinator({
      workspaceId: 'ws',
      instanceId: 'a',
      factory: bus.factory,
      contentionMs: 1,
      leaseMs: 5,
      now: () => now
    })
    const leaseResult = await coordinator.acquire(identity('expired.bpmn'))
    const raw = bus.factory('orbitpm-workspace:ws')
    raw.postMessage({
      protocol: WORKSPACE_CHANNEL_PROTOCOL,
      version: WORKSPACE_CHANNEL_VERSION,
      workspaceId: 'ws',
      senderId: 'remote',
      sentAt: 0,
      type: 'lock-request',
      path: 'remote.bpmn',
      requestId: 'remote-request',
      requestedAt: 0,
      expiresAt: 5
    })
    now = 20
    const fresh = await coordinator.acquire(identity('fresh.bpmn'))
    if (leaseResult.acquired) {
      await leaseResult.lease.renew?.()
      await leaseResult.lease.release()
    }
    if (fresh.acquired) await fresh.lease.release()
    raw.close()
    coordinator.close()
  })

  it('ignores malformed, foreign, and self-authored messages delivered on the same channel', () => {
    const bus = new MemoryBroadcastBus()
    const coordinator = new BroadcastWorkspaceCoordinator({
      workspaceId: 'ws',
      instanceId: 'a',
      factory: bus.factory
    })
    const listener = vi.fn()
    coordinator.subscribeChanges(listener)
    const raw = bus.factory('orbitpm-workspace:ws')
    const change = {
      protocol: WORKSPACE_CHANNEL_PROTOCOL,
      version: WORKSPACE_CHANNEL_VERSION,
      sentAt: 1,
      type: 'document-change',
      change: 'saved',
      path: 'a.bpmn'
    }
    raw.postMessage({ broken: true })
    raw.postMessage({
      ...change,
      workspaceId: 'foreign',
      senderId: 'remote'
    })
    raw.postMessage({
      ...change,
      workspaceId: 'ws',
      senderId: 'a'
    })
    expect(listener).not.toHaveBeenCalled()
    raw.close()
    coordinator.close()
    coordinator.publishDocumentChange({
      identity: identity('after-close.bpmn'),
      kind: 'saved'
    })
  })

  it('uses the native BroadcastChannel factory when no test factory is supplied', () => {
    const coordinator = new BroadcastWorkspaceCoordinator({
      workspaceId: `native-${Date.now()}`,
      instanceId: 'native',
      channelNamePrefix: 'orbitpm-test-native'
    })
    coordinator.close()
  })
})
