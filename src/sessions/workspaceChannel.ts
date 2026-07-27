import type { SessionLockLease, SessionLockResult } from './controller'
import type { DocumentIdentity, FileFingerprint } from './types'

export const WORKSPACE_CHANNEL_PROTOCOL = 'orbitpm-document-sessions'
export const WORKSPACE_CHANNEL_VERSION = 1 as const

interface MessageBase {
  protocol: typeof WORKSPACE_CHANNEL_PROTOCOL
  version: typeof WORKSPACE_CHANNEL_VERSION
  workspaceId: string
  senderId: string
  sentAt: number
}

export type WorkspaceChannelMessage =
  | (MessageBase & { type: 'hello' })
  | (MessageBase & {
      type: 'lock-request'
      path: string
      requestId: string
      requestedAt: number
      expiresAt: number
    })
  | (MessageBase & {
      type: 'lock-held' | 'lock-acquired' | 'lock-renewed'
      path: string
      requestId: string
      expiresAt: number
    })
  | (MessageBase & {
      type: 'lock-released'
      path: string
      requestId: string
    })
  | (MessageBase & {
      type: 'document-change'
      change: 'saved' | 'moved' | 'deleted' | 'invalidated'
      path: string
      previousPath?: string
      fingerprint?: FileFingerprint
    })

export type WorkspaceDocumentChange = Extract<WorkspaceChannelMessage, { type: 'document-change' }>

export interface BroadcastMessageEventLike {
  data: unknown
}

export interface BroadcastChannelLike {
  postMessage(message: unknown): void
  addEventListener(type: 'message', listener: (event: BroadcastMessageEventLike) => void): void
  removeEventListener(type: 'message', listener: (event: BroadcastMessageEventLike) => void): void
  close(): void
}

export type BroadcastChannelFactory = (name: string) => BroadcastChannelLike

export interface WebLockLike {
  readonly name: string
}

export interface WebLockManagerLike {
  request(
    name: string,
    options: { readonly mode: 'exclusive'; readonly ifAvailable: true },
    callback: (lock: WebLockLike | null) => Promise<void>
  ): Promise<void>
}

export interface WorkspaceChannelTimer {
  setTimeout(callback: () => void, delayMs: number): unknown
  clearTimeout(handle: unknown): void
}

export interface BroadcastWorkspaceCoordinatorOptions {
  workspaceId: string
  instanceId: string
  factory?: BroadcastChannelFactory
  /** Defaults to navigator.locks when available; null explicitly disables it. */
  webLocks?: WebLockManagerLike | null
  channelNamePrefix?: string
  now?: () => number
  timer?: WorkspaceChannelTimer
  contentionMs?: number
  leaseMs?: number
}

interface PendingLock {
  path: string
  requestId: string
  requestedAt: number
  expiresAt: number
  blockedBy?: { holderId: string; expiresAt: number }
}

interface KnownLock {
  path: string
  requestId: string
  ownerId: string
  expiresAt: number
}

interface RemoteRequest {
  path: string
  requestId: string
  senderId: string
  requestedAt: number
  expiresAt: number
  observedUntil: number
}

function browserFactory(name: string): BroadcastChannelLike {
  return new BroadcastChannel(name)
}

function browserWebLocks(): WebLockManagerLike | undefined {
  if (typeof globalThis.navigator === 'undefined' || !globalThis.navigator.locks) return undefined
  return {
    request: (name, options, callback) =>
      globalThis.navigator.locks.request(name, options, callback).then(() => undefined)
  }
}

function silentChannel(): BroadcastChannelLike {
  return {
    postMessage: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    close: () => undefined
  }
}

