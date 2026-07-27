// @vitest-environment jsdom

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  SpreadsheetValidationIssueList,
  type SpreadsheetValidationIssueListProps
} from '../SpreadsheetValidationIssueList'
import type { SpreadsheetValidationIssue } from '../contracts'

const issueListStyles = readFileSync(
  resolve(process.cwd(), 'src/spreadsheet/SpreadsheetValidationIssueList.css'),
  'utf8'
)

const i18n = vi.hoisted(() => ({
  translations: new Map<string, string>()
}))

vi.mock('../../i18n', () => ({
  t: (key: string, variables?: Record<string, string | number>): string => {
    const template = i18n.translations.get(key) ?? key
    if (!variables) return template
    return template.replace(/\{(\w+)\}/g, (_, name: string) =>
      String(variables[name] ?? `{${name}}`)
    )
  }
}))

const completeIssue: SpreadsheetValidationIssue = {
  code: 'invalid-boolean',
  severity: 'review',
  messageKey: 'spreadsheet.validation.invalid-boolean',
  guidanceKey: 'spreadsheet.guidance.use-boolean',
  worksheet: 'خطوات',
  cellAddress: 'D12',
  rawValue: 'ربما',
  normalizedValue: false,
  details: {
    field: 'active',
    required: true
  }
}

function renderList(
  props: Partial<SpreadsheetValidationIssueListProps> = {},
  issue: SpreadsheetValidationIssue = completeIssue
) {
  return render(
    <SpreadsheetValidationIssueList
      issues={[issue]}
      listId="workbook-issues"
      idPrefix="workbook-review"
      {...props}
    />
  )
}

beforeEach(() => {
  i18n.translations.clear()
  i18n.translations.set('spreadsheet.validation.title', 'Localized workbook issues')
  i18n.translations.set('spreadsheet.validation.noIssues', 'No workbook issues found.')
  i18n.translations.set('validation.severity.review', 'Needs review')
  i18n.translations.set(
    'spreadsheet.validation.invalid-boolean',
    'Invalid value for {field} ({required})'
  )
  i18n.translations.set('spreadsheet.guidance.use-boolean', 'Choose true or false for {field}.')
  i18n.translations.set('spreadsheet.validation.worksheet', 'Worksheet')
  i18n.translations.set('spreadsheet.validation.cell', 'Cell')
  i18n.translations.set('spreadsheet.validation.rawValue', 'Raw input')
  i18n.translations.set('spreadsheet.validation.normalizedValue', 'Normalized input')
  i18n.translations.set('spreadsheet.validation.guidance', 'Repair guidance')
})

afterEach(cleanup)

