import { normalizeHeader } from './aliases'
import { cellAddress } from './cellAddress'
import {
  BPMN_NODE_TYPES,
  MAPPING_PRESET_VERSION,
  PROCESS_WORKBOOK_MODEL_VERSION,
  type BilingualValue,
  type BpmnNodeType,
  type CanonicalSheet,
  type CellPrimitive,
  type EventDefinition,
  type MappingPreset,
  type ParsedWorkbookData,
  type ProcessWorkbookModel,
  type RecordProvenance,
  type SpreadsheetLocale,
  type SpreadsheetValidationIssue,
  type WorkbookCell,
  type WorkbookFlow,
  type WorkbookGlossaryEntry,
  type WorkbookNode,
  type WorkbookNodeMetadata,
  type WorkbookParticipant,
  type WorkbookProcess
} from './contracts'
import { DEFAULT_LIST_DELIMITERS } from './limits'
import {
  detectOfficialTemplate,
  OFFICIAL_SHEET_NAMES,
  type OfficialTemplateDetection
} from './officialTemplate'
import { headerSignature } from './mapping'

export interface ModelBuildOptions {
  readonly fileName: string
  readonly format: 'xlsx' | 'csv'
  readonly preset: MappingPreset
  readonly officialTemplate?: boolean
  readonly templateVersion?: string
  /** Used only for an ordinary single-process sheet with no grouping value. */
  readonly defaultProcessId?: string
  readonly defaultProcessName?: BilingualValue
}

export interface ModelBuildResult {
  readonly model: ProcessWorkbookModel
  readonly issues: readonly SpreadsheetValidationIssue[]
  readonly skippedRows: readonly RecordProvenance[]
}

interface SheetCursor {
  readonly role: CanonicalSheet
  readonly name: string
  readonly headerRow: number
  readonly headers: readonly string[]
  readonly columns: Readonly<Record<string, number>>
  readonly rows: ParsedWorkbookData['sheets'][number]['rows']
}

const NODE_TYPE_ALIASES: Readonly<Record<string, BpmnNodeType>> = Object.freeze({
  activity: 'task',
  نشاط: 'task',
  مهمة: 'task',
  'user task': 'userTask',
  'مهمة مستخدم': 'userTask',
  'service task': 'serviceTask',
  'مهمة خدمة': 'serviceTask',
  'send task': 'sendTask',
  'مهمة ارسال': 'sendTask',
  'receive task': 'receiveTask',
  'مهمة استلام': 'receiveTask',
  'business rule task': 'businessRuleTask',
  'مهمة قاعدة عمل': 'businessRuleTask',
  'manual task': 'manualTask',
  'مهمة يدوية': 'manualTask',
  'script task': 'scriptTask',
  'مهمة برنامج نصي': 'scriptTask',
  'call activity': 'callActivity',
  'نشاط استدعاء': 'callActivity',
  subprocess: 'subProcess',
  'sub process': 'subProcess',
  'عملية فرعية': 'subProcess',
  start: 'startEvent',
  'start event': 'startEvent',
  بداية: 'startEvent',
  'حدث بداية': 'startEvent',
  end: 'endEvent',
  'end event': 'endEvent',
  نهاية: 'endEvent',
  'حدث نهاية': 'endEvent',
  'intermediate catch event': 'intermediateCatchEvent',
  'حدث وسيط ملتقط': 'intermediateCatchEvent',
  'intermediate throw event': 'intermediateThrowEvent',
  'حدث وسيط مرسل': 'intermediateThrowEvent',
  'exclusive gateway': 'exclusiveGateway',
  xor: 'exclusiveGateway',
  'بوابة حصرية': 'exclusiveGateway',
  'inclusive gateway': 'inclusiveGateway',
  or: 'inclusiveGateway',
  'بوابة شاملة': 'inclusiveGateway',
  'parallel gateway': 'parallelGateway',
  and: 'parallelGateway',
  'بوابة متوازية': 'parallelGateway',
  'complex gateway': 'complexGateway',
  'بوابة معقدة': 'complexGateway',
  'event based gateway': 'eventBasedGateway',
  'بوابة قائمة على الحدث': 'eventBasedGateway'
})

