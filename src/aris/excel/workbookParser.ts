import {
  ArisExcelIssueError,
  countIssues,
  createArisExcelIssue,
  hasBlockingIssue,
  type ArisExcelIssue,
  type ArisExcelIssueCode,
  type ArisExcelIssueSeverity
} from './issues'
import { ARIS_EXCEL_LIMITS } from './limits'
import {
  ARIS_ATTRIBUTE_TYPE_PATTERN,
  ARIS_COLOR_PATTERN,
  ARIS_CONNECTION_TYPE_PATTERN,
  ARIS_KNOWN_SYMBOL_TYPES,
  ARIS_SHEET_SPECS,
  ARIS_SYMBOL_TYPE_PATTERN,
  ARIS_TEMPLATE_IDENTITY,
  ARIS_TEMPLATE_IDENTITY_PROPERTY,
  ARIS_TEMPLATE_KIND_PROPERTY,
  ARIS_TEMPLATE_PROPERTY,
  ARIS_TEMPLATE_VERSION,
  LEGACY_SHEET_NAMES,
  LEGACY_TEMPLATE_PROPERTY,
  inferSymbolType,
  isArisSheetName,
  isControlFlowObjectType,
  parseRoutePoints,
  type ArisAttributeOwnerKind,
  type ArisColumnSpec,
  type ArisTemplateModelType,
  type ArisObjectType,
  type ArisRoutePoint,
  type ArisSheetName,
  type ArisSheetSpec
} from './templateSchema'
import type {
  ArisCellProvenance,
  ArisRowProvenance,
  ArisSourcedValue,
  ArisWorkbookAssignmentRecord,
  ArisWorkbookAttributeRecord,
  ArisWorkbookConnectionRecord,
  ArisWorkbookFreeTextRecord,
  ArisWorkbookGlossaryRecord,
  ArisWorkbookLaneRecord,
  ArisWorkbookModel,
  ArisWorkbookModelRecord,
  ArisWorkbookObjectRecord,
  ArisWorkbookParseResult,
  ArisWorkbookStyleRecord,
  ArisWorkbookTemplateDetection
} from './workbookModel'
import {
  readArisXlsx,
  type ArisRawCell,
  type ArisRawSheet,
  type ArisRawWorkbook
} from './xlsxReader'
import { a1Address, columnLetters } from './xlsxWriter'

/**
 * The §15.3 spreadsheet pipeline, steps 1-7.
 *
 * `parseArisWorkbook` is a pure function of (file name, bytes) with no DOM,
 * no network, and no globals beyond `TextDecoder`, so the same function runs on
 * the main thread and inside the inline worker (`workbookParser.worker.ts`).
 *
 * It never throws for input problems: every rejection is reported as a
 * localizable `ArisExcelIssue` on the returned result.
 */

const XLSX_EXTENSION = 'xlsx'

const ALLOWED_MIME_TYPES: ReadonlySet<string> = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/octet-stream',
  'application/zip',
  ''
])

/** Rows scanned for the header row before a sheet is considered headerless. */
const HEADER_SCAN_ROWS = 20

export interface ArisWorkbookParseOptions {
  /** Browser-reported MIME type, when the caller has one. */
  readonly mimeType?: string
}

interface IssueSink {
  push(code: ArisExcelIssueCode, severity: ArisExcelIssueSeverity, init?: IssueInit): void
}

interface IssueInit {
  readonly sheet?: string
  readonly cell?: string
  readonly row?: number
  readonly column?: string
  readonly value?: string
  readonly details?: Readonly<Record<string, string | number | boolean>>
}

function createIssueSink(issues: ArisExcelIssue[]): IssueSink {
  return {
    push(code, severity, init = {}) {
      issues.push(createArisExcelIssue(code, severity, init))
    }
  }
}

function fileExtension(fileName: string): string {
  const match = /\.([^.]+)$/.exec(fileName.trim())
  return match?.[1]?.toLocaleLowerCase('en-US') ?? ''
}

function rejected(
  fileName: string,
  issues: readonly ArisExcelIssue[],
  detection: ArisWorkbookTemplateDetection
): ArisWorkbookParseResult {
  return Object.freeze({
    status: 'rejected',
    fileName,
    detection,
    issues: Object.freeze([...issues]),
    issueCounts: countIssues(issues)
  })
}

const NO_DETECTION: ArisWorkbookTemplateDetection = Object.freeze({
  official: false,
  legacyBpmnWorkbook: false,
  evidence: Object.freeze([])
})

// --- header/column resolution -------------------------------------------------

interface SheetView {
  readonly name: ArisSheetName
  readonly spec: ArisSheetSpec
  readonly columnByName: ReadonlyMap<string, number>
  readonly dataRows: readonly ReadonlyMap<number, ArisRawCell>[]
  readonly dataRowNumbers: readonly number[]
}

function normalizeHeader(value: string): string {
  return value.trim().toLocaleLowerCase('en-US').replace(/\s+/g, '_')
}

function rowCellMap(cells: readonly ArisRawCell[]): ReadonlyMap<number, ArisRawCell> {
  const map = new Map<number, ArisRawCell>()
  for (const cell of cells) map.set(cell.column, cell)
  return map
}

function resolveSheetView(
  sheet: ArisRawSheet,
  spec: ArisSheetSpec,
  issues: IssueSink
): SheetView | undefined {
  const known = new Map(spec.columns.map((column) => [normalizeHeader(column.name), column.name]))
  const required = spec.columns
    .filter((column) => column.presence === 'required')
    .map((column) => normalizeHeader(column.name))
  // The header row is the best match among the first rows, not necessarily a
  // complete one: an incomplete header must still be reported column by column
  // rather than collapsing into "this sheet has no header".
  let headerIndex = -1
  let headerCells: readonly ArisRawCell[] = []
  let bestScore = 0
  const scanLimit = Math.min(sheet.rows.length, HEADER_SCAN_ROWS)
  for (let index = 0; index < scanLimit; index += 1) {
    const cells = sheet.rows[index]!.cells
    const present = new Set(cells.map((cell) => normalizeHeader(cell.text)))
    const score = [...present].filter((name) => known.has(name)).length
    if (score > bestScore) {
      bestScore = score
      headerIndex = index
      headerCells = cells
    }
    if (required.every((name) => present.has(name))) break
  }
  if (headerIndex < 0) {
    issues.push('header-row-missing', 'error', {
      sheet: sheet.name,
      details: { requiredColumns: required.join(',') }
    })
    return undefined
  }

  const columnByName = new Map<string, number>()
  for (const cell of headerCells) {
    const normalized = normalizeHeader(cell.text)
    if (normalized.length === 0) continue
    const canonical = known.get(normalized)
    if (!canonical) {
      issues.push('column-unknown', 'warning', {
        sheet: sheet.name,
        cell: cell.address,
        row: cell.row,
        column: cell.columnLetters,
        value: cell.text
      })
      continue
    }
    if (!columnByName.has(canonical)) columnByName.set(canonical, cell.column)
  }
  for (const column of spec.columns) {
    if (column.presence === 'required' && !columnByName.has(column.name)) {
      issues.push('column-missing', 'error', {
        sheet: sheet.name,
        details: { column: column.name }
      })
    }
  }

  const dataRows: ReadonlyMap<number, ArisRawCell>[] = []
  const dataRowNumbers: number[] = []
  for (let index = headerIndex + 1; index < sheet.rows.length; index += 1) {
    const row = sheet.rows[index]!
    if (row.cells.every((cell) => cell.text.trim().length === 0)) continue
    dataRows.push(rowCellMap(row.cells))
    dataRowNumbers.push(row.row)
  }

  return {
    name: spec.name,
    spec,
    columnByName,
    dataRows,
    dataRowNumbers
  }
}

