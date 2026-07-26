import {
  classifyExternalState,
  toExternalConflict,
  type ExternalConflict,
  type ExternalConflictDecision,
  type ExternalDocument
} from './externalConflict'
import { classifySaveFailure, type ClassifiedSaveFailure } from './saveErrors'
import { DocumentSessionStore, type OpenDocumentSessionInput } from './store'
import {
  sameDocumentIdentity,
  type DocumentIdentity,
  type DocumentSession,
  type FileFingerprint,
  type SessionId,
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

export interface DocumentSessionControllerOptions {
  store?: DocumentSessionStore
  persistence: SessionPersistence
  coordination?: SessionCoordination
  isWorkspaceCurrent?: (identity: DocumentIdentity) => boolean
  decideConflict?: SaveConflictResolver
  now?: () => number
  createRequestId?: () => string
  onConfirmedSave?: (
    session: DocumentSession,
    result: Extract<SessionSaveOutcome, { status: 'success' | 'saved-as' }>
  ) => void | Promise<void>
  onExplicitDiscard?: (sessionId: SessionId, reason: 'reload-external') => void | Promise<void>
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
  readonly #now: () => number
  readonly #createRequestId: () => string
  readonly #onConfirmedSave?: DocumentSessionControllerOptions['onConfirmedSave']
  readonly #onExplicitDiscard?: DocumentSessionControllerOptions['onExplicitDiscard']
  readonly #onPostSaveError: (error: unknown) => void
  readonly #inflight = new Map<SessionId, Promise<SessionSaveOutcome>>()

  constructor(options: DocumentSessionControllerOptions) {
    this.store = options.store ?? new DocumentSessionStore({ now: options.now })
    this.#persistence = options.persistence
    this.#coordination = options.coordination
    this.#isWorkspaceCurrent = options.isWorkspaceCurrent ?? (() => true)
    this.#decideConflict = options.decideConflict
    this.#now = options.now ?? Date.now
    this.#createRequestId = options.createRequestId ?? defaultRequestId
    this.#onConfirmedSave = options.onConfirmedSave
    this.#onExplicitDiscard = options.onExplicitDiscard
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
      return this.#finish(id, { status: 'stale-workspace', ok: false, sessionId: id })
    }

    const requestId = this.#createRequestId()
    const startedAt = this.#now()
    const initialRevision = session.revision
    this.#setPhase(id, 'capturing', requestId, initialRevision, startedAt)

    let xml: string
    try {
      if (options.xml !== undefined) {
        session = this.store.updateXml(id, options.xml)
        xml = options.xml
      } else if (session.readXml) {
        const revisionBeforeRead = session.revision
        const serialized = await session.readXml()
        const afterRead = this.store.get(id)
        if (!afterRead) return { status: 'missing-session', ok: false, sessionId: id }
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
      return this.#finishFailure(id, error)
    }

    const savedRevision = session.revision
    if (!session.dirty && xml === session.lastSavedXml) {
      return this.#finish(id, { status: 'clean', ok: true, sessionId: id })
    }
    if (!this.#isWorkspaceCurrent(session.identity)) {
      return this.#finish(id, { status: 'stale-workspace', ok: false, sessionId: id })
    }

    this.#setPhase(id, 'checking-external', requestId, savedRevision, startedAt)
    let inspected: ExternalDocument | null
    try {
      inspected = await this.#persistence.inspect(session.identity, options.signal)
    } catch (error) {
      return this.#finishFailure(id, error)
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
        reviewed.identity.workspace.generation !== session.identity.workspace.generation
      ) {
        return this.#finish(id, {
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
        } catch (error) {
          return this.#finishFailure(id, error)
        }
      }
      if (!sameExternalObservation(observed, reviewed.external)) {
        return this.#finish(id, {
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
        this.#setPhase(id, 'awaiting-conflict-decision', requestId, savedRevision, startedAt)
        try {
          decision = await this.#decideConflict(conflict, session)
          decisionBoundToConflict = true
        } catch (error) {
          return this.#finishFailure(id, error)
        }
      }
      if (!decision || decision.kind === 'compare') {
        return this.#finish(id, {
          status: 'external-conflict',
          ok: false,
          sessionId: id,
          conflict,
          comparisonRequested: decision?.kind === 'compare',
          decisionStale: false
        })
      }
      if (decision.kind === 'cancel') {
        return this.#finish(id, { status: 'cancelled', ok: false, sessionId: id })
      }
      if (
        (decision.kind === 'overwrite' || decision.kind === 'reload-external') &&
        !decisionBoundToConflict
      ) {
        return this.#finish(id, {
          status: 'external-conflict',
          ok: false,
          sessionId: id,
          conflict,
          comparisonRequested: false,
          decisionStale: true
        })
      }
      if (decision.kind === 'reload-external') {
        if (!conflict.external) {
          return this.#finish(id, {
            status: 'external-conflict',
            ok: false,
            sessionId: id,
            conflict,
            comparisonRequested: false,
            decisionStale: false
          })
        }
        const current = this.store.get(id)
        if (!current || current.revision !== savedRevision) {
          return this.#finish(id, {
            status: 'external-conflict',
            ok: false,
            sessionId: id,
            conflict,
            comparisonRequested: false,
            decisionStale: true
          })
        }
        this.store.replaceWithExternal(id, {
          xml: conflict.external.xml,
          fingerprint: conflict.external.fingerprint,
          identity: conflict.identity,
          title: titleFromPath(conflict.identity.path ?? '', session.title)
        })
        try {
          await this.#onExplicitDiscard?.(id, 'reload-external')
        } catch (error) {
          this.#onPostSaveError(error)
        }
        return this.#finish(id, {
          status: 'reloaded',
          ok: true,
          sessionId: id,
          external: conflict.external
        })
      }
    }

    if (!this.#isWorkspaceCurrent(session.identity)) {
      return this.#finish(id, { status: 'stale-workspace', ok: false, sessionId: id })
    }
    if (options.signal?.aborted) {
      return this.#finish(id, { status: 'cancelled', ok: false, sessionId: id })
    }

    let lease: SessionLockLease | undefined
    const lockIdentity: DocumentIdentity =
      decision?.kind === 'save-as'
        ? { workspace: session.identity.workspace, path: decision.path }
        : decision?.kind === 'overwrite' && conflict
          ? conflict.identity
          : session.identity
    if (this.#coordination && lockIdentity.path !== null) {
      this.#setPhase(id, 'acquiring-lock', requestId, savedRevision, startedAt)
      try {
        const lock = await this.#coordination.acquire(lockIdentity)
        if (!lock.acquired) {
          return this.#finish(id, {
            status: 'locked',
            ok: false,
            sessionId: id,
            holderId: lock.holderId,
            expiresAt: lock.expiresAt
          })
        }
        lease = lock.lease
      } catch (error) {
        return this.#finishFailure(id, error)
      }
    }

    try {
      if (options.signal?.aborted) {
        return this.#finish(id, { status: 'cancelled', ok: false, sessionId: id })
      }
      if (!this.#isWorkspaceCurrent(session.identity)) {
        return this.#finish(id, { status: 'stale-workspace', ok: false, sessionId: id })
      }
      this.#setPhase(id, 'writing', requestId, savedRevision, startedAt)

      if (decision?.kind === 'save-as') {
        if (!this.#persistence.writeAs) {
          return this.#finishFailure(
            id,
            new DOMException('Save as is unsupported', 'InvalidStateError')
          )
        }
        const writeAs = await this.#persistence.writeAs(session.identity, decision.path, xml, {
          expectedBase: null,
          signal: options.signal
        })
        if (writeAs.status === 'external-conflict') {
          const destination: DocumentIdentity = writeAs.external?.identity ?? {
            workspace: session.identity.workspace,
            path: decision.path
          }
          return this.#finish(id, {
            status: 'external-conflict',
            ok: false,
            sessionId: id,
            conflict: conflictFromAtomicWrite(destination, null, xml, writeAs.external),
            comparisonRequested: false,
            decisionStale: true
          })
        }
        const current = this.store.get(id)
        if (!current) return { status: 'missing-session', ok: false, sessionId: id }
        if (!sameDocumentIdentity(current.identity, session.identity)) {
          return this.#finish(id, { status: 'stale-workspace', ok: false, sessionId: id })
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
        return this.#finish(id, outcome)
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
      if (write.status === 'external-conflict') {
        return this.#finish(id, {
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

      const current = this.store.get(id)
      if (!current) return { status: 'missing-session', ok: false, sessionId: id }
      if (!sameDocumentIdentity(current.identity, session.identity)) {
        // The immutable identity ensured bytes went to the old workspace/path;
        // do not falsely acknowledge them against a session that has since moved.
        return this.#finish(id, { status: 'stale-workspace', ok: false, sessionId: id })
      }
      const identityChanged = !sameDocumentIdentity(lockIdentity, session.identity)
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
      return this.#finish(id, outcome)
    } catch (error) {
      return this.#finishFailure(id, error)
    } finally {
      try {
        await lease?.release()
      } catch (error) {
        this.#onPostSaveError(error)
      }
    }
  }

  #setPhase(
    id: SessionId,
    phase: SessionSaveState['phase'],
    requestId: string,
    startedRevision: number,
    startedAt: number
  ): void {
    if (!this.store.get(id)) return
    this.store.setSaveState(id, {
      phase,
      requestId,
      startedRevision,
      startedAt,
      lastOutcome: null
    })
  }

  #finish(id: SessionId, outcome: SessionSaveOutcome): SessionSaveOutcome {
    if (this.store.get(id)) this.store.setSaveState(id, idleAfter(outcome))
    return outcome
  }

  #finishFailure(id: SessionId, error: unknown): SessionSaveOutcome {
    const failure = classifySaveFailure(error)
    if (failure.code === 'aborted') {
      return this.#finish(id, { status: 'cancelled', ok: false, sessionId: id })
    }
    if (failure.code === 'stale-workspace') {
      return this.#finish(id, { status: 'stale-workspace', ok: false, sessionId: id })
    }
    const status = failure.code === 'permission-denied' ? 'permission-loss' : 'storage-failure'
    return this.#finish(id, { status, ok: false, sessionId: id, failure })
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
