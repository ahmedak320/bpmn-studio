import { useCallback, useEffect, useState } from 'react'
import { AccessibleDialog } from '../common/AccessibleDialog'
import { TextInputModal } from '../common/prompt/TextInputModal'
import { t } from '../i18n'
import type { RestoreHistoryRevisionResult } from '../sessions/historyRestore'
import {
  type HistoryDiff,
  type HistoryPreview,
  type HistoryRevision,
  PortableHistoryManager
} from './history'

export type HistoryDialogRestoreResult = RestoreHistoryRevisionResult
export type HistoryDialogRestoreHandler = (
  revision: HistoryRevision
) => Promise<HistoryDialogRestoreResult>

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
  onClose: () => void
}

interface RestoreCopyRequest {
  revision: HistoryRevision
  destination: string
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

export function HistoryDialog({
  manager,
  currentXml,
  onChanged,
  onRestore,
  onClose
}: HistoryDialogProps): JSX.Element {
  const [revisions, setRevisions] = useState<HistoryRevision[]>([])
  const [preview, setPreview] = useState<HistoryPreview | null>(null)
  const [diff, setDiff] = useState<HistoryDiff | null>(null)
  const [restoreCopy, setRestoreCopy] = useState<RestoreCopyRequest | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const listing = await manager.listRevisions()
    setRevisions(listing.revisions)
    setError(
      listing.issues.length > 0 ? listing.issues.map((issue) => issue.message).join('\n') : null
    )
  }, [manager])

  useEffect(() => {
    void load()
  }, [load])

  const run = async (task: () => Promise<void>): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await task()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
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
      await load()
    } catch (cause) {
      refreshError ??= cause
    }
    return refreshError
  }

  const handleRestoreResult = async (result: HistoryDialogRestoreResult): Promise<void> => {
    if (result.status === 'restored') {
      const refreshError = await refreshAfterCommittedRestore()
      if (refreshError !== null) {
        throw new Error(
          `The revision was restored in storage, but the workspace could not be refreshed: ${errorMessage(refreshError)}`
        )
      }
      return
    }
    if (result.status === 'storage-restored-session-refresh-failed') {
      const refreshError = await refreshAfterCommittedRestore()
      const details = [result.error, refreshError]
        .filter((cause): cause is unknown => cause !== null)
        .map(errorMessage)
        .filter((message, index, messages) => messages.indexOf(message) === index)
        .join(' ')
      throw new Error(
        `The revision was restored in storage, but the open session could not be refreshed.${details ? ` ${details}` : ''}`
      )
    }
    if (result.status === 'failed') {
      throw result.error instanceof Error ? result.error : new Error(errorMessage(result.error))
    }
    throw new Error(
      `Restore did not complete (${result.outcome.status}${
        result.outcome.status === 'external-conflict' ? `: ${result.outcome.reason}` : ''
      }).`
    )
  }

  return (
    <AccessibleDialog
      ariaLabelledby="history-dialog-title"
      onClose={onClose}
      closeOnEscape
      closeOnBackdrop={false}
      backdropStyle={{
        position: 'fixed',
        inset: 0,
        zIndex: 10020,
        display: 'grid',
        placeItems: 'center',
        padding: 20,
        background: 'rgba(0,0,0,0.52)'
      }}
      dialogStyle={{
        width: 'min(920px, 96vw)',
        maxHeight: '90vh',
        overflow: 'auto',
        padding: 18,
        border: '1px solid var(--orbitpm-border)',
        borderRadius: 12,
        background: 'var(--orbitpm-panel-bg, var(--orbitpm-bg))',
        color: 'var(--orbitpm-fg)'
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 12
        }}
      >
        <h2 id="history-dialog-title" style={{ margin: 0, fontSize: 18 }}>
          {t('workspace.storage.history')}
        </h2>
        <button type="button" className="orbitpm-lite-chrome-btn" onClick={onClose}>
          {t('modal.cancel')}
        </button>
      </div>

      {error && (
        <pre
          role="alert"
          style={{
            whiteSpace: 'pre-wrap',
            color: '#c4322f',
            font: 'inherit',
            fontSize: 12
          }}
        >
          {error}
        </pre>
      )}

      {revisions.length === 0 ? (
        <p style={{ color: 'var(--orbitpm-muted)' }}>{t('workspace.history.empty')}</p>
      ) : (
        <div style={{ display: 'grid', gap: 8, marginTop: 14 }}>
          {revisions.map((revision) => (
            <article
              key={revision.id}
              style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(0, 1fr) auto',
                gap: 12,
                alignItems: 'center',
                padding: 10,
                border: '1px solid var(--orbitpm-border)',
                borderRadius: 8
              }}
            >
              <span style={{ minWidth: 0 }}>
                <strong style={{ display: 'block', overflowWrap: 'anywhere' }}>
                  {revision.originalPath}
                </strong>
                <small style={{ color: 'var(--orbitpm-muted)' }}>
                  {new Date(revision.createdAt).toLocaleString()} · {revision.reason} ·{' '}
                  {Math.round(revision.size / 1024)} KiB
                </small>
              </span>
              <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="orbitpm-lite-chrome-btn"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      setDiff(null)
                      setPreview(await manager.preview(revision))
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
                    void run(async () => {
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
                    void run(async () => {
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

      {preview && (
        <pre
          style={{
            marginTop: 14,
            maxHeight: 320,
            overflow: 'auto',
            whiteSpace: 'pre-wrap',
            direction: 'ltr',
            textAlign: 'left',
            padding: 12,
            borderRadius: 8,
            background: 'rgba(127,127,127,0.09)'
          }}
        >
          {preview.xml}
        </pre>
      )}

      {diff && (
        <div
          style={{
            marginTop: 14,
            maxHeight: 320,
            overflow: 'auto',
            direction: 'ltr',
            textAlign: 'left',
            padding: 12,
            borderRadius: 8,
            background: 'rgba(127,127,127,0.09)',
            fontFamily: 'ui-monospace, monospace',
            fontSize: 12
          }}
        >
          {diff.identical
            ? t('workspace.history.current')
            : diff.hunks.map((hunk, index) => (
                <div key={`${hunk.oldStart}:${hunk.newStart}:${index}`}>
                  <div>
                    @@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@
                  </div>
                  {hunk.removed.map((line, lineIndex) => (
                    <div key={`removed:${lineIndex}`} style={{ color: '#b42318' }}>
                      - {line}
                    </div>
                  ))}
                  {hunk.added.map((line, lineIndex) => (
                    <div key={`added:${lineIndex}`} style={{ color: '#067647' }}>
                      + {line}
                    </div>
                  ))}
                </div>
              ))}
        </div>
      )}
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
        onOk={() => {
          if (!restoreCopy) return
          const request = restoreCopy
          setRestoreCopy(null)
          void run(async () => {
            const outcome = await manager.restoreAsCopy(
              request.revision,
              request.destination.trim()
            )
            if (outcome.status !== 'success') {
              throw new Error(`Restore did not complete (${outcome.status}).`)
            }
            await onChanged()
          })
        }}
        onCancel={() => setRestoreCopy(null)}
      />
    </AccessibleDialog>
  )
}
