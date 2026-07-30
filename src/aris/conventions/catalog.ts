/**
 * ARIS convention symbol / color catalog (plan R1).
 *
 * The single source of truth for palette symbols, default fills/strokes, and
 * symbol families.  Every row carries a provenance comment.  Fixture rows are
 * kept separate from the `VERIFY-AGAINST-REAL-ARIS-EXPORT` region so the
 * unverified/manual rows are easy to audit against a real ARIS export.
 */

export type ArisSymbolVerification = 'fixture' | 'aris-doc' | 'unverified'

export type ArisSymbolFamilyId =
  'function' | 'infoCarrier' | 'orgPeople' | 'governance' | 'rule' | 'valueChain'

export interface ArisConventionSymbol {
  readonly objectType: string
  readonly symbolNum: string
  readonly labelKey: string
  readonly family: ArisSymbolFamilyId | null
  readonly defaultFill: string
  readonly defaultStroke: string
  readonly paletteGroup: 'flow' | 'rule' | 'org' | 'data' | 'system' | 'governance'
  readonly paletteOrder: number
  readonly modelTypes: readonly string[]
  readonly verification: ArisSymbolVerification
}

export const DEFAULT_STROKE = '#1a1a1a'

const FIXTURE_SYMBOLS: readonly ArisConventionSymbol[] = Object.freeze([
  // --- flow ---------------------------------------------------------------
  Object.freeze({
    objectType: 'OT_FUNC',
    symbolNum: 'ST_FUNC',
    labelKey: 'aris.symbol.function',
    family: 'function',
    defaultFill: '#339900',
    defaultStroke: DEFAULT_STROKE,
    paletteGroup: 'flow',
    paletteOrder: 10,
    modelTypes: Object.freeze(['MT_EEPC']),
    verification: 'fixture'
  }),
  Object.freeze({
    objectType: 'OT_FUNC',
    symbolNum: 'ST_SYS_FUNC_ACT',
    labelKey: 'aris.symbol.systemFunction',
    family: 'function',
    defaultFill: '#339900',
    defaultStroke: DEFAULT_STROKE,
    paletteGroup: 'flow',
    paletteOrder: 11,
    modelTypes: Object.freeze(['MT_EEPC']),
    verification: 'fixture'
  }),
  Object.freeze({
    objectType: 'OT_FUNC',
    symbolNum: 'ST_PRCS_IF',
    labelKey: 'aris.symbol.processInterface',
    family: 'function',
    defaultFill: '#c0c0c0',
    defaultStroke: DEFAULT_STROKE,
    paletteGroup: 'flow',
    paletteOrder: 12,
    modelTypes: Object.freeze(['MT_EEPC']),
    verification: 'fixture'
  }),
  Object.freeze({
    objectType: 'OT_FUNC',
    symbolNum: 'ST_VAL_ADD_CHN_SML_1',
    labelKey: 'aris.symbol.valueAddedChain',
    family: 'valueChain',
    defaultFill: '#339900',
    defaultStroke: DEFAULT_STROKE,
    paletteGroup: 'flow',
    paletteOrder: 13,
    modelTypes: Object.freeze(['MT_VAL_ADD_CHN_DGM']),
    verification: 'fixture'
  }),
  Object.freeze({
    objectType: 'OT_EVT',
    symbolNum: 'ST_EV',
    labelKey: 'aris.symbol.event',
    family: null,
    defaultFill: '#dcbbed',
    defaultStroke: DEFAULT_STROKE,
    paletteGroup: 'flow',
    paletteOrder: 20,
    modelTypes: Object.freeze(['MT_EEPC']),
    verification: 'fixture'
  }),

  // --- rules --------------------------------------------------------------
  Object.freeze({
    objectType: 'OT_RULE',
    symbolNum: 'ST_OPR_AND_1',
    labelKey: 'aris.symbol.and',
    family: 'rule',
    defaultFill: '#d5d5f7',
    defaultStroke: DEFAULT_STROKE,
    paletteGroup: 'rule',
    paletteOrder: 30,
    modelTypes: Object.freeze(['MT_EEPC']),
    verification: 'fixture'
  }),
  Object.freeze({
    objectType: 'OT_RULE',
    symbolNum: 'ST_OPR_XOR_1',
    labelKey: 'aris.symbol.xor',
    family: 'rule',
    defaultFill: '#d5d5f7',
    defaultStroke: DEFAULT_STROKE,
    paletteGroup: 'rule',
    paletteOrder: 32,
    modelTypes: Object.freeze(['MT_EEPC']),
    verification: 'fixture'
  }),

  // --- data / application -------------------------------------------------
  Object.freeze({
    objectType: 'OT_ENT_TYPE',
    symbolNum: 'ST_ENT_TYPE',
    labelKey: 'aris.symbol.entityType',
    family: null,
    defaultFill: '#b6dce9',
    defaultStroke: DEFAULT_STROKE,
    paletteGroup: 'data',
    paletteOrder: 40,
    modelTypes: Object.freeze(['MT_EEPC']),
    verification: 'fixture'
  }),
  Object.freeze({
    objectType: 'OT_INFO_CARR',
    symbolNum: 'ST_DOC',
    labelKey: 'aris.symbol.document',
    family: 'infoCarrier',
    defaultFill: '#cccccc',
    defaultStroke: DEFAULT_STROKE,
    paletteGroup: 'data',
    paletteOrder: 51,
    modelTypes: Object.freeze(['MT_EEPC']),
    verification: 'fixture'
  }),
  Object.freeze({
    objectType: 'OT_INFO_CARR',
    symbolNum: 'ST_EMAIL_1',
    labelKey: 'aris.symbol.email',
    family: 'infoCarrier',
    defaultFill: '#cccccc',
    defaultStroke: DEFAULT_STROKE,
    paletteGroup: 'data',
    paletteOrder: 52,
    modelTypes: Object.freeze(['MT_EEPC']),
    verification: 'fixture'
  }),
  Object.freeze({
    objectType: 'OT_INFO_CARR',
    symbolNum: 'ST_INFO_CARR_HANDY',
    labelKey: 'aris.symbol.mobile',
    family: 'infoCarrier',
    defaultFill: '#cccccc',
    defaultStroke: DEFAULT_STROKE,
    paletteGroup: 'data',
    paletteOrder: 53,
    modelTypes: Object.freeze(['MT_EEPC']),
    verification: 'fixture'
  }),
  Object.freeze({
    objectType: 'OT_INFO_CARR',
    symbolNum: 'ST_INFO_CARR_EDOC',
    labelKey: 'aris.symbol.eDocument',
    family: 'infoCarrier',
    defaultFill: '#cccccc',
    defaultStroke: DEFAULT_STROKE,
    paletteGroup: 'data',
    paletteOrder: 55,
    modelTypes: Object.freeze(['MT_EEPC']),
    verification: 'fixture'
  }),
  Object.freeze({
    objectType: 'OT_BUSINESS_RULE',
    symbolNum: 'ST_BUSINESS_RULE',
    labelKey: 'aris.symbol.businessRule',
    family: 'governance',
    defaultFill: '#fde047',
    defaultStroke: DEFAULT_STROKE,
    paletteGroup: 'governance',
    paletteOrder: 70,
    modelTypes: Object.freeze(['MT_EEPC']),
    verification: 'fixture'
  }),
  Object.freeze({
    objectType: 'OT_PERF',
    symbolNum: 'ST_PERFORM',
    labelKey: 'aris.symbol.performance',
    family: 'governance',
    defaultFill: '#2563eb',
    defaultStroke: DEFAULT_STROKE,
    paletteGroup: 'governance',
    paletteOrder: 71,
    modelTypes: Object.freeze(['MT_EEPC']),
    verification: 'fixture'
  }),
  Object.freeze({
    objectType: 'OT_APPL_SYS',
    symbolNum: 'ST_APPL_SYS',
    labelKey: 'aris.symbol.applicationSystem',
    family: null,
    defaultFill: '#000099',
    defaultStroke: DEFAULT_STROKE,
    paletteGroup: 'system',
    paletteOrder: 60,
    modelTypes: Object.freeze(['MT_EEPC']),
    verification: 'fixture'
  }),

  // --- org / people -------------------------------------------------------
  Object.freeze({
    objectType: 'OT_PERS',
    symbolNum: 'ST_PERS_EXT',
    labelKey: 'aris.symbol.externalPerson',
    family: 'orgPeople',
    defaultFill: '#d7c49d',
    defaultStroke: DEFAULT_STROKE,
    paletteGroup: 'org',
    paletteOrder: 80,
    modelTypes: Object.freeze(['MT_EEPC']),
    verification: 'fixture'
  }),
  Object.freeze({
    objectType: 'OT_PERS_TYPE',
    symbolNum: 'ST_EMPL_TYPE',
    labelKey: 'aris.symbol.personType',
    family: 'orgPeople',
    defaultFill: '#d7c49d',
    defaultStroke: DEFAULT_STROKE,
    paletteGroup: 'org',
    paletteOrder: 83,
    modelTypes: Object.freeze(['MT_EEPC']),
    verification: 'fixture'
  }),
  Object.freeze({
    objectType: 'OT_ORG_UNIT',
    symbolNum: 'ST_ORG_UNIT_1',
    labelKey: 'aris.symbol.organizationalUnit',
    family: 'orgPeople',
    defaultFill: '#f59e0b',
    defaultStroke: DEFAULT_STROKE,
    paletteGroup: 'org',
    paletteOrder: 84,
    modelTypes: Object.freeze(['MT_EEPC']),
    verification: 'fixture'
  }),

  // --- governance ---------------------------------------------------------
  Object.freeze({
    objectType: 'OT_POLICY',
    symbolNum: 'ST_BUSINESS_POLICY',
    labelKey: 'aris.symbol.policy',
    family: 'governance',
    defaultFill: '#fb923c',
    defaultStroke: DEFAULT_STROKE,
    paletteGroup: 'governance',
    paletteOrder: 72,
    modelTypes: Object.freeze(['MT_EEPC']),
    verification: 'fixture'
  }),
  Object.freeze({
    objectType: 'OT_REQUIREMENT',
    symbolNum: 'ST_REQUIREMENT',
    labelKey: 'aris.symbol.requirement',
    family: 'governance',
    defaultFill: '#f7fee7',
    defaultStroke: DEFAULT_STROKE,
    paletteGroup: 'governance',
    paletteOrder: 73,
    modelTypes: Object.freeze(['MT_EEPC']),
    verification: 'fixture'
  })
])

