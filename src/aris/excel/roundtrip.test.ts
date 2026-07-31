import { describe, expect, it } from 'vitest'

import { localeLang } from '../../library/amlParse'
import { buildFromSource } from '../model/buildFromSource'
import type { ArisAttribute, ArisLocalizedValue, ArisWorkingDocument } from '../model/types'
import { buildAmlFromArisWorkbook } from '../shell/arisExcelCreate'
import { createArisXmlSourcePackage } from '../source/sourcePackage'
import { buildFixtureWorkbook, type FixtureSheets } from './testFixtures'
import { ARIS_TEMPLATE_ASSET_NAMES, createArisTemplateWorkbook } from './templateWriter'
import {
  isAcceptedArisWorkbook,
  type ArisSourcedValue,
  type ArisWorkbookModel,
  type ArisWorkbookParseResult
} from './workbookModel'
import { parseArisWorkbook } from './workbookParser'

/**
 * Deterministic Excel round trip (Wave 7, test sequence 3) — no AI anywhere:
 *
 *   author a process → write it as a template `.xlsx` → run the create-from-Excel
 *   feature → assert the created process is the SAME process that was authored.
 *
 * The create-from-Excel feature under test is exactly the path
 * `ArisGenerationPanel` mounts: `parseArisWorkbook` (§15.3 steps 1-8) followed by
 * `buildAmlFromArisWorkbook` (§15.3 steps 9-11). "Same exact process" is checked
 * twice, at both ends of that pipeline:
 *
 * 1. Workbook seam — the authored rows survive the `.xlsx` write/read cycle
 *    value-for-value across all nine template sheets (`projectWorkbookModel`
 *    against a fully explicit golden).
 * 2. AML seam — the generated AML re-imports through the real source layer
 *    (`createArisXmlSourcePackage` + `buildFromSource`, what the canvas consumes)
 *    and reproduces the authored model types, object types, names, connections,
 *    RACI links, numbering, geometry and routes.
 *
 * Seam scope, deliberately: `buildAmlFromArisWorkbook` consumes the Models,
 * Objects, Connections and Attributes sheets (the last for `model`/`object`
 * owners). Lanes, free text, styles, assignments and the glossary are
 * create-time inputs for later lanes (layout, styling), so they are pinned at
 * the workbook seam in suite 1 and are not part of the AML assertions.
 *
 * KNOWN GAP (documented, not fixed here — the owning module `src/aris/shell/
 * arisExcelCreate.ts` is outside this lane's edit surface): the AML builder
 * emits each `<CxnDef>` as a flat `<Group>` child, while real ARIS AML nests it
 * inside its source `<ObjDef>` — the shape the writer's own canonical child
 * order defines (`ObjDef: [..., 'CxnDef']`). The source layer resolves a
 * connection definition's source object from that ancestry
 * (`semanticIndex.ts` `nearestAncestor(context, ['ObjDef'])`), so a re-imported
 * `ArisConnectionDefinition.fromObjectDefinitionId` comes back empty. The
 * connection's endpoints are still fully preserved at the occurrence level
 * (nesting plus `ToObjOcc.IdRef`) and its target definition via
 * `ToObjDef.IdRef`, which is what the assertions below cover; the from-side
 * definition link is the shell lane's to repair.
 */

// --- the authored canonical DMT process ---------------------------------------

/**
 * One bilingual EPC ("Permit issuance") with functions, events, an XOR rule, a
 * person-type role wired with RACI connection types, an application system, and
 * a detail model assignment — rows in all nine sheets. Connection-type
 * spellings are grounded in the AnimalWF census (`src/aris/epc/constants.ts`):
 * CT_ACTIV_1/CT_CRT_1/CT_LEADS_TO_1 for control flow, CT_EXEC_2 and
 * CT_MUST_BE_CONSLT_ABT_1 for RACI, CT_SUPP_3 for the application system.
 */
