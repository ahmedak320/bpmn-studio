import { CANONICAL_FIELDS_BY_SHEET } from './aliases'
import { columnNumberToLetters } from './cellAddress'
import { OFFICIAL_TEMPLATE_VERSION, type CellPrimitive } from './contracts'

export type OfficialTemplateKind = 'blank' | 'example'

export const OFFICIAL_TEMPLATE_ASSET_NAMES = Object.freeze({
  blank: 'OrbitPM-Excel-Template-0.4.5.xlsx',
  example: 'OrbitPM-Excel-Example-0.4.5.xlsx'
} satisfies Readonly<Record<OfficialTemplateKind, string>>)

interface TemplateSheet {
  readonly name: string
  readonly rows: readonly (readonly CellPrimitive[])[]
}

interface ZipSource {
  readonly path: string
  readonly bytes: Uint8Array
}

const encoder = new TextEncoder()
const FIXED_CORE_TIMESTAMP = '2026-01-01T00:00:00Z'
const ZIP_UTF8_FLAG = 0x0800
const ZIP_STORED = 0
const ZIP_DOS_TIME = 0
const ZIP_DOS_DATE = 0x0021 // 1980-01-01

const EXAMPLE_ROWS: Readonly<Record<string, readonly (readonly CellPrimitive[])[]>> =
  Object.freeze({
    Processes: Object.freeze([
      Object.freeze([
        'leave_approval',
        'Leave approval',
        'الموافقة على الإجازة',
        'Review and decide an employee leave request.',
        'مراجعة طلب إجازة الموظف واتخاذ القرار.',
        'Human Resources',
        'الموارد البشرية',
        'hr',
        'en'
      ])
    ]),
    Participants: Object.freeze([
      Object.freeze([
        'leave_approval',
        'Pool_Leave',
        'pool',
        '',
        1,
        'Leave approval',
        'الموافقة على الإجازة'
      ]),
      Object.freeze([
        'leave_approval',
        'Lane_Employee',
        'lane',
        'Pool_Leave',
        1,
        'Employee',
        'الموظف'
      ]),
      Object.freeze([
        'leave_approval',
        'Lane_Manager',
        'lane',
        'Pool_Leave',
        2,
        'Manager',
        'المدير'
      ])
    ]),
    Steps: Object.freeze([
      Object.freeze([
        'leave_approval',
        'Start_Request',
        1,
        'startEvent',
        'Request received',
        'استلام الطلب',
        'Pool_Leave',
        'Lane_Employee',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        'Leave request received',
        'استلام طلب الإجازة',
        '',
        'message',
        '',
        '',
        ''
      ]),
      Object.freeze([
        'leave_approval',
        'Submit_Request',
        2,
        'userTask',
        'Submit leave request',
        'تقديم طلب الإجازة',
        'Pool_Leave',
        'Lane_Employee',
        '',
        'Employee',
        'الموظف',
        'R',
        'Employee',
        'الموظف',
        'DMT HUB',
        'DMT HUB',
        'Leave service',
        'خدمة الإجازات',
        'Leave dates;Reason',
        'تواريخ الإجازة;السبب',
        'Submitted request',
        'الطلب المقدم',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        'Enter complete and accurate request details.',
        'إدخال بيانات الطلب كاملة ودقيقة.',
        '',
        '',
        ''
      ]),
      Object.freeze([
        'leave_approval',
        'Review_Request',
        3,
        'userTask',
        'Review request',
        'مراجعة الطلب',
        'Pool_Leave',
        'Lane_Manager',
        '',
        'Manager',
        'المدير',
        'A',
        'Manager',
        'المدير',
        'DMT HUB',
        'DMT HUB',
        'Manager inbox',
        'صندوق وارد المدير',
        'Submitted request',
        'الطلب المقدم',
        'Review decision',
        'قرار المراجعة',
        'Employee',
        'الموظف',
        'Leave policy and staffing requirements',
        'سياسة الإجازات ومتطلبات التوظيف',
        '',
        '',
        '',
        '',
        '',
        'Check entitlement and operational coverage.',
        'التحقق من الاستحقاق والتغطية التشغيلية.',
        '',
        '',
        ''
      ]),
      Object.freeze([
        'leave_approval',
        'Decision_Gateway',
        4,
        'exclusiveGateway',
        'Request approved?',
        'هل تمت الموافقة على الطلب؟',
        'Pool_Leave',
        'Lane_Manager',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        'Leave policy',
        'سياسة الإجازات',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        ''
      ]),
      Object.freeze([
        'leave_approval',
        'Approve_Request',
        5,
        'task',
        'Record approval',
        'تسجيل الموافقة',
        'Pool_Leave',
        'Lane_Manager',
        '',
        'Manager',
        'المدير',
        'A',
        '',
        '',
        'DMT HUB',
        'DMT HUB',
        '',
        '',
        '',
        '',
        'Approved request',
        'الطلب الموافق عليه',
        'Employee',
        'الموظف',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        ''
      ]),
      Object.freeze([
        'leave_approval',
        'Reject_Request',
        5,
        'task',
        'Record rejection',
        'تسجيل الرفض',
        'Pool_Leave',
        'Lane_Manager',
        '',
        'Manager',
        'المدير',
        'A',
        '',
        '',
        'DMT HUB',
        'DMT HUB',
        '',
        '',
        '',
        '',
        'Rejected request',
        'الطلب المرفوض',
        'Employee',
        'الموظف',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        ''
      ]),
      Object.freeze([
        'leave_approval',
        'End_Request',
        6,
        'endEvent',
        'Request closed',
        'إغلاق الطلب',
        'Pool_Leave',
        'Lane_Manager',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        ''
      ])
    ]),
    Flows: Object.freeze([
      Object.freeze([
        'leave_approval',
        'Flow_1',
        'Start_Request',
        'Submit_Request',
        '',
        '',
        false
      ]),
      Object.freeze([
        'leave_approval',
        'Flow_2',
        'Submit_Request',
        'Review_Request',
        '',
        '',
        false
      ]),
      Object.freeze([
        'leave_approval',
        'Flow_3',
        'Review_Request',
        'Decision_Gateway',
        '',
        '',
        false
      ]),
      Object.freeze([
        'leave_approval',
        'Flow_Approved',
        'Decision_Gateway',
        'Approve_Request',
        'Approved',
        'تمت الموافقة',
        false
      ]),
      Object.freeze([
        'leave_approval',
        'Flow_Rejected',
        'Decision_Gateway',
        'Reject_Request',
        '',
        '',
        true
      ]),
      Object.freeze([
        'leave_approval',
        'Flow_4',
        'Approve_Request',
        'End_Request',
        '',
        '',
        false
      ]),
      Object.freeze([
        'leave_approval',
        'Flow_5',
        'Reject_Request',
        'End_Request',
        '',
        '',
        false
      ])
    ]),
    Glossary: Object.freeze([
      Object.freeze(['API', 'API', true, true]),
      Object.freeze(['SLA', 'SLA', true, true]),
      Object.freeze(['DMT HUB', 'DMT HUB', true, false])
    ])
  })

