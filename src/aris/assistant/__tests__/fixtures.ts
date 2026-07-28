// Synthetic bilingual ARIS model fixtures used across the assistant's test
// suite. English content mirrors the shape of the real (private, not
// committed) `../../reference/AnimalWF/ARISAMLExport.xml` fixture (animal
// registration workflow terms), but the Arabic text here is HAND-WRITTEN —
// the real AnimalWF export declares Arabic locales but its Arabic-locale
// text slots are empty (see realData.test.ts), so there is no real Arabic
// content to draw from. These Arabic strings are realistic domain
// translations chosen to exercise diacritics-free normal Arabic script,
// definite-article clitics, and taa marbuta endings.

import type { ArisAssistantAttribute, ArisAssistantLocalizedText, ArisAssistantModelInput } from '../types'

export function lt(en: string | null, ar: string | null): ArisAssistantLocalizedText {
  return { en, ar, fallback: en ?? ar }
}

export function attr(type: string, en: string | null, ar: string | null): ArisAssistantAttribute {
  return { type, text: lt(en, ar) }
}

/**
 * "Owner Registration" EPC: start event -> function (with responsible
 * person, supporting system, one input, one output) -> event -> XOR gateway
 * (with a decision basis) with two explicitly-labeled outcomes, one of which
 * loops back to the earlier function (a return branch), the other reaching a
 * second function and an end event. Also carries one occurrence with a
 * linked/assigned model (an escalation function) and one intentionally
 * under-described function (no English name, no inputs) to exercise gap
 * detection.
 */
