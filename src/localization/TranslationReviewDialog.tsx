import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Modal } from '../workspace/Modal'
import { t } from '../i18n'
import { useLang } from '../i18n/useLang'
import {
  grantExternalRequestConsent,
  type ExternalRequestConsent,
  type ExternalRequestDisclosure
} from './externalRequestReview'
import type { DiagramLocalizationReview } from './modelerAdapter'
import {
  buildTranslationRecoveryDisclosure,
  deriveTranslationReviewProgress,
  listTranslationRecoveryFields,
  translationRecoveryFieldId,
  validateTranslationRecoveryValue,
  type TranslationRecoveryField,
  type TranslationRecoveryFieldId
} from './translationRecovery'
import type { LocalizationIssueCode } from './types'

export const TRANSLATION_REVIEW_FIELD_PAGE_SIZE = 24
export const TRANSLATION_REVIEW_OUTBOUND_PAGE_SIZE = 30
export const TRANSLATION_TECHNICAL_DETAIL_LIMIT = 4096

export interface TranslationReviewProviderOption {
  id: string
  label: string
  description: string
  disabled?: boolean
}

export interface TranslationFieldRetryConfirmation {
  disclosure: ExternalRequestDisclosure
  consent: ExternalRequestConsent
}

export interface TranslationOutputProposal {
  processId: string
  elementId: string
  field: string
  sourceLanguage: 'en' | 'ar'
  sourceValue: string
  target: 'en' | 'ar'
  value: string
}

export interface TranslationReviewDialogProps {
  review: DiagramLocalizationReview
  documentName?: string
  disclosure: ExternalRequestDisclosure | null
  providers: readonly TranslationReviewProviderOption[]
  providerId: string
  busy?: boolean
  cancellable?: boolean
  status?: string | null
  technicalDetail?: string | null
  retryingFieldId?: TranslationRecoveryFieldId | null
  proposals?: readonly TranslationOutputProposal[]
  acceptedValues?: readonly TranslationOutputProposal[]
  onProviderChange(providerId: string): void
  onTranslateNow(): void
  onPartialPreview(): void
  onApplyCompleted?(): void | Promise<void>
  onRetryField?(
    field: TranslationRecoveryField,
    confirmation: TranslationFieldRetryConfirmation
  ): void | Promise<void>
  onManualEdit?(field: TranslationRecoveryField, value: string): void | Promise<void>
  onAcceptProposal?(
    field: TranslationRecoveryField,
    proposal: TranslationOutputProposal
  ): void | Promise<void>
  onRejectProposal?(
    field: TranslationRecoveryField,
    proposal: TranslationOutputProposal
  ): void | Promise<void>
  onRetryMemorySave?(): void | Promise<void>
  onContinueWithoutMemorySave?(): void
  onPostpone(): void
  onCancelTranslation(): void
}

type ReviewFailure =
  | { kind: 'provider-required' }
  | { kind: 'manual-validation'; issueCodes: readonly LocalizationIssueCode[] }
  | { kind: 'manual-save'; detail: string | null }
  | { kind: 'field-retry'; detail: string | null }

function issueMessage(code: LocalizationIssueCode): string {
  switch (code) {
    case 'missing':
      return t('translationReview.issue.missing')
    case 'wrong-script':
      return t('translationReview.issue.wrongScript')
    case 'duplicate-counterpart':
      return t('translationReview.issue.duplicateCounterpart')
    case 'mixed':
      return t('translationReview.issue.mixed')
    case 'provider-failed':
      return t('translationReview.issue.providerFailed')
  }
}

function issueMessages(codes: readonly LocalizationIssueCode[]): string {
  return codes.map(issueMessage).join(', ')
}

export function boundedTranslationTechnicalDetail(error: unknown): string | null {
  let detail: string | null = null
  try {
    if (error instanceof Error) {
      let message = ''
      let name = ''
      try {
        message = typeof error.message === 'string' ? error.message : String(error.message ?? '')
      } catch {
        // A hostile cross-realm Error can expose a throwing message getter.
      }
      try {
        name = typeof error.name === 'string' ? error.name : String(error.name ?? '')
      } catch {
        // The stable fallback below remains available.
      }
      detail = message || name || 'Error'
    } else if (error != null) {
      detail = typeof error === 'string' ? error : String(error)
    }
  } catch {
    detail = null
  }
  if (!detail) return null
  const suffix = '\n[technical evidence truncated]'
  const budget =
    detail.length <= TRANSLATION_TECHNICAL_DETAIL_LIMIT
      ? TRANSLATION_TECHNICAL_DETAIL_LIMIT
      : TRANSLATION_TECHNICAL_DETAIL_LIMIT - suffix.length
  let safe = ''
  let index = 0
  while (index < detail.length && safe.length < budget) {
    const first = detail.charCodeAt(index)
    if (first >= 0xd800 && first <= 0xdbff) {
      const second = detail.charCodeAt(index + 1)
      if (second >= 0xdc00 && second <= 0xdfff) {
        if (safe.length + 2 > budget) break
        safe += detail[index] + detail[index + 1]
        index += 2
        continue
      }
      safe += '\ufffd'
      index += 1
      continue
    }
    if (first >= 0xdc00 && first <= 0xdfff) {
      safe += '\ufffd'
      index += 1
      continue
    }
    safe += detail[index]
    index += 1
  }
  return index < detail.length ? `${safe}${suffix}` : safe
}

