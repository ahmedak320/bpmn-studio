import {
  elementNameFromEntryPath,
  buildAccountingEntries as _buildAccountingEntries
} from './accounting'
import { buildLexicalCensus as _buildLexicalCensus } from './lexicalCensus'
import type {
  ArisAccountingDisposition,
  ArisAccountingEntry,
  ArisAccountingIssue,
  ArisLexicalCensus,
  ArisReconciliationDivergence,
  ArisReconciliationResult
} from './types'

const VALID_DISPOSITIONS: ReadonlySet<ArisAccountingDisposition> = new Set([
  'editable-native',
  'visual-only',
  'side-panel',
  'attachment',
  'raw-source-only',
  'proposed-repair',
  'unsupported'
])

const ELEMENT_KINDS: ReadonlySet<string> = new Set([
  'document-root',
  'database',
  'group',
  'language',
  'language-name',
  'model',
  'model-attribute',
  'object-definition',
  'object-occurrence',
  'connection-definition',
  'connection-occurrence',
  'attribute-definition',
  'attribute-value',
  'attribute-occurrence',
  'styled-run',
  'flag',
  'lane',
  'free-text',
  'free-text-occurrence',
  'ole-definition',
  'ole-occurrence',
  'blob',
  'font-style-sheet',
  'font',
  'pen',
  'brush',
  'position',
  'size',
  'route-point',
  'guid-reference',
  'template-reference',
  'unknown'
])

const LEAF_KINDS: ReadonlySet<string> = new Set([
  'text',
  'comment',
  'cdata',
  'processing-instruction'
])

function countBy<T>(items: readonly T[], key: (item: T) => string | null): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const item of items) {
    const k = key(item)
    if (k === null) continue
    counts[k] = (counts[k] ?? 0) + 1
  }
  return counts
}

function attributeNameFromPath(path: string): string | null {
  if (!path.includes('@')) return null
  return path.slice(path.lastIndexOf('@') + 1)
}

/**
 * Compare the independent lexical census against the accounting entries and
 * produce a structured reconciliation result.
 *
 * The result is `ok` only when every counted construct is accounted for. Any
 * divergence is reported with the construct name, the census count, the
 * accounted count, and the exact difference.
 */
export function reconcile(
  census: ArisLexicalCensus,
  entries: readonly ArisAccountingEntry[]
): ArisReconciliationResult {
  const issues: ArisAccountingIssue[] = []
  const divergences: ArisReconciliationDivergence[] = []

  const pushDivergence = (construct: string, censusCount: number, accountedCount: number): void => {
    if (censusCount !== accountedCount) {
      divergences.push({
        construct,
        census: censusCount,
        accounted: accountedCount,
        diff: censusCount - accountedCount
      })
    }
  }

  // Element-backed entries exclude derived assignments and non-element rows.
  const elementEntries = entries.filter(
    (entry) => ELEMENT_KINDS.has(entry.kind) && elementNameFromEntryPath(entry.sourcePath) !== null
  )
  const accountedElementCounts = countBy(elementEntries, (entry) =>
    elementNameFromEntryPath(entry.sourcePath)
  )

  const allElementNames = new Set([
    ...Object.keys(census.elementCounts),
    ...Object.keys(accountedElementCounts)
  ])
  for (const name of allElementNames) {
    pushDivergence(
      `element:${name}`,
      census.elementCounts[name] ?? 0,
      accountedElementCounts[name] ?? 0
    )
  }

  // Attribute entries: every element attribute plus XML declaration attributes.
  const attributeEntries = entries.filter(
    (entry) => entry.kind === 'element-attribute' || entry.kind === 'xml-declaration-attribute'
  )
  const accountedAttributeTotal = attributeEntries.length
  const accountedAttributeCountsByName = countBy(attributeEntries, (entry) =>
    attributeNameFromPath(entry.sourcePath)
  )

  pushDivergence('attribute:total', census.attributeTotal, accountedAttributeTotal)
  const allAttributeNames = new Set([
    ...Object.keys(census.attributeCountsByName),
    ...Object.keys(accountedAttributeCountsByName)
  ])
  for (const name of allAttributeNames) {
    pushDivergence(
      `attribute:${name}`,
      census.attributeCountsByName[name] ?? 0,
      accountedAttributeCountsByName[name] ?? 0
    )
  }

  // Leaf nodes: text, comments, CDATA, processing instructions.
  const leafCounts: Record<string, number> = {
    text: 0,
    comment: 0,
    cdata: 0,
    'processing-instruction': 0
  }
  for (const entry of entries) {
    if (LEAF_KINDS.has(entry.kind)) {
      leafCounts[entry.kind] = (leafCounts[entry.kind] ?? 0) + 1
    }
  }
  pushDivergence('text', census.textNodes, leafCounts.text)
  pushDivergence('comment', census.comments, leafCounts.comment)
  pushDivergence('cdata', census.cdataSections, leafCounts.cdata)
  pushDivergence(
    'processing-instruction',
    census.processingInstructions,
    leafCounts['processing-instruction']
  )

  // XML declaration and DOCTYPE.
  const xmlDeclarationEntries = entries.filter((entry) => entry.kind === 'xml-declaration').length
  const doctypeEntries = entries.filter((entry) => entry.kind === 'doctype').length
  pushDivergence('xml-declaration', census.xmlDeclaration, xmlDeclarationEntries)
  pushDivergence('doctype', census.doctype, doctypeEntries)

  // Every entry must carry one of the seven legal dispositions.
  const entriesLackingDisposition = entries.filter(
    (entry) => !VALID_DISPOSITIONS.has(entry.disposition)
  )
  if (entriesLackingDisposition.length > 0) {
    for (const entry of entriesLackingDisposition) {
      issues.push({
        severity: 'error',
        construct: entry.kind,
        sourcePath: entry.sourcePath,
        message: `Entry lacks a disposition (${String(entry.disposition)})`
      })
    }
  }

  // Derived records (assignments) are not separate source constructs, so they
  // are excluded from the source-record total.
  const derivedEntries = entries.filter((entry) => entry.kind === 'assignment')
  const totalAccountedSourceConstructs = entries.length - derivedEntries.length
  const unaccountedCount = census.totalSourceRecords - totalAccountedSourceConstructs

  if (unaccountedCount !== 0) {
    pushDivergence('total', census.totalSourceRecords, totalAccountedSourceConstructs)
  }

  const ok = divergences.length === 0 && issues.length === 0 && unaccountedCount === 0

  return Object.freeze({
    ok,
    totalSourceRecords: census.totalSourceRecords,
    totalAccounted: entries.length,
    unaccountedCount,
    perConstruct: Object.freeze(divergences),
    issues: Object.freeze(issues)
  })
}

/**
 * Throw a detailed error if reconciliation failed. This is the "fail loudly"
 * helper for callers that expect the three views to agree.
 */
export function requireReconciled(result: ArisReconciliationResult): ArisReconciliationResult {
  if (!result.ok) {
    const lines = [
      `Accounting reconciliation failed with ${result.perConstruct.length} divergence(s).`,
      `Total source records: ${result.totalSourceRecords}`,
      `Total accounted: ${result.totalAccounted}`,
      `Unaccounted: ${result.unaccountedCount}`,
      ...result.perConstruct.map(
        (div) => `  ${div.construct}: census=${div.census} accounted=${div.accounted} diff=${div.diff}`
      ),
      ...result.issues.map((issue) => `  issue: ${issue.severity} ${issue.construct} ${issue.sourcePath}`)
    ]
    throw new Error(lines.join('\n'))
  }
  return result
}
