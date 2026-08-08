/**
 * Section 16.6 step 8: "Validate object/model/connection types." An unknown
 * type is a validation failure with a precise, structured finding — never a
 * silent drop.
 *
 * Scope note: this module checks *type vocabulary* only (is `objectType`
 * one of the supported codes?). It does not implement EPC semantics
 * (chronology, split/merge pairing, "events never decide", start/end
 * completeness) — that is Section 14.1's "EPC semantic validator", owned by
 * another agent building src/aris/epc/. The one exception is the AND/OR/XOR
 * `symbolType` check below, which is a closed-vocabulary type check (like
 * the others in this module), not a semantic graph check.
 */

import { ARIS_AI_SUPPORTED_MODEL_TYPES, type ArisAiDraftV1 } from './contract'
import { finding, type ArisAiValidationFinding } from './findings'

/**
 * Section 11.3: "Supported AnimalWF object types" — full create/edit/
 * delete/connect support list.
 */
export const ARIS_AI_SUPPORTED_OBJECT_TYPES = [
  'OT_FUNC',
  'OT_EVT',
  'OT_RULE',
  'OT_ENT_TYPE',
  'OT_INFO_CARR',
  'OT_BUSINESS_RULE',
  'OT_PERF',
  'OT_APPL_SYS',
  'OT_PERS',
  'OT_REQUIREMENT',
  'OT_POLICY',
  'OT_PERS_TYPE',
  // Satellite symbol-variant object types (2026-08-07): richer role/system/
  // control satellites projected from the canonical `kind` discriminator. Each
  // pairs with a registered card() presentation in src/aris/symbols/shapes.ts
  // (OT_POS/OT_ORG_UNIT/OT_GRP roles, OT_SERVICE system, OT_RISK control).
  'OT_POS',
  'OT_ORG_UNIT',
  'OT_GRP',
  'OT_SERVICE',
  'OT_RISK'
] as const

const SUPPORTED_OBJECT_TYPE_SET: ReadonlySet<string> = new Set(ARIS_AI_SUPPORTED_OBJECT_TYPES)

// Section 11.2: "Supported model types — first stable scope." Reused from
// contract.ts (same list that constrains `ArisAiModel.modelType`) so the two
// checks can never drift apart.
const SUPPORTED_MODEL_TYPE_SET: ReadonlySet<string> = new Set(ARIS_AI_SUPPORTED_MODEL_TYPES)

/**
 * Valid EPC connection types. This vocabulary was derived from the
 * `CxnDef.Type` values actually present in
 * ../../../../reference/AnimalWF/ARISAMLExport.xml — the same reference
 * study used for the real-id shape in forbiddenContent.ts. These are
 * generic ARIS type-code constants (the same category as the `OT_*` codes
 * Section 11.3 lists explicitly), not reproduced business content.
 */
export const ARIS_AI_SUPPORTED_CONNECTION_TYPES = [
  'CT_ACTIV_1',
  'CT_AFFECTS',
  'CT_CRT_1',
  'CT_CRT_OUT_TO',
  'CT_EXEC_1',
  'CT_EXEC_2',
  'CT_HAS_OUT',
  'CT_IS_EVAL_BY_1',
  'CT_IS_INP_FOR',
  'CT_IS_PRCS_ORNT_SUPER',
  'CT_IS_PREDEC_OF_1',
  'CT_LEADS_TO_1',
  'CT_LEADS_TO_2',
  'CT_MUST_BE_INFO_ABT_1',
  'CT_READ_1',
  'CT_REFS_TO_2',
  'CT_SUPP_3'
] as const

const SUPPORTED_CONNECTION_TYPE_SET: ReadonlySet<string> = new Set(
  ARIS_AI_SUPPORTED_CONNECTION_TYPES
)

/**
 * Section 16.5: "Use native AND/OR/XOR rules." Native ARIS rule symbols for
 * `OT_RULE` objects. Closed-vocabulary type check only (no split/merge
 * pairing logic here — see the scope note above).
 */
export const ARIS_AI_SUPPORTED_RULE_SYMBOL_TYPES = [
  'ST_OPR_AND_1',
  'ST_OPR_OR_1',
  'ST_OPR_XOR_1'
] as const

const SUPPORTED_RULE_SYMBOL_TYPE_SET: ReadonlySet<string> = new Set(
  ARIS_AI_SUPPORTED_RULE_SYMBOL_TYPES
)

export function validateArisAiTypes(draft: ArisAiDraftV1): ArisAiValidationFinding[] {
  const findings: ArisAiValidationFinding[] = []

  draft.models.forEach((model, index) => {
    if (!SUPPORTED_MODEL_TYPE_SET.has(model.modelType)) {
      findings.push(
        finding(
          'unsupported-model-type',
          `$.models[${index}].modelType`,
          `Model type "${model.modelType}" is not in the supported set (${ARIS_AI_SUPPORTED_MODEL_TYPES.join(', ')}).`
        )
      )
    }
  })

  draft.objects.forEach((object, index) => {
    if (!SUPPORTED_OBJECT_TYPE_SET.has(object.objectType)) {
      findings.push(
        finding(
          'unsupported-object-type',
          `$.objects[${index}].objectType`,
          `Object type "${object.objectType}" is not in the supported AnimalWF object-type set.`
        )
      )
    }
    if (
      object.objectType === 'OT_RULE' &&
      object.symbolType !== undefined &&
      !SUPPORTED_RULE_SYMBOL_TYPE_SET.has(object.symbolType)
    ) {
      findings.push(
        finding(
          'unsupported-rule-symbol-type',
          `$.objects[${index}].symbolType`,
          `Rule symbol "${object.symbolType}" is not a native AND/OR/XOR symbol (${ARIS_AI_SUPPORTED_RULE_SYMBOL_TYPES.join(', ')}).`
        )
      )
    }
  })

  draft.relations.forEach((relation, index) => {
    if (!SUPPORTED_CONNECTION_TYPE_SET.has(relation.connectionType)) {
      findings.push(
        finding(
          'unsupported-connection-type',
          `$.relations[${index}].connectionType`,
          `Connection type "${relation.connectionType}" is not in the supported EPC connection-type set (${ARIS_AI_SUPPORTED_CONNECTION_TYPES.join(', ')}).`
        )
      )
    }
  })

  return findings
}
