// Known ARIS object/symbol type codes used to classify occurrences while
// building a digest. Codes were read off the real (private, un-committed)
// `../../reference/AnimalWF/ARISAMLExport.xml` fixture plus common ARIS/EPC
// naming conventions. Unknown codes are NEVER treated as an error — every
// lookup here degrades to "not classified" rather than throwing, because a
// workspace can legitimately contain object types this table doesn't know
// about yet.

import { localeLang } from '../../library/amlParse'

/** Control-flow node types: these become `ArisDigestStep` entries. */
const STEP_OBJECT_TYPES = new Set(['OT_FUNC', 'OT_EVT', 'OT_RULE'])

/** Person / role / org-unit types: these become `responsible` entries. */
const PERSON_OBJECT_TYPES = new Set([
  'OT_PERS',
  'OT_PERS_TYPE',
  'OT_POS',
  'OT_ORG_UNIT',
  'OT_GROUP'
])

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
 * Map a locale identifier to a supported UI language. Accepts the raw Windows
 * LCID strings ARIS AML exports use (`"1033"` = English (US), `"14337"` =
 * Arabic (UAE), plus every regional variant), BCP-47-ish tags (`"en-US"`,
 * `"ar-AE"`, …) some source layers normalize to, AND the RAW, unexpanded
 * internal-DTD entity reference a real ARIS export actually puts in
 * `LocaleId="…"` (`"&LocaleId.AEar;"` / `"&LocaleId.USen;"`) — the
 * tokenizer/semantic-index layers only expand entities inside element text,
 * never attribute values, so that sigil-wrapped reference (not the bare
 * entity name and not the resolved numeric id) is what actually reaches this
 * layer for imported content. Unrecognized identifiers resolve to
 * `undefined` — the caller falls back to `fallback` text rather than
 * guessing a language.
 *
 * Delegates to `localeLang` (`src/library/amlParse.ts`), the one shared
 * classifier every locale-aware layer in this codebase should use, rather
 * than maintaining a parallel implementation here.
 */
export function localeKeyToLang(localeId: string | null | undefined): 'en' | 'ar' | undefined {
  return localeLang(localeId ?? undefined)
}