// --- value coercion -----------------------------------------------------------

const BOOLEAN_TRUE: ReadonlySet<string> = new Set(['true', 'yes', 'y', '1'])
const BOOLEAN_FALSE: ReadonlySet<string> = new Set(['false', 'no', 'n', '0'])

interface RowReader {
  readonly sheet: ArisSheetName
  readonly rowNumber: number
  readonly source: ArisRowProvenance
  text(columnName: string): ArisSourcedValue<string> | undefined
  identifier(columnName: string): ArisSourcedValue<string> | undefined
  integer(columnName: string): ArisSourcedValue<number> | undefined
  number(columnName: string): ArisSourcedValue<number> | undefined
  boolean(columnName: string): ArisSourcedValue<boolean> | undefined
  enumeration<T extends string>(
    columnName: string,
    overrideCode?: ArisExcelIssueCode
  ): ArisSourcedValue<T> | undefined
  color(columnName: string): ArisSourcedValue<string> | undefined
  route(columnName: string): ArisSourcedValue<readonly ArisRoutePoint[]> | undefined
  provenance(columnName: string): ArisCellProvenance | undefined
  /** True when any required value on this row was missing or malformed. */
  readonly failed: boolean
}

function createRowReader(view: SheetView, rowIndex: number, issues: IssueSink): RowReader {
  const rowNumber = view.dataRowNumbers[rowIndex]!
  const cells = view.dataRows[rowIndex]!
  const specByName = new Map(view.spec.columns.map((column) => [column.name, column]))
  let failed = false

  const provenanceFor = (
    column: ArisColumnSpec,
    cell: ArisRawCell | undefined
  ): ArisCellProvenance => {
    const columnIndex = view.columnByName.get(column.name) ?? 1
    return Object.freeze({
      sheet: view.name,
      cell: cell?.address ?? a1Address(rowNumber, columnIndex),
      row: rowNumber,
      column: cell?.columnLetters ?? columnLetters(columnIndex),
      field: column.name
    })
  }

  const read = (
    columnName: string
  ):
    | {
        readonly column: ArisColumnSpec
        readonly provenance: ArisCellProvenance
        readonly raw: string
        readonly trimmed: string
      }
    | undefined => {
    const column = specByName.get(columnName)
    if (!column) return undefined
    const columnIndex = view.columnByName.get(columnName)
    const cell = columnIndex === undefined ? undefined : cells.get(columnIndex)
    const raw = cell?.text ?? ''
    const trimmed = raw.trim()
    const provenance = provenanceFor(column, cell)
    if (trimmed.length === 0) {
      if (column.valueRequired) {
        failed = true
        issues.push('value-required', 'error', {
          sheet: view.name,
          cell: provenance.cell,
          row: rowNumber,
          column: provenance.column,
          details: { field: columnName }
        })
      }
      return undefined
    }
    return { column, provenance, raw, trimmed }
  }

  const reject = (
    code: ArisExcelIssueCode,
    severity: ArisExcelIssueSeverity,
    provenance: ArisCellProvenance,
    raw: string,
    details?: Readonly<Record<string, string | number | boolean>>
  ): void => {
    if (severity === 'error') failed = true
    issues.push(code, severity, {
      sheet: provenance.sheet,
      cell: provenance.cell,
      row: provenance.row,
      column: provenance.column,
      value: raw,
      details: { field: provenance.field, ...(details ?? {}) }
    })
  }

  const sourced = <T>(value: T, raw: string, provenance: ArisCellProvenance): ArisSourcedValue<T> =>
    Object.freeze({ value, raw, provenance })

  return {
    sheet: view.name,
    rowNumber,
    source: Object.freeze({ sheet: view.name, row: rowNumber }),
    get failed() {
      return failed
    },
    text(columnName) {
      const entry = read(columnName)
      if (!entry) return undefined
      return sourced(entry.trimmed, entry.raw, entry.provenance)
    },
    identifier(columnName) {
      const entry = read(columnName)
      if (!entry) return undefined
      return sourced(entry.trimmed, entry.raw, entry.provenance)
    },
    integer(columnName) {
      const entry = read(columnName)
      if (!entry) return undefined
      if (!/^-?\d+$/.test(entry.trimmed)) {
        reject('value-not-an-integer', 'error', entry.provenance, entry.raw)
        return undefined
      }
      return sourced(Number(entry.trimmed), entry.raw, entry.provenance)
    },
    number(columnName) {
      const entry = read(columnName)
      if (!entry) return undefined
      if (!/^-?\d+(?:\.\d+)?$/.test(entry.trimmed)) {
        reject('value-not-a-number', 'error', entry.provenance, entry.raw)
        return undefined
      }
      return sourced(Number(entry.trimmed), entry.raw, entry.provenance)
    },
    boolean(columnName) {
      const entry = read(columnName)
      if (!entry) return undefined
      const normalized = entry.trimmed.toLocaleLowerCase('en-US')
      if (BOOLEAN_TRUE.has(normalized)) return sourced(true, entry.raw, entry.provenance)
      if (BOOLEAN_FALSE.has(normalized)) return sourced(false, entry.raw, entry.provenance)
      reject('value-not-a-boolean', 'error', entry.provenance, entry.raw)
      return undefined
    },
    enumeration<T extends string>(columnName: string, overrideCode?: ArisExcelIssueCode) {
      const entry = read(columnName)
      if (!entry) return undefined
      const allowed = entry.column.values ?? []
      if (!allowed.includes(entry.trimmed)) {
        reject(overrideCode ?? 'value-not-allowed', 'error', entry.provenance, entry.raw, {
          allowed: allowed.join(',')
        })
        return undefined
      }
      return sourced(entry.trimmed as T, entry.raw, entry.provenance)
    },
    color(columnName) {
      const entry = read(columnName)
      if (!entry) return undefined
      if (!ARIS_COLOR_PATTERN.test(entry.trimmed)) {
        reject('invalid-color', 'error', entry.provenance, entry.raw)
        return undefined
      }
      return sourced(entry.trimmed, entry.raw, entry.provenance)
    },
    route(columnName) {
      const entry = read(columnName)
      if (!entry) return undefined
      const parsed = parseRoutePoints(entry.trimmed)
      if (!parsed.ok) {
        reject('invalid-route-points', 'error', entry.provenance, entry.raw, {
          reason: parsed.reason
        })
        return undefined
      }
      return sourced(parsed.points, entry.raw, entry.provenance)
    },
    provenance(columnName) {
      const column = specByName.get(columnName)
      if (!column) return undefined
      const columnIndex = view.columnByName.get(columnName)
      return provenanceFor(column, columnIndex === undefined ? undefined : cells.get(columnIndex))
    }
  }
}

