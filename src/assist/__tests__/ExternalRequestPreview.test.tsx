import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ExternalRequestPreview } from '../ExternalRequestPreview'
import { t } from '../../i18n'
import { createLlmMessageDisclosure } from '../requestReview'

const noop = (): void => {}
const disclosure = createLlmMessageDisclosure({
  purpose: 'assistant',
  providerId: 'OpenRouter',
  modelId: 'reviewed/model',
  messages: [{ role: 'user', content: 'Exact outbound text' }],
  sensitiveMessageIndexes: [0],
  estimatedRequests: { min: 1, max: 3 }
})

describe('ExternalRequestPreview', () => {
  it('renders exact outbound text, privacy controls, estimate, and disabled consent gate', () => {
    const html = renderToStaticMarkup(
      <ExternalRequestPreview
        disclosure={disclosure}
        includeWorkspaceContext={false}
        redactNames={true}
        consented={false}
        busy={false}
        onIncludeWorkspaceContextChange={noop}
        onRedactNamesChange={noop}
        onConsentChange={noop}
        onConfirm={noop}
        onCancel={noop}
      />
    )
    expect(html).toContain('Exact outbound text')
    expect(html).toContain(t('ai.privacy.preview.title'))
    expect(html).toContain(t('ai.privacy.consent'))
    expect(html).toContain('disabled=""')
  })

  it('shows cancellation and a visible retry-attempt status while busy', () => {
    const html = renderToStaticMarkup(
      <ExternalRequestPreview
        disclosure={disclosure}
        includeWorkspaceContext={true}
        redactNames={false}
        consented={true}
        busy={true}
        attemptStatus="Attempt 2 of 3"
        onIncludeWorkspaceContextChange={noop}
        onRedactNamesChange={noop}
        onConsentChange={noop}
        onConfirm={noop}
        onCancel={noop}
      />
    )
    expect(html).toContain('Attempt 2 of 3')
    expect(html).toContain('role="status"')
    expect(html).toContain(t('ai.cancel'))
  })

  it('renders name and sensitive-metadata classifications independently', () => {
    const renderSensitivity = (content: string): string =>
      renderToStaticMarkup(
        <ExternalRequestPreview
          disclosure={createLlmMessageDisclosure({
            purpose: 'assistant',
            providerId: 'OpenRouter',
            modelId: 'reviewed/model',
            messages: [{ role: 'user', content }]
          })}
          includeWorkspaceContext={false}
          redactNames={false}
          consented={false}
          busy={false}
          onIncludeWorkspaceContextChange={noop}
          onRedactNamesChange={noop}
          onConsentChange={noop}
          onConfirm={noop}
          onCancel={noop}
        />
      )

    expect(renderSensitivity('Alice Smith approves')).toContain(
      t('ai.privacy.sensitivity', {
        names: t('common.yes'),
        sensitive: t('common.no')
      })
    )
    expect(renderSensitivity('Contact alice@example.test')).toContain(
      t('ai.privacy.sensitivity', {
        names: t('common.no'),
        sensitive: t('common.yes')
      })
    )
  })
})
