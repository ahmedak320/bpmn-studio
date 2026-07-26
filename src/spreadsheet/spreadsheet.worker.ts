import Papa from 'papaparse'
import readXlsxFile from 'read-excel-file/web-worker'
import { strFromU8, unzipSync } from 'fflate'

import type { ParsedWorkbookData, WorkbookCell, WorkbookSheetData } from './contracts'
import { parseCsvText } from './csv'
import { SpreadsheetError } from './errors'
import { SPREADSHEET_LIMITS } from './limits'
import { preflightXlsx } from './xlsxPreflight'
import type {
  SpreadsheetWorkerParseRequest,
  SpreadsheetWorkerRequest,
  SpreadsheetWorkerResponse
} from './workerProtocol'

interface WorkerMessageEvent<T> {
  readonly data: T
}

interface SpreadsheetWorkerScope {
  addEventListener(
    type: 'message',
    listener: (event: WorkerMessageEvent<SpreadsheetWorkerRequest>) => void
  ): void
  postMessage(message: SpreadsheetWorkerResponse): void
}

interface WorksheetFormula {
  readonly row: number
  readonly column: number
  readonly formula: string
  readonly cachedValuePresent: boolean
}

function xmlText(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, digits: string) =>
      String.fromCodePoint(Number.parseInt(digits, 16))
    )
    .replace(/&#([0-9]+);/g, (_, digits: string) =>
      String.fromCodePoint(Number.parseInt(digits, 10))
    )
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

function xmlAttribute(source: string, name: string): string | undefined {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = new RegExp(`\\b${escaped}=(?:"([^"]*)"|'([^']*)')`, 'i').exec(source)
  return match ? xmlText(match[1] ?? match[2] ?? '') : undefined
}

function columnNumber(address: string): number | undefined {
  const match = /^([A-Z]+)[1-9][0-9]*$/i.exec(address)
  if (!match) return undefined
  let value = 0
  for (const character of match[1]!.toUpperCase()) {
    value = value * 26 + character.charCodeAt(0) - 64
  }
  return value
}

function rowNumber(address: string): number | undefined {
  const match = /^[A-Z]+([1-9][0-9]*)$/i.exec(address)
  if (!match) return undefined
  const value = Number(match[1])
  return Number.isSafeInteger(value) ? value : undefined
}

/**
 * Formula XML is read only to tag the cached displayed values returned by
 * read-excel-file. Formula expressions are retained as inert provenance and
 * are never interpreted or evaluated.
 */
export function formulasFromWorksheetXml(xml: string): readonly WorksheetFormula[] {
  const formulas: WorksheetFormula[] = []
  const cellPattern = /<c\b([^>]*)>([\s\S]*?)<\/c>/gi
  let cellMatch: RegExpExecArray | null
  while ((cellMatch = cellPattern.exec(xml))) {
    const address = xmlAttribute(cellMatch[1] ?? '', 'r')
    if (!address) continue
    const row = rowNumber(address)
    const column = columnNumber(address)
    if (!row || !column) continue
    const body = cellMatch[2] ?? ''
    const formulaMatch = /<f\b[^>]*>([\s\S]*?)<\/f>/i.exec(body) ?? /<f\b([^>]*)\/>/i.exec(body)
    if (!formulaMatch) continue
    const formula = formulaMatch[0].includes('</f>')
      ? xmlText(formulaMatch[1] ?? '')
      : '[shared-formula]'
    formulas.push(
      Object.freeze({
        row,
        column,
        formula,
        cachedValuePresent: /<v\b[^>]*>[\s\S]*?<\/v>/i.test(body)
      })
    )
  }
  return Object.freeze(formulas)
}

