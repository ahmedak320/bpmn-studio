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
  /**
   * Aborted before a preview is switched, closed, or unmounted. The production
   * viewer is also destroyed because bpmn-js importXML has no signal argument.
   */
  signal: AbortSignal
}) => WorkspaceImportPreviewViewer

export interface WorkspaceImportAutoLayoutPreviewProps {
  readonly artifacts: readonly WorkspaceImportAutoLayoutPreviewArtifact[]
  /**
   * Test/host injection point. Production callers should omit this so the
   * read-only bpmn-js NavigatedViewer is used.
   */
  readonly createViewer?: WorkspaceImportPreviewViewerFactory
}

export const WORKSPACE_IMPORT_AUTO_LAYOUT_PAGE_SIZE = 8
export const WORKSPACE_IMPORT_AUTO_LAYOUT_MAX_MOUNTED_VIEWERS = 1
export const WORKSPACE_IMPORT_TECHNICAL_DETAIL_MAX_CODE_POINTS = 512

export interface BoundedWorkspaceImportTechnicalEvidence {
  readonly text: string
  readonly truncated: boolean
}

/**
 * Bound untrusted parser/viewer diagnostics without splitting UTF-16
 * surrogate pairs or allocating an array proportional to attacker input.
 */
export function boundedWorkspaceImportTechnicalEvidence(
  value: unknown
): BoundedWorkspaceImportTechnicalEvidence | undefined {
  if (value === null || value === undefined) return undefined
  let raw: string
  try {
    raw = String(value instanceof Error ? value.message : value)
  } catch {
    return undefined
  }
  if (raw.length === 0) return undefined

  const codePoints: string[] = []
  const iterator = raw[Symbol.iterator]()
  for (let index = 0; index < WORKSPACE_IMPORT_TECHNICAL_DETAIL_MAX_CODE_POINTS; index += 1) {
    const next = iterator.next()
    if (next.done) return { text: codePoints.join(''), truncated: false }
    codePoints.push(next.value)
  }
  if (iterator.next().done) return { text: codePoints.join(''), truncated: false }

  codePoints[WORKSPACE_IMPORT_TECHNICAL_DETAIL_MAX_CODE_POINTS - 1] = '…'
  return { text: codePoints.join(''), truncated: true }
}

type PreviewPhase =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly warningCount: number }
  | {
      readonly status: 'error'
      readonly technicalEvidence?: BoundedWorkspaceImportTechnicalEvidence
    }

const createNavigatedViewer: WorkspaceImportPreviewViewerFactory = ({ container }) =>
  new BpmnNavigatedViewer({ container }) as unknown as WorkspaceImportPreviewViewer

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

function ActiveArtifactDiagram({
  artifact,
  createViewer
}: {
  artifact: WorkspaceImportAutoLayoutPreviewArtifact
  createViewer: WorkspaceImportPreviewViewerFactory
}): JSX.Element {
  const reactId = useId()
  const statusId = `workspace-import-layout-preview-status-${reactId}`
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  const [phase, setPhase] = useState<PreviewPhase>({ status: 'loading' })

  useEffect(() => {
    if (!container) return

    const controller = new AbortController()
    let active = true
    let viewer: WorkspaceImportPreviewViewer | undefined
    let destroyed = false
    const destroy = (): void => {
      if (!viewer || destroyed) return
      destroyed = true
      try {
        viewer.destroy()
      } catch {
        // Cleanup is best-effort; a broken third-party destroy must not prevent
        // the review from closing or switching to another artifact.
      }
    }
    const cancel = (): void => {
      active = false
      controller.abort()
      destroy()
    }

    setPhase({ status: 'loading' })

    try {
      viewer = createViewer({ container, signal: controller.signal })
    } catch (error) {
      setPhase({
        status: 'error',
        technicalEvidence: boundedWorkspaceImportTechnicalEvidence(error)
      })
      controller.abort()
      return cancel
    }

    void Promise.resolve()
      .then(() => {
        if (!active || controller.signal.aborted) return undefined
        return viewer!.importXML(artifact.reviewedXml)
      })
      .then((result) => {
        if (!active || controller.signal.aborted || result === undefined) return
        viewer!.get('canvas').zoom('fit-viewport')
        if (!active || controller.signal.aborted) return
        setPhase({ status: 'ready', warningCount: result.warnings?.length ?? 0 })
      })
      .catch((error: unknown) => {
        if (!active || controller.signal.aborted) return
        controller.abort()
        destroy()
        setPhase({
          status: 'error',
          technicalEvidence: boundedWorkspaceImportTechnicalEvidence(error)
        })
      })

    return cancel
  }, [artifact.reviewedXml, container, createViewer])

  const previewLabel = `${t('spreadsheet.preview.title')}: ${artifact.destinationPath}`

  return (
    <div
      className="workspace-import-layout-preview__active"
      aria-describedby={statusId}
      data-workspace-import-active-layout-preview={artifact.artifactId}
    >
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
          <>
            <p role="alert" aria-live="assertive" data-workspace-import-preview-error-summary>
              {t('workspaceImportReview.autoLayoutPreview.failed')}
            </p>
            {phase.technicalEvidence ? (
              <details className="workspace-import-layout-preview__technical">
                <summary>{t('workspaceImportReview.technicalEvidence')}</summary>
                {phase.technicalEvidence.truncated ? (
                  <p data-workspace-import-technical-truncation>
                    {t('workspaceImportReview.technicalEvidenceTruncated', {
                      limit: WORKSPACE_IMPORT_TECHNICAL_DETAIL_MAX_CODE_POINTS
                    })}
                  </p>
                ) : null}
                <code dir="auto" data-workspace-import-preview-error-technical>
                  {phase.technicalEvidence.text}
                </code>
              </details>
            ) : null}
          </>
        ) : (
          <p role="status" aria-live="polite">
            {phase.warningCount > 0
              ? t('workspaceImportReview.autoLayoutPreview.warnings', {
                  count: phase.warningCount
                })
              : t('workspaceImportReview.autoLayoutPreview.ready')}
          </p>
        )}
      </div>
    </div>
  )
}

