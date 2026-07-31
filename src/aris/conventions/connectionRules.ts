/**
 * ARIS convention connection rules (plan R2).
 *
 * This table is the policy source for which connection type to mint when a user
 * draws an edge between two object types in a given model.  Existing triples
 * from `src/aris/canvas/vocabulary.ts` are reproduced verbatim so callers can
 * migrate to this catalog without changing behaviour.
 */

import type { ArisSymbolVerification } from './catalog'

export type RaciLetter = 'R' | 'A' | 'C' | 'I'

export interface ArisConnectionRule {
  readonly modelType: string | null
  readonly from: string
  readonly to: string
  readonly connectionType: string
  readonly labelKey: string
  readonly raci: RaciLetter | null
  readonly verification: ArisSymbolVerification
}

export const ARIS_FALLBACK_CONNECTION_TYPE = 'CT_REFS_TO_2'

/**
 * The first matching rule in this ordered list is the canonical type returned
 * by `resolveConventionConnection`; model-type-specific rules therefore win
 * when they precede model-type-independent ones. Existing `vocabulary.ts`
 * triples are kept at the top in their original order; R2 additions follow.
 * Alternate connection types observed in the AnimalWF DMT export are
 * deliberately listed last: they extend legality without changing the
 * established canonical type minted for an endpoint pair.
 */
