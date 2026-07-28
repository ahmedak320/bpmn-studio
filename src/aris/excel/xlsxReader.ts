import { strFromU8, unzipSync } from 'fflate'

import { archiveCrc32 } from '../../security/archivePreflight'
import { SpreadsheetError } from '../../spreadsheet/errors'
// The secure ZIP preflight is REUSED, never reimplemented: it is the only
// component allowed to interpret untrusted ZIP headers before inflation.
import { preflightXlsx, type XlsxPreflightResult } from '../../spreadsheet/xlsxPreflight'
import {
  createArisExcelIssue,
  throwArisExcelIssue,
  type ArisExcelIssue,
  type ArisExcelIssueCode
} from './issues'
import { ARIS_EXCEL_LIMITS } from './limits'
import { a1Address, columnLetters } from './xlsxWriter'

/**
 * A no-DOM, byte-in OOXML reader.
 *
 * It runs unchanged on the main thread and inside the inline worker: it only
 * uses `fflate`, `TextDecoder`, and string scanning. Formula text is read as
 * inert provenance and is never evaluated — only Excel's cached value is used,
 * and a formula without a cached value is rejected (§15.3 step 3).
 */

export type ArisCellKind = 'string' | 'number' | 'boolean' | 'error'

export interface ArisRawCell {
  /** A1-style address, e.g. `C7`. */
  readonly address: string
  readonly row: number
  readonly column: number
  /** Column letters, e.g. `C`. */
  readonly columnLetters: string
  /** The displayed text: for a formula cell this is Excel's cached value. */
  readonly text: string
  readonly kind: ArisCellKind
  /** Inert formula source, retained for provenance only. */
  readonly formula?: string
}

export interface ArisRawRow {
  readonly row: number
  readonly cells: readonly ArisRawCell[]
}

export interface ArisRawSheet {
  readonly name: string
  readonly rows: readonly ArisRawRow[]
}

export interface ArisRawWorkbook {
  readonly sheets: readonly ArisRawSheet[]
  readonly customProperties: Readonly<Record<string, string>>
  readonly preflight: XlsxPreflightResult
  /** Non-blocking findings raised while reading the container. */
  readonly issues: readonly ArisExcelIssue[]
  readonly counts: {
    readonly rows: number
    readonly nonEmptyCells: number
  }
}

const MACRO_CONTENT_TYPE = /macroEnabled|activeX|vbaProject|ms-office\.vbaProject/i

/**
 * Executable payloads the reused preflight does not classify by path. It knows
 * the OOXML macro/ActiveX/embedding locations; this catches an executable
 * smuggled into an otherwise legal part path (for example `xl/media/x.exe`).
 */
const EXECUTABLE_EXTENSION =
  /\.(?:exe|dll|com|scr|msi|bat|cmd|ps1|psm1|vbs|vbe|jse?|jar|sh|apk|dylib|so)$/i
const MZ_MAGIC = [0x4d, 0x5a] as const
const ELF_MAGIC = [0x7f, 0x45, 0x4c, 0x46] as const

function startsWith(bytes: Uint8Array, magic: readonly number[]): boolean {
  return bytes.length >= magic.length && magic.every((value, index) => bytes[index] === value)
}

/** Maps a reused `SpreadsheetError` code onto an ARIS issue code. */
const PREFLIGHT_CODE_MAP: Readonly<Record<string, ArisExcelIssueCode>> = Object.freeze({
  'unsupported-format': 'unsupported-file-extension',
  'legacy-excel-format': 'unsupported-file-extension',
  'macro-enabled-format': 'macro-content',
  'encrypted-workbook': 'encrypted-workbook',
  'malformed-zip': 'malformed-zip',
  'zip64-unsupported': 'zip64-unsupported',
  'multi-disk-zip': 'multi-disk-zip',
  'unsupported-compression': 'unsupported-compression',
  'unsafe-zip-path': 'unsafe-zip-path',
  'duplicate-zip-entry': 'duplicate-zip-entry',
  'macro-content': 'macro-content',
  'missing-xlsx-part': 'missing-xlsx-part',
  'compressed-size-limit': 'compressed-size-limit',
  'uncompressed-size-limit': 'uncompressed-size-limit',
  'worksheet-limit': 'sheet-limit'
})

function preflightIssueCode(error: SpreadsheetError): ArisExcelIssueCode {
  if (error.code === 'malformed-zip' && error.details.reason === 'entry-count') {
    return 'zip-entry-limit'
  }
  return PREFLIGHT_CODE_MAP[error.code] ?? 'malformed-zip'
}