// --- template identity --------------------------------------------------------

function detectTemplate(workbook: ArisRawWorkbook): ArisWorkbookTemplateDetection {
  const evidence: ('custom-property' | 'identity-property' | 'banner-cell')[] = []
  const property = workbook.customProperties[ARIS_TEMPLATE_PROPERTY]
  const identity = workbook.customProperties[ARIS_TEMPLATE_IDENTITY_PROPERTY]
  const kind = workbook.customProperties[ARIS_TEMPLATE_KIND_PROPERTY]
  if (property !== undefined) evidence.push('custom-property')
  if (identity === ARIS_TEMPLATE_IDENTITY) evidence.push('identity-property')

  let bannerVersion: string | undefined
  for (const sheet of workbook.sheets) {
    for (const row of sheet.rows.slice(0, HEADER_SCAN_ROWS)) {
      for (const cell of row.cells) {
        const match = /^OrbitPMArisTemplateVersion=(.+)$/.exec(cell.text.trim())
        if (match) {
          bannerVersion = match[1]
          break
        }
      }
      if (bannerVersion !== undefined) break
    }
    if (bannerVersion !== undefined) break
  }
  if (bannerVersion !== undefined) evidence.push('banner-cell')

  const sheetNames = new Set(workbook.sheets.map((sheet) => sheet.name))
  const legacyBpmnWorkbook =
    (workbook.customProperties[LEGACY_TEMPLATE_PROPERTY] !== undefined &&
      property === undefined &&
      identity === undefined) ||
    LEGACY_SHEET_NAMES.every((name) => sheetNames.has(name))

  const templateVersion = property ?? bannerVersion
  return Object.freeze({
    official: evidence.length > 0 && templateVersion === ARIS_TEMPLATE_VERSION,
    ...(templateVersion !== undefined ? { templateVersion } : {}),
    ...(kind !== undefined ? { templateKind: kind } : {}),
    legacyBpmnWorkbook,
    evidence: Object.freeze(evidence)
  })
}

// --- sheet readers ------------------------------------------------------------

interface ParsedSheets {
  models: ArisWorkbookModelRecord[]
  objects: ArisWorkbookObjectRecord[]
  connections: ArisWorkbookConnectionRecord[]
  attributes: ArisWorkbookAttributeRecord[]
  assignments: ArisWorkbookAssignmentRecord[]
  lanes: ArisWorkbookLaneRecord[]
  freeText: ArisWorkbookFreeTextRecord[]
  styles: ArisWorkbookStyleRecord[]
  glossary: ArisWorkbookGlossaryRecord[]
}

function eachRow(
  view: SheetView | undefined,
  issues: IssueSink,
  visit: (reader: RowReader) => void
): void {
  if (!view) return
  for (let index = 0; index < view.dataRows.length; index += 1) {
    visit(createRowReader(view, index, issues))
  }
}

function readModels(view: SheetView | undefined, issues: IssueSink): ArisWorkbookModelRecord[] {
  const records: ArisWorkbookModelRecord[] = []
  eachRow(view, issues, (row) => {
    const modelId = row.identifier('model_id')
    const modelType = row.enumeration<ArisTemplateModelType>('model_type')
    const nameEn = row.text('name_en')
    const record = {
      modelId,
      modelType,
      nameEn,
      nameAr: row.text('name_ar'),
      processCode: row.text('process_code'),
      descriptionEn: row.text('description_en'),
      descriptionAr: row.text('description_ar'),
      orientation: row.enumeration<string>('orientation'),
      source: row.source
    }
    if (row.failed || !modelId || !modelType || !nameEn) return
    records.push(Object.freeze(record) as ArisWorkbookModelRecord)
  })
  return records
}

function readObjects(view: SheetView | undefined, issues: IssueSink): ArisWorkbookObjectRecord[] {
  const records: ArisWorkbookObjectRecord[] = []
  eachRow(view, issues, (row) => {
    const modelId = row.identifier('model_id')
    const objectId = row.identifier('object_id')
    const occurrenceId = row.identifier('occurrence_id')
    const objectType = row.enumeration<ArisObjectType>('object_type', 'unknown-object-type')
    let symbolType = row.text('symbol_type')
    const nameEn = row.text('name_en')

    if (symbolType && !ARIS_SYMBOL_TYPE_PATTERN.test(symbolType.value)) {
      issues.push('invalid-symbol-type', 'warning', {
        sheet: symbolType.provenance.sheet,
        cell: symbolType.provenance.cell,
        row: symbolType.provenance.row,
        column: symbolType.provenance.column,
        value: symbolType.raw
      })
      if (objectType && nameEn) {
        symbolType = Object.freeze({
          value: inferSymbolType(objectType.value, nameEn.value),
          raw: symbolType.raw,
          provenance: symbolType.provenance
        })
      }
    } else if (!symbolType && objectType && nameEn) {
      const provenance = row.provenance('symbol_type')
      if (provenance) {
        symbolType = Object.freeze({
          value: inferSymbolType(objectType.value, nameEn.value),
          raw: '',
          provenance
        })
      }
    }
    const inferred =
      symbolType?.raw === '' ||
      (symbolType !== undefined && !ARIS_SYMBOL_TYPE_PATTERN.test(symbolType.raw.trim()))
    if (inferred && objectType && symbolType) {
      issues.push('symbol-type-inferred', objectType.value === 'OT_RULE' ? 'warning' : 'info', {
        sheet: symbolType.provenance.sheet,
        cell: symbolType.provenance.cell,
        row: symbolType.provenance.row,
        column: symbolType.provenance.column,
        value: symbolType.raw,
        details: { objectType: objectType.value, inferredSymbolType: symbolType.value }
      })
    } else if (
      symbolType &&
      !(ARIS_KNOWN_SYMBOL_TYPES as readonly string[]).includes(symbolType.value)
    ) {
      issues.push('unknown-symbol-type', 'warning', {
        sheet: symbolType.provenance.sheet,
        cell: symbolType.provenance.cell,
        row: symbolType.provenance.row,
        column: symbolType.provenance.column,
        value: symbolType.raw
      })
    }

    const record = {
      modelId,
      objectId,
      occurrenceId,
      objectType,
      symbolType,
      nameEn,
      nameAr: row.text('name_ar'),
      laneId: row.identifier('lane_id'),
      order: row.integer('order'),
      x: row.number('x'),
      y: row.number('y'),
      width: row.number('width'),
      height: row.number('height'),
      assignedModelId: row.identifier('assigned_model_id'),
      styleId: row.identifier('style_id'),
      source: row.source
    }
    if (
      row.failed ||
      !modelId ||
      !objectId ||
      !occurrenceId ||
      !objectType ||
      !symbolType ||
      !nameEn
    ) {
      return
    }
    records.push(Object.freeze(record) as ArisWorkbookObjectRecord)
  })
  return records
}