const CANONICAL_SHEETS: FixtureSheets = {
  Models: [
    {
      model_id: 'MDL_PERMIT',
      model_type: 'MT_EEPC',
      name_en: 'Permit issuance',
      name_ar: 'إصدار التصريح',
      process_code: 'DMT-100',
      description_en: 'Issue a commercial permit after document review and site inspection.',
      description_ar: 'إصدار تصريح تجاري بعد مراجعة الوثائق وتفتيش الموقع.',
      orientation: 'horizontal'
    },
    {
      model_id: 'MDL_INSPECTION',
      model_type: 'MT_EEPC',
      name_en: 'Site inspection',
      name_ar: 'التفتيش على الموقع',
      process_code: 'DMT-110',
      description_en: 'Detailed site inspection sub-process.',
      description_ar: 'العملية التفصيلية لتفتيش الموقع.',
      orientation: 'horizontal'
    }
  ],
  Objects: [
    {
      model_id: 'MDL_PERMIT',
      object_id: 'OBJ_EVT_APPLIED',
      occurrence_id: 'OCC_EVT_APPLIED',
      object_type: 'OT_EVT',
      symbol_type: 'ST_EV',
      name_en: 'Permit application submitted',
      name_ar: 'تم تقديم طلب التصريح',
      lane_id: 'LANE_CUSTOMER',
      order: 1,
      x: 100,
      y: 80,
      width: 160,
      height: 60,
      style_id: 'STY_EVENT'
    },
    {
      model_id: 'MDL_PERMIT',
      object_id: 'OBJ_FUNC_REVIEW',
      occurrence_id: 'OCC_FUNC_REVIEW',
      object_type: 'OT_FUNC',
      symbol_type: 'ST_FUNC',
      name_en: 'Review permit application',
      name_ar: 'مراجعة طلب التصريح',
      lane_id: 'LANE_PERMITS',
      order: 2,
      x: 100,
      y: 220,
      width: 160,
      height: 60,
      assigned_model_id: 'MDL_INSPECTION',
      style_id: 'STY_FUNCTION'
    },
    {
      model_id: 'MDL_PERMIT',
      object_id: 'OBJ_RULE_DOCS',
      occurrence_id: 'OCC_RULE_DOCS',
      object_type: 'OT_RULE',
      symbol_type: 'ST_OPR_XOR_1',
      name_en: 'Documentation complete?',
      name_ar: 'هل اكتملت الوثائق؟',
      lane_id: 'LANE_PERMITS',
      order: 3,
      x: 130,
      y: 360,
      width: 60,
      height: 60
    },
    {
      model_id: 'MDL_PERMIT',
      object_id: 'OBJ_FUNC_INSPECT',
      occurrence_id: 'OCC_FUNC_INSPECT',
      object_type: 'OT_FUNC',
      symbol_type: 'ST_FUNC',
      name_en: 'Inspect site',
      name_ar: 'تفتيش الموقع',
      lane_id: 'LANE_INSPECTION',
      order: 4,
      x: 100,
      y: 500,
      width: 160,
      height: 60,
      style_id: 'STY_FUNCTION'
    },
    {
      model_id: 'MDL_PERMIT',
      object_id: 'OBJ_EVT_ISSUED',
      occurrence_id: 'OCC_EVT_ISSUED',
      object_type: 'OT_EVT',
      symbol_type: 'ST_EV',
      name_en: 'Permit issued',
      name_ar: 'تم إصدار التصريح',
      lane_id: 'LANE_PERMITS',
      order: 5,
      x: 100,
      y: 640,
      width: 160,
      height: 60,
      style_id: 'STY_EVENT'
    },
    {
      model_id: 'MDL_PERMIT',
      object_id: 'OBJ_ROLE_OFFICER',
      occurrence_id: 'OCC_ROLE_OFFICER',
      object_type: 'OT_PERS_TYPE',
      symbol_type: 'ST_PERS_TYPE',
      name_en: 'Permit officer',
      name_ar: 'موظف التصاريح',
      lane_id: 'LANE_PERMITS',
      order: 6,
      x: 400,
      y: 220,
      width: 140,
      height: 60
    },
    {
      // No x/y/width/height on purpose: pins the §15.3 step 10 deterministic
      // layout fallback (column x=240, y=120+index*160, 180x70) in the AML.
      model_id: 'MDL_PERMIT',
      object_id: 'OBJ_APP_HUB',
      occurrence_id: 'OCC_APP_HUB',
      object_type: 'OT_APPL_SYS',
      symbol_type: 'ST_APPL_SYS_TYPE',
      name_en: 'DMT HUB',
      name_ar: 'منصة أبوظبي الرقمية',
      order: 7
    },
    {
      model_id: 'MDL_INSPECTION',
      object_id: 'OBJ_EVT_SCHEDULED',
      occurrence_id: 'OCC_EVT_SCHEDULED',
      object_type: 'OT_EVT',
      symbol_type: 'ST_EV',
      name_en: 'Inspection scheduled',
      name_ar: 'تمت جدولة التفتيش',
      order: 1,
      x: 100,
      y: 80,
      width: 160,
      height: 60
    },
    {
      model_id: 'MDL_INSPECTION',
      object_id: 'OBJ_FUNC_CHECKLIST',
      occurrence_id: 'OCC_FUNC_CHECKLIST',
      object_type: 'OT_FUNC',
      symbol_type: 'ST_FUNC',
      name_en: 'Complete inspection checklist',
      name_ar: 'استكمال قائمة التفتيش',
      order: 2,
      x: 100,
      y: 220,
      width: 160,
      height: 60
    },
    {
      model_id: 'MDL_INSPECTION',
      object_id: 'OBJ_EVT_FILED',
      occurrence_id: 'OCC_EVT_FILED',
      object_type: 'OT_EVT',
      symbol_type: 'ST_EV',
      name_en: 'Inspection report filed',
      name_ar: 'تم تقديم تقرير التفتيش',
      order: 3,
      x: 100,
      y: 360,
      width: 160,
      height: 60
    }
  ],
  Connections: [
    {
      model_id: 'MDL_PERMIT',
      connection_id: 'CXN_APPLIED_REVIEW',
      source_occurrence_id: 'OCC_EVT_APPLIED',
      target_occurrence_id: 'OCC_FUNC_REVIEW',
      connection_type: 'CT_ACTIV_1',
      route_points: '180:140|180:220'
    },
    {
      model_id: 'MDL_PERMIT',
      connection_id: 'CXN_REVIEW_RULE',
      source_occurrence_id: 'OCC_FUNC_REVIEW',
      target_occurrence_id: 'OCC_RULE_DOCS',
      connection_type: 'CT_LEADS_TO_1'
    },
    {
      model_id: 'MDL_PERMIT',
      connection_id: 'CXN_RULE_INSPECT',
      source_occurrence_id: 'OCC_RULE_DOCS',
      target_occurrence_id: 'OCC_FUNC_INSPECT',
      connection_type: 'CT_ACTIV_1',
      name_en: 'Complete',
      name_ar: 'مكتمل',
      route_points: '160:420|180:450|180:500',
      style_id: 'STY_FLOW'
    },
    {
      model_id: 'MDL_PERMIT',
      connection_id: 'CXN_INSPECT_ISSUED',
      source_occurrence_id: 'OCC_FUNC_INSPECT',
      target_occurrence_id: 'OCC_EVT_ISSUED',
      connection_type: 'CT_CRT_1'
    },
    {
      // RACI: the officer role executes the review.
      model_id: 'MDL_PERMIT',
      connection_id: 'CXN_OFFICER_REVIEW',
      source_occurrence_id: 'OCC_ROLE_OFFICER',
      target_occurrence_id: 'OCC_FUNC_REVIEW',
      connection_type: 'CT_EXEC_2'
    },
    {
      // RACI: the officer role must be consulted about the inspection.
      model_id: 'MDL_PERMIT',
      connection_id: 'CXN_OFFICER_CONSULT',
      source_occurrence_id: 'OCC_ROLE_OFFICER',
      target_occurrence_id: 'OCC_FUNC_INSPECT',
      connection_type: 'CT_MUST_BE_CONSLT_ABT_1'
    },
    {
      // No route_points on purpose: pins the deterministic two-point fallback
      // route derived from the endpoint bounds in the generated AML.
      model_id: 'MDL_PERMIT',
      connection_id: 'CXN_HUB_REVIEW',
      source_occurrence_id: 'OCC_APP_HUB',
      target_occurrence_id: 'OCC_FUNC_REVIEW',
      connection_type: 'CT_SUPP_3'
    },
    {
      model_id: 'MDL_INSPECTION',
      connection_id: 'CXN_SCHEDULED_CHECKLIST',
      source_occurrence_id: 'OCC_EVT_SCHEDULED',
      target_occurrence_id: 'OCC_FUNC_CHECKLIST',
      connection_type: 'CT_ACTIV_1'
    },
    {
      model_id: 'MDL_INSPECTION',
      connection_id: 'CXN_CHECKLIST_FILED',
      source_occurrence_id: 'OCC_FUNC_CHECKLIST',
      target_occurrence_id: 'OCC_EVT_FILED',
      connection_type: 'CT_CRT_1'
    }
  ],
  Attributes: [
    {
      owner_kind: 'model',
      owner_id: 'MDL_PERMIT',
      attribute_type: 'AT_REM',
      language: 'en',
      value: 'Permits are issued within five working days of application.',
      value_type: 'text',
      sequence: 1
    },
    {
      owner_kind: 'object',
      owner_id: 'OBJ_FUNC_REVIEW',
      attribute_type: 'AT_REM',
      language: 'en',
      value: 'Verify the applicant identity and plot documents.',
      value_type: 'text',
      sequence: 1
    },
    {
      owner_kind: 'object',
      owner_id: 'OBJ_FUNC_REVIEW',
      attribute_type: 'AT_REM',
      language: 'ar',
      value: 'تحقق من هوية مقدم الطلب ووثائق الأرض.',
      value_type: 'text',
      sequence: 2
    },
    {
      owner_kind: 'occurrence',
      owner_id: 'OCC_RULE_DOCS',
      attribute_type: 'AT_REM',
      language: 'en',
      value: 'Exclusive choice: exactly one outgoing branch is taken.',
      value_type: 'text',
      sequence: 1
    },
    {
      owner_kind: 'connection',
      owner_id: 'CXN_RULE_INSPECT',
      attribute_type: 'AT_NAME',
      language: 'en',
      value: 'Complete',
      value_type: 'text',
      sequence: 1
    },
    {
      owner_kind: 'lane',
      owner_id: 'LANE_PERMITS',
      attribute_type: 'AT_REM',
      language: 'ar',
      value: 'مسؤول عن مراجعة الطلبات وإصدار التصاريح.',
      value_type: 'text',
      sequence: 1
    },
    {
      owner_kind: 'free_text',
      owner_id: 'TXT_SLA',
      attribute_type: 'AT_REM',
      language: 'en',
      value: 'Statutory service level for permit issuance.',
      value_type: 'text',
      sequence: 1
    }
  ],
  Assignments: [
    {
      source_object_id: 'OBJ_FUNC_REVIEW',
      target_model_id: 'MDL_INSPECTION',
      assignment_type: 'detail'
    }
  ],
  Lanes: [
    {
      model_id: 'MDL_PERMIT',
      lane_id: 'LANE_CUSTOMER',
      name_en: 'Customer',
      name_ar: 'المتعامل',
      x: 0,
      y: 40,
      width: 560,
      height: 120,
      orientation: 'horizontal'
    },
    {
      model_id: 'MDL_PERMIT',
      lane_id: 'LANE_PERMITS',
      name_en: 'Permit section',
      name_ar: 'قسم التصاريح',
      x: 0,
      y: 160,
      width: 560,
      height: 300,
      orientation: 'horizontal'
    },
    {
      model_id: 'MDL_PERMIT',
      lane_id: 'LANE_INSPECTION',
      name_en: 'Inspection section',
      name_ar: 'قسم التفتيش',
      x: 0,
      y: 460,
      width: 560,
      height: 260,
      orientation: 'horizontal'
    }
  ],
  FreeText: [
    {
      model_id: 'MDL_PERMIT',
      text_id: 'TXT_SLA',
      text_en: 'Decision due within five working days.',
      text_ar: 'يجب اتخاذ القرار خلال خمسة أيام عمل.',
      x: 300,
      y: 60,
      width: 240,
      height: 60,
      style_id: 'STY_NOTE'
    }
  ],
  Styles: [
    {
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
    },
    {
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
    },
    {
      style_id: 'STY_FLOW',
      stroke_color: '#4A4A4A',
      stroke_width: 1,
      line_style: 'solid',
      font_family: 'Arial',
      font_size: 9,
      font_weight: 'normal',
      text_color: '#4A4A4A',
      z_order: 3
    },
    {
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
    }
  ],
  Glossary: [
    { english: 'Permit', arabic: 'تصريح', do_not_translate: false, case_sensitive: false },
    { english: 'DMT HUB', arabic: 'DMT HUB', do_not_translate: true, case_sensitive: true },
    { english: 'SLA', arabic: 'SLA', do_not_translate: true, case_sensitive: false }
  ]
}

const CANONICAL_FILE = 'dmt-permit-issuance.xlsx'

function authorCanonicalWorkbook(): Uint8Array {
  return buildFixtureWorkbook({ sheets: CANONICAL_SHEETS })
}

function accept(result: ArisWorkbookParseResult): ArisWorkbookModel {
  expect(result.issues).toEqual([])
  expect(result.status).toBe('accepted')
  if (!isAcceptedArisWorkbook(result)) {
    throw new Error(`workbook was rejected: ${result.issues.map((issue) => issue.code).join(',')}`)
  }
  return result.model
}

function parseCanonicalWorkbook(): ArisWorkbookModel {
  return accept(parseArisWorkbook(CANONICAL_FILE, authorCanonicalWorkbook()))
}

// --- suite 1: workbook-seam projection ----------------------------------------

function value<T>(sourced: ArisSourcedValue<T> | undefined): T | undefined {
  return sourced?.value
}

