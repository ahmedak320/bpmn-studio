// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { setLang } from '../../i18n'
import {
  VALIDATION_ISSUE_PAGE_SIZE,
  ValidationCenter,
  ValidationIssueList
} from '../ValidationCenter'
import { createValidationSummary, validationIssue, type ValidationIssue } from '../contracts'
import { VALIDATION_TECHNICAL_DETAIL_MAX_CODE_POINTS } from '../technicalEvidence'

const ARABIC = /[\u0600-\u06ff]/u
// This stress case deliberately traverses every paginated finding, exercises
// each row action, and serializes the complete report. Parallel jsdom suites
// can make that bounded workload exceed Vitest's default without indicating a
// product regression, so keep the larger budget local to this test.
const PAGINATED_FINDINGS_STRESS_TIMEOUT_MS = 15_000

afterEach(() => {
  cleanup()
  setLang('en')
  vi.restoreAllMocks()
})

describe('ValidationIssueList localization', () => {
  it('renders localized Arabic copy while labeling exact external evidence in English', () => {
    setLang('ar')
    const rawDiagnostic = 'Element <Task_1> must have a label.'
    render(
      <ValidationIssueList
        issues={[
          validationIssue({
            code: 'bpmnlint.label-required',
            severity: 'warning',
            source: 'bpmnlint',
            blocking: false,
            message: rawDiagnostic,
            elementId: 'Task_1',
            ruleId: 'label-required'
          })
        ]}
      />
    )

    const localizedMessage = document.querySelector('[data-validation-localized-message]')
    const localizedRepair = document.querySelector('[data-validation-localized-repair]')
    expect(localizedMessage?.textContent).toMatch(ARABIC)
    expect(localizedMessage?.textContent).not.toBe(rawDiagnostic)
    expect(localizedRepair?.textContent).toMatch(ARABIC)

    const code = document.querySelector('[data-validation-technical-code]')
    const rule = document.querySelector('[data-validation-technical-rule]')
    const diagnostic = screen.getByText(rawDiagnostic)
    expect(code?.textContent).toBe('bpmnlint.label-required')
    expect(rule?.textContent).toBe('label-required')
    for (const evidence of [code, rule, diagnostic]) {
      expect(evidence?.tagName).toBe('CODE')
      expect(evidence?.getAttribute('lang')).toBe('en')
      expect(evidence?.getAttribute('dir')).toBe('ltr')
    }
    expect(
      document.querySelector('.orbitpm-validation__technical')?.getAttribute('aria-label')
    ).toMatch(ARABIC)
  })

  it('keeps unknown diagnostics as labeled technical evidence in compact lists', () => {
    setLang('ar')
    const rawDiagnostic = 'Future validator detail: exact-value-17'
    render(
      <ValidationIssueList
        compact
        issues={[
          validationIssue({
            code: 'semantic.future-rule',
            severity: 'error',
            source: 'semantic',
            message: rawDiagnostic
          })
        ]}
      />
    )

    expect(document.querySelector('[data-validation-localized-message]')?.textContent).toMatch(
      ARABIC
    )
    expect(document.querySelector('[data-validation-localized-repair]')?.textContent).toMatch(
      ARABIC
    )
    const diagnostic = screen.getByText(rawDiagnostic)
    expect(diagnostic.tagName).toBe('CODE')
    expect(diagnostic.getAttribute('lang')).toBe('en')
    expect(screen.getByText('semantic.future-rule').tagName).toBe('CODE')
    expect(screen.queryByText('المصدر')).toBeNull()
  })

  it('bounds a very large raw diagnostic at a Unicode code-point boundary', () => {
    const rawDiagnostic = `${'😀'.repeat(600)}${'x'.repeat(1_000_000)}`
    render(
      <ValidationIssueList
        issues={[
          validationIssue({
            code: 'semantic.future-rule',
            severity: 'error',
            source: 'semantic',
            message: rawDiagnostic
          })
        ]}
      />
    )

    const diagnostic = document.querySelector('[data-validation-technical-diagnostic]')
    const rendered = diagnostic?.textContent ?? ''
    expect(Array.from(rendered)).toHaveLength(VALIDATION_TECHNICAL_DETAIL_MAX_CODE_POINTS)
    expect(rendered.endsWith('…')).toBe(true)
    expect(rendered).not.toContain('\uFFFD')
    expect(screen.getByText(/diagnostic is shortened/i)).not.toBeNull()
  })
})

function issueReport(prefix: string, count: number): ValidationIssue[] {
  return Array.from({ length: count }, (_, index) =>
    validationIssue({
      code: `semantic.${prefix}-${index + 1}`,
      severity: index % 3 === 0 ? 'error' : index % 3 === 1 ? 'warning' : 'info',
      source: 'semantic',
      blocking: index % 3 === 0,
      message: `${prefix} raw diagnostic ${index + 1}`,
      elementId: `${prefix}_Task_${index + 1}`,
      location: { line: index + 1, column: 2 },
      suggestedRepair: `Repair ${index + 1}`
    })
  )
}

