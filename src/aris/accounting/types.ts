/**
 * OrbitPM ARIS Studio Lite — Phase 7 source accounting types.
 *
 * These types are deliberately narrow and independent of the concrete semantic
 * index shape. The only place the two worlds meet is the adapter in
 * `semanticIndexAdapter.ts`.
 */

/**
 * What the product does with a given source construct.
 *
 * The union is exactly the contract from the transformation plan, Section 10.1.
 */
export type ArisAccountingDisposition =
  | 'editable-native'
  | 'visual-only'
  | 'side-panel'
  | 'attachment'
  | 'raw-source-only'
  | 'proposed-repair'
  | 'unsupported'

/**
 * Every ARIS/XML construct that must be accounted for under Section 10.2, plus
 * the raw XML layer constructs (text, comments, CDATA, PIs, attributes) that the
 * independent lexical census counts.
 */
export type ArisEntityKind =
  | 'xml-declaration'
  | 'xml-declaration-attribute'
  | 'doctype'
  | 'document-root'
  | 'database'
  | 'group'
  | 'language'
  | 'language-name'
  | 'model'
  | 'model-attribute'
  | 'object-definition'
  | 'object-occurrence'
  | 'connection-definition'
  | 'connection-occurrence'
  | 'attribute-definition'
  | 'attribute-value'
  | 'attribute-occurrence'
  | 'styled-run'
  | 'flag'
  | 'assignment'
  | 'lane'
  | 'free-text'
  | 'free-text-occurrence'
  | 'ole-definition'
  | 'ole-occurrence'
  | 'blob'
  | 'font-style-sheet'
  | 'font'
  | 'pen'
  | 'brush'
  | 'position'
  | 'size'
  | 'route-point'
  | 'guid-reference'
  | 'template-reference'
  | 'unknown'
  | 'text'
  | 'comment'
  | 'cdata'
  | 'processing-instruction'
  | 'element-attribute'

/**
 * A single accounting entry proving that one source construct has been examined
 * and given a disposition. The shape matches the plan Section 10.1 contract
 * exactly, plus one explicit addition (`derived`) that documents the
 * Phase 4/Phase 7 census contract — see the note below.
 */
export interface ArisAccountingEntry {
  sourcePath: string
  sourceId?: string
  kind: ArisEntityKind
  disposition: ArisAccountingDisposition
  targetIds: readonly string[]
  reason?: string
  /**
   * `true` for a synthetic/derived record that does not correspond to a
   * literal construct in the raw XML — currently only `kind: 'assignment'`
   * (a linked-model assignment reconstructed from `LinkedModels.IdRefs`).
   *
   * The independent lexical census (`buildLexicalCensus`) walks the raw
   * tokenizer output and, by design, has no way to count a record that isn't
   * literally in the XML. Derived entries are therefore excluded from the
   * census total on purpose (§10.3 "no record may silently disappear" still
   * holds: they are fully present in `entries`, reported, and disposition-
   * tagged — they are just not double-counted against a census that cannot
   * see them).
   *
   * Downstream, `createArisAccountingDocument` (`src/aris/packages/accounting.ts`)
   * validates that only *non-derived* entries are bounded by `censusRecords`.
   * Callers should pass the full, unfiltered entry list — including derived
   * rows — straight through; filtering them out before construction is
   * unnecessary and loses their provenance from the persisted document.
   */
  derived?: boolean
}

/**
 * A record extracted from the semantic index in a shape the accounting layer
 * understands. The adapter is responsible for flattening the index into these
 * records.
 */
export interface ArisAccountingRecord {
  readonly path: string
  readonly sourceId: string | null
  readonly recordKind: string
  readonly elementName: string
  readonly parsedOwnerElementName?: string | null
  readonly parentElementName?: string | null
}

/**
 * A linked-model assignment derived from an object definition. These are not
 * separate XML elements, so they are accounted as derived semantic records.
 */
export interface ArisAccountingAssignment {
  readonly objectDefinitionId: string | null
  readonly objectDefinitionPath: string
  readonly modelId: string
}

/**
 * The complete accounting input produced by the adapter.
 */
export interface ArisAccountingSource {
  readonly records: readonly ArisAccountingRecord[]
  readonly assignments: readonly ArisAccountingAssignment[]
}

/**
 * Independent lexical census of the raw token/CST layer. This is intentionally
 * not derived from the semantic index; it walks the tokenizer output directly.
 */
export interface ArisLexicalCensus {
  readonly totalSourceRecords: number
  readonly elementCounts: Readonly<Record<string, number>>
  readonly attributeTotal: number
  readonly attributeCountsByName: Readonly<Record<string, number>>
  readonly textNodes: number
  readonly comments: number
  readonly cdataSections: number
  readonly processingInstructions: number
  readonly xmlDeclaration: number
  readonly xmlDeclarationAttributes: number
  readonly doctype: number
}

export interface ArisReconciliationDivergence {
  readonly construct: string
  readonly census: number
  readonly accounted: number
  readonly diff: number
}

export interface ArisAccountingIssue {
  readonly severity: 'error' | 'warning'
  readonly construct: string
  readonly sourcePath: string
  readonly message: string
}

export interface ArisReconciliationResult {
  readonly ok: boolean
  readonly totalSourceRecords: number
  readonly totalAccounted: number
  readonly unaccountedCount: number
  readonly perConstruct: readonly ArisReconciliationDivergence[]
  readonly issues: readonly ArisAccountingIssue[]
}

export interface ArisAccountingReportRow extends ArisAccountingEntry {
  readonly modelId?: string
  readonly issue?: string
}

export interface ArisAccountingReport {
  readonly format: 'orbitpm-aris-accounting-report'
  readonly version: 1
  readonly totalSourceRecords: number
  readonly totalAccounted: number
  readonly unaccountedCount: number
  readonly summary: {
    readonly byKind: Readonly<Record<string, number>>
    readonly byDisposition: Readonly<Record<string, number>>
  }
  readonly issues: readonly ArisAccountingIssue[]
  readonly entries: readonly ArisAccountingReportRow[]
}
