export const ARIS_CONVERSION_REPORT_FORMAT = 'orbitpm-aris-conversion-report' as const
export const ARIS_CONVERSION_REPORT_VERSION = 1 as const
export const ARIS_CONVERSION_REPORT_MIME_TYPE = 'application/json' as const

export type ArisConversionReportCategory =
  'converted' | 'downgraded' | 'ignored' | 'ambiguous' | 'unmapped'

export type ArisConversionReportReason =
  | 'mapped-flow-node'
  | 'mapped-call-activity'
  | 'mapped-overview-node'
  | 'mapped-metadata-attribute'
  | 'unknown-object-type-mapped-as-task'
  | 'unknown-rule-symbol-mapped-as-exclusive-gateway'
  | 'satellite-not-mapped'
  | 'overview-container-not-emitted'
  | 'unsupported-model-type'
  | 'duplicate-object-occurrence-first-used'
  | 'multiple-hierarchy-targets-first-used'
  | 'missing-object-definition'
  | 'linked-model-not-converted'
  | 'self-referential-model-assignment'
  | 'not-present-in-any-model'

/**
 * One deterministic source-object decision. An object may have more than one
 * entry when separate decisions were necessary (for example, it converted as
 * a task but one of its model assignments was unresolved).
 */
export interface ArisConversionReportEntry {
  sourceObjectId: string
  sourceObjectType?: string
  sourceNameEn?: string
  sourceNameAr?: string
  sourceModelId?: string
  sourceModelType?: string
  targetProcessId?: string
  targetElementId?: string
  targetProperty?: string
  calledProcessId?: string
  selectedSourceId?: string
  reason: ArisConversionReportReason
  relatedSourceIds?: readonly string[]
}

export interface ArisConversionReportSummary {
  converted: number
  downgraded: number
  ignored: number
  ambiguous: number
  unmapped: number
}

export interface ArisConversionReport {
  format: typeof ARIS_CONVERSION_REPORT_FORMAT
  version: typeof ARIS_CONVERSION_REPORT_VERSION
  source: {
    databaseName?: string
    objectDefinitions: number
    models: number
  }
  outputFiles: number
  summary: ArisConversionReportSummary
  converted: readonly ArisConversionReportEntry[]
  downgraded: readonly ArisConversionReportEntry[]
  ignored: readonly ArisConversionReportEntry[]
  ambiguous: readonly ArisConversionReportEntry[]
  unmapped: readonly ArisConversionReportEntry[]
}

export interface ArisConversionReportDownload {
  fileName: string
  mimeType: typeof ARIS_CONVERSION_REPORT_MIME_TYPE
  text: string
}

type ReportEntries = Readonly<
  Record<ArisConversionReportCategory, readonly ArisConversionReportEntry[]>
>

function compareText(left: string | undefined, right: string | undefined): number {
  const a = left ?? ''
  const b = right ?? ''
  return a < b ? -1 : a > b ? 1 : 0
}

function compareEntries(left: ArisConversionReportEntry, right: ArisConversionReportEntry): number {
  return (
    compareText(left.sourceModelId, right.sourceModelId) ||
    compareText(left.sourceObjectId, right.sourceObjectId) ||
    compareText(left.reason, right.reason) ||
    compareText(left.targetProcessId, right.targetProcessId) ||
    compareText(left.targetElementId, right.targetElementId) ||
    compareText(left.targetProperty, right.targetProperty) ||
    compareText(left.calledProcessId, right.calledProcessId) ||
    compareText(left.selectedSourceId, right.selectedSourceId) ||
    compareText(left.relatedSourceIds?.join('\u0000'), right.relatedSourceIds?.join('\u0000'))
  )
}

