import {
  classifyExternalState,
  toExternalConflict,
  type ExternalConflict,
  type ExternalConflictDecision,
  type ExternalDocument
} from './externalConflict'
import { classifySaveFailure, type ClassifiedSaveFailure } from './saveErrors'
import {
  DocumentSessionStore,
  type OpenDocumentSessionInput,
  type SessionIdentityReservation
} from './store'
import {
  sameDocumentIdentity,
  type DocumentIdentity,
  type DocumentSession,
  type FileFingerprint,
  type SessionId,
  type SessionIncarnation,
  type SessionSaveState
} from './types'

export interface PersistenceWriteOptions {
  /**
   * Adapter must reject the write if the on-disk content no longer matches this
   * fingerprint. `null` means the destination is expected not to exist.
   */
  expectedBase: FileFingerprint | null
  force: boolean
  signal?: AbortSignal
}

export type PersistenceWriteResult =
  | { status: 'written'; fingerprint: FileFingerprint }
  | { status: 'external-conflict'; external: ExternalDocument | null }

export interface SessionPersistence {
  inspect(identity: DocumentIdentity, signal?: AbortSignal): Promise<ExternalDocument | null>
  write(
    identity: DocumentIdentity,
    xml: string,
    options: PersistenceWriteOptions
  ): Promise<PersistenceWriteResult>
  writeAs?(
    source: DocumentIdentity,
    destinationPath: string,
    xml: string,
    options: Omit<PersistenceWriteOptions, 'force'>
  ): Promise<
    | { status: 'written'; identity: DocumentIdentity; fingerprint: FileFingerprint }
    | { status: 'external-conflict'; external: ExternalDocument | null }
  >
}

export interface SessionLockLease {
  release(): void | Promise<void>
  renew?(): void | Promise<void>
}

export type SessionLockResult =
  | { acquired: true; lease: SessionLockLease }
  | { acquired: false; holderId?: string; expiresAt?: number }

export interface SessionCoordination {
  acquire(identity: DocumentIdentity): Promise<SessionLockResult>
  publishDocumentChange?(change: {
    identity: DocumentIdentity
    kind: 'saved' | 'moved' | 'deleted'
    fingerprint?: FileFingerprint
    previousPath?: string
  }): void
}

export type SaveConflictResolver = (
  conflict: ExternalConflict,
  session: DocumentSession
) => Promise<ExternalConflictDecision>

export type PrepareExternalResult =
  { readonly status: 'completed'; readonly xml: string } | { readonly status: 'cancelled' }

export type PrepareExternal = (
  external: ExternalDocument,
  context: {
    session: DocumentSession
    conflict: ExternalConflict
    signal?: AbortSignal
  }
) => Promise<PrepareExternalResult>

export interface DocumentSessionControllerOptions {
  store?: DocumentSessionStore
  persistence: SessionPersistence
  coordination?: SessionCoordination
  isWorkspaceCurrent?: (identity: DocumentIdentity) => boolean
  decideConflict?: SaveConflictResolver
  prepareExternal?: PrepareExternal
  now?: () => number
  createRequestId?: () => string
  onConfirmedSave?: (
    session: DocumentSession,
    result: Extract<SessionSaveOutcome, { status: 'success' | 'saved-as' }>
  ) => void | Promise<void>
  onExplicitDiscard?: (session: DocumentSession, reason: 'reload-external') => void | Promise<void>
  /** Persists the reviewed dirty XML after a transformed external reload. */
  onPreparedExternal?: (
    session: DocumentSession,
    external: ExternalDocument
  ) => void | Promise<void>
  /** Post-save cleanup (for example draft deletion) must not falsify write success. */
  onPostSaveError?: (error: unknown) => void
}