function readConnections(
  view: SheetView | undefined,
  issues: IssueSink
): ArisWorkbookConnectionRecord[] {
  const records: ArisWorkbookConnectionRecord[] = []
  eachRow(view, issues, (row) => {
    const modelId = row.identifier('model_id')
    const connectionId = row.identifier('connection_id')
    const sourceOccurrenceId = row.identifier('source_occurrence_id')
    const targetOccurrenceId = row.identifier('target_occurrence_id')
    const connectionType = row.text('connection_type')
    if (connectionType && !ARIS_CONNECTION_TYPE_PATTERN.test(connectionType.value)) {
      issues.push('invalid-connection-type', 'error', {
        sheet: connectionType.provenance.sheet,
        cell: connectionType.provenance.cell,
        row: connectionType.provenance.row,
        column: connectionType.provenance.column,
        value: connectionType.raw
      })
      return
    }
    const record = {
      modelId,
      connectionId,
      sourceOccurrenceId,
      targetOccurrenceId,
      connectionType,
      nameEn: row.text('name_en'),
      nameAr: row.text('name_ar'),
      routePoints: row.route('route_points'),
      styleId: row.identifier('style_id'),
      source: row.source
    }
    if (
      row.failed ||
      !modelId ||
      !connectionId ||
      !sourceOccurrenceId ||
      !targetOccurrenceId ||
      !connectionType
    ) {
      return
    }
    records.push(Object.freeze(record) as ArisWorkbookConnectionRecord)
  })
  return records
}

function readAttributes(
  view: SheetView | undefined,
  issues: IssueSink
): ArisWorkbookAttributeRecord[] {
  const records: ArisWorkbookAttributeRecord[] = []
  eachRow(view, issues, (row) => {
    const ownerKind = row.enumeration<ArisAttributeOwnerKind>('owner_kind')
    const ownerId = row.identifier('owner_id')
    const attributeType = row.text('attribute_type')
    if (attributeType && !ARIS_ATTRIBUTE_TYPE_PATTERN.test(attributeType.value)) {
      issues.push('invalid-attribute-type', 'warning', {
        sheet: attributeType.provenance.sheet,
        cell: attributeType.provenance.cell,
        row: attributeType.provenance.row,
        column: attributeType.provenance.column,
        value: attributeType.raw
      })
    }
    const record = {
      ownerKind,
      ownerId,
      attributeType,
      language: row.enumeration<string>('language'),
      value: row.text('value'),
      valueType: row.enumeration<string>('value_type'),
      sequence: row.integer('sequence'),
      source: row.source
    }
    if (row.failed || !ownerKind || !ownerId || !attributeType) return
    records.push(Object.freeze(record) as ArisWorkbookAttributeRecord)
  })
  return records
}

function readAssignments(
  view: SheetView | undefined,
  issues: IssueSink
): ArisWorkbookAssignmentRecord[] {
  const records: ArisWorkbookAssignmentRecord[] = []
  eachRow(view, issues, (row) => {
    const sourceObjectId = row.identifier('source_object_id')
    const targetModelId = row.identifier('target_model_id')
    const assignmentType = row.enumeration<string>('assignment_type')
    if (row.failed || !sourceObjectId || !targetModelId || !assignmentType) return
    records.push(
      Object.freeze({
        sourceObjectId,
        targetModelId,
        assignmentType,
        source: row.source
      }) as ArisWorkbookAssignmentRecord
    )
  })
  return records
}

function readLanes(view: SheetView | undefined, issues: IssueSink): ArisWorkbookLaneRecord[] {
  const records: ArisWorkbookLaneRecord[] = []
  eachRow(view, issues, (row) => {
    const modelId = row.identifier('model_id')
    const laneId = row.identifier('lane_id')
    const nameEn = row.text('name_en')
    const record = {
      modelId,
      laneId,
      nameEn,
      nameAr: row.text('name_ar'),
      x: row.number('x'),
      y: row.number('y'),
      width: row.number('width'),
      height: row.number('height'),
      orientation: row.enumeration<string>('orientation'),
      source: row.source
    }
    if (row.failed || !modelId || !laneId || !nameEn) return
    records.push(Object.freeze(record) as ArisWorkbookLaneRecord)
  })
  return records
}

function readFreeText(
  view: SheetView | undefined,
  issues: IssueSink
): ArisWorkbookFreeTextRecord[] {
  const records: ArisWorkbookFreeTextRecord[] = []
  eachRow(view, issues, (row) => {
    const modelId = row.identifier('model_id')
    const textId = row.identifier('text_id')
    const textEn = row.text('text_en')
    const record = {
      modelId,
      textId,
      textEn,
      textAr: row.text('text_ar'),
      x: row.number('x'),
      y: row.number('y'),
      width: row.number('width'),
      height: row.number('height'),
      styleId: row.identifier('style_id'),
      source: row.source
    }
    if (row.failed || !modelId || !textId || !textEn) return
    records.push(Object.freeze(record) as ArisWorkbookFreeTextRecord)
  })
  return records
}

function readStyles(view: SheetView | undefined, issues: IssueSink): ArisWorkbookStyleRecord[] {
  const records: ArisWorkbookStyleRecord[] = []
  eachRow(view, issues, (row) => {
    const styleId = row.identifier('style_id')
    const record = {
      styleId,
      fillColor: row.color('fill_color'),
      strokeColor: row.color('stroke_color'),
      strokeWidth: row.number('stroke_width'),
      lineStyle: row.enumeration<string>('line_style'),
      fontFamily: row.text('font_family'),
      fontSize: row.number('font_size'),
      fontWeight: row.enumeration<string>('font_weight'),
      textColor: row.color('text_color'),
      zOrder: row.integer('z_order'),
      source: row.source
    }
    if (row.failed || !styleId) return
    records.push(Object.freeze(record) as ArisWorkbookStyleRecord)
  })
  return records
}

