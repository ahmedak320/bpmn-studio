import type { SaveOutcome, SuccessfulSaveOutcome } from '../workspace/adapters'
import type { PortableHistoryManager } from '../workspace/history/historyManager'
import type { HistoryRevision, HistoryWriteResult } from '../workspace/history/types'
import { decodeUtf8Strict } from '../workspace/utf8'
import { DocumentSessionStore } from './store'
import {
  sameDocumentIdentity,
  sameSessionIncarnation,
  type DocumentSession,
  type SessionId,
  type WorkspaceIdentity
} from './types'

export interface RestoreHistoryRevisionOptions {
  manager: Pick<PortableHistoryManager, 'restore'> &
    Partial<Pick<PortableHistoryManager, 'preview'>>
  store: DocumentSessionStore
  revision: HistoryRevision
  workspace: WorkspaceIdentity
  /**
   * Mandatory compare-and-set boundary captured immediately before the user
   * confirms restore. `null` explicitly means the original path was observed
   * missing; restoring then uses a creation-only write. A history restore is
   * never an implicit overwrite.
   */
  expectedCurrentHash: string | null
  signal?: AbortSignal
  isWorkspaceCurrent?: (workspace: WorkspaceIdentity) => boolean
  /**
   * Runs only after the revision preview has passed its checksum verification.
   * Returning anything but `completed` is a no-write outcome.
   */
  prepareXml?: (
    verifiedPreviewXml: string,
    context: {
      revision: HistoryRevision
      session: DocumentSession | null
      signal?: AbortSignal
    }
  ) => Promise<PrepareHistoryXmlResult>
  /**
   * Required with `prepareXml`. This is the storage/history CAS seam: it must
   * write exactly `xml` and honor `expectedCurrentHash` (`null` means
   * creation-only). The successful snapshot is verified before editor refresh.
   */
  writePreparedXml?: (input: PreparedHistoryXmlWrite) => Promise<HistoryWriteResult>
  /**
   * Optional editor integration. When omitted, a modeler exposing importXML is
   * used. Sessions without a live modeler need no importer.
   */
  applyXml?: (session: DocumentSession, xml: string) => void | Promise<void>
}

export type PrepareHistoryXmlResult =
  | { readonly status: 'completed'; readonly xml: string }
  | { readonly status: 'cancelled' }
  | { readonly status: 'review-required' }

export interface PreparedHistoryXmlWrite {
  readonly revision: HistoryRevision
  readonly xml: string
  readonly expectedCurrentHash: string | null
  readonly signal?: AbortSignal
}

interface HistoryRestoreResultBase {
  readonly sessionId: SessionId | null
  /** Revision of the pre-restore live file created by PortableHistoryManager. */
  readonly previousRevision?: HistoryRevision
}

export type RestoreHistoryRevisionResult =
  | (HistoryRestoreResultBase & {
      readonly status: 'restored'
      readonly outcome: SuccessfulSaveOutcome
    })
  | (HistoryRestoreResultBase & {
      readonly status: 'not-restored'
      readonly outcome: Exclude<SaveOutcome, SuccessfulSaveOutcome>
    })
  | (HistoryRestoreResultBase & {
      readonly status: 'failed'
      readonly error: unknown
    })
  | (HistoryRestoreResultBase & {
      readonly status: 'storage-restored-session-refresh-failed'
      readonly outcome: SuccessfulSaveOutcome
      readonly error: unknown
    })
  | (HistoryRestoreResultBase & {
      readonly status: 'preparation-not-completed'
      readonly reason: 'cancelled' | 'review-required' | 'stale'
    })

type ImportingModeler = {
  importXML(xml: string): unknown
}

function isImportingModeler(value: unknown): value is ImportingModeler {
  return (
    typeof value === 'object' &&
    value !== null &&
    'importXML' in value &&
    typeof (value as { importXML?: unknown }).importXML === 'function'
  )
}

function sessionForRevision(
  store: DocumentSessionStore,
  workspace: WorkspaceIdentity,
  revision: HistoryRevision
): DocumentSession | undefined {
  return store.getByIdentity({
    workspace,
    path: revision.originalPath
  })
}

function sessionStillMatches(
  current: DocumentSession | undefined,
  captured: DocumentSession,
  restoredXml?: string
): current is DocumentSession {
  return Boolean(
    current &&
    sameSessionIncarnation(current, captured) &&
    sameDocumentIdentity(current.identity, captured.identity) &&
    ((current.revision === captured.revision && current.currentXml === captured.currentXml) ||
      (restoredXml !== undefined && current.currentXml === restoredXml))
  )
}

