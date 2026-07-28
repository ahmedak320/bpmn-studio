import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { AccessibleDialog } from '../common/AccessibleDialog'
import { t, type Key } from '../i18n'
import { triggerDownload } from '../common/exportImage'
import type { ValidationIssue, ValidationSeverity, ValidationSummary } from './contracts'
import { localizeValidationIssue } from './issueLocalization'
import { validationReportDataUrl } from './report'
import { boundedValidationTechnicalDetail } from './technicalEvidence'
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

export const VALIDATION_ISSUE_PAGE_SIZE = 20

export function ValidationIssueList({
  issues,
  onFocus,
  onRepair,
  compact = false
}: ValidationIssueListProps): JSX.Element {
  const issueListId = useId()
  const [pagination, setPagination] = useState<{
    issues: readonly ValidationIssue[]
    page: number
  }>(() => ({ issues, page: 0 }))
  const pageCount = Math.max(1, Math.ceil(issues.length / VALIDATION_ISSUE_PAGE_SIZE))
  const requestedPage = pagination.issues === issues ? pagination.page : 0
  const page = Math.min(requestedPage, pageCount - 1)
  const pageStart = page * VALIDATION_ISSUE_PAGE_SIZE
  const pageEnd = Math.min(issues.length, pageStart + VALIDATION_ISSUE_PAGE_SIZE)
  const visibleIssues = issues.slice(pageStart, pageEnd)

  useEffect(() => {
    setPagination((current) => {
      if (current.issues !== issues) return { issues, page: 0 }
      if (current.page !== page) return { issues, page }
      return current
    })
  }, [issues, page])

  if (issues.length === 0) {
    return <p className="orbitpm-validation__empty">{translate('validation.empty')}</p>
  }

  return (
    <div className="orbitpm-validation__issue-list">
      <ol
        id={issueListId}
        className="orbitpm-validation__issues"
        start={pageStart + 1}
        aria-label={translate('validation.issues')}
      >
        {visibleIssues.map((issue, pageIndex) => {
          const issueIndex = pageStart + pageIndex
          const localized = localizeValidationIssue(issue)
          const technicalDiagnostic = boundedValidationTechnicalDetail(issue.message) ?? ''
          const technicalDiagnosticTruncated = technicalDiagnostic !== issue.message
          return (
            <li
              key={issueKey(issue, issueIndex)}
              className={`orbitpm-validation__issue orbitpm-validation__issue--${issue.severity}`}
              aria-posinset={issueIndex + 1}
              aria-setsize={issues.length}
            >
              <div className="orbitpm-validation__issue-heading">
                <span className="orbitpm-validation__severity">
                  {severityLabel(issue.severity)}
                </span>
              </div>
              <p data-validation-localized-message>{localized.message}</p>
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
                        <code lang="en" dir="ltr">
                          {issue.elementId}
                        </code>
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
              <p className="orbitpm-validation__repair-copy">
                <strong>{translate('validation.suggestedRepair')}:</strong>{' '}
                <span data-validation-localized-repair>{localized.suggestedRepair}</span>
              </p>
              <dl
                className="orbitpm-validation__technical"
                aria-label={translate('validation.technicalEvidence')}
              >
                <div>
                  <dt>{translate('validation.technical.code')}</dt>
                  <dd>
                    <code lang="en" dir="ltr" data-validation-technical-code>
                      {issue.code}
                    </code>
                  </dd>
                </div>
                {issue.ruleId ? (
                  <div>
                    <dt>{translate('validation.technical.ruleId')}</dt>
                    <dd>
                      <code lang="en" dir="ltr" data-validation-technical-rule>
                        {issue.ruleId}
                      </code>
                    </dd>
                  </div>
                ) : null}
                <div className="orbitpm-validation__technical-diagnostic">
                  <dt>{translate('validation.technical.diagnostic')}</dt>
                  <dd>
                    <code lang="en" dir="ltr" data-validation-technical-diagnostic>
                      {technicalDiagnostic}
                    </code>
                    {technicalDiagnosticTruncated ? (
                      <span
                        className="orbitpm-validation__technical-truncated"
                        data-validation-technical-truncated
                      >
                        {translate('validation.technical.truncated')}
                      </span>
                    ) : null}
                  </dd>
                </div>
              </dl>
              {onFocus || onRepair ? (
                <div className="orbitpm-validation__issue-actions">
                  {onFocus && issue.elementId ? (
                    <button type="button" onClick={() => onFocus(issue)}>
                      {translate('validation.focus')}
                    </button>
                  ) : null}
                  {onRepair &&
                  (issue.suggestedRepair || issue.location || issue.source === 'di') ? (
                    <button type="button" onClick={() => onRepair(issue)}>
                      {translate('validation.repair')}
                    </button>
                  ) : null}
                </div>
              ) : null}
            </li>
          )
        })}
      </ol>
      {pageCount > 1 ? (
        <nav
          className="orbitpm-validation__pagination"
          aria-label={translate('validation.pagination.label')}
        >
          <span role="status" aria-live="polite">
            {translate('validation.pagination.status', {
              start: pageStart + 1,
              end: pageEnd,
              total: issues.length,
              page: page + 1,
              pages: pageCount
            })}
          </span>
          <span className="orbitpm-validation__pagination-actions">
            <button
              type="button"
              aria-controls={issueListId}
              disabled={page === 0}
              onClick={() => setPagination({ issues, page: page - 1 })}
            >
              {translate('validation.pagination.previous')}
            </button>
            <button
              type="button"
              aria-controls={issueListId}
              disabled={page + 1 >= pageCount}
              onClick={() => setPagination({ issues, page: page + 1 })}
            >
              {translate('validation.pagination.next')}
            </button>
          </span>
        </nav>
      ) : null}
    </div>
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
