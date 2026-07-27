/**
 * Closed catalog for validation keys emitted by the spreadsheet pipeline.
 *
 * Keeping dynamic issue construction behind this list makes missing EN/AR
 * translations detectable in a small contract test.
 */
export const SPREADSHEET_VALIDATION_ISSUE_CODES = Object.freeze([
  'bilingual-audit-failed',
  'branch-topology-requires-explicit-conditions',
  'cached-formula-value',
  'called-process-on-non-call-activity',
  'called-process-reviewed-unlinked',
  'called-process-unresolved',
  'data-connections-ignored',
  'default-flow-has-condition',
  'default-flow-source-invalid',
  'destination-folder-unsafe',
  'destination-hash-missing',
  'destination-inspection-failed',
  'destination-path-collision',
  'destination-process-id-collision',
  'diagram-readability',
  'duplicate-numeric-order',
  'end-event-missing',
  'end-event-outgoing',
  'event-definition-on-non-event',
  'explicit-flows-required',
  'external-links-ignored',
  'flow-duplicate-edge',
  'flow-id-duplicate',
  'flow-id-invalid',
  'flow-id-missing',
  'flow-self-loop-review',
  'flow-source-missing',
  'flow-target-missing',
  'formula-without-cache',
  'gateway-branch-count',
  'gateway-condition-not-allowed',
  'gateway-condition-required',
  'gateway-default-not-allowed',
  'gateway-topology-not-inferred',
  'glossary-entry-duplicate',
  'glossary-entry-incomplete',
  'invalid-boolean',
  'low-confidence-mapping',
  'mapped-header-duplicate',
  'mapped-header-missing',
  'mapped-header-row-missing',
  'mapped-next-step-required',
  'mapped-sheet-missing',
  'missing-required-mapping',
  'missing-steps-sheet',
  'model-version-unsupported',
  'multiple-default-flows',
  'multiple-lane-assignments',
  'node-id-duplicate',
  'node-id-invalid',
  'node-id-missing',
  'node-id-workbook-duplicate',
  'node-name-missing',
  'node-order-invalid',
  'node-participant-kind-mismatch',
  'node-participant-missing',
  'node-process-limit',
  'node-process-missing',
  'node-transaction-limit',
  'node-unreachable',
  'numeric-order-required',
  'official-template-header-mismatch',
  'official-template-sheet-missing',
  'official-template-version-unsupported',
  'participant-id-duplicate',
  'participant-id-invalid',
  'participant-id-missing',
  'participant-name-missing',
  'participant-parent-cycle',
  'participant-parent-missing',
  'participant-process-missing',
  'pipeline-diagnostic',
  'pipeline-generation-failed',
  'pool-parent-not-allowed',
  'process-id-duplicate',
  'process-id-invalid',
  'process-id-missing',
  'process-name-missing',
  'processes-empty',
  'raci-invalid',
  'start-event-incoming',
  'start-event-missing',
  'synthetic-boundary-confirmation-required',
  'synthetic-end-ambiguous',
  'synthetic-start-ambiguous',
  'translation-review-required',
  'unknown-participant-type',
  'unknown-step-type'
] as const)

export type SpreadsheetValidationIssueCode = (typeof SPREADSHEET_VALIDATION_ISSUE_CODES)[number]

export function spreadsheetValidationMessageKey(
  code: SpreadsheetValidationIssueCode
): `spreadsheet.validation.${SpreadsheetValidationIssueCode}` {
  return `spreadsheet.validation.${code}`
}

export const SPREADSHEET_VALIDATION_MESSAGE_KEYS = Object.freeze(
  SPREADSHEET_VALIDATION_ISSUE_CODES.map(spreadsheetValidationMessageKey)
)

export const SPREADSHEET_GUIDANCE_KEYS = Object.freeze([
  'spreadsheet.guidance.choose-collision-behavior',
  'spreadsheet.guidance.confirm-field-mapping',
  'spreadsheet.guidance.correct-source-and-revalidate',
  'spreadsheet.guidance.map-participant-type',
  'spreadsheet.guidance.map-step-type',
  'spreadsheet.guidance.refresh-destination-state',
  'spreadsheet.guidance.replace-formula-with-value',
  'spreadsheet.guidance.retry-destination-inspection',
  'spreadsheet.guidance.review-inference-inputs',
  'spreadsheet.guidance.use-boolean',
  'spreadsheet.guidance.verify-cached-formula-value'
] as const)

export type SpreadsheetGuidanceKey = (typeof SPREADSHEET_GUIDANCE_KEYS)[number]
