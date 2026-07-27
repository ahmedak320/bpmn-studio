import { useCallback, useMemo, useRef, useState } from 'react'

import { AccessibleDialog } from '../common/AccessibleDialog'
import { t, type Key } from '../i18n'
import { useLang } from '../i18n/useLang'
import { auditFieldTarget, auditLocalizationFields, type LocalizationFieldException } from './audit'
import type {
  ReviewedLocalizationApproval,
  ReviewedLocalizationEdit,
  ReviewedXmlIngestionReviewRequest,
  ReviewedXmlIngestionReviewResult
} from './xmlIngestion'
import type { LanguageCode, LocalizationField, LocalizationIssueCode } from './types'

import './ReviewedXmlIngestionDialog.css'

export interface ReviewedXmlIngestionDialogProps {
  /** Immutable, digest-bound request returned by reviewed XML ingestion. */
  request: ReviewedXmlIngestionReviewRequest
  /** Resolve the awaited review. This callback never receives XML. */
  onDecision(result: ReviewedXmlIngestionReviewResult): void
}

type ApprovalKind = ReviewedLocalizationApproval['kind']

interface ApprovalSelection {
  kind: ApprovalKind
  /** Approval is valid only while the input remains byte-for-byte equal. */
  value: string
}

interface ReviewRow {
  key: string
  processId: string
  elementId: string
  fieldName: string
  target: LanguageCode
  expectedValue: string | null
  counterpart: string | null
  sourceLanguage: LanguageCode
  sourceValue: string | null
  issueCodes: readonly LocalizationIssueCode[]
  field?: LocalizationField
}

function translate(key: string, variables?: Record<string, string | number>): string {
  return t(key as Key, variables)
}

function otherLanguage(language: LanguageCode): LanguageCode {
  return language === 'en' ? 'ar' : 'en'
}

function fieldKey(value: Pick<LocalizationField, 'processId' | 'elementId' | 'field'>): string {
  return `${value.processId}\u0000${value.elementId}\u0000${value.field}`
}

function rowKey(
  value: Pick<ReviewRow, 'processId' | 'elementId' | 'fieldName' | 'target'>
): string {
  return `${value.processId}\u0000${value.elementId}\u0000${value.fieldName}\u0000${value.target}`
}

function buildRows(request: ReviewedXmlIngestionReviewRequest): ReviewRow[] {
  const fields = new Map(
    request.ingestion.localPlan.fields.map((field) => [fieldKey(field), field] as const)
  )
  const rows = new Map<string, ReviewRow>()

  for (const issue of request.ingestion.audit.issues) {
    const key = rowKey({
      processId: issue.processId,
      elementId: issue.elementId,
      fieldName: issue.field,
      target: issue.target
    })
    const existing = rows.get(key)
    if (existing) {
      if (!existing.issueCodes.includes(issue.code)) {
        rows.set(key, {
          ...existing,
          issueCodes: [...existing.issueCodes, issue.code]
        })
      }
      continue
    }

    const field = fields.get(
      fieldKey({
        processId: issue.processId,
        elementId: issue.elementId,
        field: issue.field
      })
    )
    const counterpartLanguage = otherLanguage(issue.target)
    const sourceLanguage =
      field?.sourceLanguage ??
      (field?.value[counterpartLanguage] !== undefined ? counterpartLanguage : issue.target)
    rows.set(key, {
      key,
      processId: issue.processId,
      elementId: issue.elementId,
      fieldName: issue.field,
      target: issue.target,
      expectedValue: field?.value[issue.target] ?? null,
      counterpart: field?.value[counterpartLanguage] ?? null,
      sourceLanguage,
      sourceValue: field?.value[sourceLanguage] ?? field?.projection ?? issue.originalValue ?? null,
      issueCodes: [issue.code],
      field
    })
  }

  return [...rows.values()]
}

