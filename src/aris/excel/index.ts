/**
 * ARIS-native Excel pipeline (aris_transformation.md §15, Phase 12).
 *
 * Public surface:
 * - `templateSchema` — the nine sheets, their exact columns, the allowed model
 *   and object vocabularies, and the `x:y|x:y` route syntax.
 * - `templateWriter` — deterministic blank/example `.xlsx` generation.
 * - `workbookParser` / `browserWorkbookParser` — the §15.3 pipeline (steps 1-7)
 *   as a pure function over bytes, plus its inline-worker boundary.
 * - `workbookModel` — `ArisWorkbookModel`, the seam consumed downstream.
 * - `issues` — localizable issue codes, severities, and message keys.
 * - `limits` — the §15.4 boundary values.
 *
 * ## Seam for the AML generator
 *
 * ```ts
 * const result = parseArisWorkbook(fileName, bytes)          // or the browser/worker variant
 * if (isAcceptedArisWorkbook(result)) {
 *   generateAml(result.model)                                // ArisWorkbookModel
 * }
 * renderIssues(result.issues)                                // localizable, cell-addressed
 * ```
 *
 * `ArisWorkbookModel` is the ONLY value the AML lane should consume from here.
 * It is frozen, fully validated (ids unique, every reference resolves, every
 * value coerced), and every scalar carries `{ value, raw, provenance }` with the
 * sheet name and A1 address it came from. This module deliberately stops before
 * AML generation, ID allocation, layout, preview, and transactional commit
 * (§15.3 steps 9-13) — those belong to downstream lanes.
 */
export * from './browserWorkbookParser'
export * from './issues'
export * from './limits'
export * from './templateSchema'
export * from './templateWriter'
export * from './workbookModel'
export * from './workbookParser'
export * from './workbookParserWorkerProtocol'
export * from './xlsxReader'
export * from './xlsxWriter'