export interface SaveSessionOptions {
  /**
   * A caller-captured XML snapshot. Supplying it is the safest integration seam
   * for bpmn-js's async saveXML() result.
   */
  xml?: string
  /** Reject a caller snapshot captured from an older store revision. */
  expectedRevision?: number
  /**
   * Exact conflict shown to the user before `conflictDecision` was chosen.
   * Destructive decisions are rejected if the target identity/fingerprint no
   * longer matches this observation.
   */
  reviewedConflict?: ExternalConflict
  conflictDecision?: ExternalConflictDecision
  signal?: AbortSignal
}

export type SessionSaveOutcome =
  | {
      status: 'success'
      ok: true
      sessionId: SessionId
      fingerprint: FileFingerprint
      savedRevision: number
      remainingDirty: boolean
    }
  | {
      status: 'saved-as'
      ok: true
      sessionId: SessionId
      identity: DocumentIdentity
      fingerprint: FileFingerprint
      savedRevision: number
      remainingDirty: boolean
    }
  | { status: 'clean'; ok: true; sessionId: SessionId }
  | {
      status: 'reloaded'
      ok: true
      sessionId: SessionId
      external: ExternalDocument
    }
  | {
      status: 'external-conflict'
      ok: false
      sessionId: SessionId
      conflict: ExternalConflict
      comparisonRequested: boolean
      decisionStale: boolean
    }
  | { status: 'busy'; ok: false; sessionId: SessionId }
  | { status: 'stale-capture'; ok: false; sessionId: SessionId }
  | { status: 'locked'; ok: false; sessionId: SessionId; holderId?: string; expiresAt?: number }
  | { status: 'stale-workspace'; ok: false; sessionId: SessionId }
  | { status: 'cancelled'; ok: false; sessionId: SessionId }
  | { status: 'missing-session'; ok: false; sessionId: SessionId }
  | {
      status: 'permission-loss'
      ok: false
      sessionId: SessionId
      failure: ClassifiedSaveFailure
    }
  | {
      status: 'storage-failure'
      ok: false
      sessionId: SessionId
      failure: ClassifiedSaveFailure
    }