function normalizedEntries(
  entries: readonly ArisConversionReportEntry[]
): readonly ArisConversionReportEntry[] {
  const unique = new Map<string, ArisConversionReportEntry>()
  for (const input of entries) {
    const relatedSourceIds = input.relatedSourceIds
      ? Object.freeze([...new Set(input.relatedSourceIds)].sort(compareText))
      : undefined
    const entry: ArisConversionReportEntry = {
      sourceObjectId: input.sourceObjectId,
      ...(input.sourceObjectType ? { sourceObjectType: input.sourceObjectType } : {}),
      ...(input.sourceNameEn ? { sourceNameEn: input.sourceNameEn } : {}),
      ...(input.sourceNameAr ? { sourceNameAr: input.sourceNameAr } : {}),
      ...(input.sourceModelId ? { sourceModelId: input.sourceModelId } : {}),
      ...(input.sourceModelType ? { sourceModelType: input.sourceModelType } : {}),
      ...(input.targetProcessId ? { targetProcessId: input.targetProcessId } : {}),
      ...(input.targetElementId ? { targetElementId: input.targetElementId } : {}),
      ...(input.targetProperty ? { targetProperty: input.targetProperty } : {}),
      ...(input.calledProcessId ? { calledProcessId: input.calledProcessId } : {}),
      ...(input.selectedSourceId ? { selectedSourceId: input.selectedSourceId } : {}),
      reason: input.reason,
      ...(relatedSourceIds && relatedSourceIds.length > 0 ? { relatedSourceIds } : {})
    }
    unique.set(JSON.stringify(entry), Object.freeze(entry))
  }
  return Object.freeze([...unique.values()].sort(compareEntries))
}

export function createArisConversionReport(input: {
  databaseName?: string
  objectDefinitions: number
  models: number
  outputFiles: number
  entries: ReportEntries
}): ArisConversionReport {
  const converted = normalizedEntries(input.entries.converted)
  const downgraded = normalizedEntries(input.entries.downgraded)
  const ignored = normalizedEntries(input.entries.ignored)
  const ambiguous = normalizedEntries(input.entries.ambiguous)
  const unmapped = normalizedEntries(input.entries.unmapped)
  return Object.freeze({
    format: ARIS_CONVERSION_REPORT_FORMAT,
    version: ARIS_CONVERSION_REPORT_VERSION,
    source: Object.freeze({
      ...(input.databaseName ? { databaseName: input.databaseName } : {}),
      objectDefinitions: Math.max(0, Math.floor(input.objectDefinitions)),
      models: Math.max(0, Math.floor(input.models))
    }),
    outputFiles: Math.max(0, Math.floor(input.outputFiles)),
    summary: Object.freeze({
      converted: converted.length,
      downgraded: downgraded.length,
      ignored: ignored.length,
      ambiguous: ambiguous.length,
      unmapped: unmapped.length
    }),
    converted,
    downgraded,
    ignored,
    ambiguous,
    unmapped
  })
}

/** Stable, newline-terminated JSON suitable for a user-triggered download. */
export function serializeArisConversionReport(report: ArisConversionReport): string {
  return `${JSON.stringify(report, null, 2)}\n`
}

function reportBaseName(sourceFileName: string): string {
  const leaf = sourceFileName.split(/[\\/]/).at(-1) ?? ''
  const withoutExtension = leaf.replace(/\.(?:apc|aml|xml)$/i, '')
  return (
    withoutExtension
      .normalize('NFKC')
      .replace(/[^\p{L}\p{N}._-]+/gu, '-')
      .replace(/^-+|-+$/g, '') || 'aris-import'
  )
}

/**
 * Browser-neutral handoff: App can wrap `text` in a Blob and pass `fileName`
 * to its existing download helper without coupling the converter to the DOM.
 */
export function createArisConversionReportDownload(
  report: ArisConversionReport,
  sourceFileName = 'aris-import.apc'
): ArisConversionReportDownload {
  return Object.freeze({
    fileName: `${reportBaseName(sourceFileName)}-conversion-report.json`,
    mimeType: ARIS_CONVERSION_REPORT_MIME_TYPE,
    text: serializeArisConversionReport(report)
  })
}
