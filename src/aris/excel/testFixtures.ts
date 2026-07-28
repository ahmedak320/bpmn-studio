import { unzipSync } from 'fflate'

import {
  ARIS_SHEET_SPECS,
  ARIS_TEMPLATE_IDENTITY,
  ARIS_TEMPLATE_IDENTITY_PROPERTY,
  ARIS_TEMPLATE_KIND_PROPERTY,
  ARIS_TEMPLATE_PROPERTY,
  ARIS_TEMPLATE_VERSION,
  arisSheetSpec,
  type ArisSheetName
} from './templateSchema'
import {
  writeDeterministicZip,
  writeXlsx,
  writeXlsxFromWorksheetXml,
  worksheetXmlFromRows,
  type XlsxCellValue,
  type XlsxSheetInput,
  type XlsxWorksheetXmlInput,
  type ZipSource
} from './xlsxWriter'

/**
 * Fixture builders for the ARIS workbook tests.
 *
 * This module is test-only: nothing in the production graph imports it, so it
 * is tree-shaken out of the single-file build. It exists as a module (rather
 * than living inside one test file) so the limit, parser, and template tests
 * all construct workbooks the same way.
 */

export type FixtureRow = Readonly<Record<string, XlsxCellValue>>

export type FixtureSheets = Partial<Record<ArisSheetName, readonly FixtureRow[]>>

export interface FixtureWorkbookOptions {
  /** Row records per sheet, keyed by column name. Missing sheets stay empty. */
  readonly sheets?: FixtureSheets
  /** Replaces the generated sheet set entirely (for malformed-input tests). */
  readonly rawSheets?: readonly XlsxSheetInput[]
  readonly customProperties?: readonly (readonly [string, string])[]
  /** Whether to emit the visible `OrbitPMArisTemplateVersion=1` banner row. */
  readonly banner?: boolean
  /** Extra sheets appended after the nine ARIS sheets. */
  readonly extraSheets?: readonly XlsxSheetInput[]
}

export const DEFAULT_TEMPLATE_PROPERTIES: readonly (readonly [string, string])[] = Object.freeze([
  [ARIS_TEMPLATE_PROPERTY, ARIS_TEMPLATE_VERSION] as const,
  [ARIS_TEMPLATE_IDENTITY_PROPERTY, ARIS_TEMPLATE_IDENTITY] as const,
  [ARIS_TEMPLATE_KIND_PROPERTY, 'test'] as const
])

/** A minimal but complete, valid ARIS workbook: one EPC with two objects. */
export function baselineFixtureSheets(): FixtureSheets {
  return {
    Models: [
      {
        model_id: 'MDL_1',
        model_type: 'MT_EEPC',
        name_en: 'Baseline model',
        name_ar: 'نموذج أساسي',
        orientation: 'horizontal'
      }
    ],
    Objects: [
      {
        model_id: 'MDL_1',
        object_id: 'OBJ_EVT',
        occurrence_id: 'OCC_EVT',
        object_type: 'OT_EVT',
        symbol_type: 'ST_EV',
        name_en: 'Request received',
        name_ar: 'تم استلام الطلب'
      },
      {
        model_id: 'MDL_1',
        object_id: 'OBJ_FUNC',
        occurrence_id: 'OCC_FUNC',
        object_type: 'OT_FUNC',
        symbol_type: 'ST_FUNC',
        name_en: 'Handle request',
        name_ar: 'معالجة الطلب'
      }
    ],
    Connections: [
      {
        model_id: 'MDL_1',
        connection_id: 'CXN_1',
        source_occurrence_id: 'OCC_EVT',
        target_occurrence_id: 'OCC_FUNC',
        connection_type: 'CT_ACT_1'
      }
    ]
  }
}

function sheetRows(
  name: ArisSheetName,
  rows: readonly FixtureRow[],
  banner: boolean
): XlsxSheetInput {
  const spec = arisSheetSpec(name)
  if (!spec) throw new Error(`unknown sheet: ${name}`)
  const header = spec.columns.map((column) => column.name)
  return {
    name,
    rows: [
      ...(banner ? [[ARIS_TEMPLATE_IDENTITY] as readonly XlsxCellValue[]] : []),
      header,
      ...rows.map((row) => spec.columns.map((column) => row[column.name] ?? ''))
    ]
  }
}

