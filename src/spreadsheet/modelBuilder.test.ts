import { describe, expect, it } from 'vitest'
import { CANONICAL_FIELDS_BY_SHEET } from './aliases'
import {
  MAPPING_PRESET_VERSION,
  OFFICIAL_TEMPLATE_VERSION,
  type CanonicalSheet,
  type MappingPreset,
  type ParsedWorkbookData,
  type WorkbookCell
} from './contracts'
import { DEFAULT_LIST_DELIMITERS } from './limits'
import {
  buildProcessWorkbookModel,
  officialTemplatePreset
} from './modelBuilder'
import { detectOfficialTemplate, OFFICIAL_SHEET_NAMES } from './officialTemplate'

function cells(values: readonly unknown[]): WorkbookCell[] {
  return values.map((value) => ({ value: value as WorkbookCell['value'], rawValue: value }))
}

function objectRow(role: CanonicalSheet, values: Readonly<Record<string, unknown>>): WorkbookCell[] {
  return cells(CANONICAL_FIELDS_BY_SHEET[role].map((field) => values[field] ?? null))
}

function officialWorkbook(): ParsedWorkbookData {
  const rows: Record<CanonicalSheet, WorkbookCell[][]> = {
    processes: [
      cells(CANONICAL_FIELDS_BY_SHEET.processes),
      objectRow('processes', {
        process_id: 'leave',
        name_en: 'Leave',
        name_ar: 'الإجازة',
        folder: 'hr',
        active_language: 'ar'
      })
    ],
    participants: [
      cells(CANONICAL_FIELDS_BY_SHEET.participants),
      objectRow('participants', {
        process_id: 'leave',
        participant_id: '',
        type: 'مسار',
        order: 1,
        name_en: 'Manager',
        name_ar: 'المدير'
      })
    ],
    steps: [
      cells(CANONICAL_FIELDS_BY_SHEET.steps),
      objectRow('steps', {
        process_id: 'leave',
        step_id: '',
        order: 1,
        type: 'مهمة مستخدم',
        name_en: 'Review',
        name_ar: 'مراجعة',
        inputs_en: 'One, Inc.;Two',
        inputs_ar: 'واحد;اثنان',
        next_step_ids: 'Approve;Reject',
        raci: 'R'
      }),
      objectRow('steps', {
        process_id: 'leave',
        step_id: 'Mystery',
        order: 2,
        type: 'Made Up Type',
        name_en: 'Mystery',
        name_ar: 'غامض'
      })
    ],
    flows: [
      cells(CANONICAL_FIELDS_BY_SHEET.flows),
      objectRow('flows', {
        process_id: 'leave',
        flow_id: '',
        source_step_id: 'Approve',
        target_step_id: 'Reject',
        is_default: 'perhaps'
      })
    ],
    glossary: [
      cells(CANONICAL_FIELDS_BY_SHEET.glossary),
      objectRow('glossary', {
        english: 'API',
        arabic: 'API',
        do_not_translate: 'نعم',
        case_sensitive: 'true'
      })
    ]
  }
  return {
    customProperties: { OrbitPMTemplateVersion: OFFICIAL_TEMPLATE_VERSION },
    sheets: (Object.keys(OFFICIAL_SHEET_NAMES) as CanonicalSheet[]).map((role) => ({
      name: OFFICIAL_SHEET_NAMES[role],
      rows: rows[role]
    }))
  }
}

describe('ProcessWorkbookModel construction', () => {
  it('maps the official graph shape with provenance and no comma list splitting', () => {
    const workbook = officialWorkbook()
    const detection = detectOfficialTemplate(workbook)
    const result = buildProcessWorkbookModel(workbook, {
      fileName: 'official.xlsx',
      format: 'xlsx',
      officialTemplate: true,
      templateVersion: detection.templateVersion,
      preset: officialTemplatePreset(workbook, detection)
    })

    expect(result.model.version).toBe(1)
    expect(result.model.templateVersion).toBe(OFFICIAL_TEMPLATE_VERSION)
    expect(result.model.source.officialTemplate).toBe(true)
    expect(result.model.processes[0]).toMatchObject({
      id: 'leave',
      folder: 'hr',
      activeLanguage: 'ar'
    })
    expect(result.model.participants[0]).toMatchObject({
      id: '',
      idOrigin: 'generated',
      type: 'lane'
    })
    expect(result.model.nodes[0]).toMatchObject({
      id: '',
      idOrigin: 'generated',
      type: 'userTask',
      nextStepIds: ['Approve', 'Reject']
    })
    expect(result.model.nodes[0]!.metadata.inputs).toEqual([
      { en: 'One, Inc.', ar: 'واحد', active: 'ar' },
      { en: 'Two', ar: 'اثنان', active: 'ar' }
    ])
    expect(result.model.nodes[0]!.provenance.fields?.name_ar).toMatchObject({
      worksheet: 'Steps',
      row: 2
    })
    expect(result.model.nodes[1]).toMatchObject({
      id: 'Mystery',
      type: 'unknown',
      rawType: 'Made Up Type'
    })
    expect(result.model.glossary[0]).toMatchObject({
      doNotTranslate: true,
      caseSensitive: true
    })
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: 'invalid-boolean', rawValue: 'perhaps' })
    )
  })

  it('derives process records for an ordinary grouped single sheet', () => {
    const workbook: ParsedWorkbookData = {
      sheets: [
        {
          name: 'Activities',
          rows: [
            cells(['Workflow', 'Identifier', 'Sequence', 'Kind', 'English', 'Arabic']),
            cells(['proc_a', 'A', 1, 'task', 'First', 'الأولى']),
            cells(['proc_b', 'B', 1, 'task', 'Second', 'الثانية'])
          ]
        }
      ]
    }
    const preset: MappingPreset = {
      version: MAPPING_PRESET_VERSION,
      name: 'Ordinary',
      headerSignatures: {},
      selectedSheets: { steps: { worksheet: 'Activities', headerRow: 1 } },
      fieldMappings: {
        steps: {
          process_id: 'Workflow',
          step_id: 'Identifier',
          order: 'Sequence',
          type: 'Kind',
          name_en: 'English',
          name_ar: 'Arabic'
        }
      },
      delimiters: { list: DEFAULT_LIST_DELIMITERS },
      inference: {
        flowMode: 'auto',
        syntheticBoundaries: 'review',
        requireGatewayConditions: true
      },
      locale: 'en'
    }
    const result = buildProcessWorkbookModel(workbook, {
      fileName: 'ordinary.csv',
      format: 'csv',
      preset
    })
    expect(result.model.processes.map(({ id }) => id)).toEqual(['proc_a', 'proc_b'])
    expect(result.model.nodes.map(({ processId }) => processId)).toEqual(['proc_a', 'proc_b'])
    expect(result.model.source.worksheets[0]).toMatchObject({
      name: 'Activities',
      headerRow: 1,
      rowCount: 2,
      columnCount: 6
    })
  })
})