const EVENT_DEFINITION_ALIASES: Readonly<Record<string, EventDefinition>> = Object.freeze({
  none: 'none',
  بدون: 'none',
  message: 'message',
  رسالة: 'message',
  timer: 'timer',
  مؤقت: 'timer',
  signal: 'signal',
  اشارة: 'signal',
  conditional: 'conditional',
  شرطي: 'conditional',
  link: 'link',
  رابط: 'link',
  error: 'error',
  خطا: 'error',
  escalation: 'escalation',
  تصعيد: 'escalation',
  terminate: 'terminate',
  انهاء: 'terminate'
})

function cellValue(cell: WorkbookCell | undefined): CellPrimitive {
  return cell?.value ?? null
}

function displayed(value: CellPrimitive): string {
  if (value === null) return ''
  if (value instanceof Date) return value.toISOString()
  return String(value).trim()
}

function makeBilingual(en: string, ar: string, active: SpreadsheetLocale): BilingualValue {
  return Object.freeze({
    ...(en ? { en } : {}),
    ...(ar ? { ar } : {}),
    active
  })
}

function readBoolean(value: string): boolean | undefined {
  const normalized = normalizeHeader(value)
  if (['true', 'yes', 'y', '1', 'نعم', 'صحيح'].includes(normalized)) return true
  if (['false', 'no', 'n', '0', 'لا', 'خاطئ'].includes(normalized)) return false
  return undefined
}

function readOrder(value: string): number | undefined {
  if (!value) return undefined
  const order = Number(value)
  return Number.isFinite(order) ? order : undefined
}

function readLanguage(value: string): SpreadsheetLocale {
  return ['ar', 'arabic', 'العربية', 'عربي'].includes(normalizeHeader(value)) ? 'ar' : 'en'
}

function readNodeType(value: string, preset: MappingPreset): BpmnNodeType | 'unknown' {
  if ((BPMN_NODE_TYPES as readonly string[]).includes(value)) return value as BpmnNodeType
  const normalized = normalizeHeader(value)
  const reviewed = preset.valueMappings.stepTypes[normalized]
  if (reviewed) return reviewed
  const canonical = BPMN_NODE_TYPES.find((candidate) => normalizeHeader(candidate) === normalized)
  return canonical ?? NODE_TYPE_ALIASES[normalized] ?? 'unknown'
}

function readEventDefinition(value: string): EventDefinition | undefined {
  if (!value) return undefined
  return EVENT_DEFINITION_ALIASES[normalizeHeader(value)]
}

function splitList(value: string, delimiters: readonly string[]): readonly string[] {
  if (!value) return Object.freeze([])
  const activeDelimiters = delimiters.filter((delimiter) => delimiter !== ',')
  let parts = [value]
  for (const delimiter of activeDelimiters) {
    parts = parts.flatMap((part) => part.split(delimiter))
  }
  return Object.freeze(parts.map((part) => part.trim()).filter(Boolean))
}

function pairLists(
  en: readonly string[],
  ar: readonly string[],
  active: SpreadsheetLocale
): readonly BilingualValue[] {
  return Object.freeze(
    Array.from({ length: Math.max(en.length, ar.length) }, (_, index) =>
      makeBilingual(en[index] ?? '', ar[index] ?? '', active)
    )
  )
}

function rowIsBlank(row: readonly WorkbookCell[]): boolean {
  return row.every((cell) => displayed(cellValue(cell)) === '')
}

