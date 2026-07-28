/**
 * Repair-turn contract (Section 16.6 step 10; Section 4.3).
 *
 * Section 16.6 step 10: "Run up to three semantic repair turns for invalid
 * model output."
 * Section 4.3: "Large attachments are uploaded once; repair turns are
 * text-only." / "Transport/auth/rate failures do not burn semantic repair
 * attempts."
 *
 * This module models the repair loop as two pure functions plus a small
 * state shape — no I/O, no provider calls (that stays in the transport
 * lane):
 *
 *  - `advanceArisAiRepairState` decides, given the previous state and a
 *    failure's class (`'semantic'` vs `'transport'`), whether another
 *    repair turn may be sent and what the next state is. Only `'semantic'`
 *    failures — invalid `ArisAiDraftV1` output caught by validateDraft.ts —
 *    consume one of the three allowed attempts. `'transport'` failures
 *    (network/auth/HTTP-rate errors) never touch the counter; their own
 *    retry budget is the existing `withBoundedRetry` in src/ai/retry.ts,
 *    which this module does not duplicate or replace.
 *  - `buildArisAiRepairMessage` builds the next repair message text from
 *    the previous invalid draft's raw text and its structured validation
 *    findings. Its signature has no attachment parameter at all — there is
 *    no way to smuggle a binary reference through this seam, which is the
 *    structural half of "repair turns are text-only" (the message text
 *    itself also says so explicitly, for the model's benefit).
 */

import type { ArisAiValidationFinding } from './findings'
import { fenceUntrustedText } from './promptBuilder'

export const MAX_SEMANTIC_REPAIR_ATTEMPTS = 3

export type ArisAiRepairFailureClass = 'semantic' | 'transport'

export interface ArisAiRepairState {
  /** Number of semantic repair turns already issued (0 before the first one). */
  readonly semanticAttemptsUsed: number
}

export const INITIAL_ARIS_AI_REPAIR_STATE: ArisAiRepairState = { semanticAttemptsUsed: 0 }

export interface ArisAiRepairAdvanceInput {
  readonly state: ArisAiRepairState
  readonly failureClass: ArisAiRepairFailureClass
}

export type ArisAiRepairAdvanceResult =
  | { readonly outcome: 'retry'; readonly state: ArisAiRepairState }
  | { readonly outcome: 'exhausted'; readonly state: ArisAiRepairState }

/**
 * Decide whether another repair turn may be sent after a failure.
 *
 * `'transport'` failures always return `'retry'` with the state unchanged —
 * this module never bounds transport retries (that budget lives in
 * src/ai/retry.ts) and, per Section 4.3, such failures must never consume a
 * semantic attempt.
 *
 * `'semantic'` failures increment `semanticAttemptsUsed` and return
 * `'exhausted'` once more than `MAX_SEMANTIC_REPAIR_ATTEMPTS` semantic
 * repair turns have been issued.
 */
export function advanceArisAiRepairState(input: ArisAiRepairAdvanceInput): ArisAiRepairAdvanceResult {
  if (input.failureClass === 'transport') {
    return { outcome: 'retry', state: input.state }
  }

  const semanticAttemptsUsed = input.state.semanticAttemptsUsed + 1
  const state: ArisAiRepairState = { semanticAttemptsUsed }
  if (semanticAttemptsUsed > MAX_SEMANTIC_REPAIR_ATTEMPTS) {
    return { outcome: 'exhausted', state }
  }
  return { outcome: 'retry', state }
}

export interface ArisAiRepairMessageInput {
  /** The raw (untrusted) text the provider returned on the previous attempt. */
  readonly previousResponseText: string
  /** Structured findings produced by `validateArisAiDraft` for that response. */
  readonly findings: readonly ArisAiValidationFinding[]
  /** 1-based semantic repair attempt number about to be sent. */
  readonly attemptNumber: number
}

function formatFinding(finding: ArisAiValidationFinding): string {
  return `- [${finding.code}] ${finding.path}: ${finding.message}`
}

/**
 * Build the next repair-turn user message: a deterministic function of its
 * input. The previous response is quoted as untrusted data (it came from
 * the provider, not the operator) using the same fencing convention as
 * promptBuilder.ts.
 */
export function buildArisAiRepairMessage(input: ArisAiRepairMessageInput): string {
  const findingLines =
    input.findings.length > 0
      ? input.findings.map(formatFinding).join('\n')
      : '- (no structured findings were recorded)'

  return [
    `Repair turn ${input.attemptNumber} of ${MAX_SEMANTIC_REPAIR_ATTEMPTS}: the previous response did not satisfy the ArisAiDraftV1 contract.`,
    '',
    'Validation findings:',
    findingLines,
    '',
    fenceUntrustedText('Your previous response', input.previousResponseText),
    '',
    'This is a text-only repair turn: no attachment is included and none should be assumed. ' +
      'Respond with exactly one corrected ArisAiDraftV1 JSON object that fixes every finding above. ' +
      'No prose, no markdown code fence, no other text.'
  ].join('\n')
}