function issueMessageKey(code: LocalizationIssueCode): Key {
  switch (code) {
    case 'missing':
      return 'reviewedXmlReview.issue.missing'
    case 'wrong-script':
      return 'reviewedXmlReview.issue.wrongScript'
    case 'duplicate-counterpart':
      return 'reviewedXmlReview.issue.duplicateCounterpart'
    case 'mixed':
      return 'reviewedXmlReview.issue.mixed'
    case 'provider-failed':
      return 'reviewedXmlReview.issue.providerFailed'
  }
}

function targetLabel(target: LanguageCode): string {
  return translate(target === 'ar' ? 'reviewedXmlReview.target.ar' : 'reviewedXmlReview.target.en')
}

function exactDisplay(value: string | null): string {
  return value === null || value === '' ? translate('reviewedXmlReview.empty') : value
}

function selectedExceptions(
  rows: readonly ReviewRow[],
  drafts: Readonly<Record<string, string>>,
  approvals: Readonly<Record<string, ApprovalSelection>>
): LocalizationFieldException[] {
  return rows.flatMap((row) => {
    const value = drafts[row.key] ?? ''
    const approval = approvals[row.key]
    if (!approval || approval.value !== value) return []
    return [
      {
        processId: row.processId,
        elementId: row.elementId,
        field: row.fieldName,
        target: row.target,
        value,
        kind: approval.kind
      }
    ]
  })
}

function currentIssueCodes(
  row: ReviewRow,
  rows: readonly ReviewRow[],
  drafts: Readonly<Record<string, string>>,
  approvals: Readonly<Record<string, ApprovalSelection>>,
  request: ReviewedXmlIngestionReviewRequest,
  approvedFieldExceptions: readonly LocalizationFieldException[]
): LocalizationIssueCode[] {
  if (!row.field) return [...row.issueCodes]
  const candidateValues = { ...row.field.value }
  for (const candidate of rows) {
    if (
      candidate.processId === row.processId &&
      candidate.elementId === row.elementId &&
      candidate.fieldName === row.fieldName
    ) {
      candidateValues[candidate.target] = drafts[candidate.key] ?? ''
    }
  }
  const field: LocalizationField = {
    ...row.field,
    value: candidateValues
  }
  const auditOptions = {
    glossary: request.resources.glossary,
    approvedFieldExceptions
  }
  const issues = auditFieldTarget(field, row.target, auditOptions).map((issue) => issue.code)
  issues.push(
    ...auditLocalizationFields([field], auditOptions)
      .issues.filter((issue) => issue.code === 'duplicate-counterpart')
      .map((issue) => issue.code)
  )

  return [...new Set(issues)]
}