function defaultRequestId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID()
  return `save-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function idleAfter(outcome: SessionSaveOutcome): SessionSaveState {
  return {
    phase: 'idle',
    requestId: null,
    startedRevision: null,
    startedAt: null,
    lastOutcome: outcome.status
  }
}

function titleFromPath(path: string, fallback: string): string {
  const name = path.split('/').pop()
  return name || fallback
}

function conflictFromAtomicWrite(
  identity: DocumentIdentity,
  base: FileFingerprint | null,
  xml: string,
  external: ExternalDocument | null
): ExternalConflict {
  return {
    identity,
    reason: external ? (base ? 'modified' : 'untracked-existing') : 'deleted',
    base,
    localXml: xml,
    external
  }
}

function sameExternalObservation(
  left: ExternalDocument | null,
  right: ExternalDocument | null
): boolean {
  if (left === null || right === null) return left === right
  return (
    sameDocumentIdentity(left.identity, right.identity) &&
    left.fingerprint.hash.trim().toLowerCase() === right.fingerprint.hash.trim().toLowerCase() &&
    left.fingerprint.size === right.fingerprint.size &&
    left.fingerprint.modifiedAt === right.fingerprint.modifiedAt
  )
}

/**
 * Owns save lifecycle and guarantees that a successful write only acknowledges
 * the exact XML snapshot that was written. Edits made while I/O is in flight
 * remain dirty instead of being cleared by the older save completion.
 */
export class DocumentSessionController {
  readonly store: DocumentSessionStore
  readonly #persistence: SessionPersistence
  readonly #coordination?: SessionCoordination
  readonly #isWorkspaceCurrent: (identity: DocumentIdentity) => boolean
  readonly #decideConflict?: SaveConflictResolver
  readonly #prepareExternal?: PrepareExternal
  readonly #now: () => number
  readonly #createRequestId: () => string
  readonly #onConfirmedSave?: DocumentSessionControllerOptions['onConfirmedSave']
  readonly #onExplicitDiscard?: DocumentSessionControllerOptions['onExplicitDiscard']
  readonly #onPreparedExternal?: DocumentSessionControllerOptions['onPreparedExternal']
  readonly #onPostSaveError: (error: unknown) => void
  readonly #inflight = new Map<SessionId, Promise<SessionSaveOutcome>>()

  constructor(options: DocumentSessionControllerOptions) {
    this.store = options.store ?? new DocumentSessionStore({ now: options.now })
    this.#persistence = options.persistence
    this.#coordination = options.coordination
    this.#isWorkspaceCurrent = options.isWorkspaceCurrent ?? (() => true)
    this.#decideConflict = options.decideConflict
    this.#prepareExternal = options.prepareExternal
    this.#now = options.now ?? Date.now
    this.#createRequestId = options.createRequestId ?? defaultRequestId
    this.#onConfirmedSave = options.onConfirmedSave
    this.#onExplicitDiscard = options.onExplicitDiscard
    this.#onPreparedExternal = options.onPreparedExternal
    this.#onPostSaveError = options.onPostSaveError ?? (() => undefined)
  }

  open(input: OpenDocumentSessionInput): DocumentSession {
    return this.store.open(input)
  }

  setActive(id: SessionId | null): void {
    this.store.setActive(id)
  }

  updateXml(id: SessionId, xml: string): DocumentSession {
    return this.store.updateXml(id, xml)
  }

  saveActive(options: SaveSessionOptions = {}): Promise<SessionSaveOutcome> {
    const active = this.store.getActive()
    return active
      ? this.save(active.id, options)
      : Promise.resolve({ status: 'missing-session', ok: false, sessionId: '' })
  }

  save(id: SessionId, options: SaveSessionOptions = {}): Promise<SessionSaveOutcome> {
    if (this.#inflight.has(id)) {
      return Promise.resolve({ status: 'busy', ok: false, sessionId: id })
    }
    const operation = this.#save(id, options).finally(() => {
      if (this.#inflight.get(id) === operation) this.#inflight.delete(id)
    })
    this.#inflight.set(id, operation)
    return operation
  }

  async #save(id: SessionId, options: SaveSessionOptions): Promise<SessionSaveOutcome> {
    let session = this.store.get(id)
    if (!session) return { status: 'missing-session', ok: false, sessionId: id }
    const incarnation = session.incarnation
    if (
      session.pathMigration.phase === 'applying' ||
      session.pathMigration.phase === 'rolling-back'
    ) {
      return { status: 'busy', ok: false, sessionId: id }
    }
    if (options.signal?.aborted) {
      return { status: 'cancelled', ok: false, sessionId: id }
    }
    if (options.expectedRevision !== undefined && options.expectedRevision !== session.revision) {
      return { status: 'stale-capture', ok: false, sessionId: id }
    }
    if (!this.#isWorkspaceCurrent(session.identity)) {
      return this.#finish(id, incarnation, {
        status: 'stale-workspace',
        ok: false,
        sessionId: id
      })
    }

    const requestId = this.#createRequestId()
    const startedAt = this.#now()
    const initialRevision = session.revision
    this.#setPhase(id, incarnation, 'capturing', requestId, initialRevision, startedAt)

    let xml: string
    try {
      if (options.xml !== undefined) {
        session = this.store.updateXml(id, options.xml)
        xml = options.xml
      } else if (session.readXml) {
        const revisionBeforeRead = session.revision
        const serialized = await session.readXml()
        const guard = this.#postAwaitGuard(id, incarnation, session.identity, options.signal)
        if (guard) return this.#finish(id, incarnation, guard)
        const afterRead = this.#sessionForOperation(id, incarnation)!
        if (afterRead.revision === revisionBeforeRead) {
          session = this.store.updateXml(id, serialized)
          xml = serialized
        } else {
          // An edit notification won the race with serialization. Never replace
          // that newer tracked revision with a possibly older async result.
          session = afterRead
          xml = afterRead.currentXml
        }
      } else {
        xml = session.currentXml
      }
    } catch (error) {
      const guard = this.#postAwaitGuard(id, incarnation, session.identity, options.signal)
      return guard
        ? this.#finish(id, incarnation, guard)
        : this.#finishFailure(id, incarnation, error)
    }

    const savedRevision = session.revision
    if (!session.dirty && xml === session.lastSavedXml) {
      return this.#finish(id, incarnation, { status: 'clean', ok: true, sessionId: id })
    }
    if (!this.#isWorkspaceCurrent(session.identity)) {
      return this.#finish(id, incarnation, {
        status: 'stale-workspace',
        ok: false,
        sessionId: id
      })
    }

    this.#setPhase(id, incarnation, 'checking-external', requestId, savedRevision, startedAt)
    let inspected: ExternalDocument | null
    try {
      inspected = await this.#persistence.inspect(session.identity, options.signal)
      const guard = this.#postAwaitGuard(id, incarnation, session.identity, options.signal)
      if (guard) return this.#finish(id, incarnation, guard)
    } catch (error) {
      const guard = this.#postAwaitGuard(id, incarnation, session.identity, options.signal)
      return guard
        ? this.#finish(id, incarnation, guard)
        : this.#finishFailure(id, incarnation, error)
    }

    const externalState = classifyExternalState(session.base, inspected)
    let decision = options.conflictDecision
    let conflict: ExternalConflict | null = null
    let decisionBoundToConflict = false
    if (
      options.reviewedConflict &&
      (decision?.kind === 'overwrite' || decision?.kind === 'reload-external')
    ) {
      const reviewed = options.reviewedConflict
      if (
        reviewed.localXml !== xml ||
        reviewed.identity.workspace.id !== session.identity.workspace.id ||
        reviewed.identity.workspace.generation !== session.identity.workspace.generation ||
        reviewed.identity.workspace.mode !== session.identity.workspace.mode
      ) {
        return this.#finish(id, incarnation, {
          status: 'external-conflict',
          ok: false,
          sessionId: id,
          conflict: reviewed,
          comparisonRequested: false,
          decisionStale: true
        })
      }
      let observed = inspected
      if (!sameDocumentIdentity(reviewed.identity, session.identity)) {
        try {
          observed = await this.#persistence.inspect(reviewed.identity, options.signal)
          const guard = this.#postAwaitGuard(id, incarnation, session.identity, options.signal)
          if (guard) return this.#finish(id, incarnation, guard)
          if (!this.#isWorkspaceCurrent(reviewed.identity)) {
            return this.#finish(id, incarnation, {
              status: 'stale-workspace',
              ok: false,
              sessionId: id
            })
          }
        } catch (error) {
          const guard = this.#postAwaitGuard(id, incarnation, session.identity, options.signal)
          return guard
            ? this.#finish(id, incarnation, guard)
            : this.#finishFailure(id, incarnation, error)
        }
      }
      if (!sameExternalObservation(observed, reviewed.external)) {
        return this.#finish(id, incarnation, {
          status: 'external-conflict',
          ok: false,
          sessionId: id,
          conflict: conflictFromAtomicWrite(reviewed.identity, reviewed.base, xml, observed),
          comparisonRequested: false,
          decisionStale: true
        })
      }
      conflict = { ...reviewed, localXml: xml, external: observed }
      decisionBoundToConflict = true
    } else if (
      externalState.kind === 'modified' ||
      externalState.kind === 'deleted' ||
      externalState.kind === 'untracked-existing'
    ) {
      conflict = toExternalConflict(session.identity, session.base, xml, externalState)
    }
    if (conflict) {
      if (!decision && this.#decideConflict) {
        this.#setPhase(
          id,
          incarnation,
          'awaiting-conflict-decision',
          requestId,
          savedRevision,
          startedAt
        )
        try {
          decision = await this.#decideConflict(conflict, session)
          const guard = this.#postAwaitGuard(id, incarnation, session.identity, options.signal)
          if (guard) return this.#finish(id, incarnation, guard)
          decisionBoundToConflict = true
        } catch (error) {
          const guard = this.#postAwaitGuard(id, incarnation, session.identity, options.signal)
          return guard
            ? this.#finish(id, incarnation, guard)
            : this.#finishFailure(id, incarnation, error)
        }
      }
      if (!decision || decision.kind === 'compare') {
        return this.#finish(id, incarnation, {
          status: 'external-conflict',
          ok: false,
          sessionId: id,
          conflict,
          comparisonRequested: decision?.kind === 'compare',
          decisionStale: false
        })
      }
      if (decision.kind === 'cancel') {
        return this.#finish(id, incarnation, {
          status: 'cancelled',
          ok: false,
          sessionId: id
        })
      }
      if (
        (decision.kind === 'overwrite' || decision.kind === 'reload-external') &&
        !decisionBoundToConflict
      ) {
        return this.#finish(id, incarnation, {
          status: 'external-conflict',
          ok: false,
          sessionId: id,
          conflict,
          comparisonRequested: false,
          decisionStale: true
        })
      }
      if (decision.kind === 'reload-external') {
        let rechecked: ExternalDocument | null
        try {
          rechecked = await this.#persistence.inspect(conflict.identity, options.signal)
          const guard = this.#postAwaitGuard(id, incarnation, session.identity, options.signal)
          if (guard) return this.#finish(id, incarnation, guard)
        } catch (error) {
          const guard = this.#postAwaitGuard(id, incarnation, session.identity, options.signal)
          return guard
            ? this.#finish(id, incarnation, guard)
            : this.#finishFailure(id, incarnation, error)
        }
        if (!sameExternalObservation(rechecked, conflict.external)) {
          return this.#finish(id, incarnation, {
            status: 'external-conflict',
            ok: false,
            sessionId: id,
            conflict: conflictFromAtomicWrite(conflict.identity, conflict.base, xml, rechecked),
            comparisonRequested: false,
            decisionStale: true
          })
        }
        if (!rechecked) {
          return this.#finish(id, incarnation, {
            status: 'external-conflict',
            ok: false,
            sessionId: id,
            conflict,
            comparisonRequested: false,
            decisionStale: false
          })
        }
        conflict = { ...conflict, external: rechecked }
        const current = this.#sessionForOperation(id, incarnation)
        if (!current || current.revision !== savedRevision) {
          return this.#finish(id, incarnation, {
            status: 'external-conflict',
            ok: false,
            sessionId: id,
            conflict,
            comparisonRequested: false,
            decisionStale: true
          })
        }
        let reviewedXml = rechecked.xml
        if (this.#prepareExternal) {
          let prepared: PrepareExternalResult
          try {
            prepared = await this.#prepareExternal(rechecked, {
              session: current,
              conflict,
              signal: options.signal
            })
          } catch (error) {
            const guard = this.#postAwaitGuard(id, incarnation, session.identity, options.signal)
            return guard
              ? this.#finish(id, incarnation, guard)
              : this.#finishFailure(id, incarnation, error)
          }
          const guard = this.#postAwaitGuard(id, incarnation, session.identity, options.signal)
          if (guard) return this.#finish(id, incarnation, guard)
          const afterPreparation = this.#sessionForOperation(id, incarnation)
          if (!afterPreparation || afterPreparation.revision !== savedRevision) {
            return this.#finish(id, incarnation, {
              status: 'stale-capture',
              ok: false,
              sessionId: id
            })
          }
          if (prepared.status === 'cancelled') {
            return this.#finish(id, incarnation, {
              status: 'cancelled',
              ok: false,
              sessionId: id
            })
          }
          reviewedXml = prepared.xml
          let afterReview: ExternalDocument | null
          try {
            afterReview = await this.#persistence.inspect(conflict.identity, options.signal)
          } catch (error) {
            const afterReviewGuard = this.#postAwaitGuard(
              id,
              incarnation,
              session.identity,
              options.signal
            )
            return afterReviewGuard
              ? this.#finish(id, incarnation, afterReviewGuard)
              : this.#finishFailure(id, incarnation, error)
          }
          const afterReviewGuard = this.#postAwaitGuard(
            id,
            incarnation,
            session.identity,
            options.signal
          )
          if (afterReviewGuard) {
            return this.#finish(id, incarnation, afterReviewGuard)
          }
          const afterReviewSession = this.#sessionForOperation(id, incarnation)
          if (!afterReviewSession || afterReviewSession.revision !== savedRevision) {
            return this.#finish(id, incarnation, {
              status: 'stale-capture',
              ok: false,
              sessionId: id
            })
          }
          if (!sameExternalObservation(afterReview, rechecked)) {
            return this.#finish(id, incarnation, {
              status: 'external-conflict',
              ok: false,
              sessionId: id,
              conflict: conflictFromAtomicWrite(conflict.identity, conflict.base, xml, afterReview),
              comparisonRequested: false,
              decisionStale: true
            })
          }
        }
        const transformed = reviewedXml !== rechecked.xml
        const reloaded = this.store.replaceWithExternal(id, {
          xml: rechecked.xml,
          reviewedXml,
          fingerprint: rechecked.fingerprint,
          identity: conflict.identity,
          title: titleFromPath(conflict.identity.path ?? '', session.title)
        })
        try {
          if (transformed) {
            await this.#onPreparedExternal?.(reloaded, rechecked)
          } else {
            await this.#onExplicitDiscard?.(reloaded, 'reload-external')
          }
        } catch (error) {
          this.#onPostSaveError(error)
        }
        const callbackGuard = this.#postAwaitGuard(
          id,
          incarnation,
          reloaded.identity,
          options.signal
        )
        if (callbackGuard) return this.#finish(id, incarnation, callbackGuard)
        return this.#finish(id, incarnation, {
          status: 'reloaded',
          ok: true,
          sessionId: id,
          external: rechecked
        })
      }
    }

    const beforeWrite = this.#postAwaitGuard(id, incarnation, session.identity, options.signal)
    if (beforeWrite) return this.#finish(id, incarnation, beforeWrite)
    const lockIdentity: DocumentIdentity =
      decision?.kind === 'save-as'
        ? { workspace: session.identity.workspace, path: decision.path }
        : decision?.kind === 'overwrite' && conflict
          ? conflict.identity
          : session.identity
    const identityChanged = !sameDocumentIdentity(lockIdentity, session.identity)
    let reservation: SessionIdentityReservation | undefined
    if (identityChanged) {
      const reserved = this.store.reserveIdentity(id, incarnation, lockIdentity)
      if (!reserved.acquired) {
        return this.#finish(id, incarnation, {
          status: 'locked',
          ok: false,
          sessionId: id,
          holderId: reserved.holderId
        })
      }
      reservation = reserved.reservation
    }

    let lease: SessionLockLease | undefined
    try {
      if (this.#coordination && lockIdentity.path !== null) {
        this.#setPhase(id, incarnation, 'acquiring-lock', requestId, savedRevision, startedAt)
        const lock = await this.#coordination.acquire(lockIdentity)
        if (lock.acquired) lease = lock.lease
        const guard = this.#postAwaitGuard(id, incarnation, session.identity, options.signal)
        if (guard) return this.#finish(id, incarnation, guard)
        if (reservation && !this.store.isIdentityReservationCurrent(reservation)) {
          return this.#finish(id, incarnation, {
            status: 'stale-capture',
            ok: false,
            sessionId: id
          })
        }
        if (!lock.acquired) {
          return this.#finish(id, incarnation, {
            status: 'locked',
            ok: false,
            sessionId: id,
            holderId: lock.holderId,
            expiresAt: lock.expiresAt
          })
        }
      }

      const ready = this.#postAwaitGuard(id, incarnation, session.identity, options.signal)
      if (ready) return this.#finish(id, incarnation, ready)
      if (reservation && !this.store.isIdentityReservationCurrent(reservation)) {
        return this.#finish(id, incarnation, {
          status: 'stale-capture',
          ok: false,
          sessionId: id
        })
      }
      this.#setPhase(id, incarnation, 'writing', requestId, savedRevision, startedAt)

      if (decision?.kind === 'save-as') {
        if (!this.#persistence.writeAs) {
          return this.#finishFailure(
            id,
            incarnation,
            new DOMException('Save as is unsupported', 'InvalidStateError')
          )
        }
        const writeAs = await this.#persistence.writeAs(session.identity, decision.path, xml, {
          expectedBase: null,
          signal: options.signal
        })
        const guard = this.#postAwaitGuard(id, incarnation, session.identity, options.signal)
        if (guard) return this.#finish(id, incarnation, guard)
        if (reservation && !this.store.isIdentityReservationCurrent(reservation)) {
          return this.#finish(id, incarnation, {
            status: 'stale-capture',
            ok: false,
            sessionId: id
          })
        }
        if (writeAs.status === 'external-conflict') {
          const destination: DocumentIdentity = writeAs.external?.identity ?? {
            workspace: session.identity.workspace,
            path: decision.path
          }
          return this.#finish(id, incarnation, {
            status: 'external-conflict',
            ok: false,
            sessionId: id,
            conflict: conflictFromAtomicWrite(destination, null, xml, writeAs.external),
            comparisonRequested: false,
            decisionStale: true
          })
        }
        if (!sameDocumentIdentity(writeAs.identity, lockIdentity)) {
          return this.#finishFailure(
            id,
            incarnation,
            new DOMException(
              'Save-As adapter returned an identity different from the reserved destination',
              'InvalidStateError'
            )
          )
        }
        const saved = this.store.markSaved(id, {
          xml,
          savedRevision,
          identity: writeAs.identity,
          title: titleFromPath(writeAs.identity.path ?? '', session.title),
          fingerprint: writeAs.fingerprint
        })
        const outcome: Extract<SessionSaveOutcome, { status: 'saved-as' }> = {
          status: 'saved-as',
          ok: true,
          sessionId: id,
          identity: writeAs.identity,
          fingerprint: writeAs.fingerprint,
          savedRevision,
          remainingDirty: saved.dirty
        }
        this.#coordination?.publishDocumentChange?.({
          identity: writeAs.identity,
          kind: 'saved',
          fingerprint: writeAs.fingerprint
        })
        await this.#notifyConfirmedSave(saved, outcome)
        const notifiedGuard = this.#postAwaitGuard(id, incarnation, saved.identity, options.signal)
        return this.#finish(id, incarnation, notifiedGuard ?? outcome)
      }

      const expectedBase =
        decision?.kind === 'overwrite'
          ? (conflict?.external?.fingerprint ?? null)
          : externalState.kind === 'unchanged'
            ? externalState.current.fingerprint
            : session.base
      const write = await this.#persistence.write(lockIdentity, xml, {
        expectedBase,
        force: decision?.kind === 'overwrite',
        signal: options.signal
      })
      const guard = this.#postAwaitGuard(id, incarnation, session.identity, options.signal)
      if (guard) return this.#finish(id, incarnation, guard)
      if (reservation && !this.store.isIdentityReservationCurrent(reservation)) {
        return this.#finish(id, incarnation, {
          status: 'stale-capture',
          ok: false,
          sessionId: id
        })
      }
      if (write.status === 'external-conflict') {
        return this.#finish(id, incarnation, {
          status: 'external-conflict',
          ok: false,
          sessionId: id,
          conflict: conflictFromAtomicWrite(
            lockIdentity,
            conflict?.base ?? session.base,
            xml,
            write.external
          ),
          comparisonRequested: false,
          decisionStale: true
        })
      }

      const saved = this.store.markSaved(id, {
        xml,
        savedRevision,
        fingerprint: write.fingerprint,
        identity: identityChanged ? lockIdentity : undefined,
        title: identityChanged ? titleFromPath(lockIdentity.path ?? '', session.title) : undefined
      })
      const outcome: Extract<SessionSaveOutcome, { status: 'success' | 'saved-as' }> =
        identityChanged
          ? {
              status: 'saved-as',
              ok: true,
              sessionId: id,
              identity: lockIdentity,
              fingerprint: write.fingerprint,
              savedRevision,
              remainingDirty: saved.dirty
            }
          : {
              status: 'success',
              ok: true,
              sessionId: id,
              fingerprint: write.fingerprint,
              savedRevision,
              remainingDirty: saved.dirty
            }
      this.#coordination?.publishDocumentChange?.({
        identity: lockIdentity,
        kind: 'saved',
        fingerprint: write.fingerprint
      })
      await this.#notifyConfirmedSave(saved, outcome)
      const notifiedGuard = this.#postAwaitGuard(id, incarnation, saved.identity, options.signal)
      return this.#finish(id, incarnation, notifiedGuard ?? outcome)
    } catch (error) {
      const guard = this.#postAwaitGuard(id, incarnation, session.identity, options.signal)
      return guard
        ? this.#finish(id, incarnation, guard)
        : this.#finishFailure(id, incarnation, error)
    } finally {
      try {
        await lease?.release()
      } catch (error) {
        this.#onPostSaveError(error)
      }
      if (reservation) this.store.releaseIdentityReservation(reservation)
    }
  }

  #setPhase(
    id: SessionId,
    incarnation: SessionIncarnation,
    phase: SessionSaveState['phase'],
    requestId: string,
    startedRevision: number,
    startedAt: number
  ): void {
    if (!this.#sessionForOperation(id, incarnation)) return
    this.store.setSaveState(id, {
      phase,
      requestId,
      startedRevision,
      startedAt,
      lastOutcome: null
    })
  }

  #finish(
    id: SessionId,
    incarnation: SessionIncarnation,
    outcome: SessionSaveOutcome
  ): SessionSaveOutcome {
    if (this.#sessionForOperation(id, incarnation)) {
      this.store.setSaveState(id, idleAfter(outcome))
    }
    return outcome
  }

  #finishFailure(
    id: SessionId,
    incarnation: SessionIncarnation,
    error: unknown
  ): SessionSaveOutcome {
    const failure = classifySaveFailure(error)
    if (failure.code === 'aborted') {
      return this.#finish(id, incarnation, {
        status: 'cancelled',
        ok: false,
        sessionId: id
      })
    }
    if (failure.code === 'stale-workspace') {
      return this.#finish(id, incarnation, {
        status: 'stale-workspace',
        ok: false,
        sessionId: id
      })
    }
    const status = failure.code === 'permission-denied' ? 'permission-loss' : 'storage-failure'
    return this.#finish(id, incarnation, { status, ok: false, sessionId: id, failure })
  }

  #sessionForOperation(
    id: SessionId,
    incarnation: SessionIncarnation
  ): DocumentSession | undefined {
    const session = this.store.get(id)
    return session?.incarnation === incarnation ? session : undefined
  }

  #postAwaitGuard(
    id: SessionId,
    incarnation: SessionIncarnation,
    expectedIdentity: DocumentIdentity,
    signal?: AbortSignal
  ): Extract<
    SessionSaveOutcome,
    { status: 'cancelled' | 'stale-capture' | 'stale-workspace' }
  > | null {
    if (signal?.aborted) {
      return { status: 'cancelled', ok: false, sessionId: id }
    }
    const session = this.#sessionForOperation(id, incarnation)
    if (!session) {
      return { status: 'stale-capture', ok: false, sessionId: id }
    }
    if (
      !sameDocumentIdentity(session.identity, expectedIdentity) ||
      !this.#isWorkspaceCurrent(expectedIdentity)
    ) {
      return { status: 'stale-workspace', ok: false, sessionId: id }
    }
    return null
  }

  async #notifyConfirmedSave(
    session: DocumentSession,
    outcome: Extract<SessionSaveOutcome, { status: 'success' | 'saved-as' }>
  ): Promise<void> {
    try {
      await this.#onConfirmedSave?.(session, outcome)
    } catch (error) {
      this.#onPostSaveError(error)
    }
  }
}
