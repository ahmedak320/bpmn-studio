// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { setLang } from '../../i18n/useLang'
import { createValidationSummary } from '../../validation/contracts'
import { ReviewedXmlIngestionDialog } from '../ReviewedXmlIngestionDialog'
import {
  LocalizationSource,
  type LanguageCode,
  type LocalizationAuditReport,
  type LocalizationField,
  type LocalizationIssue,
  type LocalizationIssueCode,
  type LocalizationResources
} from '../types'
import type { ReviewedXmlIngestionReviewRequest } from '../xmlIngestion'

const SECRET_XML = '<definitions data-secret="must-never-render-or-return" />'

interface FieldOptions {
  elementId: string
  field?: string
  en?: string
  ar?: string
  active?: LanguageCode
  sourceLanguage?: LanguageCode
}

function localizationField({
  elementId,
  field = 'name',
  en,
  ar,
  active = 'en',
  sourceLanguage = active
}: FieldOptions): LocalizationField {
  return {
    source: LocalizationSource.Xml,
    processId: 'Process_1',
    elementId,
    elementType: 'bpmn:Task',
    field,
    kind: 'name',
    value: {
      active,
      ...(en === undefined ? {} : { en }),
      ...(ar === undefined ? {} : { ar })
    },
    sourceLanguage,
    projection: active === 'ar' ? ar : en,
    origins: {
      ...(en === undefined ? {} : { en: 'paired' as const }),
      ...(ar === undefined ? {} : { ar: 'paired' as const })
    },
    storage: {
      enProperty: 'orbitpm:nameEn',
      arProperty: 'orbitpm:nameAr',
      projectionProperty: 'name'
    },
    planeIds: ['Diagram_1']
  }
}

function localizationIssue(
  field: LocalizationField,
  target: LanguageCode,
  code: LocalizationIssueCode
): LocalizationIssue {
  return {
    source: LocalizationSource.Xml,
    processId: field.processId,
    elementId: field.elementId,
    field: field.field,
    target,
    code,
    ...(field.value[target] === undefined ? {} : { originalValue: field.value[target] })
  }
}

function auditReport(
  fields: readonly LocalizationField[],
  issues: readonly LocalizationIssue[]
): LocalizationAuditReport {
  const byCode: Record<LocalizationIssueCode, number> = {
    missing: 0,
    'wrong-script': 0,
    'duplicate-counterpart': 0,
    mixed: 0,
    'provider-failed': 0
  }
  const byTarget: Record<LanguageCode, number> = { en: 0, ar: 0 }
  const incomplete = new Set<string>()
  for (const issue of issues) {
    byCode[issue.code] += 1
    byTarget[issue.target] += 1
    incomplete.add(`${issue.processId}/${issue.elementId}/${issue.field}`)
  }
  return {
    fields: [...fields],
    issues: [...issues],
    summary: {
      totalFields: fields.length,
      completeFields: Math.max(0, fields.length - incomplete.size),
      issueCount: issues.length,
      byCode,
      byTarget
    }
  }
}

function reviewRequest(
  fields: readonly LocalizationField[],
  issues: readonly LocalizationIssue[],
  options: {
    digest?: string
    resources?: LocalizationResources
  } = {}
): ReviewedXmlIngestionReviewRequest {
  const audit = auditReport(fields, issues)
  return {
    version: 1,
    source: LocalizationSource.Xml,
    target: 'ar',
    originalXml: SECRET_XML,
    originalDigest: 'original-digest',
    reviewDigest: options.digest ?? 'review-digest-a',
    knownProcessIds: ['Process_1'],
    resources: options.resources ?? {
      glossary: [],
      translationMemory: []
    },
    validation: createValidationSummary([], { xmlWellFormed: true }),
    ingestion: {
      source: LocalizationSource.Xml,
      target: 'ar',
      initialAudit: audit,
      localPlan: {
        fields: [...fields],
        updates: [],
        issues: [...issues],
        glossaryMatches: 0,
        translationMemoryMatches: 0,
        neutralMatches: 0
      },
      audit,
      queue: [],
      projection: {
        language: 'ar',
        complete: false,
        updates: [],
        blockers: [...issues],
        projected: 0,
        unchanged: 0,
        fallbackCount: 0
      }
    },
    queue: []
  }
}

