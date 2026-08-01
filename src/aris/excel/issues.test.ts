import { describe, expect, it } from 'vitest'

import {
  ARIS_EXCEL_ISSUE_CODES,
  ARIS_EXCEL_MESSAGE_KEYS,
  arisExcelGuidanceKey,
  arisExcelIssueMessageKey,
  countIssues,
  createArisExcelIssue,
  hasBlockingIssue
} from './issues'
import { buildLegacyBpmnWorkbook, buildValidFixtureWorkbook } from './testFixtures'
import { parseArisWorkbook } from './workbookParser'

describe('localizable issue catalog', () => {
  it('gives every code a namespaced message key and no English copy', () => {
    for (const code of ARIS_EXCEL_ISSUE_CODES) {
      const issue = createArisExcelIssue(code, 'error')
      expect(issue.messageKey).toBe(`aris.excel.issue.${code}`)
      // The issue itself carries keys and data only — never a rendered string.
      expect(Object.keys(issue).sort()).toEqual(
        issue.guidanceKey === undefined
          ? ['code', 'messageKey', 'severity']
          : ['code', 'guidanceKey', 'messageKey', 'severity']
      )
    }
  })

  it('publishes a unique, complete key list for the i18n dictionaries', () => {
    expect(new Set(ARIS_EXCEL_MESSAGE_KEYS).size).toBe(ARIS_EXCEL_MESSAGE_KEYS.length)
    for (const code of ARIS_EXCEL_ISSUE_CODES) {
      expect(ARIS_EXCEL_MESSAGE_KEYS).toContain(arisExcelIssueMessageKey(code))
    }
    expect(ARIS_EXCEL_MESSAGE_KEYS).toContain(arisExcelGuidanceKey('legacy-bpmn-workbook'))
    expect(ARIS_EXCEL_MESSAGE_KEYS.every((key) => key.startsWith('aris.excel.'))).toBe(true)
  })

  it('publishes the forgiveness issue codes with actionable guidance', () => {
    for (const code of [
      'symbol-type-inferred',
      'reference-normalized',
      'connections-auto-chained'
    ] as const) {
      expect(ARIS_EXCEL_ISSUE_CODES).toContain(code)
      expect(createArisExcelIssue(code, 'warning').guidanceKey).toBe(`aris.excel.guidance.${code}`)
    }
    for (const code of ['value-required', 'unknown-symbol-type'] as const) {
      expect(createArisExcelIssue(code, 'warning').guidanceKey).toBe(`aris.excel.guidance.${code}`)
    }
  })

  it('carries severity, sheet, cell address, and offending value', () => {
    const issue = createArisExcelIssue('duplicate-id', 'error', {
      sheet: 'Objects',
      cell: 'B7',
      row: 7,
      column: 'B',
      value: 'OBJ_1',
      details: { kind: 'object_id' }
    })
    expect(issue).toEqual({
      code: 'duplicate-id',
      severity: 'error',
      messageKey: 'aris.excel.issue.duplicate-id',
      guidanceKey: 'aris.excel.guidance.duplicate-id',
      sheet: 'Objects',
      cell: 'B7',
      row: 7,
      column: 'B',
      value: 'OBJ_1',
      details: { kind: 'object_id' }
    })
    expect(Object.isFrozen(issue)).toBe(true)
  })

  it('counts and classifies severities', () => {
    const issues = [
      createArisExcelIssue('duplicate-id', 'error'),
      createArisExcelIssue('cached-formula-value', 'warning'),
      createArisExcelIssue('sheet-unknown', 'info')
    ]
    expect(countIssues(issues)).toEqual({ errors: 1, warnings: 1, infos: 1 })
    expect(hasBlockingIssue(issues)).toBe(true)
    expect(hasBlockingIssue(issues.slice(1))).toBe(false)
  })
})

describe('every rejection path reports a localizable issue', () => {
  it('never throws a raw error for malformed input', () => {
    const inputs: readonly (readonly [string, Uint8Array])[] = [
      ['model.txt', buildValidFixtureWorkbook()],
      ['empty.xlsx', new Uint8Array(0)],
      ['garbage.xlsx', new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])],
      ['legacy.xlsx', buildLegacyBpmnWorkbook()],
      ['truncated.xlsx', buildValidFixtureWorkbook().slice(0, 128)]
    ]
    for (const [fileName, bytes] of inputs) {
      const result = parseArisWorkbook(fileName, bytes)
      expect(result.status, fileName).toBe('rejected')
      expect(result.issues.length, fileName).toBeGreaterThan(0)
      for (const issue of result.issues) {
        expect(ARIS_EXCEL_MESSAGE_KEYS, fileName).toContain(issue.messageKey)
        expect(ARIS_EXCEL_ISSUE_CODES, fileName).toContain(issue.code)
      }
    }
  })
})