function buildCursor(
  workbook: ParsedWorkbookData,
  role: CanonicalSheet,
  preset: MappingPreset,
  issues: SpreadsheetValidationIssue[]
): SheetCursor | undefined {
  const selection = preset.selectedSheets[role]
  if (!selection) return undefined
  const sheet = workbook.sheets.find((candidate) => candidate.name === selection.worksheet)
  if (!sheet) {
    issues.push({
      code: 'mapped-sheet-missing',
      severity: 'error',
      messageKey: 'spreadsheet.validation.mapped-sheet-missing',
      details: { role, worksheet: selection.worksheet }
    })
    return undefined
  }
  const headerIndex = selection.headerRow - 1
  const headerCells = sheet.rows[headerIndex]
  if (!headerCells) {
    issues.push({
      code: 'mapped-header-row-missing',
      severity: 'error',
      messageKey: 'spreadsheet.validation.mapped-header-row-missing',
      worksheet: sheet.name,
      details: { headerRow: selection.headerRow }
    })
    return undefined
  }
  const headers = headerCells.map((cell) => displayed(cellValue(cell)))
  const columns: Record<string, number> = {}
  for (const [field, mappedHeader] of Object.entries(preset.fieldMappings[role] ?? {})) {
    const exactIndexes = headers
      .map((header, index) => ({ header, index }))
      .filter(({ header }) => header === mappedHeader)
    const candidates =
      exactIndexes.length > 0
        ? exactIndexes
        : headers
            .map((header, index) => ({ header, index }))
            .filter(({ header }) => normalizeHeader(header) === normalizeHeader(mappedHeader))
    if (candidates.length !== 1) {
      issues.push({
        code: candidates.length === 0 ? 'mapped-header-missing' : 'mapped-header-duplicate',
        severity: 'error',
        messageKey:
          candidates.length === 0
            ? 'spreadsheet.validation.mapped-header-missing'
            : 'spreadsheet.validation.mapped-header-duplicate',
        worksheet: sheet.name,
        rawValue: mappedHeader,
        normalizedValue: field
      })
      continue
    }
    columns[field] = candidates[0]!.index
  }
  return {
    role,
    name: sheet.name,
    headerRow: selection.headerRow,
    headers,
    columns: Object.freeze(columns),
    rows: sheet.rows
  }
}

function recordReader(cursor: SheetCursor, row: readonly WorkbookCell[], rowIndex: number) {
  const fields: Record<string, ReturnType<typeof provenanceFor>> = {}
  const get = (field: string): string => {
    const column = cursor.columns[field]
    if (column === undefined) return ''
    const cell = row[column]
    fields[field] = provenanceFor(cursor.name, rowIndex + 1, column + 1, cell)
    return displayed(cellValue(cell))
  }
  const provenance = (): RecordProvenance =>
    Object.freeze({
      worksheet: cursor.name,
      row: rowIndex + 1,
      // Snapshot rather than freeze the live accumulator: callers may capture
      // provenance for one diagnostic and continue reading other mapped fields.
      fields: Object.freeze({ ...fields })
    })
  return { get, provenance }
}

function provenanceFor(worksheet: string, row: number, column: number, cell?: WorkbookCell) {
  return Object.freeze({
    worksheet,
    row,
    column,
    address: cellAddress(row, column),
    ...(cell?.rawValue !== undefined ? { rawValue: cell.rawValue } : {}),
    displayedValue: cell?.value ?? null
  })
}

function processLanguage(
  processId: string,
  processes: readonly WorkbookProcess[]
): SpreadsheetLocale {
  return processes.find((process) => process.id === processId)?.activeLanguage ?? 'en'
}

