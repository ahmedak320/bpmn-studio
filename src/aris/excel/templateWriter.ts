import {
  ARIS_SHEET_SPECS,
  ARIS_TEMPLATE_IDENTITY,
  ARIS_TEMPLATE_IDENTITY_PROPERTY,
  ARIS_TEMPLATE_KIND_PROPERTY,
  ARIS_TEMPLATE_PROPERTY,
  ARIS_TEMPLATE_VERSION,
  type ArisSheetName,
  type ArisSheetSpec
} from './templateSchema'
import { writeXlsx, type XlsxCellValue, type XlsxSheetInput } from './xlsxWriter'

/**
 * Deterministic generation of the official ARIS workbook templates (§15.1).
 *
 * Two artifacts are produced entirely from code:
 * - `blank`: the nine sheets with their header rows only.
 * - `example`: the same sheets populated with a small bilingual EPC, a value
 *   added chain, lanes, free text, styles, attributes, and multi-model
 *   assignments.
 *
 * Both embed `OrbitPMArisTemplateVersion=1` twice: as custom document
 * properties (machine-readable, survives editing) and as a visible banner in
 * cell A1 of every sheet (human-readable, survives "save as").
 */

export type ArisTemplateKind = 'blank' | 'example'

export const ARIS_TEMPLATE_ASSET_NAMES = Object.freeze({
  blank: `OrbitPM-ARIS-Template-${ARIS_TEMPLATE_VERSION}.xlsx`,
  example: `OrbitPM-ARIS-Example-${ARIS_TEMPLATE_VERSION}.xlsx`
} satisfies Readonly<Record<ArisTemplateKind, string>>)

/** Row index (1-based) of the identity banner in a generated template. */
export const ARIS_TEMPLATE_BANNER_ROW = 1

/** Row index (1-based) of the header row in a generated template. */
export const ARIS_TEMPLATE_HEADER_ROW = 2

type ExampleRow = Readonly<Record<string, XlsxCellValue>>

