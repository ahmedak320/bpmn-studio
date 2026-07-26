import { useCallback, useEffect, useState } from 'react'
import { t } from '../i18n'
import {
  type HistoryDiff,
  type HistoryPreview,
  type HistoryRevision,
  PortableHistoryManager
} from './history'

export interface HistoryDialogProps {
  manager: PortableHistoryManager
  currentXml: (path: string) => string | undefined
  onChanged: () => void | Promise<void>
  onClose: () => void
}

export function HistoryDialog({
  manager,
  currentXml,
  onChanged,
  onClose
}: HistoryDialogProps): JSX.Element {
  const [revisions, setRevisions] = useState<HistoryRevision[]>([])
  const [preview, setPreview] = useState<HistoryPreview | null>(null)
  const [diff, setDiff] = useState<HistoryDiff | null>(null)
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

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="history-dialog-title"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10020,
        display: 'grid',
        placeItems: 'center',
        padding: 20,
        background: 'rgba(0,0,0,0.52)'
      }}
    >
      <section
        style={{
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
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        const result = await manager.restore(revision)
                        if (result.outcome.status !== 'success') {
                          throw new Error(`Restore did not complete (${result.outcome.status}).`)
                        }
                        await onChanged()
                        await load()
                      })
                    }
                  >
                    {t('workspace.history.restore')}
                  </button>
                  <button
                    type="button"
                    className="orbitpm-lite-chrome-btn"
                    disabled={busy}
                    onClick={() => {
                      const destination = window.prompt(
                        t('workspace.history.copyPrompt'),
                        revision.originalPath.replace(/\.bpmn$/i, '-restored.bpmn')
                      )
                      if (!destination) return
                      void run(async () => {
                        const outcome = await manager.restoreAsCopy(revision, destination)
                        if (outcome.status !== 'success') {
                          throw new Error(`Restore did not complete (${outcome.status}).`)
                        }
                        await onChanged()
                      })
                    }}
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
      </section>
    </div>
  )
}