/** Strips provenance/coercion wrappers so the parsed model compares as plain data. */
function projectWorkbookModel(model: ArisWorkbookModel) {
  return {
    models: model.models.map((record) => ({
      modelId: value(record.modelId),
      modelType: value(record.modelType),
      nameEn: value(record.nameEn),
      nameAr: value(record.nameAr),
      processCode: value(record.processCode),
      descriptionEn: value(record.descriptionEn),
      descriptionAr: value(record.descriptionAr),
      orientation: value(record.orientation)
    })),
    objects: model.objects.map((record) => ({
      modelId: value(record.modelId),
      objectId: value(record.objectId),
      occurrenceId: value(record.occurrenceId),
      objectType: value(record.objectType),
      symbolType: value(record.symbolType),
      nameEn: value(record.nameEn),
      nameAr: value(record.nameAr),
      laneId: value(record.laneId),
      order: value(record.order),
      x: value(record.x),
      y: value(record.y),
      width: value(record.width),
      height: value(record.height),
      assignedModelId: value(record.assignedModelId),
      styleId: value(record.styleId)
    })),
    connections: model.connections.map((record) => ({
      modelId: value(record.modelId),
      connectionId: value(record.connectionId),
      sourceOccurrenceId: value(record.sourceOccurrenceId),
      targetOccurrenceId: value(record.targetOccurrenceId),
      connectionType: value(record.connectionType),
      nameEn: value(record.nameEn),
      nameAr: value(record.nameAr),
      routePoints: value(record.routePoints)?.map((point) => ({ x: point.x, y: point.y })),
      styleId: value(record.styleId)
    })),
    attributes: model.attributes.map((record) => ({
      ownerKind: value(record.ownerKind),
      ownerId: value(record.ownerId),
      attributeType: value(record.attributeType),
      language: value(record.language),
      value: value(record.value),
      valueType: value(record.valueType),
      sequence: value(record.sequence)
    })),
    assignments: model.assignments.map((record) => ({
      sourceObjectId: value(record.sourceObjectId),
      targetModelId: value(record.targetModelId),
      assignmentType: value(record.assignmentType)
    })),
    lanes: model.lanes.map((record) => ({
      modelId: value(record.modelId),
      laneId: value(record.laneId),
      nameEn: value(record.nameEn),
      nameAr: value(record.nameAr),
      x: value(record.x),
      y: value(record.y),
      width: value(record.width),
      height: value(record.height),
      orientation: value(record.orientation)
    })),
    freeText: model.freeText.map((record) => ({
      modelId: value(record.modelId),
      textId: value(record.textId),
      textEn: value(record.textEn),
      textAr: value(record.textAr),
      x: value(record.x),
      y: value(record.y),
      width: value(record.width),
      height: value(record.height),
      styleId: value(record.styleId)
    })),
    styles: model.styles.map((record) => ({
      styleId: value(record.styleId),
      fillColor: value(record.fillColor),
      strokeColor: value(record.strokeColor),
      strokeWidth: value(record.strokeWidth),
      lineStyle: value(record.lineStyle),
      fontFamily: value(record.fontFamily),
      fontSize: value(record.fontSize),
      fontWeight: value(record.fontWeight),
      textColor: value(record.textColor),
      zOrder: value(record.zOrder)
    })),
    glossary: model.glossary.map((record) => ({
      english: value(record.english),
      arabic: value(record.arabic),
      doNotTranslate: value(record.doNotTranslate),
      caseSensitive: value(record.caseSensitive)
    }))
  }
}

/**
 * The authored process as plain data — every cell that was written into the
 * template workbook, with the coercions the parser is contracted to apply
 * (integers as numbers, routes as point lists, glossary flags as booleans).
 * Written out independently of `CANONICAL_SHEETS` on purpose: the two must
 * agree, which pins the fixture itself as well as the pipeline.
 *
 * Entries are `Partial` because the golden omits keys whose parsed value is
 * `undefined` — vitest's `toEqual` treats a missing key and an explicit
 * `undefined` as equal, so the literal stays noise-free without losing
 * excess-property and value type checking.
 */
type ProjectedWorkbookModel = ReturnType<typeof projectWorkbookModel>
type ExpectedWorkbookModel = {
  [K in keyof ProjectedWorkbookModel]: Partial<ProjectedWorkbookModel[K][number]>[]
}

