import { DocumentSessionStore } from './store'
import {
  sameDocumentIdentity,
  type DocumentIdentity,
  type DocumentSession,
  type PathMigrationPhase,
  type SessionId,
  type SessionIncarnation
} from './types'

export type PathEntryKind = 'file' | 'directory'
export type PathTransactionKind = 'rename' | 'move' | 'delete'
export type DirtyPathDecision = 'save-and-continue' | 'continue-without-saving' | 'cancel'

export interface PathTransactionRequest {
  id: string
  kind: PathTransactionKind
  workspaceId: string
  entryKind: PathEntryKind
  sourcePath: string
  destinationPath?: string
  /** Delete must never become ready without an explicit confirmation. */
  deleteConfirmed?: boolean
}

export interface SessionPathMigration {
  sessionId: SessionId
  incarnation: SessionIncarnation
  from: DocumentIdentity
  to: DocumentIdentity | null
  dirty: boolean
  currentXml: string
  lastSavedXml: string
  revision: number
}

export interface PathTransactionPlan {
  id: string
  request: PathTransactionRequest
  phase: PathMigrationPhase | 'needs-delete-confirmation'
  affectedSessionIds: readonly SessionId[]
  dirtySessionIds: readonly SessionId[]
  migrations: readonly SessionPathMigration[]
  decision: DirtyPathDecision | null
  error: string | null
}

export type PathSaveOutcome = {
  sessionId: SessionId
  ok: boolean
  status: string
  remainingDirty?: boolean
}

export interface ExecutePathTransactionDependencies {
  saveSession(sessionId: SessionId): Promise<PathSaveOutcome>
  /**
   * Performs the filesystem mutation and returns a rollback hook. The hook is
   * required until draft migration and the one-shot session commit both finish.
   * A staged delete may return a post-commit finalizer; finalizer failure must
   * leave recoverable hidden data rather than roll back already-closed sessions.
   */
  mutateStorage(plan: PathTransactionPlan): Promise<{
    rollback(): Promise<void>
    finalize?(): Promise<void>
  }>
  migrateDrafts?(migrations: readonly SessionPathMigration[]): Promise<{
    rollback(): Promise<void>
  }>
}

export type ExecutePathTransactionResult =
  | { status: 'committed'; plan: PathTransactionPlan; finalizeError?: unknown }
  | { status: 'cancelled'; plan: PathTransactionPlan }
  | { status: 'needs-delete-confirmation'; plan: PathTransactionPlan }
  | { status: 'save-failed'; plan: PathTransactionPlan; outcomes: readonly PathSaveOutcome[] }
  | { status: 'failed'; plan: PathTransactionPlan; error: unknown; rolledBack: boolean }

export function normalizeWorkspacePath(path: string): string {
  const normalized = path
    .replaceAll('\\', '/')
    .replace(/^\.\/+/, '')
    .replace(/\/+/g, '/')
  if (!normalized || normalized.startsWith('/') || normalized.endsWith('/')) {
    throw new Error(`Invalid workspace path "${path}"`)
  }
  const segments = normalized.split('/')
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error(`Invalid workspace path "${path}"`)
  }
  return normalized
}

export function pathIsAffected(
  documentPath: string,
  sourcePath: string,
  entryKind: PathEntryKind
): boolean {
  return (
    documentPath === sourcePath ||
    (entryKind === 'directory' && documentPath.startsWith(`${sourcePath}/`))
  )
}

export function migratePath(
  documentPath: string,
  sourcePath: string,
  destinationPath: string,
  entryKind: PathEntryKind
): string {
  if (!pathIsAffected(documentPath, sourcePath, entryKind)) return documentPath
  if (entryKind === 'file') return destinationPath
  return `${destinationPath}${documentPath.slice(sourcePath.length)}`
}

