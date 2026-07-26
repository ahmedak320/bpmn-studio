import type { ValidationIssue, ValidationSummary } from './contracts'

export type ValidationAction =
  | 'apply-editor'
  | 'save'
  | 'save-draft-with-errors'
  | 'create-generated'
  | 'commit-import'

export interface ValidationPolicyOptions {
  /** Required for `save-draft-with-errors` when semantic blockers exist. */
  explicitDraftConfirmation?: boolean
}

export interface ValidationPolicyDecision {
  allowed: boolean
  requiresExplicitDraftConfirmation: boolean
  blockingIssues: readonly ValidationIssue[]
  reason:
    | 'allowed'
    | 'invalid-xml'
    | 'blocking-validation-errors'
    | 'draft-confirmation-required'
    | 'unsafe-preservation-loss'
}

function unsafeMutationIssue(issue: ValidationIssue): boolean {
  return (
    issue.blocking &&
    (issue.source === 'xml' ||
      (issue.source === 'moddle' &&
        [
          'moddle.parse-error',
          'moddle.unparsable-content',
          'moddle.duplicate-id',
          'moddle.root-missing'
        ].includes(issue.code)) ||
      issue.source === 'preservation')
  )
}

/**
 * Central release-blocking policy.
 *
 * - malformed/unsafe XML is never applied;
 * - normal saves and generated/imported writes require zero blockers;
 * - a well-formed document with semantic errors may be saved only after the
 *   user explicitly chooses "Save draft with errors";
 * - extension-preservation loss is never waived by draft mode.
 */
export function evaluateValidationPolicy(
  summary: ValidationSummary,
  action: ValidationAction,
  options: ValidationPolicyOptions = {}
): ValidationPolicyDecision {
  const blockingIssues = summary.issues.filter((issue) => issue.blocking)
  const unsafeIssues = blockingIssues.filter(unsafeMutationIssue)

  if (!summary.xmlWellFormed) {
    return {
      allowed: false,
      requiresExplicitDraftConfirmation: false,
      blockingIssues,
      reason: 'invalid-xml'
    }
  }
  if (unsafeIssues.some((issue) => issue.source === 'preservation')) {
    return {
      allowed: false,
      requiresExplicitDraftConfirmation: false,
      blockingIssues: unsafeIssues,
      reason: 'unsafe-preservation-loss'
    }
  }
  if (unsafeIssues.length > 0) {
    return {
      allowed: false,
      requiresExplicitDraftConfirmation: false,
      blockingIssues: unsafeIssues,
      reason: 'invalid-xml'
    }
  }

  if (action === 'apply-editor') {
    return {
      allowed: true,
      requiresExplicitDraftConfirmation: false,
      blockingIssues,
      reason: 'allowed'
    }
  }

  if (blockingIssues.length === 0) {
    return {
      allowed: true,
      requiresExplicitDraftConfirmation: false,
      blockingIssues,
      reason: 'allowed'
    }
  }

  if (action === 'save-draft-with-errors') {
    const confirmed = options.explicitDraftConfirmation === true
    return {
      allowed: confirmed,
      requiresExplicitDraftConfirmation: !confirmed,
      blockingIssues,
      reason: confirmed ? 'allowed' : 'draft-confirmation-required'
    }
  }

  return {
    allowed: false,
    requiresExplicitDraftConfirmation: false,
    blockingIssues,
    reason: 'blocking-validation-errors'
  }
}

export function canApplyXml(summary: ValidationSummary): boolean {
  return evaluateValidationPolicy(summary, 'apply-editor').allowed
}

export function canSaveNormally(summary: ValidationSummary): boolean {
  return evaluateValidationPolicy(summary, 'save').allowed
}

export function canCreateGenerated(summary: ValidationSummary): boolean {
  return evaluateValidationPolicy(summary, 'create-generated').allowed
}

export function canCommitImport(summary: ValidationSummary): boolean {
  return evaluateValidationPolicy(summary, 'commit-import').allowed
}
