import { useEffect, useId, useState } from 'react'
import BpmnNavigatedViewer from 'bpmn-js/lib/NavigatedViewer'
import 'bpmn-js/dist/assets/diagram-js.css'
import 'bpmn-js/dist/assets/bpmn-js.css'
import 'bpmn-js/dist/assets/bpmn-font/css/bpmn-embedded.css'
import { t } from '../i18n'
import { useLang } from '../i18n/useLang'
import './WorkspaceImportAutoLayoutPreview.css'

/**
 * The exact, already-reviewed artifact presented to the user. Keeping this
 * contract separate from the transaction model makes it difficult for a
 * read-only preview to accidentally acquire write or confirmation authority.
 */
export interface WorkspaceImportAutoLayoutPreviewArtifact {
  readonly artifactId: string
  readonly sourceId: string
  readonly sourceName: string
  readonly sourcePath?: string
  readonly destinationPath: string
  readonly reviewedXml: string
}

export interface WorkspaceImportPreviewViewer {
  importXML(xml: string): Promise<{ warnings?: readonly unknown[] }>
  get(service: 'canvas'): {
    zoom(mode: 'fit-viewport'): unknown
  }
  destroy(): void
}

export type WorkspaceImportPreviewViewerFactory = (options: {
  container: HTMLElement
}) => WorkspaceImportPreviewViewer

export interface WorkspaceImportAutoLayoutPreviewProps {
  readonly artifacts: readonly WorkspaceImportAutoLayoutPreviewArtifact[]
  /**
   * Test/host injection point. Production callers should omit this so the
   * read-only bpmn-js NavigatedViewer is used.
   */
  readonly createViewer?: WorkspaceImportPreviewViewerFactory
}

type PreviewPhase =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly warningCount: number }
  | { readonly status: 'error'; readonly message: string }

const createNavigatedViewer: WorkspaceImportPreviewViewerFactory = ({ container }) =>
  new BpmnNavigatedViewer({ container }) as unknown as WorkspaceImportPreviewViewer

function errorMessage(value: unknown): string {
  if (value instanceof Error && value.message.trim()) return value.message
  return String(value)
}

function EvidenceRow({
  label,
  value,
  autoDirection = false
}: {
  label: string
  value: string
  autoDirection?: boolean
}): JSX.Element {
  return (
    <>
      <dt>{label}</dt>
      <dd>{autoDirection ? <span dir="auto">{value}</span> : <code dir="ltr">{value}</code>}</dd>
    </>
  )
}

function ArtifactPreview({
  artifact,
  index,
  createViewer
}: {
  artifact: WorkspaceImportAutoLayoutPreviewArtifact
  index: number
  createViewer: WorkspaceImportPreviewViewerFactory
}): JSX.Element {
  const reactId = useId()
  const titleId = `workspace-import-layout-preview-title-${reactId}`
  const evidenceId = `workspace-import-layout-preview-evidence-${reactId}`
  const statusId = `workspace-import-layout-preview-status-${reactId}`
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  const [phase, setPhase] = useState<PreviewPhase>({ status: 'loading' })

  useEffect(() => {
    if (!container) return

    let active = true
    let viewer: WorkspaceImportPreviewViewer | undefined
    let destroyed = false
    const destroy = (): void => {
      if (!viewer || destroyed) return
      destroyed = true
      try {
        viewer.destroy()
      } catch {
        // Cleanup is best-effort; a broken third-party destroy must not mask
        // the import result or prevent React from unmounting the review.
      }
    }

    setPhase({ status: 'loading' })

    try {
      viewer = createViewer({ container })
    } catch (error) {
      setPhase({ status: 'error', message: errorMessage(error) })
      return () => {
        active = false
        destroy()
      }
    }

    void Promise.resolve()
      .then(() => viewer!.importXML(artifact.reviewedXml))
      .then(({ warnings = [] }) => {
        if (!active) return
        viewer!.get('canvas').zoom('fit-viewport')
        if (!active) return
        setPhase({ status: 'ready', warningCount: warnings.length })
      })
      .catch((error: unknown) => {
        if (!active) return
        destroy()
        setPhase({ status: 'error', message: errorMessage(error) })
      })

    return () => {
      active = false
      destroy()
    }
  }, [artifact.reviewedXml, container, createViewer])

  const title = t('workspaceImportReview.artifact', {
    index: index + 1,
    name: artifact.destinationPath
  })
  const previewLabel = `${t('spreadsheet.preview.title')}: ${artifact.destinationPath}`

  return (
    <article
      className="workspace-import-layout-preview__artifact"
      aria-labelledby={titleId}
      aria-describedby={`${evidenceId} ${statusId}`}
    >
      <h4 id={titleId}>{title}</h4>

      <dl id={evidenceId} className="workspace-import-layout-preview__evidence">
        <EvidenceRow
          label={t('workspaceImportReview.sourceName')}
          value={artifact.sourceName}
          autoDirection
        />
        <EvidenceRow label={t('workspaceImportReview.sourceId')} value={artifact.sourceId} />
        {artifact.sourcePath === undefined ? null : (
          <EvidenceRow label={t('workspaceImportReview.sourcePath')} value={artifact.sourcePath} />
        )}
        <EvidenceRow label={t('workspaceImportReview.artifactId')} value={artifact.artifactId} />
        <EvidenceRow
          label={t('workspaceImportReview.destinationPath')}
          value={artifact.destinationPath}
        />
      </dl>

      <div
        ref={setContainer}
        className="workspace-import-layout-preview__canvas"
        role="img"
        aria-label={previewLabel}
        aria-busy={phase.status === 'loading'}
      />

      <div id={statusId} className="workspace-import-layout-preview__status">
        {phase.status === 'loading' ? (
          <p role="status" aria-live="polite">
            {t('editor.loadingDiagram')}
          </p>
        ) : phase.status === 'error' ? (
          <p role="alert" aria-live="assertive">
            {t('alert.import.failed', { error: phase.message })}
          </p>
        ) : (
          <p role="status" aria-live="polite">
            {phase.warningCount > 0
              ? `${t('workspaceImportReview.warnings')}: ${phase.warningCount}`
              : t('workspaceImportReview.status.ready')}
          </p>
        )}
      </div>
    </article>
  )
}

/**
 * Render the sealed, post-auto-layout XML without serializing, editing, or
 * otherwise mutating it. Every artifact gets an isolated viewer lifecycle so
 * one failed diagram does not hide the remaining review evidence.
 */
export function WorkspaceImportAutoLayoutPreview({
  artifacts,
  createViewer = createNavigatedViewer
}: WorkspaceImportAutoLayoutPreviewProps): JSX.Element {
  useLang()
  const reactId = useId()
  const headingId = `workspace-import-layout-preview-heading-${reactId}`

  return (
    <section className="workspace-import-layout-preview" aria-labelledby={headingId}>
      <h3 id={headingId}>{t('spreadsheet.preview.title')}</h3>
      {artifacts.length === 0 ? (
        <p className="workspace-import-layout-preview__empty">{t('workspaceImportReview.none')}</p>
      ) : (
        <div className="workspace-import-layout-preview__list">
          {artifacts.map((artifact, index) => (
            <ArtifactPreview
              key={`${artifact.artifactId}:${index}`}
              artifact={artifact}
              index={index}
              createViewer={createViewer}
            />
          ))}
        </div>
      )}
    </section>
  )
}
