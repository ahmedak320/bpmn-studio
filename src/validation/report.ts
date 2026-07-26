import type { ValidationIssue, ValidationSummary } from './contracts'

export interface ValidationReport {
  format: 'orbitpm-validation-report'
  version: 1
  documentName?: string
  valid: boolean
  xmlWellFormed: boolean
  counts: {
    errors: number
    warnings: number
    infos: number
    blockingErrors: number
  }
  stages: ValidationSummary['stages']
  stats: ValidationSummary['stats']
  issues: readonly ValidationIssue[]
}

/** Create a stable report without timestamps, random IDs, or locale-dependent sorting. */
export function createValidationReport(
  summary: ValidationSummary,
  documentName?: string
): ValidationReport {
  return {
    format: 'orbitpm-validation-report',
    version: 1,
    ...(documentName?.trim() ? { documentName: documentName.trim() } : {}),
    valid: summary.valid,
    xmlWellFormed: summary.xmlWellFormed,
    counts: {
      errors: summary.errors,
      warnings: summary.warnings,
      infos: summary.infos,
      blockingErrors: summary.blockingErrors
    },
    stages: summary.stages,
    stats: summary.stats,
    issues: summary.issues
  }
}

export function serializeValidationReport(
  summary: ValidationSummary,
  documentName?: string
): string {
  return `${JSON.stringify(createValidationReport(summary, documentName), null, 2)}\n`
}

export function validationReportDataUrl(summary: ValidationSummary, documentName?: string): string {
  return `data:application/json;charset=utf-8,${encodeURIComponent(
    serializeValidationReport(summary, documentName)
  )}`
}
