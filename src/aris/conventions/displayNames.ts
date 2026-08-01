/**
 * Shared friendly-name resolver for raw ARIS type codes (plan Wave 12, Lane
 * L-P10a — user issue 10: raw `OT_*`/`ST_*`/`MT_*`/`CT_*`/`AT_*` codes must
 * never leak into tooltips or the details pane).
 *
 * Every resolver here prefers a registered i18n label from the convention
 * catalogs (`catalog.ts`, `connectionRules.ts`, `attributes.ts`) and only
 * humanizes the raw code as an absolute last resort when nothing is
 * registered for it. This is the single shared implementation so downstream
 * consumers (details pane, canvas hover tooltip, right-click type menu) never
 * re-derive their own ad hoc humanizer; `digest.ts`'s placeholder-name
 * humanizer moved here too (see `humanizeArisCode`), so there is exactly one
 * last-resort humanizer for the whole app.
 */

import { t, type Key } from '../../i18n'
import {
  ARIS_CONVENTION_SYMBOLS,
  conventionSymbol,
  conventionSymbolByCatalogId,
  type ArisConventionSymbol
} from './catalog'
import { ARIS_CONNECTION_RULES } from './connectionRules'
import { schemaForObjectType } from './attributes'

/** A reference to one ARIS object occurrence/definition, as loosely or precisely known. */
export interface ArisTypeRef {
  readonly objectType: string
  readonly symbolNum?: string | null
  readonly catalogId?: string | null
}

/**
 * Humanize a raw ARIS type code for display when nothing is registered for
 * it: `OT_ENT_TYPE` -> `Ent Type`. Strips one leading `OT_`/`CT_`/`MT_`/
 * `AT_`/`ST_` prefix (the families this module resolves), then title-cases
 * each remaining underscore-separated word.
 */
export function humanizeArisCode(code: string): string {
  const withoutPrefix = code.replace(/^(OT|CT|MT|AT|ST)_/, '')
  return withoutPrefix
    .toLowerCase()
    .split('_')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

/**
 * Resolve the catalog row for a type reference. Priority: an explicit
 * `catalogId` wins outright; otherwise the exact `(objectType, symbolNum)`
 * pair; otherwise — when only the object type is known — the
 * lowest-`paletteOrder` row for that object type (the ambiguous fallback:
 * e.g. a bare `OT_INFO_CARR` with no symbol resolves to whichever
 * information-carrier variant sorts first). Each step falls through to the
 * next when it fails to resolve, rather than stopping at the first field
 * that happens to be set. Returns `null` when nothing in the catalog matches
 * at all.
 */
export function conventionRowFor(ref: ArisTypeRef): ArisConventionSymbol | null {
  if (ref.catalogId) {
    const byCatalogId = conventionSymbolByCatalogId(ref.catalogId)
    if (byCatalogId) return byCatalogId
  }
  if (ref.symbolNum) {
    const byPair = conventionSymbol(ref.objectType, ref.symbolNum)
    if (byPair) return byPair
  }
  const candidates = ARIS_CONVENTION_SYMBOLS.filter((entry) => entry.objectType === ref.objectType)
  if (candidates.length === 0) return null
  candidates.sort((a, b) => a.paletteOrder - b.paletteOrder)
  return candidates[0]
}

/** Friendly name for an object type: the registered catalog label, else a humanized code. */
export function arisObjectTypeName(ref: ArisTypeRef): string {
  const row = conventionRowFor(ref)
  if (!row) return humanizeArisCode(ref.objectType)
  return t(row.labelKey as Key) || row.accessibleLabel || humanizeArisCode(ref.objectType)
}

/** `"{friendly name} block"` — the generic caption for a placed block of this type. */
export function arisObjectBlockName(ref: ArisTypeRef): string {
  return t('aris.type.blockName', { name: arisObjectTypeName(ref) })
}

/** Friendly name for a model type: `MT_EEPC`/`MT_VAL_ADD_CHN_DGM` are registered; else humanized. */
export function arisModelTypeName(modelType: string): string {
  if (modelType === 'MT_EEPC') return t('aris.modelType.eepc')
  if (modelType === 'MT_VAL_ADD_CHN_DGM') return t('aris.modelType.vacd')
  return humanizeArisCode(modelType)
}

/** Friendly name for a connection type: the first matching convention rule's label, else humanized. */
export function arisConnectionTypeName(connectionType: string): string {
  const rule = ARIS_CONNECTION_RULES.find(
    (candidate) => candidate.connectionType === connectionType
  )
  if (!rule) return humanizeArisCode(connectionType)
  return t(rule.labelKey as Key)
}

/**
 * Friendly name for an attribute type. `ownerObjectType`, when given, narrows
 * the lookup to that object type's registered attribute schema
 * (`schemaForObjectType`); with no match — or no owner type given — this
 * humanizes the raw code instead.
 */
export function arisAttributeTypeName(attributeType: string, ownerObjectType?: string): string {
  if (ownerObjectType) {
    const entry = schemaForObjectType(ownerObjectType).find(
      (candidate) => candidate.attributeType === attributeType
    )
    if (entry) return t(entry.labelKey as Key)
  }
  return humanizeArisCode(attributeType)
}