function readGlossary(
  view: SheetView | undefined,
  issues: IssueSink
): ArisWorkbookGlossaryRecord[] {
  const records: ArisWorkbookGlossaryRecord[] = []
  eachRow(view, issues, (row) => {
    const english = row.text('english')
    const arabic = row.text('arabic')
    const record = {
      english,
      arabic,
      doNotTranslate: row.boolean('do_not_translate'),
      caseSensitive: row.boolean('case_sensitive'),
      source: row.source
    }
    if (row.failed || !english || !arabic) return
    records.push(Object.freeze(record) as ArisWorkbookGlossaryRecord)
  })
  return records
}

// --- identity, references, model limits --------------------------------------

function reportDuplicate(issues: IssueSink, value: ArisSourcedValue<string>, kind: string): void {
  issues.push('duplicate-id', 'error', {
    sheet: value.provenance.sheet,
    cell: value.provenance.cell,
    row: value.provenance.row,
    column: value.provenance.column,
    value: value.raw,
    details: { kind }
  })
}

function rawRecordFingerprint(record: object): string {
  return JSON.stringify(
    Object.entries(record)
      .filter(([key]) => key !== 'source')
      .map(([key, value]) => [
        key,
        value && typeof value === 'object' && 'raw' in value
          ? (value as ArisSourcedValue<unknown>).raw
          : null
      ])
  )
}

function dedupeExactCloneRecords<T extends { readonly source: ArisRowProvenance }>(
  records: readonly T[],
  pickIdentity: (record: T) => ArisSourcedValue<string>,
  kind: string,
  issues: IssueSink
): T[] {
  const priorById = new Map<string, { readonly fingerprint: string; readonly row: number }[]>()
  const kept: T[] = []
  for (const record of records) {
    const identity = pickIdentity(record)
    const fingerprint = rawRecordFingerprint(record)
    const prior = priorById.get(identity.value) ?? []
    const clone = prior.find((candidate) => candidate.fingerprint === fingerprint)
    if (clone) {
      issues.push('duplicate-id', 'warning', {
        sheet: identity.provenance.sheet,
        cell: identity.provenance.cell,
        row: identity.provenance.row,
        column: identity.provenance.column,
        value: identity.raw,
        details: {
          kind,
          action: 'duplicate-row-ignored',
          firstSeenRow: clone.row
        }
      })
      continue
    }
    prior.push({ fingerprint, row: record.source.row })
    priorById.set(identity.value, prior)
    kept.push(record)
  }
  return kept
}

function dedupeExactClones(sheets: ParsedSheets, issues: IssueSink): void {
  sheets.models = dedupeExactCloneRecords(
    sheets.models,
    (record) => record.modelId,
    'model_id',
    issues
  )
  sheets.connections = dedupeExactCloneRecords(
    sheets.connections,
    (record) => record.connectionId,
    'connection_id',
    issues
  )
  sheets.lanes = dedupeExactCloneRecords(sheets.lanes, (record) => record.laneId, 'lane_id', issues)
  sheets.freeText = dedupeExactCloneRecords(
    sheets.freeText,
    (record) => record.textId,
    'text_id',
    issues
  )
  sheets.styles = dedupeExactCloneRecords(
    sheets.styles,
    (record) => record.styleId,
    'style_id',
    issues
  )
  sheets.objects = dedupeExactCloneRecords(
    sheets.objects,
    (record) => record.occurrenceId,
    'occurrence_id',
    issues
  )
}

function reportMissingReference(
  issues: IssueSink,
  value: ArisSourcedValue<string>,
  target: string,
  action: 'row-skipped' | 'field-cleared' | 'connection-skipped'
): void {
  issues.push('missing-reference', 'warning', {
    sheet: value.provenance.sheet,
    cell: value.provenance.cell,
    row: value.provenance.row,
    column: value.provenance.column,
    value: value.raw,
    details: { target, field: value.provenance.field, action }
  })
}

interface ReferenceIndex {
  readonly exact: ReadonlySet<string>
  readonly byFold: ReadonlyMap<string, readonly string[]>
}

function caseFold(value: string): string {
  return value.trim().toLocaleLowerCase('en-US')
}

function referenceIndex(values: Iterable<string>): ReferenceIndex {
  const exact = new Set(values)
  const mutableByFold = new Map<string, string[]>()
  for (const value of exact) {
    const folded = caseFold(value)
    const candidates = mutableByFold.get(folded) ?? []
    candidates.push(value)
    mutableByFold.set(folded, candidates)
  }
  return {
    exact,
    byFold: new Map(
      [...mutableByFold].map(([folded, candidates]) => [folded, Object.freeze(candidates)])
    )
  }
}

const EMPTY_REFERENCE_INDEX = referenceIndex([])

function resolveReference(
  value: ArisSourcedValue<string>,
  targets: ReferenceIndex,
  issues: IssueSink
): ArisSourcedValue<string> | undefined {
  if (targets.exact.has(value.value)) return value
  const candidates = targets.byFold.get(caseFold(value.value)) ?? []
  if (candidates.length !== 1) return undefined
  const canonical = candidates[0]!
  issues.push('reference-normalized', 'warning', {
    sheet: value.provenance.sheet,
    cell: value.provenance.cell,
    row: value.provenance.row,
    column: value.provenance.column,
    value: value.raw,
    details: { from: value.value, to: canonical, field: value.provenance.field }
  })
  return Object.freeze({ value: canonical, raw: value.raw, provenance: value.provenance })
}

function validateIdentity(sheets: ParsedSheets, issues: IssueSink): void {
  const seen = <T>(
    records: readonly T[],
    pick: (record: T) => ArisSourcedValue<string>,
    kind: string
  ): void => {
    const known = new Set<string>()
    for (const record of records) {
      const value = pick(record)
      if (known.has(value.value)) reportDuplicate(issues, value, kind)
      else known.add(value.value)
    }
  }
  seen(sheets.models, (record) => record.modelId, 'model_id')
  seen(sheets.connections, (record) => record.connectionId, 'connection_id')
  seen(sheets.lanes, (record) => record.laneId, 'lane_id')
  seen(sheets.freeText, (record) => record.textId, 'text_id')
  seen(sheets.styles, (record) => record.styleId, 'style_id')
  seen(sheets.objects, (record) => record.occurrenceId, 'occurrence_id')

  // A definition may legitimately have several occurrences, but every row of
  // the same definition must agree on its type and English name.
  const definitions = new Map<string, ArisWorkbookObjectRecord>()
  for (const object of sheets.objects) {
    const existing = definitions.get(object.objectId.value)
    if (!existing) {
      definitions.set(object.objectId.value, object)
      continue
    }
    if (
      existing.objectType.value !== object.objectType.value ||
      existing.nameEn.value !== object.nameEn.value
    ) {
      issues.push('object-definition-conflict', 'error', {
        sheet: object.objectId.provenance.sheet,
        cell: object.objectId.provenance.cell,
        row: object.objectId.provenance.row,
        column: object.objectId.provenance.column,
        value: object.objectId.raw,
        details: {
          firstSeenRow: existing.source.row,
          expectedType: existing.objectType.value,
          actualType: object.objectType.value
        }
      })
    }
  }
}

