import { describe, expect, it } from 'vitest'

import { SPREADSHEET_LIMITS, XLSX_MAX_ZIP_ENTRIES } from '../../spreadsheet/limits'
import { ARIS_EXCEL_LIMITS } from './limits'
import { ARIS_TEMPLATE_IDENTITY } from './templateSchema'
import {
  buildFixtureWorkbook,
  buildValidFixtureWorkbook,
  inflateDeclaredUncompressedSizes,
  type FixtureRow
} from './testFixtures'
import { parseArisWorkbook } from './workbookParser'
import { writeDeterministicZip, type XlsxCellValue } from './xlsxWriter'

const encoder = new TextEncoder()

function codes(result: ReturnType<typeof parseArisWorkbook>): string[] {
  return result.issues.map((issue) => issue.code)
}

function objectRows(count: number, modelId: string, objectType: string): FixtureRow[] {
  return Array.from({ length: count }, (_, index) => ({
    model_id: modelId,
    object_id: `OBJ_${modelId}_${index}`,
    occurrence_id: `OCC_${modelId}_${index}`,
    object_type: objectType,
    symbol_type: objectType === 'OT_FUNC' ? 'ST_FUNC' : 'ST_EV',
    name_en: `Object ${index}`
  }))
}

describe('§15.4 limits parity with the shared preflight boundary', () => {
  it('uses the same numbers the reused XLSX preflight enforces', () => {
    expect(ARIS_EXCEL_LIMITS.compressedInputBytes).toBe(SPREADSHEET_LIMITS.compressedInputBytes)
    expect(ARIS_EXCEL_LIMITS.declaredUncompressedBytes).toBe(
      SPREADSHEET_LIMITS.declaredUncompressedBytes
    )
    expect(ARIS_EXCEL_LIMITS.zipEntries).toBe(XLSX_MAX_ZIP_ENTRIES)
    expect(ARIS_EXCEL_LIMITS.sheets).toBe(SPREADSHEET_LIMITS.worksheets)
    expect(ARIS_EXCEL_LIMITS).toMatchObject({
      compressedInputBytes: 20 * 1024 * 1024,
      declaredUncompressedBytes: 100 * 1024 * 1024,
      zipEntries: 10_000,
      sheets: 25,
      rows: 50_000,
      columns: 256,
      nonEmptyCells: 500_000,
      cellCharacters: 32_767,
      controlFlowObjectsPerModel: 1_000,
      objectsPerTransaction: 5_000,
      controlFlowObjectWarningThreshold: 250
    })
  })
})