/** Builds a workbook from row records; unspecified sheets get headers only. */
export function buildFixtureWorkbook(options: FixtureWorkbookOptions = {}): Uint8Array {
  const banner = options.banner ?? true
  const sheets =
    options.rawSheets ??
    ARIS_SHEET_SPECS.map((spec) => sheetRows(spec.name, options.sheets?.[spec.name] ?? [], banner))
  return writeXlsx([...sheets, ...(options.extraSheets ?? [])], {
    customProperties: options.customProperties ?? DEFAULT_TEMPLATE_PROPERTIES,
    application: 'OrbitPM ARIS Studio Lite test fixture',
    creator: 'OrbitPM',
    createdIso: '2026-01-01T00:00:00Z'
  })
}

/** Builds the baseline workbook with per-sheet overrides merged in. */
export function buildValidFixtureWorkbook(overrides: FixtureSheets = {}): Uint8Array {
  return buildFixtureWorkbook({ sheets: { ...baselineFixtureSheets(), ...overrides } })
}

/** A workbook shaped like the retired BPMN-oriented 0.4.5 template. */
export function buildLegacyBpmnWorkbook(): Uint8Array {
  return writeXlsx(
    [
      {
        name: 'Processes',
        rows: [
          ['process_id', 'name_en', 'name_ar'],
          ['leave', 'Leave', 'إجازة']
        ]
      },
      {
        name: 'Participants',
        rows: [
          ['process_id', 'participant_id', 'kind'],
          ['leave', 'Pool', 'pool']
        ]
      },
      {
        name: 'Steps',
        rows: [
          ['process_id', 'step_id', 'order'],
          ['leave', 'Start', 1]
        ]
      },
      {
        name: 'Flows',
        rows: [
          ['process_id', 'flow_id', 'source_step_id'],
          ['leave', 'Flow_1', 'Start']
        ]
      },
      {
        name: 'Glossary',
        rows: [
          ['english', 'arabic'],
          ['Leave', 'إجازة']
        ]
      }
    ],
    {
      customProperties: [['OrbitPMTemplateVersion', '1']],
      createdIso: '2026-01-01T00:00:00Z'
    }
  )
}

/** Builds an ARIS workbook whose worksheets are supplied as raw OOXML. */
export function buildRawWorksheetWorkbook(
  sheets: readonly XlsxWorksheetXmlInput[],
  customProperties: readonly (readonly [string, string])[] = DEFAULT_TEMPLATE_PROPERTIES
): Uint8Array {
  return writeXlsxFromWorksheetXml(sheets, {
    customProperties,
    createdIso: '2026-01-01T00:00:00Z'
  })
}

/** Serializes fixture rows for one sheet, banner row included. */
export function fixtureSheetXml(name: ArisSheetName, rows: readonly FixtureRow[]): string {
  return worksheetXmlFromRows(sheetRows(name, rows, true).rows)
}

/** Re-packs a workbook with one extra ZIP entry (macro, ActiveX, traversal…). */
export function withExtraZipEntry(bytes: Uint8Array, path: string, content: string): Uint8Array {
  const archive = unzipSync(bytes)
  const entries: ZipSource[] = Object.entries(archive).map(([entryPath, entryBytes]) => ({
    path: entryPath,
    bytes: entryBytes
  }))
  entries.push({ path, bytes: new TextEncoder().encode(content) })
  return writeDeterministicZip(entries)
}

/**
 * Rewrites the declared uncompressed size of every ZIP entry, keeping the local
 * and central headers consistent. Used to exercise the declared-uncompressed
 * (ZIP-bomb) limit without materializing 100 MiB of data.
 */
export function inflateDeclaredUncompressedSizes(zip: Uint8Array, declared: number): Uint8Array {
  const bytes = zip.slice()
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  // End of central directory is the last 22 bytes for a comment-free archive.
  const eocd = bytes.length - 22
  const entryCount = view.getUint16(eocd + 10, true)
  let cursor = view.getUint32(eocd + 16, true)
  for (let index = 0; index < entryCount; index += 1) {
    const compressionMethod = view.getUint16(cursor + 10, true)
    const fileNameLength = view.getUint16(cursor + 28, true)
    const extraLength = view.getUint16(cursor + 30, true)
    const commentLength = view.getUint16(cursor + 32, true)
    const localOffset = view.getUint32(cursor + 42, true)
    // Stored entries must keep compressed === uncompressed, so only deflated
    // entries can carry an inflated declaration.
    if (compressionMethod === 8) {
      view.setUint32(cursor + 24, declared, true)
      view.setUint32(localOffset + 22, declared, true)
    }
    cursor += 46 + fileNameLength + extraLength + commentLength
  }
  return bytes
}