function reviewFailureMessage(failure: ReviewFailure): string {
  switch (failure.kind) {
    case 'provider-required':
      return t('translationReview.noProvider')
    case 'manual-validation':
      return failure.issueCodes.length > 0
        ? issueMessages(failure.issueCodes)
        : t('translationReview.field.manualEmpty')
    case 'manual-save':
      return t('translationReview.field.manualFailed')
    case 'field-retry':
      return t('translationReview.field.retryFailed')
  }
}

function reviewFailureDetail(failure: ReviewFailure): string | null {
  return failure.kind === 'manual-save' || failure.kind === 'field-retry' ? failure.detail : null
}

function issueCount(
  review: DiagramLocalizationReview,
  code: 'missing' | 'wrong-script' | 'duplicate-counterpart' | 'mixed' | 'provider-failed'
): number {
  return review.issues.filter((issue) => issue.target === review.target && issue.code === code)
    .length
}

function technicalTerms(text: string, markEnglish: boolean): ReactNode {
  if (!markEnglish) return text
  return text
    .split(/(Google Translate|MyMemory|OpenRouter|OpenAI|Anthropic|Gemini|Claude|GPT)/g)
    .map((part, index) =>
      /^(Google Translate|MyMemory|OpenRouter|OpenAI|Anthropic|Gemini|Claude|GPT)$/.test(part) ? (
        <span key={`${part}:${index}`} lang="en" dir="ltr">
          {part}
        </span>
      ) : (
        part
      )
    )
}

interface ReviewPaginationProps {
  ariaLabel: string
  controls: string
  page: number
  pageCount: number
  pageSize: number
  total: number
  onPageChange(page: number): void
}

function ReviewPagination({
  ariaLabel,
  controls,
  page,
  pageCount,
  pageSize,
  total,
  onPageChange
}: ReviewPaginationProps): JSX.Element | null {
  if (total === 0) return null
  const start = page * pageSize + 1
  const end = Math.min(total, start + pageSize - 1)
  return (
    <nav
      aria-label={ariaLabel}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: 8,
        marginTop: 8
      }}
    >
      <span role="status" aria-live="polite">
        {t('translationReview.pagination.status', {
          start,
          end,
          total,
          page: page + 1,
          pages: pageCount
        })}
      </span>
      <span style={{ display: 'flex', gap: 7 }}>
        <button
          type="button"
          className="orbitpm-lite-chrome-btn"
          aria-controls={controls}
          onClick={() => onPageChange(page - 1)}
          disabled={page === 0}
        >
          {t('translationReview.pagination.previous')}
        </button>
        <button
          type="button"
          className="orbitpm-lite-chrome-btn"
          aria-controls={controls}
          onClick={() => onPageChange(page + 1)}
          disabled={page + 1 >= pageCount}
        >
          {t('translationReview.pagination.next')}
        </button>
      </span>
    </nav>
  )
}

function TechnicalEvidence({ detail }: { detail: string | null | undefined }): JSX.Element | null {
  const bounded = boundedTranslationTechnicalDetail(detail)
  if (!bounded) return null
  return (
    <details style={{ marginTop: 5 }}>
      <summary>{t('translationReview.error.technicalDetails')}</summary>
      <code
        aria-label={t('translationReview.error.technicalDetail')}
        lang="en"
        dir="ltr"
        style={{ overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }}
      >
        {bounded}
      </code>
    </details>
  )
}

