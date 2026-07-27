import { useCallback, useEffect, useRef, useState } from 'react'
import { AccessibleDialog } from '../common/AccessibleDialog'
import { TextInputModal } from '../common/prompt/TextInputModal'
import { t, type Key } from '../i18n'
import { useLang } from '../i18n/useLang'
import type { RestoreHistoryRevisionResult } from '../sessions/historyRestore'
import { normalizeWorkspacePath, type SaveOutcome } from './adapters'
import {
  HISTORY_DIFF_BUDGETS,
  type BoundedHistoryPreview,
  type HistoryDiff,
  type HistoryIssue,
  type HistoryRevision,
  type HistoryRevisionReason,
  boundHistoryPreview,
  PortableHistoryManager
} from './history'
import './HistoryDialog.css'

export const HISTORY_PREVIEW_MAX_CHARACTERS = HISTORY_DIFF_BUDGETS.maxPreviewChars
export const HISTORY_TECHNICAL_DETAIL_MAX_CODE_POINTS = 512
export const HISTORY_ISSUE_SUMMARY_MAX_CODE_POINTS = 4_096
export const HISTORY_DIALOG_PAGE_SIZE = 25

// A page contains at most 25 issues. Keeping every localized label to 160 code
// points (including its bounded path) guarantees that all page issues fit
// inside the 4,096-code-point aggregate instead of silently consuming a cursor
// page whose final issues cannot be shown.
const HISTORY_ISSUE_PATH_MAX_CODE_POINTS = 96
const HISTORY_ISSUE_LABEL_MAX_CODE_POINTS = 160

const HISTORY_REASON_KEYS = Object.freeze({
  overwrite: 'workspace.history.reason.overwrite',
  delete: 'workspace.history.reason.delete',
  restore: 'workspace.history.reason.restore',
  manual: 'workspace.history.reason.manual',
  'backup-import': 'workspace.history.reason.backupImport'
} satisfies Record<HistoryRevisionReason, Key>)

type FailedSaveOutcome = Exclude<SaveOutcome, { status: 'success' }>
type FailedSaveStatus = FailedSaveOutcome['status']
type ExternalConflictReason = Extract<FailedSaveOutcome, { status: 'external-conflict' }>['reason']
type RestorePreparationReason = Extract<
  HistoryDialogRestoreResult,
  { status: 'preparation-not-completed' }
>['reason']

const RESTORE_PREPARATION_REASON_KEYS = Object.freeze({
  cancelled: 'workspace.history.restoreReason.cancelled',
  'review-required': 'workspace.history.restoreReason.reviewRequired',
  stale: 'workspace.history.restoreReason.stale'
} satisfies Record<RestorePreparationReason, Key>)

const SAVE_OUTCOME_KEYS = Object.freeze({
  'permission-loss': 'workspace.history.saveOutcome.permissionLoss',
  'external-conflict': 'workspace.history.saveOutcome.externalConflict',
  'stale-workspace': 'workspace.history.saveOutcome.staleWorkspace',
  cancelled: 'workspace.history.saveOutcome.cancelled',
  'storage-failure': 'workspace.history.saveOutcome.storageFailure'
} satisfies Record<FailedSaveStatus, Key>)

const EXTERNAL_CONFLICT_REASON_KEYS = Object.freeze({
  'hash-mismatch': 'workspace.history.conflictReason.hashMismatch',
  missing: 'workspace.history.conflictReason.missing',
  'already-exists': 'workspace.history.conflictReason.alreadyExists'
} satisfies Record<ExternalConflictReason, Key>)

const HISTORY_ISSUE_KEYS = Object.freeze({
  unreadable: 'workspace.history.issue.unreadable',
  'invalid-metadata': 'workspace.history.issue.invalidMetadata',
  'missing-content': 'workspace.history.issue.missingContent',
  'checksum-mismatch': 'workspace.history.issue.checksumMismatch',
  'orphan-content': 'workspace.history.issue.orphanContent',
  'retention-limit': 'workspace.history.issue.retentionLimit'
} satisfies Record<HistoryIssue['code'], Key>)