const EXPECTED_CANONICAL_MODEL: ExpectedWorkbookModel = {
  models: [
    {
      modelId: 'MDL_PERMIT',
      modelType: 'MT_EEPC',
      nameEn: 'Permit issuance',
      nameAr: 'إصدار التصريح',
      processCode: 'DMT-100',
      descriptionEn: 'Issue a commercial permit after document review and site inspection.',
      descriptionAr: 'إصدار تصريح تجاري بعد مراجعة الوثائق وتفتيش الموقع.',
      orientation: 'horizontal'
    },
    {
      modelId: 'MDL_INSPECTION',
      modelType: 'MT_EEPC',
      nameEn: 'Site inspection',
      nameAr: 'التفتيش على الموقع',
      processCode: 'DMT-110',
      descriptionEn: 'Detailed site inspection sub-process.',
      descriptionAr: 'العملية التفصيلية لتفتيش الموقع.',
      orientation: 'horizontal'
    }
  ],
  objects: [
    {
      modelId: 'MDL_PERMIT',
      objectId: 'OBJ_EVT_APPLIED',
      occurrenceId: 'OCC_EVT_APPLIED',
      objectType: 'OT_EVT',
      symbolType: 'ST_EV',
      nameEn: 'Permit application submitted',
      nameAr: 'تم تقديم طلب التصريح',
      laneId: 'LANE_CUSTOMER',
      order: 1,
      x: 100,
      y: 80,
      width: 160,
      height: 60,
      styleId: 'STY_EVENT'
    },
    {
      modelId: 'MDL_PERMIT',
      objectId: 'OBJ_FUNC_REVIEW',
      occurrenceId: 'OCC_FUNC_REVIEW',
      objectType: 'OT_FUNC',
      symbolType: 'ST_FUNC',
      nameEn: 'Review permit application',
      nameAr: 'مراجعة طلب التصريح',
      laneId: 'LANE_PERMITS',
      order: 2,
      x: 100,
      y: 220,
      width: 160,
      height: 60,
      assignedModelId: 'MDL_INSPECTION',
      styleId: 'STY_FUNCTION'
    },
    {
      modelId: 'MDL_PERMIT',
      objectId: 'OBJ_RULE_DOCS',
      occurrenceId: 'OCC_RULE_DOCS',
      objectType: 'OT_RULE',
      symbolType: 'ST_OPR_XOR_1',
      nameEn: 'Documentation complete?',
      nameAr: 'هل اكتملت الوثائق؟',
      laneId: 'LANE_PERMITS',
      order: 3,
      x: 130,
      y: 360,
      width: 60,
      height: 60
    },
    {
      modelId: 'MDL_PERMIT',
      objectId: 'OBJ_FUNC_INSPECT',
      occurrenceId: 'OCC_FUNC_INSPECT',
      objectType: 'OT_FUNC',
      symbolType: 'ST_FUNC',
      nameEn: 'Inspect site',
      nameAr: 'تفتيش الموقع',
      laneId: 'LANE_INSPECTION',
      order: 4,
      x: 100,
      y: 500,
      width: 160,
      height: 60,
      styleId: 'STY_FUNCTION'
    },
    {
      modelId: 'MDL_PERMIT',
      objectId: 'OBJ_EVT_ISSUED',
      occurrenceId: 'OCC_EVT_ISSUED',
      objectType: 'OT_EVT',
      symbolType: 'ST_EV',
      nameEn: 'Permit issued',
      nameAr: 'تم إصدار التصريح',
      laneId: 'LANE_PERMITS',
      order: 5,
      x: 100,
      y: 640,
      width: 160,
      height: 60,
      styleId: 'STY_EVENT'
    },
    {
      modelId: 'MDL_PERMIT',
      objectId: 'OBJ_ROLE_OFFICER',
      occurrenceId: 'OCC_ROLE_OFFICER',
      objectType: 'OT_PERS_TYPE',
      symbolType: 'ST_PERS_TYPE',
      nameEn: 'Permit officer',
      nameAr: 'موظف التصاريح',
      laneId: 'LANE_PERMITS',
      order: 6,
      x: 400,
      y: 220,
      width: 140,
      height: 60
    },
    {
      modelId: 'MDL_PERMIT',
      objectId: 'OBJ_APP_HUB',
      occurrenceId: 'OCC_APP_HUB',
      objectType: 'OT_APPL_SYS',
      symbolType: 'ST_APPL_SYS_TYPE',
      nameEn: 'DMT HUB',
      nameAr: 'منصة أبوظبي الرقمية',
      order: 7
    },
    {
      modelId: 'MDL_INSPECTION',
      objectId: 'OBJ_EVT_SCHEDULED',
      occurrenceId: 'OCC_EVT_SCHEDULED',
      objectType: 'OT_EVT',
      symbolType: 'ST_EV',
      nameEn: 'Inspection scheduled',
      nameAr: 'تمت جدولة التفتيش',
      order: 1,
      x: 100,
      y: 80,
      width: 160,
      height: 60
    },
    {
      modelId: 'MDL_INSPECTION',
      objectId: 'OBJ_FUNC_CHECKLIST',
      occurrenceId: 'OCC_FUNC_CHECKLIST',
      objectType: 'OT_FUNC',
      symbolType: 'ST_FUNC',
      nameEn: 'Complete inspection checklist',
      nameAr: 'استكمال قائمة التفتيش',
      order: 2,
      x: 100,
      y: 220,
      width: 160,
      height: 60
    },
    {
      modelId: 'MDL_INSPECTION',
      objectId: 'OBJ_EVT_FILED',
      occurrenceId: 'OCC_EVT_FILED',
      objectType: 'OT_EVT',
      symbolType: 'ST_EV',
      nameEn: 'Inspection report filed',
      nameAr: 'تم تقديم تقرير التفتيش',
      order: 3,
      x: 100,
      y: 360,
      width: 160,
      height: 60
    }
  ],
  connections: [
    {
      modelId: 'MDL_PERMIT',
      connectionId: 'CXN_APPLIED_REVIEW',
      sourceOccurrenceId: 'OCC_EVT_APPLIED',
      targetOccurrenceId: 'OCC_FUNC_REVIEW',
      connectionType: 'CT_ACTIV_1',
      routePoints: [
        { x: 180, y: 140 },
        { x: 180, y: 220 }
      ]
    },
    {
      modelId: 'MDL_PERMIT',
      connectionId: 'CXN_REVIEW_RULE',
      sourceOccurrenceId: 'OCC_FUNC_REVIEW',
      targetOccurrenceId: 'OCC_RULE_DOCS',
      connectionType: 'CT_LEADS_TO_1'
    },
    {
      modelId: 'MDL_PERMIT',
      connectionId: 'CXN_RULE_INSPECT',
      sourceOccurrenceId: 'OCC_RULE_DOCS',
      targetOccurrenceId: 'OCC_FUNC_INSPECT',
      connectionType: 'CT_ACTIV_1',
      nameEn: 'Complete',
      nameAr: 'مكتمل',
      routePoints: [
        { x: 160, y: 420 },
        { x: 180, y: 450 },
        { x: 180, y: 500 }
      ],
      styleId: 'STY_FLOW'
    },
    {
      modelId: 'MDL_PERMIT',
      connectionId: 'CXN_INSPECT_ISSUED',
      sourceOccurrenceId: 'OCC_FUNC_INSPECT',
      targetOccurrenceId: 'OCC_EVT_ISSUED',
      connectionType: 'CT_CRT_1'
    },
    {
      modelId: 'MDL_PERMIT',
      connectionId: 'CXN_OFFICER_REVIEW',
      sourceOccurrenceId: 'OCC_ROLE_OFFICER',
      targetOccurrenceId: 'OCC_FUNC_REVIEW',
      connectionType: 'CT_EXEC_2'
    },
    {
      modelId: 'MDL_PERMIT',
      connectionId: 'CXN_OFFICER_CONSULT',
      sourceOccurrenceId: 'OCC_ROLE_OFFICER',
      targetOccurrenceId: 'OCC_FUNC_INSPECT',
      connectionType: 'CT_MUST_BE_CONSLT_ABT_1'
    },
    {
      modelId: 'MDL_PERMIT',
      connectionId: 'CXN_HUB_REVIEW',
      sourceOccurrenceId: 'OCC_APP_HUB',
      targetOccurrenceId: 'OCC_FUNC_REVIEW',
      connectionType: 'CT_SUPP_3'
    },
    {
      modelId: 'MDL_INSPECTION',
      connectionId: 'CXN_SCHEDULED_CHECKLIST',
      sourceOccurrenceId: 'OCC_EVT_SCHEDULED',
      targetOccurrenceId: 'OCC_FUNC_CHECKLIST',
      connectionType: 'CT_ACTIV_1'
    },
    {
      modelId: 'MDL_INSPECTION',
      connectionId: 'CXN_CHECKLIST_FILED',
      sourceOccurrenceId: 'OCC_FUNC_CHECKLIST',
      targetOccurrenceId: 'OCC_EVT_FILED',
      connectionType: 'CT_CRT_1'
    }
  ],
  attributes: [
    {
      ownerKind: 'model',
      ownerId: 'MDL_PERMIT',
      attributeType: 'AT_REM',
      language: 'en',
      value: 'Permits are issued within five working days of application.',
      valueType: 'text',
      sequence: 1
    },
    {
      ownerKind: 'object',
      ownerId: 'OBJ_FUNC_REVIEW',
      attributeType: 'AT_REM',
      language: 'en',
      value: 'Verify the applicant identity and plot documents.',
      valueType: 'text',
      sequence: 1
    },
    {
      ownerKind: 'object',
      ownerId: 'OBJ_FUNC_REVIEW',
      attributeType: 'AT_REM',
      language: 'ar',
      value: 'تحقق من هوية مقدم الطلب ووثائق الأرض.',
      valueType: 'text',
      sequence: 2
    },
    {
      ownerKind: 'occurrence',
      ownerId: 'OCC_RULE_DOCS',
      attributeType: 'AT_REM',
      language: 'en',
      value: 'Exclusive choice: exactly one outgoing branch is taken.',
      valueType: 'text',
      sequence: 1
    },
    {
      ownerKind: 'connection',
      ownerId: 'CXN_RULE_INSPECT',
      attributeType: 'AT_NAME',
      language: 'en',
      value: 'Complete',
      valueType: 'text',
      sequence: 1
    },
    {
      ownerKind: 'lane',
      ownerId: 'LANE_PERMITS',
      attributeType: 'AT_REM',
      language: 'ar',
      value: 'مسؤول عن مراجعة الطلبات وإصدار التصاريح.',
      valueType: 'text',
      sequence: 1
    },
    {
      ownerKind: 'free_text',
      ownerId: 'TXT_SLA',
      attributeType: 'AT_REM',
      language: 'en',
      value: 'Statutory service level for permit issuance.',
      valueType: 'text',
      sequence: 1
    }
  ],
  assignments: [
    {
      sourceObjectId: 'OBJ_FUNC_REVIEW',
      targetModelId: 'MDL_INSPECTION',
      assignmentType: 'detail'
    }
  ],
  lanes: [
    {
      modelId: 'MDL_PERMIT',
      laneId: 'LANE_CUSTOMER',
      nameEn: 'Customer',
      nameAr: 'المتعامل',
      x: 0,
      y: 40,
      width: 560,
      height: 120,
      orientation: 'horizontal'
    },
    {
      modelId: 'MDL_PERMIT',
      laneId: 'LANE_PERMITS',
      nameEn: 'Permit section',
      nameAr: 'قسم التصاريح',
      x: 0,
      y: 160,
      width: 560,
      height: 300,
      orientation: 'horizontal'
    },
    {
      modelId: 'MDL_PERMIT',
      laneId: 'LANE_INSPECTION',
      nameEn: 'Inspection section',
      nameAr: 'قسم التفتيش',
      x: 0,
      y: 460,
      width: 560,
      height: 260,
      orientation: 'horizontal'
    }
  ],
  freeText: [
    {
      modelId: 'MDL_PERMIT',
      textId: 'TXT_SLA',
      textEn: 'Decision due within five working days.',
      textAr: 'يجب اتخاذ القرار خلال خمسة أيام عمل.',
      x: 300,
      y: 60,
      width: 240,
      height: 60,
      styleId: 'STY_NOTE'
    }
  ],
  styles: [
    {
      styleId: 'STY_EVENT',
      fillColor: '#FFE8B0',
      strokeColor: '#B08A2E',
      strokeWidth: 1,
      lineStyle: 'solid',
      fontFamily: 'Arial',
      fontSize: 10,
      fontWeight: 'normal',
      textColor: '#2B2B2B',
      zOrder: 1
    },
    {
      styleId: 'STY_FUNCTION',
      fillColor: '#CFE3F7',
      strokeColor: '#2E6DA4',
      strokeWidth: 1,
      lineStyle: 'solid',
      fontFamily: 'Arial',
      fontSize: 10,
      fontWeight: 'bold',
      textColor: '#1B1B1B',
      zOrder: 2
    },
    {
      styleId: 'STY_FLOW',
      strokeColor: '#4A4A4A',
      strokeWidth: 1,
      lineStyle: 'solid',
      fontFamily: 'Arial',
      fontSize: 9,
      fontWeight: 'normal',
      textColor: '#4A4A4A',
      zOrder: 3
    },
    {
      styleId: 'STY_NOTE',
      fillColor: '#FFFFFF',
      strokeColor: '#9A9A9A',
      strokeWidth: 1,
      lineStyle: 'dashed',
      fontFamily: 'Arial',
      fontSize: 9,
      fontWeight: 'normal',
      textColor: '#4A4A4A',
      zOrder: 4
    }
  ],
  glossary: [
    { english: 'Permit', arabic: 'تصريح', doNotTranslate: false, caseSensitive: false },
    { english: 'DMT HUB', arabic: 'DMT HUB', doNotTranslate: true, caseSensitive: true },
    { english: 'SLA', arabic: 'SLA', doNotTranslate: true, caseSensitive: false }
  ]
}

// --- suites 2-3: AML-seam helpers ----------------------------------------------

/** Re-imports generated AML through the real source layer — what the canvas consumes. */
async function importGeneratedAml(xml: string): Promise<ArisWorkingDocument> {
  const sourcePackage = await createArisXmlSourcePackage({
    name: 'roundtrip.aml',
    relPath: null,
    bytes: new TextEncoder().encode(xml)
  })
  return buildFromSource(sourcePackage.index)
}

/** Locale-tolerant read of a localized value (locale ids are numeric LCIDs here). */
function textFor(localized: ArisLocalizedValue, lang: 'en' | 'ar'): string | null {
  for (const [localeId, text] of Object.entries(localized.values)) {
    if (text.trim() !== '' && localeLang(localeId) === lang) return text
  }
  return null
}

