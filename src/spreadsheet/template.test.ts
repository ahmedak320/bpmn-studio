import { unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { OFFICIAL_TEMPLATE_VERSION, type ParsedWorkbookData, type WorkbookCell } from './contracts'
import { sha256Hex } from './hash'
import { buildProcessWorkbookModel, officialTemplatePreset } from './modelBuilder'
import { detectOfficialTemplate } from './officialTemplate'
import {
  createOfficialWorkbookTemplate,
  createOfficialWorkbookTemplates,
  OFFICIAL_TEMPLATE_ASSET_NAMES
} from './template'
import { preflightXlsx } from './xlsxPreflight'
import { validateProcessWorkbookModel } from './validation'

const decoder = new TextDecoder()

function decodeXml(value: string): string {
  return value
    .replaceAll('&quot;', '"')
    .replaceAll('&gt;', '>')
    .replaceAll('&lt;', '<')
    .replaceAll('&amp;', '&')
}

function columnIndex(reference: string): number {
  const letters = /^[A-Z]+/.exec(reference)?.[0] ?? ''
  let value = 0
  for (const letter of letters) value = value * 26 + letter.charCodeAt(0) - 64
  return value - 1
}

function parseGeneratedSheet(xml: string): WorkbookCell[][] {
  const rows: WorkbookCell[][] = []
  for (const rowMatch of xml.matchAll(/<row r="(\d+)">([\s\S]*?)<\/row>/g)) {
    const rowNumber = Number(rowMatch[1])
    const row: WorkbookCell[] = []
    for (const cellMatch of rowMatch[2]!.matchAll(
      /<c r="([A-Z]+\d+)"(?: t="([^"]+)")?>([\s\S]*?)<\/c>/g
    )) {
      const body = cellMatch[3]!
      const stringValue = /<t(?: [^>]*)?>([\s\S]*?)<\/t>/.exec(body)?.[1]
      const scalarValue = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1]
      const value =
        stringValue !== undefined
          ? decodeXml(stringValue)
          : cellMatch[2] === 'b'
            ? scalarValue === '1'
            : Number(scalarValue)
      row[columnIndex(cellMatch[1]!)] = { value, rawValue: value }
    }
    rows[rowNumber - 1] = row
  }
  return rows
}

function parseGeneratedWorkbook(bytes: Uint8Array): ParsedWorkbookData {
  const unzipped = unzipSync(bytes)
  const names = ['Processes', 'Participants', 'Steps', 'Flows', 'Glossary']
  return {
    customProperties: { OrbitPMTemplateVersion: OFFICIAL_TEMPLATE_VERSION },
    sheets: names.map((name, index) => ({
      name,
      rows: parseGeneratedSheet(decoder.decode(unzipped[`xl/worksheets/sheet${index + 1}.xml`]))
    }))
  }
}

describe('deterministic official workbook assets', () => {
  it('emits byte-identical blank and example assets with release names', () => {
    const first = createOfficialWorkbookTemplates()
    const second = createOfficialWorkbookTemplates()

    expect(first.blank.fileName).toBe('OrbitPM-Excel-Template-0.4.5.xlsx')
    expect(first.example.fileName).toBe('OrbitPM-Excel-Example-0.4.5.xlsx')
    expect(OFFICIAL_TEMPLATE_ASSET_NAMES).toEqual({
      blank: first.blank.fileName,
      example: first.example.fileName
    })
    expect(first.blank.bytes).toEqual(second.blank.bytes)
    expect(first.example.bytes).toEqual(second.example.bytes)
    expect(first.blank.bytes).not.toEqual(first.example.bytes)
    expect(first.blank.bytes.slice(0, 4)).toEqual(new Uint8Array([0x50, 0x4b, 0x03, 0x04]))
  })

  it('passes central-directory preflight with exactly five worksheets', () => {
    for (const kind of ['blank', 'example'] as const) {
      const bytes = createOfficialWorkbookTemplate(kind)
      const result = preflightXlsx(bytes)
      expect(result.worksheetCount).toBe(5)
      expect(result.totalDeclaredUncompressedBytes).toBeGreaterThan(0)
      expect(result.warnings).toEqual([])
      expect(result.entries.map(({ path }) => path)).toContain('xl/workbook.xml')
    }
  })

  it('contains the version marker, all official sheets, and bilingual example data', () => {
    const unzipped = unzipSync(createOfficialWorkbookTemplate('example'))
    const custom = decoder.decode(unzipped['docProps/custom.xml'])
    const workbook = decoder.decode(unzipped['xl/workbook.xml'])
    const steps = decoder.decode(unzipped['xl/worksheets/sheet3.xml'])

    expect(custom).toContain(`>${OFFICIAL_TEMPLATE_VERSION}<`)
    for (const sheet of ['Processes', 'Participants', 'Steps', 'Flows', 'Glossary']) {
      expect(workbook).toContain(`name="${sheet}"`)
    }
    expect(steps).toContain('name_en')
    expect(steps).toContain('called_process_id')
    expect(steps).toContain('Submit leave request')
    expect(steps).toContain('تقديم طلب الإجازة')
    expect(steps).toContain('exclusiveGateway')
  })

  it('pins reproducible SHA-256 digests for accidental-change detection', () => {
    expect(sha256Hex(createOfficialWorkbookTemplate('blank'))).toBe(
      '3145d9e2ad4e12298c820d945a472cbad45b23089376acbae90d28414d1a24bf'
    )
    expect(sha256Hex(createOfficialWorkbookTemplate('example'))).toBe(
      '9f7e8f03702f74ad2be89331828c7e181a7804bd7ed96c028d00979e3e04e617'
    )
  })

  it('round-trips the example into a complete, structurally valid graph model', () => {
    const workbook = parseGeneratedWorkbook(createOfficialWorkbookTemplate('example'))
    const detection = detectOfficialTemplate(workbook)
    const built = buildProcessWorkbookModel(workbook, {
      fileName: OFFICIAL_TEMPLATE_ASSET_NAMES.example,
      format: 'xlsx',
      officialTemplate: true,
      templateVersion: detection.templateVersion,
      preset: officialTemplatePreset(workbook, detection)
    })
    const validation = validateProcessWorkbookModel(built.model, {
      additionalIssues: built.issues
    })

    expect(detection.official).toBe(true)
    expect(built.model.processes).toHaveLength(1)
    expect(built.model.participants).toHaveLength(3)
    expect(built.model.nodes).toHaveLength(7)
    expect(built.model.flows).toHaveLength(7)
    expect(validation.issues).toEqual([])
    expect(validation).toMatchObject({
      blocking: false,
      errorCount: 0,
      reviewCount: 0
    })
  })
})