function repairReferences(sheets: ParsedSheets, issues: IssueSink): void {
  const modelIds = referenceIndex(sheets.models.map((record) => record.modelId.value))
  const styleIds = referenceIndex(sheets.styles.map((record) => record.styleId.value))

  // Normalize model ids on Objects first, then rebuild occurrence scope before
  // touching connection endpoints. Invalid candidates remain available so all
  // their optional references can still be reported during the later pass.
  const objectCandidates: {
    readonly object: ArisWorkbookObjectRecord
    readonly modelId?: ArisSourcedValue<string>
  }[] = []
  const modelRepairedObjects: ArisWorkbookObjectRecord[] = []
  for (const object of sheets.objects) {
    const modelId = resolveReference(object.modelId, modelIds, issues)
    if (!modelId) reportMissingReference(issues, object.modelId, 'model', 'row-skipped')
    objectCandidates.push({ object, ...(modelId ? { modelId } : {}) })
    if (modelId) modelRepairedObjects.push(Object.freeze({ ...object, modelId }))
  }
  sheets.objects = modelRepairedObjects

  const occurrencesByModel = new Map<string, ReferenceIndex>()
  for (const model of sheets.models) {
    occurrencesByModel.set(
      model.modelId.value,
      referenceIndex(
        sheets.objects
          .filter((object) => object.modelId.value === model.modelId.value)
          .map((object) => object.occurrenceId.value)
      )
    )
  }

  const repairedConnections: ArisWorkbookConnectionRecord[] = []
  for (const connection of sheets.connections) {
    const modelId = resolveReference(connection.modelId, modelIds, issues)
    if (!modelId) {
      reportMissingReference(issues, connection.modelId, 'model', 'connection-skipped')
    }
    const scope = modelId
      ? (occurrencesByModel.get(modelId.value) ?? EMPTY_REFERENCE_INDEX)
      : EMPTY_REFERENCE_INDEX
    const sourceOccurrenceId = resolveReference(connection.sourceOccurrenceId, scope, issues)
    const targetOccurrenceId = resolveReference(connection.targetOccurrenceId, scope, issues)
    if (!sourceOccurrenceId) {
      reportMissingReference(
        issues,
        connection.sourceOccurrenceId,
        'occurrence',
        'connection-skipped'
      )
    }
    if (!targetOccurrenceId) {
      reportMissingReference(
        issues,
        connection.targetOccurrenceId,
        'occurrence',
        'connection-skipped'
      )
    }

    let styleId: ArisSourcedValue<string> | undefined
    if (connection.styleId) {
      styleId = resolveReference(connection.styleId, styleIds, issues)
      if (!styleId) {
        reportMissingReference(issues, connection.styleId, 'style', 'field-cleared')
      }
    }
    if (!modelId || !sourceOccurrenceId || !targetOccurrenceId) continue

    const repaired = Object.freeze({
      ...connection,
      modelId,
      sourceOccurrenceId,
      targetOccurrenceId,
      styleId
    })
    repairedConnections.push(repaired)
    if (sourceOccurrenceId.value === targetOccurrenceId.value) {
      issues.push('connection-endpoint-cycle', 'warning', {
        sheet: connection.connectionId.provenance.sheet,
        cell: connection.connectionId.provenance.cell,
        row: connection.connectionId.provenance.row,
        column: connection.connectionId.provenance.column,
        value: connection.connectionId.raw
      })
    }
  }
  sheets.connections = repairedConnections

  const repairedLanes: ArisWorkbookLaneRecord[] = []
  for (const lane of sheets.lanes) {
    const modelId = resolveReference(lane.modelId, modelIds, issues)
    if (!modelId) {
      reportMissingReference(issues, lane.modelId, 'model', 'row-skipped')
      continue
    }
    repairedLanes.push(Object.freeze({ ...lane, modelId }))
  }
  sheets.lanes = repairedLanes

  const lanesByModel = new Map<string, ReferenceIndex>()
  for (const model of sheets.models) {
    lanesByModel.set(
      model.modelId.value,
      referenceIndex(
        sheets.lanes
          .filter((lane) => lane.modelId.value === model.modelId.value)
          .map((lane) => lane.laneId.value)
      )
    )
  }

  const repairedObjects: ArisWorkbookObjectRecord[] = []
  for (const { object, modelId } of objectCandidates) {
    let laneId: ArisSourcedValue<string> | undefined
    if (object.laneId) {
      laneId = resolveReference(
        object.laneId,
        modelId
          ? (lanesByModel.get(modelId.value) ?? EMPTY_REFERENCE_INDEX)
          : EMPTY_REFERENCE_INDEX,
        issues
      )
      if (!laneId) reportMissingReference(issues, object.laneId, 'lane', 'field-cleared')
    }

    let assignedModelId: ArisSourcedValue<string> | undefined
    if (object.assignedModelId) {
      assignedModelId = resolveReference(object.assignedModelId, modelIds, issues)
      if (!assignedModelId) {
        reportMissingReference(issues, object.assignedModelId, 'model', 'field-cleared')
      }
    }

    let styleId: ArisSourcedValue<string> | undefined
    if (object.styleId) {
      styleId = resolveReference(object.styleId, styleIds, issues)
      if (!styleId) reportMissingReference(issues, object.styleId, 'style', 'field-cleared')
    }

    if (!modelId) continue
    repairedObjects.push(Object.freeze({ ...object, modelId, laneId, assignedModelId, styleId }))
  }
  sheets.objects = repairedObjects

  const repairedFreeText: ArisWorkbookFreeTextRecord[] = []
  for (const text of sheets.freeText) {
    const modelId = resolveReference(text.modelId, modelIds, issues)
    if (!modelId) {
      reportMissingReference(issues, text.modelId, 'model', 'row-skipped')
      continue
    }
    let styleId: ArisSourcedValue<string> | undefined
    if (text.styleId) {
      styleId = resolveReference(text.styleId, styleIds, issues)
      if (!styleId) reportMissingReference(issues, text.styleId, 'style', 'field-cleared')
    }
    repairedFreeText.push(Object.freeze({ ...text, modelId, styleId }))
  }
  sheets.freeText = repairedFreeText

  const ownerIndexes: Readonly<Record<ArisAttributeOwnerKind, ReferenceIndex>> = {
    model: modelIds,
    object: referenceIndex(sheets.objects.map((record) => record.objectId.value)),
    occurrence: referenceIndex(sheets.objects.map((record) => record.occurrenceId.value)),
    connection: referenceIndex(sheets.connections.map((record) => record.connectionId.value)),
    lane: referenceIndex(sheets.lanes.map((record) => record.laneId.value)),
    free_text: referenceIndex(sheets.freeText.map((record) => record.textId.value))
  }
  const repairedAttributes: ArisWorkbookAttributeRecord[] = []
  for (const attribute of sheets.attributes) {
    const ownerId = resolveReference(
      attribute.ownerId,
      ownerIndexes[attribute.ownerKind.value],
      issues
    )
    if (!ownerId) {
      reportMissingReference(issues, attribute.ownerId, attribute.ownerKind.value, 'row-skipped')
      continue
    }
    repairedAttributes.push(Object.freeze({ ...attribute, ownerId }))
  }
  sheets.attributes = repairedAttributes

  const repairedAssignments: ArisWorkbookAssignmentRecord[] = []
  for (const assignment of sheets.assignments) {
    const sourceObjectId = resolveReference(assignment.sourceObjectId, ownerIndexes.object, issues)
    const targetModelId = resolveReference(assignment.targetModelId, modelIds, issues)
    if (!sourceObjectId) {
      reportMissingReference(issues, assignment.sourceObjectId, 'object', 'row-skipped')
    }
    if (!targetModelId) {
      reportMissingReference(issues, assignment.targetModelId, 'model', 'row-skipped')
    }
    if (!sourceObjectId || !targetModelId) continue
    repairedAssignments.push(Object.freeze({ ...assignment, sourceObjectId, targetModelId }))
  }
  sheets.assignments = repairedAssignments
}