function browserTimer(): WorkspaceChannelTimer {
  return {
    setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
    clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isFingerprint(value: unknown): value is FileFingerprint {
  return (
    isRecord(value) &&
    typeof value.hash === 'string' &&
    typeof value.size === 'number' &&
    Number.isFinite(value.size) &&
    typeof value.modifiedAt === 'number' &&
    Number.isFinite(value.modifiedAt)
  )
}

export function isWorkspaceChannelMessage(value: unknown): value is WorkspaceChannelMessage {
  if (
    !isRecord(value) ||
    value.protocol !== WORKSPACE_CHANNEL_PROTOCOL ||
    value.version !== WORKSPACE_CHANNEL_VERSION ||
    typeof value.workspaceId !== 'string' ||
    typeof value.senderId !== 'string' ||
    typeof value.sentAt !== 'number' ||
    typeof value.type !== 'string'
  ) {
    return false
  }
  switch (value.type) {
    case 'hello':
      return true
    case 'lock-request':
      return (
        typeof value.path === 'string' &&
        typeof value.requestId === 'string' &&
        typeof value.requestedAt === 'number' &&
        typeof value.expiresAt === 'number'
      )
    case 'lock-held':
    case 'lock-acquired':
    case 'lock-renewed':
      return (
        typeof value.path === 'string' &&
        typeof value.requestId === 'string' &&
        typeof value.expiresAt === 'number'
      )
    case 'lock-released':
      return typeof value.path === 'string' && typeof value.requestId === 'string'
    case 'document-change':
      return (
        (value.change === 'saved' ||
          value.change === 'moved' ||
          value.change === 'deleted' ||
          value.change === 'invalidated') &&
        typeof value.path === 'string' &&
        (value.previousPath === undefined || typeof value.previousPath === 'string') &&
        (value.fingerprint === undefined || isFingerprint(value.fingerprint))
      )
    default:
      return false
  }
}

function comparePriority(
  a: Pick<PendingLock, 'requestedAt' | 'requestId'> & { senderId: string },
  b: Pick<PendingLock, 'requestedAt' | 'requestId'> & { senderId: string }
): number {
  if (a.requestedAt !== b.requestedAt) return a.requestedAt - b.requestedAt
  const sender = a.senderId.localeCompare(b.senderId)
  return sender !== 0 ? sender : a.requestId.localeCompare(b.requestId)
}

function wait(timer: WorkspaceChannelTimer, delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    timer.setTimeout(resolve, delayMs)
  })
}

