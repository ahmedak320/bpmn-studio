import { deflateSync } from 'fflate'

import { archiveCrc32 } from '../../security/archivePreflight'

/**
 * A deterministic, macro-free OOXML (.xlsx) writer.
 *
 * Determinism contract (required by §15.1 "generate deterministic ... templates
 * from code"):
 * - Entry order is fixed (sorted by path with an invariant comparator).
 * - Timestamps are a constant DOS epoch (1980-01-01T00:00:00), never
 *   `Date.now()` and never timezone-derived. `fflate`'s `zipSync` derives DOS
 *   time from the *local* timezone, so the ZIP container is assembled here and
 *   only entry compression is delegated to `fflate`'s `deflateSync`.
 * - No random identifiers, absolute paths, user names, or machine data.
 * - No macros, no external links, no ActiveX, no calculated formulas.
 */

export type XlsxCellValue = string | number | boolean | null

export interface XlsxSheetInput {
  readonly name: string
  readonly rows: readonly (readonly XlsxCellValue[])[]
}

export interface XlsxWriteOptions {
  /** Custom document properties written to `docProps/custom.xml`, in order. */
  readonly customProperties?: readonly (readonly [name: string, value: string])[]
  readonly application?: string
  readonly creator?: string
  /** Fixed ISO timestamp for docProps/core.xml. Never `new Date()`. */
  readonly createdIso?: string
}

const encoder = new TextEncoder()

/** 1980-01-01T00:00:00 in DOS date/time fields. */
const DOS_DATE = 0x0021
const DOS_TIME = 0x0000
const ZIP_UTF8_FLAG = 0x0800
const ZIP_STORED = 0
const ZIP_DEFLATED = 8
const DEFAULT_CREATED_ISO = '2026-01-01T00:00:00Z'
const CUSTOM_PROPERTY_FMTID = '{D5CDD505-2E9C-101B-9397-08002B2CF9AE}'