async function applyRestoredXml(
  session: DocumentSession,
  xml: string,
  applyXml: RestoreHistoryRevisionOptions['applyXml']
): Promise<void> {
  if (applyXml) {
    await applyXml(session, xml)
    return
  }
  if (session.modeler === null) return
  if (!isImportingModeler(session.modeler)) {
    throw new Error('The live editor does not expose importXML; its session was left unchanged.')
  }
  await session.modeler.importXML(xml)
}

function retainLocalXmlAgainstRestoredStorage(
  store: DocumentSessionStore,
  captured: DocumentSession,
  restoredXml: string,
  outcome: SuccessfulSaveOutcome
): void {
  const live = store.get(captured.id)
  if (
    !live ||
    !sameSessionIncarnation(live, captured) ||
    !sameDocumentIdentity(live.identity, captured.identity)
  ) {
    return
  }

  // Importing restored XML can itself publish editor change events before
  // ultimately rejecting. Prefer a genuinely newer local edit, but otherwise
  // retain the exact editor XML captured before the failed refresh.
  const retainedXml =
    live.revision !== captured.revision && live.currentXml !== restoredXml
      ? live.currentXml
      : captured.currentXml
  store.replaceWithExternal(captured.id, {
    xml: restoredXml,
    fingerprint: {
      hash: outcome.snapshot.hash,
      size: outcome.snapshot.size,
      modifiedAt: outcome.snapshot.modifiedAt
    }
  })
  if (retainedXml !== restoredXml) store.updateXml(captured.id, retainedXml)
}

function previousRevision(result: HistoryWriteResult): HistoryRevision | undefined {
  return result.revision
}

function byteArraysEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false
  }
  return true
}

function preparationContextIsCurrent(
  options: RestoreHistoryRevisionOptions,
  capturedSession: DocumentSession | undefined
): boolean {
  if (options.signal?.aborted) return false
  if (options.isWorkspaceCurrent && !options.isWorkspaceCurrent(options.workspace)) return false
  const current = sessionForRevision(options.store, options.workspace, options.revision)
  return capturedSession ? sessionStillMatches(current, capturedSession) : current === undefined
}

async function prepareHistoryWrite(
  options: RestoreHistoryRevisionOptions,
  capturedSession: DocumentSession | undefined
): Promise<
  | { status: 'ready'; result: HistoryWriteResult; preparedXml?: string }
  | { status: 'not-completed'; reason: 'cancelled' | 'review-required' | 'stale' }
> {
  if (!options.prepareXml) {
    return {
      status: 'ready',
      result: await options.manager.restore(
        options.revision,
        options.expectedCurrentHash === null ? null : options.expectedCurrentHash.toLowerCase()
      )
    }
  }
  if (!options.manager.preview || !options.writePreparedXml) {
    throw new Error('Prepared history restore requires preview and writePreparedXml.')
  }
  if (!preparationContextIsCurrent(options, capturedSession)) {
    return {
      status: 'not-completed',
      reason: options.signal?.aborted ? 'cancelled' : 'stale'
    }
  }

  const preview = await options.manager.preview(options.revision)
  if (!preparationContextIsCurrent(options, capturedSession)) {
    return {
      status: 'not-completed',
      reason: options.signal?.aborted ? 'cancelled' : 'stale'
    }
  }
  const prepared = await options.prepareXml(preview.xml, {
    revision: options.revision,
    session: capturedSession ?? null,
    signal: options.signal
  })
  if (prepared.status !== 'completed') {
    return { status: 'not-completed', reason: prepared.status }
  }
  if (!preparationContextIsCurrent(options, capturedSession)) {
    return {
      status: 'not-completed',
      reason: options.signal?.aborted ? 'cancelled' : 'stale'
    }
  }

  // Re-read the checksum-verified source after the asynchronous review. A
  // changed/corrupted revision must fail before the CAS writer is called.
  const reverified = await options.manager.preview(options.revision)
  if (
    reverified.revision.id !== preview.revision.id ||
    !byteArraysEqual(reverified.bytes, preview.bytes)
  ) {
    throw new Error('History revision changed while its restore was being reviewed.')
  }
  if (!preparationContextIsCurrent(options, capturedSession)) {
    return {
      status: 'not-completed',
      reason: options.signal?.aborted ? 'cancelled' : 'stale'
    }
  }
  return {
    status: 'ready',
    preparedXml: prepared.xml,
    result: await options.writePreparedXml({
      revision: options.revision,
      xml: prepared.xml,
      expectedCurrentHash:
        options.expectedCurrentHash === null ? null : options.expectedCurrentHash.toLowerCase(),
      signal: options.signal
    })
  }
}