describe('ValidationIssueList bounded pagination', () => {
  it(
    'keeps a fixed issue-row ceiling while every finding and action remains reachable',
    () => {
      const issues = issueReport('large', VALIDATION_ISSUE_PAGE_SIZE * 3 + 7)
      const onFocus = vi.fn()
      const onRepair = vi.fn()
      const downloads: Array<{ download: string; href: string }> = []
      vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
        this: HTMLAnchorElement
      ) {
        downloads.push({ download: this.download, href: this.href })
      })
      render(
        <ValidationCenter
          open
          summary={createValidationSummary(issues)}
          running={false}
          documentName="large.bpmn"
          onClose={vi.fn()}
          onRun={vi.fn()}
          onFocus={onFocus}
          onRepair={onRepair}
        />
      )

      expect(screen.getByText(`Errors: ${Math.ceil(issues.length / 3)}`)).not.toBeNull()
      const reachedCodes = new Set<string>()
      let firstVisibleIndex = 0

      while (true) {
        const issueList = screen.getByRole('list', { name: 'Validation findings' })
        const mountedRows = within(issueList).getAllByRole('listitem')
        const mountedDiagnostics = issueList.querySelectorAll(
          '[data-validation-technical-diagnostic]'
        )
        expect(mountedRows.length).toBeLessThanOrEqual(VALIDATION_ISSUE_PAGE_SIZE)
        expect(mountedDiagnostics).toHaveLength(mountedRows.length)

        for (const code of issueList.querySelectorAll('[data-validation-technical-code]')) {
          reachedCodes.add(code.textContent ?? '')
        }

        const firstRow = mountedRows[0]
        expect(firstRow?.getAttribute('aria-posinset')).toBe(String(firstVisibleIndex + 1))
        expect(firstRow?.getAttribute('aria-setsize')).toBe(String(issues.length))
        fireEvent.click(within(firstRow).getByRole('button', { name: 'Focus element' }))
        fireEvent.click(within(firstRow).getByRole('button', { name: 'Repair' }))
        expect(onFocus).toHaveBeenLastCalledWith(issues[firstVisibleIndex])
        expect(onRepair).toHaveBeenLastCalledWith(issues[firstVisibleIndex])

        const next = screen.getByRole('button', { name: 'Next page' })
        if (next.hasAttribute('disabled')) break
        fireEvent.click(next)
        firstVisibleIndex += VALIDATION_ISSUE_PAGE_SIZE
      }

      expect(reachedCodes).toEqual(new Set(issues.map((issue) => issue.code)))
      fireEvent.click(screen.getByRole('button', { name: 'Export report' }))
      expect(downloads).toHaveLength(1)
      expect(downloads[0]?.download).toBe('large.validation.json')
      const exported = JSON.parse(
        decodeURIComponent(downloads[0]?.href.split(',').slice(1).join(',') ?? '')
      ) as { issues: ValidationIssue[] }
      expect(exported.issues.map((issue) => issue.code)).toEqual(issues.map((issue) => issue.code))
      expect(screen.getByRole('status').textContent).toBe(
        `Showing findings 61–67 of 67. Page 4 of 4.`
      )

      fireEvent.click(screen.getByRole('button', { name: 'Previous page' }))
      expect(screen.getByRole('status').textContent).toBe(
        `Showing findings 41–60 of 67. Page 3 of 4.`
      )
    },
    PAGINATED_FINDINGS_STRESS_TIMEOUT_MS
  )

  it('resets to the first page when a validation summary is replaced', () => {
    const initialIssues = issueReport('initial', VALIDATION_ISSUE_PAGE_SIZE + 4)
    const replacementIssues = issueReport('replacement', VALIDATION_ISSUE_PAGE_SIZE + 2)
    const props = {
      open: true,
      running: false,
      onClose: vi.fn(),
      onRun: vi.fn(),
      onFocus: vi.fn(),
      onRepair: vi.fn()
    }
    const view = render(
      <ValidationCenter {...props} summary={createValidationSummary(initialIssues)} />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    expect(screen.getByText('semantic.initial-21')).not.toBeNull()

    view.rerender(
      <ValidationCenter {...props} summary={createValidationSummary(replacementIssues)} />
    )

    expect(screen.getByText('semantic.replacement-1')).not.toBeNull()
    expect(screen.queryByText('semantic.replacement-21')).toBeNull()
    expect(screen.getByRole('status').textContent).toBe(`Showing findings 1–20 of 22. Page 1 of 2.`)
  })

  it('provides localized Arabic navigation and page announcements', () => {
    setLang('ar')
    const issues = issueReport('arabic', VALIDATION_ISSUE_PAGE_SIZE + 1)
    render(<ValidationIssueList issues={issues} />)

    expect(screen.getByRole('navigation', { name: 'صفحات نتائج التحقق' })).not.toBeNull()
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'الصفحة السابقة' }).disabled).toBe(
      true
    )
    fireEvent.click(screen.getByRole('button', { name: 'الصفحة التالية' }))
    expect(screen.getByRole('status').textContent).toBe(
      `عرض نتائج التحقق 21–21 من 21. الصفحة 2 من 2.`
    )
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'الصفحة التالية' }).disabled).toBe(
      true
    )
  })
})
