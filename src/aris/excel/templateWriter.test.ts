import { strFromU8, unzipSync } from 'fflate'
import readXlsxFile, { readSheet } from 'read-excel-file/node'
import { describe, expect, it } from 'vitest'

import { sha256Hex } from '../../spreadsheet/hash'
import { preflightXlsx } from '../../spreadsheet/xlsxPreflight'
import {
  ARIS_SHEET_NAMES,
  ARIS_SHEET_SPECS,
  ARIS_TEMPLATE_IDENTITY,
  ARIS_TEMPLATE_IDENTITY_PROPERTY,
  ARIS_TEMPLATE_PROPERTY,
  ARIS_TEMPLATE_VERSION
} from './templateSchema'
import {
  ARIS_TEMPLATE_ASSET_NAMES,
  ARIS_TEMPLATE_BANNER_ROW,
  ARIS_TEMPLATE_HEADER_ROW,
  createArisTemplateWorkbook,
  createArisTemplateWorkbooks
} from './templateWriter'
import { parseArisWorkbook } from './workbookParser'
import { readArisXlsx } from './xlsxReader'

const decoder = new TextDecoder()

function entryText(bytes: Uint8Array, path: string): string {
  const archive = unzipSync(bytes)
  const entry = archive[path]
  expect(entry, path).toBeDefined()
  return strFromU8(entry!)
}

