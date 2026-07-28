/**
 * Top-level entry point: validate an unknown provider response against
 * `ArisAiDraftV1`. Composes, in order:
 *
 *  1. `scanForForbiddenContent` — the Section 16.4 security rejection pass,
 *     run first and short-circuited on so a security violation is always
 *     reported as such, never masked by an unrelated shape error.
 *  2. `ArisAiDraftV1Schema.safeParse` — strict shape validation (Section
 *     16.6 step 7).
 *  3. `validateArisAiTypes` — object/model/connection type-vocabulary
 *     validation (Section 16.6 step 8).
 *  4. `validateLogicalIdIntegrity` — logical-id graph integrity (task item 3).
 *
 * Steps 3 and 4 both require a structurally valid draft, so they only run
 * once step 2 succeeds; their findings are combined and returned together
 * (a caller building a repair-turn message benefits from seeing every type
 * and integrity problem at once rather than one at a time).
 *
 * What this module deliberately does NOT do: EPC semantic validation
 * (Section 16.6 step 9 — chronology, split/merge pairing, "events never
 * decide") is owned by the EPC validator another agent is building in
 * src/aris/epc/. This module's `ArisAiValidationResult` is designed to be a
 * clean input to that next stage — see the "seams" note in the top-level
 * report for the intended hand-off shape.
 */

import { z } from 'zod'
import { ArisAiDraftV1Schema, type ArisAiDraftV1 } from './contract'
import { scanForForbiddenContent } from './forbiddenContent'
import { finding, type ArisAiValidationFinding } from './findings'
import { validateLogicalIdIntegrity } from './logicalIntegrity'
import { validateArisAiTypes } from './typeValidation'

export type { ArisAiValidationFinding } from './findings'

export type ArisAiValidationResult =
  | { readonly ok: true; readonly draft: ArisAiDraftV1 }
  | { readonly ok: false; readonly findings: readonly ArisAiValidationFinding[] }

function zodPathToString(path: readonly PropertyKey[]): string {
  let result = '$'
  for (const segment of path) {
    result += typeof segment === 'number' ? `[${segment}]` : `.${String(segment)}`
  }
  return result
}

function zodErrorToFindings(error: z.ZodError): ArisAiValidationFinding[] {
  return error.issues.map((issue) =>
    finding(`schema:${issue.code}`, zodPathToString(issue.path), issue.message)
  )
}

/**
 * Validate a raw, untrusted, already-JSON-parsed provider response.
 * Never throws — every failure path returns `{ ok: false, findings }`.
 */
export function validateArisAiDraft(raw: unknown): ArisAiValidationResult {
  const forbiddenFindings = scanForForbiddenContent(raw)
  if (forbiddenFindings.length > 0) {
    return { ok: false, findings: forbiddenFindings }
  }

  const parsed = ArisAiDraftV1Schema.safeParse(raw)
  if (!parsed.success) {
    return { ok: false, findings: zodErrorToFindings(parsed.error) }
  }

  const findings = [...validateArisAiTypes(parsed.data), ...validateLogicalIdIntegrity(parsed.data)]
  if (findings.length > 0) {
    return { ok: false, findings }
  }

  return { ok: true, draft: parsed.data }
}
