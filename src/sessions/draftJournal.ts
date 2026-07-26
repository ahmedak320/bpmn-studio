import type { DocumentIdentity, DocumentSession, FileFingerprint, SessionId } from './types'

export interface DraftKey {
  workspaceId: string
  path: string | null
  sessionId: SessionId
}

export interface DraftRecord extends DraftKey {
  id: string
  xml: string
  baseHash: string | null
  timestamp: number
  appVersion: string
}

export interface DraftJournal {
  put(record: DraftRecord): Promise<void>
  get(key: DraftKey): Promise<DraftRecord | null>
  listWorkspace(workspaceId: string): Promise<readonly DraftRecord[]>
  delete(key: DraftKey): Promise<void>
  /** Creation-only at the destination; an unrelated recovery draft is never overwritten. */
  move(from: DraftKey, to: DraftKey): Promise<void>
  clearWorkspace(workspaceId: string): Promise<void>
}

export interface DraftSource {
  sessionId: SessionId
  identity: DocumentIdentity
  currentXml: string
  dirty: boolean
  base: FileFingerprint | null
}

export interface DraftRecoveryComparison {
  draft: DraftRecord
  loadedXml: string
  loadedBaseHash: string | null
  relation: 'same-content' | 'same-base' | 'base-diverged' | 'unknown-base'
  /**
   * Recovery is always a review action. Even when based on the loaded file, the
   * coordinator never replaces editor XML automatically.
   */
  requiresReview: true
}

export function draftKeyOf(source: DraftSource): DraftKey {
  return {
    workspaceId: source.identity.workspace.id,
    path: source.identity.path,
    sessionId: source.sessionId
  }
}

export function draftId(key: DraftKey): string {
  // A persisted file is identified by workspace+path so a newly generated
  // session id after restart still discovers its draft. Virtual documents have
  // no path, so their stable session id remains part of the key.
  return JSON.stringify([
    key.workspaceId,
    key.path,
    key.path === null ? key.sessionId : null
  ])
}

export function createDraftRecoveryComparison(
  draft: DraftRecord,
  loadedXml: string,
  loadedBaseHash: string | null
): DraftRecoveryComparison {
  const relation =
    draft.xml === loadedXml
      ? 'same-content'
      : !draft.baseHash || !loadedBaseHash
        ? 'unknown-base'
        : draft.baseHash === loadedBaseHash
          ? 'same-base'
          : 'base-diverged'
  return { draft, loadedXml, loadedBaseHash, relation, requiresReview: true }
}

export async function findDraftRecoveryComparison(
  journal: DraftJournal,
  key: DraftKey,
  loadedXml: string,
  loadedBaseHash: string | null
): Promise<DraftRecoveryComparison | null> {
  const draft = await journal.get(key)
  return draft
    ? createDraftRecoveryComparison(draft, loadedXml, loadedBaseHash)
    : null
}

export class MemoryDraftJournal implements DraftJournal {
  readonly #records = new Map<string, DraftRecord>()

  async put(record: DraftRecord): Promise<void> {
    this.#records.set(record.id, { ...record })
  }

  async get(key: DraftKey): Promise<DraftRecord | null> {
    const record = this.#records.get(draftId(key))
    return record ? { ...record } : null
  }

  async listWorkspace(workspaceId: string): Promise<readonly DraftRecord[]> {
    return [...this.#records.values()]
      .filter((record) => record.workspaceId === workspaceId)
      .sort((a, b) => b.timestamp - a.timestamp)
      .map((record) => ({ ...record }))
  }

  async delete(key: DraftKey): Promise<void> {
    this.#records.delete(draftId(key))
  }

  async move(from: DraftKey, to: DraftKey): Promise<void> {
    const fromId = draftId(from)
    const toId = draftId(to)
    if (fromId === toId) return
    const current = this.#records.get(fromId)
    if (!current) return
    if (this.#records.has(toId)) {
      throw new Error('A recovery draft already exists at the destination path')
    }
    this.#records.delete(fromId)
    const next: DraftRecord = { ...current, ...to, id: draftId(to) }
    this.#records.set(next.id, next)
  }

  async clearWorkspace(workspaceId: string): Promise<void> {
    for (const [id, record] of this.#records) {
      if (record.workspaceId === workspaceId) this.#records.delete(id)
    }
  }
}

export interface IndexedDbDraftJournalOptions {
  indexedDB?: IDBFactory
  databaseName?: string
}

const DRAFT_STORE = 'drafts'
const WORKSPACE_INDEX = 'workspaceId'

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'))
  })
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('IndexedDB transaction failed'))
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('IndexedDB transaction aborted'))
  })
}

