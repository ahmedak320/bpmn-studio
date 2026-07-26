import {
  PROCESS_WORKBOOK_MODEL_VERSION,
  type BilingualValue,
  type ProcessWorkbookModel,
  type RecordProvenance,
  type WorkbookFlow,
  type WorkbookNode,
  type WorkbookParticipant,
  type WorkbookProcess
} from './contracts'

export function provenance(
  worksheet: string,
  row: number,
  fields: readonly string[] = []
): RecordProvenance {
  return {
    worksheet,
    row,
    fields: Object.fromEntries(
      fields.map((field, index) => [
        field,
        {
          worksheet,
          row,
          column: index + 1,
          address: `${String.fromCharCode(65 + index)}${row}`,
          displayedValue: ''
        }
      ])
    )
  }
}

export function bilingual(en: string, ar: string, active: 'en' | 'ar' = 'en'): BilingualValue {
  return { en, ar, active }
}

export function validProcess(overrides: Partial<WorkbookProcess> = {}): WorkbookProcess {
  return {
    id: 'leave_approval',
    idOrigin: 'explicit',
    name: bilingual('Leave approval', 'الموافقة على الإجازة'),
    activeLanguage: 'en',
    provenance: provenance('Processes', 2, ['process_id', 'name_en', 'name_ar']),
    ...overrides
  }
}

export function validNodes(): WorkbookNode[] {
  return [
    {
      processId: 'leave_approval',
      id: 'Start_1',
      idOrigin: 'explicit',
      order: 1,
      type: 'startEvent',
      name: bilingual('Start', 'البداية'),
      metadata: {},
      provenance: provenance('Steps', 2, ['process_id', 'step_id', 'order', 'type'])
    },
    {
      processId: 'leave_approval',
      id: 'Task_1',
      idOrigin: 'explicit',
      order: 2,
      type: 'userTask',
      name: bilingual('Review', 'مراجعة'),
      metadata: {},
      provenance: provenance('Steps', 3, ['process_id', 'step_id', 'order', 'type'])
    },
    {
      processId: 'leave_approval',
      id: 'End_1',
      idOrigin: 'explicit',
      order: 3,
      type: 'endEvent',
      name: bilingual('End', 'النهاية'),
      metadata: {},
      provenance: provenance('Steps', 4, ['process_id', 'step_id', 'order', 'type'])
    }
  ]
}

export function validFlows(): WorkbookFlow[] {
  return [
    {
      processId: 'leave_approval',
      id: 'Flow_1',
      idOrigin: 'explicit',
      sourceStepId: 'Start_1',
      targetStepId: 'Task_1',
      isDefault: false,
      origin: 'explicit',
      provenance: provenance('Flows', 2, [
        'process_id',
        'flow_id',
        'source_step_id',
        'target_step_id'
      ])
    },
    {
      processId: 'leave_approval',
      id: 'Flow_2',
      idOrigin: 'explicit',
      sourceStepId: 'Task_1',
      targetStepId: 'End_1',
      isDefault: false,
      origin: 'explicit',
      provenance: provenance('Flows', 3, [
        'process_id',
        'flow_id',
        'source_step_id',
        'target_step_id'
      ])
    }
  ]
}

export function validParticipants(): WorkbookParticipant[] {
  return [
    {
      processId: 'leave_approval',
      id: 'Pool_1',
      idOrigin: 'explicit',
      type: 'pool',
      order: 1,
      name: bilingual('Leave approval', 'الموافقة على الإجازة'),
      provenance: provenance('Participants', 2, ['process_id', 'participant_id', 'type'])
    },
    {
      processId: 'leave_approval',
      id: 'Lane_1',
      idOrigin: 'explicit',
      type: 'lane',
      parentId: 'Pool_1',
      order: 1,
      name: bilingual('Manager', 'المدير'),
      provenance: provenance('Participants', 3, [
        'process_id',
        'participant_id',
        'type',
        'parent_id'
      ])
    }
  ]
}

export function validModel(overrides: Partial<ProcessWorkbookModel> = {}): ProcessWorkbookModel {
  return {
    version: PROCESS_WORKBOOK_MODEL_VERSION,
    source: {
      fileName: 'processes.xlsx',
      format: 'xlsx',
      officialTemplate: true,
      worksheets: []
    },
    processes: [validProcess()],
    participants: validParticipants(),
    nodes: validNodes(),
    flows: validFlows(),
    glossary: [],
    ...overrides
  }
}