function validateModelLimits(sheets: ParsedSheets, issues: IssueSink): ReadonlyMap<string, number> {
  const controlFlowByModel = new Map<string, number>()
  for (const object of sheets.objects) {
    if (!isControlFlowObjectType(object.objectType.value)) continue
    const modelId = object.modelId.value
    controlFlowByModel.set(modelId, (controlFlowByModel.get(modelId) ?? 0) + 1)
  }

  for (const model of sheets.models) {
    const count = controlFlowByModel.get(model.modelId.value) ?? 0
    if (count > ARIS_EXCEL_LIMITS.controlFlowObjectsPerModel) {
      issues.push('control-flow-object-limit', 'error', {
        sheet: model.modelId.provenance.sheet,
        cell: model.modelId.provenance.cell,
        row: model.modelId.provenance.row,
        column: model.modelId.provenance.column,
        value: model.modelId.raw,
        details: { actual: count, limit: ARIS_EXCEL_LIMITS.controlFlowObjectsPerModel }
      })
    } else if (count > ARIS_EXCEL_LIMITS.controlFlowObjectWarningThreshold) {
      issues.push('control-flow-object-warning', 'warning', {
        sheet: model.modelId.provenance.sheet,
        cell: model.modelId.provenance.cell,
        row: model.modelId.provenance.row,
        column: model.modelId.provenance.column,
        value: model.modelId.raw,
        details: {
          actual: count,
          threshold: ARIS_EXCEL_LIMITS.controlFlowObjectWarningThreshold
        }
      })
    }
  }

  if (sheets.objects.length > ARIS_EXCEL_LIMITS.objectsPerTransaction) {
    issues.push('object-transaction-limit', 'error', {
      sheet: 'Objects',
      details: {
        actual: sheets.objects.length,
        limit: ARIS_EXCEL_LIMITS.objectsPerTransaction
      }
    })
  }

  return controlFlowByModel
}

function signalAutoChainedConnections(
  sheets: ParsedSheets,
  controlFlowObjectsByModel: ReadonlyMap<string, number>,
  issues: IssueSink
): void {
  const modelsWithConnections = new Set(
    sheets.connections.map((connection) => connection.modelId.value)
  )
  for (const model of sheets.models) {
    const modelId = model.modelId.value
    const chainedObjects = controlFlowObjectsByModel.get(modelId) ?? 0
    if (
      chainedObjects < 2 ||
      chainedObjects > ARIS_EXCEL_LIMITS.controlFlowObjectWarningThreshold ||
      modelsWithConnections.has(modelId)
    ) {
      continue
    }
    issues.push('connections-auto-chained', 'warning', {
      sheet: model.modelId.provenance.sheet,
      cell: model.modelId.provenance.cell,
      row: model.modelId.provenance.row,
      column: model.modelId.provenance.column,
      value: model.modelId.raw,
      details: { model: modelId, chainedObjects }
    })
  }
}

function buildIndex(sheets: ParsedSheets): ArisWorkbookModel['index'] {
  const modelsById = new Map(sheets.models.map((record) => [record.modelId.value, record]))
  const occurrencesByObjectId = new Map<string, ArisWorkbookObjectRecord[]>()
  const objectsByModelId = new Map<string, ArisWorkbookObjectRecord[]>()
  const occurrencesById = new Map<string, ArisWorkbookObjectRecord>()
  for (const object of sheets.objects) {
    occurrencesById.set(object.occurrenceId.value, object)
    const byDefinition = occurrencesByObjectId.get(object.objectId.value) ?? []
    byDefinition.push(object)
    occurrencesByObjectId.set(object.objectId.value, byDefinition)
    const byModel = objectsByModelId.get(object.modelId.value) ?? []
    byModel.push(object)
    objectsByModelId.set(object.modelId.value, byModel)
  }
  const connectionsByModelId = new Map<string, ArisWorkbookConnectionRecord[]>()
  for (const connection of sheets.connections) {
    const list = connectionsByModelId.get(connection.modelId.value) ?? []
    list.push(connection)
    connectionsByModelId.set(connection.modelId.value, list)
  }
  const assignedModelIdsByObjectId = new Map<string, string[]>()
  const addAssignment = (objectId: string, modelId: string): void => {
    const list = assignedModelIdsByObjectId.get(objectId) ?? []
    if (!list.includes(modelId)) list.push(modelId)
    assignedModelIdsByObjectId.set(objectId, list)
  }
  for (const object of sheets.objects) {
    if (object.assignedModelId) addAssignment(object.objectId.value, object.assignedModelId.value)
  }
  for (const assignment of sheets.assignments) {
    addAssignment(assignment.sourceObjectId.value, assignment.targetModelId.value)
  }

  return Object.freeze({
    modelsById,
    occurrencesByObjectId: new Map(
      [...occurrencesByObjectId].map(([key, value]) => [key, Object.freeze(value)])
    ),
    occurrencesById,
    objectsByModelId: new Map(
      [...objectsByModelId].map(([key, value]) => [key, Object.freeze(value)])
    ),
    connectionsByModelId: new Map(
      [...connectionsByModelId].map(([key, value]) => [key, Object.freeze(value)])
    ),
    lanesById: new Map(sheets.lanes.map((record) => [record.laneId.value, record])),
    stylesById: new Map(sheets.styles.map((record) => [record.styleId.value, record])),
    freeTextById: new Map(sheets.freeText.map((record) => [record.textId.value, record])),
    assignedModelIdsByObjectId: new Map(
      [...assignedModelIdsByObjectId].map(([key, value]) => [key, Object.freeze(value)])
    )
  })
}