export const ARIS_CONNECTION_RULES: readonly ArisConnectionRule[] = Object.freeze([
  // --- EEPC control flow (verbatim from src/aris/canvas/vocabulary.ts) ------
  Object.freeze({
    modelType: 'MT_EEPC',
    from: 'OT_EVT',
    to: 'OT_FUNC',
    connectionType: 'CT_ACTIV_1',
    labelKey: 'aris.connection.activatesTriggers',
    raci: null,
    verification: 'fixture'
  }),
  Object.freeze({
    modelType: 'MT_EEPC',
    from: 'OT_RULE',
    to: 'OT_FUNC',
    connectionType: 'CT_ACTIV_1',
    labelKey: 'aris.connection.activatesTriggers',
    raci: null,
    verification: 'fixture'
  }),
  Object.freeze({
    modelType: 'MT_EEPC',
    from: 'OT_FUNC',
    to: 'OT_EVT',
    connectionType: 'CT_CRT_1',
    labelKey: 'aris.connection.createsTriggers',
    raci: null,
    verification: 'fixture'
  }),
  Object.freeze({
    modelType: 'MT_EEPC',
    from: 'OT_FUNC',
    to: 'OT_RULE',
    connectionType: 'CT_LEADS_TO_1',
    labelKey: 'aris.connection.leadsToTriggers',
    raci: null,
    verification: 'fixture'
  }),
  Object.freeze({
    modelType: 'MT_EEPC',
    from: 'OT_RULE',
    to: 'OT_EVT',
    connectionType: 'CT_LEADS_TO_2',
    labelKey: 'aris.connection.leadsToTriggers',
    raci: null,
    verification: 'fixture'
  }),
  Object.freeze({
    modelType: 'MT_EEPC',
    from: 'OT_RULE',
    to: 'OT_RULE',
    connectionType: 'CT_LEADS_TO_2',
    labelKey: 'aris.connection.leadsToTriggers',
    raci: null,
    verification: 'fixture'
  }),
  Object.freeze({
    modelType: 'MT_EEPC',
    from: 'OT_EVT',
    to: 'OT_RULE',
    connectionType: 'CT_IS_EVAL_BY_1',
    labelKey: 'aris.connection.isEvaluatedBy',
    raci: null,
    verification: 'fixture'
  }),

  // --- Value-added chain (verbatim from src/aris/canvas/vocabulary.ts) ------
  Object.freeze({
    modelType: 'MT_VAL_ADD_CHN_DGM',
    from: 'OT_FUNC',
    to: 'OT_FUNC',
    connectionType: 'CT_IS_PREDEC_OF_1',
    labelKey: 'aris.connection.isPredecessorOf',
    raci: null,
    verification: 'fixture'
  }),

  // --- Satellite assignments (verbatim from src/aris/canvas/vocabulary.ts) --
  Object.freeze({
    modelType: null,
    from: 'OT_PERS',
    to: 'OT_FUNC',
    connectionType: 'CT_EXEC_1',
    labelKey: 'aris.connection.executes',
    raci: 'R',
    verification: 'fixture'
  }),
  Object.freeze({
    modelType: null,
    from: 'OT_PERS_TYPE',
    to: 'OT_FUNC',
    connectionType: 'CT_EXEC_2',
    labelKey: 'aris.connection.executes',
    raci: 'R',
    verification: 'fixture'
  }),
  Object.freeze({
    modelType: null,
    from: 'OT_APPL_SYS',
    to: 'OT_FUNC',
    connectionType: 'CT_SUPP_3',
    labelKey: 'aris.connection.supports',
    raci: null,
    verification: 'fixture'
  }),
  Object.freeze({
    modelType: null,
    from: 'OT_ENT_TYPE',
    to: 'OT_FUNC',
    connectionType: 'CT_IS_INP_FOR',
    labelKey: 'aris.connection.providesInputFor',
    raci: null,
    verification: 'fixture'
  }),
  Object.freeze({
    modelType: null,
    from: 'OT_FUNC',
    to: 'OT_ENT_TYPE',
    connectionType: 'CT_CRT_OUT_TO',
    labelKey: 'aris.connection.createsOutputTo',
    raci: null,
    verification: 'fixture'
  }),
  Object.freeze({
    modelType: null,
    from: 'OT_INFO_CARR',
    to: 'OT_FUNC',
    connectionType: 'CT_IS_INP_FOR',
    labelKey: 'aris.connection.providesInputFor',
    raci: null,
    verification: 'fixture'
  }),
  Object.freeze({
    modelType: null,
    from: 'OT_FUNC',
    to: 'OT_INFO_CARR',
    connectionType: 'CT_HAS_OUT',
    labelKey: 'aris.connection.produces',
    raci: null,
    verification: 'fixture'
  }),
  Object.freeze({
    modelType: null,
    from: 'OT_FUNC',
    to: 'OT_PERF',
    connectionType: 'CT_AFFECTS',
    labelKey: 'aris.connection.affects',
    raci: null,
    verification: 'fixture'
  }),
  Object.freeze({
    modelType: null,
    from: 'OT_BUSINESS_RULE',
    to: 'OT_FUNC',
    connectionType: 'CT_IS_EVAL_BY_1',
    labelKey: 'aris.connection.isEvaluatedBy',
    raci: null,
    verification: 'fixture'
  }),
  Object.freeze({
    modelType: null,
    from: 'OT_REQUIREMENT',
    to: 'OT_FUNC',
    connectionType: 'CT_REFS_TO_2',
    labelKey: 'aris.connection.references',
    raci: null,
    verification: 'fixture'
  }),
  Object.freeze({
    modelType: null,
    from: 'OT_POLICY',
    to: 'OT_FUNC',
    connectionType: 'CT_MUST_BE_INFO_ABT_1',
    labelKey: 'aris.connection.mustBeInformedAbout',
    raci: 'I',
    verification: 'fixture'
  }),

  // --- R2 additions ---------------------------------------------------------

  // VACD process-oriented superior
  Object.freeze({
    modelType: 'MT_VAL_ADD_CHN_DGM',
    from: 'OT_FUNC',
    to: 'OT_FUNC',
    connectionType: 'CT_IS_PRCS_ORNT_SUPER',
    labelKey: 'aris.connection.isProcessOrientedSuperior',
    raci: null,
    verification: 'unverified'
  }),

  // Executor RACI variants for executor object types not already covered by the
  // verbatim satellite rules above.
  ...executorRaciAdditions(),

  // Law / SLA → Function uses the same connection family as the I-form.
  Object.freeze({
    modelType: null,
    from: 'OT_POLICY',
    to: 'OT_FUNC',
    connectionType: 'CT_MUST_BE_INFO_ABT_1',
    labelKey: 'aris.connection.regulates',
    raci: 'I',
    verification: 'unverified'
  }),

  // Business policy → Function
  Object.freeze({
    modelType: null,
    from: 'OT_POLICY',
    to: 'OT_FUNC',
    connectionType: 'CT_AFFECTS',
    labelKey: 'aris.connection.affects',
    raci: null,
    verification: 'unverified'
  }),

  // Function → Product/Service
  Object.freeze({
    modelType: null,
    from: 'OT_FUNC',
    to: 'OT_SERVICE',
    connectionType: 'CT_HAS_OUT',
    labelKey: 'aris.connection.produces',
    raci: null,
    verification: 'unverified'
  }),

  // Org-chart connections (model-type-independent placeholders; codes unverified)
  Object.freeze({
    modelType: null,
    from: 'OT_ORG_UNIT',
    to: 'OT_ORG_UNIT',
    connectionType: 'CT_IS_COMPOUND_OF_1',
    labelKey: 'aris.connection.isComposedOf',
    raci: null,
    verification: 'unverified'
  }),
  Object.freeze({
    modelType: null,
    from: 'OT_POS',
    to: 'OT_ORG_UNIT',
    connectionType: 'CT_IS_ORG_MANAGER_1',
    labelKey: 'aris.connection.isOrganizationManagerFor',
    raci: null,
    verification: 'unverified'
  }),
  Object.freeze({
    modelType: null,
    from: 'OT_POS',
    to: 'OT_POS',
    connectionType: 'CT_IS_TECH_SUPER_1',
    labelKey: 'aris.connection.isTechnicalSuperiorTo',
    raci: null,
    verification: 'unverified'
  }),
  Object.freeze({
    modelType: null,
    from: 'OT_POS',
    to: 'OT_PERS',
    connectionType: 'CT_OCCUPIES_1',
    labelKey: 'aris.connection.occupies',
    raci: null,
    verification: 'unverified'
  }),
  Object.freeze({
    modelType: null,
    from: 'OT_POS',
    to: 'OT_PERS_TYPE',
    connectionType: 'CT_PERFORMS_1',
    labelKey: 'aris.connection.performs',
    raci: null,
    verification: 'unverified'
  }),

  // Service-tree connection (model-type-independent placeholder; code unverified)
  Object.freeze({
    modelType: null,
    from: 'OT_SERVICE',
    to: 'OT_SERVICE',
    connectionType: 'CT_ENCOMPASSES_1',
    labelKey: 'aris.connection.encompasses',
    raci: null,
    verification: 'unverified'
  }),

  // --- AnimalWF DMT EEPC legality expansion -------------------------------
  //
  // These are the four exact missing tuples observed across the eight models
  // in reference/AnimalWF/ARISAMLExport.xml. Keep them model-scoped: the export
  // proves they are legal DMT EEPC connections, not universal ARIS pairings.
  //
  // The DMT manual's EPC relationship pages confirm Function -> Data Entity
  // "Create" and Function -> Information Carrier "Creates Output to".
  Object.freeze({
    modelType: 'MT_EEPC',
    from: 'OT_FUNC',
    to: 'OT_ENT_TYPE',
    connectionType: 'CT_HAS_OUT',
    labelKey: 'aris.connection.createsOutputTo',
    raci: null,
    verification: 'aris-doc'
  }),
  Object.freeze({
    modelType: 'MT_EEPC',
    from: 'OT_FUNC',
    to: 'OT_INFO_CARR',
    connectionType: 'CT_CRT_OUT_TO',
    labelKey: 'aris.connection.createsOutputTo',
    raci: null,
    verification: 'aris-doc'
  }),

  // VERIFY-AGAINST-REAL-ARIS-EXPORT: both tuples occur in the real export,
  // but the DMT manual does not confirm this direction/model-type combination.
  Object.freeze({
    modelType: 'MT_EEPC',
    from: 'OT_FUNC',
    to: 'OT_ENT_TYPE',
    connectionType: 'CT_READ_1',
    labelKey: 'aris.connection.providesInputFor',
    raci: null,
    verification: 'unverified'
  }),
  Object.freeze({
    modelType: 'MT_EEPC',
    from: 'OT_FUNC',
    to: 'OT_FUNC',
    connectionType: 'CT_IS_PREDEC_OF_1',
    labelKey: 'aris.connection.isPredecessorOf',
    raci: null,
    verification: 'unverified'
  })
])