const HISTORY_ACTION_FAILURE_KEYS = Object.freeze({
  preview: 'workspace.history.action.previewFailed',
  diff: 'workspace.history.action.diffFailed',
  restore: 'workspace.history.action.restoreFailed',
  'restore-copy': 'workspace.history.action.restoreCopyFailed'
} satisfies Record<'preview' | 'diff' | 'restore' | 'restore-copy', Key>)

type HistoryActionFailureKey =
  (typeof HISTORY_ACTION_FAILURE_KEYS)[keyof typeof HISTORY_ACTION_FAILURE_KEYS]

interface HistoryVisibleError {
  summary: string
  technicalDetail?: string
}

interface BoundedText {
  text: string
  truncated: boolean
}

class HistoryVisibleFailure extends Error {
  readonly visible: HistoryVisibleError

  constructor(visible: HistoryVisibleError) {
    super(visible.summary)
    this.name = 'HistoryVisibleFailure'
    const detail = technicalDetail(visible.technicalDetail)
    this.visible = {
      summary: visible.summary,
      ...(detail ? { technicalDetail: detail } : {})
    }
  }
}

function mappedCodeLabel<T extends string>(
  value: unknown,
  labels: Readonly<Record<T, Key>>,
  fallback: Key
): string {
  if (typeof value !== 'string' || !Object.prototype.hasOwnProperty.call(labels, value)) {
    return t(fallback)
  }
  return t(labels[value as T])
}

/**
 * Convert hostile diagnostic values inside a guarded boundary, then retain at
 * most `maxCodePoints` Unicode code points including the ellipsis. Iteration
 * stops after the first omitted scalar so a megabyte message cannot become a
 * megabyte array or DOM node.
 */
function boundedText(value: unknown, maxCodePoints: number): BoundedText | undefined {
  if (value === null || value === undefined) return undefined
  let raw: string
  try {
    raw = String(value)
  } catch {
    return undefined
  }
  if (maxCodePoints < 1) return undefined

  const visible: string[] = []
  const iterator = raw[Symbol.iterator]()
  let hasNonWhitespace = false
  for (let index = 0; index < maxCodePoints; index += 1) {
    const next = iterator.next()
    if (next.done) {
      return hasNonWhitespace ? { text: visible.join(''), truncated: false } : undefined
    }
    visible.push(next.value)
    hasNonWhitespace ||= /\S/u.test(next.value)
  }
  if (iterator.next().done) {
    return hasNonWhitespace ? { text: visible.join(''), truncated: false } : undefined
  }

  visible[maxCodePoints - 1] = '…'
  return { text: visible.join(''), truncated: true }
}

function saveOutcomeLabel(outcome: FailedSaveOutcome): string {
  const status = (outcome as { status?: unknown }).status
  if (
    typeof status !== 'string' ||
    !Object.prototype.hasOwnProperty.call(SAVE_OUTCOME_KEYS, status)
  ) {
    return t('workspace.history.saveOutcome.unknown')
  }
  const key = SAVE_OUTCOME_KEYS[status as FailedSaveStatus]
  if (status !== 'external-conflict') return t(key)
  return t(key, {
    reason: mappedCodeLabel(
      (outcome as { reason?: unknown }).reason,
      EXTERNAL_CONFLICT_REASON_KEYS,
      'workspace.history.conflictReason.unknown'
    )
  })
}

function historyIssueLabel(issue: HistoryIssue): string {
  let code: unknown
  let rawPath: unknown
  try {
    code = (issue as { code?: unknown }).code
  } catch {
    code = undefined
  }
  try {
    rawPath = (issue as { path?: unknown }).path
  } catch {
    rawPath = undefined
  }
  const key =
    typeof code === 'string' && Object.prototype.hasOwnProperty.call(HISTORY_ISSUE_KEYS, code)
      ? HISTORY_ISSUE_KEYS[code as HistoryIssue['code']]
      : 'workspace.history.issue.unknown'
  const path = boundedText(rawPath, HISTORY_ISSUE_PATH_MAX_CODE_POINTS)?.text ?? '?'
  return (
    boundedText(t(key, { path }), HISTORY_ISSUE_LABEL_MAX_CODE_POINTS)?.text ??
    t(key, {
      path: '?'
    })
  )
}

