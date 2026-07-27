// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { setLang, t } from '../../i18n'
import { createExternalRequestDisclosure } from '../externalRequestReview'
import {
  TRANSLATION_REVIEW_FIELD_PAGE_SIZE,
  TRANSLATION_REVIEW_OUTBOUND_PAGE_SIZE,
  TRANSLATION_TECHNICAL_DETAIL_LIMIT,
  TranslationReviewDialog,
  boundedTranslationTechnicalDetail
} from '../TranslationReviewDialog'
import {
  LocalizationSource,
  type LocalizationField,
  type LocalizationIssue,
  type TranslationQueueItem
} from '../types'
import type { DiagramLocalizationReview } from '../modelerAdapter'

const field: LocalizationField = {
  source: LocalizationSource.Editor,
  processId: 'Process_1',
  elementId: 'Task_1',
  elementType: 'bpmn:Task',
  field: 'name',
  kind: 'name',
  value: { en: 'Review request', active: 'en' },
  sourceLanguage: 'en',
  projection: 'Review request',
  origins: { en: 'paired' },
  storage: {
    enProperty: 'orbitpm:nameEn',
    arProperty: 'orbitpm:nameAr',
    projectionProperty: 'name'
  },
  planeIds: ['Plane_1']
}

const missing: LocalizationIssue = {
  source: LocalizationSource.Editor,
  processId: field.processId,
  elementId: field.elementId,
  field: field.field,
  target: 'ar',
  code: 'missing'
}

const failed: LocalizationIssue = {
  ...missing,
  code: 'provider-failed',
  originalValue: 'Review request'
}

const queueItem: TranslationQueueItem = {
  source: LocalizationSource.Editor,
  processId: field.processId,
  elementId: field.elementId,
  field: field.field,
  sourceLanguage: 'en',
  sourceValue: 'Review request',
  target: 'ar',
  issues: [missing, failed]
}

function failedReview(): DiagramLocalizationReview {
  return {
    source: LocalizationSource.Editor,
    target: 'ar',
    fields: [field],
    issues: [missing, failed],
    queue: [queueItem],
    localUpdates: [],
    projected: 0,
    unchanged: 1,
    blockers: [missing, failed],
    complete: false,
    localResources: { glossary: [], translationMemory: [] }
  }
}

function completedReview(): DiagramLocalizationReview {
  const completedField: LocalizationField = {
    ...field,
    value: { en: 'Review request', ar: 'مراجعة الطلب', active: 'ar' },
    projection: 'مراجعة الطلب',
    origins: { en: 'paired', ar: 'paired' }
  }
  return {
    source: LocalizationSource.Editor,
    target: 'ar',
    fields: [completedField],
    issues: [],
    queue: [],
    localUpdates: [],
    projected: 1,
    unchanged: 0,
    blockers: [],
    complete: true,
    localResources: { glossary: [], translationMemory: [] }
  }
}

function largeFailedReview(count: number): DiagramLocalizationReview {
  const fields: LocalizationField[] = []
  const issues: LocalizationIssue[] = []
  const queue: TranslationQueueItem[] = []
  for (let index = 0; index < count; index += 1) {
    const nextField: LocalizationField = {
      ...field,
      elementId: `Task_${index}`,
      value: { en: `Review request ${index}`, active: 'en' },
      projection: `Review request ${index}`
    }
    const nextIssue: LocalizationIssue = {
      ...missing,
      elementId: nextField.elementId
    }
    fields.push(nextField)
    issues.push(nextIssue)
    queue.push({
      ...queueItem,
      elementId: nextField.elementId,
      sourceValue: nextField.value.en!,
      issues: [nextIssue]
    })
  }
  return {
    source: LocalizationSource.Editor,
    target: 'ar',
    fields,
    issues,
    queue,
    localUpdates: [],
    projected: 0,
    unchanged: count,
    blockers: issues,
    complete: false,
    localResources: { glossary: [], translationMemory: [] }
  }
}

afterEach(() => {
  cleanup()
  setLang('en')
})