// All rows below are NOT derived from the AnimalWF fixture and must be verified
// against a real ARIS export or the ARIS Convention Manual before production use.
const VERIFY_AGAINST_REAL_ARIS_EXPORT: readonly ArisConventionSymbol[] = Object.freeze([
  // [manual] OR rule
  Object.freeze({
    objectType: 'OT_RULE',
    symbolNum: 'ST_OPR_OR_1',
    labelKey: 'aris.symbol.or',
    family: 'rule',
    defaultFill: '#d5d5f7',
    defaultStroke: DEFAULT_STROKE,
    paletteGroup: 'rule',
    paletteOrder: 31,
    modelTypes: Object.freeze(['MT_EEPC']),
    verification: 'aris-doc'
  }),

  // [manual] General information carrier
  Object.freeze({
    objectType: 'OT_INFO_CARR',
    symbolNum: 'ST_INFO_CARR_1',
    labelKey: 'aris.symbol.infoCarrier',
    family: 'infoCarrier',
    defaultFill: '#cccccc',
    defaultStroke: DEFAULT_STROKE,
    paletteGroup: 'data',
    paletteOrder: 50,
    modelTypes: Object.freeze(['MT_EEPC']),
    verification: 'aris-doc'
  }),

  // [unverified] Letter
  Object.freeze({
    objectType: 'OT_INFO_CARR',
    symbolNum: 'ST_LETTER',
    labelKey: 'aris.symbol.letter',
    family: 'infoCarrier',
    defaultFill: '#cccccc',
    defaultStroke: DEFAULT_STROKE,
    paletteGroup: 'data',
    paletteOrder: 54,
    modelTypes: Object.freeze(['MT_EEPC']),
    verification: 'unverified'
  }),

  // [unverified] Log
  Object.freeze({
    objectType: 'OT_INFO_CARR',
    symbolNum: 'ST_LOG',
    labelKey: 'aris.symbol.log',
    family: 'infoCarrier',
    defaultFill: '#cccccc',
    defaultStroke: DEFAULT_STROKE,
    paletteGroup: 'data',
    paletteOrder: 56,
    modelTypes: Object.freeze(['MT_EEPC']),
    verification: 'unverified'
  }),

  // [manual/unverified] Data entity (distinct palette entry, see R1 note)
  Object.freeze({
    objectType: 'OT_ENT_TYPE',
    symbolNum: 'ST_ENT_TYPE',
    labelKey: 'aris.symbol.dataEntity',
    family: null,
    defaultFill: '#7f2020',
    defaultStroke: DEFAULT_STROKE,
    paletteGroup: 'data',
    paletteOrder: 41,
    modelTypes: Object.freeze(['MT_EEPC']),
    verification: 'aris-doc'
  }),

  // [manual] Internal person
  Object.freeze({
    objectType: 'OT_PERS',
    symbolNum: 'ST_PERS',
    labelKey: 'aris.symbol.internalPerson',
    family: 'orgPeople',
    defaultFill: '#e6cf7a',
    defaultStroke: DEFAULT_STROKE,
    paletteGroup: 'org',
    paletteOrder: 81,
    modelTypes: Object.freeze(['MT_EEPC']),
    verification: 'aris-doc'
  }),

  // [manual/unverified] Position
  Object.freeze({
    objectType: 'OT_POS',
    symbolNum: 'ST_POS',
    labelKey: 'aris.symbol.position',
    family: 'orgPeople',
    defaultFill: '#facc15',
    defaultStroke: DEFAULT_STROKE,
    paletteGroup: 'org',
    paletteOrder: 85,
    modelTypes: Object.freeze(['MT_EEPC']),
    verification: 'unverified'
  }),

  // [manual/unverified] Group
  Object.freeze({
    objectType: 'OT_GRP',
    symbolNum: 'ST_GRP_1',
    labelKey: 'aris.symbol.group',
    family: 'orgPeople',
    defaultFill: '#a16207',
    defaultStroke: DEFAULT_STROKE,
    paletteGroup: 'org',
    paletteOrder: 86,
    modelTypes: Object.freeze(['MT_EEPC']),
    verification: 'unverified'
  }),

  // [unverified] Related entity
  Object.freeze({
    objectType: 'OT_PERS',
    symbolNum: 'ST_PERS_EXT',
    labelKey: 'aris.symbol.relatedEntity',
    family: 'orgPeople',
    defaultFill: '#9ca3af',
    defaultStroke: DEFAULT_STROKE,
    paletteGroup: 'org',
    paletteOrder: 82,
    modelTypes: Object.freeze(['MT_EEPC']),
    verification: 'unverified'
  }),

  // [unverified] Committee / Team (org-unit variant)
  Object.freeze({
    objectType: 'OT_ORG_UNIT',
    symbolNum: 'ST_ORG_UNIT_1',
    labelKey: 'aris.symbol.committeeTeam',
    family: 'orgPeople',
    defaultFill: '#f59e0b',
    defaultStroke: DEFAULT_STROKE,
    paletteGroup: 'org',
    paletteOrder: 87,
    modelTypes: Object.freeze(['MT_EEPC']),
    verification: 'unverified'
  }),

  // [unverified] SLA (policy variant)
  Object.freeze({
    objectType: 'OT_POLICY',
    symbolNum: 'ST_BUSINESS_POLICY',
    labelKey: 'aris.symbol.sla',
    family: 'governance',
    defaultFill: '#dc2626',
    defaultStroke: DEFAULT_STROKE,
    paletteGroup: 'governance',
    paletteOrder: 74,
    modelTypes: Object.freeze(['MT_EEPC']),
    verification: 'unverified'
  }),

  // [unverified] Law / Regulation (policy variant)
  Object.freeze({
    objectType: 'OT_POLICY',
    symbolNum: 'ST_BUSINESS_POLICY',
    labelKey: 'aris.symbol.lawRegulation',
    family: 'governance',
    defaultFill: '#dc2626',
    defaultStroke: DEFAULT_STROKE,
    paletteGroup: 'governance',
    paletteOrder: 75,
    modelTypes: Object.freeze(['MT_EEPC']),
    verification: 'unverified'
  }),

  // [manual/unverified] Risk
  Object.freeze({
    objectType: 'OT_RISK',
    symbolNum: 'ST_RISK_1',
    labelKey: 'aris.symbol.risk',
    family: 'governance',
    defaultFill: '#dc2626',
    defaultStroke: DEFAULT_STROKE,
    paletteGroup: 'governance',
    paletteOrder: 76,
    modelTypes: Object.freeze(['MT_EEPC']),
    verification: 'unverified'
  }),

  // [unverified] Product / Service
  Object.freeze({
    objectType: 'OT_SERVICE',
    symbolNum: 'ST_SERVICE',
    labelKey: 'aris.symbol.productService',
    family: null,
    defaultFill: '#8b7355',
    defaultStroke: DEFAULT_STROKE,
    paletteGroup: 'governance',
    paletteOrder: 77,
    modelTypes: Object.freeze(['MT_EEPC']),
    verification: 'unverified'
  }),

  // [manual] Value-added chain start (VACD only)
  Object.freeze({
    objectType: 'OT_FUNC',
    symbolNum: 'ST_VAL_ADD_CHN_SML_1',
    labelKey: 'aris.symbol.valueAddedChainStart',
    family: 'valueChain',
    defaultFill: '#2f7d31',
    defaultStroke: DEFAULT_STROKE,
    paletteGroup: 'flow',
    paletteOrder: 14,
    modelTypes: Object.freeze(['MT_VAL_ADD_CHN_DGM']),
    verification: 'aris-doc'
  })
])

