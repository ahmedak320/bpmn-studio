import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AccessibleDialog } from '../common/AccessibleDialog'
import { t, type Key } from '../i18n'
import { mergeValidationSummaries, type ValidationSummary } from './contracts'
import { evaluateValidationPolicy } from './policy'
import { validateUnknownExtensionPreservation } from './extensions'
import { summarizeXmlLineDiff } from './sourceDiff'
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
}

export type SourceEditorApplyResult =
  { status: 'applied' } | { status: 'cancelled' } | { status: 'blocked'; message?: string }

interface PreviewResult {
  xml: string
  summary: ValidationSummary
}

export function SourceEditorDialog({
  open,
  originalXml,
  validate,
  apply,
  autoLayout,
  onClose
}: SourceEditorDialogProps): JSX.Element | null {
  const headingRef = useRef<HTMLHeadingElement | null>(null)
  const applyAbortRef = useRef<AbortController | null>(null)
  const [draft, setDraft] = useState(originalXml)
  const [preview, setPreview] = useState<PreviewResult | null>(null)
  const [busy, setBusy] = useState<'preview' | 'apply' | 'layout' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [layoutCandidate, setLayoutCandidate] = useState<string | null>(null)

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
  }, [open, originalXml])

  useEffect(
    () => () => {
      applyAbortRef.current?.abort()
      applyAbortRef.current = null
    },
    []
  )

  const diff = useMemo(() => summarizeXmlLineDiff(originalXml, draft), [draft, originalXml])
  const layoutDiff = useMemo(
    () => (layoutCandidate ? summarizeXmlLineDiff(draft, layoutCandidate) : null),
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
      setError(caught instanceof Error ? caught.message : String(caught))
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
      setLayoutCandidate(candidate)
      setPreview(checked)
    } catch (caught) {
      setError(
        translate('sourceEditor.layoutFailed', {
          error: caught instanceof Error ? caught.message : String(caught)
        })
      )
    } finally {
      setBusy(null)
    }
  }, [autoLayout, draft, previewXml])

  const acceptLayout = useCallback(() => {
    if (!layoutCandidate) return
    setDraft(layoutCandidate)
    setLayoutCandidate(null)
  }, [layoutCandidate])

  const handleApply = useCallback(async () => {
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
        setError(translate('sourceEditor.missingDi'))
        return
      }
      const decision = evaluateValidationPolicy(checked.summary, 'apply-editor')
      if (!decision.allowed || checked.summary.blockingErrors > 0) {
        setError(
          decision.reason === 'unsafe-preservation-loss'
            ? translate('sourceEditor.preservationBlocked')
            : translate('sourceEditor.invalidBlocked')
        )
        return
      }
      const outcome = await apply(draft, controller.signal)
      if (controller.signal.aborted) return
      if (outcome?.status === 'cancelled') return
      if (outcome?.status === 'blocked') {
        setError(outcome.message ?? translate('sourceEditor.invalidBlocked'))
        return
      }
      onClose()
    } catch (caught) {
      if (controller.signal.aborted) return
      setError(
        translate('sourceEditor.applyFailed', {
          error: caught instanceof Error ? caught.message : String(caught)
        })
      )
    } finally {
      if (applyAbortRef.current === controller) applyAbortRef.current = null
      setBusy(null)
    }
  }, [apply, draft, onClose, previewXml])

  if (!open) return null

  return (
    <AccessibleDialog
      backdropClassName="orbitpm-validation__backdrop"
      dialogClassName="orbitpm-source-editor"
      ariaLabelledby="orbitpm-source-editor-title"
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
        }}
        disabled={busy !== null}
      />

      {error ? (
        <p className="orbitpm-source-editor__error" role="alert">
          {error}
        </p>
      ) : null}

      {layoutCandidate ? (
        <div className="orbitpm-source-editor__layout-preview">
          <div>
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
          <button
            type="button"
            onClick={acceptLayout}
            disabled={busy !== null || (layoutDecision !== null && !layoutDecision.allowed)}
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