function attributeText(
  attributes: readonly ArisAttribute[],
  type: string,
  lang: 'en' | 'ar'
): string | null {
  const attribute = attributes.find((candidate) => candidate.type === type)
  if (!attribute) return null
  for (const entry of attribute.values) {
    if (
      entry.text.trim() !== '' &&
      entry.localeId !== null &&
      localeLang(entry.localeId) === lang
    ) {
      return entry.text
    }
  }
  return null
}

interface ExpectedDefinition {
  readonly id: string
  readonly type: string
  readonly symbol: string
  readonly en: string
  readonly ar: string
}

function expectDefinitions(document: ArisWorkingDocument, expected: readonly ExpectedDefinition[]) {
  expect([...document.objectDefinitions.keys()].sort()).toEqual(
    expected.map((definition) => definition.id).sort()
  )
  for (const definition of expected) {
    const actual = document.objectDefinitions.get(definition.id)
    expect(actual, definition.id).toBeDefined()
    expect(actual!.type, definition.id).toBe(definition.type)
    expect(actual!.defaultSymbol, definition.id).toBe(definition.symbol)
    expect(textFor(actual!.names, 'en'), definition.id).toBe(definition.en)
    expect(textFor(actual!.names, 'ar'), definition.id).toBe(definition.ar)
  }
}

interface ExpectedOccurrence {
  readonly id: string
  readonly definitionId: string
  readonly symbol: string
  readonly bounds: {
    readonly x: number
    readonly y: number
    readonly width: number
    readonly height: number
  }
}

function expectModelOccurrences(
  document: ArisWorkingDocument,
  modelId: string,
  expected: readonly ExpectedOccurrence[]
) {
  const model = document.models.get(modelId)
  expect(model, modelId).toBeDefined()
  // Array order is asserted, not just membership: it is where the workbook's
  // `order` column (sequence numbering) shows up in the generated document.
  expect(model!.occurrences.map((occurrence) => occurrence.id)).toEqual(
    expected.map((occurrence) => occurrence.id)
  )
  for (const occurrence of expected) {
    const actual = model!.occurrences.find((candidate) => candidate.id === occurrence.id)!
    expect(actual.definitionId, occurrence.id).toBe(occurrence.definitionId)
    expect(actual.symbol, occurrence.id).toBe(occurrence.symbol)
    expect(actual.bounds, occurrence.id).toEqual(occurrence.bounds)
  }
}

interface ExpectedConnection {
  readonly definitionId: string
  readonly type: string
  readonly toDefinitionId: string
  readonly occurrenceId: string
  readonly sourceOccurrenceId: string
  readonly targetOccurrenceId: string
  readonly route: readonly { readonly x: number; readonly y: number }[]
}

function expectConnections(
  document: ArisWorkingDocument,
  modelId: string,
  expected: readonly ExpectedConnection[]
) {
  const model = document.models.get(modelId)!
  expect(model.connectionOccurrences.map((connection) => connection.id)).toEqual(
    expected.map((connection) => connection.occurrenceId)
  )
  expectConnectionDetails(document, modelId, expected)
}

/**
 * Per-connection checks without the full-list assertion, so a subset (e.g. the
 * RACI wiring) can be pinned on its own.
 */
function expectConnectionDetails(
  document: ArisWorkingDocument,
  modelId: string,
  expected: readonly ExpectedConnection[]
) {
  const model = document.models.get(modelId)!
  for (const connection of expected) {
    const definition = document.connectionDefinitions.get(connection.definitionId)
    expect(definition, connection.definitionId).toBeDefined()
    expect(definition!.type, connection.definitionId).toBe(connection.type)
    expect(definition!.toObjectDefinitionId, connection.definitionId).toBe(
      connection.toDefinitionId
    )
    const occurrence = model.connectionOccurrences.find(
      (candidate) => candidate.id === connection.occurrenceId
    )
    expect(occurrence, connection.occurrenceId).toBeDefined()
    expect(occurrence!.definitionId, connection.occurrenceId).toBe(connection.definitionId)
    expect(occurrence!.sourceOccurrenceId, connection.occurrenceId).toBe(
      connection.sourceOccurrenceId
    )
    expect(occurrence!.targetOccurrenceId, connection.occurrenceId).toBe(
      connection.targetOccurrenceId
    )
    expect(occurrence!.route, connection.occurrenceId).toEqual(connection.route)
  }
}

// --- suite 1 --------------------------------------------------------------------

describe('Excel round trip: authored process survives the template write/parse cycle', () => {
  it('writes deterministic workbook bytes for the same authored process', () => {
    expect(authorCanonicalWorkbook()).toEqual(authorCanonicalWorkbook())
  })

  it('parses the authored workbook back into the exact same process, across all nine sheets', () => {
    const model = parseCanonicalWorkbook()
    expect(projectWorkbookModel(model)).toEqual(EXPECTED_CANONICAL_MODEL)
  })

  it('is stable: parsing the same bytes twice yields the identical workbook model', () => {
    const bytes = authorCanonicalWorkbook()
    const first = accept(parseArisWorkbook(CANONICAL_FILE, bytes))
    const second = accept(parseArisWorkbook(CANONICAL_FILE, bytes))
    expect(projectWorkbookModel(second)).toEqual(projectWorkbookModel(first))
  })
})

// --- suite 2 --------------------------------------------------------------------

const CANONICAL_DEFINITIONS: readonly ExpectedDefinition[] = [
  {
    id: 'ObjDef.OBJ_EVT_APPLIED',
    type: 'OT_EVT',
    symbol: 'ST_EV',
    en: 'Permit application submitted',
    ar: 'تم تقديم طلب التصريح'
  },
  {
    id: 'ObjDef.OBJ_FUNC_REVIEW',
    type: 'OT_FUNC',
    symbol: 'ST_FUNC',
    en: 'Review permit application',
    ar: 'مراجعة طلب التصريح'
  },
  {
    id: 'ObjDef.OBJ_RULE_DOCS',
    type: 'OT_RULE',
    symbol: 'ST_OPR_XOR_1',
    en: 'Documentation complete?',
    ar: 'هل اكتملت الوثائق؟'
  },
  {
    id: 'ObjDef.OBJ_FUNC_INSPECT',
    type: 'OT_FUNC',
    symbol: 'ST_FUNC',
    en: 'Inspect site',
    ar: 'تفتيش الموقع'
  },
  {
    id: 'ObjDef.OBJ_EVT_ISSUED',
    type: 'OT_EVT',
    symbol: 'ST_EV',
    en: 'Permit issued',
    ar: 'تم إصدار التصريح'
  },
  {
    id: 'ObjDef.OBJ_ROLE_OFFICER',
    type: 'OT_PERS_TYPE',
    symbol: 'ST_PERS_TYPE',
    en: 'Permit officer',
    ar: 'موظف التصاريح'
  },
  {
    id: 'ObjDef.OBJ_APP_HUB',
    type: 'OT_APPL_SYS',
    symbol: 'ST_APPL_SYS_TYPE',
    en: 'DMT HUB',
    ar: 'منصة أبوظبي الرقمية'
  },
  {
    id: 'ObjDef.OBJ_EVT_SCHEDULED',
    type: 'OT_EVT',
    symbol: 'ST_EV',
    en: 'Inspection scheduled',
    ar: 'تمت جدولة التفتيش'
  },
  {
    id: 'ObjDef.OBJ_FUNC_CHECKLIST',
    type: 'OT_FUNC',
    symbol: 'ST_FUNC',
    en: 'Complete inspection checklist',
    ar: 'استكمال قائمة التفتيش'
  },
  {
    id: 'ObjDef.OBJ_EVT_FILED',
    type: 'OT_EVT',
    symbol: 'ST_EV',
    en: 'Inspection report filed',
    ar: 'تم تقديم تقرير التفتيش'
  }
]

const CANONICAL_PERMIT_OCCURRENCES: readonly ExpectedOccurrence[] = [
  {
    id: 'ObjOcc.OCC_EVT_APPLIED',
    definitionId: 'ObjDef.OBJ_EVT_APPLIED',
    symbol: 'ST_EV',
    bounds: { x: 100, y: 80, width: 160, height: 60 }
  },
  {
    id: 'ObjOcc.OCC_FUNC_REVIEW',
    definitionId: 'ObjDef.OBJ_FUNC_REVIEW',
    symbol: 'ST_FUNC',
    bounds: { x: 100, y: 220, width: 160, height: 60 }
  },
  {
    id: 'ObjOcc.OCC_RULE_DOCS',
    definitionId: 'ObjDef.OBJ_RULE_DOCS',
    symbol: 'ST_OPR_XOR_1',
    bounds: { x: 130, y: 360, width: 60, height: 60 }
  },
  {
    id: 'ObjOcc.OCC_FUNC_INSPECT',
    definitionId: 'ObjDef.OBJ_FUNC_INSPECT',
    symbol: 'ST_FUNC',
    bounds: { x: 100, y: 500, width: 160, height: 60 }
  },
  {
    id: 'ObjOcc.OCC_EVT_ISSUED',
    definitionId: 'ObjDef.OBJ_EVT_ISSUED',
    symbol: 'ST_EV',
    bounds: { x: 100, y: 640, width: 160, height: 60 }
  },
  {
    id: 'ObjOcc.OCC_ROLE_OFFICER',
    definitionId: 'ObjDef.OBJ_ROLE_OFFICER',
    symbol: 'ST_PERS_TYPE',
    bounds: { x: 400, y: 220, width: 140, height: 60 }
  },
  {
    // Authored without geometry: the §15.3 step 10 deterministic fallback
    // (column x=240, y=120+index*160, 180x70) is what the AML must carry.
    id: 'ObjOcc.OCC_APP_HUB',
    definitionId: 'ObjDef.OBJ_APP_HUB',
    symbol: 'ST_APPL_SYS_TYPE',
    bounds: { x: 240, y: 1080, width: 180, height: 70 }
  }
]

