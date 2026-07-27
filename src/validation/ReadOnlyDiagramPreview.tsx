import { useEffect, useId, useRef, useState } from 'react'
import BpmnNavigatedViewer from 'bpmn-js/lib/NavigatedViewer'
import 'bpmn-js/dist/assets/diagram-js.css'
import 'bpmn-js/dist/assets/bpmn-js.css'
import 'bpmn-js/dist/assets/bpmn-font/css/bpmn-embedded.css'

import { t, type Key } from '../i18n'
import { boundedValidationTechnicalDetail } from './technicalEvidence'

export interface ReadOnlyDiagramPreviewViewer {
  importXML(xml: string): Promise<{ warnings?: readonly unknown[] }>
  get(service: 'canvas'): {
    zoom(mode: 'fit-viewport'): unknown
  }
  destroy(): void
}

export type ReadOnlyDiagramPreviewViewerFactory = (options: {
  container: HTMLElement
}) => ReadOnlyDiagramPreviewViewer

export type ReadOnlyDiagramPreviewStatus =
  | { status: 'loading' }
  | { status: 'ready'; warningCount: number }
  | { status: 'error'; message: string }

export interface ReadOnlyDiagramPreviewProps {
  /** Exact XML rendered by an editing-service-free bpmn-js viewer. */
  xml: string
  /** Visible heading and accessible name for this specific artifact. */
  title: string
  ariaLabel?: string
  className?: string
  onStatusChange?(status: ReadOnlyDiagramPreviewStatus): void
  /**
   * Test/host injection point. Production callers omit this to guarantee the
   * read-only NavigatedViewer implementation.
   */
  createViewer?: ReadOnlyDiagramPreviewViewerFactory
}

function translate(key: string, variables?: Record<string, string | number>): string {
  return t(key as Key, variables)
}

const createNavigatedViewer: ReadOnlyDiagramPreviewViewerFactory = ({ container }) =>
  new BpmnNavigatedViewer({ container }) as unknown as ReadOnlyDiagramPreviewViewer

/**
 * Reusable read-only BPMN rendering surface for Source auto-layout, reviewed
 * single-file imports, and other artifact previews. It has no modeling,
 * command-stack, save, or serialization authority.
 */
export function ReadOnlyDiagramPreview({
  xml,
  title,
  ariaLabel = title,
  className,
  onStatusChange,
  createViewer = createNavigatedViewer
}: ReadOnlyDiagramPreviewProps): JSX.Element {
  const reactId = useId()
  const headingId = `orbitpm-read-only-preview-heading-${reactId}`
  const statusId = `orbitpm-read-only-preview-status-${reactId}`
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  const [phase, setPhase] = useState<ReadOnlyDiagramPreviewStatus>({ status: 'loading' })
  const statusChangeRef = useRef(onStatusChange)

  useEffect(() => {
    statusChangeRef.current = onStatusChange
  }, [onStatusChange])

  useEffect(() => {
    if (!container) return
    let active = true
    let destroyed = false
    let viewer: ReadOnlyDiagramPreviewViewer | undefined
    const publish = (next: ReadOnlyDiagramPreviewStatus): void => {
      if (!active) return
      setPhase(next)
      statusChangeRef.current?.(next)
    }
    const destroy = (): void => {
      if (!viewer || destroyed) return
      destroyed = true
      try {
        viewer.destroy()
      } catch {
        // Third-party cleanup is best-effort and must not mask render status.
      }
    }

    publish({ status: 'loading' })
    try {
      viewer = createViewer({ container })
    } catch (error) {
      publish({ status: 'error', message: boundedValidationTechnicalDetail(error) ?? '' })
      return () => {
        active = false
        destroy()
      }
    }

    void Promise.resolve()
      .then(() => viewer!.importXML(xml))
      .then(({ warnings = [] }) => {
        if (!active) return
        viewer!.get('canvas').zoom('fit-viewport')
        publish({ status: 'ready', warningCount: warnings.length })
      })
      .catch((error: unknown) => {
        if (!active) return
        destroy()
        publish({ status: 'error', message: boundedValidationTechnicalDetail(error) ?? '' })
      })

    return () => {
      active = false
      destroy()
    }
  }, [container, createViewer, xml])

  return (
    <section
      className={['orbitpm-read-only-preview', className].filter(Boolean).join(' ')}
      aria-labelledby={headingId}
      aria-describedby={statusId}
    >
      <h3 id={headingId}>{title}</h3>
      <div
        ref={setContainer}
        className="orbitpm-read-only-preview__canvas"
        role="img"
        aria-label={ariaLabel}
        aria-busy={phase.status === 'loading'}
      />
      <div id={statusId} className="orbitpm-read-only-preview__status">
        {phase.status === 'loading' ? (
          <p role="status" aria-live="polite">
            {translate('sourceEditor.diagramPreview.loading')}
          </p>
        ) : phase.status === 'error' ? (
          <>
            <p role="alert" aria-live="assertive" data-read-only-preview-error-summary>
              {translate('sourceEditor.diagramPreview.failed')}
            </p>
            {phase.message ? (
              <p
                className="orbitpm-read-only-preview__technical"
                data-read-only-preview-error-technical
              >
                <span>{translate('sourceEditor.action.technicalDetails')}</span>{' '}
                <code lang="en" dir="ltr">
                  {phase.message}
                </code>
              </p>
            ) : null}
          </>
        ) : (
          <p role="status" aria-live="polite">
            {phase.warningCount > 0
              ? translate('sourceEditor.diagramPreview.warnings', {
                  count: phase.warningCount
                })
              : translate('sourceEditor.diagramPreview.ready')}
          </p>
        )}
      </div>
    </section>
  )
}

export default ReadOnlyDiagramPreview
