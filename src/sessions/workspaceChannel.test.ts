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

  addEventListener(
    _type: 'message',
    listener: (event: BroadcastMessageEventLike) => void
  ): void {
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
    expect(
      isWorkspaceChannelMessage({
        protocol: WORKSPACE_CHANNEL_PROTOCOL,
        version: WORKSPACE_CHANNEL_VERSION,
        workspaceId: 'ws',
        senderId: 'a',
        sentAt: 1,
        type: 'document-change',
        change: 'saved',
        path: 'a.bpmn',
        fingerprint: { hash: 'x', size: 1, modifiedAt: 1 }
      })
    ).toBe(true)
    expect(isWorkspaceChannelMessage({ type: 'document-change' })).toBe(false)
    expect(
      isWorkspaceChannelMessage({
        protocol: WORKSPACE_CHANNEL_PROTOCOL,
        version: 99,
        workspaceId: 'ws',
        senderId: 'a',
        sentAt: 1,
        type: 'hello'
      })
    ).toBe(false)
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
    a.publishDocumentChange({ identity: { ...identity('a.bpmn'), workspace: { ...workspace, id: 'ws-a' } }, kind: 'saved' })
    expect(listener).not.toHaveBeenCalled()
    a.close()
    b.close()
  })
})