describe('TranslationReviewDialog recovery controls', () => {
  it('requires an explicit accept, edit, or reject decision for provider proposals', async () => {
    const user = userEvent.setup()
    const onAcceptProposal = vi.fn(async () => undefined)
    const onRejectProposal = vi.fn(async () => undefined)
    const onManualEdit = vi.fn(async () => undefined)
    render(
      <TranslationReviewDialog
        review={failedReview()}
        disclosure={createExternalRequestDisclosure({
          purpose: 'diagram-localization',
          providerId: 'provider',
          outbound: [{ id: 'loc_1', text: 'Review request' }],
          estimatedRequests: { min: 1, max: 1 }
        })}
        providers={[{ id: 'provider', label: 'Provider', description: 'Provider' }]}
        providerId="provider"
        proposals={[
          {
            processId: 'Process_1',
            elementId: 'Task_1',
            field: 'name',
            sourceLanguage: 'en',
            sourceValue: 'Review request',
            target: 'ar',
            value: 'اقتراح المزوّد'
          }
        ]}
        onProviderChange={vi.fn()}
        onTranslateNow={vi.fn()}
        onPartialPreview={vi.fn()}
        onPostpone={vi.fn()}
        onCancelTranslation={vi.fn()}
        onManualEdit={onManualEdit}
        onAcceptProposal={onAcceptProposal}
        onRejectProposal={onRejectProposal}
      />
    )

    expect(screen.getByText('اقتراح المزوّد')).not.toBeNull()
    expect(
      (
        screen.getByRole('button', {
          name: t('translationReview.translateNow')
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true)
    expect(screen.queryByRole('button', { name: t('translationReview.field.retry') })).toBeNull()

    await user.click(
      screen.getByRole('button', { name: t('translationReview.field.acceptProposal') })
    )
    expect(onAcceptProposal).toHaveBeenCalledWith(
      expect.objectContaining({ elementId: 'Task_1', sourceValue: 'Review request' }),
      expect.objectContaining({ value: 'اقتراح المزوّد' })
    )
    await user.click(
      screen.getByRole('button', { name: t('translationReview.field.rejectProposal') })
    )
    expect(onRejectProposal).toHaveBeenCalledWith(
      expect.objectContaining({ elementId: 'Task_1' }),
      expect.objectContaining({ value: 'اقتراح المزوّد' })
    )

    await user.click(screen.getByRole('button', { name: t('translationReview.field.manual') }))
    const editor = screen.getByRole('textbox', {
      name: t('translationReview.field.manual')
    }) as HTMLTextAreaElement
    expect(editor.value).toBe('اقتراح المزوّد')
    await user.clear(editor)
    await user.type(editor, 'قيمة مصححة')
    await user.click(screen.getByRole('button', { name: t('translationReview.field.manualSave') }))
    expect(onManualEdit).toHaveBeenCalledWith(
      expect.objectContaining({ elementId: 'Task_1' }),
      'قيمة مصححة'
    )
  })

  it('does not expose an impossible manual Save for an issue with no BPMN storage target', () => {
    const orphan: DiagramLocalizationReview = {
      ...failedReview(),
      fields: [],
      queue: [],
      issues: [{ ...missing, elementId: 'Removed_Task' }],
      blockers: [{ ...missing, elementId: 'Removed_Task' }]
    }
    render(
      <TranslationReviewDialog
        review={orphan}
        disclosure={null}
        providers={[]}
        providerId=""
        onProviderChange={vi.fn()}
        onTranslateNow={vi.fn()}
        onPartialPreview={vi.fn()}
        onPostpone={vi.fn()}
        onCancelTranslation={vi.fn()}
        onManualEdit={vi.fn()}
      />
    )

    expect(screen.queryByRole('button', { name: t('translationReview.field.manual') })).toBeNull()
    expect(screen.getByRole('note').textContent).toBe(t('translationReview.field.unavailable'))
  })

  it('keeps partial status truthful and exposes exact per-field retry/manual recovery', async () => {
    setLang('ar')
    const user = userEvent.setup()
    const review = failedReview()
    const disclosure = createExternalRequestDisclosure({
      purpose: 'diagram-localization',
      providerId: 'openrouter',
      modelId: 'model-v1',
      outbound: [{ id: 'loc_1', text: 'Review request' }],
      estimatedRequests: { min: 1, max: 2 }
    })
    const onRetryField = vi.fn(async () => undefined)
    const onManualEdit = vi.fn(async () => undefined)

    render(
      <TranslationReviewDialog
        review={review}
        disclosure={disclosure}
        providers={[
          {
            id: 'selected-ai',
            label: 'OpenRouter · model-v1',
            description: 'سيستعمل OpenRouter النموذج المحدد.'
          }
        ]}
        providerId="selected-ai"
        status="فشل جزئي"
        onProviderChange={vi.fn()}
        onTranslateNow={vi.fn()}
        onPartialPreview={vi.fn()}
        onPostpone={vi.fn()}
        onCancelTranslation={vi.fn()}
        onRetryField={onRetryField}
        onManualEdit={onManualEdit}
      />
    )

    expect(screen.getByText(/1 غير محلول/).textContent).toContain('لم تكتمل لغة المخطط')
    const providerOption = screen.getByRole('option', { name: 'OpenRouter · model-v1' })
    expect(providerOption.getAttribute('lang')).toBe('en')
    expect(providerOption.getAttribute('dir')).toBe('ltr')
    const providerMentions = screen.getAllByText('OpenRouter')
    expect(providerMentions.some((node) => node.getAttribute('lang') === 'en')).toBe(true)

    const retryButton = screen.getByRole('button', { name: 'إعادة محاولة هذا الحقل' })
    const recoveryRow = retryButton.closest('li')
    if (!recoveryRow) throw new Error('Missing translation recovery row')
    expect(within(recoveryRow).getByText(t('translationReview.issue.missing'))).not.toBeNull()
    expect(recoveryRow.textContent).toContain(t('translationReview.issue.providerFailed'))
    expect(within(recoveryRow).queryByText('missing')).toBeNull()
    expect(within(recoveryRow).queryByText('provider-failed')).toBeNull()
    await user.click(retryButton)
    expect(onRetryField).not.toHaveBeenCalled()
    const confirmation = within(recoveryRow).getByRole('region', {
      name: 'تأكيد طلب هذا الحقل الواحد'
    })
    expect(within(confirmation).getByText('openrouter · model-v1')).not.toBeNull()
    expect(within(confirmation).getByText('Process_1 / Task_1 / name / en→ar')).not.toBeNull()
    expect(within(confirmation).getByText('Review request')).not.toBeNull()
    expect(within(confirmation).getByText(/^review-[0-9a-f]{8}$/u)).not.toBeNull()
    expect(within(confirmation).getByText('هذا الحقل غير مصنّف كحقل مالك/مسؤولية.')).not.toBeNull()
    expect(confirmation.textContent).toContain('1–6')
    await user.click(
      within(confirmation).getByRole('button', { name: 'إلغاء إعادة محاولة الحقل الواحد' })
    )
    expect(onRetryField).not.toHaveBeenCalled()

    await user.click(retryButton)
    const confirmed = within(recoveryRow).getByRole('region', {
      name: 'تأكيد طلب هذا الحقل الواحد'
    })
    await user.click(
      within(confirmed).getByRole('button', { name: 'تأكيد وإعادة محاولة هذا الحقل' })
    )
    await waitFor(() =>
      expect(onRetryField).toHaveBeenCalledWith(
        expect.objectContaining({
          elementId: 'Task_1',
          field: 'name',
          sourceValue: 'Review request',
          target: 'ar'
        }),
        expect.objectContaining({
          disclosure: expect.objectContaining({
            purpose: 'diagram-localization-field-retry',
            providerId: 'openrouter',
            modelId: 'model-v1',
            outbound: [
              expect.objectContaining({
                text: 'Review request',
                context: 'Process_1 / Task_1 / name / en→ar'
              })
            ],
            fingerprint: expect.stringMatching(/^review-[0-9a-f]{8}$/u)
          }),
          consent: expect.objectContaining({
            fingerprint: expect.stringMatching(/^review-[0-9a-f]{8}$/u)
          })
        })
      )
    )

    await user.click(within(recoveryRow).getByRole('button', { name: 'تعديل هذا الحقل يدويًا' }))
    const editor = within(recoveryRow).getByRole('textbox', {
      name: 'تعديل هذا الحقل يدويًا'
    })
    await user.type(editor, 'Still English')
    expect(within(recoveryRow).getByText(t('translationReview.issue.wrongScript'))).not.toBeNull()
    expect(within(recoveryRow).queryByText('wrong-script')).toBeNull()
    expect(
      within(recoveryRow)
        .getByRole('button', { name: 'حفظ القيمة المراجعة' })
        .hasAttribute('disabled')
    ).toBe(true)
    await user.clear(editor)
    await user.type(editor, 'مراجعة الطلب')
    await user.click(within(recoveryRow).getByRole('button', { name: 'حفظ القيمة المراجعة' }))
    await waitFor(() =>
      expect(onManualEdit).toHaveBeenCalledWith(
        expect.objectContaining({ elementId: 'Task_1', target: 'ar' }),
        'مراجعة الطلب'
      )
    )
  })

  it('localizes caught retry and manual-save failures while retaining code-styled evidence', async () => {
    setLang('ar')
    const user = userEvent.setup()
    const disclosure = createExternalRequestDisclosure({
      purpose: 'diagram-localization',
      providerId: 'openrouter',
      modelId: 'model-v1',
      outbound: [{ id: 'loc_1', text: 'Review request' }],
      estimatedRequests: { min: 1, max: 2 }
    })
    const onRetryField = vi.fn(() => Promise.reject('native retry transport failed'))
    const onManualEdit = vi.fn(async () => {
      throw new Error('native modeler update failed')
    })

    render(
      <TranslationReviewDialog
        review={failedReview()}
        disclosure={disclosure}
        providers={[
          {
            id: 'selected-ai',
            label: 'OpenRouter · model-v1',
            description: 'OpenRouter provider'
          }
        ]}
        providerId="selected-ai"
        onProviderChange={vi.fn()}
        onTranslateNow={vi.fn()}
        onPartialPreview={vi.fn()}
        onPostpone={vi.fn()}
        onCancelTranslation={vi.fn()}
        onRetryField={onRetryField}
        onManualEdit={onManualEdit}
      />
    )

    const retryButton = screen.getByRole('button', {
      name: t('translationReview.field.retry')
    })
    const recoveryRow = retryButton.closest('li')
    if (!recoveryRow) throw new Error('Missing translation recovery row')
    await user.click(retryButton)
    await user.click(
      within(recoveryRow).getByRole('button', {
        name: t('translationReview.field.retryConfirm')
      })
    )

    let alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain(t('translationReview.field.retryFailed'))
    let detail = within(alert).getByLabelText(t('translationReview.error.technicalDetail'))
    expect(detail.tagName).toBe('CODE')
    expect(detail.getAttribute('lang')).toBe('en')
    expect(detail.getAttribute('dir')).toBe('ltr')
    expect(detail.textContent).toBe('native retry transport failed')

    await user.click(
      within(recoveryRow).getByRole('button', {
        name: t('translationReview.field.manual')
      })
    )
    const editor = within(recoveryRow).getByRole('textbox', {
      name: t('translationReview.field.manual')
    })
    await user.type(editor, 'مراجعة الطلب')
    await user.click(
      within(recoveryRow).getByRole('button', {
        name: t('translationReview.field.manualSave')
      })
    )

    await waitFor(() => {
      alert = screen.getByRole('alert')
      expect(alert.textContent).toContain(t('translationReview.field.manualFailed'))
    })
    detail = within(alert).getByLabelText(t('translationReview.error.technicalDetail'))
    expect(detail.tagName).toBe('CODE')
    expect(detail.getAttribute('lang')).toBe('en')
    expect(detail.textContent).toBe('native modeler update failed')
  })

  it('localizes duplicate/mixed issues and explains that retry needs a provider', async () => {
    const user = userEvent.setup()
    const duplicate: LocalizationIssue = { ...missing, code: 'duplicate-counterpart' }
    const mixed: LocalizationIssue = { ...missing, code: 'mixed' }
    const review: DiagramLocalizationReview = {
      ...failedReview(),
      issues: [duplicate, mixed],
      blockers: [duplicate, mixed],
      queue: [{ ...queueItem, issues: [duplicate, mixed] }]
    }

    render(
      <TranslationReviewDialog
        review={review}
        disclosure={null}
        providers={[]}
        providerId=""
        onProviderChange={vi.fn()}
        onTranslateNow={vi.fn()}
        onPartialPreview={vi.fn()}
        onPostpone={vi.fn()}
        onCancelTranslation={vi.fn()}
        onRetryField={vi.fn()}
      />
    )

    expect(screen.getByText(t('translationReview.issue.duplicateCounterpart'))).not.toBeNull()
    expect(document.body.textContent).toContain(t('translationReview.issue.mixed'))
    await user.click(
      screen.getByRole('button', {
        name: t('translationReview.field.retry')
      })
    )

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe(t('translationReview.noProvider'))
    expect(within(alert).queryByText(t('translationReview.error.technicalDetails'))).toBeNull()
  })

  it('applies a completed review through the explicit callback or preview fallback', async () => {
    const user = userEvent.setup()
    const onApplyCompleted = vi.fn()
    const onPartialPreview = vi.fn()
    const commonProps = {
      review: completedReview(),
      documentName: 'completed-process.bpmn',
      disclosure: null,
      providers: [],
      providerId: '',
      onProviderChange: vi.fn(),
      onTranslateNow: vi.fn(),
      onPartialPreview,
      onPostpone: vi.fn(),
      onCancelTranslation: vi.fn()
    }
    const { rerender } = render(
      <TranslationReviewDialog {...commonProps} onApplyCompleted={onApplyCompleted} />
    )

    expect(screen.getByText('completed-process.bpmn')).not.toBeNull()
    expect(screen.getByText(t('translationReview.progress.ready'))).not.toBeNull()
    await user.click(
      screen.getByRole('button', {
        name: t('translationReview.applyCompleted')
      })
    )
    expect(onApplyCompleted).toHaveBeenCalledOnce()
    expect(onPartialPreview).not.toHaveBeenCalled()

    rerender(<TranslationReviewDialog {...commonProps} />)
    await user.click(
      screen.getByRole('button', {
        name: t('translationReview.applyCompleted')
      })
    )
    expect(onPartialPreview).toHaveBeenCalledOnce()
  })

  it('keeps the modal open while busy work is explicitly non-cancellable', async () => {
    const onPostpone = vi.fn()
    const onCancelTranslation = vi.fn()
    const onTranslateNow = vi.fn()
    render(
      <TranslationReviewDialog
        review={failedReview()}
        disclosure={null}
        providers={[]}
        providerId=""
        busy
        cancellable={false}
        onProviderChange={vi.fn()}
        onTranslateNow={onTranslateNow}
        onPartialPreview={vi.fn()}
        onPostpone={onPostpone}
        onCancelTranslation={onCancelTranslation}
      />
    )

    expect(screen.queryByRole('button', { name: t('modal.close.aria') })).toBeNull()
    expect(screen.queryByRole('button', { name: t('translationReview.translateNow') })).toBeNull()
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.mouseDown(document.querySelector<HTMLElement>('[role="presentation"]')!)
    expect(onPostpone).not.toHaveBeenCalled()
    expect(onCancelTranslation).not.toHaveBeenCalled()
    expect(onTranslateNow).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).not.toBeNull()
  })

  it('routes every enabled dismissal control to a real postpone or cancel action', async () => {
    const user = userEvent.setup()
    const onPostpone = vi.fn()
    const ordinary = render(
      <TranslationReviewDialog
        review={failedReview()}
        disclosure={null}
        providers={[]}
        providerId=""
        onProviderChange={vi.fn()}
        onTranslateNow={vi.fn()}
        onPartialPreview={vi.fn()}
        onPostpone={onPostpone}
        onCancelTranslation={vi.fn()}
      />
    )

    await user.click(screen.getByRole('button', { name: t('modal.close.aria') }))
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.mouseDown(document.querySelector<HTMLElement>('[role="presentation"]')!)
    expect(onPostpone).toHaveBeenCalledTimes(3)
    ordinary.unmount()

    const onCancelTranslation = vi.fn()
    render(
      <TranslationReviewDialog
        review={failedReview()}
        disclosure={null}
        providers={[]}
        providerId=""
        busy
        cancellable
        onProviderChange={vi.fn()}
        onTranslateNow={vi.fn()}
        onPartialPreview={vi.fn()}
        onPostpone={vi.fn()}
        onCancelTranslation={onCancelTranslation}
      />
    )

    expect(screen.queryByRole('button', { name: t('translationReview.translateNow') })).toBeNull()
    await user.click(screen.getByRole('button', { name: t('modal.close.aria') }))
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.mouseDown(document.querySelector<HTMLElement>('[role="presentation"]')!)
    await user.click(screen.getByRole('button', { name: t('translationReview.cancel') }))
    expect(onCancelTranslation).toHaveBeenCalledTimes(4)
  })

  it('pages thousands of rich fields and outbound rows within an explicit DOM budget', async () => {
    const user = userEvent.setup()
    const count = 2_500
    const review = largeFailedReview(count)
    const disclosure = createExternalRequestDisclosure({
      purpose: 'diagram-localization',
      providerId: 'openrouter',
      modelId: 'model-v1',
      outbound: Array.from({ length: count }, (_, index) => ({
        id: `loc_${index}`,
        text: `Outbound text ${index}`,
        context: `Process_1 / Task_${index} / name`
      })),
      estimatedRequests: { min: 1, max: count }
    })
    const startedAt = performance.now()
    const { container } = render(
      <TranslationReviewDialog
        review={review}
        disclosure={disclosure}
        providers={[
          {
            id: 'selected-ai',
            label: 'OpenRouter · model-v1',
            description: 'OpenRouter provider'
          }
        ]}
        providerId="selected-ai"
        onProviderChange={vi.fn()}
        onTranslateNow={vi.fn()}
        onPartialPreview={vi.fn()}
        onPostpone={vi.fn()}
        onCancelTranslation={vi.fn()}
        onRetryField={vi.fn()}
        onManualEdit={vi.fn()}
      />
    )
    const renderElapsedMs = performance.now() - startedAt
    const fieldList = container.querySelector<HTMLElement>('#translation-review-field-list')!
    const outboundList = container.querySelector<HTMLElement>('#translation-review-outbound-list')!

    expect(renderElapsedMs).toBeLessThan(1_500)
    expect(within(fieldList).getAllByRole('listitem')).toHaveLength(
      TRANSLATION_REVIEW_FIELD_PAGE_SIZE
    )
    expect(within(outboundList).getAllByRole('listitem')).toHaveLength(
      TRANSLATION_REVIEW_OUTBOUND_PAGE_SIZE
    )
    expect(container.querySelectorAll('*').length).toBeLessThanOrEqual(900)
    expect(fieldList.textContent).toContain('Task_0')
    expect(fieldList.textContent).not.toContain('Task_24')
    expect(outboundList.textContent).toContain('Outbound text 0')
    expect(outboundList.textContent).not.toContain('Outbound text 30')

    const fieldPages = screen.getByRole('navigation', {
      name: t('translationReview.fields.paginationLabel')
    })
    const outboundPages = screen.getByRole('navigation', {
      name: t('translationReview.outbound.paginationLabel')
    })
    expect(fieldPages.textContent).toContain('1–24')
    expect(fieldPages.textContent).toContain(`of ${count}`)
    await user.click(
      within(fieldPages).getByRole('button', {
        name: t('translationReview.pagination.next')
      })
    )
    await user.click(
      within(outboundPages).getByRole('button', {
        name: t('translationReview.pagination.next')
      })
    )

    expect(fieldList.textContent).toContain('Task_24')
    expect(fieldList.textContent).not.toContain('Task_0 ·')
    expect(outboundList.textContent).toContain('Outbound text 30')
    expect(outboundList.textContent).not.toContain('Outbound text 0')
    expect(within(fieldList).getAllByRole('listitem')).toHaveLength(
      TRANSLATION_REVIEW_FIELD_PAGE_SIZE
    )
    expect(within(outboundList).getAllByRole('listitem')).toHaveLength(
      TRANSLATION_REVIEW_OUTBOUND_PAGE_SIZE
    )
    expect(container.querySelectorAll('*').length).toBeLessThanOrEqual(900)
  })

  it('keeps localized status separate from bounded labeled technical evidence', () => {
    setLang('ar')
    const rawEvidence = `provider-secret:${'x'.repeat(1_000_000)}`
    render(
      <TranslationReviewDialog
        review={failedReview()}
        disclosure={null}
        providers={[]}
        providerId=""
        status={t('translate.failed')}
        technicalDetail={rawEvidence}
        onProviderChange={vi.fn()}
        onTranslateNow={vi.fn()}
        onPartialPreview={vi.fn()}
        onPostpone={vi.fn()}
        onCancelTranslation={vi.fn()}
      />
    )

    const alert = screen.getByRole('alert')
    expect(within(alert).getByText(t('translate.failed')).textContent).not.toContain(
      'provider-secret'
    )
    const evidence = within(alert).getByLabelText(t('translationReview.error.technicalDetail'))
    expect(evidence.textContent?.length).toBeLessThanOrEqual(TRANSLATION_TECHNICAL_DETAIL_LIMIT)
    expect(evidence.textContent).toContain('provider-secret')
    expect(evidence.textContent).toContain('[technical evidence truncated]')
    expect(document.body.textContent!.length).toBeLessThan(15_000)
  })

  it('bounds technical evidence safely across emoji and hostile error values', () => {
    const suffix = '\n[technical evidence truncated]'
    const evidence = `${'x'.repeat(TRANSLATION_TECHNICAL_DETAIL_LIMIT - suffix.length - 1)}😀${'tail'.repeat(10)}`
    const bounded = boundedTranslationTechnicalDetail(evidence)
    expect(bounded?.length).toBeLessThanOrEqual(TRANSLATION_TECHNICAL_DETAIL_LIMIT)
    expect(bounded?.endsWith(suffix)).toBe(true)
    expect(bounded).not.toContain('\ud83d')
    expect(boundedTranslationTechnicalDetail(42)).toBe('42')

    const hostileError = new Error('hidden')
    Object.defineProperty(hostileError, 'message', {
      configurable: true,
      get() {
        throw new Error('message getter must not escape')
      }
    })
    Object.defineProperty(hostileError, 'name', {
      configurable: true,
      get() {
        throw new Error('name getter must not escape')
      }
    })
    expect(boundedTranslationTechnicalDetail(hostileError)).toBe('Error')
    expect(
      boundedTranslationTechnicalDetail({
        [Symbol.toPrimitive]() {
          throw new Error('conversion must not escape')
        }
      })
    ).toBeNull()
  })

  it('locks every mutation escape while exposing exact memory retry and continue choices', async () => {
    const user = userEvent.setup()
    const onRetryMemorySave = vi.fn(async () => undefined)
    const onContinueWithoutMemorySave = vi.fn()
    const onPostpone = vi.fn()
    const onCancelTranslation = vi.fn()

    render(
      <TranslationReviewDialog
        review={failedReview()}
        disclosure={createExternalRequestDisclosure({
          purpose: 'diagram-localization',
          providerId: 'google-translate+mymemory',
          outbound: [{ id: 'loc_1', text: 'Review request' }],
          estimatedRequests: { min: 1, max: 6 }
        })}
        providers={[
          {
            id: 'free',
            label: 'Google Translate → MyMemory',
            description: 'Free translation'
          }
        ]}
        providerId="free"
        status="translationReview.memorySaveFailed"
        onProviderChange={vi.fn()}
        onTranslateNow={vi.fn()}
        onPartialPreview={vi.fn()}
        onPostpone={onPostpone}
        onCancelTranslation={onCancelTranslation}
        onRetryField={vi.fn()}
        onManualEdit={vi.fn()}
        onRetryMemorySave={onRetryMemorySave}
        onContinueWithoutMemorySave={onContinueWithoutMemorySave}
      />
    )

    expect((screen.getByRole('combobox') as HTMLSelectElement).disabled).toBe(true)
    expect(
      (
        screen.getByRole('button', {
          name: t('translationReview.postpone')
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true)
    expect(
      (
        screen.getByRole('button', {
          name: t('translationReview.partialPreview')
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true)
    expect(
      (
        screen.getByRole('button', {
          name: t('translationReview.field.retry')
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true)
    expect(
      (
        screen.getByRole('button', {
          name: t('translationReview.field.manual')
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true)
    const dialog = screen.getByRole('dialog')
    const retry = screen.getByRole('button', { name: t('translationReview.memoryRetry') })
    expect(screen.queryByRole('button', { name: t('modal.close.aria') })).toBeNull()
    expect(dialog.getAttribute('aria-describedby')).toBe(
      'translation-review-memory-recovery-description'
    )
    expect(screen.getByRole('note').textContent).toBe(t('translationReview.memoryRecoveryRequired'))
    expect(document.activeElement).toBe(retry)
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.mouseDown(document.querySelector<HTMLElement>('[role="presentation"]')!)
    expect(onPostpone).not.toHaveBeenCalled()
    expect(onCancelTranslation).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).not.toBeNull()

    await user.click(retry)
    await waitFor(() => expect(onRetryMemorySave).toHaveBeenCalledOnce())
    await user.click(screen.getByRole('button', { name: t('translationReview.memoryContinue') }))
    expect(onContinueWithoutMemorySave).toHaveBeenCalledOnce()
  })
})