export function workbookSheetPaths(
  workbookXml: string,
  relationshipsXml: string
): ReadonlyMap<string, string> {
  const relationshipTargets = new Map<string, string>()
  const relationshipPattern = /<Relationship\b([^>]*?)(?:\/>|>[\s\S]*?<\/Relationship>)/gi
  let relationshipMatch: RegExpExecArray | null
  while ((relationshipMatch = relationshipPattern.exec(relationshipsXml))) {
    const attributes = relationshipMatch[1] ?? ''
    const id = xmlAttribute(attributes, 'Id')
    const target = xmlAttribute(attributes, 'Target')
    if (!id || !target) continue
    const normalized = target.replace(/^\/+/, '').replace(/^xl\//i, '').replace(/^\.\//, '')
    if (!normalized.toLocaleLowerCase('en-US').startsWith('worksheets/')) continue
    relationshipTargets.set(id, `xl/${normalized}`)
  }

  const result = new Map<string, string>()
  const sheetPattern = /<sheet\b([^>]*?)(?:\/>|>[\s\S]*?<\/sheet>)/gi
  let sheetMatch: RegExpExecArray | null
  while ((sheetMatch = sheetPattern.exec(workbookXml))) {
    const attributes = sheetMatch[1] ?? ''
    const name = xmlAttribute(attributes, 'name')
    const relationId = xmlAttribute(attributes, 'r:id') ?? xmlAttribute(attributes, 'id')
    const target = relationId ? relationshipTargets.get(relationId) : undefined
    if (name && target) result.set(name, target)
  }
  return result
}

export function customPropertiesFromXml(xml: string): Readonly<Record<string, string>> {
  const properties: Record<string, string> = {}
  const propertyPattern = /<property\b([^>]*)>([\s\S]*?)<\/property>/gi
  let propertyMatch: RegExpExecArray | null
  while ((propertyMatch = propertyPattern.exec(xml))) {
    const name = xmlAttribute(propertyMatch[1] ?? '', 'name')
    if (!name) continue
    const valueMatch = /<vt:[A-Za-z0-9]+\b[^>]*>([\s\S]*?)<\/vt:[A-Za-z0-9]+>/i.exec(
      propertyMatch[2] ?? ''
    )
    if (valueMatch) properties[name] = xmlText(valueMatch[1] ?? '')
  }
  return Object.freeze(properties)
}

function withFormulaMetadata(
  data: readonly (readonly unknown[])[],
  formulas: readonly WorksheetFormula[]
): readonly (readonly WorkbookCell[])[] {
  const rows: WorkbookCell[][] = data.map((sourceRow) =>
    sourceRow.map((value) => {
      const displayed =
        value === null ||
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean' ||
        value instanceof Date
          ? value
          : String(value)
      return { value: displayed, rawValue: displayed }
    })
  )
  for (const formula of formulas) {
    if (formula.row > SPREADSHEET_LIMITS.inputRows || formula.column > SPREADSHEET_LIMITS.columns) {
      continue
    }
    while (rows.length < formula.row) rows.push([])
    const row = rows[formula.row - 1]!
    while (row.length < formula.column) row.push({ value: null })
    const displayed = row[formula.column - 1]?.value ?? null
    row[formula.column - 1] = {
      value: displayed,
      rawValue: displayed,
      formula: formula.formula,
      cachedValuePresent: formula.cachedValuePresent
    }
  }
  return Object.freeze(rows.map((row) => Object.freeze(row.map((cell) => Object.freeze(cell)))))
}

function decodeArchiveEntry(
  archive: Readonly<Record<string, Uint8Array>>,
  path: string
): string | undefined {
  const entry = archive[path]
  return entry ? strFromU8(entry) : undefined
}

async function parseXlsx(
  bytes: Uint8Array,
  progress: (completed: number, total: number) => void
): Promise<ParsedWorkbookData> {
  const preflight = preflightXlsx(bytes)
  progress(0, Math.max(1, preflight.worksheetCount))

  // The browser-specific entry is intentionally used inside this dedicated
  // application worker. It returns cached/displayed values and does not expose
  // formatting as process semantics.
  const input = new Uint8Array(bytes.byteLength)
  input.set(bytes)
  const parsed = await readXlsxFile(input.buffer)

  let archive: Readonly<Record<string, Uint8Array>>
  try {
    archive = unzipSync(bytes)
  } catch (cause) {
    throw new SpreadsheetError('malformed-zip', { reason: 'inflate-failed' }, { cause })
  }
  const workbookXml = decodeArchiveEntry(archive, 'xl/workbook.xml') ?? ''
  const relationshipsXml = decodeArchiveEntry(archive, 'xl/_rels/workbook.xml.rels') ?? ''
  const paths = workbookSheetPaths(workbookXml, relationshipsXml)

  const sheets: WorkbookSheetData[] = parsed.map((sheet, index) => {
    const path = paths.get(sheet.sheet)
    const worksheetXml = path ? decodeArchiveEntry(archive, path) : undefined
    const formulas = worksheetXml ? formulasFromWorksheetXml(worksheetXml) : []
    progress(index + 1, Math.max(1, parsed.length))
    return Object.freeze({
      name: sheet.sheet,
      rows: withFormulaMetadata(sheet.data, formulas)
    })
  })
  const customXml = decodeArchiveEntry(archive, 'docProps/custom.xml')
  const customProperties = customXml ? customPropertiesFromXml(customXml) : undefined

  return Object.freeze({
    sheets: Object.freeze(sheets),
    ...(customProperties && Object.keys(customProperties).length > 0 ? { customProperties } : {})
  })
}

function parseCsv(
  bytes: Uint8Array,
  delimiter: string,
  progress: (completed: number, total: number) => void
): readonly (readonly string[])[] {
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch (cause) {
    throw new SpreadsheetError('invalid-utf8', {}, { cause })
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)

  // Keep the core's deliberately strict RFC-4180 acceptance rules. Papa Parse
  // then performs the production row parsing in this worker.
  const strictRows = parseCsvText(text, { delimiter })
  progress(0, Math.max(1, text.length))
  const parsed = Papa.parse<string[]>(text, {
    delimiter,
    skipEmptyLines: false
  })
  const serious = parsed.errors.find(
    (error) => error.type === 'Quotes' || error.code === 'UndetectableDelimiter'
  )
  if (serious) {
    throw new SpreadsheetError('malformed-csv', {
      row: serious.row === undefined ? 1 : serious.row + 1,
      code: serious.code
    })
  }
  progress(text.length, Math.max(1, text.length))

  // Papa intentionally retains a single empty record after a terminal newline;
  // the strict boundary contract does not. Returning the strict shape also
  // normalizes CRLF embedded in quoted fields consistently across browsers.
  void parsed.data
  return strictRows
}

function workerError(requestId: string, cause: unknown): SpreadsheetWorkerResponse {
  if (cause instanceof SpreadsheetError) {
    return {
      type: 'error',
      requestId,
      code: cause.code,
      details: cause.details
    }
  }
  return {
    type: 'error',
    requestId,
    code: 'adapter-contract-violation',
    details: { contract: 'spreadsheet-worker' }
  }
}

export async function handleSpreadsheetWorkerRequest(
  request: SpreadsheetWorkerParseRequest,
  post: (response: SpreadsheetWorkerResponse) => void
): Promise<void> {
  const bytes = new Uint8Array(request.bytes)
  const report = (completed: number, total: number): void => {
    post({
      type: 'progress',
      requestId: request.requestId,
      progress: { phase: 'parse', completed, total }
    })
  }
  try {
    if (request.format === 'xlsx') {
      const workbook = await parseXlsx(bytes, report)
      post({
        type: 'result',
        requestId: request.requestId,
        format: 'xlsx',
        workbook
      })
      return
    }
    const rows = parseCsv(bytes, request.delimiter ?? ',', report)
    post({
      type: 'result',
      requestId: request.requestId,
      format: 'csv',
      rows
    })
  } catch (cause) {
    post(workerError(request.requestId, cause))
  }
}

const workerScope = globalThis as unknown as Partial<SpreadsheetWorkerScope>
if (
  typeof workerScope.addEventListener === 'function' &&
  typeof workerScope.postMessage === 'function' &&
  typeof document === 'undefined'
) {
  const cancelled = new Set<string>()
  workerScope.addEventListener('message', (event) => {
    const request = event.data
    if (request.type === 'cancel') {
      cancelled.add(request.requestId)
      return
    }
    void handleSpreadsheetWorkerRequest(request, (response) => {
      if (!cancelled.has(request.requestId)) workerScope.postMessage?.(response)
    })
  })
}
