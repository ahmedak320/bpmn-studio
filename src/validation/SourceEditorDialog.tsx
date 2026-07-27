import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AccessibleDialog } from '../common/AccessibleDialog'
import { t, type Key } from '../i18n'
import { useLang } from '../i18n/useLang'
import { mergeValidationSummaries, type ValidationSummary } from './contracts'
import { evaluateValidationPolicy } from './policy'
import { validateUnknownExtensionPreservation } from './extensions'
import {
  ReadOnlyDiagramPreview,
  type ReadOnlyDiagramPreviewStatus,
  type ReadOnlyDiagramPreviewViewerFactory
} from './ReadOnlyDiagramPreview'
import { SourceDiffPreview } from './SourceDiffPreview'
import { diffXmlLines } from './sourceDiff'
import { boundedValidationTechnicalDetail } from './technicalEvidence'
import { ValidationIssueList } from './ValidationCenter'

function translate(key: string, variables?: Record<string, string | number>): string {
  return t(key as Key, variables)
}

export interface SourceEditorDialogProps {
  open: boolean
  originalXml: string
  validate: (xml: string, requireDi: boolean) => Promise<ValidationSummary>
  apply: (xml: string, signal: AbortSignal) => Promise<void | SourceEditorApplyResult>
  autoLayout: (xml: string) => Promise<string>
  onClose: () => void
  /** Test/embedding seam; production uses the read-only NavigatedViewer. */
  createDiagramPreviewViewer?: ReadOnlyDiagramPreviewViewerFactory
}

export type SourceEditorApplyResult =
  { status: 'applied' } | { status: 'cancelled' } | { status: 'blocked'; message?: string }

interface PreviewResult {
  xml: string
  summary: ValidationSummary
}

interface SourceEditorVisibleError {
  summary: string
  technicalDetail?: string
}

function caughtActionError(summaryKey: Key, caught: unknown): SourceEditorVisibleError {
  const technicalDetail = boundedValidationTechnicalDetail(caught)
  return {
    summary: t(summaryKey),
    ...(technicalDetail ? { technicalDetail } : {})
  }
}