/**
 * Dependency-free IndexedDB journal. It uses its own database so upgrading the
 * draft schema cannot interfere with the existing persisted directory handle.
 */
export class IndexedDbDraftJournal implements DraftJournal {
  readonly #factory: IDBFactory
  readonly #databaseName: string

  constructor(options: IndexedDbDraftJournalOptions = {}) {
    const factory = options.indexedDB ?? globalThis.indexedDB
    if (!factory) throw new Error('IndexedDB is unavailable')
    this.#factory = factory
    this.#databaseName = options.databaseName ?? 'orbitpm-lite-document-sessions'
  }

  async put(record: DraftRecord): Promise<void> {
    const db = await this.#open()
    try {
      const tx = db.transaction(DRAFT_STORE, 'readwrite')
      tx.objectStore(DRAFT_STORE).put(record)
      await transactionDone(tx)
    } finally {
      db.close()
    }
  }

  async get(key: DraftKey): Promise<DraftRecord | null> {
    const db = await this.#open()
    try {
      const tx = db.transaction(DRAFT_STORE, 'readonly')
      const done = transactionDone(tx)
      const result = await requestResult(
        tx.objectStore(DRAFT_STORE).get(draftId(key)) as IDBRequest<DraftRecord | undefined>
      )
      await done
      return result ?? null
    } finally {
      db.close()
    }
  }

  async listWorkspace(workspaceId: string): Promise<readonly DraftRecord[]> {
    const db = await this.#open()
    try {
      const tx = db.transaction(DRAFT_STORE, 'readonly')
      const done = transactionDone(tx)
      const index = tx.objectStore(DRAFT_STORE).index(WORKSPACE_INDEX)
      const result = await requestResult(
        index.getAll(workspaceId) as IDBRequest<DraftRecord[]>
      )
      await done
      return result.sort((a, b) => b.timestamp - a.timestamp)
    } finally {
      db.close()
    }
  }

  async delete(key: DraftKey): Promise<void> {
    const db = await this.#open()
    try {
      const tx = db.transaction(DRAFT_STORE, 'readwrite')
      tx.objectStore(DRAFT_STORE).delete(draftId(key))
      await transactionDone(tx)
    } finally {
      db.close()
    }
  }

  async move(from: DraftKey, to: DraftKey): Promise<void> {
    if (draftId(from) === draftId(to)) return
    const db = await this.#open()
    try {
      const tx = db.transaction(DRAFT_STORE, 'readwrite')
      const store = tx.objectStore(DRAFT_STORE)
      const done = transactionDone(tx)
      const requestsDone = new Promise<void>((resolve, reject) => {
        const fromRequest = store.get(draftId(from)) as IDBRequest<DraftRecord | undefined>
        const toRequest = store.get(draftId(to)) as IDBRequest<DraftRecord | undefined>
        let fromRecord: DraftRecord | undefined
        let toRecord: DraftRecord | undefined
        let completed = 0
        const apply = (): void => {
          completed += 1
          if (completed !== 2) return
          if (!fromRecord) {
            resolve()
            return
          }
          if (toRecord) {
            tx.abort()
            reject(new Error('A recovery draft already exists at the destination path'))
            return
          }
          store.delete(draftId(from))
          store.put({ ...fromRecord, ...to, id: draftId(to) } satisfies DraftRecord)
          resolve()
        }
        fromRequest.onsuccess = () => {
          fromRecord = fromRequest.result
          apply()
        }
        toRequest.onsuccess = () => {
          toRecord = toRequest.result
          apply()
        }
        const failed = (request: IDBRequest): void => {
          reject(request.error ?? new Error('Could not inspect draft migration paths'))
        }
        fromRequest.onerror = () => failed(fromRequest)
        toRequest.onerror = () => failed(toRequest)
      })
      await Promise.all([requestsDone, done])
    } finally {
      db.close()
    }
  }

  async clearWorkspace(workspaceId: string): Promise<void> {
    const db = await this.#open()
    try {
      const tx = db.transaction(DRAFT_STORE, 'readwrite')
      const cursor = tx
        .objectStore(DRAFT_STORE)
        .index(WORKSPACE_INDEX)
        .openKeyCursor(workspaceId)
      cursor.onsuccess = () => {
        const value = cursor.result
        if (!value) return
        tx.objectStore(DRAFT_STORE).delete(value.primaryKey)
        value.continue()
      }
      await transactionDone(tx)
    } finally {
      db.close()
    }
  }

  #open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = this.#factory.open(this.#databaseName, 1)
      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains(DRAFT_STORE)) {
          const store = db.createObjectStore(DRAFT_STORE, { keyPath: 'id' })
          store.createIndex(WORKSPACE_INDEX, WORKSPACE_INDEX, { unique: false })
        }
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error ?? new Error('Could not open draft journal'))
      request.onblocked = () => reject(new Error('Draft journal upgrade is blocked'))
    })
  }
}

