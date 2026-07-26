import type { SaveOutcome, SuccessfulSaveOutcome } from '../workspace/adapters'
import type { PortableHistoryManager } from '../workspace/history/historyManager'
import type { HistoryRevision, HistoryWriteResult } from '../workspace/history/types'
import { decodeUtf8Strict } from '../workspace/utf8'
import { DocumentSessionStore } from './store'
import {
  sameDocumentIdentity,
  type DocumentSession,
  type SessionId,
  type WorkspaceIdentity
} from './types'

export interface RestoreHistoryRevisionOptions {
  manager: Pick<PortableHistoryManager, 'restore'>
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
  /**
   * Optional editor integration. When omitted, a modeler exposing importXML is
   * used. Sessions without a live modeler need no importer.
   */
  applyXml?: (session: DocumentSession, xml: string) => void | Promise<void>
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
    current.id === captured.id &&
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
  if (!live || !sameDocumentIdentity(live.identity, captured.identity)) return

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
  try {
    result = await options.manager.restore(
      options.revision,
      options.expectedCurrentHash === null ? null : options.expectedCurrentHash.toLowerCase()
    )
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
  } catch (error) {
    return {
      status: 'storage-restored-session-refresh-failed',
      sessionId: capturedSession?.id ?? null,
      previousRevision: previousRevision(result),
      outcome: result.outcome,
      error
    }
  }
  const session =
    capturedSession ?? sessionForRevision(options.store, options.workspace, options.revision)
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

  try {
    await applyRestoredXml(session, restoredXml, options.applyXml)
    const live = options.store.get(session.id)
    if (!sessionStillMatches(live, session, restoredXml)) {
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