export function SourceEditorDialog({
  open,
  originalXml,
  validate,
  apply,
  autoLayout,
  onClose,
  createDiagramPreviewViewer
}: SourceEditorDialogProps): JSX.Element | null {
  const lang = useLang()
  const headingRef = useRef<HTMLHeadingElement | null>(null)
  const applyAbortRef = useRef<AbortController | null>(null)
  const [draft, setDraft] = useState(originalXml)
  const [preview, setPreview] = useState<PreviewResult | null>(null)
  const [busy, setBusy] = useState<'preview' | 'apply' | 'layout' | null>(null)
  const [error, setError] = useState<SourceEditorVisibleError | null>(null)
  const [layoutCandidate, setLayoutCandidate] = useState<string | null>(null)
  const [layoutRenderStatus, setLayoutRenderStatus] =
    useState<ReadOnlyDiagramPreviewStatus['status']>('loading')

  useEffect(() => {
    applyAbortRef.current?.abort()
    applyAbortRef.current = null
    if (!open) {
      return
    }
    setDraft(originalXml)
    setPreview(null)
    setError(null)
    setLayoutCandidate(null)
    setLayoutRenderStatus('loading')
  }, [open, originalXml])

  useEffect(
    () => () => {
      applyAbortRef.current?.abort()
      applyAbortRef.current = null
    },
    []
  )

  const diff = useMemo(() => diffXmlLines(originalXml, draft), [draft, originalXml])
  const layoutDiff = useMemo(
    () => (layoutCandidate ? diffXmlLines(draft, layoutCandidate) : null),
    [draft, layoutCandidate]
  )

  const previewXml = useCallback(
    async (candidate: string, requireDi: boolean): Promise<PreviewResult> => {
      const modelSummary = await validate(candidate, requireDi)
      const preservationSummary = modelSummary.xmlWellFormed
        ? await validateUnknownExtensionPreservation(originalXml, candidate)
        : null
      return {
        xml: candidate,
        summary: preservationSummary
          ? mergeValidationSummaries(modelSummary, preservationSummary)
          : modelSummary
      }
    },
    [originalXml, validate]
  )

  const handlePreview = useCallback(async () => {
    setBusy('preview')
    setError(null)
    try {
      setPreview(await previewXml(draft, false))
    } catch (caught) {
      setError(caughtActionError('sourceEditor.action.previewFailed', caught))
    } finally {
      setBusy(null)
    }
  }, [draft, previewXml])

  const missingDi =
    preview?.xml === draft &&
    preview.summary.issues.some(
      (issue) => issue.code === 'di.process-missing' || issue.code === 'bpmnlint.no-bpmndi'
    )
  const currentDecision =
    preview?.xml === draft ? evaluateValidationPolicy(preview.summary, 'apply-editor') : null
  const layoutDecision =
    layoutCandidate && preview?.xml === layoutCandidate
      ? evaluateValidationPolicy(preview.summary, 'apply-editor')
      : null

  const handleLayoutPreview = useCallback(async () => {
    setBusy('layout')
    setError(null)
    try {
      const candidate = await autoLayout(draft)
      const checked = await previewXml(candidate, true)
      setLayoutRenderStatus('loading')
      setLayoutCandidate(candidate)
      setPreview(checked)
    } catch (caught) {
      setError(caughtActionError('sourceEditor.action.layoutFailed', caught))
    } finally {
      setBusy(null)
    }
  }, [autoLayout, draft, previewXml])

  const acceptLayout = useCallback(() => {
    if (
      !layoutCandidate ||
      layoutRenderStatus !== 'ready' ||
      layoutDiff?.truncated !== false ||
      layoutDecision?.allowed !== true
    )
      return
    setDraft(layoutCandidate)
    setLayoutCandidate(null)
    setLayoutRenderStatus('loading')
  }, [layoutCandidate, layoutDecision, layoutDiff, layoutRenderStatus])

  const handleLayoutRenderStatus = useCallback((status: ReadOnlyDiagramPreviewStatus) => {
    setLayoutRenderStatus(status.status)
  }, [])

  const handleApply = useCallback(async () => {
    if (diff.truncated) {
      setError({ summary: translate('sourceEditor.diffTruncated') })
      return
    }
    setBusy('apply')
    setError(null)
    const controller = new AbortController()
    applyAbortRef.current?.abort()
    applyAbortRef.current = controller
    try {
      const checked = await previewXml(draft, true)
      if (controller.signal.aborted) return
      setPreview(checked)
      if (
        checked.summary.issues.some(
          (issue) => issue.code === 'di.process-missing' || issue.code === 'bpmnlint.no-bpmndi'
        )
      ) {
        setError({ summary: translate('sourceEditor.missingDi') })
        return
      }
      const decision = evaluateValidationPolicy(checked.summary, 'apply-editor')
      if (!decision.allowed || checked.summary.blockingErrors > 0) {
        setError({
          summary:
            decision.reason === 'unsafe-preservation-loss'
              ? translate('sourceEditor.preservationBlocked')
              : translate('sourceEditor.invalidBlocked')
        })
        return
      }
      const outcome = await apply(draft, controller.signal)
      if (controller.signal.aborted) return
      if (outcome?.status === 'cancelled') return
      if (outcome?.status === 'blocked') {
        const technicalDetail = boundedValidationTechnicalDetail(outcome.message)
        setError({
          summary: translate('sourceEditor.invalidBlocked'),
          ...(technicalDetail ? { technicalDetail } : {})
        })
        return
      }
      onClose()
    } catch (caught) {
      if (controller.signal.aborted) return
      setError(caughtActionError('sourceEditor.action.applyFailed', caught))
    } finally {
      if (applyAbortRef.current === controller) applyAbortRef.current = null
      setBusy(null)
    }
  }, [apply, diff.truncated, draft, onClose, previewXml])

  if (!open) return null

  return (
    <AccessibleDialog
      backdropClassName="orbitpm-validation__backdrop"
      dialogClassName="orbitpm-source-editor"
      ariaLabelledby="orbitpm-source-editor-title"
      dir={lang === 'ar' ? 'rtl' : 'ltr'}
      onClose={onClose}
      closeOnEscape={busy === null}
      closeOnBackdrop={false}
      initialFocusRef={headingRef}
    >
      <header className="orbitpm-validation__header">
        <div>
          <h2 id="orbitpm-source-editor-title" ref={headingRef} tabIndex={-1}>
            {translate('sourceEditor.title')}
          </h2>
          <p>
            {diff.changedLines === 0
              ? translate('sourceEditor.noChanges')
              : translate('sourceEditor.changedLines', {
                  changed: diff.changedLines,
                  added: diff.addedLines,
                  removed: diff.removedLines,
                  line: diff.firstChangedLine ?? 1
                })}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          disabled={busy !== null}
          aria-label={translate('sourceEditor.close')}
        >
          ×
        </button>
      </header>

      <div className="orbitpm-source-editor__body" data-source-editor-scroll-region>
        <label className="orbitpm-source-editor__label" htmlFor="orbitpm-source-editor-textarea">
          {translate('sourceEditor.diff')}
        </label>
        <textarea
          id="orbitpm-source-editor-textarea"
          className="orbitpm-source-editor__textarea"
          dir="ltr"
          spellCheck={false}
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value)
            setPreview(null)
            setLayoutCandidate(null)
            setLayoutRenderStatus('loading')
          }}
          disabled={busy !== null}
        />

        {diff.hunks.length > 0 || diff.truncated ? <SourceDiffPreview diff={diff} /> : null}

        {error ? (
          <div className="orbitpm-source-editor__error" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
            <p role="alert" aria-live="assertive" data-source-editor-error-summary>
              {error.summary}
            </p>
            {error.technicalDetail ? (
              <p data-source-editor-error-technical>
                <span>{translate('sourceEditor.action.technicalDetails')}</span>{' '}
                <code lang="en" dir="ltr">
                  {error.technicalDetail}
                </code>
              </p>
            ) : null}
          </div>
        ) : null}

        {layoutCandidate ? (
          <div className="orbitpm-source-editor__layout-preview">
            <div className="orbitpm-source-editor__layout-summary">
              <p>{translate('sourceEditor.layoutReady')}</p>
              {layoutDiff ? (
                <p>
                  {translate('sourceEditor.changedLines', {
                    changed: layoutDiff.changedLines,
                    added: layoutDiff.addedLines,
                    removed: layoutDiff.removedLines,
                    line: layoutDiff.firstChangedLine ?? 1
                  })}
                </p>
              ) : null}
            </div>
            {layoutDiff ? (
              <SourceDiffPreview diff={layoutDiff} title={translate('sourceEditor.layoutDiff')} />
            ) : null}
            <ReadOnlyDiagramPreview
              xml={layoutCandidate}
              title={translate('sourceEditor.layoutDiagramTitle')}
              ariaLabel={translate('sourceEditor.layoutDiagramAria')}
              onStatusChange={handleLayoutRenderStatus}
              createViewer={createDiagramPreviewViewer}
            />
            <button
              type="button"
              onClick={acceptLayout}
              disabled={
                busy !== null ||
                layoutRenderStatus !== 'ready' ||
                layoutDiff?.truncated !== false ||
                layoutDecision?.allowed !== true
              }
            >
              {translate('sourceEditor.layoutAccept')}
            </button>
          </div>
        ) : null}

        {preview && (preview.xml === draft || preview.xml === layoutCandidate) ? (
          <div className="orbitpm-source-editor__results" aria-live="polite">
            <ValidationIssueList issues={preview.summary.issues} compact />
          </div>
        ) : null}
      </div>

      <footer className="orbitpm-validation__footer">
        <button type="button" onClick={() => void handlePreview()} disabled={busy !== null}>
          {busy === 'preview'
            ? translate('sourceEditor.previewing')
            : translate('sourceEditor.preview')}
        </button>
        {missingDi && currentDecision?.allowed ? (
          <button type="button" onClick={() => void handleLayoutPreview()} disabled={busy !== null}>
            {busy === 'layout'
              ? translate('sourceEditor.previewing')
              : translate('sourceEditor.layoutPreview')}
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => {
            setDraft(originalXml)
            setPreview(null)
            setLayoutCandidate(null)
            setError(null)
            setLayoutRenderStatus('loading')
          }}
          disabled={busy !== null || draft === originalXml}
        >
          {translate('sourceEditor.rollback')}
        </button>
        <button
          type="button"
          className="orbitpm-validation__primary"
          onClick={() => void handleApply()}
          disabled={
            busy !== null ||
            diff.truncated ||
            diff.changedLines === 0 ||
            layoutCandidate !== null ||
            missingDi === true ||
            (currentDecision !== null && !currentDecision.allowed)
          }
        >
          {busy === 'apply' ? translate('sourceEditor.applying') : translate('sourceEditor.apply')}
        </button>
        <button type="button" onClick={onClose} disabled={busy !== null}>
          {translate('sourceEditor.close')}
        </button>
      </footer>
    </AccessibleDialog>
  )
}
