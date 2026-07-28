/**
 * ARIS AML writer and derived export (plan section 9).
 *
 * The imported original is immutable. This module never edits it: it produces a DERIVED
 * document by applying byte-addressed edits to a copy of the original text, so every byte the
 * caller did not explicitly address is copied verbatim — whitespace, comments, unknown
 * elements, attribute order, and quote style included.
 */
export * from './compatibility'
export * from './edits'
export * from './emit'
export * from './errors'
export * from './escapeXml'
export * from './exportDerivedAml'
export * from './ids'
export * from './patch'
export * from './sourceSeam'
export * from './sourceView'
export * from './spans'
export * from './validate'
