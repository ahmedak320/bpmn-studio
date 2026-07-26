/**
 * Durable, UI-agnostic BPMN validation contracts.
 *
 * Every validation layer emits the same shape so document sessions, imports,
 * generation, source editing and reports do not have to interpret library
 * specific errors.  The core deliberately contains no localized prose; callers
 * may translate `code` while retaining `message` as a diagnostic fallback.
 */

export type ValidationSeverity = 'error' | 'warning' | 'info'

export type ValidationSource =
  | 'xml'
  | 'moddle'
  | 'xsd'
  | 'bpmnlint'
  | 'structure'
  | 'semantic'
  | 'di'
  | 'orbitpm'
  | 'preservation'

export interface SourceLocation {
  /** One-based line number. */
  line: number
  /** One-based column number. */
  column: number
  /** Zero-based UTF-16 offset when known. */
  offset?: number
}

export interface ValidationIssue {
  /** Stable, machine-readable rule identifier (for example `xml.doctype`). */
  code: string
  severity: ValidationSeverity
  source: ValidationSource
  message: string
  /**
   * A blocking issue prevents an ordinary save and all generated/imported
   * writes.  Some blocking semantic issues may still be saved through the
   * explicit "draft with errors" policy.
   */
  blocking: boolean
  processId?: string
  elementId?: string
  diagramId?: string
  planeId?: string
  location?: SourceLocation
  suggestedRepair?: string
  /** Rule id supplied by an external validator such as bpmnlint. */
  ruleId?: string
  /** Optional structured facts safe to include in an exported report. */
  details?: Readonly<Record<string, string | number | boolean | null>>
}

export type ValidationStageName =
  | 'preflight'
  | 'moddle'
  | 'xsd'
  | 'bpmnlint'
  | 'structure'
  | 'semantic'
  | 'di'
  | 'orbitpm'
  | 'preservation'

export type ValidationStageStatus = 'passed' | 'failed' | 'unavailable' | 'not-run'

export type ValidationStages = Readonly<Record<ValidationStageName, ValidationStageStatus>>

export interface ValidationDocumentStats {
  processes: number
  collaborations: number
  diagrams: number
  planes: number
  elements: number
}

export interface ValidationSummary {
  issues: readonly ValidationIssue[]
  errors: number
  warnings: number
  infos: number
  blockingErrors: number
  /**
   * True only when secure preflight and moddle parsing succeeded.  Semantic,
   * XSD, DI, link or bilingual errors do not make XML syntactically malformed.
   */
  xmlWellFormed: boolean
  /** True when no blocking issue exists. */
  valid: boolean
  stages: ValidationStages
  stats: ValidationDocumentStats
}

export const EMPTY_VALIDATION_STATS: ValidationDocumentStats = Object.freeze({
  processes: 0,
  collaborations: 0,
  diagrams: 0,
  planes: 0,
  elements: 0
})

export const DEFAULT_VALIDATION_STAGES: ValidationStages = Object.freeze({
  preflight: 'not-run',
  moddle: 'not-run',
  xsd: 'unavailable',
  bpmnlint: 'unavailable',
  structure: 'not-run',
  semantic: 'not-run',
  di: 'not-run',
  orbitpm: 'not-run',
  preservation: 'not-run'
})

export function validationIssue(
  issue: Omit<ValidationIssue, 'blocking'> & { blocking?: boolean }
): ValidationIssue {
  return Object.freeze({
    ...issue,
    blocking: issue.blocking ?? issue.severity === 'error'
  })
}

function isXmlFatal(issue: ValidationIssue): boolean {
  if (!issue.blocking) return false
  if (issue.source === 'xml') return true
  return (
    issue.source === 'moddle' &&
    [
      'moddle.parse-error',
      'moddle.unparsable-content',
      'moddle.duplicate-id',
      'moddle.root-missing'
    ].includes(issue.code)
  )
}

export function createValidationSummary(
  issues: readonly ValidationIssue[],
  options: {
    stages?: Partial<Record<ValidationStageName, ValidationStageStatus>>
    stats?: ValidationDocumentStats
    /** Override only for an adapter that has authoritative parser state. */
    xmlWellFormed?: boolean
  } = {}
): ValidationSummary {
  const normalized = issues.map((issue) => validationIssue(issue))
  const errors = normalized.filter((issue) => issue.severity === 'error').length
  const warnings = normalized.filter((issue) => issue.severity === 'warning').length
  const infos = normalized.filter((issue) => issue.severity === 'info').length
  const blockingErrors = normalized.filter((issue) => issue.blocking).length
  const xmlWellFormed =
    options.xmlWellFormed ?? !normalized.some((issue) => isXmlFatal(issue))

  return Object.freeze({
    issues: Object.freeze(normalized),
    errors,
    warnings,
    infos,
    blockingErrors,
    xmlWellFormed,
    valid: blockingErrors === 0,
    stages: Object.freeze({ ...DEFAULT_VALIDATION_STAGES, ...options.stages }),
    stats: Object.freeze({ ...(options.stats ?? EMPTY_VALIDATION_STATS) })
  })
}

export function mergeValidationSummaries(
  ...summaries: readonly ValidationSummary[]
): ValidationSummary {
  if (summaries.length === 0) {
    return createValidationSummary([])
  }

  const stages: Partial<Record<ValidationStageName, ValidationStageStatus>> = {}
  const rank: Record<ValidationStageStatus, number> = {
    'not-run': 0,
    unavailable: 1,
    passed: 2,
    failed: 3
  }

  for (const summary of summaries) {
    for (const [stage, status] of Object.entries(summary.stages) as Array<
      [ValidationStageName, ValidationStageStatus]
    >) {
      const current = stages[stage]
      if (!current || rank[status] > rank[current]) stages[stage] = status
    }
  }

  const lastStats =
    [...summaries].reverse().find((summary) => summary.stats.elements > 0)?.stats ??
    EMPTY_VALIDATION_STATS

  return createValidationSummary(
    summaries.flatMap((summary) => [...summary.issues]),
    {
      stages,
      stats: { ...lastStats },
      xmlWellFormed: summaries.every((summary) => summary.xmlWellFormed)
    }
  )
}