function defaultRequestId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID()
  return `lock-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

/**
 * Versioned BroadcastChannel protocol providing advisory cross-tab leases and
 * external-change notifications. The storage adapter's expected-hash write is
 * still the final authority; the channel removes the ordinary silent-overwrite
 * race and the atomic write closes message-loss/lease-expiry races.
 */
export class BroadcastWorkspaceCoordinator {
  readonly #workspaceId: string
  readonly #instanceId: string
  readonly #channel: BroadcastChannelLike
  readonly #now: () => number
  readonly #timer: WorkspaceChannelTimer
  readonly #contentionMs: number
  readonly #leaseMs: number
  readonly #webLocks?: WebLockManagerLike
  readonly #webLockNamePrefix: string
  readonly #pending = new Map<string, PendingLock>()
  readonly #localLocks = new Map<string, KnownLock>()
  readonly #remoteLocks = new Map<string, KnownLock>()
  readonly #remoteRequests = new Map<string, RemoteRequest>()
  readonly #leaseRenewalTimers = new Map<string, unknown>()
  readonly #webLockLeases = new Set<SessionLockLease>()
  readonly #changeListeners = new Set<(change: WorkspaceDocumentChange) => void>()
  #closed = false

  constructor(options: BroadcastWorkspaceCoordinatorOptions) {
    this.#workspaceId = options.workspaceId
    this.#instanceId = options.instanceId
    this.#now = options.now ?? Date.now
    this.#timer = options.timer ?? browserTimer()
    this.#contentionMs = options.contentionMs ?? 75
    this.#leaseMs = options.leaseMs ?? 30_000
    this.#webLocks = options.webLocks === null ? undefined : (options.webLocks ?? browserWebLocks())
    const channelName = `${options.channelNamePrefix ?? 'orbitpm-workspace'}:${encodeURIComponent(options.workspaceId)}`
    this.#webLockNamePrefix = `${channelName}:lock`
    const factory =
      options.factory ??
      (typeof globalThis.BroadcastChannel === 'function' ? browserFactory : undefined)
    if (!factory && !this.#webLocks) {
      throw new Error('No cross-tab workspace coordination primitive is available')
    }
    this.#channel = factory ? factory(channelName) : silentChannel()
    this.#channel.addEventListener('message', this.#onMessage)
    this.#post({ type: 'hello' })
  }

  subscribeChanges(listener: (change: WorkspaceDocumentChange) => void): () => void {
    this.#changeListeners.add(listener)
    return () => this.#changeListeners.delete(listener)
  }

  async acquire(identity: DocumentIdentity): Promise<SessionLockResult> {
    if (this.#closed) throw new Error('Workspace coordinator is closed')
    if (identity.workspace.id !== this.#workspaceId) {
      throw new Error('Cannot lock a document from a different workspace')
    }
    const path = identity.path
    if (path === null) {
      return { acquired: true, lease: { release: () => undefined } }
    }
    this.#pruneExpired()
    const known = this.#localLocks.get(path) ?? this.#remoteLocks.get(path)
    if (known) {
      return {
        acquired: false,
        holderId: known.ownerId,
        expiresAt: known.expiresAt
      }
    }

    const webLease = await this.#acquireWebLock(path)
    if (this.#closed) {
      await webLease?.release()
      throw new Error('Workspace coordinator is closed')
    }
    if (webLease === null) {
      return {
        acquired: false,
        holderId: 'web-lock'
      }
    }

    try {
      const requestedAt = this.#now()
      const pending: PendingLock = {
        path,
        requestId: defaultRequestId(),
        requestedAt,
        expiresAt: requestedAt + this.#leaseMs
      }
      const contender = this.#remoteRequests.get(path)
      if (
        contender &&
        comparePriority(
          {
            requestedAt: contender.requestedAt,
            requestId: contender.requestId,
            senderId: contender.senderId
          },
          {
            requestedAt: pending.requestedAt,
            requestId: pending.requestId,
            senderId: this.#instanceId
          }
        ) < 0
      ) {
        pending.blockedBy = {
          holderId: contender.senderId,
          expiresAt: contender.expiresAt
        }
      }
      this.#pending.set(pending.requestId, pending)
      this.#post({
        type: 'lock-request',
        path,
        requestId: pending.requestId,
        requestedAt,
        expiresAt: pending.expiresAt
      })
      await wait(this.#timer, this.#contentionMs)
      this.#pending.delete(pending.requestId)
      if (this.#closed) throw new Error('Workspace coordinator is closed')
      this.#pruneExpired()
      const blocking =
        pending.blockedBy ??
        (() => {
          const remote = this.#remoteLocks.get(path)
          return remote ? { holderId: remote.ownerId, expiresAt: remote.expiresAt } : undefined
        })()
      if (blocking) {
        await webLease?.release()
        return {
          acquired: false,
          holderId: blocking.holderId,
          expiresAt: blocking.expiresAt
        }
      }

      const lock: KnownLock = {
        path,
        requestId: pending.requestId,
        ownerId: this.#instanceId,
        expiresAt: this.#now() + this.#leaseMs
      }
      this.#localLocks.set(path, lock)
      this.#post({
        type: 'lock-acquired',
        path,
        requestId: lock.requestId,
        expiresAt: lock.expiresAt
      })
      this.#scheduleLeaseRenewal(lock)

      let released = false
      const lease: SessionLockLease = {
        release: async () => {
          if (released) return
          released = true
          this.#stopLeaseRenewal(lock.requestId)
          const current = this.#localLocks.get(path)
          if (current?.requestId === lock.requestId) {
            this.#localLocks.delete(path)
            this.#post({ type: 'lock-released', path, requestId: lock.requestId })
          }
          await webLease?.release()
        },
        renew: () => {
          if (released) return
          const current = this.#localLocks.get(path)
          if (current?.requestId !== lock.requestId) return
          const now = this.#now()
          if (current.expiresAt <= now) {
            this.#localLocks.delete(path)
            this.#stopLeaseRenewal(lock.requestId)
            this.#post({ type: 'lock-released', path, requestId: lock.requestId })
            return
          }
          current.expiresAt = now + this.#leaseMs
          this.#post({
            type: 'lock-renewed',
            path,
            requestId: lock.requestId,
            expiresAt: current.expiresAt
          })
          this.#scheduleLeaseRenewal(current)
        }
      }
      return { acquired: true, lease }
    } catch (error) {
      await webLease?.release()
      throw error
    }
  }

  publishDocumentChange(change: {
    identity: DocumentIdentity
    kind: 'saved' | 'moved' | 'deleted' | 'invalidated'
    fingerprint?: FileFingerprint
    previousPath?: string
  }): void {
    if (change.identity.workspace.id !== this.#workspaceId || change.identity.path === null) return
    this.#post({
      type: 'document-change',
      change: change.kind,
      path: change.identity.path,
      previousPath: change.previousPath,
      fingerprint: change.fingerprint
    })
  }

  close(): void {
    if (this.#closed) return
    for (const lock of this.#localLocks.values()) {
      this.#post({ type: 'lock-released', path: lock.path, requestId: lock.requestId })
    }
    for (const pending of this.#pending.values()) {
      this.#post({ type: 'lock-released', path: pending.path, requestId: pending.requestId })
    }
    for (const requestId of this.#leaseRenewalTimers.keys()) {
      this.#stopLeaseRenewal(requestId)
    }
    for (const lease of [...this.#webLockLeases]) {
      void Promise.resolve(lease.release()).catch(() => undefined)
    }
    this.#closed = true
    this.#localLocks.clear()
    this.#remoteLocks.clear()
    this.#remoteRequests.clear()
    this.#pending.clear()
    this.#changeListeners.clear()
    this.#channel.removeEventListener('message', this.#onMessage)
    this.#channel.close()
  }

  readonly #onMessage = (event: BroadcastMessageEventLike): void => {
    const message = event.data
    if (
      !isWorkspaceChannelMessage(message) ||
      message.workspaceId !== this.#workspaceId ||
      message.senderId === this.#instanceId
    ) {
      return
    }
    this.#pruneExpired()
    switch (message.type) {
      case 'hello':
        // A newly opened tab may have missed earlier acquisition messages.
        for (const lock of this.#localLocks.values()) {
          this.#post({
            type: 'lock-held',
            path: lock.path,
            requestId: lock.requestId,
            expiresAt: lock.expiresAt
          })
        }
        break
      case 'lock-request': {
        const existingRequest = this.#remoteRequests.get(message.path)
        const incoming: RemoteRequest = {
          path: message.path,
          requestId: message.requestId,
          senderId: message.senderId,
          requestedAt: message.requestedAt,
          expiresAt: message.expiresAt,
          observedUntil: this.#now() + Math.max(5, this.#contentionMs * 2)
        }
        if (!existingRequest || comparePriority(incoming, existingRequest) < 0) {
          this.#remoteRequests.set(message.path, incoming)
        }
        const held = this.#localLocks.get(message.path)
        if (held) {
          this.#post({
            type: 'lock-held',
            path: held.path,
            requestId: held.requestId,
            expiresAt: held.expiresAt
          })
        }
        for (const pending of this.#pending.values()) {
          if (pending.path !== message.path) continue
          const incomingWins =
            comparePriority(
              {
                requestedAt: message.requestedAt,
                requestId: message.requestId,
                senderId: message.senderId
              },
              {
                requestedAt: pending.requestedAt,
                requestId: pending.requestId,
                senderId: this.#instanceId
              }
            ) < 0
          if (incomingWins) {
            pending.blockedBy = {
              holderId: message.senderId,
              expiresAt: message.expiresAt
            }
          }
        }
        break
      }
      case 'lock-held':
      case 'lock-acquired':
      case 'lock-renewed': {
        this.#remoteRequests.delete(message.path)
        this.#remoteLocks.set(message.path, {
          path: message.path,
          requestId: message.requestId,
          ownerId: message.senderId,
          expiresAt: message.expiresAt
        })
        for (const pending of this.#pending.values()) {
          if (pending.path === message.path) {
            pending.blockedBy = {
              holderId: message.senderId,
              expiresAt: message.expiresAt
            }
          }
        }
        break
      }
      case 'lock-released': {
        const request = this.#remoteRequests.get(message.path)
        if (request?.senderId === message.senderId && request.requestId === message.requestId) {
          this.#remoteRequests.delete(message.path)
        }
        const known = this.#remoteLocks.get(message.path)
        if (known?.ownerId === message.senderId && known.requestId === message.requestId) {
          this.#remoteLocks.delete(message.path)
        }
        break
      }
      case 'document-change':
        for (const listener of this.#changeListeners) listener(message)
        break
    }
  }

  #pruneExpired(): void {
    const now = this.#now()
    for (const [path, lock] of this.#remoteLocks) {
      if (lock.expiresAt <= now) this.#remoteLocks.delete(path)
    }
    for (const [path, lock] of this.#localLocks) {
      if (lock.expiresAt <= now) {
        this.#localLocks.delete(path)
        this.#stopLeaseRenewal(lock.requestId)
      }
    }
    for (const [path, request] of this.#remoteRequests) {
      if (request.observedUntil <= now) this.#remoteRequests.delete(path)
    }
  }

  #scheduleLeaseRenewal(lock: KnownLock): void {
    this.#stopLeaseRenewal(lock.requestId)
    if (this.#closed) return
    const delayMs = Math.max(1, Math.floor(this.#leaseMs / 3))
    const handle = this.#timer.setTimeout(() => {
      this.#leaseRenewalTimers.delete(lock.requestId)
      if (this.#closed) return
      const current = this.#localLocks.get(lock.path)
      if (current?.requestId !== lock.requestId) return
      const now = this.#now()
      if (current.expiresAt <= now) {
        this.#localLocks.delete(lock.path)
        this.#post({
          type: 'lock-released',
          path: current.path,
          requestId: current.requestId
        })
        return
      }
      current.expiresAt = now + this.#leaseMs
      this.#post({
        type: 'lock-renewed',
        path: current.path,
        requestId: current.requestId,
        expiresAt: current.expiresAt
      })
      this.#scheduleLeaseRenewal(current)
    }, delayMs)
    this.#leaseRenewalTimers.set(lock.requestId, handle)
  }

  #stopLeaseRenewal(requestId: string): void {
    if (!this.#leaseRenewalTimers.has(requestId)) return
    const handle = this.#leaseRenewalTimers.get(requestId)
    this.#leaseRenewalTimers.delete(requestId)
    this.#timer.clearTimeout(handle)
  }

  async #acquireWebLock(path: string): Promise<SessionLockLease | null | undefined> {
    if (!this.#webLocks) return undefined

    let resolveStarted!: (lease: SessionLockLease | null) => void
    let rejectStarted!: (error: unknown) => void
    let releaseHeld!: () => void
    const held = new Promise<void>((resolve) => {
      releaseHeld = resolve
    })
    const started = new Promise<SessionLockLease | null>((resolve, reject) => {
      resolveStarted = resolve
      rejectStarted = reject
    })
    let request: Promise<void> = Promise.resolve()
    request = this.#webLocks.request(
      `${this.#webLockNamePrefix}:${encodeURIComponent(path)}`,
      { mode: 'exclusive', ifAvailable: true },
      async (lock) => {
        if (!lock) {
          resolveStarted(null)
          return
        }
        let released = false
        const lease: SessionLockLease = {
          release: async () => {
            if (released) return
            released = true
            this.#webLockLeases.delete(lease)
            releaseHeld()
            await request
          }
        }
        this.#webLockLeases.add(lease)
        resolveStarted(lease)
        await held
      }
    )
    void request.catch(rejectStarted)
    return started
  }

  #post(
    message:
      | { type: 'hello' }
      | Omit<Extract<WorkspaceChannelMessage, { type: 'lock-request' }>, keyof MessageBase>
      | Omit<
          Extract<
            WorkspaceChannelMessage,
            { type: 'lock-held' | 'lock-acquired' | 'lock-renewed' }
          >,
          keyof MessageBase
        >
      | Omit<Extract<WorkspaceChannelMessage, { type: 'lock-released' }>, keyof MessageBase>
      | Omit<Extract<WorkspaceChannelMessage, { type: 'document-change' }>, keyof MessageBase>
  ): void {
    if (this.#closed) return
    this.#channel.postMessage({
      ...message,
      protocol: WORKSPACE_CHANNEL_PROTOCOL,
      version: WORKSPACE_CHANNEL_VERSION,
      workspaceId: this.#workspaceId,
      senderId: this.#instanceId,
      sentAt: this.#now()
    } satisfies WorkspaceChannelMessage)
  }
}