export interface DraftTimer {
  setTimeout(callback: () => void, delayMs: number): unknown
  clearTimeout(handle: unknown): void
}

export interface DraftLifecycleTarget {
  addEventListener(type: 'blur' | 'pagehide', listener: () => void): void
  removeEventListener(type: 'blur' | 'pagehide', listener: () => void): void
}

export interface DraftJournalCoordinatorOptions {
  appVersion: string
  debounceMs?: number
  now?: () => number
  timer?: DraftTimer
  onError?: (error: unknown) => void
}

export interface DraftPathMigrationInput {
  sessionId: SessionId
  from: DocumentIdentity
  to: DocumentIdentity | null
}

function browserTimer(): DraftTimer {
  return {
    setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
    clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>)
  }
}

/**
 * Maintains one debounced dirty draft per live session and serializes journal
 * operations per session, so an in-flight put can never resurrect a draft
 * after a confirmed-save delete.
 */
export class DraftJournalCoordinator {
  readonly #journal: DraftJournal
  readonly #appVersion: string
  readonly #debounceMs: number
  readonly #now: () => number
  readonly #timer: DraftTimer
  readonly #onError: (error: unknown) => void
  readonly #sources = new Map<SessionId, DraftSource>()
  readonly #timers = new Map<SessionId, unknown>()
  readonly #queues = new Map<SessionId, Promise<unknown>>()
  readonly #lastPersistedKey = new Map<SessionId, DraftKey>()
  readonly #detach = new Set<() => void>()

  constructor(journal: DraftJournal, options: DraftJournalCoordinatorOptions) {
    this.#journal = journal
    this.#appVersion = options.appVersion
    this.#debounceMs = options.debounceMs ?? 2000
    this.#now = options.now ?? Date.now
    this.#timer = options.timer ?? browserTimer()
    this.#onError = options.onError ?? (() => undefined)
  }