function xmlEscape(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function worksheetXml(rows: readonly (readonly CellPrimitive[])[]): string {
  let xml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
  if (rows.length === 0) return `${xml}<sheetData/></worksheet>`
  xml += '<sheetData>'
  for (const [rowIndex, row] of rows.entries()) {
    const rowNumber = rowIndex + 1
    xml += `<row r="${rowNumber}">`
    for (const [columnIndex, value] of row.entries()) {
      if (value === null || value === '') continue
      const reference = `${columnNumberToLetters(columnIndex + 1)}${rowNumber}`
      if (typeof value === 'number') {
        xml += `<c r="${reference}"><v>${String(value)}</v></c>`
      } else if (typeof value === 'boolean') {
        xml += `<c r="${reference}" t="b"><v>${value ? '1' : '0'}</v></c>`
      } else {
        const text = value instanceof Date ? value.toISOString() : String(value)
        const preserve = /^\s|\s$|\n/.test(text) ? ' xml:space="preserve"' : ''
        xml += `<c r="${reference}" t="inlineStr"><is><t${preserve}>${xmlEscape(
          text
        )}</t></is></c>`
      }
    }
    xml += '</row>'
  }
  return `${xml}</sheetData></worksheet>`
}

function templateSheets(kind: OfficialTemplateKind): readonly TemplateSheet[] {
  const sheetOrder = [
    ['processes', 'Processes'],
    ['participants', 'Participants'],
    ['steps', 'Steps'],
    ['flows', 'Flows'],
    ['glossary', 'Glossary']
  ] as const
  return Object.freeze(
    sheetOrder.map(([role, name]) =>
      Object.freeze({
        name,
        rows: Object.freeze([
          Object.freeze([...CANONICAL_FIELDS_BY_SHEET[role]]),
          ...(kind === 'example' ? (EXAMPLE_ROWS[name] ?? []) : [])
        ])
      })
    )
  )
}

function workbookEntries(kind: OfficialTemplateKind): readonly ZipSource[] {
  const sheets = templateSheets(kind)
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
  const core =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
    '<dc:creator>OrbitPM</dc:creator><cp:lastModifiedBy>OrbitPM</cp:lastModifiedBy>' +
    `<dcterms:created xsi:type="dcterms:W3CDTF">${FIXED_CORE_TIMESTAMP}</dcterms:created>` +
    `<dcterms:modified xsi:type="dcterms:W3CDTF">${FIXED_CORE_TIMESTAMP}</dcterms:modified>` +
    '</cp:coreProperties>'
  const app =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">' +
    '<Application>OrbitPM Process Studio Lite</Application><AppVersion>0.4.5</AppVersion>' +
    '</Properties>'
  const custom =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">' +
    `<property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="2" name="OrbitPMTemplateVersion"><vt:lpwstr>${OFFICIAL_TEMPLATE_VERSION}</vt:lpwstr></property>` +
    `<property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="3" name="OrbitPMTemplateKind"><vt:lpwstr>${kind}</vt:lpwstr></property>` +
    '</Properties>'

  const textEntries: Array<readonly [string, string]> = [
    ['[Content_Types].xml', contentTypes],
    ['_rels/.rels', rootRelationships],
    ['docProps/app.xml', app],
    ['docProps/core.xml', core],
    ['docProps/custom.xml', custom],
    ['xl/_rels/workbook.xml.rels', workbookRelationships],
    ['xl/styles.xml', styles],
    ['xl/workbook.xml', workbook],
    ...sheets.map(
      (sheet, index) =>
        [`xl/worksheets/sheet${index + 1}.xml`, worksheetXml(sheet.rows)] as const
    )
  ]
  return Object.freeze(
    textEntries
      .map(([path, text]) => Object.freeze({ path, bytes: encoder.encode(text) }))
      .sort((left, right) => left.path.localeCompare(right.path, 'en'))
  )
}

let crcTable: Uint32Array | undefined

function getCrcTable(): Uint32Array {
  if (crcTable) return crcTable
  const table = new Uint32Array(256)
  for (let index = 0; index < 256; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) !== 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    }
    table[index] = value >>> 0
  }
  crcTable = table
  return table
}