function rowFor(elementId: string): HTMLElement {
  const heading = screen.getByRole('heading', { name: new RegExp(elementId) })
  const row = heading.closest<HTMLElement>('[data-testid="reviewed-xml-row"]')
  if (!row) throw new Error(`No review row found for ${elementId}`)
  return row
}

beforeEach(() => {
  setLang('en')
})

afterEach(() => {
  cleanup()
  setLang('en')
})

describe('ReviewedXmlIngestionDialog', () => {
  it('cancels without rendering or returning the exact XML', async () => {
    const user = userEvent.setup()
    const field = localizationField({ elementId: 'Task_1', en: 'Approve request' })
    const request = reviewRequest([field], [localizationIssue(field, 'ar', 'missing')])
    const onDecision = vi.fn()
    render(<ReviewedXmlIngestionDialog request={request} onDecision={onDecision} />)

    expect(screen.queryByText(SECRET_XML)).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Cancel review' }))

    expect(onDecision).toHaveBeenCalledOnce()
    expect(onDecision).toHaveBeenCalledWith({ status: 'cancelled' })
    expect(JSON.stringify(onDecision.mock.calls[0])).not.toContain('data-secret')
  })

  it('treats the close control and Escape as cancellation without exposing XML', async () => {
    const user = userEvent.setup()
    const field = localizationField({ elementId: 'Task_1', en: 'Approve request' })
    const request = reviewRequest([field], [localizationIssue(field, 'ar', 'missing')])
    const onCloseDecision = vi.fn()
    const view = render(
      <ReviewedXmlIngestionDialog request={request} onDecision={onCloseDecision} />
    )

    await user.click(screen.getByRole('button', { name: 'Close bilingual XML review' }))
    expect(onCloseDecision).toHaveBeenCalledWith({ status: 'cancelled' })

    view.unmount()
    const onEscapeDecision = vi.fn()
    render(<ReviewedXmlIngestionDialog request={request} onDecision={onEscapeDecision} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onEscapeDecision).toHaveBeenCalledWith({ status: 'cancelled' })
    expect(document.body.textContent).not.toContain('must-never-render-or-return')
  })

  it('keeps Complete disabled until auditFieldTarget accepts every exact value', async () => {
    const user = userEvent.setup()
    const exactSource = '  Approve\nrequest  '
    const field = localizationField({ elementId: 'Task_1', en: exactSource })
    const request = reviewRequest([field], [localizationIssue(field, 'ar', 'missing')])
    render(<ReviewedXmlIngestionDialog request={request} onDecision={vi.fn()} />)

    const rowElement = rowFor('Task_1')
    const row = within(rowElement)
    expect(
      [...rowElement.querySelectorAll<HTMLElement>('.orbitpm-reviewed-xml__facts code')].map(
        (node) => node.textContent
      )
    ).toEqual([exactSource, '(missing)', exactSource])
    expect(row.getByText('missing', { selector: 'code' })).not.toBeNull()
    const input = row.getByRole('textbox', { name: 'Reviewed target value (Arabic)' })
    const complete = screen.getByRole<HTMLButtonElement>('button', {
      name: 'Complete review'
    })
    expect(complete.disabled).toBe(true)
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(screen.getByRole('status').textContent).toContain('1')
    expect(
      row.queryByRole('option', { name: 'Approve as an English bilingual proper name' })
    ).toBeNull()

    await user.type(input, 'Approve request')
    expect(complete.disabled).toBe(true)
    expect(input.getAttribute('aria-invalid')).toBe('true')

    await user.clear(input)
    await user.type(input, 'اعتماد الطلب')
    expect(complete.disabled).toBe(false)
    expect(input.getAttribute('aria-invalid')).toBe('false')
    expect(screen.getByRole('status').textContent).toContain('Every row is valid')
  })

  it('does not let an English exception silently approve a duplicated counterpart', async () => {
    const user = userEvent.setup()
    const field = localizationField({
      elementId: 'Task_Name',
      ar: 'دائرة أحمد',
      active: 'ar',
      sourceLanguage: 'ar'
    })
    const request = reviewRequest([field], [localizationIssue(field, 'en', 'missing')])
    render(<ReviewedXmlIngestionDialog request={request} onDecision={vi.fn()} />)

    const row = within(rowFor('Task_Name'))
    const input = row.getByRole('textbox', { name: 'Reviewed target value (English)' })
    const approval = row.getByRole('combobox', { name: 'Exact field approval' })
    const complete = screen.getByRole<HTMLButtonElement>('button', {
      name: 'Complete review'
    })
    await user.type(input, 'دائرة أحمد')
    await user.selectOptions(approval, 'english-bilingual')

    expect(complete.disabled).toBe(true)
    expect(row.getByText('The value duplicates its non-neutral counterpart.')).not.toBeNull()

    await user.clear(input)
    await user.type(input, 'DMT أحمد')
    await user.selectOptions(approval, 'english-bilingual')
    expect(complete.disabled).toBe(false)
  })

  it('returns the request digest, exact expected values, edits, and scoped approvals', async () => {
    const user = userEvent.setup()
    const api = localizationField({
      elementId: 'Task_API',
      en: 'API',
      ar: 'API',
      sourceLanguage: 'en'
    })
    const properName = localizationField({
      elementId: 'Task_Name',
      en: 'DMT أحمد',
      ar: 'دائرة أحمد',
      active: 'ar',
      sourceLanguage: 'ar'
    })
    const missing = localizationField({
      elementId: 'Task_Missing',
      en: 'Approve request',
      sourceLanguage: 'en'
    })
    const request = reviewRequest(
      [api, properName, missing],
      [
        localizationIssue(api, 'ar', 'duplicate-counterpart'),
        localizationIssue(properName, 'en', 'mixed'),
        localizationIssue(missing, 'ar', 'missing')
      ],
      { digest: 'digest-bound-to-exact-report' }
    )
    const onDecision = vi.fn()
    render(<ReviewedXmlIngestionDialog request={request} onDecision={onDecision} />)

    const apiRow = within(rowFor('Task_API'))
    const apiApproval = apiRow.getByRole<HTMLSelectElement>('combobox', {
      name: 'Exact field approval'
    })
    await user.selectOptions(apiApproval, 'neutral')
    expect(apiApproval.value).toBe('neutral')

    const apiInput = apiRow.getByRole('textbox', {
      name: 'Reviewed target value (Arabic)'
    })
    await user.type(apiInput, ' changed')
    expect(apiApproval.value).toBe('')
    await user.clear(apiInput)
    await user.type(apiInput, 'API')
    await user.selectOptions(apiApproval, 'neutral')

    const nameRow = within(rowFor('Task_Name'))
    await user.selectOptions(
      nameRow.getByRole('combobox', { name: 'Exact field approval' }),
      'english-bilingual'
    )
    const missingRow = within(rowFor('Task_Missing'))
    await user.type(
      missingRow.getByRole('textbox', { name: 'Reviewed target value (Arabic)' }),
      'اعتماد الطلب'
    )

    await user.click(screen.getByRole('button', { name: 'Complete review' }))

    expect(onDecision).toHaveBeenCalledOnce()
    expect(onDecision).toHaveBeenCalledWith({
      status: 'completed',
      reviewDigest: 'digest-bound-to-exact-report',
      edits: [
        {
          processId: 'Process_1',
          elementId: 'Task_API',
          field: 'name',
          target: 'ar',
          expectedValue: 'API',
          value: 'API'
        },
        {
          processId: 'Process_1',
          elementId: 'Task_Name',
          field: 'name',
          target: 'en',
          expectedValue: 'DMT أحمد',
          value: 'DMT أحمد'
        },
        {
          processId: 'Process_1',
          elementId: 'Task_Missing',
          field: 'name',
          target: 'ar',
          expectedValue: null,
          value: 'اعتماد الطلب'
        }
      ],
      approvals: [
        {
          processId: 'Process_1',
          elementId: 'Task_API',
          field: 'name',
          target: 'ar',
          value: 'API',
          kind: 'neutral'
        },
        {
          processId: 'Process_1',
          elementId: 'Task_Name',
          field: 'name',
          target: 'en',
          value: 'DMT أحمد',
          kind: 'english-bilingual'
        }
      ]
    })
    expect(JSON.stringify(onDecision.mock.calls[0])).not.toContain('definitions')
  })

  it('renders one unique target row per issue key, including both missing sides', () => {
    const field = localizationField({ elementId: 'Task_Empty' })
    const missingEn = localizationIssue(field, 'en', 'missing')
    const missingAr = localizationIssue(field, 'ar', 'missing')
    const request = reviewRequest([field], [missingEn, missingEn, missingAr])
    render(<ReviewedXmlIngestionDialog request={request} onDecision={vi.fn()} />)

    expect(screen.getAllByTestId('reviewed-xml-row')).toHaveLength(2)
    expect(screen.getByRole('textbox', { name: 'Reviewed target value (English)' })).not.toBeNull()
    expect(screen.getByRole('textbox', { name: 'Reviewed target value (Arabic)' })).not.toBeNull()
    expect(screen.getAllByText('missing', { selector: 'code' })).toHaveLength(2)
  })

  it('resets values and exact approvals when the review digest changes', async () => {
    const user = userEvent.setup()
    const firstField = localizationField({
      elementId: 'Task_API',
      en: 'API',
      ar: 'API'
    })
    const first = reviewRequest(
      [firstField],
      [localizationIssue(firstField, 'ar', 'wrong-script')],
      { digest: 'digest-a' }
    )
    const secondField = localizationField({
      elementId: 'Task_API',
      en: 'SLA',
      ar: 'SLA'
    })
    const second = reviewRequest(
      [secondField],
      [localizationIssue(secondField, 'ar', 'wrong-script')],
      { digest: 'digest-b' }
    )
    const view = render(<ReviewedXmlIngestionDialog request={first} onDecision={vi.fn()} />)

    const firstRow = within(rowFor('Task_API'))
    await user.selectOptions(
      firstRow.getByRole('combobox', { name: 'Exact field approval' }),
      'neutral'
    )
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Complete review' }).disabled
    ).toBe(false)

    view.rerender(<ReviewedXmlIngestionDialog request={second} onDecision={vi.fn()} />)

    const secondRow = within(rowFor('Task_API'))
    expect(
      secondRow.getByRole<HTMLInputElement>('textbox', {
        name: 'Reviewed target value (Arabic)'
      }).value
    ).toBe('SLA')
    expect(
      secondRow.getByRole<HTMLSelectElement>('combobox', {
        name: 'Exact field approval'
      }).value
    ).toBe('')
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Complete review' }).disabled
    ).toBe(true)
  })

  it('uses Arabic copy and RTL chrome while keeping target inputs script-directed at 320px', () => {
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: 320
    })
    setLang('ar')
    const field = localizationField({ elementId: 'Task_Empty' })
    const request = reviewRequest(
      [field],
      [localizationIssue(field, 'en', 'missing'), localizationIssue(field, 'ar', 'missing')]
    )
    render(<ReviewedXmlIngestionDialog request={request} onDecision={vi.fn()} />)

    const dialog = screen.getByRole('dialog', {
      name: 'إكمال مراجعة XML ثنائية اللغة'
    })
    expect(dialog.dir).toBe('rtl')
    expect(dialog.classList.contains('orbitpm-reviewed-xml')).toBe(true)
    expect(screen.getByRole('button', { name: 'إلغاء المراجعة' })).not.toBeNull()
    expect(screen.getByRole('button', { name: 'إكمال المراجعة' })).not.toBeNull()
    expect(screen.getByRole('textbox', { name: 'قيمة الهدف المراجعة (الإنجليزية)' }).dir).toBe(
      'ltr'
    )
    expect(screen.getByRole('textbox', { name: 'قيمة الهدف المراجعة (العربية)' }).dir).toBe('rtl')
  })
})