describe('SpreadsheetValidationIssueList', () => {
  it('renders every issue field with translated copy and stable accessible relationships', () => {
    renderList()

    const list = screen.getByRole('list', { name: 'Localized workbook issues' })
    expect(list.id).toBe('workbook-issues')
    expect(list.parentElement?.getAttribute('aria-live')).toBe('polite')
    expect(list.parentElement?.getAttribute('aria-atomic')).toBe('false')

    const item = within(list).getByRole('listitem')
    expect(item.id).toBe('workbook-review-issue-0')
    expect(item.getAttribute('data-severity')).toBe('review')
    expect(within(item).getByText('Needs review')).not.toBeNull()
    expect(within(item).getByText('invalid-boolean').getAttribute('dir')).toBe('auto')
    expect(within(item).getByText('Invalid value for active (true)').getAttribute('dir')).toBe(
      'auto'
    )

    expect(within(item).getByLabelText('Worksheet: خطوات').getAttribute('dir')).toBe('auto')
    expect(within(item).getByLabelText('Cell: D12').getAttribute('dir')).toBe('auto')
    expect(within(item).getByLabelText('Raw input: ربما').getAttribute('dir')).toBe('auto')
    expect(within(item).getByLabelText('Normalized input: false').getAttribute('dir')).toBe('auto')
    expect(within(item).getByText('Repair guidance:')).not.toBeNull()
    expect(within(item).getByText('Choose true or false for active.').getAttribute('dir')).toBe(
      'auto'
    )

    const labelledBy = item.getAttribute('aria-labelledby')?.split(' ') ?? []
    const describedBy = item.getAttribute('aria-describedby')?.split(' ') ?? []
    expect(labelledBy).toHaveLength(2)
    expect(describedBy).toHaveLength(5)
    for (const id of [...labelledBy, ...describedBy]) {
      expect(document.getElementById(id)).not.toBeNull()
    }
  })

  it('bounds untrusted values, preserves Unicode boundaries, and never creates markup from them', () => {
    const hostileValue = {
      get [Symbol.toStringTag](): string {
        throw new Error('do not stringify me')
      }
    }
    renderList(
      { maxValueLength: 10 },
      {
        ...completeIssue,
        rawValue: '123456789😀<img src=x onerror=alert(1)>',
        normalizedValue: hostileValue
      }
    )

    const item = screen.getByRole('listitem')
    const raw = within(item).getByLabelText('Raw input: 123456789…')
    expect(raw.textContent).toBe('123456789…')
    expect(raw.getAttribute('data-truncated')).toBe('true')
    expect(raw.textContent).not.toContain('\uFFFD')
    expect(item.querySelector('img')).toBeNull()

    const normalized = within(item).getByLabelText('Normalized input: <unavailab…')
    expect(normalized.textContent).toBe('<unavailab…')
    expect(normalized.getAttribute('data-truncated')).toBe('true')
  })

  it('keeps readable fallbacks and bidirectional values when translations are absent', () => {
    i18n.translations.clear()
    i18n.translations.set('spreadsheet.validation.title', 'Workbook validation')
    const issue: SpreadsheetValidationIssue = {
      code: 'unknown-step-type',
      severity: 'info',
      messageKey: 'spreadsheet.validation.unknown-step-type',
      guidanceKey: 'spreadsheet.guidance.map-step-type',
      worksheet: 'الخطوات',
      cellAddress: 'B2',
      rawValue: 'موافقة',
      normalizedValue: 'userTask'
    }

    render(
      <section dir="rtl">
        <SpreadsheetValidationIssueList
          issues={[issue]}
          listId="rtl-issues"
          idPrefix="rtl review"
        />
      </section>
    )

    const list = screen.getByRole('list', { name: 'Workbook validation' })
    const item = within(list).getByRole('listitem')
    expect(item.id).toBe('rtl-review-issue-0')
    expect(item.closest('[dir="rtl"]')).not.toBeNull()
    expect(within(item).getByText('Information')).not.toBeNull()
    expect(within(item).getByText('Unknown step type').getAttribute('dir')).toBe('auto')
    expect(within(item).getByText('Map step type').getAttribute('dir')).toBe('auto')
    for (const value of item.querySelectorAll('.orbitpm-spreadsheet-validation__value')) {
      expect(value.getAttribute('dir')).toBe('auto')
    }

    expect(issueListStyles).toContain('border-inline-start')
    expect(issueListStyles).toContain('padding-inline')
    expect(issueListStyles).toContain('margin-inline')
    expect(issueListStyles).not.toMatch(/\b(?:left|right)\s*:/)
  })

  it('keeps an empty labelled list and announces its localized empty state', () => {
    render(
      <SpreadsheetValidationIssueList
        issues={[]}
        listId="empty-issues"
        idPrefix="empty-review"
        ariaLive="assertive"
        busy
      />
    )

    const list = screen.getByRole('list', { name: 'Localized workbook issues' })
    const empty = screen.getByText('No workbook issues found.')
    expect(list.id).toBe('empty-issues')
    expect(list.getAttribute('aria-describedby')).toBe(empty.id)
    expect(list.parentElement?.getAttribute('aria-live')).toBe('assertive')
    expect(list.parentElement?.getAttribute('aria-busy')).toBe('true')
  })
})