/**
 * Restores portable history with a mandatory disk CAS, then synchronizes the
 * matching open session without replacing its id, modeler, command stack, or
 * serialization binding. Storage success and editor-refresh failure are
 * intentionally distinct outcomes because the disk must never be reported as
 * unchanged after it has committed.
 */
export async function restoreHistoryRevision(
  options: RestoreHistoryRevisionOptions
): Promise<RestoreHistoryRevisionResult> {
  if (
    options.expectedCurrentHash !== null &&
    !/^[0-9a-f]{64}$/iu.test(options.expectedCurrentHash)
  ) {
    throw new TypeError('expectedCurrentHash must be a SHA-256 digest or null.')
  }
  const capturedSession = sessionForRevision(options.store, options.workspace, options.revision)
  let result: HistoryWriteResult
  let preparedXml: string | undefined
  try {
    const prepared = await prepareHistoryWrite(options, capturedSession)
    if (prepared.status === 'not-completed') {
      return {
        status: 'preparation-not-completed',
        sessionId: capturedSession?.id ?? null,
        reason: prepared.reason
      }
    }
    result = prepared.result
    preparedXml = prepared.preparedXml
  } catch (error) {
    return {
      status: 'failed',
      sessionId: capturedSession?.id ?? null,
      error
    }
  }
  if (result.outcome.status !== 'success') {
    return {
      status: 'not-restored',
      sessionId: capturedSession?.id ?? null,
      previousRevision: previousRevision(result),
      outcome: result.outcome
    }
  }

  let restoredXml: string
  try {
    restoredXml = decodeUtf8Strict(result.outcome.snapshot.bytes, {
      operation: 'read',
      path: options.revision.originalPath
    })
    if (preparedXml !== undefined && restoredXml !== preparedXml) {
      throw new Error('Prepared history writer did not persist the reviewed XML exactly.')
    }
  } catch (error) {
    return {
      status: 'storage-restored-session-refresh-failed',
      sessionId: capturedSession?.id ?? null,
      previousRevision: previousRevision(result),
      outcome: result.outcome,
      error
    }
  }
  if (
    options.signal?.aborted ||
    (options.isWorkspaceCurrent && !options.isWorkspaceCurrent(options.workspace))
  ) {
    return {
      status: 'storage-restored-session-refresh-failed',
      sessionId: capturedSession?.id ?? null,
      previousRevision: previousRevision(result),
      outcome: result.outcome,
      error: new Error('History restore storage committed after its operation became stale.')
    }
  }
  const liveForRevision = sessionForRevision(options.store, options.workspace, options.revision)
  const session = capturedSession ?? liveForRevision
  if (!session) {
    return {
      status: 'restored',
      sessionId: null,
      previousRevision: previousRevision(result),
      outcome: result.outcome
    }
  }
  if (
    capturedSession &&
    !sessionStillMatches(options.store.get(capturedSession.id), capturedSession)
  ) {
    retainLocalXmlAgainstRestoredStorage(
      options.store,
      capturedSession,
      restoredXml,
      result.outcome
    )
    return {
      status: 'storage-restored-session-refresh-failed',
      sessionId: capturedSession.id,
      previousRevision: previousRevision(result),
      outcome: result.outcome,
      error: new Error('The open session changed while history restore was writing storage.')
    }
  }
  if (!capturedSession && liveForRevision) {
    retainLocalXmlAgainstRestoredStorage(
      options.store,
      liveForRevision,
      restoredXml,
      result.outcome
    )
    return {
      status: 'storage-restored-session-refresh-failed',
      sessionId: liveForRevision.id,
      previousRevision: previousRevision(result),
      outcome: result.outcome,
      error: new Error('A session opened while history restore was writing storage.')
    }
  }

  try {
    await applyRestoredXml(session, restoredXml, options.applyXml)
    const live = options.store.get(session.id)
    if (
      options.signal?.aborted ||
      (options.isWorkspaceCurrent && !options.isWorkspaceCurrent(options.workspace)) ||
      !sessionStillMatches(live, session, restoredXml)
    ) {
      throw new Error('The open session changed while restored XML was being imported.')
    }
    options.store.replaceWithExternal(session.id, {
      xml: restoredXml,
      fingerprint: {
        hash: result.outcome.snapshot.hash,
        size: result.outcome.snapshot.size,
        modifiedAt: result.outcome.snapshot.modifiedAt
      }
    })
  } catch (error) {
    retainLocalXmlAgainstRestoredStorage(options.store, session, restoredXml, result.outcome)
    return {
      status: 'storage-restored-session-refresh-failed',
      sessionId: session.id,
      previousRevision: previousRevision(result),
      outcome: result.outcome,
      error
    }
  }

  return {
    status: 'restored',
    sessionId: session.id,
    previousRevision: previousRevision(result),
    outcome: result.outcome
  }
}