export function planPathTransaction(
  sessions: Iterable<DocumentSession>,
  requestInput: PathTransactionRequest
): PathTransactionPlan {
  const request: PathTransactionRequest = {
    ...requestInput,
    sourcePath: normalizeWorkspacePath(requestInput.sourcePath),
    destinationPath:
      requestInput.kind === 'delete'
        ? undefined
        : normalizeWorkspacePath(requestInput.destinationPath ?? '')
  }
  if (request.kind !== 'delete' && request.sourcePath === request.destinationPath) {
    throw new Error('Path transaction source and destination are identical')
  }

  const migrations: SessionPathMigration[] = []
  const destinationKeys = new Set<string>()
  for (const session of sessions) {
    if (
      session.identity.workspace.id !== request.workspaceId ||
      session.identity.path === null ||
      !pathIsAffected(session.identity.path, request.sourcePath, request.entryKind)
    ) {
      continue
    }
    const toPath =
      request.kind === 'delete'
        ? null
        : migratePath(
            session.identity.path,
            request.sourcePath,
            request.destinationPath!,
            request.entryKind
          )
    const to =
      toPath === null
        ? null
        : {
            workspace: session.identity.workspace,
            path: toPath
          }
    if (to) {
      const key = JSON.stringify([to.workspace.id, to.workspace.generation, to.path])
      if (destinationKeys.has(key)) throw new Error('Path transaction creates duplicate sessions')
      destinationKeys.add(key)
    }
    migrations.push({
      sessionId: session.id,
      incarnation: session.incarnation,
      from: session.identity,
      to,
      dirty: session.dirty,
      currentXml: session.currentXml,
      lastSavedXml: session.lastSavedXml,
      revision: session.revision
    })
  }

  const dirtySessionIds = migrations.filter((migration) => migration.dirty).map((m) => m.sessionId)
  const phase: PathTransactionPlan['phase'] =
    request.kind === 'delete' && !request.deleteConfirmed
      ? 'needs-delete-confirmation'
      : dirtySessionIds.length > 0
        ? 'awaiting-dirty-decision'
        : 'ready'
  return {
    id: request.id,
    request,
    phase,
    affectedSessionIds: migrations.map((migration) => migration.sessionId),
    dirtySessionIds,
    migrations,
    decision: null,
    error: null
  }
}

export function confirmPathDelete(plan: PathTransactionPlan): PathTransactionPlan {
  if (plan.request.kind !== 'delete') return plan
  const phase = plan.dirtySessionIds.length > 0 ? 'awaiting-dirty-decision' : 'ready'
  return {
    ...plan,
    request: { ...plan.request, deleteConfirmed: true },
    phase
  }
}

export function resolveDirtyPathDecision(
  plan: PathTransactionPlan,
  decision: DirtyPathDecision
): PathTransactionPlan {
  if (plan.phase !== 'awaiting-dirty-decision') {
    throw new Error(`Cannot resolve dirty paths while transaction is "${plan.phase}"`)
  }
  return {
    ...plan,
    decision,
    phase:
      decision === 'cancel' ? 'cancelled' : decision === 'save-and-continue' ? 'saving' : 'ready'
  }
}

function withPhase(
  plan: PathTransactionPlan,
  phase: PathTransactionPlan['phase'],
  error: string | null = null
): PathTransactionPlan {
  return { ...plan, phase, error }
}

function publishMigrationPhase(store: DocumentSessionStore, plan: PathTransactionPlan): void {
  store.batch(() => {
    for (const migration of plan.migrations) {
      if (store.get(migration.sessionId)?.incarnation !== migration.incarnation) continue
      store.setPathMigration(migration.sessionId, {
        transactionId: plan.id,
        phase: plan.phase === 'needs-delete-confirmation' ? 'awaiting-dirty-decision' : plan.phase,
        fromPath: migration.from.path,
        toPath: migration.to?.path ?? null,
        error: plan.error
      })
    }
  })
}

function sessionsStillMatchPlan(store: DocumentSessionStore, plan: PathTransactionPlan): boolean {
  return plan.migrations.every((migration) => {
    const session = store.get(migration.sessionId)
    return Boolean(
      session &&
      session.incarnation === migration.incarnation &&
      sameDocumentIdentity(session.identity, migration.from) &&
      session.save.phase === 'idle' &&
      session.revision === migration.revision &&
      session.currentXml === migration.currentXml
    )
  })
}

