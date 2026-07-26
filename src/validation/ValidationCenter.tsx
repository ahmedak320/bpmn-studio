import { useMemo, useRef } from 'react'
import { AccessibleDialog } from '../common/AccessibleDialog'
import { t, type Key } from '../i18n'
import { triggerDownload } from '../editor/exportImage'
import type { ValidationIssue, ValidationSeverity, ValidationSummary } from './contracts'
import { validationReportDataUrl } from './report'
import './validation.css'

type TranslateVariables = Record<string, string | number>

function translate(key: string, variables?: TranslateVariables): string {
  return t(key as Key, variables)
}

function severityLabel(severity: ValidationSeverity): string {
  return translate(`validation.severity.${severity}`)
}

function sourceLabel(source: ValidationIssue['source']): string {
  return translate(`validation.stage.${source}`)
}

function issueKey(issue: ValidationIssue, index: number): string {
  return [
    issue.code,
    issue.elementId ?? '',
    issue.location?.line ?? '',
    issue.location?.column ?? '',
    index
  ].join(':')
}

export interface ValidationIssueListProps {
  issues: readonly ValidationIssue[]
  onFocus?: (issue: ValidationIssue) => void
  onRepair?: (issue: ValidationIssue) => void
  compact?: boolean
}

export function ValidationIssueList({
  issues,
  onFocus,
  onRepair,
  compact = false
}: ValidationIssueListProps): JSX.Element {
  if (issues.length === 0) {
    return <p className="orbitpm-validation__empty">{translate('validation.empty')}</p>
  }

  return (
    <ol className="orbitpm-validation__issues">
      {issues.map((issue, index) => (
        <li
          key={issueKey(issue, index)}
          className={`orbitpm-validation__issue orbitpm-validation__issue--${issue.severity}`}
        >
          <div className="orbitpm-validation__issue-heading">
            <span className="orbitpm-validation__severity">{severityLabel(issue.severity)}</span>
            <code>{issue.code}</code>
          </div>
          <p>{issue.message}</p>
          {!compact ? (
            <dl className="orbitpm-validation__metadata">
              <div>
                <dt>{translate('validation.source')}</dt>
                <dd>{sourceLabel(issue.source)}</dd>
              </div>
              {issue.elementId ? (
                <div>
                  <dt>{translate('validation.element')}</dt>
                  <dd>
                    <code>{issue.elementId}</code>
                  </dd>
                </div>
              ) : null}
              {issue.location ? (
                <div>
                  <dt>{translate('validation.location')}</dt>
                  <dd>
                    {translate('validation.lineColumn', {
                      line: issue.location.line,
                      column: issue.location.column
                    })}
                  </dd>
                </div>
              ) : null}
            </dl>
          ) : null}
          {issue.suggestedRepair ? (
            <p className="orbitpm-validation__repair-copy">{issue.suggestedRepair}</p>
          ) : null}
          {onFocus || onRepair ? (
            <div className="orbitpm-validation__issue-actions">
              {onFocus && issue.elementId ? (
                <button type="button" onClick={() => onFocus(issue)}>
                  {translate('validation.focus')}
                </button>
              ) : null}
              {onRepair && (issue.suggestedRepair || issue.location || issue.source === 'di') ? (
                <button type="button" onClick={() => onRepair(issue)}>
                  {translate('validation.repair')}
                </button>
              ) : null}
            </div>
          ) : null}
        </li>
      ))}
    </ol>
  )
}

export interface ValidationCenterProps {
  open: boolean
  summary: ValidationSummary | null
  running: boolean
  documentName?: string
  onClose: () => void
  onRun: () => void
  onFocus: (issue: ValidationIssue) => void
  onRepair: (issue: ValidationIssue) => void
}

export function ValidationCenter({
  open,
  summary,
  running,
  documentName,
  onClose,
  onRun,
  onFocus,
  onRepair
}: ValidationCenterProps): JSX.Element | null {
  const headingRef = useRef<HTMLHeadingElement | null>(null)
  const status = useMemo(() => {
    if (running) return translate('validation.running')
    if (!summary) return translate('validation.empty')
    return summary.valid
      ? translate('validation.valid')
      : translate('validation.invalid', { count: summary.blockingErrors })
  }, [running, summary])

  if (!open) return null

  const exportReport = (): void => {
    if (!summary) return
    const base = documentName?.replace(/\.bpmn$/i, '').trim() || 'diagram'
    triggerDownload(`${base}.validation.json`, validationReportDataUrl(summary, documentName))
  }

  return (
    <AccessibleDialog
      backdropClassName="orbitpm-validation__backdrop"
      dialogClassName="orbitpm-validation"
      ariaLabelledby="orbitpm-validation-title"
      onClose={onClose}
      closeOnEscape
      closeOnBackdrop
      initialFocusRef={headingRef}
    >
      <header className="orbitpm-validation__header">
        <div>
          <h2 id="orbitpm-validation-title" ref={headingRef} tabIndex={-1}>
            {translate('validation.title')}
          </h2>
          <p aria-live="polite">{status}</p>
        </div>
        <button type="button" onClick={onClose} aria-label={translate('validation.close')}>
          ×
        </button>
      </header>

      {summary ? (
        <div
          className="orbitpm-validation__counts"
          aria-label={translate('validation.summary', {
            errors: summary.errors,
            warnings: summary.warnings,
            infos: summary.infos
          })}
        >
          <span className="orbitpm-validation__count orbitpm-validation__count--error">
            {translate('validation.errors')}: {summary.errors}
          </span>
          <span className="orbitpm-validation__count orbitpm-validation__count--warning">
            {translate('validation.warnings')}: {summary.warnings}
          </span>
          <span className="orbitpm-validation__count">
            {translate('validation.infos')}: {summary.infos}
          </span>
        </div>
      ) : null}

      <div className="orbitpm-validation__content">
        <ValidationIssueList issues={summary?.issues ?? []} onFocus={onFocus} onRepair={onRepair} />
      </div>

      <footer className="orbitpm-validation__footer">
        <button type="button" onClick={onRun} disabled={running}>
          {running ? translate('validation.running') : translate('validation.open')}
        </button>
        <button
          type="button"
          onClick={exportReport}
          disabled={!summary}
          title={translate('validation.export.title')}
        >
          {translate('validation.export')}
        </button>
        <button type="button" onClick={onClose}>
          {translate('validation.close')}
        </button>
      </footer>
    </AccessibleDialog>
  )
}
