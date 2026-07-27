import {
  IDLE_PATH_MIGRATION,
  IDLE_SAVE_STATE,
  NO_DRAFT_RECOVERY,
  UNKNOWN_VALIDATION,
  documentIdentityKey,
  sameDocumentIdentity,
  type DocumentIdentity,
  type DocumentSession,
  type DocumentSessionSnapshot,
  type DraftRecoveryState,
  type FileFingerprint,
  type SessionEditorBinding,
  type SessionId,
  type SessionIncarnation,
  type SessionPathMigrationState,
  type SessionSaveState,
  type SessionValidationState
} from './types'

export interface OpenDocumentSessionInput {
  id?: SessionId
  identity: DocumentIdentity
  title: string
  xml: string
  lastSavedXml?: string
  base?: FileFingerprint | null
  validation?: SessionValidationState
  draftRecovery?: DraftRecoveryState
  editor?: Partial<SessionEditorBinding>
}

export interface MarkSessionSavedInput {
  xml: string
  savedRevision: number
  fingerprint: FileFingerprint
  identity?: DocumentIdentity
  title?: string
}

export interface SessionStoreOptions {
  now?: () => number
  createId?: () => string
}

export type SessionStoreListener = () => void

/**
 * A store-local claim on a path identity. Controllers hold this across
 * asynchronous Save-As I/O so another session cannot open or migrate onto the
 * destination before the written bytes are acknowledged.
 */
export interface SessionIdentityReservation {
  readonly token: number
  readonly sessionId: SessionId
  readonly incarnation: SessionIncarnation
  readonly identity: DocumentIdentity
}

export type ReserveSessionIdentityResult =
  | { readonly acquired: true; readonly reservation: SessionIdentityReservation }
  | { readonly acquired: false; readonly holderId?: SessionId }

