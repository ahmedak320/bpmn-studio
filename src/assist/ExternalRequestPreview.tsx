import type { CSSProperties } from 'react'
import { t } from '../i18n'
import { useLang } from '../i18n/useLang'
import type { ReviewedExternalRequestDisclosure } from './requestReview'

export interface ExternalRequestPreviewProps {
  disclosure: ReviewedExternalRequestDisclosure
  includeWorkspaceContext: boolean
  redactNames: boolean
  consented: boolean
  busy: boolean
  attemptStatus?: string | null
  onIncludeWorkspaceContextChange(value: boolean): void
  onRedactNamesChange(value: boolean): void
  onConsentChange(value: boolean): void
  onConfirm(): void
  onCancel(): void
}

export function ExternalRequestPreview({
  disclosure,
  includeWorkspaceContext,
  redactNames,
  consented,
  busy,
  attemptStatus,
  onIncludeWorkspaceContextChange,
  onRedactNamesChange,
  onConsentChange,
  onConfirm,
  onCancel
}: ExternalRequestPreviewProps): JSX.Element {
  useLang()
  return (
    <section aria-label={t('ai.privacy.preview.title')} style={PREVIEW_STYLE}>
      <strong>{t('ai.privacy.preview.title')}</strong>
      <div>
        {t('ai.privacy.providerModel', {
          provider: disclosure.providerId,
          model: disclosure.modelId ?? '—'
        })}
      </div>
      <label style={CHECK_STYLE}>
        <input
          type="checkbox"
          checked={includeWorkspaceContext}
          disabled={busy}
          onChange={(event) => onIncludeWorkspaceContextChange(event.target.checked)}
        />
        <span>{t('ai.privacy.includeWorkspace')}</span>
      </label>
      <label style={CHECK_STYLE}>
        <input
          type="checkbox"
          checked={redactNames}
          disabled={busy}
          onChange={(event) => onRedactNamesChange(event.target.checked)}
        />
        <span>{t('ai.privacy.redactNames')}</span>
      </label>
      <div>
        {t('ai.privacy.sensitivity', {
          names: disclosure.containsNames ? t('common.yes') : t('common.no'),
          sensitive: disclosure.containsSensitiveMetadata ? t('common.yes') : t('common.no')
        })}
      </div>
      <div>
        {t('ai.privacy.requestCount', {
          count: disclosure.estimatedRequests.max
        })}
      </div>
      <ol style={OUTBOUND_STYLE}>
        {disclosure.outbound.map((item) => (
          <li key={item.id} style={{ paddingBlock: 5 }}>
            <div dir="auto" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
              {item.text}
            </div>
            {item.context && (
              <small style={{ color: 'var(--orbitpm-muted)' }}>{item.context}</small>
            )}
          </li>
        ))}
      </ol>
      <label style={CHECK_STYLE}>
        <input
          type="checkbox"
          checked={consented}
          disabled={busy}
          onChange={(event) => onConsentChange(event.target.checked)}
        />
        <strong>{t('ai.privacy.consent')}</strong>
      </label>
      {attemptStatus && (
        <div role="status" aria-live="polite">
          {attemptStatus}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button type="button" onClick={onCancel} style={BUTTON_STYLE}>
          {t('ai.cancel')}
        </button>
        {!busy && (
          <button
            type="button"
            onClick={onConfirm}
            disabled={!consented}
            style={{
              ...BUTTON_STYLE,
              background: consented ? 'var(--orbitpm-accent)' : undefined,
              color: consented ? '#fff' : undefined
            }}
          >
            {t('assist.send')}
          </button>
        )}
      </div>
    </section>
  )
}

const PREVIEW_STYLE: CSSProperties = {
  display: 'grid',
  gap: 8,
  margin: '0.55rem 0.8rem',
  padding: '0.65rem',
  border: '1px solid var(--orbitpm-border)',
  borderRadius: 8,
  background: 'var(--orbitpm-panel-bg)',
  fontSize: 11.5,
  maxHeight: '45dvh',
  overflow: 'auto'
}

const CHECK_STYLE: CSSProperties = {
  display: 'flex',
  gap: 7,
  alignItems: 'flex-start'
}

const OUTBOUND_STYLE: CSSProperties = {
  margin: 0,
  paddingInlineStart: 22,
  maxHeight: 150,
  overflow: 'auto',
  borderBlock: '1px solid var(--orbitpm-border)'
}

const BUTTON_STYLE: CSSProperties = {
  minHeight: 32,
  border: '1px solid var(--orbitpm-border)',
  borderRadius: 6,
  background: 'transparent',
  color: 'inherit',
  paddingInline: 10,
  cursor: 'pointer'
}

export default ExternalRequestPreview