const EXAMPLE_ROWS: Readonly<Record<ArisSheetName, readonly ExampleRow[]>> = Object.freeze({
  Models: Object.freeze([
    Object.freeze({
      model_id: 'MDL_LEAVE',
      model_type: 'MT_EEPC',
      name_en: 'Leave approval',
      name_ar: 'الموافقة على الإجازة',
      process_code: 'HR-001',
      description_en: 'Review and decide an employee leave request.',
      description_ar: 'مراجعة طلب إجازة الموظف واتخاذ القرار.',
      orientation: 'horizontal'
    }),
    Object.freeze({
      model_id: 'MDL_CHAIN',
      model_type: 'MT_VAL_ADD_CHN_DGM',
      name_en: 'Human resources value chain',
      name_ar: 'سلسلة القيمة للموارد البشرية',
      process_code: 'HR-000',
      description_en: 'Top level human resources value chain.',
      description_ar: 'سلسلة القيمة للموارد البشرية على المستوى الأعلى.',
      orientation: 'horizontal'
    }),
    Object.freeze({
      model_id: 'MDL_DETAIL',
      model_type: 'MT_EEPC',
      name_en: 'Leave entitlement check',
      name_ar: 'التحقق من استحقاق الإجازة',
      process_code: 'HR-002',
      description_en: 'Detailed entitlement verification.',
      description_ar: 'التحقق التفصيلي من الاستحقاق.',
      orientation: 'horizontal'
    })
  ]),
  Objects: Object.freeze([
    Object.freeze({
      model_id: 'MDL_LEAVE',
      object_id: 'OBJ_EVT_SUBMITTED',
      occurrence_id: 'OCC_EVT_SUBMITTED',
      object_type: 'OT_EVT',
      symbol_type: 'ST_EV',
      name_en: 'Leave request submitted',
      name_ar: 'تم تقديم طلب الإجازة',
      lane_id: 'LANE_EMPLOYEE',
      order: 1,
      x: 120,
      y: 80,
      width: 160,
      height: 60,
      assigned_model_id: '',
      style_id: 'STY_EVENT'
    }),
    Object.freeze({
      model_id: 'MDL_LEAVE',
      object_id: 'OBJ_FUNC_REVIEW',
      occurrence_id: 'OCC_FUNC_REVIEW',
      object_type: 'OT_FUNC',
      symbol_type: 'ST_FUNC',
      name_en: 'Review leave request',
      name_ar: 'مراجعة طلب الإجازة',
      lane_id: 'LANE_MANAGER',
      order: 2,
      x: 120,
      y: 200,
      width: 160,
      height: 60,
      assigned_model_id: 'MDL_DETAIL',
      style_id: 'STY_FUNCTION'
    }),
    Object.freeze({
      model_id: 'MDL_LEAVE',
      object_id: 'OBJ_RULE_DECISION',
      occurrence_id: 'OCC_RULE_DECISION',
      object_type: 'OT_RULE',
      symbol_type: 'ST_OPR_XOR_1',
      name_en: 'Request approved?',
      name_ar: 'هل تمت الموافقة على الطلب؟',
      lane_id: 'LANE_MANAGER',
      order: 3,
      x: 170,
      y: 320,
      width: 60,
      height: 60,
      assigned_model_id: '',
      style_id: ''
    }),
    Object.freeze({
      model_id: 'MDL_LEAVE',
      object_id: 'OBJ_EVT_APPROVED',
      occurrence_id: 'OCC_EVT_APPROVED',
      object_type: 'OT_EVT',
      symbol_type: 'ST_EV',
      name_en: 'Leave request approved',
      name_ar: 'تمت الموافقة على طلب الإجازة',
      lane_id: 'LANE_MANAGER',
      order: 4,
      x: 20,
      y: 440,
      width: 160,
      height: 60,
      assigned_model_id: '',
      style_id: 'STY_EVENT'
    }),
    Object.freeze({
      model_id: 'MDL_LEAVE',
      object_id: 'OBJ_EVT_REJECTED',
      occurrence_id: 'OCC_EVT_REJECTED',
      object_type: 'OT_EVT',
      symbol_type: 'ST_EV',
      name_en: 'Leave request rejected',
      name_ar: 'تم رفض طلب الإجازة',
      lane_id: 'LANE_MANAGER',
      order: 5,
      x: 240,
      y: 440,
      width: 160,
      height: 60,
      assigned_model_id: '',
      style_id: 'STY_EVENT'
    }),
    Object.freeze({
      model_id: 'MDL_LEAVE',
      object_id: 'OBJ_PERS_MANAGER',
      occurrence_id: 'OCC_PERS_MANAGER',
      object_type: 'OT_PERS_TYPE',
      symbol_type: 'ST_PERS_TYPE',
      name_en: 'Line manager',
      name_ar: 'المدير المباشر',
      lane_id: 'LANE_MANAGER',
      order: 6,
      x: 340,
      y: 200,
      width: 140,
      height: 60,
      assigned_model_id: '',
      style_id: ''
    }),
    Object.freeze({
      model_id: 'MDL_CHAIN',
      object_id: 'OBJ_FUNC_RECRUIT',
      occurrence_id: 'OCC_FUNC_RECRUIT',
      object_type: 'OT_FUNC',
      symbol_type: 'ST_VAL_ADD_CHN',
      name_en: 'Recruit employees',
      name_ar: 'توظيف الموظفين',
      lane_id: '',
      order: 1,
      x: 60,
      y: 60,
      width: 200,
      height: 80,
      assigned_model_id: '',
      style_id: ''
    }),
    Object.freeze({
      model_id: 'MDL_CHAIN',
      object_id: 'OBJ_FUNC_ADMINISTER',
      occurrence_id: 'OCC_FUNC_ADMINISTER',
      object_type: 'OT_FUNC',
      symbol_type: 'ST_VAL_ADD_CHN',
      name_en: 'Administer leave',
      name_ar: 'إدارة الإجازات',
      lane_id: '',
      order: 2,
      x: 300,
      y: 60,
      width: 200,
      height: 80,
      assigned_model_id: 'MDL_LEAVE',
      style_id: ''
    }),
    Object.freeze({
      model_id: 'MDL_DETAIL',
      object_id: 'OBJ_EVT_CHECK_STARTED',
      occurrence_id: 'OCC_EVT_CHECK_STARTED',
      object_type: 'OT_EVT',
      symbol_type: 'ST_EV',
      name_en: 'Entitlement check started',
      name_ar: 'بدأ التحقق من الاستحقاق',
      lane_id: '',
      order: 1,
      x: 120,
      y: 80,
      width: 160,
      height: 60,
      assigned_model_id: '',
      style_id: ''
    }),
    Object.freeze({
      model_id: 'MDL_DETAIL',
      object_id: 'OBJ_FUNC_CHECK',
      occurrence_id: 'OCC_FUNC_CHECK',
      object_type: 'OT_FUNC',
      symbol_type: 'ST_FUNC',
      name_en: 'Check leave balance',
      name_ar: 'التحقق من رصيد الإجازات',
      lane_id: '',
      order: 2,
      x: 120,
      y: 200,
      width: 160,
      height: 60,
      assigned_model_id: '',
      style_id: ''
    }),
    Object.freeze({
      model_id: 'MDL_DETAIL',
      object_id: 'OBJ_EVT_CHECK_DONE',
      occurrence_id: 'OCC_EVT_CHECK_DONE',
      object_type: 'OT_EVT',
      symbol_type: 'ST_EV',
      name_en: 'Entitlement check completed',
      name_ar: 'اكتمل التحقق من الاستحقاق',
      lane_id: '',
      order: 3,
      x: 120,
      y: 320,
      width: 160,
      height: 60,
      assigned_model_id: '',
      style_id: ''
    })
  ]),
  Connections: Object.freeze([
    Object.freeze({
      model_id: 'MDL_LEAVE',
      connection_id: 'CXN_SUBMITTED_REVIEW',
      source_occurrence_id: 'OCC_EVT_SUBMITTED',
      target_occurrence_id: 'OCC_FUNC_REVIEW',
      connection_type: 'CT_ACT_1',
      name_en: '',
      name_ar: '',
      route_points: '200:140|200:200',
      style_id: ''
    }),
    Object.freeze({
      model_id: 'MDL_LEAVE',
      connection_id: 'CXN_REVIEW_RULE',
      source_occurrence_id: 'OCC_FUNC_REVIEW',
      target_occurrence_id: 'OCC_RULE_DECISION',
      connection_type: 'CT_CRT_1',
      name_en: '',
      name_ar: '',
      route_points: '',
      style_id: ''
    }),
    Object.freeze({
      model_id: 'MDL_LEAVE',
      connection_id: 'CXN_RULE_APPROVED',
      source_occurrence_id: 'OCC_RULE_DECISION',
      target_occurrence_id: 'OCC_EVT_APPROVED',
      connection_type: 'CT_CRT_1',
      name_en: 'Approved',
      name_ar: 'تمت الموافقة',
      route_points: '200:380|100:410|100:440',
      style_id: 'STY_FLOW'
    }),
    Object.freeze({
      model_id: 'MDL_LEAVE',
      connection_id: 'CXN_RULE_REJECTED',
      source_occurrence_id: 'OCC_RULE_DECISION',
      target_occurrence_id: 'OCC_EVT_REJECTED',
      connection_type: 'CT_CRT_1',
      name_en: 'Rejected',
      name_ar: 'تم الرفض',
      route_points: '200:380|320:410|320:440',
      style_id: 'STY_FLOW'
    }),
    Object.freeze({
      model_id: 'MDL_LEAVE',
      connection_id: 'CXN_MANAGER_REVIEW',
      source_occurrence_id: 'OCC_PERS_MANAGER',
      target_occurrence_id: 'OCC_FUNC_REVIEW',
      connection_type: 'CT_EXEC_2',
      name_en: '',
      name_ar: '',
      route_points: '',
      style_id: ''
    }),
    Object.freeze({
      model_id: 'MDL_CHAIN',
      connection_id: 'CXN_CHAIN_SEQUENCE',
      source_occurrence_id: 'OCC_FUNC_RECRUIT',
      target_occurrence_id: 'OCC_FUNC_ADMINISTER',
      connection_type: 'CT_IS_PREDEC_OF_1',
      name_en: '',
      name_ar: '',
      route_points: '',
      style_id: ''
    }),
    Object.freeze({
      model_id: 'MDL_DETAIL',
      connection_id: 'CXN_DETAIL_START',
      source_occurrence_id: 'OCC_EVT_CHECK_STARTED',
      target_occurrence_id: 'OCC_FUNC_CHECK',
      connection_type: 'CT_ACT_1',
      name_en: '',
      name_ar: '',
      route_points: '',
      style_id: ''
    }),
    Object.freeze({
      model_id: 'MDL_DETAIL',
      connection_id: 'CXN_DETAIL_END',
      source_occurrence_id: 'OCC_FUNC_CHECK',
      target_occurrence_id: 'OCC_EVT_CHECK_DONE',
      connection_type: 'CT_CRT_1',
      name_en: '',
      name_ar: '',
      route_points: '',
      style_id: ''
    })
  ]),
  Attributes: Object.freeze([
    Object.freeze({
      owner_kind: 'model',
      owner_id: 'MDL_LEAVE',
      attribute_type: 'AT_DESC',
      language: 'en',
      value: 'Approve or reject an employee leave request within two working days.',
      value_type: 'text',
      sequence: 1
    }),
    Object.freeze({
      owner_kind: 'model',
      owner_id: 'MDL_LEAVE',
      attribute_type: 'AT_DESC',
      language: 'ar',
      value: 'الموافقة على طلب إجازة الموظف أو رفضه خلال يومي عمل.',
      value_type: 'text',
      sequence: 2
    }),
    Object.freeze({
      owner_kind: 'object',
      owner_id: 'OBJ_FUNC_REVIEW',
      attribute_type: 'AT_REM',
      language: 'en',
      value: 'Check entitlement and operational coverage.',
      value_type: 'text',
      sequence: 1
    }),
    Object.freeze({
      owner_kind: 'object',
      owner_id: 'OBJ_FUNC_REVIEW',
      attribute_type: 'AT_REM',
      language: 'ar',
      value: 'التحقق من الاستحقاق والتغطية التشغيلية.',
      value_type: 'text',
      sequence: 2
    }),
    Object.freeze({
      owner_kind: 'occurrence',
      owner_id: 'OCC_RULE_DECISION',
      attribute_type: 'AT_REM',
      language: 'en',
      value: 'Exclusive decision, exactly one branch is taken.',
      value_type: 'text',
      sequence: 1
    }),
    Object.freeze({
      owner_kind: 'connection',
      owner_id: 'CXN_RULE_APPROVED',
      attribute_type: 'AT_NAME',
      language: 'en',
      value: 'Approved',
      value_type: 'text',
      sequence: 1
    }),
    Object.freeze({
      owner_kind: 'lane',
      owner_id: 'LANE_MANAGER',
      attribute_type: 'AT_REM',
      language: 'ar',
      value: 'مسؤولية المدير المباشر.',
      value_type: 'text',
      sequence: 1
    }),
    Object.freeze({
      owner_kind: 'free_text',
      owner_id: 'TXT_SLA',
      attribute_type: 'AT_REM',
      language: 'en',
      value: 'Service level agreement note.',
      value_type: 'text',
      sequence: 1
    })
  ]),
  Assignments: Object.freeze([
    Object.freeze({
      source_object_id: 'OBJ_FUNC_REVIEW',
      target_model_id: 'MDL_DETAIL',
      assignment_type: 'detail'
    }),
    Object.freeze({
      source_object_id: 'OBJ_FUNC_REVIEW',
      target_model_id: 'MDL_CHAIN',
      assignment_type: 'model'
    }),
    Object.freeze({
      source_object_id: 'OBJ_FUNC_ADMINISTER',
      target_model_id: 'MDL_LEAVE',
      assignment_type: 'detail'
    })
  ]),
  Lanes: Object.freeze([
    Object.freeze({
      model_id: 'MDL_LEAVE',
      lane_id: 'LANE_EMPLOYEE',
      name_en: 'Employee',
      name_ar: 'الموظف',
      x: 0,
      y: 40,
      width: 520,
      height: 140,
      orientation: 'horizontal'
    }),
    Object.freeze({
      model_id: 'MDL_LEAVE',
      lane_id: 'LANE_MANAGER',
      name_en: 'Line manager',
      name_ar: 'المدير المباشر',
      x: 0,
      y: 180,
      width: 520,
      height: 360,
      orientation: 'horizontal'
    })
  ]),
  FreeText: Object.freeze([
    Object.freeze({
      model_id: 'MDL_LEAVE',
      text_id: 'TXT_SLA',
      text_en: 'Decision due within two working days.',
      text_ar: 'يجب اتخاذ القرار خلال يومي عمل.',
      x: 540,
      y: 80,
      width: 220,
      height: 60,
      style_id: 'STY_NOTE'
    })
  ]),
  Styles: Object.freeze([
    Object.freeze({
      style_id: 'STY_EVENT',
      fill_color: '#FFE8B0',
      stroke_color: '#B08A2E',
      stroke_width: 1,
      line_style: 'solid',
      font_family: 'Arial',
      font_size: 10,
      font_weight: 'normal',
      text_color: '#2B2B2B',
      z_order: 1
    }),
    Object.freeze({
      style_id: 'STY_FUNCTION',
      fill_color: '#CFE3F7',
      stroke_color: '#2E6DA4',
      stroke_width: 1,
      line_style: 'solid',
      font_family: 'Arial',
      font_size: 10,
      font_weight: 'bold',
      text_color: '#1B1B1B',
      z_order: 2
    }),
    Object.freeze({
      style_id: 'STY_FLOW',
      fill_color: '',
      stroke_color: '#4A4A4A',
      stroke_width: 1,
      line_style: 'solid',
      font_family: 'Arial',
      font_size: 9,
      font_weight: 'normal',
      text_color: '#4A4A4A',
      z_order: 3
    }),
    Object.freeze({
      style_id: 'STY_NOTE',
      fill_color: '#FFFFFF',
      stroke_color: '#9A9A9A',
      stroke_width: 1,
      line_style: 'dashed',
      font_family: 'Arial',
      font_size: 9,
      font_weight: 'normal',
      text_color: '#4A4A4A',
      z_order: 4
    })
  ]),
  Glossary: Object.freeze([
    Object.freeze({
      english: 'Leave request',
      arabic: 'طلب إجازة',
      do_not_translate: false,
      case_sensitive: false
    }),
    Object.freeze({
      english: 'SLA',
      arabic: 'SLA',
      do_not_translate: true,
      case_sensitive: true
    }),
    Object.freeze({
      english: 'DMT HUB',
      arabic: 'DMT HUB',
      do_not_translate: true,
      case_sensitive: false
    })
  ])
})