function ArtifactPreviewCard({
  artifact,
  index,
  total,
  active,
  onToggle,
  createViewer
}: {
  artifact: WorkspaceImportAutoLayoutPreviewArtifact
  index: number
  total: number
  active: boolean
  onToggle: () => void
  createViewer: WorkspaceImportPreviewViewerFactory
}): JSX.Element {
  const reactId = useId()
  const titleId = `workspace-import-layout-preview-title-${reactId}`
  const evidenceId = `workspace-import-layout-preview-evidence-${reactId}`
  const previewId = `workspace-import-layout-preview-active-${reactId}`
  const title = t('workspaceImportReview.artifact', {
    index: index + 1,
    name: artifact.destinationPath
  })

  return (
    <article
      className="workspace-import-layout-preview__artifact"
      role="listitem"
      aria-labelledby={titleId}
      aria-describedby={evidenceId}
      aria-posinset={index + 1}
      aria-setsize={total}
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
      <button
        type="button"
        className="orbitpm-lite-chrome-btn"
        aria-expanded={active}
        aria-controls={previewId}
        aria-label={t(
          active
            ? 'workspaceImportReview.autoLayoutPreview.closeFor'
            : 'workspaceImportReview.autoLayoutPreview.openFor',
          { path: artifact.destinationPath }
        )}
        onClick={onToggle}
      >
        {active
          ? t('workspaceImportReview.autoLayoutPreview.close')
          : t('workspaceImportReview.autoLayoutPreview.open')}
      </button>
      <div id={previewId}>
        {active ? (
          <ActiveArtifactDiagram
            key={artifact.artifactId}
            artifact={artifact}
            createViewer={createViewer}
          />
        ) : null}
      </div>
    </article>
  )
}

/**
 * Present sealed post-auto-layout XML as bounded metadata pages. Diagram
 * rendering is explicit and on-demand, and exactly one read-only viewer may be
 * mounted at a time.
 */
export function WorkspaceImportAutoLayoutPreview({
  artifacts,
  createViewer = createNavigatedViewer
}: WorkspaceImportAutoLayoutPreviewProps): JSX.Element {
  useLang()
  const reactId = useId()
  const headingId = `workspace-import-layout-preview-heading-${reactId}`
  const listId = `workspace-import-layout-preview-list-${reactId}`
  const [requestedPage, setRequestedPage] = useState(0)
  const [activeArtifactId, setActiveArtifactId] = useState<string>()
  const pageCount = Math.max(
    1,
    Math.ceil(artifacts.length / WORKSPACE_IMPORT_AUTO_LAYOUT_PAGE_SIZE)
  )
  const page = Math.min(requestedPage, pageCount - 1)
  const start = page * WORKSPACE_IMPORT_AUTO_LAYOUT_PAGE_SIZE
  const end = Math.min(artifacts.length, start + WORKSPACE_IMPORT_AUTO_LAYOUT_PAGE_SIZE)
  const visibleArtifacts = artifacts.slice(start, end)

  const changePage = (nextPage: number): void => {
    setActiveArtifactId(undefined)
    setRequestedPage(Math.max(0, Math.min(nextPage, pageCount - 1)))
  }

  return (
    <section className="workspace-import-layout-preview" aria-labelledby={headingId}>
      <h3 id={headingId}>{t('workspaceImportReview.autoLayoutPreview.title')}</h3>
      <p className="workspace-import-layout-preview__intro">
        {t('workspaceImportReview.autoLayoutPreview.intro')}
      </p>
      {artifacts.length === 0 ? (
        <p className="workspace-import-layout-preview__empty">{t('workspaceImportReview.none')}</p>
      ) : (
        <>
          <div
            id={listId}
            className="workspace-import-layout-preview__list"
            role="list"
            aria-label={t('workspaceImportReview.autoLayoutPreview.title')}
          >
            {visibleArtifacts.map((artifact, localIndex) => {
              const index = start + localIndex
              const active = artifact.artifactId === activeArtifactId
              return (
                <ArtifactPreviewCard
                  key={artifact.artifactId}
                  artifact={artifact}
                  index={index}
                  total={artifacts.length}
                  active={active}
                  onToggle={() => setActiveArtifactId(active ? undefined : artifact.artifactId)}
                  createViewer={createViewer}
                />
              )
            })}
          </div>
          {pageCount > 1 ? (
            <nav
              className="workspace-import-layout-preview__pagination"
              aria-label={t('workspaceImportReview.autoLayoutPreview.pagination')}
            >
              <p role="status" aria-live="polite">
                {t('workspaceImportReview.pagination.status', {
                  start: start + 1,
                  end,
                  total: artifacts.length,
                  page: page + 1,
                  pages: pageCount
                })}
              </p>
              <div>
                <button
                  type="button"
                  className="orbitpm-lite-chrome-btn"
                  disabled={page === 0}
                  aria-controls={listId}
                  onClick={() => changePage(page - 1)}
                >
                  {t('workspaceImportReview.pagination.previous')}
                </button>
                <button
                  type="button"
                  className="orbitpm-lite-chrome-btn"
                  disabled={page + 1 >= pageCount}
                  aria-controls={listId}
                  onClick={() => changePage(page + 1)}
                >
                  {t('workspaceImportReview.pagination.next')}
                </button>
              </div>
            </nav>
          ) : null}
        </>
      )}
    </section>
  )
}
