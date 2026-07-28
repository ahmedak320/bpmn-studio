// Known ARIS object/symbol type codes used to classify occurrences while
// building a digest. Codes were read off the real (private, un-committed)
// `../../reference/AnimalWF/ARISAMLExport.xml` fixture plus common ARIS/EPC
// naming conventions. Unknown codes are NEVER treated as an error — every
// lookup here degrades to "not classified" rather than throwing, because a
// workspace can legitimately contain object types this table doesn't know
// about yet.

/** Control-flow node types: these become `ArisDigestStep` entries. */
const STEP_OBJECT_TYPES = new Set(['OT_FUNC', 'OT_EVT', 'OT_RULE'])

/** Person / role / org-unit types: these become `responsible` entries. */
const PERSON_OBJECT_TYPES = new Set(['OT_PERS', 'OT_PERS_TYPE', 'OT_POS', 'OT_ORG_UNIT', 'OT_GROUP'])

/** Application/IT system types: these become `systems` entries. */
const APPLICATION_SYSTEM_TYPES = new Set(['OT_APPL_SYS', 'OT_IT_SYSTEM_TYPE', 'OT_ITSYS_TYPE'])

/** Information carrier / entity types: these become `inputs`/`outputs` entries, direction-dependent. */
const INFO_OBJECT_TYPES = new Set(['OT_INFO_CARR', 'OT_ENT_TYPE'])

/** Policy/requirement/rule-basis types: these feed a rule step's `decisionBasis`. */
const BASIS_OBJECT_TYPES = new Set(['OT_POLICY', 'OT_REQUIREMENT'])

export function isStepObjectType(objectType: string): boolean {
  return STEP_OBJECT_TYPES.has(objectType)
}

export function isPersonObjectType(objectType: string): boolean {
  return PERSON_OBJECT_TYPES.has(objectType)
}

export function isApplicationSystemType(objectType: string): boolean {
  return APPLICATION_SYSTEM_TYPES.has(objectType)
}

export function isInfoObjectType(objectType: string): boolean {
  return INFO_OBJECT_TYPES.has(objectType)
}

export function isBasisObjectType(objectType: string): boolean {
  return BASIS_OBJECT_TYPES.has(objectType)
}

export function isRuleObjectType(objectType: string): boolean {
  return objectType === 'OT_RULE'
}

export function isEventObjectType(objectType: string): boolean {
  return objectType === 'OT_EVT'
}

/** Derive a gateway kind from an `OT_RULE` occurrence's symbol code. */
export function gatewayTypeFromSymbol(symbol: string | null): 'XOR' | 'AND' | 'OR' | 'RULE' {
  if (!symbol) return 'RULE'
  if (symbol.includes('XOR')) return 'XOR'
  if (symbol.includes('AND')) return 'AND'
  if (symbol.includes('_OR') || symbol.endsWith('OR')) return 'OR'
  return 'RULE'
}

/**
 * Map a locale identifier to a supported UI language. Accepts both the raw
 * Windows LCID strings ARIS AML exports use (`"1033"` = English (US),
 * `"14337"` = Arabic (UAE), plus a few common regional variants) and
 * BCP-47-ish tags (`"en-US"`, `"ar-AE"`, …) some source layers normalize to.
 * Unrecognized identifiers resolve to `undefined` — the caller falls back to
 * `fallback` text rather than guessing a language.
 */
const ARABIC_LCIDS = new Set(['1025', '2049', '3073', '4097', '5121', '6145', '14337', '15361'])
const ENGLISH_LCIDS = new Set(['1033', '2057', '3081', '4105', '5129', '6153', '9225'])

export function localeKeyToLang(localeId: string | null | undefined): 'en' | 'ar' | undefined {
  if (!localeId) return undefined
  const key = localeId.trim()
  if (!key) return undefined
  const lower = key.toLowerCase()
  if (lower.startsWith('ar')) return 'ar'
  if (lower.startsWith('en')) return 'en'
  if (ARABIC_LCIDS.has(key)) return 'ar'
  if (ENGLISH_LCIDS.has(key)) return 'en'
  return undefined
}