// --- entry point --------------------------------------------------------------

export function parseArisWorkbook(
  fileName: string,
  bytes: Uint8Array,
  options: ArisWorkbookParseOptions = {}
): ArisWorkbookParseResult {
  const issues: ArisExcelIssue[] = []
  const sink = createIssueSink(issues)

  // Step 1 — extension and MIME.
  const extension = fileExtension(fileName)
  if (extension !== XLSX_EXTENSION) {
    sink.push('unsupported-file-extension', 'error', { value: extension })
    return rejected(fileName, issues, NO_DETECTION)
  }
  if (options.mimeType !== undefined && !ALLOWED_MIME_TYPES.has(options.mimeType)) {
    sink.push('unsupported-mime-type', 'error', { value: options.mimeType })
    return rejected(fileName, issues, NO_DETECTION)
  }
  if (bytes.length > ARIS_EXCEL_LIMITS.compressedInputBytes) {
    sink.push('compressed-size-limit', 'error', {
      details: { actual: bytes.length, limit: ARIS_EXCEL_LIMITS.compressedInputBytes }
    })
    return rejected(fileName, issues, NO_DETECTION)
  }

  // Steps 2-5 — preflight, bounded inflation, no-DOM read with provenance.
  let raw: ArisRawWorkbook
  try {
    raw = readArisXlsx(bytes)
  } catch (cause) {
    if (cause instanceof ArisExcelIssueError) {
      issues.push(cause.issue)
      return rejected(fileName, issues, NO_DETECTION)
    }
    sink.push('internal-error', 'error', {
      details: { reason: cause instanceof Error ? cause.name : 'unknown' }
    })
    return rejected(fileName, issues, NO_DETECTION)
  }
  issues.push(...raw.issues)

  // Step 3 (continued) — template identity and legacy-workbook migration.
  const detection = detectTemplate(raw)
  if (detection.legacyBpmnWorkbook) {
    sink.push('legacy-bpmn-workbook', 'error', {
      details: { detectedSheets: LEGACY_SHEET_NAMES.join(',') }
    })
    return rejected(fileName, issues, detection)
  }
  if (detection.templateVersion === undefined) {
    sink.push('template-version-missing', 'error', {
      details: { expected: ARIS_TEMPLATE_IDENTITY }
    })
    return rejected(fileName, issues, detection)
  }
  if (detection.templateVersion !== ARIS_TEMPLATE_VERSION) {
    sink.push('template-version-unsupported', 'error', {
      value: detection.templateVersion,
      details: { expected: ARIS_TEMPLATE_VERSION }
    })
    return rejected(fileName, issues, detection)
  }

  // Step 6 — sheets, columns, types.
  const sheetsByName = new Map(raw.sheets.map((sheet) => [sheet.name, sheet]))
  for (const sheet of raw.sheets) {
    if (!isArisSheetName(sheet.name)) {
      sink.push('sheet-unknown', 'warning', { sheet: sheet.name })
    }
  }
  const views = new Map<ArisSheetName, SheetView>()
  for (const spec of ARIS_SHEET_SPECS) {
    const sheet = sheetsByName.get(spec.name)
    if (!sheet) {
      sink.push('sheet-missing', 'error', { sheet: spec.name })
      continue
    }
    const view = resolveSheetView(sheet, spec, sink)
    if (view) views.set(spec.name, view)
  }
  if (hasBlockingIssue(issues)) return rejected(fileName, issues, detection)

  const view = (name: ArisSheetName): SheetView | undefined => views.get(name)
  const parsed: ParsedSheets = {
    models: readModels(view('Models'), sink),
    objects: readObjects(view('Objects'), sink),
    connections: readConnections(view('Connections'), sink),
    attributes: readAttributes(view('Attributes'), sink),
    assignments: readAssignments(view('Assignments'), sink),
    lanes: readLanes(view('Lanes'), sink),
    freeText: readFreeText(view('FreeText'), sink),
    styles: readStyles(view('Styles'), sink),
    glossary: readGlossary(view('Glossary'), sink)
  }

  dedupeExactClones(parsed, sink)
  validateIdentity(parsed, sink)
  repairReferences(parsed, sink)
  const controlFlowObjectsByModel = validateModelLimits(parsed, sink)
  signalAutoChainedConnections(parsed, controlFlowObjectsByModel, sink)

  if (parsed.models.length === 0) {
    sink.push('empty-workbook', 'error', { sheet: 'Models' })
  }
  if (hasBlockingIssue(issues)) return rejected(fileName, issues, detection)

  // Step 7 — the validated, provenance-carrying workbook model.
  const model: ArisWorkbookModel = Object.freeze({
    templateVersion: detection.templateVersion,
    detection,
    source: Object.freeze({ fileName, byteLength: bytes.length }),
    models: Object.freeze(parsed.models),
    objects: Object.freeze(parsed.objects),
    connections: Object.freeze(parsed.connections),
    attributes: Object.freeze(parsed.attributes),
    assignments: Object.freeze(parsed.assignments),
    lanes: Object.freeze(parsed.lanes),
    freeText: Object.freeze(parsed.freeText),
    styles: Object.freeze(parsed.styles),
    glossary: Object.freeze(parsed.glossary),
    index: buildIndex(parsed),
    counts: Object.freeze({
      models: parsed.models.length,
      objectDefinitions: new Set(parsed.objects.map((record) => record.objectId.value)).size,
      objectOccurrences: parsed.objects.length,
      connections: parsed.connections.length,
      lanes: parsed.lanes.length,
      freeText: parsed.freeText.length,
      styles: parsed.styles.length,
      attributes: parsed.attributes.length,
      assignments: parsed.assignments.length,
      glossary: parsed.glossary.length,
      controlFlowObjectsByModel
    })
  })

  return Object.freeze({
    status: 'accepted',
    fileName,
    detection,
    model,
    issues: Object.freeze([...issues]),
    issueCounts: countIssues(issues)
  })
}