function historyIssueSummary(issues: readonly HistoryIssue[]): string | undefined {
  let summary = ''
  for (const issue of issues) {
    const label = historyIssueLabel(issue)
    const candidate = summary ? `${summary}\n${label}` : label
    const bounded = boundedText(candidate, HISTORY_ISSUE_SUMMARY_MAX_CODE_POINTS)
    if (!bounded) continue
    summary = bounded.text
    if (bounded.truncated) break
  }
  return summary || undefined
}

export type HistoryDialogRestoreResult = RestoreHistoryRevisionResult
export type HistoryDialogRestoreHandler = (
  revision: HistoryRevision
) => Promise<HistoryDialogRestoreResult>
export type HistoryDialogRestoreCopyHandler = (
  revision: HistoryRevision,
  destination: string,
  signal: AbortSignal
) => Promise<SaveOutcome>

export interface HistoryDialogProps {
  manager: PortableHistoryManager
  currentXml: (path: string) => string | undefined
  onChanged: () => void | Promise<void>
  /**
   * Restoring an existing file must pass through the document-session
   * integration so storage and a matching live editor cannot silently
   * diverge. The dialog remains useful for preview/diff/copy without this
   * callback, but disables in-place restore.
   */
  onRestore?: HistoryDialogRestoreHandler
  /**
   * Application integrations should use this seam to bind restore-as-copy to
   * the captured workspace generation. The manager fallback remains available
   * for isolated/local consumers and still receives dialog cancellation.
   */
  onRestoreCopy?: HistoryDialogRestoreCopyHandler
  onClose: () => void
}

interface RestoreCopyRequest {
  revision: HistoryRevision
  destination: string
}

type RestoreCopyDestination = { ok: true; path: string } | { ok: false; error: string }

function invalidRestoreCopyDestination(destination: string): RestoreCopyDestination {
  return {
    ok: false,
    error: t('workspace.history.copyDestinationInvalid', { destination })
  }
}

function technicalDetail(cause: unknown): string | undefined {
  let detail: unknown
  try {
    detail = cause instanceof Error ? cause.message : cause
  } catch {
    return undefined
  }
  return boundedText(detail, HISTORY_TECHNICAL_DETAIL_MAX_CODE_POINTS)?.text
}

function isCancellation(cause: unknown): boolean {
  try {
    if (typeof cause !== 'object' || cause === null) return false
    const candidate = cause as { code?: unknown; name?: unknown }
    return candidate.code === 'cancelled' || candidate.name === 'AbortError'
  } catch {
    return false
  }
}

function validateRestoreCopyDestination(destination: string): RestoreCopyDestination {
  const trimmed = destination.trim()
  if (!trimmed) {
    return {
      ok: false,
      error: t('workspace.history.copyDestinationRequired')
    }
  }
  try {
    const path = normalizeWorkspacePath(trimmed)
    if (!/\.bpmn$/iu.test(path)) return invalidRestoreCopyDestination(trimmed)
    return { ok: true, path }
  } catch {
    return invalidRestoreCopyDestination(trimmed)
  }
}