  track(sourceInput: DraftSource | DocumentSession): void {
    const source: DraftSource =
      'sessionId' in sourceInput
        ? sourceInput
        : {
            sessionId: sourceInput.id,
            identity: sourceInput.identity,
            currentXml: sourceInput.currentXml,
            dirty: sourceInput.dirty,
            base: sourceInput.base
          }
    const previous = this.#sources.get(source.sessionId)
    this.#sources.set(source.sessionId, source)
    if (previous && draftId(draftKeyOf(previous)) !== draftId(draftKeyOf(source))) {
      void this.#enqueue(source.sessionId, async () => {
        await this.#journal.move(draftKeyOf(previous), draftKeyOf(source))
        const persisted = this.#lastPersistedKey.get(source.sessionId)
        if (persisted && draftId(persisted) === draftId(draftKeyOf(previous))) {
          this.#lastPersistedKey.set(source.sessionId, draftKeyOf(source))
        }
      }).catch(this.#onError)
    }
    this.#cancelTimer(source.sessionId)
    if (source.dirty) {
      const handle = this.#timer.setTimeout(() => {
        this.#timers.delete(source.sessionId)
        void this.flush(source.sessionId).catch(this.#onError)
      }, this.#debounceMs)
      this.#timers.set(source.sessionId, handle)
    }
  }

  async flush(sessionId: SessionId): Promise<void> {
    this.#cancelTimer(sessionId)
    const source = this.#sources.get(sessionId)
    if (!source?.dirty) return
    const key = draftKeyOf(source)
    const record: DraftRecord = {
      ...key,
      id: draftId(key),
      xml: source.currentXml,
      baseHash: source.base?.hash ?? null,
      timestamp: this.#now(),
      appVersion: this.#appVersion
    }
    await this.#enqueue(sessionId, async () => {
      await this.#journal.put(record)
      this.#lastPersistedKey.set(sessionId, key)
    })
  }

  async flushAll(): Promise<void> {
    await Promise.all(
      [...this.#sources.values()]
        .filter((source) => source.dirty)
        .map((source) => this.flush(source.sessionId))
    )
  }

  /**
   * Delete only after durable save confirmation. If a newer edit arrived while
   * the older XML was being saved, preserve/rewrite a draft of that newer XML.
   */
  async confirmedSave(sessionId: SessionId, savedXml: string): Promise<void> {
    this.#cancelTimer(sessionId)
    const source = this.#sources.get(sessionId)
    if (!source) return
    if (source.currentXml !== savedXml) {
      await this.flush(sessionId)
      return
    }
    this.#sources.set(sessionId, { ...source, dirty: false, base: source.base })
    const currentKey = draftKeyOf(source)
    const persistedKey = this.#lastPersistedKey.get(sessionId)
    await this.#enqueue(sessionId, async () => {
      await this.#journal.delete(currentKey)
      if (persistedKey && draftId(persistedKey) !== draftId(currentKey)) {
        await this.#journal.delete(persistedKey)
      }
      this.#lastPersistedKey.delete(sessionId)
    })
  }

  async explicitDiscard(sessionId: SessionId): Promise<void> {
    this.#cancelTimer(sessionId)
    const source = this.#sources.get(sessionId)
    if (!source) return
    this.#sources.set(sessionId, { ...source, dirty: false })
    const currentKey = draftKeyOf(source)
    const persistedKey = this.#lastPersistedKey.get(sessionId)
    await this.#enqueue(sessionId, async () => {
      await this.#journal.delete(currentKey)
      if (persistedKey && draftId(persistedKey) !== draftId(currentKey)) {
        await this.#journal.delete(persistedKey)
      }
      this.#lastPersistedKey.delete(sessionId)
    })
  }

  async untrack(sessionId: SessionId): Promise<void> {
    this.#cancelTimer(sessionId)
    this.#sources.delete(sessionId)
    await this.#queues.get(sessionId)
    this.#queues.delete(sessionId)
  }

  /**
   * Transactional seam used by path moves/renames/deletes. Records move before
   * the session-store identity commit; live sources intentionally stay on their
   * old identity until that atomic commit publishes. The returned rollback hook
   * restores every record if the filesystem or store transaction later fails.
   */
  async migrateDraftRecords(
    migrations: readonly DraftPathMigrationInput[]
  ): Promise<{ rollback(): Promise<void> }> {
    const applied: Array<{
      migration: DraftPathMigrationInput
      record: DraftRecord | null
      fromKey: DraftKey
      toKey: DraftKey | null
    }> = []
    try {
      for (const migration of migrations) {
        await this.flush(migration.sessionId)
        const fromKey: DraftKey = {
          workspaceId: migration.from.workspace.id,
          path: migration.from.path,
          sessionId: migration.sessionId
        }
        const toKey: DraftKey | null = migration.to
          ? {
              workspaceId: migration.to.workspace.id,
              path: migration.to.path,
              sessionId: migration.sessionId
            }
          : null
        const record = await this.#journal.get(fromKey)
        await this.#enqueue(migration.sessionId, async () => {
          if (toKey) await this.#journal.move(fromKey, toKey)
          else await this.#journal.delete(fromKey)
        })
        applied.push({ migration, record, fromKey, toKey })
      }
    } catch (error) {
      await this.#rollbackDraftMigrations(applied)
      throw error
    }
    let rolledBack = false
    return {
      rollback: async () => {
        if (rolledBack) return
        rolledBack = true
        await this.#rollbackDraftMigrations(applied)
      }
    }
  }

  attachLifecycle(target: DraftLifecycleTarget): () => void {
    const flush = (): void => {
      void this.flushAll().catch(this.#onError)
    }
    target.addEventListener('blur', flush)
    target.addEventListener('pagehide', flush)
    const detach = (): void => {
      target.removeEventListener('blur', flush)
      target.removeEventListener('pagehide', flush)
      this.#detach.delete(detach)
    }
    this.#detach.add(detach)
    return detach
  }

  dispose(): void {
    for (const sessionId of this.#timers.keys()) this.#cancelTimer(sessionId)
    for (const detach of [...this.#detach]) detach()
  }

  #cancelTimer(sessionId: SessionId): void {
    const handle = this.#timers.get(sessionId)
    if (handle === undefined) return
    this.#timer.clearTimeout(handle)
    this.#timers.delete(sessionId)
  }

  #enqueue(sessionId: SessionId, operation: () => Promise<void>): Promise<void> {
    const previous = this.#queues.get(sessionId) ?? Promise.resolve()
    const next = previous.catch(() => undefined).then(operation)
    this.#queues.set(sessionId, next)
    void next.finally(() => {
      if (this.#queues.get(sessionId) === next) this.#queues.delete(sessionId)
    }).catch(() => undefined)
    return next
  }

  async #rollbackDraftMigrations(
    applied: readonly {
      migration: DraftPathMigrationInput
      record: DraftRecord | null
      fromKey: DraftKey
      toKey: DraftKey | null
    }[]
  ): Promise<void> {
    for (const item of [...applied].reverse()) {
      await this.#enqueue(item.migration.sessionId, async () => {
        if (item.toKey) {
          await this.#journal.delete(item.toKey)
        }
        if (item.record) await this.#journal.put(item.record)
        else await this.#journal.delete(item.fromKey)
      })
    }
  }
}