/**
 * Runs storage and draft migrations before publishing one atomic session-store
 * update. Any failure invokes rollback hooks in reverse order.
 */
export async function executePathTransaction(
  store: DocumentSessionStore,
  initialPlan: PathTransactionPlan,
  dependencies: ExecutePathTransactionDependencies
): Promise<ExecutePathTransactionResult> {
  let plan = initialPlan
  publishMigrationPhase(store, plan)
  if (plan.phase === 'needs-delete-confirmation') {
    return { status: 'needs-delete-confirmation', plan }
  }
  if (plan.phase === 'cancelled') return { status: 'cancelled', plan }
  if (plan.phase === 'awaiting-dirty-decision') {
    throw new Error('Dirty path decision is required before execution')
  }
  if (plan.phase === 'saving') {
    const outcomes = await Promise.all(plan.dirtySessionIds.map(dependencies.saveSession))
    if (outcomes.some((outcome) => !outcome.ok || outcome.remainingDirty)) {
      plan = withPhase(plan, 'failed', 'One or more affected sessions could not be saved')
      publishMigrationPhase(store, plan)
      return { status: 'save-failed', plan, outcomes }
    }
    plan = withPhase(plan, 'ready')
    publishMigrationPhase(store, plan)
  }
  if (plan.phase !== 'ready') throw new Error(`Path transaction is not ready: "${plan.phase}"`)

  // Revalidate every identity immediately before touching storage.
  if (!sessionsStillMatchPlan(store, plan)) {
    plan = withPhase(plan, 'failed', 'An affected session changed before the transaction')
    publishMigrationPhase(store, plan)
    return { status: 'failed', plan, error: new Error(plan.error!), rolledBack: false }
  }

  plan = withPhase(plan, 'applying')
  publishMigrationPhase(store, plan)
  let storageRollback: (() => Promise<void>) | undefined
  let storageFinalize: (() => Promise<void>) | undefined
  let draftRollback: (() => Promise<void>) | undefined
  try {
    const storageMutation = await dependencies.mutateStorage(plan)
    storageRollback = storageMutation.rollback
    storageFinalize = storageMutation.finalize
    if (dependencies.migrateDrafts) {
      draftRollback = (await dependencies.migrateDrafts(plan.migrations)).rollback
    }

    // A live modeler may receive an edit while filesystem/draft I/O is pending.
    // Never commit the earlier byte snapshot over that newer revision.
    if (!sessionsStillMatchPlan(store, plan)) {
      throw new Error('An affected session changed while the transaction was applying')
    }

    if (plan.request.kind === 'delete') {
      store.closeMany(plan.affectedSessionIds)
    } else {
      store.migrateIdentities(
        plan.migrations.map((migration) => {
          if (!migration.to) throw new Error('A move/rename migration requires a destination')
          return {
            sessionId: migration.sessionId,
            incarnation: migration.incarnation,
            from: migration.from,
            to: migration.to,
            title: migration.to.path?.split('/').pop(),
            transactionId: plan.id
          }
        })
      )
    }
    plan = withPhase(plan, 'committed')
    try {
      await storageFinalize?.()
      return { status: 'committed', plan }
    } catch (finalizeError) {
      return { status: 'committed', plan, finalizeError }
    }
  } catch (error) {
    plan = withPhase(plan, 'rolling-back', error instanceof Error ? error.message : String(error))
    publishMigrationPhase(store, plan)
    let rolledBack = true
    try {
      await draftRollback?.()
    } catch {
      rolledBack = false
    }
    try {
      await storageRollback?.()
    } catch {
      rolledBack = false
    }
    plan = withPhase(plan, 'failed', plan.error)
    publishMigrationPhase(store, plan)
    return { status: 'failed', plan, error, rolledBack }
  }
}
