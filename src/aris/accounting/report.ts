import type {
  ArisAccountingEntry,
  ArisAccountingIssue,
  ArisAccountingReport,
  ArisAccountingReportRow,
  ArisReconciliationResult
} from './types'

/**
 * Build a deterministic, filterable accounting report.
 *
 * The report is stable: entries are sorted by source path, kind, source id and
 * disposition; object keys are emitted in a fixed order; and no timestamps,
 * absolute paths, or machine-specific data are included.
 */
export function buildAccountingReport(
  entries: readonly ArisAccountingEntry[],
  reconciliation: ArisReconciliationResult
): ArisAccountingReport {
  const modelIds = new Set<string>()
  for (const entry of entries) {
    if (entry.kind === 'model' && entry.sourceId) {
      modelIds.add(entry.sourceId)
    }
  }

  const modelIdFor = (entry: ArisAccountingEntry): string | undefined => {
    if (entry.kind === 'model' && entry.sourceId) return entry.sourceId
    for (const id of entry.targetIds) {
      if (modelIds.has(id)) return id
    }
    return undefined
  }

  const issueFor = (entry: ArisAccountingEntry): string | undefined => {
    if (entry.disposition === 'unsupported') return 'Unsupported source construct'
    if (entry.kind === 'unknown')
      return entry.reason ?? 'Unrecognized element preserved as raw source'
    return undefined
  }

  const byKind: Record<string, number> = {}
  const byDisposition: Record<string, number> = {}
  for (const entry of entries) {
    byKind[entry.kind] = (byKind[entry.kind] ?? 0) + 1
    byDisposition[entry.disposition] = (byDisposition[entry.disposition] ?? 0) + 1
  }

  const sortedEntries = [...entries]
    .map((entry) => {
      const row: ArisAccountingReportRow = {
        ...entry,
        modelId: modelIdFor(entry),
        issue: issueFor(entry)
      }
      return row
    })
    .sort((a, b) => {
      if (a.sourcePath !== b.sourcePath) return a.sourcePath.localeCompare(b.sourcePath)
      if (a.kind !== b.kind) return a.kind.localeCompare(b.kind)
      if (a.sourceId !== b.sourceId) return (a.sourceId ?? '').localeCompare(b.sourceId ?? '')
      return a.disposition.localeCompare(b.disposition)
    })

  const issues: ArisAccountingIssue[] = [...reconciliation.issues]
  for (const divergence of reconciliation.perConstruct) {
    issues.push({
      severity: 'error',
      construct: divergence.construct,
      sourcePath: '',
      message: `Census (${divergence.census}) and accounting (${divergence.accounted}) diverge by ${divergence.diff}`
    })
  }

  return Object.freeze({
    format: 'orbitpm-aris-accounting-report',
    version: 1,
    totalSourceRecords: reconciliation.totalSourceRecords,
    totalAccounted: reconciliation.totalAccounted,
    unaccountedCount: reconciliation.unaccountedCount,
    summary: Object.freeze({
      byKind: Object.freeze(byKind),
      byDisposition: Object.freeze(byDisposition)
    }),
    issues: Object.freeze(issues),
    entries: Object.freeze(sortedEntries)
  })
}

/**
 * Serialize a report to deterministic JSON.
 *
 * Key order is fixed by object literal insertion order. Entries are already
 * sorted by `buildAccountingReport`. The output contains no timestamps or
 * absolute paths.
 */
export function serializeAccountingReport(report: ArisAccountingReport): string {
  const payload: Record<string, unknown> = {
    format: report.format,
    version: report.version,
    totalSourceRecords: report.totalSourceRecords,
    totalAccounted: report.totalAccounted,
    unaccountedCount: report.unaccountedCount,
    summary: report.summary,
    issues: report.issues,
    entries: report.entries
  }
  return `${JSON.stringify(payload, null, 2)}\n`
}

/**
 * Compute the SHA-256 digest of a deterministic report serialization.
 */
export async function computeReportSha256(reportJson: string): Promise<string> {
  const encoder = new TextEncoder()
  const digest = await globalThis.crypto.subtle.digest('SHA-256', encoder.encode(reportJson))
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

/** Filter report rows that belong to a specific model. */
export function filterReportByModel(
  report: ArisAccountingReport,
  modelId: string
): readonly ArisAccountingReportRow[] {
  return report.entries.filter((row) => row.modelId === modelId)
}

/** Filter report rows by entity kind. */
export function filterReportByKind(
  report: ArisAccountingReport,
  kind: string
): readonly ArisAccountingReportRow[] {
  return report.entries.filter((row) => row.kind === kind)
}

/** Filter report rows by disposition. */
export function filterReportByDisposition(
  report: ArisAccountingReport,
  disposition: string
): readonly ArisAccountingReportRow[] {
  return report.entries.filter((row) => row.disposition === disposition)
}

/** Filter report rows that carry an issue. */
export function filterReportByIssue(
  report: ArisAccountingReport
): readonly ArisAccountingReportRow[] {
  return report.entries.filter((row) => row.issue !== undefined)
}