export function buildProcessWorkbookModel(
  workbook: ParsedWorkbookData,
  options: ModelBuildOptions
): ModelBuildResult {
  if (options.preset.version !== MAPPING_PRESET_VERSION) {
    throw new TypeError('Unsupported mapping preset version')
  }
  const issues: SpreadsheetValidationIssue[] = []
  const skippedRows: RecordProvenance[] = []
  const cursors = new Map<CanonicalSheet, SheetCursor>()
  for (const role of [
    'processes',
    'participants',
    'steps',
    'flows',
    'glossary'
  ] as CanonicalSheet[]) {
    const cursor = buildCursor(workbook, role, options.preset, issues)
    if (cursor) cursors.set(role, cursor)
  }

  const processes: WorkbookProcess[] = []
  const processCursor = cursors.get('processes')
  if (processCursor) {
    for (
      let rowIndex = processCursor.headerRow;
      rowIndex < processCursor.rows.length;
      rowIndex += 1
    ) {
      const row = processCursor.rows[rowIndex]!
      if (rowIsBlank(row)) {
        skippedRows.push({ worksheet: processCursor.name, row: rowIndex + 1 })
        continue
      }
      const reader = recordReader(processCursor, row, rowIndex)
      const id = reader.get('process_id')
      const activeLanguage = readLanguage(reader.get('active_language'))
      processes.push(
        Object.freeze({
          id,
          idOrigin: 'explicit',
          name: makeBilingual(reader.get('name_en'), reader.get('name_ar'), activeLanguage),
          description: makeBilingual(
            reader.get('description_en'),
            reader.get('description_ar'),
            activeLanguage
          ),
          owner: makeBilingual(reader.get('owner_en'), reader.get('owner_ar'), activeLanguage),
          folder: reader.get('folder') || undefined,
          activeLanguage,
          provenance: reader.provenance()
        })
      )
    }
  }

  const participants: WorkbookParticipant[] = []
  const participantCursor = cursors.get('participants')
  if (participantCursor) {
    for (
      let rowIndex = participantCursor.headerRow;
      rowIndex < participantCursor.rows.length;
      rowIndex += 1
    ) {
      const row = participantCursor.rows[rowIndex]!
      if (rowIsBlank(row)) {
        skippedRows.push({ worksheet: participantCursor.name, row: rowIndex + 1 })
        continue
      }
      const reader = recordReader(participantCursor, row, rowIndex)
      const processId = reader.get('process_id')
      const rawType = reader.get('type')
      const normalizedType = normalizeHeader(rawType)
      const id = reader.get('participant_id')
      const active = processLanguage(processId, processes)
      const participantType =
        options.preset.valueMappings.participantTypes[normalizedType] ??
        (normalizedType === 'lane' || normalizedType === 'مسار'
          ? 'lane'
          : normalizedType === 'pool' || normalizedType === 'حوض'
            ? 'pool'
            : undefined)
      if (!participantType) {
        issues.push({
          code: 'unknown-participant-type',
          severity: 'review',
          messageKey: 'spreadsheet.validation.unknown-participant-type',
          guidanceKey: 'spreadsheet.guidance.map-participant-type',
          processId,
          elementId: id,
          worksheet: participantCursor.name,
          cellAddress: reader.provenance().fields?.type?.address,
          rawValue: rawType,
          normalizedValue: normalizedType
        })
      }
      participants.push(
        Object.freeze({
          processId,
          id,
          idOrigin: id ? 'explicit' : 'generated',
          type: participantType ?? 'pool',
          parentId: reader.get('parent_id') || undefined,
          order: readOrder(reader.get('order')),
          name: makeBilingual(reader.get('name_en'), reader.get('name_ar'), active),
          provenance: reader.provenance()
        })
      )
    }
  }

  const nodes: WorkbookNode[] = []
  const stepCursor = cursors.get('steps')
  if (stepCursor) {
    for (let rowIndex = stepCursor.headerRow; rowIndex < stepCursor.rows.length; rowIndex += 1) {
      const row = stepCursor.rows[rowIndex]!
      if (rowIsBlank(row)) {
        skippedRows.push({ worksheet: stepCursor.name, row: rowIndex + 1 })
        continue
      }
      const reader = recordReader(stepCursor, row, rowIndex)
      const processId = reader.get('process_id') || options.defaultProcessId || ''
      const active = processLanguage(processId, processes)
      const listDelimiters = options.preset.delimiters.list.length
        ? options.preset.delimiters.list
        : DEFAULT_LIST_DELIMITERS
      const id = reader.get('step_id')
      const rawType = reader.get('type')
      const bilingualList = (enField: string, arField: string) =>
        pairLists(
          splitList(reader.get(enField), listDelimiters),
          splitList(reader.get(arField), listDelimiters),
          active
        )
      const metadata: WorkbookNodeMetadata = Object.freeze({
        owner: makeBilingual(reader.get('owner_en'), reader.get('owner_ar'), active),
        raci: reader.get('raci') || undefined,
        responsibleParties: bilingualList('responsible_parties_en', 'responsible_parties_ar'),
        channel: makeBilingual(reader.get('channel_en'), reader.get('channel_ar'), active),
        channelDetail: makeBilingual(
          reader.get('channel_detail_en'),
          reader.get('channel_detail_ar'),
          active
        ),
        inputs: bilingualList('inputs_en', 'inputs_ar'),
        outputs: bilingualList('outputs_en', 'outputs_ar'),
        cc: bilingualList('cc_en', 'cc_ar'),
        decisionBasis: makeBilingual(
          reader.get('decision_basis_en'),
          reader.get('decision_basis_ar'),
          active
        ),
        triggers: makeBilingual(reader.get('triggers_en'), reader.get('triggers_ar'), active),
        calledProcessId: reader.get('called_process_id') || undefined,
        eventDefinition: readEventDefinition(reader.get('event_definition')),
        notes: makeBilingual(reader.get('notes_en'), reader.get('notes_ar'), active)
      })
      const nextValues = [
        reader.get('next_step_id'),
        ...splitList(reader.get('next_step_ids'), listDelimiters)
      ].filter(Boolean)
      nodes.push(
        Object.freeze({
          processId,
          id,
          idOrigin: id ? 'explicit' : 'generated',
          order: readOrder(reader.get('order')),
          type: readNodeType(rawType, options.preset),
          ...(readNodeType(rawType, options.preset) === 'unknown' ? { rawType } : {}),
          name: makeBilingual(reader.get('name_en'), reader.get('name_ar'), active),
          poolId: reader.get('pool_id') || undefined,
          laneId: reader.get('lane_id') || undefined,
          participantId: reader.get('participant_id') || undefined,
          metadata,
          ...(nextValues.length ? { nextStepIds: Object.freeze(nextValues) } : {}),
          provenance: reader.provenance()
        })
      )
    }
  }

  // Ordinary single-sheet imports may omit a Processes sheet. Derive one
  // process per explicit grouping value without copying arbitrary row data.
  const knownProcessIds = new Set(processes.map((process) => process.id))
  for (const processId of new Set(nodes.map((node) => node.processId).filter(Boolean))) {
    if (knownProcessIds.has(processId)) continue
    const firstNode = nodes.find((node) => node.processId === processId)!
    const active = options.defaultProcessName?.active ?? 'en'
    processes.push(
      Object.freeze({
        id: processId,
        idOrigin: 'explicit',
        name:
          options.defaultProcessId === processId && options.defaultProcessName
            ? options.defaultProcessName
            : makeBilingual(processId, '', active),
        activeLanguage: active,
        provenance: firstNode.provenance
      })
    )
    knownProcessIds.add(processId)
  }

  const flows: WorkbookFlow[] = []
  const flowCursor = cursors.get('flows')
  if (flowCursor) {
    for (let rowIndex = flowCursor.headerRow; rowIndex < flowCursor.rows.length; rowIndex += 1) {
      const row = flowCursor.rows[rowIndex]!
      if (rowIsBlank(row)) {
        skippedRows.push({ worksheet: flowCursor.name, row: rowIndex + 1 })
        continue
      }
      const reader = recordReader(flowCursor, row, rowIndex)
      const processId = reader.get('process_id') || options.defaultProcessId || ''
      const active = processLanguage(processId, processes)
      const id = reader.get('flow_id')
      const rawDefault = reader.get('is_default')
      const parsedDefault = readBoolean(rawDefault)
      if (rawDefault && parsedDefault === undefined) {
        issues.push({
          code: 'invalid-boolean',
          severity: 'error',
          messageKey: 'spreadsheet.validation.invalid-boolean',
          worksheet: flowCursor.name,
          cellAddress: reader.provenance().fields?.is_default?.address,
          rawValue: rawDefault,
          normalizedValue: 'true|false'
        })
      }
      flows.push(
        Object.freeze({
          processId,
          id,
          idOrigin: id ? 'explicit' : 'generated',
          sourceStepId: reader.get('source_step_id'),
          targetStepId: reader.get('target_step_id'),
          condition: makeBilingual(reader.get('condition_en'), reader.get('condition_ar'), active),
          isDefault: parsedDefault ?? false,
          origin: 'explicit',
          provenance: reader.provenance()
        })
      )
    }
  }

  const glossary: WorkbookGlossaryEntry[] = []
  const glossaryCursor = cursors.get('glossary')
  if (glossaryCursor) {
    for (
      let rowIndex = glossaryCursor.headerRow;
      rowIndex < glossaryCursor.rows.length;
      rowIndex += 1
    ) {
      const row = glossaryCursor.rows[rowIndex]!
      if (rowIsBlank(row)) {
        skippedRows.push({ worksheet: glossaryCursor.name, row: rowIndex + 1 })
        continue
      }
      const reader = recordReader(glossaryCursor, row, rowIndex)
      glossary.push(
        Object.freeze({
          english: reader.get('english'),
          arabic: reader.get('arabic'),
          doNotTranslate: readBoolean(reader.get('do_not_translate')) ?? false,
          caseSensitive: readBoolean(reader.get('case_sensitive')) ?? false,
          provenance: reader.provenance()
        })
      )
    }
  }

  const worksheets = [...cursors.values()].map((cursor) =>
    Object.freeze({
      name: cursor.name,
      headerRow: cursor.headerRow,
      rowCount: Math.max(0, cursor.rows.length - cursor.headerRow),
      columnCount: cursor.headers.length,
      headerSignature: headerSignature(cursor.headers)
    })
  )
  const model: ProcessWorkbookModel = Object.freeze({
    version: PROCESS_WORKBOOK_MODEL_VERSION,
    ...(options.templateVersion ? { templateVersion: options.templateVersion } : {}),
    source: Object.freeze({
      fileName: options.fileName,
      format: options.format,
      officialTemplate: options.officialTemplate ?? false,
      worksheets: Object.freeze(worksheets)
    }),
    processes: Object.freeze(processes),
    participants: Object.freeze(participants),
    nodes: Object.freeze(nodes),
    flows: Object.freeze(flows),
    glossary: Object.freeze(glossary)
  })
  return Object.freeze({
    model,
    issues: Object.freeze(issues),
    skippedRows: Object.freeze(skippedRows)
  })
}

