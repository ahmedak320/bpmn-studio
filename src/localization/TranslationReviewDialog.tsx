import { useMemo } from 'react'
import { Modal } from '../workspace/Modal'
import { t } from '../i18n'
import { useLang } from '../i18n/useLang'
import type { ExternalRequestDisclosure } from './externalRequestReview'
import type { DiagramLocalizationReview } from './modelerAdapter'

export interface TranslationReviewProviderOption {
  id: string
  label: string
  description: string
  disabled?: boolean
}

export interface TranslationReviewDialogProps {
  review: DiagramLocalizationReview
  disclosure: ExternalRequestDisclosure | null
  providers: readonly TranslationReviewProviderOption[]
  providerId: string
  busy?: boolean
  status?: string | null
  onProviderChange(providerId: string): void
  onTranslateNow(): void
  onPartialPreview(): void
  onPostpone(): void
  onCancelTranslation(): void
}

function issueCount(
  review: DiagramLocalizationReview,
  code: 'missing' | 'wrong-script' | 'mixed' | 'provider-failed'
): number {
  return review.issues.filter((issue) => issue.target === review.target && issue.code === code)
    .length
}

export function TranslationReviewDialog({
  review,
  disclosure,
  providers,
  providerId,
  busy = false,
  status,
  onProviderChange,
  onTranslateNow,
  onPartialPreview,
  onPostpone,
  onCancelTranslation
}: TranslationReviewDialogProps): JSX.Element {
  useLang()
  const direction =
    review.target === 'ar'
      ? t('translationReview.direction.enAr')
      : t('translationReview.direction.arEn')
  const counts = useMemo(
    () => ({
      missing: issueCount(review, 'missing'),
      invalid: issueCount(review, 'wrong-script') + issueCount(review, 'mixed'),
      failed: issueCount(review, 'provider-failed')
    }),
    [review]
  )
  const selected = providers.find((provider) => provider.id === providerId)
  const estimate = disclosure?.estimatedRequests
  const outboundItems =
    disclosure?.outbound ??
    review.queue
      .filter((item) => item.requiresSegmentationReview !== true)
      .map((item, index) => ({
        id: `preview_${index + 1}`,
        text: item.sourceValue,
        context: `${item.processId} / ${item.elementId} / ${item.field} / ${item.sourceLanguage}→${item.target}`
      }))

  return (
    <Modal
      title={t('translationReview.title')}
      onClose={busy ? onCancelTranslation : onPostpone}
      maxWidth={760}
      footer={
        <>
          <button
            type="button"
            className="orbitpm-lite-chrome-btn"
            onClick={onPostpone}
            disabled={busy}
          >
            {t('translationReview.postpone')}
          </button>
          <button
            type="button"
            className="orbitpm-lite-chrome-btn"
            onClick={onPartialPreview}
            disabled={busy}
          >
            {t('translationReview.partialPreview')}
          </button>
          {busy ? (
            <button type="button" className="orbitpm-lite-chrome-btn" onClick={onCancelTranslation}>
              {t('translationReview.cancel')}
            </button>
          ) : (
            <button
              type="button"
              className="orbitpm-lite-chrome-btn"
              onClick={onTranslateNow}
              disabled={!selected || selected.disabled || !disclosure}
              style={{ fontWeight: 700 }}
            >
              {t('translationReview.translateNow')}
            </button>
          )}
        </>
      }
    >
      <div style={{ display: 'grid', gap: 14, fontSize: 13.5 }}>
        <div
          style={{
            padding: 12,
            borderRadius: 8,
            background: 'rgba(217,119,6,0.10)',
            border: '1px solid rgba(217,119,6,0.28)'
          }}
        >
          <strong>{direction}</strong>
          <div style={{ marginTop: 5, color: 'var(--orbitpm-muted)' }}>
            {t('translationReview.summary', {
              fields: review.fields.length,
              missing: counts.missing,
              invalid: counts.invalid,
              failed: counts.failed
            })}
          </div>
        </div>

        <section aria-labelledby="translation-review-fields">
          <div id="translation-review-fields" style={{ fontWeight: 600, marginBottom: 6 }}>
            {t('translationReview.fields.title')}
          </div>
          <ul
            style={{
              margin: 0,
              paddingInlineStart: 22,
              maxHeight: 120,
              overflow: 'auto'
            }}
          >
            {review.blockers.map((issue) => (
              <li
                key={`${issue.processId}/${issue.elementId}/${issue.field}/${issue.code}`}
                style={{ marginBottom: 4 }}
              >
                <span dir="auto">
                  {issue.elementId} · {issue.field} ·{' '}
                  {t('translationReview.fields.issue', {
                    issue: issue.code
                  })}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <label>
          <span style={{ display: 'block', marginBottom: 5, fontWeight: 600 }}>
            {t('translationReview.provider')}
          </span>
          <select
            value={providerId}
            disabled={busy}
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
              <option key={provider.id} value={provider.id} disabled={provider.disabled}>
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
              {selected.description}
            </span>
          )}
        </label>

        <section aria-labelledby="translation-review-outbound">
          <div id="translation-review-outbound" style={{ fontWeight: 600, marginBottom: 6 }}>
            {t('translationReview.outbound.title')}
          </div>
          <div style={{ color: 'var(--orbitpm-muted)', marginBottom: 8 }}>
            {disclosure
              ? t('translationReview.outbound.disclosure', {
                  provider: selected?.label ?? disclosure.providerId,
                  count: disclosure.outbound.length,
                  min: estimate?.min ?? 0,
                  max: estimate?.max ?? 0
                })
              : t('translationReview.outbound.chooseProvider')}
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
            style={{
              margin: 0,
              paddingInlineStart: 28,
              maxHeight: 240,
              overflow: 'auto',
              border: '1px solid var(--orbitpm-border)',
              borderRadius: 7
            }}
          >
            {outboundItems.map((item) => (
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
        </section>

        {review.queue.some((item) => item.requiresSegmentationReview) && (
          <div role="note" style={{ color: '#b45309' }}>
            {t('translationReview.mixedManual')}
          </div>
        )}

        {status && (
          <div
            role={busy ? 'status' : 'alert'}
            aria-live="polite"
            style={{ color: busy ? 'inherit' : '#b42318' }}
          >
            {status}
          </div>
        )}
      </div>
    </Modal>
  )
}

export default TranslationReviewDialog