const CANONICAL_INSPECTION_OCCURRENCES: readonly ExpectedOccurrence[] = [
  {
    id: 'ObjOcc.OCC_EVT_SCHEDULED',
    definitionId: 'ObjDef.OBJ_EVT_SCHEDULED',
    symbol: 'ST_EV',
    bounds: { x: 100, y: 80, width: 160, height: 60 }
  },
  {
    id: 'ObjOcc.OCC_FUNC_CHECKLIST',
    definitionId: 'ObjDef.OBJ_FUNC_CHECKLIST',
    symbol: 'ST_FUNC',
    bounds: { x: 100, y: 220, width: 160, height: 60 }
  },
  {
    id: 'ObjOcc.OCC_EVT_FILED',
    definitionId: 'ObjDef.OBJ_EVT_FILED',
    symbol: 'ST_EV',
    bounds: { x: 100, y: 360, width: 160, height: 60 }
  }
]

const CANONICAL_PERMIT_CONNECTIONS: readonly ExpectedConnection[] = [
  {
    definitionId: 'CxnDef.CXN_APPLIED_REVIEW',
    type: 'CT_ACTIV_1',
    toDefinitionId: 'ObjDef.OBJ_FUNC_REVIEW',
    occurrenceId: 'CxnOcc.CXN_APPLIED_REVIEW',
    sourceOccurrenceId: 'ObjOcc.OCC_EVT_APPLIED',
    targetOccurrenceId: 'ObjOcc.OCC_FUNC_REVIEW',
    route: [
      { x: 180, y: 140 },
      { x: 180, y: 220 }
    ]
  },
  {
    definitionId: 'CxnDef.CXN_REVIEW_RULE',
    type: 'CT_LEADS_TO_1',
    toDefinitionId: 'ObjDef.OBJ_RULE_DOCS',
    occurrenceId: 'CxnOcc.CXN_REVIEW_RULE',
    sourceOccurrenceId: 'ObjOcc.OCC_FUNC_REVIEW',
    targetOccurrenceId: 'ObjOcc.OCC_RULE_DOCS',
    // Routeless in the workbook: deterministic bottom-centre → top-centre route.
    route: [
      { x: 180, y: 280 },
      { x: 160, y: 360 }
    ]
  },
  {
    definitionId: 'CxnDef.CXN_RULE_INSPECT',
    type: 'CT_ACTIV_1',
    toDefinitionId: 'ObjDef.OBJ_FUNC_INSPECT',
    occurrenceId: 'CxnOcc.CXN_RULE_INSPECT',
    sourceOccurrenceId: 'ObjOcc.OCC_RULE_DOCS',
    targetOccurrenceId: 'ObjOcc.OCC_FUNC_INSPECT',
    route: [
      { x: 160, y: 420 },
      { x: 180, y: 450 },
      { x: 180, y: 500 }
    ]
  },
  {
    definitionId: 'CxnDef.CXN_INSPECT_ISSUED',
    type: 'CT_CRT_1',
    toDefinitionId: 'ObjDef.OBJ_EVT_ISSUED',
    occurrenceId: 'CxnOcc.CXN_INSPECT_ISSUED',
    sourceOccurrenceId: 'ObjOcc.OCC_FUNC_INSPECT',
    targetOccurrenceId: 'ObjOcc.OCC_EVT_ISSUED',
    route: [
      { x: 180, y: 560 },
      { x: 180, y: 640 }
    ]
  },
  {
    // RACI "responsible/executes": role → function.
    definitionId: 'CxnDef.CXN_OFFICER_REVIEW',
    type: 'CT_EXEC_2',
    toDefinitionId: 'ObjDef.OBJ_FUNC_REVIEW',
    occurrenceId: 'CxnOcc.CXN_OFFICER_REVIEW',
    sourceOccurrenceId: 'ObjOcc.OCC_ROLE_OFFICER',
    targetOccurrenceId: 'ObjOcc.OCC_FUNC_REVIEW',
    route: [
      { x: 470, y: 280 },
      { x: 180, y: 220 }
    ]
  },
  {
    // RACI "consulted": role → function.
    definitionId: 'CxnDef.CXN_OFFICER_CONSULT',
    type: 'CT_MUST_BE_CONSLT_ABT_1',
    toDefinitionId: 'ObjDef.OBJ_FUNC_INSPECT',
    occurrenceId: 'CxnOcc.CXN_OFFICER_CONSULT',
    sourceOccurrenceId: 'ObjOcc.OCC_ROLE_OFFICER',
    targetOccurrenceId: 'ObjOcc.OCC_FUNC_INSPECT',
    route: [
      { x: 470, y: 280 },
      { x: 180, y: 500 }
    ]
  },
  {
    // Application system supports the review; source occurrence uses the
    // fallback geometry, so the fallback route starts at (330, 1150).
    definitionId: 'CxnDef.CXN_HUB_REVIEW',
    type: 'CT_SUPP_3',
    toDefinitionId: 'ObjDef.OBJ_FUNC_REVIEW',
    occurrenceId: 'CxnOcc.CXN_HUB_REVIEW',
    sourceOccurrenceId: 'ObjOcc.OCC_APP_HUB',
    targetOccurrenceId: 'ObjOcc.OCC_FUNC_REVIEW',
    route: [
      { x: 330, y: 1150 },
      { x: 180, y: 220 }
    ]
  }
]

const CANONICAL_INSPECTION_CONNECTIONS: readonly ExpectedConnection[] = [
  {
    definitionId: 'CxnDef.CXN_SCHEDULED_CHECKLIST',
    type: 'CT_ACTIV_1',
    toDefinitionId: 'ObjDef.OBJ_FUNC_CHECKLIST',
    occurrenceId: 'CxnOcc.CXN_SCHEDULED_CHECKLIST',
    sourceOccurrenceId: 'ObjOcc.OCC_EVT_SCHEDULED',
    targetOccurrenceId: 'ObjOcc.OCC_FUNC_CHECKLIST',
    route: [
      { x: 180, y: 140 },
      { x: 180, y: 220 }
    ]
  },
  {
    definitionId: 'CxnDef.CXN_CHECKLIST_FILED',
    type: 'CT_CRT_1',
    toDefinitionId: 'ObjDef.OBJ_EVT_FILED',
    occurrenceId: 'CxnOcc.CXN_CHECKLIST_FILED',
    sourceOccurrenceId: 'ObjOcc.OCC_FUNC_CHECKLIST',
    targetOccurrenceId: 'ObjOcc.OCC_EVT_FILED',
    route: [
      { x: 180, y: 280 },
      { x: 180, y: 360 }
    ]
  }
]