describe('§15.4 limit enforcement', () => {
  it('rejects above 20 MiB compressed', () => {
    const bytes = new Uint8Array(ARIS_EXCEL_LIMITS.compressedInputBytes + 1)
    const result = parseArisWorkbook('big.xlsx', bytes)
    expect(result.status).toBe('rejected')
    expect(codes(result)).toEqual(['compressed-size-limit'])
    expect(result.issues[0]?.details).toMatchObject({
      actual: ARIS_EXCEL_LIMITS.compressedInputBytes + 1,
      limit: ARIS_EXCEL_LIMITS.compressedInputBytes
    })
  })

  it('rejects above 100 MiB declared uncompressed', () => {
    const bytes = inflateDeclaredUncompressedSizes(buildValidFixtureWorkbook(), 60 * 1024 * 1024)
    const result = parseArisWorkbook('bomb.xlsx', bytes)
    expect(result.status).toBe('rejected')
    expect(codes(result)).toEqual(['uncompressed-size-limit'])
    expect(result.issues[0]?.details).toMatchObject({
      limit: ARIS_EXCEL_LIMITS.declaredUncompressedBytes
    })
  })

  it('rejects above 10,000 ZIP entries', () => {
    const entries = Array.from({ length: ARIS_EXCEL_LIMITS.zipEntries + 1 }, (_, index) => ({
      path: `part${index}.xml`,
      bytes: encoder.encode('<a/>')
    }))
    const result = parseArisWorkbook('entries.xlsx', writeDeterministicZip(entries))
    expect(result.status).toBe('rejected')
    expect(codes(result)).toEqual(['zip-entry-limit'])
    expect(result.issues[0]?.details).toMatchObject({
      actual: ARIS_EXCEL_LIMITS.zipEntries + 1,
      limit: ARIS_EXCEL_LIMITS.zipEntries
    })
  })

  it('rejects above 25 sheets', () => {
    const bytes = buildFixtureWorkbook({
      rawSheets: Array.from({ length: ARIS_EXCEL_LIMITS.sheets + 1 }, (_, index) => ({
        name: `Sheet${index + 1}`,
        rows: [[ARIS_TEMPLATE_IDENTITY]]
      }))
    })
    const result = parseArisWorkbook('sheets.xlsx', bytes)
    expect(result.status).toBe('rejected')
    expect(codes(result)).toEqual(['sheet-limit'])
  })

  it('rejects above 50,000 rows', () => {
    const rows: (readonly XlsxCellValue[])[] = [[ARIS_TEMPLATE_IDENTITY]]
    for (let index = 0; index < ARIS_EXCEL_LIMITS.rows; index += 1) rows.push(['x'])
    const bytes = buildFixtureWorkbook({ rawSheets: [{ name: 'Models', rows }] })
    const result = parseArisWorkbook('rows.xlsx', bytes)
    expect(result.status).toBe('rejected')
    expect(codes(result)).toEqual(['row-limit'])
    expect(result.issues[0]?.details).toMatchObject({
      actual: ARIS_EXCEL_LIMITS.rows + 1,
      limit: ARIS_EXCEL_LIMITS.rows
    })
  })

  it('rejects above 256 columns', () => {
    const wide = Array.from({ length: ARIS_EXCEL_LIMITS.columns + 1 }, (_, index) => `c${index}`)
    const bytes = buildFixtureWorkbook({
      rawSheets: [{ name: 'Models', rows: [[ARIS_TEMPLATE_IDENTITY], wide] }]
    })
    const result = parseArisWorkbook('columns.xlsx', bytes)
    expect(result.status).toBe('rejected')
    expect(codes(result)).toEqual(['column-limit'])
    expect(result.issues[0]?.details).toMatchObject({
      actual: ARIS_EXCEL_LIMITS.columns + 1,
      limit: ARIS_EXCEL_LIMITS.columns
    })
  })

  it('rejects above 500,000 non-empty cells', () => {
    const columns = 250
    const rowCount = Math.ceil((ARIS_EXCEL_LIMITS.nonEmptyCells + 1) / columns)
    const row = Array.from({ length: columns }, () => 'x')
    const rows: (readonly XlsxCellValue[])[] = [[ARIS_TEMPLATE_IDENTITY]]
    for (let index = 0; index < rowCount; index += 1) rows.push(row)
    const bytes = buildFixtureWorkbook({ rawSheets: [{ name: 'Models', rows }] })
    const result = parseArisWorkbook('cells.xlsx', bytes)
    expect(result.status).toBe('rejected')
    expect(codes(result)).toEqual(['cell-count-limit'])
    expect(result.issues[0]?.details).toMatchObject({
      actual: ARIS_EXCEL_LIMITS.nonEmptyCells + 1,
      limit: ARIS_EXCEL_LIMITS.nonEmptyCells
    })
  }, 60_000)

  it('rejects above 32,767 characters in one cell', () => {
    const long = 'a'.repeat(ARIS_EXCEL_LIMITS.cellCharacters + 1)
    const bytes = buildFixtureWorkbook({
      rawSheets: [{ name: 'Models', rows: [[ARIS_TEMPLATE_IDENTITY], ['ok', long]] }]
    })
    const result = parseArisWorkbook('long-cell.xlsx', bytes)
    expect(result.status).toBe('rejected')
    expect(codes(result)).toEqual(['cell-length-limit'])
    expect(result.issues[0]).toMatchObject({
      sheet: 'Models',
      cell: 'B2',
      details: {
        actual: ARIS_EXCEL_LIMITS.cellCharacters + 1,
        limit: ARIS_EXCEL_LIMITS.cellCharacters
      }
    })
  })

  it('rejects above 1,000 control-flow objects in one model', () => {
    const count = ARIS_EXCEL_LIMITS.controlFlowObjectsPerModel + 1
    const result = parseArisWorkbook(
      'per-model.xlsx',
      buildFixtureWorkbook({
        sheets: {
          Models: [{ model_id: 'MDL_1', model_type: 'MT_EEPC', name_en: 'Large model' }],
          Objects: objectRows(count, 'MDL_1', 'OT_FUNC')
        }
      })
    )
    expect(result.status).toBe('rejected')
    expect(codes(result)).toContain('control-flow-object-limit')
    expect(result.issues.find((issue) => issue.code === 'control-flow-object-limit')).toMatchObject(
      {
        sheet: 'Models',
        cell: 'A3',
        value: 'MDL_1',
        details: { actual: count, limit: ARIS_EXCEL_LIMITS.controlFlowObjectsPerModel }
      }
    )
  }, 30_000)

  it('rejects above 5,000 objects in one transaction', () => {
    const perModel = 900
    const models = Array.from({ length: 6 }, (_, index) => ({
      model_id: `MDL_${index}`,
      model_type: 'MT_EEPC',
      name_en: `Model ${index}`
    }))
    const objects = models.flatMap((model) =>
      objectRows(perModel, String(model.model_id), 'OT_FUNC')
    )
    const result = parseArisWorkbook(
      'transaction.xlsx',
      buildFixtureWorkbook({ sheets: { Models: models, Objects: objects } })
    )
    expect(result.status).toBe('rejected')
    expect(codes(result)).toContain('object-transaction-limit')
    expect(result.issues.find((issue) => issue.code === 'object-transaction-limit')).toMatchObject({
      details: { actual: 6 * perModel, limit: ARIS_EXCEL_LIMITS.objectsPerTransaction }
    })
  }, 30_000)

  it('warns, without rejecting, above 250 control-flow objects in one model', () => {
    const count = ARIS_EXCEL_LIMITS.controlFlowObjectWarningThreshold + 1
    const result = parseArisWorkbook(
      'warning.xlsx',
      buildFixtureWorkbook({
        sheets: {
          Models: [{ model_id: 'MDL_1', model_type: 'MT_EEPC', name_en: 'Busy model' }],
          Objects: objectRows(count, 'MDL_1', 'OT_FUNC')
        }
      })
    )
    expect(result.status).toBe('accepted')
    expect(codes(result)).toEqual(['control-flow-object-warning'])
    expect(result.issues[0]).toMatchObject({
      severity: 'warning',
      sheet: 'Models',
      cell: 'A3',
      details: {
        actual: count,
        threshold: ARIS_EXCEL_LIMITS.controlFlowObjectWarningThreshold
      }
    })
    expect(result.model?.counts.controlFlowObjectsByModel.get('MDL_1')).toBe(count)
  }, 30_000)
})
