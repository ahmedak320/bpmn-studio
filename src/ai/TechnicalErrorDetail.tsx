import { t } from '../i18n'

export interface TechnicalErrorDetailProps {
  detail?: string | null
}

/**
 * Diagnostics are support evidence, not translated interface copy. Keep the
 * bounded value isolated from the surrounding locale so Arabic screen readers
 * do not announce English/provider tokens as Arabic prose.
 */
export function TechnicalErrorDetail({ detail }: TechnicalErrorDetailProps): JSX.Element | null {
  if (!detail?.trim()) return null
  return (
    <span
      data-ai-technical-detail
      style={{ display: 'block', marginTop: 4, opacity: 0.85, overflowWrap: 'anywhere' }}
    >
      <span>{t('ai.error.technicalDetail')}</span>{' '}
      <code lang="en" dir="ltr">
        {detail}
      </code>
    </span>
  )
}