function bannerRow(): readonly XlsxCellValue[] {
  return Object.freeze([ARIS_TEMPLATE_IDENTITY])
}

function headerRow(spec: ArisSheetSpec): readonly XlsxCellValue[] {
  return Object.freeze(spec.columns.map((column) => column.name))
}

function dataRow(spec: ArisSheetSpec, row: ExampleRow): readonly XlsxCellValue[] {
  return Object.freeze(spec.columns.map((column) => row[column.name] ?? ''))
}

function templateSheets(kind: ArisTemplateKind): readonly XlsxSheetInput[] {
  return Object.freeze(
    ARIS_SHEET_SPECS.map((spec) =>
      Object.freeze({
        name: spec.name,
        rows: Object.freeze([
          bannerRow(),
          headerRow(spec),
          ...(kind === 'example' ? EXAMPLE_ROWS[spec.name].map((row) => dataRow(spec, row)) : [])
        ])
      })
    )
  )
}

/** Builds one official template as real `.xlsx` bytes. Deterministic. */
export function createArisTemplateWorkbook(kind: ArisTemplateKind): Uint8Array {
  return writeXlsx(templateSheets(kind), {
    customProperties: [
      [ARIS_TEMPLATE_PROPERTY, ARIS_TEMPLATE_VERSION],
      [ARIS_TEMPLATE_IDENTITY_PROPERTY, ARIS_TEMPLATE_IDENTITY],
      [ARIS_TEMPLATE_KIND_PROPERTY, kind]
    ],
    application: 'OrbitPM ARIS Studio Lite',
    creator: 'OrbitPM',
    createdIso: '2026-01-01T00:00:00Z'
  })
}

export interface ArisTemplateAsset {
  readonly kind: ArisTemplateKind
  readonly fileName: string
  readonly bytes: Uint8Array
}

/** Builds both downloadable official templates. Deterministic. */
export function createArisTemplateWorkbooks(): Readonly<
  Record<ArisTemplateKind, ArisTemplateAsset>
> {
  return Object.freeze({
    blank: Object.freeze({
      kind: 'blank',
      fileName: ARIS_TEMPLATE_ASSET_NAMES.blank,
      bytes: createArisTemplateWorkbook('blank')
    }),
    example: Object.freeze({
      kind: 'example',
      fileName: ARIS_TEMPLATE_ASSET_NAMES.example,
      bytes: createArisTemplateWorkbook('example')
    })
  })
}