export function xmlEscape(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

export function columnLetters(column: number): string {
  if (!Number.isInteger(column) || column < 1) {
    throw new RangeError('column must be a positive integer')
  }
  let remaining = column
  let letters = ''
  while (remaining > 0) {
    remaining -= 1
    letters = String.fromCharCode(65 + (remaining % 26)) + letters
    remaining = Math.floor(remaining / 26)
  }
  return letters
}

export function a1Address(row: number, column: number): string {
  if (!Number.isInteger(row) || row < 1) {
    throw new RangeError('row must be a positive integer')
  }
  return `${columnLetters(column)}${row}`
}

/** Serializes rows into worksheet XML. Values are literals; never formulas. */
export function worksheetXmlFromRows(rows: readonly (readonly XlsxCellValue[])[]): string {
  const header =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
  if (rows.length === 0) return `${header}<sheetData/></worksheet>`
  const parts: string[] = [header, '<sheetData>']
  for (const [rowIndex, row] of rows.entries()) {
    const rowNumber = rowIndex + 1
    parts.push(`<row r="${rowNumber}">`)
    for (const [columnIndex, value] of row.entries()) {
      if (value === null || value === '') continue
      const reference = a1Address(rowNumber, columnIndex + 1)
      if (typeof value === 'number') {
        parts.push(`<c r="${reference}"><v>${String(value)}</v></c>`)
      } else if (typeof value === 'boolean') {
        parts.push(`<c r="${reference}" t="b"><v>${value ? '1' : '0'}</v></c>`)
      } else {
        const preserve = /^\s|\s$|\n/.test(value) ? ' xml:space="preserve"' : ''
        parts.push(
          `<c r="${reference}" t="inlineStr"><is><t${preserve}>${xmlEscape(value)}</t></is></c>`
        )
      }
    }
    parts.push('</row>')
  }
  parts.push('</sheetData></worksheet>')
  return parts.join('')
}

export interface ZipSource {
  readonly path: string
  readonly bytes: Uint8Array
}

/** A worksheet supplied as already-serialized OOXML. */
export interface XlsxWorksheetXmlInput {
  readonly name: string
  readonly xml: string
}

function workbookParts(
  sheets: readonly XlsxWorksheetXmlInput[],
  options: XlsxWriteOptions
): readonly ZipSource[] {
  const contentTypes =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    sheets
      .map(
        (_, index) =>
          `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
      )
      .join('') +
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
    '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' +
    '<Override PartName="/docProps/custom.xml" ContentType="application/vnd.openxmlformats-officedocument.custom-properties+xml"/>' +
    '</Types>'

  const rootRelationships =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
    '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>' +
    '<Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/custom-properties" Target="docProps/custom.xml"/>' +
    '</Relationships>'

  const workbook =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<workbookPr date1904="false"/><sheets>' +
    sheets
      .map(
        (sheet, index) =>
          `<sheet name="${xmlEscape(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`
      )
      .join('') +
    '</sheets><calcPr calcId="0" fullCalcOnLoad="0"/></workbook>'

  const workbookRelationships =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    sheets
      .map(
        (_, index) =>
          `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`
      )
      .join('') +
    `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
    '</Relationships>'

  const styles =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<fonts count="1"><font><sz val="11"/><name val="Arial"/></font></fonts>' +
    '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>' +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
    '</styleSheet>'

  const created = options.createdIso ?? DEFAULT_CREATED_ISO
  const creator = options.creator ?? 'OrbitPM'
  const core =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
    `<dc:creator>${xmlEscape(creator)}</dc:creator>` +
    `<cp:lastModifiedBy>${xmlEscape(creator)}</cp:lastModifiedBy>` +
    `<dcterms:created xsi:type="dcterms:W3CDTF">${created}</dcterms:created>` +
    `<dcterms:modified xsi:type="dcterms:W3CDTF">${created}</dcterms:modified>` +
    '</cp:coreProperties>'

  const app =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">' +
    `<Application>${xmlEscape(options.application ?? 'OrbitPM ARIS Studio Lite')}</Application>` +
    '</Properties>'

  const custom =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">' +
    (options.customProperties ?? [])
      .map(
        ([name, value], index) =>
          `<property fmtid="${CUSTOM_PROPERTY_FMTID}" pid="${index + 2}" name="${xmlEscape(name)}"><vt:lpwstr>${xmlEscape(value)}</vt:lpwstr></property>`
      )
      .join('') +
    '</Properties>'

  const textParts: Array<readonly [string, string]> = [
    ['[Content_Types].xml', contentTypes],
    ['_rels/.rels', rootRelationships],
    ['docProps/app.xml', app],
    ['docProps/core.xml', core],
    ['docProps/custom.xml', custom],
    ['xl/_rels/workbook.xml.rels', workbookRelationships],
    ['xl/styles.xml', styles],
    ['xl/workbook.xml', workbook],
    ...sheets.map((sheet, index) => [`xl/worksheets/sheet${index + 1}.xml`, sheet.xml] as const)
  ]

  return Object.freeze(
    textParts
      .map(([path, text]) => Object.freeze({ path, bytes: encoder.encode(text) }))
      // A locale-independent comparator: the paths are ASCII, so byte order is
      // stable on every host.
      .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0))
  )
}

class ByteSink {
  private buffer = new Uint8Array(1024)
  private length = 0

  private ensure(extra: number): void {
    if (this.length + extra <= this.buffer.length) return
    let capacity = this.buffer.length * 2
    while (capacity < this.length + extra) capacity *= 2
    const next = new Uint8Array(capacity)
    next.set(this.buffer.subarray(0, this.length))
    this.buffer = next
  }

  get size(): number {
    return this.length
  }

  u16(value: number): void {
    this.ensure(2)
    this.buffer[this.length] = value & 0xff
    this.buffer[this.length + 1] = (value >>> 8) & 0xff
    this.length += 2
  }

  u32(value: number): void {
    this.ensure(4)
    this.buffer[this.length] = value & 0xff
    this.buffer[this.length + 1] = (value >>> 8) & 0xff
    this.buffer[this.length + 2] = (value >>> 16) & 0xff
    this.buffer[this.length + 3] = (value >>> 24) & 0xff
    this.length += 4
  }

  raw(bytes: Uint8Array): void {
    this.ensure(bytes.length)
    this.buffer.set(bytes, this.length)
    this.length += bytes.length
  }

  toBytes(): Uint8Array {
    return this.buffer.slice(0, this.length)
  }
}

/**
 * Assembles a ZIP with fixed timestamps and no data descriptors, so the output
 * is byte-identical for identical inputs on every host and timezone.
 */
export function writeDeterministicZip(entries: readonly ZipSource[]): Uint8Array {
  const output = new ByteSink()
  const central = new ByteSink()

  for (const entry of entries) {
    const path = encoder.encode(entry.path)
    const checksum = archiveCrc32(entry.bytes)
    // Payloads under one ZIP header's worth of bytes can never benefit from
    // compression, so they are stored without invoking the deflater.
    const deflated =
      entry.bytes.length < 64 ? entry.bytes : deflateSync(entry.bytes, { level: 9, mem: 12 })
    const stored = deflated.length >= entry.bytes.length
    const method = stored ? ZIP_STORED : ZIP_DEFLATED
    const payload = stored ? entry.bytes : deflated
    const localOffset = output.size

    output.u32(0x04034b50)
    output.u16(20)
    output.u16(ZIP_UTF8_FLAG)
    output.u16(method)
    output.u16(DOS_TIME)
    output.u16(DOS_DATE)
    output.u32(checksum)
    output.u32(payload.length)
    output.u32(entry.bytes.length)
    output.u16(path.length)
    output.u16(0)
    output.raw(path)
    output.raw(payload)

    central.u32(0x02014b50)
    central.u16(20)
    central.u16(20)
    central.u16(ZIP_UTF8_FLAG)
    central.u16(method)
    central.u16(DOS_TIME)
    central.u16(DOS_DATE)
    central.u32(checksum)
    central.u32(payload.length)
    central.u32(entry.bytes.length)
    central.u16(path.length)
    central.u16(0)
    central.u16(0)
    central.u16(0)
    central.u16(0)
    central.u32(0)
    central.u32(localOffset)
    central.raw(path)
  }

  const centralOffset = output.size
  const centralBytes = central.toBytes()
  output.raw(centralBytes)
  output.u32(0x06054b50)
  output.u16(0)
  output.u16(0)
  output.u16(entries.length)
  output.u16(entries.length)
  output.u32(centralBytes.length)
  output.u32(centralOffset)
  output.u16(0)
  return output.toBytes()
}

/** Writes a workbook from already-serialized worksheet XML. */
export function writeXlsxFromWorksheetXml(
  sheets: readonly XlsxWorksheetXmlInput[],
  options: XlsxWriteOptions = {}
): Uint8Array {
  return writeDeterministicZip(workbookParts(sheets, options))
}

/** Writes a complete, macro-free, formula-free `.xlsx` workbook. */
export function writeXlsx(
  sheets: readonly XlsxSheetInput[],
  options: XlsxWriteOptions = {}
): Uint8Array {
  return writeXlsxFromWorksheetXml(
    sheets.map((sheet) => ({ name: sheet.name, xml: worksheetXmlFromRows(sheet.rows) })),
    options
  )
}