describe('deterministic ARIS template generation (§15.1)', () => {
  it('produces byte-identical output across independent generations', () => {
    const first = createArisTemplateWorkbooks()
    const second = createArisTemplateWorkbooks()

    expect(first.blank.bytes).toEqual(second.blank.bytes)
    expect(first.example.bytes).toEqual(second.example.bytes)
    expect(first.blank.bytes).not.toEqual(first.example.bytes)
    expect(first.blank.fileName).toBe(ARIS_TEMPLATE_ASSET_NAMES.blank)
    expect(first.example.fileName).toBe(ARIS_TEMPLATE_ASSET_NAMES.example)
    expect(first.blank.bytes.slice(0, 4)).toEqual(new Uint8Array([0x50, 0x4b, 0x03, 0x04]))
  })

  it('pins the SHA-256 of both official templates', () => {
    expect(sha256Hex(createArisTemplateWorkbook('blank'))).toBe(
      'a9d5ebd6559e31618c88c74b999c7080a88855877c41d405badb1d87ae51d4ea'
    )
    expect(sha256Hex(createArisTemplateWorkbook('example'))).toBe(
      '11491a0a398e37c795c183aa3e9dcd6752901f02331dd951fb93ee64ce60a490'
    )
  })

  it('carries no machine data: fixed DOS timestamps, fixed core properties, no absolute paths', () => {
    const bytes = createArisTemplateWorkbook('example')
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const preflight = preflightXlsx(bytes)
    for (const entry of preflight.entries) {
      expect(view.getUint16(entry.localHeaderOffset + 10, true)).toBe(0) // DOS time
      expect(view.getUint16(entry.localHeaderOffset + 12, true)).toBe(0x0021) // 1980-01-01
      expect(entry.path.startsWith('/')).toBe(false)
      expect(entry.path).not.toMatch(/\.\./)
    }
    const core = entryText(bytes, 'docProps/core.xml')
    expect(core).toContain('2026-01-01T00:00:00Z')
    expect(core).toContain('<dc:creator>OrbitPM</dc:creator>')
    expect(core).not.toMatch(new RegExp(String.raw`/home/|C:\\`))
  })

  it('embeds the identity string as custom properties and as a visible cell', () => {
    for (const kind of ['blank', 'example'] as const) {
      const bytes = createArisTemplateWorkbook(kind)
      const custom = entryText(bytes, 'docProps/custom.xml')
      expect(custom).toContain(`name="${ARIS_TEMPLATE_PROPERTY}"`)
      expect(custom).toContain(`<vt:lpwstr>${ARIS_TEMPLATE_VERSION}</vt:lpwstr>`)
      expect(custom).toContain(`name="${ARIS_TEMPLATE_IDENTITY_PROPERTY}"`)
      expect(custom).toContain(`<vt:lpwstr>${ARIS_TEMPLATE_IDENTITY}</vt:lpwstr>`)

      const workbook = readArisXlsx(bytes)
      expect(workbook.customProperties[ARIS_TEMPLATE_PROPERTY]).toBe(ARIS_TEMPLATE_VERSION)
      for (const sheet of workbook.sheets) {
        const banner = sheet.rows.find((row) => row.row === ARIS_TEMPLATE_BANNER_ROW)
        expect(banner?.cells[0]?.address).toBe('A1')
        expect(banner?.cells[0]?.text).toBe(ARIS_TEMPLATE_IDENTITY)
      }
    }
  })

  it('writes exactly the nine plan sheets with their exact header rows', () => {
    const workbook = readArisXlsx(createArisTemplateWorkbook('blank'))
    expect(workbook.sheets.map((sheet) => sheet.name)).toEqual([...ARIS_SHEET_NAMES])
    for (const spec of ARIS_SHEET_SPECS) {
      const sheet = workbook.sheets.find((candidate) => candidate.name === spec.name)
      const header = sheet?.rows.find((row) => row.row === ARIS_TEMPLATE_HEADER_ROW)
      expect(header?.cells.map((cell) => cell.text)).toEqual(
        spec.columns.map((column) => column.name)
      )
      // The blank template carries headers only.
      expect(sheet?.rows.length).toBe(ARIS_TEMPLATE_HEADER_ROW)
    }
  })

  it('contains no macros, ActiveX, external links, or calculated formulas', () => {
    for (const kind of ['blank', 'example'] as const) {
      const bytes = createArisTemplateWorkbook(kind)
      const archive = unzipSync(bytes)
      for (const path of Object.keys(archive)) {
        expect(path).not.toMatch(/vbaProject|activeX|ctrlProps|externalLinks|embeddings/i)
      }
      expect(entryText(bytes, '[Content_Types].xml')).not.toMatch(/macroEnabled/i)
      for (const path of Object.keys(archive)) {
        if (!path.startsWith('xl/worksheets/')) continue
        expect(decoder.decode(archive[path]!)).not.toMatch(/<f[\s>]/)
      }
      expect(preflightXlsx(bytes).warnings).toEqual([])
    }
  })

  it('round-trips through read-excel-file with bilingual content intact', async () => {
    const bytes = createArisTemplateWorkbook('example')
    const sheets = await readXlsxFile(Buffer.from(bytes))
    expect(sheets.map((sheet) => sheet.sheet)).toEqual([...ARIS_SHEET_NAMES])

    const models = await readSheet(Buffer.from(bytes), 'Models')
    expect(models[ARIS_TEMPLATE_BANNER_ROW - 1]?.[0]).toBe(ARIS_TEMPLATE_IDENTITY)
    expect(models[ARIS_TEMPLATE_HEADER_ROW - 1]).toEqual(
      ARIS_SHEET_SPECS[0]!.columns.map((column) => column.name)
    )
    expect(models[ARIS_TEMPLATE_HEADER_ROW]?.[3]).toBe('الموافقة على الإجازة')
  })

  it('round-trips through its own parser into an accepted workbook model', () => {
    const blank = parseArisWorkbook(
      ARIS_TEMPLATE_ASSET_NAMES.blank,
      createArisTemplateWorkbook('blank')
    )
    // A blank template has no models yet, so it is a valid template but not a
    // committable workbook; the rejection must be the empty-workbook issue only.
    expect(blank.detection.official).toBe(true)
    expect(blank.issues.map((issue) => issue.code)).toEqual(['empty-workbook'])

    const example = parseArisWorkbook(
      ARIS_TEMPLATE_ASSET_NAMES.example,
      createArisTemplateWorkbook('example')
    )
    expect(example.issues).toEqual([])
    expect(example.status).toBe('accepted')
    expect(example.detection).toMatchObject({
      official: true,
      templateVersion: ARIS_TEMPLATE_VERSION,
      templateKind: 'example'
    })
    expect(example.model?.counts).toMatchObject({
      models: 3,
      objectDefinitions: 11,
      objectOccurrences: 11,
      connections: 8,
      lanes: 2,
      freeText: 1,
      styles: 4,
      attributes: 8,
      assignments: 3,
      glossary: 3
    })
  })
})