function crc32(bytes: Uint8Array): number {
  const table = getCrcTable()
  let crc = 0xffff_ffff
  for (const byte of bytes) crc = table[(crc ^ byte) & 0xff]! ^ (crc >>> 8)
  return (crc ^ 0xffff_ffff) >>> 0
}

function writeUint16(output: number[], value: number): void {
  output.push(value & 0xff, (value >>> 8) & 0xff)
}

function writeUint32(output: number[], value: number): void {
  output.push(
    value & 0xff,
    (value >>> 8) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 24) & 0xff
  )
}

function pushBytes(output: number[], bytes: Uint8Array): void {
  for (const byte of bytes) output.push(byte)
}

/** Deterministic stored-entry ZIP writer sufficient for macro-free XLSX assets. */
function storedZip(entries: readonly ZipSource[]): Uint8Array {
  const output: number[] = []
  const central: number[] = []
  for (const entry of entries) {
    const path = encoder.encode(entry.path)
    const checksum = crc32(entry.bytes)
    const localOffset = output.length
    writeUint32(output, 0x04034b50)
    writeUint16(output, 20)
    writeUint16(output, ZIP_UTF8_FLAG)
    writeUint16(output, ZIP_STORED)
    writeUint16(output, ZIP_DOS_TIME)
    writeUint16(output, ZIP_DOS_DATE)
    writeUint32(output, checksum)
    writeUint32(output, entry.bytes.length)
    writeUint32(output, entry.bytes.length)
    writeUint16(output, path.length)
    writeUint16(output, 0)
    pushBytes(output, path)
    pushBytes(output, entry.bytes)

    writeUint32(central, 0x02014b50)
    writeUint16(central, 20)
    writeUint16(central, 20)
    writeUint16(central, ZIP_UTF8_FLAG)
    writeUint16(central, ZIP_STORED)
    writeUint16(central, ZIP_DOS_TIME)
    writeUint16(central, ZIP_DOS_DATE)
    writeUint32(central, checksum)
    writeUint32(central, entry.bytes.length)
    writeUint32(central, entry.bytes.length)
    writeUint16(central, path.length)
    writeUint16(central, 0)
    writeUint16(central, 0)
    writeUint16(central, 0)
    writeUint16(central, 0)
    writeUint32(central, 0)
    writeUint32(central, localOffset)
    pushBytes(central, path)
  }
  const centralOffset = output.length
  output.push(...central)
  writeUint32(output, 0x06054b50)
  writeUint16(output, 0)
  writeUint16(output, 0)
  writeUint16(output, entries.length)
  writeUint16(output, entries.length)
  writeUint32(output, central.length)
  writeUint32(output, centralOffset)
  writeUint16(output, 0)
  return new Uint8Array(output)
}

export function createOfficialWorkbookTemplate(kind: OfficialTemplateKind): Uint8Array {
  return storedZip(workbookEntries(kind))
}

export function createOfficialWorkbookTemplates(): Readonly<
  Record<OfficialTemplateKind, { readonly fileName: string; readonly bytes: Uint8Array }>
> {
  return Object.freeze({
    blank: Object.freeze({
      fileName: OFFICIAL_TEMPLATE_ASSET_NAMES.blank,
      bytes: createOfficialWorkbookTemplate('blank')
    }),
    example: Object.freeze({
      fileName: OFFICIAL_TEMPLATE_ASSET_NAMES.example,
      bytes: createOfficialWorkbookTemplate('example')
    })
  })
}