describe('Excel round trip: create-from-Excel regenerates the authored process as AML', () => {
  it('generates deterministic AML for the same parsed workbook', () => {
    const model = parseCanonicalWorkbook()
    const first = buildAmlFromArisWorkbook(model)
    const second = buildAmlFromArisWorkbook(model)
    expect(second.xml).toBe(first.xml)
    expect(first.modelCount).toBe(2)
    expect(first.objectCount).toBe(10)
    expect(first.connectionCount).toBe(9)
  })

  it('re-imports into the same models: types, bilingual names, process codes, descriptions', async () => {
    const aml = buildAmlFromArisWorkbook(parseCanonicalWorkbook())
    expect(aml.xml).toContain('<Model Model.ID="Model.MDL_PERMIT" Model.Type="MT_EEPC">')

    const document = await importGeneratedAml(aml.xml)
    expect([...document.models.keys()].sort()).toEqual(['Model.MDL_INSPECTION', 'Model.MDL_PERMIT'])

    const permit = document.models.get('Model.MDL_PERMIT')!
    expect(permit.type).toBe('MT_EEPC')
    expect(permit.unsupported).toBe(false)
    expect(textFor(permit.names, 'en')).toBe('Permit issuance')
    expect(textFor(permit.names, 'ar')).toBe('إصدار التصريح')
    // Numbering: the workbook's process_code column must land as AT_PROC_CODE.
    expect(attributeText(permit.attributes, 'AT_PROC_CODE', 'en')).toBe('DMT-100')
    expect(attributeText(permit.attributes, 'AT_DESC', 'en')).toBe(
      'Issue a commercial permit after document review and site inspection.'
    )
    expect(attributeText(permit.attributes, 'AT_DESC', 'ar')).toBe(
      'إصدار تصريح تجاري بعد مراجعة الوثائق وتفتيش الموقع.'
    )
    expect(attributeText(permit.attributes, 'AT_REM', 'en')).toBe(
      'Permits are issued within five working days of application.'
    )

    const inspection = document.models.get('Model.MDL_INSPECTION')!
    expect(inspection.type).toBe('MT_EEPC')
    expect(textFor(inspection.names, 'en')).toBe('Site inspection')
    expect(textFor(inspection.names, 'ar')).toBe('التفتيش على الموقع')
    expect(attributeText(inspection.attributes, 'AT_PROC_CODE', 'en')).toBe('DMT-110')
  })

  it('re-imports every object definition with its authored type, symbol and bilingual name', async () => {
    const aml = buildAmlFromArisWorkbook(parseCanonicalWorkbook())
    const document = await importGeneratedAml(aml.xml)
    expectDefinitions(document, CANONICAL_DEFINITIONS)

    // Object-owned workbook attributes land beside the name on the definition.
    const review = document.objectDefinitions.get('ObjDef.OBJ_FUNC_REVIEW')!
    expect(attributeText(review.attributes, 'AT_REM', 'en')).toBe(
      'Verify the applicant identity and plot documents.'
    )
    expect(attributeText(review.attributes, 'AT_REM', 'ar')).toBe(
      'تحقق من هوية مقدم الطلب ووثائق الأرض.'
    )
  })

  it('re-imports every occurrence in authored order with its authored geometry', async () => {
    const aml = buildAmlFromArisWorkbook(parseCanonicalWorkbook())
    const document = await importGeneratedAml(aml.xml)
    expectModelOccurrences(document, 'Model.MDL_PERMIT', CANONICAL_PERMIT_OCCURRENCES)
    expectModelOccurrences(document, 'Model.MDL_INSPECTION', CANONICAL_INSPECTION_OCCURRENCES)
  })

  it('re-imports every connection with its authored type, endpoints and route', async () => {
    const aml = buildAmlFromArisWorkbook(parseCanonicalWorkbook())
    const document = await importGeneratedAml(aml.xml)
    expectConnections(document, 'Model.MDL_PERMIT', CANONICAL_PERMIT_CONNECTIONS)
    expectConnections(document, 'Model.MDL_INSPECTION', CANONICAL_INSPECTION_CONNECTIONS)
  })

  it('preserves the RACI wiring between the officer role and the two functions', async () => {
    const aml = buildAmlFromArisWorkbook(parseCanonicalWorkbook())
    expect(aml.xml).toContain('CxnDef.Type="CT_EXEC_2"')
    expect(aml.xml).toContain('CxnDef.Type="CT_MUST_BE_CONSLT_ABT_1"')

    const document = await importGeneratedAml(aml.xml)
    const raci = CANONICAL_PERMIT_CONNECTIONS.filter((connection) =>
      ['CxnDef.CXN_OFFICER_REVIEW', 'CxnDef.CXN_OFFICER_CONSULT'].includes(connection.definitionId)
    )
    expect(raci).toHaveLength(2)
    expectConnectionDetails(document, 'Model.MDL_PERMIT', raci)
    // The role itself is a first-class definition, not a lost satellite.
    const role = document.objectDefinitions.get('ObjDef.OBJ_ROLE_OFFICER')!
    expect(role.type).toBe('OT_PERS_TYPE')
    expect(textFor(role.names, 'en')).toBe('Permit officer')
  })
})

// --- suite 3 --------------------------------------------------------------------

const EXAMPLE_MODELS = [
  {
    id: 'Model.MDL_LEAVE',
    type: 'MT_EEPC',
    en: 'Leave approval',
    ar: 'الموافقة على الإجازة',
    processCode: 'HR-001'
  },
  {
    id: 'Model.MDL_CHAIN',
    type: 'MT_VAL_ADD_CHN_DGM',
    en: 'Human resources value chain',
    ar: 'سلسلة القيمة للموارد البشرية',
    processCode: 'HR-000'
  },
  {
    id: 'Model.MDL_DETAIL',
    type: 'MT_EEPC',
    en: 'Leave entitlement check',
    ar: 'التحقق من استحقاق الإجازة',
    processCode: 'HR-002'
  }
] as const

const EXAMPLE_DEFINITIONS: readonly ExpectedDefinition[] = [
  {
    id: 'ObjDef.OBJ_EVT_SUBMITTED',
    type: 'OT_EVT',
    symbol: 'ST_EV',
    en: 'Leave request submitted',
    ar: 'تم تقديم طلب الإجازة'
  },
  {
    id: 'ObjDef.OBJ_FUNC_REVIEW',
    type: 'OT_FUNC',
    symbol: 'ST_FUNC',
    en: 'Review leave request',
    ar: 'مراجعة طلب الإجازة'
  },
  {
    id: 'ObjDef.OBJ_RULE_DECISION',
    type: 'OT_RULE',
    symbol: 'ST_OPR_XOR_1',
    en: 'Request approved?',
    ar: 'هل تمت الموافقة على الطلب؟'
  },
  {
    id: 'ObjDef.OBJ_EVT_APPROVED',
    type: 'OT_EVT',
    symbol: 'ST_EV',
    en: 'Leave request approved',
    ar: 'تمت الموافقة على طلب الإجازة'
  },
  {
    id: 'ObjDef.OBJ_EVT_REJECTED',
    type: 'OT_EVT',
    symbol: 'ST_EV',
    en: 'Leave request rejected',
    ar: 'تم رفض طلب الإجازة'
  },
  {
    id: 'ObjDef.OBJ_PERS_MANAGER',
    type: 'OT_PERS_TYPE',
    symbol: 'ST_PERS_TYPE',
    en: 'Line manager',
    ar: 'المدير المباشر'
  },
  {
    id: 'ObjDef.OBJ_FUNC_RECRUIT',
    type: 'OT_FUNC',
    symbol: 'ST_VAL_ADD_CHN',
    en: 'Recruit employees',
    ar: 'توظيف الموظفين'
  },
  {
    id: 'ObjDef.OBJ_FUNC_ADMINISTER',
    type: 'OT_FUNC',
    symbol: 'ST_VAL_ADD_CHN',
    en: 'Administer leave',
    ar: 'إدارة الإجازات'
  },
  {
    id: 'ObjDef.OBJ_EVT_CHECK_STARTED',
    type: 'OT_EVT',
    symbol: 'ST_EV',
    en: 'Entitlement check started',
    ar: 'بدأ التحقق من الاستحقاق'
  },
  {
    id: 'ObjDef.OBJ_FUNC_CHECK',
    type: 'OT_FUNC',
    symbol: 'ST_FUNC',
    en: 'Check leave balance',
    ar: 'التحقق من رصيد الإجازات'
  },
  {
    id: 'ObjDef.OBJ_EVT_CHECK_DONE',
    type: 'OT_EVT',
    symbol: 'ST_EV',
    en: 'Entitlement check completed',
    ar: 'اكتمل التحقق من الاستحقاق'
  }
]

const EXAMPLE_LEAVE_OCCURRENCES: readonly ExpectedOccurrence[] = [
  {
    id: 'ObjOcc.OCC_EVT_SUBMITTED',
    definitionId: 'ObjDef.OBJ_EVT_SUBMITTED',
    symbol: 'ST_EV',
    bounds: { x: 120, y: 80, width: 160, height: 60 }
  },
  {
    id: 'ObjOcc.OCC_FUNC_REVIEW',
    definitionId: 'ObjDef.OBJ_FUNC_REVIEW',
    symbol: 'ST_FUNC',
    bounds: { x: 120, y: 200, width: 160, height: 60 }
  },
  {
    id: 'ObjOcc.OCC_RULE_DECISION',
    definitionId: 'ObjDef.OBJ_RULE_DECISION',
    symbol: 'ST_OPR_XOR_1',
    bounds: { x: 170, y: 320, width: 60, height: 60 }
  },
  {
    id: 'ObjOcc.OCC_EVT_APPROVED',
    definitionId: 'ObjDef.OBJ_EVT_APPROVED',
    symbol: 'ST_EV',
    bounds: { x: 20, y: 440, width: 160, height: 60 }
  },
  {
    id: 'ObjOcc.OCC_EVT_REJECTED',
    definitionId: 'ObjDef.OBJ_EVT_REJECTED',
    symbol: 'ST_EV',
    bounds: { x: 240, y: 440, width: 160, height: 60 }
  },
  {
    id: 'ObjOcc.OCC_PERS_MANAGER',
    definitionId: 'ObjDef.OBJ_PERS_MANAGER',
    symbol: 'ST_PERS_TYPE',
    bounds: { x: 340, y: 200, width: 140, height: 60 }
  }
]

const EXAMPLE_CHAIN_OCCURRENCES: readonly ExpectedOccurrence[] = [
  {
    id: 'ObjOcc.OCC_FUNC_RECRUIT',
    definitionId: 'ObjDef.OBJ_FUNC_RECRUIT',
    symbol: 'ST_VAL_ADD_CHN',
    bounds: { x: 60, y: 60, width: 200, height: 80 }
  },
  {
    id: 'ObjOcc.OCC_FUNC_ADMINISTER',
    definitionId: 'ObjDef.OBJ_FUNC_ADMINISTER',
    symbol: 'ST_VAL_ADD_CHN',
    bounds: { x: 300, y: 60, width: 200, height: 80 }
  }
]