export function TranslationReviewDialog({
  review,
  documentName,
  disclosure,
  providers,
  providerId,
  busy = false,
  cancellable = true,
  status,
  technicalDetail,
  retryingFieldId,
  proposals = [],
  acceptedValues = [],
  onProviderChange,
  onTranslateNow,
  onPartialPreview,
  onApplyCompleted,
  onRetryField,
  onManualEdit,
  onAcceptProposal,
  onRejectProposal,
  onRetryMemorySave,
  onContinueWithoutMemorySave,
  onPostpone,
  onCancelTranslation
}: TranslationReviewDialogProps): JSX.Element {
  const uiLang = useLang()
  const [manualFieldId, setManualFieldId] = useState<TranslationRecoveryFieldId | null>(null)
  const [manualDrafts, setManualDrafts] = useState<Record<string, string>>({})
  const [manualSavingFieldId, setManualSavingFieldId] = useState<TranslationRecoveryFieldId | null>(
    null
  )
  const [localRetryingFieldId, setLocalRetryingFieldId] =
    useState<TranslationRecoveryFieldId | null>(null)
  const [pendingRetryFieldId, setPendingRetryFieldId] = useState<TranslationRecoveryFieldId | null>(
    null
  )
  const [manualError, setManualError] = useState<ReviewFailure | null>(null)
  const [fieldPage, setFieldPage] = useState(0)
  const [outboundPage, setOutboundPage] = useState(0)
  const memoryRetryButtonRef = useRef<HTMLButtonElement | null>(null)
  const direction =
    review.target === 'ar'
      ? t('translationReview.direction.enAr')
      : t('translationReview.direction.arEn')
  const counts = useMemo(
    () => ({
      missing: issueCount(review, 'missing'),
      invalid:
        issueCount(review, 'wrong-script') +
        issueCount(review, 'duplicate-counterpart') +
        issueCount(review, 'mixed'),
      failed: issueCount(review, 'provider-failed')
    }),
    [review]
  )
  const recoveryFields = useMemo(() => listTranslationRecoveryFields(review), [review])
  const proposalsByField = useMemo(() => {
    const indexed = new Map<TranslationRecoveryFieldId, TranslationOutputProposal>()
    for (const proposal of proposals) {
      indexed.set(translationRecoveryFieldId(proposal), proposal)
    }
    return indexed
  }, [proposals])
  const acceptedByField = useMemo(() => {
    const indexed = new Map<TranslationRecoveryFieldId, TranslationOutputProposal>()
    for (const accepted of acceptedValues) {
      indexed.set(translationRecoveryFieldId(accepted), accepted)
    }
    return indexed
  }, [acceptedValues])
  const progress = useMemo(() => {
    const base = deriveTranslationReviewProgress(review, recoveryFields)
    const staged = recoveryFields.filter((field) => acceptedByField.has(field.id))
    const unresolved = Math.max(0, base.unresolved - staged.length)
    return {
      ...base,
      resolved: base.resolved + staged.length,
      unresolved,
      failed: Math.max(0, base.failed - staged.filter((field) => field.failed).length),
      complete: base.complete || (base.total > 0 && unresolved === 0)
    }
  }, [acceptedByField, recoveryFields, review])
  const memorySaveRecoveryRequired = onRetryMemorySave !== undefined
  const memoryRecoveryDescriptionId = memorySaveRecoveryRequired
    ? 'translation-review-memory-recovery-description'
    : undefined

  useEffect(() => {
    setManualFieldId(null)
    setManualDrafts({})
    setManualSavingFieldId(null)
    setLocalRetryingFieldId(null)
    setPendingRetryFieldId(null)
    setManualError(null)
    setFieldPage(0)
    setOutboundPage(0)
  }, [review])

  useEffect(() => {
    // Provider/model/text changes produce a new fingerprint and require a new
    // visible one-field confirmation.
    setPendingRetryFieldId(null)
  }, [disclosure?.fingerprint])

  useEffect(() => {
    if (memorySaveRecoveryRequired && !busy) memoryRetryButtonRef.current?.focus()
  }, [busy, memorySaveRecoveryRequired])

  const selected = providers.find((provider) => provider.id === providerId)
  const estimate = disclosure?.estimatedRequests
  const outboundItems = useMemo(
    () =>
      disclosure?.outbound ??
      review.queue
        .filter((item) => item.requiresSegmentationReview !== true)
        .map((item, index) => ({
          id: `preview_${index + 1}`,
          text: item.sourceValue,
          context: `${item.processId} / ${item.elementId} / ${item.field} / ${item.sourceLanguage}→${item.target}`
        })),
    [disclosure, review]
  )
  const fieldPageCount = Math.max(
    1,
    Math.ceil(recoveryFields.length / TRANSLATION_REVIEW_FIELD_PAGE_SIZE)
  )
  const outboundPageCount = Math.max(
    1,
    Math.ceil(outboundItems.length / TRANSLATION_REVIEW_OUTBOUND_PAGE_SIZE)
  )
  const visibleFieldPage = Math.min(fieldPage, fieldPageCount - 1)
  const visibleOutboundPage = Math.min(outboundPage, outboundPageCount - 1)
  const visibleRecoveryFields = recoveryFields.slice(
    visibleFieldPage * TRANSLATION_REVIEW_FIELD_PAGE_SIZE,
    (visibleFieldPage + 1) * TRANSLATION_REVIEW_FIELD_PAGE_SIZE
  )
  const visibleOutboundItems = outboundItems.slice(
    visibleOutboundPage * TRANSLATION_REVIEW_OUTBOUND_PAGE_SIZE,
    (visibleOutboundPage + 1) * TRANSLATION_REVIEW_OUTBOUND_PAGE_SIZE
  )

  const openManualEditor = (field: TranslationRecoveryField): void => {
    setManualError(null)
    setManualDrafts((current) =>
      Object.prototype.hasOwnProperty.call(current, field.id)
        ? current
        : {
            ...current,
            [field.id]:
              acceptedByField.get(field.id)?.value ??
              proposalsByField.get(field.id)?.value ??
              field.currentTargetValue ??
              ''
          }
    )
    setManualFieldId(field.id)
  }

  const acceptProposal = async (
    field: TranslationRecoveryField,
    proposal: TranslationOutputProposal
  ): Promise<void> => {
    if (!onAcceptProposal) return
    setManualSavingFieldId(field.id)
    setManualError(null)
    try {
      await onAcceptProposal(field, proposal)
    } catch (error) {
      setManualError({ kind: 'manual-save', detail: boundedTranslationTechnicalDetail(error) })
    } finally {
      setManualSavingFieldId(null)
    }
  }

  const rejectProposal = async (
    field: TranslationRecoveryField,
    proposal: TranslationOutputProposal
  ): Promise<void> => {
    if (!onRejectProposal) return
    setManualError(null)
    try {
      await onRejectProposal(field, proposal)
    } catch (error) {
      setManualError({ kind: 'manual-save', detail: boundedTranslationTechnicalDetail(error) })
    }
  }

  const saveManualEditor = async (field: TranslationRecoveryField): Promise<void> => {
    if (!onManualEdit) return
    const value = manualDrafts[field.id] ?? ''
    const validation = validateTranslationRecoveryValue(review, field, value)
    if (!validation.valid) {
      setManualError({
        kind: 'manual-validation',
        issueCodes: validation.issues.map((issue) => issue.code)
      })
      return
    }
    setManualSavingFieldId(field.id)
    setManualError(null)
    try {
      await onManualEdit(field, validation.value)
      setManualFieldId(null)
    } catch (error) {
      setManualError({ kind: 'manual-save', detail: boundedTranslationTechnicalDetail(error) })
    } finally {
      setManualSavingFieldId(null)
    }
  }

  const requestRetryField = (field: TranslationRecoveryField): void => {
    if (!disclosure) {
      setManualError({ kind: 'provider-required' })
      return
    }
    setManualError(null)
    setPendingRetryFieldId(field.id)
  }

  const retryField = async (
    field: TranslationRecoveryField,
    fieldDisclosure: ExternalRequestDisclosure
  ): Promise<void> => {
    if (!onRetryField) return
    setPendingRetryFieldId(null)
    setLocalRetryingFieldId(field.id)
    setManualError(null)
    try {
      await onRetryField(field, {
        disclosure: fieldDisclosure,
        consent: grantExternalRequestConsent(fieldDisclosure)
      })
    } catch (error) {
      setManualError({ kind: 'field-retry', detail: boundedTranslationTechnicalDetail(error) })
    } finally {
      setLocalRetryingFieldId(null)
    }
  }

  const activeRetryFieldId = retryingFieldId ?? localRetryingFieldId
  const disclosureProviderMarker = '__ORBITPM_PROVIDER_LABEL__'
  const disclosureParts = disclosure
    ? t('translationReview.outbound.disclosure', {
        provider: disclosureProviderMarker,
        count: disclosure.outbound.length,
        min: estimate?.min ?? 0,
        max: estimate?.max ?? 0
      }).split(disclosureProviderMarker)
    : []

  return (
    <Modal
      title={t('translationReview.title')}
      onClose={
        busy
          ? cancellable
            ? onCancelTranslation
            : () => undefined
          : memorySaveRecoveryRequired
            ? () => undefined
            : onPostpone
      }
      closable={!memorySaveRecoveryRequired && (!busy || cancellable)}
      ariaDescribedby={memoryRecoveryDescriptionId}
      initialFocusRef={memorySaveRecoveryRequired ? memoryRetryButtonRef : undefined}
      maxWidth={760}
      footer={
        <>
          {onRetryMemorySave ? (
            <>
              {onContinueWithoutMemorySave ? (
                <button
                  type="button"
                  className="orbitpm-lite-chrome-btn"
                  onClick={onContinueWithoutMemorySave}
                  disabled={busy}
                >
                  {t('translationReview.memoryContinue')}
                </button>
              ) : null}
              <button
                ref={memoryRetryButtonRef}
                type="button"
                className="orbitpm-lite-chrome-btn"
                onClick={() => void onRetryMemorySave()}
                disabled={busy}
                style={{ fontWeight: 700 }}
              >
                {t('translationReview.memoryRetry')}
              </button>
            </>
          ) : null}
          <button
            type="button"
            className="orbitpm-lite-chrome-btn"
            onClick={onPostpone}
            disabled={busy || memorySaveRecoveryRequired}
          >
            {t('translationReview.postpone')}
          </button>
          {progress.complete ? (
            <button
              type="button"
              className="orbitpm-lite-chrome-btn"
              onClick={() => void (onApplyCompleted ?? onPartialPreview)()}
              disabled={busy || memorySaveRecoveryRequired}
              style={{ fontWeight: 700 }}
            >
              {t('translationReview.applyCompleted')}
            </button>
          ) : (
            <button
              type="button"
              className="orbitpm-lite-chrome-btn"
              onClick={onPartialPreview}
              disabled={busy || memorySaveRecoveryRequired || acceptedValues.length > 0}
            >
              {t('translationReview.partialPreview')}
            </button>
          )}
          {busy ? (
            cancellable && !memorySaveRecoveryRequired ? (
              <button
                type="button"
                className="orbitpm-lite-chrome-btn"
                onClick={onCancelTranslation}
              >
                {t('translationReview.cancel')}
              </button>
            ) : null
          ) : progress.complete ? null : (
            <button
              type="button"
              className="orbitpm-lite-chrome-btn"
              onClick={onTranslateNow}
              disabled={
                memorySaveRecoveryRequired ||
                proposals.length > 0 ||
                acceptedValues.length > 0 ||
                !selected ||
                selected.disabled ||
                !disclosure
              }
              style={{ fontWeight: 700 }}
            >
              {t('translationReview.translateNow')}
            </button>
          )}
        </>
      }
    >
      <div style={{ display: 'grid', gap: 14, fontSize: 13.5 }}>
        {memorySaveRecoveryRequired ? (
          <div
            id={memoryRecoveryDescriptionId}
            role="note"
            style={{
              padding: 10,
              borderRadius: 7,
              border: '1px solid rgba(217,119,6,0.4)',
              background: 'rgba(217,119,6,0.08)'
            }}
          >
            {t('translationReview.memoryRecoveryRequired')}
          </div>
        ) : null}
        <div
          style={{
            padding: 12,
            borderRadius: 8,
            background: 'rgba(217,119,6,0.10)',
            border: '1px solid rgba(217,119,6,0.28)'
          }}
        >
          <strong>{direction}</strong>
          {documentName ? (
            <div style={{ marginTop: 5 }}>
              {t('translationReview.document')}{' '}
              <b dir="auto" style={{ overflowWrap: 'anywhere' }}>
                {documentName}
              </b>
            </div>
          ) : null}
          <div style={{ marginTop: 5, color: 'var(--orbitpm-muted)' }}>
            {t('translationReview.summary', {
              fields: review.fields.length,
              missing: counts.missing,
              invalid: counts.invalid,
              failed: counts.failed
            })}
          </div>
          <div
            role="status"
            aria-live="polite"
            style={{
              marginTop: 7,
              fontWeight: 650,
              color: progress.complete ? '#15803d' : '#9a6200'
            }}
          >
            {progress.complete
              ? t('translationReview.progress.ready')
              : t('translationReview.progress.partial', {
                  resolved: progress.resolved,
                  unresolved: progress.unresolved,
                  failed: progress.failed
                })}
          </div>
        </div>

        <section aria-labelledby="translation-review-fields">
          <div id="translation-review-fields" style={{ fontWeight: 600, marginBottom: 6 }}>
            {t('translationReview.fields.title')}
          </div>
          <ul
            id="translation-review-field-list"
            style={{
              margin: 0,
              padding: 0,
              maxHeight: 360,
              listStyle: 'none',
              overflow: 'auto'
            }}
          >
            {visibleRecoveryFields.map((field) => {
              const proposal = proposalsByField.get(field.id)
              const accepted = acceptedByField.get(field.id)
              const editing = manualFieldId === field.id
              const draft =
                manualDrafts[field.id] ??
                accepted?.value ??
                proposal?.value ??
                field.currentTargetValue ??
                ''
              const validation = editing
                ? validateTranslationRecoveryValue(review, field, draft)
                : null
              const retrying = activeRetryFieldId === field.id
              const confirmingRetry = pendingRetryFieldId === field.id
              const retryDisclosure =
                confirmingRetry && disclosure
                  ? buildTranslationRecoveryDisclosure(field, {
                      providerId: disclosure.providerId,
                      ...(disclosure.modelId === undefined ? {} : { modelId: disclosure.modelId })
                    })
                  : null
              const manualSaving = manualSavingFieldId === field.id
              const manualInputId = `translation-manual-${encodeURIComponent(field.id)}`
              const fieldHeadingId = `translation-field-${encodeURIComponent(field.id)}`
              return (
                <li
                  key={field.id}
                  aria-labelledby={fieldHeadingId}
                  style={{
                    display: 'grid',
                    gap: 7,
                    marginBottom: 8,
                    padding: 10,
                    border: '1px solid var(--orbitpm-border)',
                    borderRadius: 7
                  }}
                >
                  <div>
                    <span id={fieldHeadingId} lang={uiLang === 'ar' ? 'en' : undefined} dir="ltr">
                      {field.elementId} · {field.field} · {field.sourceLanguage}→{field.target}
                    </span>
                    {' · '}
                    {field.issueCodes.map((code, index) => (
                      <span key={code}>
                        {index > 0 ? ', ' : ''}
                        {issueMessage(code)}
                      </span>
                    ))}
                  </div>

                  <dl
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'minmax(90px, auto) minmax(0, 1fr)',
                      gap: '4px 10px',
                      margin: 0
                    }}
                  >
                    <dt style={{ color: 'var(--orbitpm-muted)' }}>
                      {t('translationReview.field.source')}
                    </dt>
                    <dd dir="auto" style={{ margin: 0, overflowWrap: 'anywhere' }}>
                      {field.sourceValue}
                    </dd>
                    <dt style={{ color: 'var(--orbitpm-muted)' }}>
                      {t('translationReview.field.target')}
                    </dt>
                    <dd dir="auto" style={{ margin: 0, overflowWrap: 'anywhere' }}>
                      {field.currentTargetValue || '—'}
                    </dd>
                    {proposal ? (
                      <>
                        <dt style={{ color: 'var(--orbitpm-muted)' }}>
                          {t('translationReview.field.proposed')}
                        </dt>
                        <dd
                          dir={proposal.target === 'ar' ? 'rtl' : 'ltr'}
                          lang={proposal.target}
                          style={{ margin: 0, overflowWrap: 'anywhere', fontWeight: 650 }}
                        >
                          {proposal.value}
                        </dd>
                      </>
                    ) : null}
                    {accepted ? (
                      <>
                        <dt style={{ color: 'var(--orbitpm-muted)' }}>
                          {t('translationReview.field.staged')}
                        </dt>
                        <dd
                          dir={accepted.target === 'ar' ? 'rtl' : 'ltr'}
                          lang={accepted.target}
                          style={{ margin: 0, overflowWrap: 'anywhere', fontWeight: 650 }}
                        >
                          {accepted.value}
                        </dd>
                      </>
                    ) : null}
                  </dl>

                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
                    {proposal && onAcceptProposal && field.editable ? (
                      <button
                        type="button"
                        className="orbitpm-lite-chrome-btn"
                        onClick={() => void acceptProposal(field, proposal)}
                        disabled={busy || memorySaveRecoveryRequired || manualSaving}
                        style={{ fontWeight: 700 }}
                      >
                        {t('translationReview.field.acceptProposal')}
                      </button>
                    ) : null}
                    {proposal && onRejectProposal ? (
                      <button
                        type="button"
                        className="orbitpm-lite-chrome-btn"
                        onClick={() => void rejectProposal(field, proposal)}
                        disabled={busy || memorySaveRecoveryRequired || manualSaving}
                      >
                        {t('translationReview.field.rejectProposal')}
                      </button>
                    ) : null}
                    {!proposal && !accepted && onRetryField && field.retryable ? (
                      <button
                        type="button"
                        className="orbitpm-lite-chrome-btn"
                        onClick={() => requestRetryField(field)}
                        disabled={
                          busy ||
                          memorySaveRecoveryRequired ||
                          retrying ||
                          manualSaving ||
                          confirmingRetry
                        }
                      >
                        {retrying
                          ? t('translationReview.field.retrying')
                          : t('translationReview.field.retry')}
                      </button>
                    ) : null}
                    {onManualEdit && field.editable ? (
                      <button
                        type="button"
                        className="orbitpm-lite-chrome-btn"
                        onClick={() => (editing ? setManualFieldId(null) : openManualEditor(field))}
                        disabled={
                          busy ||
                          memorySaveRecoveryRequired ||
                          retrying ||
                          manualSaving ||
                          confirmingRetry
                        }
                      >
                        {editing
                          ? t('translationReview.field.manualCancel')
                          : t('translationReview.field.manual')}
                      </button>
                    ) : null}
                  </div>
                  {!field.editable ? (
                    <div role="note" style={{ color: 'var(--orbitpm-muted)' }}>
                      {t('translationReview.field.unavailable')}
                    </div>
                  ) : null}

                  {retryDisclosure ? (
                    <section
                      role="region"
                      aria-label={t('translationReview.field.retryDisclosureTitle')}
                      style={{
                        display: 'grid',
                        gap: 8,
                        padding: 10,
                        borderRadius: 7,
                        border: '1px solid rgba(217,119,6,0.4)',
                        background: 'rgba(217,119,6,0.08)'
                      }}
                    >
                      <strong>{t('translationReview.field.retryDisclosureTitle')}</strong>
                      <p style={{ margin: 0 }}>
                        {t('translationReview.field.retryDisclosure', {
                          min: retryDisclosure.estimatedRequests.min,
                          max: retryDisclosure.estimatedRequests.max
                        })}
                      </p>
                      <dl
                        style={{
                          display: 'grid',
                          gridTemplateColumns: 'minmax(110px, auto) minmax(0, 1fr)',
                          gap: '4px 10px',
                          margin: 0
                        }}
                      >
                        <dt>{t('translationReview.field.retryProvider')}</dt>
                        <dd lang="en" dir="ltr" style={{ margin: 0, overflowWrap: 'anywhere' }}>
                          {retryDisclosure.providerId}
                          {retryDisclosure.modelId ? ` · ${retryDisclosure.modelId}` : ''}
                        </dd>
                        <dt>{t('translationReview.field.retryContext')}</dt>
                        <dd lang="en" dir="ltr" style={{ margin: 0, overflowWrap: 'anywhere' }}>
                          {retryDisclosure.outbound[0]?.context}
                        </dd>
                        <dt>{t('translationReview.field.retryFingerprint')}</dt>
                        <dd style={{ margin: 0, overflowWrap: 'anywhere' }}>
                          <code lang="en" dir="ltr">
                            {retryDisclosure.fingerprint}
                          </code>
                        </dd>
                      </dl>
                      <div dir="auto" style={{ overflowWrap: 'anywhere' }}>
                        {retryDisclosure.outbound[0]?.text}
                      </div>
                      <div role="note">
                        {retryDisclosure.sensitiveItemCount > 0
                          ? t('translationReview.field.retrySensitivity.sensitive')
                          : t('translationReview.field.retrySensitivity.standard')}
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
                        <button
                          type="button"
                          className="orbitpm-lite-chrome-btn"
                          onClick={() => setPendingRetryFieldId(null)}
                          disabled={busy || memorySaveRecoveryRequired}
                        >
                          {t('translationReview.field.retryCancel')}
                        </button>
                        <button
                          type="button"
                          className="orbitpm-lite-chrome-btn"
                          onClick={() => void retryField(field, retryDisclosure)}
                          disabled={busy || memorySaveRecoveryRequired}
                          style={{ fontWeight: 700 }}
                        >
                          {t('translationReview.field.retryConfirm')}
                        </button>
                      </div>
                    </section>
                  ) : null}

                  {editing ? (
                    <div style={{ display: 'grid', gap: 6 }}>
                      <label htmlFor={manualInputId}>{t('translationReview.field.manual')}</label>
                      <textarea
                        id={manualInputId}
                        dir={field.target === 'ar' ? 'rtl' : 'ltr'}
                        lang={field.target}
                        rows={3}
                        value={draft}
                        placeholder={t('translationReview.field.manualPlaceholder')}
                        disabled={busy || memorySaveRecoveryRequired || manualSaving}
                        onChange={(event) => {
                          setManualError(null)
                          setManualDrafts((current) => ({
                            ...current,
                            [field.id]: event.target.value
                          }))
                        }}
                        style={{
                          width: '100%',
                          boxSizing: 'border-box',
                          padding: 8,
                          resize: 'vertical',
                          font: 'inherit'
                        }}
                      />
                      {validation && !validation.valid ? (
                        <div role="alert" style={{ color: '#b42318' }}>
                          {validation.issues.length === 0
                            ? t('translationReview.field.manualEmpty')
                            : issueMessages(validation.issues.map((issue) => issue.code))}
                        </div>
                      ) : null}
                      <button
                        type="button"
                        className="orbitpm-lite-chrome-btn"
                        onClick={() => void saveManualEditor(field)}
                        disabled={
                          busy ||
                          memorySaveRecoveryRequired ||
                          manualSaving ||
                          validation?.valid !== true
                        }
                        style={{ justifySelf: 'start', fontWeight: 700 }}
                      >
                        {manualSaving
                          ? t('translationReview.field.manualSaving')
                          : t('translationReview.field.manualSave')}
                      </button>
                    </div>
                  ) : null}
                </li>
              )
            })}
          </ul>
          <ReviewPagination
            ariaLabel={t('translationReview.fields.paginationLabel')}
            controls="translation-review-field-list"
            page={visibleFieldPage}
            pageCount={fieldPageCount}
            pageSize={TRANSLATION_REVIEW_FIELD_PAGE_SIZE}
            total={recoveryFields.length}
            onPageChange={setFieldPage}
          />
        </section>

        <label>
          <span style={{ display: 'block', marginBottom: 5, fontWeight: 600 }}>
            {t('translationReview.provider')}
          </span>
          <select
            value={providerId}
            disabled={busy || memorySaveRecoveryRequired}
            onChange={(event) => onProviderChange(event.target.value)}
            style={{
              width: '100%',
              padding: '0.5rem',
              borderRadius: 6,
              border: '1px solid var(--orbitpm-border)',
              background: 'var(--orbitpm-surface)',
              color: 'inherit'
            }}
          >
            <option value="">{t('translationReview.provider.choose')}</option>
            {providers.map((provider) => (
              <option
                key={provider.id}
                value={provider.id}
                disabled={provider.disabled}
                lang={uiLang === 'ar' ? 'en' : undefined}
                dir="ltr"
              >
                {provider.label}
              </option>
            ))}
          </select>
          {selected && (
            <span
              style={{
                display: 'block',
                marginTop: 5,
                color: 'var(--orbitpm-muted)'
              }}
            >
              {technicalTerms(selected.description, uiLang === 'ar')}
            </span>
          )}
        </label>

        <section aria-labelledby="translation-review-outbound">
          <div id="translation-review-outbound" style={{ fontWeight: 600, marginBottom: 6 }}>
            {t('translationReview.outbound.title')}
          </div>
          <div style={{ color: 'var(--orbitpm-muted)', marginBottom: 8 }}>
            {disclosure ? (
              <>
                {disclosureParts[0]}
                <b lang={uiLang === 'ar' ? 'en' : undefined} dir="ltr">
                  {selected?.label ?? disclosure.providerId}
                </b>
                {disclosureParts.slice(1).join(disclosureProviderMarker)}
              </>
            ) : (
              t('translationReview.outbound.chooseProvider')
            )}
          </div>
          {disclosure && disclosure.sensitiveItemCount > 0 && (
            <div
              role="note"
              style={{
                marginBottom: 8,
                color: '#b45309',
                fontWeight: 600
              }}
            >
              {t('translationReview.sensitive', {
                count: disclosure.sensitiveItemCount
              })}
            </div>
          )}
          <ol
            id="translation-review-outbound-list"
            style={{
              margin: 0,
              paddingInlineStart: 28,
              maxHeight: 240,
              overflow: 'auto',
              border: '1px solid var(--orbitpm-border)',
              borderRadius: 7
            }}
          >
            {visibleOutboundItems.map((item) => (
              <li
                key={item.id}
                style={{
                  padding: '8px 10px',
                  borderBottom: '1px solid var(--orbitpm-border)'
                }}
              >
                <div dir="auto" style={{ overflowWrap: 'anywhere' }}>
                  {item.text}
                </div>
                {item.context && (
                  <div
                    lang={uiLang === 'ar' ? 'en' : undefined}
                    dir="ltr"
                    style={{
                      marginTop: 3,
                      color: 'var(--orbitpm-muted)',
                      fontSize: 11.5
                    }}
                  >
                    {item.context}
                  </div>
                )}
              </li>
            ))}
          </ol>
          <ReviewPagination
            ariaLabel={t('translationReview.outbound.paginationLabel')}
            controls="translation-review-outbound-list"
            page={visibleOutboundPage}
            pageCount={outboundPageCount}
            pageSize={TRANSLATION_REVIEW_OUTBOUND_PAGE_SIZE}
            total={outboundItems.length}
            onPageChange={setOutboundPage}
          />
        </section>

        {review.queue.some((item) => item.requiresSegmentationReview) && (
          <div role="note" style={{ color: '#b45309' }}>
            {t('translationReview.mixedManual')}
          </div>
        )}

        {manualError && (
          <div role="alert" aria-live="assertive" style={{ color: '#b42318' }}>
            <div>{reviewFailureMessage(manualError)}</div>
            <TechnicalEvidence detail={reviewFailureDetail(manualError)} />
          </div>
        )}

        {status && (
          <div
            role={busy ? 'status' : 'alert'}
            aria-live="polite"
            style={{ color: busy ? 'inherit' : '#b42318' }}
          >
            <div>{status}</div>
            <TechnicalEvidence detail={technicalDetail} />
          </div>
        )}
      </div>
    </Modal>
  )
}

export default TranslationReviewDialog