function detailsFromError(error: SpreadsheetError): Readonly<Record<string, string | number>> {
  const details: Record<string, string | number> = {}
  for (const [key, value] of Object.entries(error.details)) {
    if (typeof value === 'string' || typeof value === 'number') details[key] = value
    else details[key] = String(value)
  }
  return details
}

export function decodeXmlText(value: string): string {
  return value
    .replace(/&#x([0-9a-fA-F]+);/g, (_, digits: string) =>
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

function attribute(source: string, name: string): string | undefined {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = new RegExp(`\\b${escaped}=(?:"([^"]*)"|'([^']*)')`).exec(source)
  return match ? decodeXmlText(match[1] ?? match[2] ?? '') : undefined
}

function addressParts(address: string): { row: number; column: number } | undefined {
  const match = /^([A-Z]+)([1-9][0-9]*)$/.exec(address)
  if (!match) return undefined
  let column = 0
  for (const character of match[1]!) column = column * 26 + character.charCodeAt(0) - 64
  const row = Number(match[2])
  if (!Number.isSafeInteger(row)) return undefined
  return { row, column }
}

export function sharedStringsFromXml(xml: string): readonly string[] {
  const strings: string[] = []
  for (const match of xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>|<si\b[^>]*\/>/g)) {
    const body = (match[1] ?? '').replace(/<rPh\b[\s\S]*?<\/rPh>/g, '')
    let text = ''
    for (const run of body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>|<t\b[^>]*\/>/g)) {
      text += decodeXmlText(run[1] ?? '')
    }
    strings.push(text)
  }
  return strings
}

export function customPropertiesFromXml(xml: string): Readonly<Record<string, string>> {
  const properties: Record<string, string> = {}
  for (const match of xml.matchAll(/<property\b([^>]*)>([\s\S]*?)<\/property>/g)) {
    const name = attribute(match[1] ?? '', 'name')
    if (!name) continue
    const value = /<vt:[A-Za-z0-9]+\b[^>]*>([\s\S]*?)<\/vt:[A-Za-z0-9]+>/.exec(match[2] ?? '')
    if (value) properties[name] = decodeXmlText(value[1] ?? '')
  }
  return Object.freeze(properties)
}

export function worksheetPathsFromXml(
  workbookXml: string,
  relationshipsXml: string
): readonly { readonly name: string; readonly path: string }[] {
  const targets = new Map<string, string>()
  for (const match of relationshipsXml.matchAll(
    /<Relationship\b([^>]*?)(?:\/>|>[\s\S]*?<\/Relationship>)/g
  )) {
    const attributes = match[1] ?? ''
    const id = attribute(attributes, 'Id')
    const target = attribute(attributes, 'Target')
    if (!id || !target) continue
    const normalized = target.replace(/^\/+/, '').replace(/^\.\//, '').replace(/^xl\//, '')
    if (!normalized.toLowerCase().startsWith('worksheets/')) continue
    targets.set(id, `xl/${normalized}`)
  }

  const sheets: { name: string; path: string }[] = []
  for (const match of workbookXml.matchAll(/<sheet\b([^>]*?)(?:\/>|>[\s\S]*?<\/sheet>)/g)) {
    const attributes = match[1] ?? ''
    const name = attribute(attributes, 'name')
    const relationId = attribute(attributes, 'r:id') ?? attribute(attributes, 'id')
    const path = relationId ? targets.get(relationId) : undefined
    if (name && path) sheets.push({ name, path })
  }
  return sheets
}

interface SheetReadState {
  rows: number
  nonEmptyCells: number
  issues: ArisExcelIssue[]
}

function cellText(
  body: string,
  type: string | undefined,
  sharedStrings: readonly string[]
): { text: string; kind: ArisCellKind; cachedValuePresent: boolean } {
  if (type === 'inlineStr') {
    const inline = body.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '')
    let text = ''
    let present = false
    for (const run of inline.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>|<t\b[^>]*\/>/g)) {
      text += decodeXmlText(run[1] ?? '')
      present = true
    }
    return { text, kind: 'string', cachedValuePresent: present }
  }
  const valueMatch = /<v\b[^>]*>([\s\S]*?)<\/v>|<v\b[^>]*\/>/.exec(body)
  if (!valueMatch) return { text: '', kind: 'string', cachedValuePresent: false }
  const raw = decodeXmlText(valueMatch[1] ?? '')
  if (type === 's') {
    const index = Number(raw)
    const resolved = Number.isSafeInteger(index) ? (sharedStrings[index] ?? '') : ''
    return { text: resolved, kind: 'string', cachedValuePresent: true }
  }
  if (type === 'b') {
    return { text: raw === '1' ? 'true' : 'false', kind: 'boolean', cachedValuePresent: true }
  }
  if (type === 'e') return { text: raw, kind: 'error', cachedValuePresent: true }
  if (type === 'str') return { text: raw, kind: 'string', cachedValuePresent: true }
  return { text: raw, kind: 'number', cachedValuePresent: true }
}

