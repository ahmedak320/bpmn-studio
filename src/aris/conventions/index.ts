/**
 * Public surface of the ARIS conventions catalog (plan R1/R2/R3).
 *
 * This module is the single source of truth for symbol colors, palette groups,
 * connection legality + labels + RACI, and attribute schema.  It intentionally
 * has no runtime dependency on the canvas, model, or source modules so that
 * those lanes can import it as policy without creating cycles.
 */

export {
  ARIS_CONVENTION_SYMBOLS,
  DEFAULT_STROKE,
  conventionDefaultFill,
  conventionSymbol,
  getPaletteSymbols,
  getVariantFamily,
  type ArisConventionSymbol,
  type ArisSymbolFamilyId,
  type ArisSymbolVerification
} from './catalog'

export {
  ARIS_CONNECTION_RULES,
  ARIS_FALLBACK_CONNECTION_TYPE,
  RACI_BY_CONNECTION_TYPE,
  isLegalConnection,
  resolveConventionConnection,
  type ArisConnectionRule,
  type RaciLetter,
  type ResolvedConventionConnection
} from './connectionRules'

export {
  ARIS_ELEMENT_ATTRIBUTE_SCHEMA,
  ARIS_EPC_MODEL_ATTRIBUTE_SCHEMA,
  schemaForModelType,
  schemaForObjectType,
  type ArisAttributeSchemaEntry
} from './attributes'