export function buildSyntheticModel(): ArisAssistantModelInput {
  return {
    relPath: 'processes/owner-registration.aml',
    modelId: 'm1',
    modelType: 'MT_EEPC',
    names: lt('Owner Registration', 'تسجيل المالك'),
    attributes: [
      attr('AT_PROC_CODE', 'REG-001', null),
      attr('AT_PERS_RESP', 'Animal Welfare Division', 'قسم رعاية الحيوان')
    ],
    occurrences: [
      {
        occurrenceId: 'occ-start',
        definitionId: 'def-start',
        objectType: 'OT_EVT',
        symbol: 'ST_EV',
        names: lt('Registration requested', 'تم طلب التسجيل'),
        attributes: [],
        linkedModelIds: []
      },
      {
        occurrenceId: 'occ-fn1',
        definitionId: 'def-fn1',
        objectType: 'OT_FUNC',
        symbol: 'ST_FUNC',
        names: lt('Register owner profile', 'تسجيل ملف المالك'),
        attributes: [],
        linkedModelIds: []
      },
      {
        occurrenceId: 'occ-person1',
        definitionId: 'def-person1',
        objectType: 'OT_PERS',
        symbol: 'ST_PERS_EXT',
        names: lt('Veterinarian', 'الطبيب البيطري'),
        attributes: [],
        linkedModelIds: []
      },
      {
        occurrenceId: 'occ-sys1',
        definitionId: 'def-sys1',
        objectType: 'OT_APPL_SYS',
        symbol: 'ST_APPL_SYS',
        names: lt('Animal Management System', 'نظام إدارة الحيوانات'),
        attributes: [],
        linkedModelIds: []
      },
      {
        occurrenceId: 'occ-info-in',
        definitionId: 'def-info-in',
        objectType: 'OT_INFO_CARR',
        symbol: 'ST_DOC',
        names: lt('Owner ID Document', 'وثيقة هوية المالك'),
        attributes: [],
        linkedModelIds: []
      },
      {
        occurrenceId: 'occ-info-out',
        definitionId: 'def-info-out',
        objectType: 'OT_INFO_CARR',
        symbol: 'ST_DOC',
        names: lt('Registration Certificate', 'شهادة التسجيل'),
        attributes: [],
        linkedModelIds: []
      },
      {
        occurrenceId: 'occ-evt2',
        definitionId: 'def-evt2',
        objectType: 'OT_EVT',
        symbol: 'ST_EV',
        names: lt('Profile registered', 'تم تسجيل الملف'),
        attributes: [],
        linkedModelIds: []
      },
      {
        occurrenceId: 'occ-rule1',
        definitionId: 'def-rule1',
        objectType: 'OT_RULE',
        symbol: 'ST_OPR_XOR_1',
        names: lt('Application reviewed', 'تمت مراجعة الطلب'),
        attributes: [],
        linkedModelIds: []
      },
      {
        occurrenceId: 'occ-policy1',
        definitionId: 'def-policy1',
        objectType: 'OT_POLICY',
        symbol: 'ST_BUSINESS_POLICY',
        names: lt('Registration Policy', 'سياسة التسجيل'),
        attributes: [],
        linkedModelIds: []
      },
      {
        occurrenceId: 'occ-evt-approved',
        definitionId: 'def-evt-approved',
        objectType: 'OT_EVT',
        symbol: 'ST_EV',
        names: lt('Approved', 'تمت الموافقة'),
        attributes: [],
        linkedModelIds: []
      },
      {
        occurrenceId: 'occ-evt-rejected',
        definitionId: 'def-evt-rejected',
        objectType: 'OT_EVT',
        symbol: 'ST_EV',
        names: lt('Rejected', 'تم الرفض'),
        attributes: [],
        linkedModelIds: []
      },
      {
        occurrenceId: 'occ-fn2',
        definitionId: 'def-fn2',
        objectType: 'OT_FUNC',
        symbol: 'ST_FUNC',
        names: lt('Issue certificate', 'إصدار الشهادة'),
        attributes: [],
        linkedModelIds: []
      },
      {
        occurrenceId: 'occ-fn-return',
        definitionId: 'def-fn-return',
        objectType: 'OT_FUNC',
        symbol: 'ST_FUNC',
        // Intentionally no English name (gap: missingNameEn) and no
        // inputs/outputs/system recorded (gaps: missingInputs/Outputs/System).
        names: lt(null, 'طلب مستندات إضافية'),
        attributes: [],
        linkedModelIds: []
      },
      {
        occurrenceId: 'occ-endevt',
        definitionId: 'def-endevt',
        objectType: 'OT_EVT',
        symbol: 'ST_EV',
        names: lt('Certificate issued', 'تم إصدار الشهادة'),
        attributes: [],
        linkedModelIds: []
      },
      {
        occurrenceId: 'occ-escalate',
        definitionId: 'def-escalate',
        objectType: 'OT_FUNC',
        symbol: 'ST_FUNC',
        names: lt('Escalate to committee', 'التصعيد إلى اللجنة'),
        attributes: [],
        linkedModelIds: ['m2-committee-review']
      }
    ],
    connectionOccurrences: [
      {
        occurrenceId: 'cxn-start-fn1',
        definitionId: 'cd-start-fn1',
        connectionType: 'CT_ACTIV_1',
        sourceOccurrenceId: 'occ-start',
        targetOccurrenceId: 'occ-fn1',
        names: lt(null, null)
      },
      {
        occurrenceId: 'cxn-person-fn1',
        definitionId: 'cd-person-fn1',
        connectionType: 'CT_EXEC_1',
        sourceOccurrenceId: 'occ-person1',
        targetOccurrenceId: 'occ-fn1',
        names: lt(null, null)
      },
      {
        occurrenceId: 'cxn-sys-fn1',
        definitionId: 'cd-sys-fn1',
        connectionType: 'CT_SUPP_3',
        sourceOccurrenceId: 'occ-sys1',
        targetOccurrenceId: 'occ-fn1',
        names: lt(null, null)
      },
      {
        occurrenceId: 'cxn-infoin-fn1',
        definitionId: 'cd-infoin-fn1',
        connectionType: 'CT_IS_INP_FOR',
        sourceOccurrenceId: 'occ-info-in',
        targetOccurrenceId: 'occ-fn1',
        names: lt(null, null)
      },
      {
        occurrenceId: 'cxn-fn1-infoout',
        definitionId: 'cd-fn1-infoout',
        connectionType: 'CT_CRT_OUT_TO',
        sourceOccurrenceId: 'occ-fn1',
        targetOccurrenceId: 'occ-info-out',
        names: lt(null, null)
      },
      {
        occurrenceId: 'cxn-fn1-evt2',
        definitionId: 'cd-fn1-evt2',
        connectionType: 'CT_ACTIV_1',
        sourceOccurrenceId: 'occ-fn1',
        targetOccurrenceId: 'occ-evt2',
        names: lt(null, null)
      },
      {
        occurrenceId: 'cxn-evt2-rule1',
        definitionId: 'cd-evt2-rule1',
        connectionType: 'CT_ACTIV_1',
        sourceOccurrenceId: 'occ-evt2',
        targetOccurrenceId: 'occ-rule1',
        names: lt(null, null)
      },
      {
        occurrenceId: 'cxn-policy-rule1',
        definitionId: 'cd-policy-rule1',
        connectionType: 'CT_IS_EVAL_BY_1',
        sourceOccurrenceId: 'occ-policy1',
        targetOccurrenceId: 'occ-rule1',
        names: lt(null, null)
      },
      {
        occurrenceId: 'cxn-rule1-approved',
        definitionId: 'cd-rule1-approved',
        connectionType: 'CT_LEADS_TO_1',
        sourceOccurrenceId: 'occ-rule1',
        targetOccurrenceId: 'occ-evt-approved',
        names: lt('Approved', 'موافقة')
      },
      {
        occurrenceId: 'cxn-rule1-rejected',
        definitionId: 'cd-rule1-rejected',
        connectionType: 'CT_LEADS_TO_2',
        sourceOccurrenceId: 'occ-rule1',
        targetOccurrenceId: 'occ-evt-rejected',
        names: lt('Rejected', 'مرفوض')
      },
      {
        occurrenceId: 'cxn-approved-fn2',
        definitionId: 'cd-approved-fn2',
        connectionType: 'CT_ACTIV_1',
        sourceOccurrenceId: 'occ-evt-approved',
        targetOccurrenceId: 'occ-fn2',
        names: lt(null, null)
      },
      {
        occurrenceId: 'cxn-rejected-fnreturn',
        definitionId: 'cd-rejected-fnreturn',
        connectionType: 'CT_ACTIV_1',
        sourceOccurrenceId: 'occ-evt-rejected',
        targetOccurrenceId: 'occ-fn-return',
        names: lt(null, null)
      },
      {
        occurrenceId: 'cxn-fnreturn-fn1',
        definitionId: 'cd-fnreturn-fn1',
        connectionType: 'CT_ACTIV_1',
        sourceOccurrenceId: 'occ-fn-return',
        targetOccurrenceId: 'occ-fn1',
        names: lt(null, null)
      },
      {
        occurrenceId: 'cxn-fn2-endevt',
        definitionId: 'cd-fn2-endevt',
        connectionType: 'CT_ACTIV_1',
        sourceOccurrenceId: 'occ-fn2',
        targetOccurrenceId: 'occ-endevt',
        names: lt(null, null)
      }
    ],
    revision: 1,
    sourceDigest: 'digest-m1-rev1'
  }
}