function readWorksheet(
  name: string,
  xml: string,
  sharedStrings: readonly string[],
  state: SheetReadState
): ArisRawSheet {
  const rows: ArisRawRow[] = []
  for (const rowMatch of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    state.rows += 1
    if (state.rows > ARIS_EXCEL_LIMITS.rows) {
      throwArisExcelIssue('row-limit', {
        sheet: name,
        details: { actual: state.rows, limit: ARIS_EXCEL_LIMITS.rows }
      })
    }
    const rowAttributes = rowMatch[1] ?? ''
    const declaredRow = Number(attribute(rowAttributes, 'r') ?? '')
    const rowNumber =
      Number.isSafeInteger(declaredRow) && declaredRow > 0 ? declaredRow : state.rows
    const body = rowMatch[2] ?? ''
    const cells: ArisRawCell[] = []
    let positionalColumn = 0

    for (const cellMatch of body.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attributes = cellMatch[1] ?? ''
      const cellBody = cellMatch[2] ?? ''
      const reference = attribute(attributes, 'r')
      const parts = reference ? addressParts(reference) : undefined
      positionalColumn = parts ? parts.column : positionalColumn + 1
      const column = positionalColumn
      if (column > ARIS_EXCEL_LIMITS.columns) {
        throwArisExcelIssue('column-limit', {
          sheet: name,
          row: rowNumber,
          cell: a1Address(rowNumber, Math.min(column, 16_384)),
          details: { actual: column, limit: ARIS_EXCEL_LIMITS.columns }
        })
      }
      const address = a1Address(rowNumber, column)
      const type = attribute(attributes, 't')
      const formulaMatch =
        /<f\b[^>]*>([\s\S]*?)<\/f>/.exec(cellBody) ?? /<f\b([^>]*)\/>/.exec(cellBody)
      const { text, kind, cachedValuePresent } = cellText(cellBody, type, sharedStrings)

      if (formulaMatch) {
        // Formula source is provenance only. It is never evaluated, and a
        // formula whose cached value Excel did not persist is a hard rejection.
        const formula = formulaMatch[0].includes('</f>')
          ? decodeXmlText(formulaMatch[1] ?? '')
          : '[shared-formula]'
        if (!cachedValuePresent) {
          state.issues.push(
            createArisExcelIssue('formula-without-cached-value', 'error', {
              sheet: name,
              cell: address,
              row: rowNumber,
              column: columnLetters(column),
              value: formula
            })
          )
        } else {
          state.issues.push(
            createArisExcelIssue('cached-formula-value', 'warning', {
              sheet: name,
              cell: address,
              row: rowNumber,
              column: columnLetters(column),
              value: formula,
              details: { cachedValue: text }
            })
          )
        }
      }

      if (text.length > ARIS_EXCEL_LIMITS.cellCharacters) {
        throwArisExcelIssue('cell-length-limit', {
          sheet: name,
          cell: address,
          row: rowNumber,
          column: columnLetters(column),
          details: { actual: text.length, limit: ARIS_EXCEL_LIMITS.cellCharacters }
        })
      }
      if (text.length > 0) {
        state.nonEmptyCells += 1
        if (state.nonEmptyCells > ARIS_EXCEL_LIMITS.nonEmptyCells) {
          throwArisExcelIssue('cell-count-limit', {
            sheet: name,
            cell: address,
            details: { actual: state.nonEmptyCells, limit: ARIS_EXCEL_LIMITS.nonEmptyCells }
          })
        }
      }

      cells.push(
        Object.freeze({
          address,
          row: rowNumber,
          column,
          columnLetters: columnLetters(column),
          text,
          kind,
          ...(formulaMatch
            ? {
                formula: formulaMatch[0].includes('</f>')
                  ? decodeXmlText(formulaMatch[1] ?? '')
                  : '[shared-formula]'
              }
            : {})
        })
      )
    }
    rows.push(Object.freeze({ row: rowNumber, cells: Object.freeze(cells) }))
  }
  return Object.freeze({ name, rows: Object.freeze(rows) })
}