function defaultCreateId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID()
  return `session-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

let nextSessionIncarnation = 1

function createSessionIncarnation(): SessionIncarnation {
  const incarnation = nextSessionIncarnation
  nextSessionIncarnation += 1
  return incarnation
}

function cloneSaveState(state: SessionSaveState): SessionSaveState {
  return { ...state }
}

function clonePathState(state: SessionPathMigrationState): SessionPathMigrationState {
  return { ...state }
}

function indexedIdentityKey(identity: DocumentIdentity): string | null {
  // Virtual documents deliberately have no filesystem identity. More than one
  // may be open in the same workspace, so only path-backed documents belong in
  // the one-session-per-identity index.
  return identity.path === null ? null : documentIdentityKey(identity)
}

/**
 * Small external store suitable for React.useSyncExternalStore, but with no
 * React dependency. Every public mutation publishes one coherent snapshot.
 */
export class DocumentSessionStore {
  readonly #now: () => number
  readonly #createId: () => string
  readonly #sessions = new Map<SessionId, DocumentSession>()
  readonly #identityIndex = new Map<string, SessionId>()
  readonly #identityReservations = new Map<string, SessionIdentityReservation>()
  readonly #listeners = new Set<SessionStoreListener>()
  #activeSessionId: SessionId | null = null
  #version = 0
  #snapshot: DocumentSessionSnapshot = {
    version: 0,
    activeSessionId: null,
    sessions: []
  }
  #batchDepth = 0
  #batchChanged = false
  #nextReservationToken = 1

  constructor(options: SessionStoreOptions = {}) {
    this.#now = options.now ?? Date.now
    this.#createId = options.createId ?? defaultCreateId
  }

  getSnapshot = (): DocumentSessionSnapshot => this.#snapshot

  subscribe = (listener: SessionStoreListener): (() => void) => {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  get(id: SessionId): DocumentSession | undefined {
    return this.#sessions.get(id)
  }

  getByIdentity(identity: DocumentIdentity): DocumentSession | undefined {
    const key = indexedIdentityKey(identity)
    if (key === null) return undefined
    const id = this.#identityIndex.get(key)
    return id ? this.#sessions.get(id) : undefined
  }

  getActive(): DocumentSession | undefined {
    return this.#activeSessionId ? this.#sessions.get(this.#activeSessionId) : undefined
  }

  list(): readonly DocumentSession[] {
    return this.#snapshot.sessions
  }

  reserveIdentity(
    sessionId: SessionId,
    incarnation: SessionIncarnation,
    identity: DocumentIdentity
  ): ReserveSessionIdentityResult {
    const session = this.#sessions.get(sessionId)
    if (!session || session.incarnation !== incarnation) {
      return { acquired: false }
    }
    const key = indexedIdentityKey(identity)
    if (key === null) return { acquired: false }
    const occupant = this.#identityIndex.get(key)
    if (occupant && occupant !== sessionId) {
      return { acquired: false, holderId: occupant }
    }
    const existing = this.#identityReservations.get(key)
    if (existing) {
      if (existing.sessionId === sessionId && existing.incarnation === incarnation) {
        return { acquired: true, reservation: existing }
      }
      return { acquired: false, holderId: existing.sessionId }
    }
    const reservation: SessionIdentityReservation = {
      token: this.#nextReservationToken++,
      sessionId,
      incarnation,
      identity
    }
    this.#identityReservations.set(key, reservation)
    return { acquired: true, reservation }
  }

  isIdentityReservationCurrent(reservation: SessionIdentityReservation): boolean {
    const key = indexedIdentityKey(reservation.identity)
    if (key === null) return false
    const current = this.#identityReservations.get(key)
    const session = this.#sessions.get(reservation.sessionId)
    return Boolean(
      current?.token === reservation.token && session?.incarnation === reservation.incarnation
    )
  }

  releaseIdentityReservation(reservation: SessionIdentityReservation): void {
    const key = indexedIdentityKey(reservation.identity)
    if (key === null) return
    if (this.#identityReservations.get(key)?.token === reservation.token) {
      this.#identityReservations.delete(key)
    }
  }

  open(input: OpenDocumentSessionInput): DocumentSession {
    const identityKey = indexedIdentityKey(input.identity)
    const existingId = identityKey === null ? undefined : this.#identityIndex.get(identityKey)
    if (existingId) {
      const existing = this.#sessions.get(existingId)
      if (!existing) throw new Error('Document-session identity index is inconsistent')
      return existing
    }
    if (identityKey !== null) {
      const reservation = this.#identityReservations.get(identityKey)
      if (reservation) {
        throw new Error(`Document identity is reserved by session "${reservation.sessionId}"`)
      }
    }

    const id = input.id ?? this.#createId()
    if (this.#sessions.has(id)) throw new Error(`Document session "${id}" already exists`)
    const now = this.#now()
    const lastSavedXml = input.lastSavedXml ?? input.xml
    const session: DocumentSession = {
      id,
      incarnation: createSessionIncarnation(),
      identity: input.identity,
      title: input.title,
      currentXml: input.xml,
      lastSavedXml,
      dirty: input.xml !== lastSavedXml,
      revision: 0,
      lastSavedRevision: 0,
      base: input.base ?? null,
      modeler: input.editor?.modeler ?? null,
      commandStack: input.editor?.commandStack ?? null,
      readXml: input.editor?.readXml ?? null,
      validation: input.validation ?? UNKNOWN_VALIDATION,
      draftRecovery: input.draftRecovery ?? NO_DRAFT_RECOVERY,
      save: IDLE_SAVE_STATE,
      pathMigration: IDLE_PATH_MIGRATION,
      createdAt: now,
      updatedAt: now
    }
    this.#sessions.set(id, session)
    if (identityKey !== null) this.#identityIndex.set(identityKey, id)
    this.#activeSessionId ??= id
    this.#changed()
    return session
  }

  close(id: SessionId): boolean {
    const session = this.#sessions.get(id)
    if (!session) return false
    this.#sessions.delete(id)
    const identityKey = indexedIdentityKey(session.identity)
    if (identityKey !== null) this.#identityIndex.delete(identityKey)
    if (this.#activeSessionId === id) {
      const remaining = [...this.#sessions.keys()]
      this.#activeSessionId = remaining.length > 0 ? remaining[remaining.length - 1] : null
    }
    this.#changed()
    return true
  }

  closeMany(ids: readonly SessionId[]): void {
    this.batch(() => {
      for (const id of ids) this.close(id)
    })
  }

  setActive(id: SessionId | null): void {
    if (id !== null && !this.#sessions.has(id)) {
      throw new Error(`Cannot activate unknown document session "${id}"`)
    }
    if (this.#activeSessionId === id) return
    this.#activeSessionId = id
    this.#changed()
  }

  updateXml(id: SessionId, xml: string): DocumentSession {
    return this.update(id, (session) => {
      if (session.currentXml === xml) return session
      const revision = session.revision + 1
      return {
        ...session,
        currentXml: xml,
        dirty: xml !== session.lastSavedXml,
        revision,
        validation:
          session.validation.revision === revision
            ? session.validation
            : { status: 'unknown', revision: null, issues: [] }
      }
    })
  }

  bindEditor(id: SessionId, binding: Partial<SessionEditorBinding>): DocumentSession {
    return this.update(id, (session) => ({
      ...session,
      modeler: binding.modeler === undefined ? session.modeler : binding.modeler,
      commandStack:
        binding.commandStack === undefined ? session.commandStack : binding.commandStack,
      readXml: binding.readXml === undefined ? session.readXml : (binding.readXml ?? null)
    }))
  }

  setValidation(id: SessionId, validation: SessionValidationState): DocumentSession {
    return this.update(id, (session) => ({ ...session, validation }))
  }

  setDraftRecovery(id: SessionId, draftRecovery: DraftRecoveryState): DocumentSession {
    return this.update(id, (session) => ({ ...session, draftRecovery }))
  }

  setSaveState(id: SessionId, save: SessionSaveState): DocumentSession {
    return this.update(id, (session) => ({ ...session, save: cloneSaveState(save) }))
  }

  setPathMigration(id: SessionId, pathMigration: SessionPathMigrationState): DocumentSession {
    return this.update(id, (session) => ({
      ...session,
      pathMigration: clonePathState(pathMigration)
    }))
  }

  markSaved(id: SessionId, input: MarkSessionSavedInput): DocumentSession {
    return this.update(id, (session) => {
      const identity = input.identity ?? session.identity
      return {
        ...session,
        identity,
        title: input.title ?? session.title,
        lastSavedXml: input.xml,
        lastSavedRevision: input.savedRevision,
        base: input.fingerprint,
        dirty: session.currentXml !== input.xml
      }
    })
  }

  replaceWithExternal(
    id: SessionId,
    input: {
      xml: string
      /** Reviewed current XML; `xml` remains the durable external baseline. */
      reviewedXml?: string
      fingerprint: FileFingerprint
      identity?: DocumentIdentity
      title?: string
    }
  ): DocumentSession {
    return this.update(id, (session) => {
      const currentXml = input.reviewedXml ?? input.xml
      const externalRevision =
        session.currentXml === input.xml ? session.revision : session.revision + 1
      const revision = currentXml === input.xml ? externalRevision : externalRevision + 1
      return {
        ...session,
        identity: input.identity ?? session.identity,
        title: input.title ?? session.title,
        currentXml,
        lastSavedXml: input.xml,
        dirty: currentXml !== input.xml,
        revision,
        lastSavedRevision: externalRevision,
        base: input.fingerprint,
        validation: { status: 'unknown', revision: null, issues: [] }
      }
    })
  }

  /**
   * Atomically move path identities. All collisions and stale `from` paths are
   * checked before any session or identity index is changed.
   */
  migrateIdentities(
    migrations: readonly {
      sessionId: SessionId
      incarnation: SessionIncarnation
      from: DocumentIdentity
      to: DocumentIdentity
      title?: string
      transactionId?: string
    }[]
  ): void {
    const ids = new Set(migrations.map((migration) => migration.sessionId))
    const destinationKeys = new Set<string>()

    for (const migration of migrations) {
      const session = this.#sessions.get(migration.sessionId)
      if (!session) throw new Error(`Unknown document session "${migration.sessionId}"`)
      if (session.incarnation !== migration.incarnation) {
        throw new Error(`Document session "${migration.sessionId}" changed during path transaction`)
      }
      if (!sameDocumentIdentity(session.identity, migration.from)) {
        throw new Error(`Document session "${migration.sessionId}" changed during path transaction`)
      }
      const key = indexedIdentityKey(migration.to)
      if (key !== null) {
        if (destinationKeys.has(key)) throw new Error(`Duplicate path transaction destination`)
        destinationKeys.add(key)
        const occupant = this.#identityIndex.get(key)
        if (occupant && !ids.has(occupant)) {
          throw new Error(`Path transaction destination is already open`)
        }
        const reservation = this.#identityReservations.get(key)
        if (
          reservation &&
          (reservation.sessionId !== session.id || reservation.incarnation !== session.incarnation)
        ) {
          throw new Error(`Path transaction destination is reserved`)
        }
      }
    }

    this.batch(() => {
      for (const migration of migrations) {
        const session = this.#sessions.get(migration.sessionId)!
        const identityKey = indexedIdentityKey(session.identity)
        if (identityKey !== null) this.#identityIndex.delete(identityKey)
      }
      for (const migration of migrations) {
        const session = this.#sessions.get(migration.sessionId)!
        const next: DocumentSession = {
          ...session,
          identity: migration.to,
          title: migration.title ?? session.title,
          pathMigration: {
            transactionId: migration.transactionId ?? null,
            phase: 'committed',
            fromPath: migration.from.path,
            toPath: migration.to.path,
            error: null
          },
          updatedAt: this.#now()
        }
        this.#sessions.set(migration.sessionId, next)
        const identityKey = indexedIdentityKey(migration.to)
        if (identityKey !== null) this.#identityIndex.set(identityKey, migration.sessionId)
        this.#changed()
      }
    })
  }

  batch<T>(operation: () => T): T {
    this.#batchDepth += 1
    try {
      return operation()
    } finally {
      this.#batchDepth -= 1
      if (this.#batchDepth === 0 && this.#batchChanged) {
        this.#batchChanged = false
        this.#publish()
      }
    }
  }

  update(id: SessionId, updater: (session: DocumentSession) => DocumentSession): DocumentSession {
    const current = this.#sessions.get(id)
    if (!current) throw new Error(`Unknown document session "${id}"`)
    const candidate = updater(current)
    if (candidate === current) return current
    if (candidate.id !== current.id) throw new Error('A document session id is immutable')
    if (candidate.incarnation !== current.incarnation) {
      throw new Error('A document session incarnation is immutable')
    }
    if (!sameDocumentIdentity(candidate.identity, current.identity)) {
      this.#replaceIdentityIndex(current, candidate.identity)
    }
    const next = { ...candidate, updatedAt: this.#now() }
    this.#sessions.set(id, next)
    this.#changed()
    return next
  }

  #replaceIdentityIndex(current: DocumentSession, nextIdentity: DocumentIdentity): void {
    const nextKey = indexedIdentityKey(nextIdentity)
    if (nextKey !== null) {
      const occupant = this.#identityIndex.get(nextKey)
      if (occupant && occupant !== current.id) {
        throw new Error('A document session for the destination identity is already open')
      }
      const reservation = this.#identityReservations.get(nextKey)
      if (
        reservation &&
        (reservation.sessionId !== current.id || reservation.incarnation !== current.incarnation)
      ) {
        throw new Error('The destination identity is reserved by another document session')
      }
    }
    const currentKey = indexedIdentityKey(current.identity)
    if (currentKey !== null) this.#identityIndex.delete(currentKey)
    if (nextKey !== null) this.#identityIndex.set(nextKey, current.id)
  }

  #changed(): void {
    if (this.#batchDepth > 0) {
      this.#batchChanged = true
      return
    }
    this.#publish()
  }

  #publish(): void {
    this.#version += 1
    this.#snapshot = {
      version: this.#version,
      activeSessionId: this.#activeSessionId,
      sessions: [...this.#sessions.values()]
    }
    for (const listener of this.#listeners) listener()
  }
}