/**
 * R2 executor → Function RACI additions for object types that do not already
 * have a verbatim R rule in the satellite section above.
 *
 * - OT_PERS and OT_PERS_TYPE already have CT_EXEC_1 / CT_EXEC_2.
 * - OT_ORG_UNIT, OT_POS, and OT_GRP need the R form plus the A/C/I forms.
 * - All five executor types receive the A/C/I forms.
 */
function executorRaciAdditions(): readonly ArisConnectionRule[] {
  const executorTypes = Object.freeze([
    'OT_ORG_UNIT',
    'OT_POS',
    'OT_GRP',
    'OT_PERS_TYPE',
    'OT_PERS'
  ])

  const rForms = new Map<
    string,
    { readonly connectionType: string; readonly verification: ArisSymbolVerification }
  >([
    ['OT_ORG_UNIT', { connectionType: 'CT_EXEC_1', verification: 'fixture' }],
    ['OT_POS', { connectionType: 'CT_EXEC_1', verification: 'fixture' }],
    ['OT_GRP', { connectionType: 'CT_EXEC_1', verification: 'fixture' }],
    ['OT_PERS_TYPE', { connectionType: 'CT_EXEC_2', verification: 'fixture' }],
    ['OT_PERS', { connectionType: 'CT_EXEC_1', verification: 'fixture' }]
  ])

  const aciForms: ReadonlyArray<{
    readonly connectionType: string
    readonly labelKey: string
    readonly raci: RaciLetter
    readonly verification: ArisSymbolVerification
  }> = Object.freeze([
    {
      connectionType: 'CT_DECID_ON',
      labelKey: 'aris.connection.decidesOn',
      raci: 'A',
      verification: 'unverified'
    },
    {
      connectionType: 'CT_MUST_BE_CONSLT_ABT_1',
      labelKey: 'aris.connection.mustBeConsultedAbout',
      raci: 'C',
      verification: 'unverified'
    },
    {
      connectionType: 'CT_MUST_BE_INFO_ABT_1',
      labelKey: 'aris.connection.mustBeInformedAbout',
      raci: 'I',
      verification: 'fixture'
    }
  ])

  const rules: ArisConnectionRule[] = []
  for (const from of executorTypes) {
    const r = rForms.get(from)
    if (r) {
      rules.push(
        Object.freeze({
          modelType: null,
          from,
          to: 'OT_FUNC',
          connectionType: r.connectionType,
          labelKey: 'aris.connection.executes',
          raci: 'R',
          verification: r.verification
        })
      )
    }
    for (const form of aciForms) {
      rules.push(
        Object.freeze({
          modelType: null,
          from,
          to: 'OT_FUNC',
          connectionType: form.connectionType,
          labelKey: form.labelKey,
          raci: form.raci,
          verification: form.verification
        })
      )
    }
  }
  return Object.freeze(rules)
}