export function HistoryDialog({
  manager,
  currentXml,
  onChanged,
  onRestore,
  onRestoreCopy,
  onClose
}: HistoryDialogProps): JSX.Element {
  const lang = useLang()
  const [revisions, setRevisions] = useState<HistoryRevision[]>([])
  // Retain only the bounded display projection. The manager's complete bytes
  // and decoded XML are transient here and remain independently available to
  // exact restore operations through the sealed revision.
  const [preview, setPreview] = useState<BoundedHistoryPreview | null>(null)
  const [diff, setDiff] = useState<HistoryDiff | null>(null)
  const [restoreCopy, setRestoreCopy] = useState<RestoreCopyRequest | null>(null)
  const [busy, setBusy] = useState(false)
  const [listingBusy, setListingBusy] = useState(false)
  const [pageIndex, setPageIndex] = useState(0)
  const [pageCursors, setPageCursors] = useState<Array<string | undefined>>([undefined])
  const [nextCursor, setNextCursor] = useState<string | undefined>()
  const [pageIssueCount, setPageIssueCount] = useState(0)
  const [error, setError] = useState<HistoryVisibleError | null>(null)
  const listingAbortRef = useRef<AbortController | null>(null)
  const restoreCopyAbortRef = useRef<AbortController | null>(null)
  const numberFormatter = new Intl.NumberFormat(lang)
  const previewOmittedCharacters = preview?.omittedCodePoints ?? 0

  const reportListingFailure = useCallback((cause: unknown): void => {
    if (isCancellation(cause)) return
    const detail = technicalDetail(cause)
    setError({
      summary: t('workspace.history.action.listFailed'),
      ...(detail ? { technicalDetail: detail } : {})
    })
  }, [])

  const loadPage = useCallback(
    async (cursor: string | undefined, targetPage: number) => {
      listingAbortRef.current?.abort()
      const controller = new AbortController()
      listingAbortRef.current = controller
      setListingBusy(true)
      try {
        const listing = await manager.listRevisions(undefined, {
          cursor,
          limit: HISTORY_DIALOG_PAGE_SIZE,
          signal: controller.signal
        })
        if (controller.signal.aborted || listingAbortRef.current !== controller) return false
        setRevisions(listing.revisions)
        setPageIssueCount(listing.issues.length)
        setNextCursor(listing.nextCursor)
        setPageIndex(targetPage)
        setPreview(null)
        setDiff(null)
        const issueSummary = historyIssueSummary(listing.issues)
        setError(issueSummary ? { summary: issueSummary } : null)
        return true
      } finally {
        if (listingAbortRef.current === controller) {
          listingAbortRef.current = null
          setListingBusy(false)
        }
      }
    },
    [manager]
  )

  useEffect(() => {
    setPageCursors([undefined])
    setNextCursor(undefined)
    void loadPage(undefined, 0).catch(reportListingFailure)
    return () => {
      listingAbortRef.current?.abort()
      listingAbortRef.current = null
    }
  }, [loadPage, reportListingFailure])

  useEffect(
    () => () => {
      listingAbortRef.current?.abort()
      listingAbortRef.current = null
      restoreCopyAbortRef.current?.abort()
      restoreCopyAbortRef.current = null
    },
    [manager, onRestoreCopy]
  )

  const closeDialog = (): void => {
    listingAbortRef.current?.abort()
    listingAbortRef.current = null
    restoreCopyAbortRef.current?.abort()
    restoreCopyAbortRef.current = null
    onClose()
  }

  const run = async (
    failureKey: HistoryActionFailureKey,
    task: () => Promise<void>
  ): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await task()
    } catch (cause) {
      let visible: HistoryVisibleError | undefined
      try {
        visible = cause instanceof HistoryVisibleFailure ? cause.visible : undefined
      } catch {
        visible = undefined
      }
      if (visible) {
        setError(visible)
      } else {
        const detail = technicalDetail(cause)
        setError({
          summary: t(failureKey),
          ...(detail ? { technicalDetail: detail } : {})
        })
      }
    } finally {
      setBusy(false)
    }
  }

  const refreshAfterCommittedRestore = async (): Promise<unknown | null> => {
    let refreshError: unknown | null = null
    try {
      await onChanged()
    } catch (cause) {
      refreshError = cause
    }
    try {
      const loaded = await loadPage(undefined, 0)
      if (loaded) setPageCursors([undefined])
    } catch (cause) {
      refreshError ??= cause
    }
    return refreshError
  }

  const handleRestoreResult = async (result: HistoryDialogRestoreResult): Promise<void> => {
    if (result.status === 'restored') {
      const refreshError = await refreshAfterCommittedRestore()
      if (refreshError !== null) {
        const detail = technicalDetail(refreshError)
        throw new HistoryVisibleFailure({
          summary: t('workspace.history.action.workspaceRefreshAfterRestoreFailed'),
          ...(detail ? { technicalDetail: detail } : {})
        })
      }
      return
    }
    if (result.status === 'storage-restored-session-refresh-failed') {
      const refreshError = await refreshAfterCommittedRestore()
      const details = [result.error, refreshError]
        .filter((cause): cause is unknown => cause !== null)
        .map(technicalDetail)
        .filter((detail): detail is string => detail !== undefined)
        .filter((message, index, messages) => messages.indexOf(message) === index)
        .join(' ')
      throw new HistoryVisibleFailure({
        summary: t('workspace.history.action.sessionRefreshAfterRestoreFailed'),
        ...(details ? { technicalDetail: technicalDetail(details) } : {})
      })
    }
    if (result.status === 'failed') {
      throw result.error
    }
    if (result.status === 'preparation-not-completed') {
      if (result.reason === 'cancelled') return
      throw new HistoryVisibleFailure({
        summary: t('workspace.history.restoreNotComplete', {
          outcome: mappedCodeLabel(
            result.reason,
            RESTORE_PREPARATION_REASON_KEYS,
            'workspace.history.restoreReason.unknown'
          )
        })
      })
    }
    throw new HistoryVisibleFailure({
      summary: t('workspace.history.restoreNotComplete', {
        outcome: saveOutcomeLabel(result.outcome)
      })
    })
  }

  const restoreCopyDestination = restoreCopy
    ? validateRestoreCopyDestination(restoreCopy.destination)
    : null
  const pageEntryCount = revisions.length + pageIssueCount
  const hasPagination = pageIndex > 0 || nextCursor !== undefined
  const navigateToPage = (
    cursor: string | undefined,
    targetPage: number,
    rememberCursor = false
  ): void => {
    void loadPage(cursor, targetPage)
      .then((loaded) => {
        if (!loaded || !rememberCursor) return
        setPageCursors((current) => {
          const next = current.slice(0, targetPage)
          next[targetPage] = cursor
          return next
        })
      })
      .catch(reportListingFailure)
  }

  return (
    <AccessibleDialog
      ariaLabelledby="history-dialog-title"
      onClose={closeDialog}
      closeOnEscape
      closeOnBackdrop={false}
      backdropClassName="history-dialog__backdrop"
      dialogClassName="history-dialog"
    >
      <header className="history-dialog__header">
        <h2 id="history-dialog-title">{t('workspace.storage.history')}</h2>
      </header>

      <div className="history-dialog__body">
        {error && (
          <div
            className="history-dialog__error"
            role="alert"
            dir={lang === 'ar' ? 'rtl' : 'ltr'}
            style={{ textAlign: 'start' }}
          >
            <p data-history-error-summary style={{ whiteSpace: 'pre-wrap' }}>
              {error.summary}
            </p>
            {error.technicalDetail ? (
              <p data-history-error-technical>
                <span>{t('workspace.history.action.technicalDetails')}</span>{' '}
                <code lang="en" dir="ltr">
                  {error.technicalDetail}
                </code>
              </p>
            ) : null}
          </div>
        )}

        {revisions.length === 0 ? (
          <p className="history-dialog__empty">
            {hasPagination ? t('workspace.history.pageEmpty') : t('workspace.history.empty')}
          </p>
        ) : (
          <div className="history-dialog__revisions">
            {revisions.map((revision) => (
              <article key={revision.metadataPath} className="history-dialog__revision">
                <span className="history-dialog__revision-path">
                  <strong>{revision.originalPath}</strong>
                  <small>
                    {new Date(revision.createdAt).toLocaleString(lang)} ·{' '}
                    <span data-history-reason>
                      {mappedCodeLabel(
                        revision.reason,
                        HISTORY_REASON_KEYS,
                        'workspace.history.reason.unknown'
                      )}
                    </span>{' '}
                    · {new Intl.NumberFormat(lang).format(Math.round(revision.size / 1024))}{' '}
                    <span lang="en" dir="ltr">
                      KiB
                    </span>
                  </small>
                </span>
                <span className="history-dialog__revision-actions">
                  <button
                    type="button"
                    className="orbitpm-lite-chrome-btn"
                    disabled={busy}
                    onClick={() =>
                      void run(HISTORY_ACTION_FAILURE_KEYS.preview, async () => {
                        setDiff(null)
                        const complete = await manager.preview(revision)
                        setPreview(
                          boundHistoryPreview(complete.xml, HISTORY_PREVIEW_MAX_CHARACTERS)
                        )
                      })
                    }
                  >
                    {t('workspace.history.preview')}
                  </button>
                  <button
                    type="button"
                    className="orbitpm-lite-chrome-btn"
                    disabled={busy}
                    onClick={() =>
                      void run(HISTORY_ACTION_FAILURE_KEYS.diff, async () => {
                        setPreview(null)
                        setDiff(await manager.diff(revision, currentXml(revision.originalPath)))
                      })
                    }
                  >
                    {t('workspace.history.diff')}
                  </button>
                  <button
                    type="button"
                    className="orbitpm-lite-chrome-btn"
                    disabled={busy || !onRestore}
                    onClick={() => {
                      if (!onRestore) return
                      void run(HISTORY_ACTION_FAILURE_KEYS.restore, async () => {
                        await handleRestoreResult(await onRestore(revision))
                      })
                    }}
                  >
                    {t('workspace.history.restore')}
                  </button>
                  <button
                    type="button"
                    className="orbitpm-lite-chrome-btn"
                    disabled={busy}
                    onClick={() =>
                      setRestoreCopy({
                        revision,
                        destination: revision.originalPath.replace(/\.bpmn$/i, '-restored.bpmn')
                      })
                    }
                  >
                    {t('workspace.history.restoreCopy')}
                  </button>
                </span>
              </article>
            ))}
          </div>
        )}

        {hasPagination && (
          <nav
            className="history-dialog__pagination"
            aria-label={t('workspace.history.pagination.label')}
          >
            <p aria-live="polite">
              {t('workspace.history.pagination.status', {
                page: numberFormatter.format(pageIndex + 1),
                count: numberFormatter.format(pageEntryCount)
              })}
            </p>
            <span className="history-dialog__pagination-actions">
              <button
                type="button"
                className="orbitpm-lite-chrome-btn"
                disabled={busy || listingBusy || pageIndex === 0}
                onClick={() =>
                  navigateToPage(pageCursors[pageIndex - 1], Math.max(0, pageIndex - 1))
                }
              >
                {t('workspace.history.pagination.previous')}
              </button>
              <button
                type="button"
                className="orbitpm-lite-chrome-btn"
                disabled={busy || listingBusy || nextCursor === undefined}
                onClick={() => {
                  if (nextCursor !== undefined) {
                    navigateToPage(nextCursor, pageIndex + 1, true)
                  }
                }}
              >
                {t('workspace.history.pagination.next')}
              </button>
            </span>
          </nav>
        )}

        {preview && (
          <>
            {previewOmittedCharacters > 0 && (
              <p
                className="history-dialog__warning"
                role="status"
                dir={lang === 'ar' ? 'rtl' : 'ltr'}
                style={{ margin: '14px 0 0' }}
              >
                {t('workspace.history.previewTruncated', {
                  shown: numberFormatter.format(preview.shownCodePoints),
                  omitted: numberFormatter.format(previewOmittedCharacters)
                })}
              </p>
            )}
            <pre
              className="history-dialog__preview"
              data-history-preview
              style={{ marginTop: previewOmittedCharacters > 0 ? 8 : 14 }}
            >
              {preview.text}
            </pre>
          </>
        )}

        {diff && (
          <div className="history-dialog__diff" style={{ marginTop: 14 }}>
            {!diff.aligned && (
              <p
                role="status"
                dir={lang === 'ar' ? 'rtl' : 'ltr'}
                style={{
                  margin: '0 0 8px',
                  textAlign: 'start',
                  fontFamily: 'inherit',
                  color: 'var(--orbitpm-muted)'
                }}
              >
                {t('workspace.history.diffBounded')}
              </p>
            )}
            {diff.truncated && (
              <div
                className="history-dialog__warning"
                role="alert"
                dir={lang === 'ar' ? 'rtl' : 'ltr'}
                style={{ marginBottom: 8, fontFamily: 'inherit' }}
              >
                <p style={{ margin: 0 }}>
                  {t('workspace.history.diffTruncated', {
                    rows: numberFormatter.format(diff.omitted.previewRows),
                    characters: numberFormatter.format(diff.omitted.previewCharacters),
                    hunks: numberFormatter.format(diff.omitted.hunks),
                    operations: numberFormatter.format(diff.omitted.operations)
                  })}
                </p>
                {(diff.omitted.oldInputCharacters > 0 ||
                  diff.omitted.newInputCharacters > 0 ||
                  diff.omitted.oldInputLines > 0 ||
                  diff.omitted.newInputLines > 0) && (
                  <p style={{ margin: '6px 0 0' }}>
                    {t('workspace.history.diffInputTruncated', {
                      oldCharacters: numberFormatter.format(diff.omitted.oldInputCharacters),
                      newCharacters: numberFormatter.format(diff.omitted.newInputCharacters),
                      oldLines: numberFormatter.format(diff.omitted.oldInputLines),
                      newLines: numberFormatter.format(diff.omitted.newInputLines)
                    })}
                  </p>
                )}
              </div>
            )}
            {diff.identical
              ? t('workspace.history.current')
              : diff.hunks.map((hunk, index) => (
                  <div key={`${hunk.oldStart}:${hunk.newStart}:${index}`} data-history-diff-hunk>
                    <div>
                      @@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@
                    </div>
                    {hunk.removed.map((line, lineIndex) => (
                      <div
                        key={`removed:${lineIndex}`}
                        data-history-diff-row
                        style={{ color: '#b42318' }}
                      >
                        - {line}
                      </div>
                    ))}
                    {hunk.added.map((line, lineIndex) => (
                      <div
                        key={`added:${lineIndex}`}
                        data-history-diff-row
                        style={{ color: '#067647' }}
                      >
                        + {line}
                      </div>
                    ))}
                  </div>
                ))}
          </div>
        )}
      </div>

      <footer className="history-dialog__footer">
        <button type="button" className="orbitpm-lite-chrome-btn" onClick={closeDialog}>
          {t('modal.cancel')}
        </button>
      </footer>
      <TextInputModal
        open={restoreCopy !== null}
        title={t('workspace.history.restoreCopy')}
        label={t('workspace.history.copyPrompt')}
        value={restoreCopy?.destination ?? ''}
        onChange={(destination) =>
          setRestoreCopy((current) => (current ? { ...current, destination } : null))
        }
        okLabel={t('workspace.history.restoreCopy')}
        cancelLabel={t('modal.cancel')}
        hint={
          restoreCopyDestination && !restoreCopyDestination.ok
            ? restoreCopyDestination.error
            : undefined
        }
        onOk={() => {
          if (!restoreCopy || !restoreCopyDestination?.ok) return
          const request = restoreCopy
          const destination = restoreCopyDestination.path
          setRestoreCopy(null)
          void run(HISTORY_ACTION_FAILURE_KEYS['restore-copy'], async () => {
            restoreCopyAbortRef.current?.abort()
            const controller = new AbortController()
            restoreCopyAbortRef.current = controller
            try {
              const outcome = onRestoreCopy
                ? await onRestoreCopy(request.revision, destination, controller.signal)
                : await manager.restoreAsCopy(request.revision, destination, controller.signal)
              if (outcome.status !== 'success') {
                throw new HistoryVisibleFailure({
                  summary: t('workspace.history.copyFailed', {
                    outcome: saveOutcomeLabel(outcome)
                  })
                })
              }
              await onChanged()
            } finally {
              if (restoreCopyAbortRef.current === controller) {
                restoreCopyAbortRef.current = null
              }
            }
          })
        }}
        onCancel={() => setRestoreCopy(null)}
      />
    </AccessibleDialog>
  )
}