export const ARIS_CONVENTION_SYMBOLS: readonly ArisConventionSymbol[] = Object.freeze(
  Object.freeze([...FIXTURE_SYMBOLS, ...VERIFY_AGAINST_REAL_ARIS_EXPORT])
)

const SYMBOL_BY_OBJECT_AND_NUM: ReadonlyMap<string, ArisConventionSymbol> = (() => {
  const map = new Map<string, ArisConventionSymbol>()
  for (const symbol of ARIS_CONVENTION_SYMBOLS) {
    const key = `${symbol.objectType}:${symbol.symbolNum}`
    if (!map.has(key)) {
      map.set(key, symbol)
    }
  }
  return Object.freeze(map)
})()

export function getPaletteSymbols(modelType: string): readonly ArisConventionSymbol[] {
  return Object.freeze(
    ARIS_CONVENTION_SYMBOLS.filter((symbol) => symbol.modelTypes.includes(modelType)).sort(
      (a, b) => a.paletteOrder - b.paletteOrder
    )
  )
}

export function conventionSymbol(
  objectType: string,
  symbolNum: string
): ArisConventionSymbol | null {
  return SYMBOL_BY_OBJECT_AND_NUM.get(`${objectType}:${symbolNum}`) ?? null
}

export function conventionDefaultFill(objectType: string, symbolNum: string): string | null {
  return conventionSymbol(objectType, symbolNum)?.defaultFill ?? null
}

export function getVariantFamily(
  objectType: string,
  symbolNum: string
): readonly ArisConventionSymbol[] {
  const matched = conventionSymbol(objectType, symbolNum)
  if (!matched || matched.family === null) return Object.freeze([])

  return Object.freeze(
    ARIS_CONVENTION_SYMBOLS.filter(
      (symbol) =>
        symbol.objectType === objectType &&
        symbol.family === matched.family &&
        symbol.symbolNum !== symbolNum
    )
  )
}