export const RACI_BY_CONNECTION_TYPE: Readonly<Record<string, RaciLetter>> = Object.freeze({
  CT_EXEC_1: 'R',
  CT_EXEC_2: 'R',
  CT_DECID_ON: 'A',
  CT_MUST_BE_CONSLT_ABT_1: 'C',
  CT_MUST_BE_INFO_ABT_1: 'I'
})

export interface ResolvedConventionConnection {
  readonly connectionType: string
  readonly fallback: boolean
  readonly rule: ArisConnectionRule | null
}

function ruleMatches(
  rule: ArisConnectionRule,
  modelType: string,
  fromObjectType: string,
  toObjectType: string
): boolean {
  return (
    (rule.modelType === null || rule.modelType === modelType) &&
    rule.from === fromObjectType &&
    rule.to === toObjectType
  )
}

export function resolveConventionConnection(
  modelType: string,
  fromObjectType: string,
  toObjectType: string
): ResolvedConventionConnection {
  const match = ARIS_CONNECTION_RULES.find((rule) =>
    ruleMatches(rule, modelType, fromObjectType, toObjectType)
  )
  if (match) {
    return Object.freeze({ connectionType: match.connectionType, fallback: false, rule: match })
  }
  return Object.freeze({
    connectionType: ARIS_FALLBACK_CONNECTION_TYPE,
    fallback: true,
    rule: null
  })
}

export function isLegalConnection(
  modelType: string,
  fromObjectType: string,
  toObjectType: string,
  connectionType: string
): boolean {
  return ARIS_CONNECTION_RULES.some(
    (rule) =>
      ruleMatches(rule, modelType, fromObjectType, toObjectType) &&
      rule.connectionType === connectionType
  )
}