function ReviewedXmlIngestionDialogContent({
  request,
  onDecision
}: ReviewedXmlIngestionDialogProps): JSX.Element {
  const lang = useLang()
  const headingRef = useRef<HTMLHeadingElement | null>(null)
  const decidedRef = useRef(false)
  const rowsRef = useRef<ReviewRow[] | null>(null)
  if (rowsRef.current === null) rowsRef.current = buildRows(request)
  const rows = rowsRef.current
  const [drafts, setDrafts] = useState<Record<string, string>>(() =>
    Object.fromEntries(rows.map((row) => [row.key, row.expectedValue ?? '']))
  )
  const [approvals, setApprovals] = useState<Record<string, ApprovalSelection>>({})

  const validations = useMemo(() => {
    const approvedFieldExceptions = selectedExceptions(rows, drafts, approvals)
    return new Map(
      rows.map((row) => [
        row.key,
        currentIssueCodes(row, rows, drafts, approvals, request, approvedFieldExceptions)
      ])
    )
  }, [approvals, drafts, request, rows])
  const invalidCount = rows.filter((row) => (validations.get(row.key)?.length ?? 1) > 0).length
  const complete = rows.length > 0 && invalidCount === 0

  const decide = useCallback(
    (result: ReviewedXmlIngestionReviewResult): void => {
      if (decidedRef.current) return
      decidedRef.current = true
      onDecision(result)
    },
    [onDecision]
  )

  const cancel = useCallback(() => {
    decide({ status: 'cancelled' })
  }, [decide])

  const completeReview = useCallback(() => {
    if (!complete) return
    const edits: ReviewedLocalizationEdit[] = rows.map((row) => ({
      processId: row.processId,
      elementId: row.elementId,
      field: row.fieldName,
      target: row.target,
      expectedValue: row.expectedValue,
      value: drafts[row.key] ?? ''
    }))
    const reviewedApprovals: ReviewedLocalizationApproval[] = rows.flatMap((row) => {
      const approval = approvals[row.key]
      const value = drafts[row.key] ?? ''
      if (!approval || approval.value !== value) return []
      return [
        {
          processId: row.processId,
          elementId: row.elementId,
          field: row.fieldName,
          target: row.target,
          value,
          kind: approval.kind
        }
      ]
    })
    decide({
      status: 'completed',
      reviewDigest: request.reviewDigest,
      edits,
      ...(reviewedApprovals.length > 0 ? { approvals: reviewedApprovals } : {})
    })
  }, [approvals, complete, decide, drafts, request.reviewDigest, rows])

  return (
    <AccessibleDialog
      backdropClassName="orbitpm-reviewed-xml__backdrop"
      dialogClassName="orbitpm-reviewed-xml"
      ariaLabelledby="orbitpm-reviewed-xml-title"
      ariaDescribedby="orbitpm-reviewed-xml-summary"
      onClose={cancel}
      closeOnEscape
      closeOnBackdrop={false}
      initialFocusRef={headingRef}
      dir={lang === 'ar' ? 'rtl' : 'ltr'}
    >
      <header className="orbitpm-reviewed-xml__header">
        <h2 id="orbitpm-reviewed-xml-title" ref={headingRef} tabIndex={-1}>
          {translate('reviewedXmlReview.title')}
        </h2>
        <button
          type="button"
          className="orbitpm-reviewed-xml__close"
          onClick={cancel}
          aria-label={translate('reviewedXmlReview.close')}
          title={translate('reviewedXmlReview.close')}
        >
          ×
        </button>
      </header>

      <div className="orbitpm-reviewed-xml__body">
        <p id="orbitpm-reviewed-xml-summary" className="orbitpm-reviewed-xml__summary">
          {translate('reviewedXmlReview.summary', { count: rows.length })}
        </p>
        <p
          className={
            complete
              ? 'orbitpm-reviewed-xml__live orbitpm-reviewed-xml__live--ready'
              : 'orbitpm-reviewed-xml__live orbitpm-reviewed-xml__live--error'
          }
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          {complete
            ? translate('reviewedXmlReview.ready')
            : translate('reviewedXmlReview.pending', { count: invalidCount })}
        </p>

        <div className="orbitpm-reviewed-xml__rows">
          {rows.map((row, index) => {
            const currentIssues = validations.get(row.key) ?? row.issueCodes
            const rowTitleId = `orbitpm-reviewed-xml-row-${index + 1}`
            const originalIssuesId = `${rowTitleId}-issues`
            const currentIssuesId = `${rowTitleId}-current-issues`
            const inputId = `${rowTitleId}-input`
            const approvalId = `${rowTitleId}-approval`
            const approval = approvals[row.key]
            const value = drafts[row.key] ?? ''

            return (
              <section
                key={row.key}
                className="orbitpm-reviewed-xml__row"
                data-testid="reviewed-xml-row"
                aria-labelledby={rowTitleId}
              >
                <h3 id={rowTitleId}>
                  {translate('reviewedXmlReview.row.title', {
                    process: row.processId,
                    element: row.elementId,
                    field: row.fieldName,
                    target: targetLabel(row.target)
                  })}
                </h3>

                <dl className="orbitpm-reviewed-xml__facts">
                  <div>
                    <dt>
                      {translate('reviewedXmlReview.source', {
                        language: targetLabel(row.sourceLanguage)
                      })}
                    </dt>
                    <dd>
                      <code dir="auto">{exactDisplay(row.sourceValue)}</code>
                    </dd>
                  </div>
                  <div>
                    <dt>
                      {translate('reviewedXmlReview.current', {
                        language: targetLabel(row.target)
                      })}
                    </dt>
                    <dd>
                      <code dir="auto">{exactDisplay(row.expectedValue)}</code>
                    </dd>
                  </div>
                  <div>
                    <dt>
                      {translate('reviewedXmlReview.counterpart', {
                        language: targetLabel(otherLanguage(row.target))
                      })}
                    </dt>
                    <dd>
                      <code dir="auto">{exactDisplay(row.counterpart)}</code>
                    </dd>
                  </div>
                </dl>

                <div id={originalIssuesId} className="orbitpm-reviewed-xml__original-issues">
                  <strong>{translate('reviewedXmlReview.issues')}</strong>
                  <ul>
                    {row.issueCodes.map((code) => (
                      <li key={code}>
                        {translate(issueMessageKey(code))} <code>{code}</code>
                      </li>
                    ))}
                  </ul>
                </div>

                <label className="orbitpm-reviewed-xml__label" htmlFor={inputId}>
                  {translate('reviewedXmlReview.targetValue', {
                    language: targetLabel(row.target)
                  })}
                </label>
                <input
                  id={inputId}
                  className="orbitpm-reviewed-xml__input"
                  type="text"
                  value={value}
                  dir={row.target === 'ar' ? 'rtl' : 'ltr'}
                  aria-invalid={currentIssues.length > 0}
                  aria-describedby={`${originalIssuesId} ${currentIssuesId}`}
                  onChange={(event) => {
                    const nextValue = event.target.value
                    setDrafts((current) => ({ ...current, [row.key]: nextValue }))
                    setApprovals((current) => {
                      const currentApproval = current[row.key]
                      if (!currentApproval || currentApproval.value === nextValue) return current
                      const next = { ...current }
                      delete next[row.key]
                      return next
                    })
                  }}
                />
                <div id={currentIssuesId} className="orbitpm-reviewed-xml__current-issues">
                  {currentIssues.length > 0 ? (
                    <ul>
                      {currentIssues.map((code) => (
                        <li key={code}>{translate(issueMessageKey(code))}</li>
                      ))}
                    </ul>
                  ) : (
                    <span>{translate('reviewedXmlReview.rowValid')}</span>
                  )}
                </div>

                <label className="orbitpm-reviewed-xml__label" htmlFor={approvalId}>
                  {translate('reviewedXmlReview.approval')}
                </label>
                <select
                  id={approvalId}
                  className="orbitpm-reviewed-xml__select"
                  value={approval?.kind ?? ''}
                  onChange={(event) => {
                    const kind = event.target.value as ApprovalKind | ''
                    setApprovals((current) => {
                      if (kind === '') {
                        const next = { ...current }
                        delete next[row.key]
                        return next
                      }
                      return {
                        ...current,
                        [row.key]: { kind, value }
                      }
                    })
                  }}
                >
                  <option value="">{translate('reviewedXmlReview.approval.none')}</option>
                  <option value="neutral">{translate('reviewedXmlReview.approval.neutral')}</option>
                  {row.target === 'en' ? (
                    <option value="english-bilingual">
                      {translate('reviewedXmlReview.approval.englishBilingual')}
                    </option>
                  ) : null}
                </select>
                <small className="orbitpm-reviewed-xml__approval-help">
                  {translate('reviewedXmlReview.approval.help')}
                </small>
              </section>
            )
          })}
        </div>
      </div>

      <footer className="orbitpm-reviewed-xml__footer">
        <button type="button" onClick={cancel}>
          {translate('reviewedXmlReview.cancel')}
        </button>
        <button
          type="button"
          className="orbitpm-reviewed-xml__complete"
          onClick={completeReview}
          disabled={!complete}
        >
          {translate('reviewedXmlReview.complete')}
        </button>
      </footer>
    </AccessibleDialog>
  )
}

/**
 * Keying the stateful content by the cryptographic request digest guarantees
 * that edits and approvals reset together when App supplies a new review.
 */
export function ReviewedXmlIngestionDialog(props: ReviewedXmlIngestionDialogProps): JSX.Element {
  return <ReviewedXmlIngestionDialogContent key={props.request.reviewDigest} {...props} />
}

export default ReviewedXmlIngestionDialog
