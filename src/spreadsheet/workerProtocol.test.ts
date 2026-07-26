import { describe, expect, it } from 'vitest'

import {
  customPropertiesFromXml,
  formulasFromWorksheetXml,
  handleSpreadsheetWorkerRequest,
  verifyInflatedXlsxArchive,
  workbookSheetPaths
} from './spreadsheet.worker'
import { unzipSync } from 'fflate'
import { createOfficialWorkbookTemplate } from './template'
import { preflightXlsx } from './xlsxPreflight'
import type { SpreadsheetWorkerResponse } from './workerProtocol'

function findCentral(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  for (let offset = 0; offset + 46 <= bytes.length; offset += 1) {
    if (view.getUint32(offset, true) === 0x02014b50) return offset
  }
  throw new Error('central directory not found')
}

describe('spreadsheet worker XML metadata', () => {
  it('maps workbook names to relationship worksheet paths', () => {
    const paths = workbookSheetPaths(
      '<workbook><sheets><sheet name="Steps &amp; Tasks" sheetId="1" r:id="rId7"/></sheets></workbook>',
      '<Relationships><Relationship Id="rId7" Target="worksheets/sheet9.xml"/></Relationships>'
    )
    expect(paths.get('Steps & Tasks')).toBe('xl/worksheets/sheet9.xml')
  })

  it('tags formulas and distinguishes missing cached values', () => {
    const formulas = formulasFromWorksheetXml(
      '<worksheet><sheetData><row r="2">' +
        '<c r="B2"><f>SUM(A1:A2)</f><v>4</v></c>' +
        '<c r="C2"><f t="shared" si="0"/></c>' +
        '</row></sheetData></worksheet>'
    )
    expect(formulas).toEqual([
      {
        row: 2,
        column: 2,
        formula: 'SUM(A1:A2)',
        cachedValuePresent: true
      },
      {
        row: 2,
        column: 3,
        formula: '[shared-formula]',
        cachedValuePresent: false
      }
    ])
  })

  it('reads the official custom-property marker without interpreting XML', () => {
    expect(
      customPropertiesFromXml(
        '<Properties><property name="OrbitPMTemplateVersion"><vt:lpwstr>0.4.5.1</vt:lpwstr></property></Properties>'
      )
    ).toEqual({ OrbitPMTemplateVersion: '0.4.5.1' })
  })

  it('parses every official workbook sheet through the production worker path', async () => {
    const template = createOfficialWorkbookTemplate('example')
    const responses: SpreadsheetWorkerResponse[] = []
    const input = new Uint8Array(template.length)
    input.set(template)

    await handleSpreadsheetWorkerRequest(
      {
        type: 'parse',
        requestId: 'xlsx-integration',
        format: 'xlsx',
        bytes: input.buffer
      },
      (response) => responses.push(response)
    )

    const result = responses.find(
      (
        response
      ): response is Extract<SpreadsheetWorkerResponse, { type: 'result'; format: 'xlsx' }> =>
        response.type === 'result' && response.format === 'xlsx'
    )
    expect(result?.workbook.sheets.map(({ name }) => name)).toEqual([
      'Processes',
      'Participants',
      'Steps',
      'Flows',
      'Glossary'
    ])
    expect(result?.workbook.customProperties).toMatchObject({
      OrbitPMTemplateVersion: '0.4.5.1'
    })
    expect(
      result?.workbook.sheets.find(({ name }) => name === 'Steps')?.rows.length
    ).toBeGreaterThan(1)
  })

  it('verifies inflated entry lengths and CRC before workbook parsing', async () => {
    const template = createOfficialWorkbookTemplate('blank')
    const preflight = preflightXlsx(template)
    const archive = unzipSync(template)
    expect(() => verifyInflatedXlsxArchive(preflight, archive)).not.toThrow()

    const entry = preflight.entries.find(
      ({ path, uncompressedBytes }) => !path.endsWith('/') && uncompressedBytes > 0
    )!
    expect(() =>
      verifyInflatedXlsxArchive(preflight, {
        ...archive,
        [entry.path]: archive[entry.path]!.subarray(0, entry.uncompressedBytes - 1)
      })
    ).toThrowError(
      expect.objectContaining({
        code: 'malformed-zip',
        details: expect.objectContaining({ reason: 'expanded-size-mismatch', path: entry.path })
      })
    )

    const corrupted = {
      ...archive,
      [entry.path]: archive[entry.path]!.slice()
    }
    corrupted[entry.path]![0] ^= 1
    expect(() => verifyInflatedXlsxArchive(preflight, corrupted)).toThrowError(
      expect.objectContaining({
        code: 'malformed-zip',
        details: expect.objectContaining({ reason: 'crc-mismatch', path: entry.path })
      })
    )
  })

  it('rejects a workbook whose local and central CRC fields agree on the wrong value', async () => {
    const bytes = new Uint8Array(createOfficialWorkbookTemplate('blank'))
    const view = new DataView(bytes.buffer)
    const central = findCentral(bytes)
    const local = view.getUint32(central + 42, true)
    const wrongCrc = (view.getUint32(central + 16, true) ^ 1) >>> 0
    view.setUint32(central + 16, wrongCrc, true)
    view.setUint32(local + 14, wrongCrc, true)
    const responses: SpreadsheetWorkerResponse[] = []

    await handleSpreadsheetWorkerRequest(
      {
        type: 'parse',
        requestId: 'xlsx-bad-crc',
        format: 'xlsx',
        bytes: bytes.buffer
      },
      (response) => responses.push(response)
    )

    expect(responses.at(-1)).toEqual({
      type: 'error',
      requestId: 'xlsx-bad-crc',
      code: 'malformed-zip',
      details: expect.objectContaining({ reason: 'crc-mismatch' })
    })
  })

  it('parses multiline UTF-8 CSV through Papa without weakening the strict boundary', async () => {
    const responses: SpreadsheetWorkerResponse[] = []
    const bytes = new TextEncoder().encode(
      '\ufeffProcess ID,Name EN,Name AR\r\np1,"Review\r\nrequest",مراجعة'
    )

    await handleSpreadsheetWorkerRequest(
      {
        type: 'parse',
        requestId: 'csv-integration',
        format: 'csv',
        delimiter: ',',
        bytes: bytes.buffer
      },
      (response) => responses.push(response)
    )

    expect(responses.at(-1)).toEqual({
      type: 'result',
      requestId: 'csv-integration',
      format: 'csv',
      rows: [
        ['Process ID', 'Name EN', 'Name AR'],
        ['p1', 'Review\nrequest', 'مراجعة']
      ]
    })
  })
})