/** A second, minimal, unrelated model used for cross-model disambiguation and cache-isolation tests. */
export function buildSecondSyntheticModel(): ArisAssistantModelInput {
  return {
    relPath: 'processes/animal-vaccination.aml',
    modelId: 'm2',
    modelType: 'MT_EEPC',
    names: lt('Animal Vaccination', 'تطعيم الحيوان'),
    attributes: [attr('AT_PERS_RESP', 'Veterinary Services', 'الخدمات البيطرية')],
    occurrences: [
      {
        occurrenceId: 'occ2-start',
        definitionId: 'def2-start',
        objectType: 'OT_EVT',
        symbol: 'ST_EV',
        names: lt('Vaccination due', 'حان موعد التطعيم'),
        attributes: [],
        linkedModelIds: []
      },
      {
        occurrenceId: 'occ2-fn1',
        definitionId: 'def2-fn1',
        objectType: 'OT_FUNC',
        symbol: 'ST_FUNC',
        names: lt('Administer vaccine', 'إعطاء اللقاح'),
        attributes: [],
        linkedModelIds: []
      },
      {
        occurrenceId: 'occ2-end',
        definitionId: 'def2-end',
        objectType: 'OT_EVT',
        symbol: 'ST_EV',
        names: lt('Vaccine administered', 'تم إعطاء اللقاح'),
        attributes: [],
        linkedModelIds: []
      }
    ],
    connectionOccurrences: [
      {
        occurrenceId: 'cxn2-start-fn1',
        definitionId: 'cd2-start-fn1',
        connectionType: 'CT_ACTIV_1',
        sourceOccurrenceId: 'occ2-start',
        targetOccurrenceId: 'occ2-fn1',
        names: lt(null, null)
      },
      {
        occurrenceId: 'cxn2-fn1-end',
        definitionId: 'cd2-fn1-end',
        connectionType: 'CT_ACTIV_1',
        sourceOccurrenceId: 'occ2-fn1',
        targetOccurrenceId: 'occ2-end',
        names: lt(null, null)
      }
    ],
    revision: 1,
    sourceDigest: 'digest-m2-rev1'
  }
}
