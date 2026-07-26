import { describe, expect, it, vi } from 'vitest'

import type { ParsedWorkbookData, WorkbookCell } from './contracts'
import {
  MAX_COOPERATIVE_VALIDATION_CHUNK_SIZE,
  validateParsedWorkbookDataCooperatively
} from './cooperativeValidation'
import { SpreadsheetError } from './errors'
import { SPREADSHEET_LIMITS } from './limits'
import { validateParsedWorkbookData } from './workbookBoundary'

function representativeWorkbook(): ParsedWorkbookData {
  const styledCell = {
    value: 'displayed',
    rawValue: 'raw',
    style: { bold: true }
  } as WorkbookCell

  return {
    sheets: [
      {
        name: 'Processes',
        rows: [
          [
            styledCell,
            {
              value: 12,
              rawValue: '=6*2',
              formula: '6*2',
              cachedValuePresent: true
            },
            {
              value: null,
              rawValue: '=MISSING()',
              formula: 'MISSING()',
              cachedValuePresent: false
            }
          ],
          [{ value: true }, { value: new Date('2026-01-02T03:04:05.000Z') }]
        ]
      },
      {
        name: 'Empty',
        rows: [[], [{ value: '' }]]
      }
    ],
    customProperties: {
      templateVersion: '0.4.5.1'
    }
  }
}

describe('cooperative parsed workbook validation', () => {
  it('preserves the synchronous validator result and issue ordering exactly', async () => {
    const workbook = representativeWorkbook()
    const expected = validateParsedWorkbookData(workbook)

    const actual = await validateParsedWorkbookDataCooperatively(workbook, {
      chunkSize: 2,
      yieldControl: async () => {}
    })

    expect(actual).toEqual(expected)
    expect(actual.issues.map(({ code }) => code)).toEqual([
      'cached-formula-value',
      'formula-without-cache'
    ])
    expect(actual.workbook.sheets[0]!.rows[0]![0]).not.toHaveProperty('style')
    expect(Object.isFrozen(actual)).toBe(true)
    expect(Object.isFrozen(actual.workbook)).toBe(true)
    expect(Object.isFrozen(actual.workbook.sheets[0]!.rows[0])).toBe(true)
  })

  it.each([
    {
      name: 'worksheet limit',
      workbook: {
        sheets: Array.from({ length: SPREADSHEET_LIMITS.worksheets + 1 }, (_, index) => ({
          name: `Sheet${index}`,
          rows: []
        }))
      },
      code: 'worksheet-limit'
    },
    {
      name: 'row limit',
      workbook: {
        sheets: [
          {
            name: 'Rows',
            rows: Array.from({ length: SPREADSHEET_LIMITS.inputRows + 1 }, () => [])
          }
        ]
      },
      code: 'row-limit'
    },
    {
      name: 'column limit',
      workbook: {
        sheets: [
          {
            name: 'Columns',
            rows: [
              Array.from({ length: SPREADSHEET_LIMITS.columns + 1 }, () => ({
                value: null
              }))
            ]
          }
        ]
      },
      code: 'column-limit'
    },
    {
      name: 'cell length limit',
      workbook: {
        sheets: [
          {
            name: 'Cells',
            rows: [[{ value: 'x'.repeat(SPREADSHEET_LIMITS.cellCharacters + 1) }]]
          }
        ]
      },
      code: 'cell-length-limit'
    },
    {
      name: 'adapter contract',
      workbook: {
        sheets: [
          {
            name: 'Invalid',
            rows: [[{ value: { unsafe: true } }]]
          }
        ]
      } as unknown as ParsedWorkbookData,
      code: 'adapter-contract-violation'
    }
  ])('preserves the synchronous $name failure', async ({ workbook, code }) => {
    let expected: unknown
    try {
      validateParsedWorkbookData(workbook)
    } catch (cause) {
      expected = cause
    }

    await expect(
      validateParsedWorkbookDataCooperatively(workbook, {
        chunkSize: 1,
        yieldControl: async () => {}
      })
    ).rejects.toEqual(expected)
    expect(expected).toMatchObject({ code })
  })

  it('yields repeatedly, reports intra-sheet progress, and observes timer cancellation', async () => {
    const controller = new AbortController()
    const progress: number[] = []
    const yieldControl = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          globalThis.setTimeout(resolve, 0)
        })
    )
    const workbook: ParsedWorkbookData = {
      sheets: [
        {
          name: 'Large',
          rows: Array.from({ length: 2_000 }, (_, rowIndex) => [
            { value: `row-${rowIndex}` },
            { value: rowIndex }
          ])
        }
      ]
    }

    globalThis.setTimeout(() => controller.abort(), 0)

    await expect(
      validateParsedWorkbookDataCooperatively(workbook, {
        signal: controller.signal,
        chunkSize: 8,
        yieldControl,
        onProgress: ({ completed }) => progress.push(completed)
      })
    ).rejects.toMatchObject({
      code: 'parse-cancelled'
    } satisfies Partial<SpreadsheetError>)

    expect(yieldControl).toHaveBeenCalled()
    expect(progress[0]).toBe(0)
    expect(
      progress.some((completed) => completed > 0 && completed < workbook.sheets[0]!.rows.length)
    ).toBe(true)
  })

  it('caps caller chunk sizes and reaches exact row progress on success', async () => {
    const yieldControl = vi.fn(async () => {})
    const progress: Array<{ completed: number; total: number }> = []
    const rowCount = MAX_COOPERATIVE_VALIDATION_CHUNK_SIZE + 2
    const workbook: ParsedWorkbookData = {
      sheets: [
        {
          name: 'Rows',
          rows: Array.from({ length: rowCount }, () => [])
        }
      ]
    }

    await validateParsedWorkbookDataCooperatively(workbook, {
      chunkSize: Number.MAX_SAFE_INTEGER,
      yieldControl,
      onProgress: ({ completed, total }) => progress.push({ completed, total })
    })

    expect(yieldControl).toHaveBeenCalledOnce()
    expect(progress.at(-1)).toEqual({ completed: rowCount, total: rowCount })
    expect(progress.some(({ completed }) => completed > 0 && completed < rowCount)).toBe(true)
  })

  it('honors cancellation triggered by a progress listener before yielding', async () => {
    const controller = new AbortController()
    const yieldControl = vi.fn(async () => {})

    await expect(
      validateParsedWorkbookDataCooperatively(
        {
          sheets: [{ name: 'Rows', rows: [[{ value: 'one' }], [{ value: 'two' }]] }]
        },
        {
          signal: controller.signal,
          chunkSize: 2,
          yieldControl,
          onProgress: ({ completed }) => {
            if (completed > 0) controller.abort()
          }
        }
      )
    ).rejects.toMatchObject({
      code: 'parse-cancelled'
    } satisfies Partial<SpreadsheetError>)
    expect(yieldControl).not.toHaveBeenCalled()
  })
})
