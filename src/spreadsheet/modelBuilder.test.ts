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
import { buildProcessWorkbookModel, officialTemplatePreset } from './modelBuilder'
import { detectOfficialTemplate, OFFICIAL_SHEET_NAMES } from './officialTemplate'

function cells(values: readonly unknown[]): WorkbookCell[] {
  return values.map((value) => ({ value: value as WorkbookCell['value'], rawValue: value }))
}

function objectRow(
  role: CanonicalSheet,
  values: Readonly<Record<string, unknown>>
): WorkbookCell[] {
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

  it('applies reviewed raw step and participant type mappings before reporting unknowns', () => {
    const workbook = officialWorkbook()
    const participantSheet = workbook.sheets.find(({ name }) => name === 'Participants')!
    const stepSheet = workbook.sheets.find(({ name }) => name === 'Steps')!
    const participantTypeColumn = CANONICAL_FIELDS_BY_SHEET.participants.indexOf('type')
    const stepTypeColumn = CANONICAL_FIELDS_BY_SHEET.steps.indexOf('type')
    ;(participantSheet.rows[1] as WorkbookCell[])[participantTypeColumn] = {
      value: 'Department',
      rawValue: 'Department'
    }
    ;(stepSheet.rows[2] as WorkbookCell[])[stepTypeColumn] = {
      value: 'Approval',
      rawValue: 'Approval'
    }
    const detection = detectOfficialTemplate(workbook)
    const base = officialTemplatePreset(workbook, detection)
    const preset: MappingPreset = {
      ...base,
      valueMappings: {
        stepTypes: { approval: 'userTask' },
        participantTypes: { department: 'lane' }
      }
    }

    const result = buildProcessWorkbookModel(workbook, {
      fileName: 'reviewed-types.xlsx',
      format: 'xlsx',
      preset
    })

    expect(result.model.participants[0]?.type).toBe('lane')
    expect(result.model.nodes.find(({ id }) => id === 'Mystery')).toMatchObject({
      type: 'userTask'
    })
    expect(
      result.issues.some(
        ({ code }) => code === 'unknown-step-type' || code === 'unknown-participant-type'
      )
    ).toBe(false)
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
      valueMappings: { stepTypes: {}, participantTypes: {} },
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

  it('maps optional metadata, event definitions, false booleans, pools, and blank rows', () => {
    const workbook = officialWorkbook()
    const byName = new Map(workbook.sheets.map((sheet) => [sheet.name, sheet]))
    ;(byName.get('Processes')!.rows as WorkbookCell[][]).push(
      cells(CANONICAL_FIELDS_BY_SHEET.processes.map(() => null)),
      objectRow('processes', {
        process_id: 'second',
        name_en: 'Second',
        name_ar: 'الثانية',
        description_en: 'Description',
        description_ar: 'الوصف',
        owner_en: 'Owner',
        owner_ar: 'المالك',
        active_language: 'en'
      })
    )
    ;(byName.get('Participants')!.rows as WorkbookCell[][]).push(
      cells(CANONICAL_FIELDS_BY_SHEET.participants.map(() => null)),
      objectRow('participants', {
        process_id: 'leave',
        participant_id: 'Pool_1',
        type: 'حوض',
        name_en: 'Pool',
        name_ar: 'الحوض'
      }),
      objectRow('participants', {
        process_id: 'leave',
        participant_id: 'Unknown_1',
        type: 'strange',
        name_en: 'Unknown',
        name_ar: 'غير معروف'
      })
    )
    ;(byName.get('Steps')!.rows as WorkbookCell[][]).push(
      cells(CANONICAL_FIELDS_BY_SHEET.steps.map(() => null)),
      objectRow('steps', {
        process_id: 'leave',
        step_id: 'Timer_1',
        order: '3',
        type: 'intermediateCatchEvent',
        name_en: 'Wait',
        name_ar: 'انتظار',
        owner_en: 'Operations',
        owner_ar: 'العمليات',
        responsible_parties_en: 'A;B',
        responsible_parties_ar: 'أ',
        channel_en: 'Portal',
        channel_ar: 'البوابة',
        channel_detail_en: 'Web',
        channel_detail_ar: 'ويب',
        outputs_en: 'Result',
        outputs_ar: 'نتيجة',
        cc_en: 'Audit',
        cc_ar: 'التدقيق',
        decision_basis_en: 'SLA',
        decision_basis_ar: 'اتفاقية',
        triggers_en: 'Timer',
        triggers_ar: 'مؤقت',
        event_definition: 'مؤقت',
        notes_en: 'Note',
        notes_ar: 'ملاحظة'
      })
    )
    ;(byName.get('Flows')!.rows as WorkbookCell[][]).push(
      cells(CANONICAL_FIELDS_BY_SHEET.flows.map(() => null)),
      objectRow('flows', {
        process_id: 'leave',
        flow_id: 'Flow_false',
        source_step_id: 'Mystery',
        target_step_id: 'Timer_1',
        condition_en: 'Continue',
        condition_ar: 'متابعة',
        is_default: 'لا'
      })
    )
    ;(byName.get('Glossary')!.rows as WorkbookCell[][]).push(
      cells(CANONICAL_FIELDS_BY_SHEET.glossary.map(() => null)),
      objectRow('glossary', {
        english: 'SLA',
        arabic: 'اتفاقية مستوى الخدمة',
        do_not_translate: 'false',
        case_sensitive: 'no'
      })
    )

    const detection = detectOfficialTemplate(workbook)
    const result = buildProcessWorkbookModel(workbook, {
      fileName: 'branches.xlsx',
      format: 'xlsx',
      preset: officialTemplatePreset(workbook, detection)
    })
    const timer = result.model.nodes.find(({ id }) => id === 'Timer_1')!
    expect(result.model.processes.find(({ id }) => id === 'second')).toMatchObject({
      activeLanguage: 'en',
      description: { en: 'Description', ar: 'الوصف' }
    })
    expect(result.model.participants.map(({ type }) => type)).toContain('pool')
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: 'unknown-participant-type' })
    )
    expect(timer).toMatchObject({
      type: 'intermediateCatchEvent',
      metadata: {
        eventDefinition: 'timer',
        responsibleParties: [
          { en: 'A', ar: 'أ', active: 'ar' },
          { en: 'B', active: 'ar' }
        ]
      }
    })
    expect(result.model.flows.find(({ id }) => id === 'Flow_false')).toMatchObject({
      isDefault: false
    })
    expect(result.model.glossary.at(-1)).toMatchObject({
      doNotTranslate: false,
      caseSensitive: false
    })
    expect(result.skippedRows.length).toBeGreaterThanOrEqual(5)
  })

  it('uses an explicit default process for an ungrouped ordinary sheet', () => {
    const workbook: ParsedWorkbookData = {
      sheets: [
        {
          name: 'One',
          rows: [
            cells(['Kind', 'English', 'Arabic']),
            cells(['startEvent', 'Start', 'البداية']),
            cells(['endEvent', 'End', 'النهاية'])
          ]
        }
      ]
    }
    const preset: MappingPreset = {
      version: MAPPING_PRESET_VERSION,
      name: 'Ungrouped',
      headerSignatures: {},
      selectedSheets: { steps: { worksheet: 'One', headerRow: 1 } },
      fieldMappings: {
        steps: {
          type: 'Kind',
          name_en: 'English',
          name_ar: 'Arabic'
        }
      },
      valueMappings: { stepTypes: {}, participantTypes: {} },
      delimiters: { list: [';'] },
      inference: {
        flowMode: 'numeric-order',
        syntheticBoundaries: 'never',
        requireGatewayConditions: true
      },
      locale: 'ar'
    }
    const result = buildProcessWorkbookModel(workbook, {
      fileName: 'one.csv',
      format: 'csv',
      preset,
      defaultProcessId: 'default_process',
      defaultProcessName: {
        en: 'Default process',
        ar: 'العملية الافتراضية',
        active: 'ar'
      }
    })
    expect(result.model.processes).toEqual([
      expect.objectContaining({
        id: 'default_process',
        name: {
          en: 'Default process',
          ar: 'العملية الافتراضية',
          active: 'ar'
        }
      })
    ])
    expect(result.model.nodes.every(({ processId }) => processId === 'default_process')).toBe(true)
  })

  it('reports absent sheets, header rows, missing headers, and duplicate headers', () => {
    const base: MappingPreset = {
      version: MAPPING_PRESET_VERSION,
      name: 'Bad mapping',
      headerSignatures: {},
      selectedSheets: { steps: { worksheet: 'Missing', headerRow: 1 } },
      fieldMappings: { steps: { type: 'Type' } },
      valueMappings: { stepTypes: {}, participantTypes: {} },
      delimiters: { list: [';'] },
      inference: {
        flowMode: 'auto',
        syntheticBoundaries: 'review',
        requireGatewayConditions: true
      },
      locale: 'en'
    }
    expect(
      buildProcessWorkbookModel(
        { sheets: [] },
        {
          fileName: 'bad.csv',
          format: 'csv',
          preset: base
        }
      ).issues
    ).toContainEqual(expect.objectContaining({ code: 'mapped-sheet-missing' }))

    const workbook: ParsedWorkbookData = {
      sheets: [
        {
          name: 'Data',
          rows: [cells(['Type', 'Type', 'English'])]
        }
      ]
    }
    const missingRow = buildProcessWorkbookModel(workbook, {
      fileName: 'bad.csv',
      format: 'csv',
      preset: {
        ...base,
        selectedSheets: { steps: { worksheet: 'Data', headerRow: 9 } }
      }
    })
    expect(missingRow.issues).toContainEqual(
      expect.objectContaining({ code: 'mapped-header-row-missing' })
    )

    const badHeaders = buildProcessWorkbookModel(workbook, {
      fileName: 'bad.csv',
      format: 'csv',
      preset: {
        ...base,
        selectedSheets: { steps: { worksheet: 'Data', headerRow: 1 } },
        fieldMappings: {
          steps: { type: 'Type', name_ar: 'Does not exist' }
        }
      }
    })
    expect(badHeaders.issues.map(({ code }) => code)).toEqual(
      expect.arrayContaining(['mapped-header-duplicate', 'mapped-header-missing'])
    )

    expect(() =>
      buildProcessWorkbookModel(workbook, {
        fileName: 'bad.csv',
        format: 'csv',
        preset: { ...base, version: 99 as never }
      })
    ).toThrow(TypeError)
  })
})