export function officialTemplatePreset(
  workbook: ParsedWorkbookData,
  detection: OfficialTemplateDetection = detectOfficialTemplate(workbook)
): MappingPreset {
  const fieldMappings: Partial<Record<CanonicalSheet, Readonly<Record<string, string>>>> = {}
  for (const role of Object.keys(OFFICIAL_SHEET_NAMES) as CanonicalSheet[]) {
    const selection = detection.selectedSheets[role]
    if (!selection) continue
    const sheet = workbook.sheets.find((candidate) => candidate.name === selection.worksheet)
    const headerRow = sheet?.rows[selection.headerRow - 1]
    if (!headerRow) continue
    const headers = headerRow.map((cell) => displayed(cellValue(cell)))
    const mapping: Record<string, string> = {}
    for (const header of headers) {
      const normalized = normalizeHeader(header)
      if (header && !Object.values(mapping).includes(header))
        mapping[normalized.replaceAll(' ', '_')] = header
    }
    fieldMappings[role] = Object.freeze(mapping)
  }
  return Object.freeze({
    version: MAPPING_PRESET_VERSION,
    name: `OrbitPM ${detection.templateVersion ?? 'structural'} template`,
    headerSignatures: detection.headerSignatures,
    selectedSheets: detection.selectedSheets,
    fieldMappings: Object.freeze(fieldMappings),
    valueMappings: Object.freeze({
      stepTypes: Object.freeze({}),
      participantTypes: Object.freeze({})
    }),
    delimiters: Object.freeze({ list: DEFAULT_LIST_DELIMITERS }),
    inference: Object.freeze({
      flowMode: 'auto',
      syntheticBoundaries: 'review',
      requireGatewayConditions: true
    }),
    locale: 'en'
  })
}