const EXAMPLE_DETAIL_OCCURRENCES: readonly ExpectedOccurrence[] = [
  {
    id: 'ObjOcc.OCC_EVT_CHECK_STARTED',
    definitionId: 'ObjDef.OBJ_EVT_CHECK_STARTED',
    symbol: 'ST_EV',
    bounds: { x: 120, y: 80, width: 160, height: 60 }
  },
  {
    id: 'ObjOcc.OCC_FUNC_CHECK',
    definitionId: 'ObjDef.OBJ_FUNC_CHECK',
    symbol: 'ST_FUNC',
    bounds: { x: 120, y: 200, width: 160, height: 60 }
  },
  {
    id: 'ObjOcc.OCC_EVT_CHECK_DONE',
    definitionId: 'ObjDef.OBJ_EVT_CHECK_DONE',
    symbol: 'ST_EV',
    bounds: { x: 120, y: 320, width: 160, height: 60 }
  }
]

const EXAMPLE_LEAVE_CONNECTIONS: readonly ExpectedConnection[] = [
  {
    definitionId: 'CxnDef.CXN_SUBMITTED_REVIEW',
    type: 'CT_ACT_1',
    toDefinitionId: 'ObjDef.OBJ_FUNC_REVIEW',
    occurrenceId: 'CxnOcc.CXN_SUBMITTED_REVIEW',
    sourceOccurrenceId: 'ObjOcc.OCC_EVT_SUBMITTED',
    targetOccurrenceId: 'ObjOcc.OCC_FUNC_REVIEW',
    route: [
      { x: 200, y: 140 },
      { x: 200, y: 200 }
    ]
  },
  {
    definitionId: 'CxnDef.CXN_REVIEW_RULE',
    type: 'CT_CRT_1',
    toDefinitionId: 'ObjDef.OBJ_RULE_DECISION',
    occurrenceId: 'CxnOcc.CXN_REVIEW_RULE',
    sourceOccurrenceId: 'ObjOcc.OCC_FUNC_REVIEW',
    targetOccurrenceId: 'ObjOcc.OCC_RULE_DECISION',
    route: [
      { x: 200, y: 260 },
      { x: 200, y: 320 }
    ]
  },
  {
    definitionId: 'CxnDef.CXN_RULE_APPROVED',
    type: 'CT_CRT_1',
    toDefinitionId: 'ObjDef.OBJ_EVT_APPROVED',
    occurrenceId: 'CxnOcc.CXN_RULE_APPROVED',
    sourceOccurrenceId: 'ObjOcc.OCC_RULE_DECISION',
    targetOccurrenceId: 'ObjOcc.OCC_EVT_APPROVED',
    route: [
      { x: 200, y: 380 },
      { x: 100, y: 410 },
      { x: 100, y: 440 }
    ]
  },
  {
    definitionId: 'CxnDef.CXN_RULE_REJECTED',
    type: 'CT_CRT_1',
    toDefinitionId: 'ObjDef.OBJ_EVT_REJECTED',
    occurrenceId: 'CxnOcc.CXN_RULE_REJECTED',
    sourceOccurrenceId: 'ObjOcc.OCC_RULE_DECISION',
    targetOccurrenceId: 'ObjOcc.OCC_EVT_REJECTED',
    route: [
      { x: 200, y: 380 },
      { x: 320, y: 410 },
      { x: 320, y: 440 }
    ]
  },
  {
    // RACI in the official example: the line manager executes the review.
    definitionId: 'CxnDef.CXN_MANAGER_REVIEW',
    type: 'CT_EXEC_2',
    toDefinitionId: 'ObjDef.OBJ_FUNC_REVIEW',
    occurrenceId: 'CxnOcc.CXN_MANAGER_REVIEW',
    sourceOccurrenceId: 'ObjOcc.OCC_PERS_MANAGER',
    targetOccurrenceId: 'ObjOcc.OCC_FUNC_REVIEW',
    route: [
      { x: 410, y: 260 },
      { x: 200, y: 200 }
    ]
  }
]

const EXAMPLE_CHAIN_CONNECTIONS: readonly ExpectedConnection[] = [
  {
    definitionId: 'CxnDef.CXN_CHAIN_SEQUENCE',
    type: 'CT_IS_PREDEC_OF_1',
    toDefinitionId: 'ObjDef.OBJ_FUNC_ADMINISTER',
    occurrenceId: 'CxnOcc.CXN_CHAIN_SEQUENCE',
    sourceOccurrenceId: 'ObjOcc.OCC_FUNC_RECRUIT',
    targetOccurrenceId: 'ObjOcc.OCC_FUNC_ADMINISTER',
    route: [
      { x: 160, y: 140 },
      { x: 400, y: 60 }
    ]
  }
]

const EXAMPLE_DETAIL_CONNECTIONS: readonly ExpectedConnection[] = [
  {
    definitionId: 'CxnDef.CXN_DETAIL_START',
    type: 'CT_ACT_1',
    toDefinitionId: 'ObjDef.OBJ_FUNC_CHECK',
    occurrenceId: 'CxnOcc.CXN_DETAIL_START',
    sourceOccurrenceId: 'ObjOcc.OCC_EVT_CHECK_STARTED',
    targetOccurrenceId: 'ObjOcc.OCC_FUNC_CHECK',
    route: [
      { x: 200, y: 140 },
      { x: 200, y: 200 }
    ]
  },
  {
    definitionId: 'CxnDef.CXN_DETAIL_END',
    type: 'CT_CRT_1',
    toDefinitionId: 'ObjDef.OBJ_EVT_CHECK_DONE',
    occurrenceId: 'CxnOcc.CXN_DETAIL_END',
    sourceOccurrenceId: 'ObjOcc.OCC_FUNC_CHECK',
    targetOccurrenceId: 'ObjOcc.OCC_EVT_CHECK_DONE',
    route: [
      { x: 200, y: 260 },
      { x: 200, y: 320 }
    ]
  }
]

describe('Excel round trip: the official example workbook regenerates the documented process', () => {
  it('parses the example template and regenerates its three documented models', async () => {
    const model = accept(
      parseArisWorkbook(ARIS_TEMPLATE_ASSET_NAMES.example, createArisTemplateWorkbook('example'))
    )
    const aml = buildAmlFromArisWorkbook(model)
    expect(aml.modelCount).toBe(3)
    expect(aml.objectCount).toBe(11)
    expect(aml.connectionCount).toBe(8)
    // Deterministic end to end: same template bytes, same AML.
    expect(buildAmlFromArisWorkbook(model).xml).toBe(aml.xml)

    const document = await importGeneratedAml(aml.xml)
    expect([...document.models.keys()].sort()).toEqual(
      EXAMPLE_MODELS.map((expected) => expected.id).sort()
    )
    for (const expected of EXAMPLE_MODELS) {
      const actual = document.models.get(expected.id)!
      expect(actual.type, expected.id).toBe(expected.type)
      expect(actual.unsupported, expected.id).toBe(false)
      expect(textFor(actual.names, 'en'), expected.id).toBe(expected.en)
      expect(textFor(actual.names, 'ar'), expected.id).toBe(expected.ar)
      expect(attributeText(actual.attributes, 'AT_PROC_CODE', 'en'), expected.id).toBe(
        expected.processCode
      )
    }
    // The documented leave model carries its authored description and remark.
    const leave = document.models.get('Model.MDL_LEAVE')!
    expect(attributeText(leave.attributes, 'AT_DESC', 'en')).toBe(
      'Review and decide an employee leave request.'
    )
  })

  it('regenerates every documented object definition', async () => {
    const model = accept(
      parseArisWorkbook(ARIS_TEMPLATE_ASSET_NAMES.example, createArisTemplateWorkbook('example'))
    )
    const document = await importGeneratedAml(buildAmlFromArisWorkbook(model).xml)
    expectDefinitions(document, EXAMPLE_DEFINITIONS)
    const review = document.objectDefinitions.get('ObjDef.OBJ_FUNC_REVIEW')!
    expect(attributeText(review.attributes, 'AT_REM', 'en')).toBe(
      'Check entitlement and operational coverage.'
    )
    expect(attributeText(review.attributes, 'AT_REM', 'ar')).toBe(
      'التحقق من الاستحقاق والتغطية التشغيلية.'
    )
  })

  it('regenerates every documented occurrence with its authored geometry', async () => {
    const model = accept(
      parseArisWorkbook(ARIS_TEMPLATE_ASSET_NAMES.example, createArisTemplateWorkbook('example'))
    )
    const document = await importGeneratedAml(buildAmlFromArisWorkbook(model).xml)
    expectModelOccurrences(document, 'Model.MDL_LEAVE', EXAMPLE_LEAVE_OCCURRENCES)
    expectModelOccurrences(document, 'Model.MDL_CHAIN', EXAMPLE_CHAIN_OCCURRENCES)
    expectModelOccurrences(document, 'Model.MDL_DETAIL', EXAMPLE_DETAIL_OCCURRENCES)
  })

  it('regenerates every documented connection with its type, endpoints and route', async () => {
    const model = accept(
      parseArisWorkbook(ARIS_TEMPLATE_ASSET_NAMES.example, createArisTemplateWorkbook('example'))
    )
    const document = await importGeneratedAml(buildAmlFromArisWorkbook(model).xml)
    expectConnections(document, 'Model.MDL_LEAVE', EXAMPLE_LEAVE_CONNECTIONS)
    expectConnections(document, 'Model.MDL_CHAIN', EXAMPLE_CHAIN_CONNECTIONS)
    expectConnections(document, 'Model.MDL_DETAIL', EXAMPLE_DETAIL_CONNECTIONS)
  })
})