function decodeEntry(
  archive: Readonly<Record<string, Uint8Array>>,
  path: string
): string | undefined {
  const entry = archive[path]
  return entry ? strFromU8(entry) : undefined
}

/**
 * Reads a workbook from bytes: secure preflight, bounded inflation, CRC/size
 * verification, then a no-DOM scan of the OOXML parts.
 */
export function readArisXlsx(bytes: Uint8Array): ArisRawWorkbook {
  let preflight: XlsxPreflightResult
  try {
    preflight = preflightXlsx(bytes)
  } catch (cause) {
    if (cause instanceof SpreadsheetError) {
      throwArisExcelIssue(
        preflightIssueCode(cause),
        { details: { ...detailsFromError(cause), preflight: cause.code } },
        { cause }
      )
    }
    throwArisExcelIssue('malformed-zip', { details: { reason: 'preflight-failed' } }, { cause })
  }

  const issues: ArisExcelIssue[] = preflight.warnings.map((warning) =>
    createArisExcelIssue(
      warning.code === 'external-links-ignored'
        ? 'external-links-ignored'
        : 'data-connections-ignored',
      'warning',
      { details: { entries: warning.entries.join(',') } }
    )
  )

  let archive: Readonly<Record<string, Uint8Array>>
  try {
    archive = unzipSync(bytes)
  } catch (cause) {
    throwArisExcelIssue('malformed-zip', { details: { reason: 'inflate-failed' } }, { cause })
  }

  // ZIP headers stay untrusted after preflight: verify what actually inflated.
  for (const entry of preflight.entries) {
    if (entry.path.endsWith('/')) continue
    const inflated = archive[entry.path]
    if (!inflated || inflated.byteLength !== entry.uncompressedBytes) {
      throwArisExcelIssue('expanded-size-mismatch', {
        details: {
          path: entry.path,
          expected: entry.uncompressedBytes,
          actual: inflated?.byteLength ?? -1
        }
      })
    }
    if (archiveCrc32(inflated) !== entry.crc32) {
      throwArisExcelIssue('malformed-zip', {
        details: { reason: 'crc-mismatch', path: entry.path }
      })
    }
    if (
      EXECUTABLE_EXTENSION.test(entry.path) ||
      startsWith(inflated, MZ_MAGIC) ||
      startsWith(inflated, ELF_MAGIC)
    ) {
      throwArisExcelIssue('executable-content', { details: { path: entry.path } })
    }
  }

  const contentTypes = decodeEntry(archive, '[Content_Types].xml') ?? ''
  if (MACRO_CONTENT_TYPE.test(contentTypes)) {
    throwArisExcelIssue('macro-content', { details: { part: '[Content_Types].xml' } })
  }

  const workbookXml = decodeEntry(archive, 'xl/workbook.xml')
  if (workbookXml === undefined) {
    throwArisExcelIssue('missing-xlsx-part', { details: { path: 'xl/workbook.xml' } })
  }
  const relationshipsXml = decodeEntry(archive, 'xl/_rels/workbook.xml.rels') ?? ''
  const sheetPaths = worksheetPathsFromXml(workbookXml, relationshipsXml)
  if (sheetPaths.length > ARIS_EXCEL_LIMITS.sheets) {
    throwArisExcelIssue('sheet-limit', {
      details: { actual: sheetPaths.length, limit: ARIS_EXCEL_LIMITS.sheets }
    })
  }

  const sharedStrings = sharedStringsFromXml(decodeEntry(archive, 'xl/sharedStrings.xml') ?? '')
  const state: SheetReadState = { rows: 0, nonEmptyCells: 0, issues }
  const sheets = sheetPaths.map(({ name, path }) => {
    const xml = decodeEntry(archive, path)
    if (xml === undefined) {
      throwArisExcelIssue('missing-xlsx-part', { sheet: name, details: { path } })
    }
    return readWorksheet(name, xml, sharedStrings, state)
  })

  const customXml = decodeEntry(archive, 'docProps/custom.xml')
  return Object.freeze({
    sheets: Object.freeze(sheets),
    customProperties: customXml ? customPropertiesFromXml(customXml) : Object.freeze({}),
    preflight,
    issues: Object.freeze(issues),
    counts: Object.freeze({ rows: state.rows, nonEmptyCells: state.nonEmptyCells })
  })
}
