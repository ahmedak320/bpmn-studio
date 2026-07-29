/**
 * The §16.6 generation sequence, steps 3–10, as one transport-agnostic loop.
 *
 * The Create surface owns steps 1–2 (capability, then input type/size — see
 * arisAiAttachments.ts) and steps 11–17 (local id allocation, AML, preview,
 * confirm, commit — see arisAiCreate.ts and arisAiPlacement.ts). What is left
 * in between is the part that is easy to get subtly wrong, so it lives here,
 * alone, behind an injected `send`:
 *
 *   3. build reviewed outbound request  → the caller passes `system`/`user`
 *      from `buildArisAiPrompt`, so the bytes previewed are the bytes sent.
 *   4. wait for consent                 → the caller does not call this until
 *      consent is given; nothing here can send without being called.
 *   5. **attachment on the first attempt only** → enforced structurally: the
 *      local `attachment` binding is cleared the moment the first `send`
 *      returns or throws, so no later turn can carry it. The repair message
 *      itself is built by `buildArisAiRepairMessage`, whose signature has no
 *      attachment parameter at all.
 *   6. parse bounded response           → {@link parseArisAiResponseJson}.
 *   7-9. validate draft, types, EPC semantics.
 *   10. up to three semantic repair turns → `advanceArisAiRepairState`.
 *
 * ## Transport vs semantic (plan §4.3)
 *
 * "Transport/auth/rate failures do not burn semantic repair attempts." Both
 * classes are routed through `advanceArisAiRepairState`, which increments the
 * counter for `'semantic'` only. A transport failure therefore leaves
 * `semanticAttemptsUsed` untouched and ends the run — its own retry budget was
 * already spent inside `withBoundedRetry` in src/ai/retry.ts before `send`
 * rejected, and re-entering the loop would either re-upload the attachment
 * (forbidden) or spin. The returned `semanticAttemptsUsed` makes the
 * distinction observable, which is what the tests assert on.
 */

import {
  INITIAL_ARIS_AI_REPAIR_STATE,
  MAX_SEMANTIC_REPAIR_ATTEMPTS,
  advanceArisAiRepairState,
  buildArisAiRepairMessage,
  validateArisAiDraft,
  type ArisAiDraftV1,
  type ArisAiValidationFinding
} from '../ai'
import { validateArisAiDraftEpcSemantics } from '../ai/epcSemantics'
import { finding } from '../ai/findings'
import type { GenAttachment } from '../../ai/pdf'

/**
 * Hard ceiling on the model text this module will parse or quote back.
 * The browser transport already bounds the response body (1 MiB decompressed,
 * `MAX_PROVIDER_RESPONSE_BODY_BYTES`); this second bound covers injected
 * senders and keeps a hostile-but-small response from being echoed at full
 * length into every subsequent repair turn.
 */
export const MAX_ARIS_AI_RESPONSE_CHARS = 400_000
/** How much of an invalid response is quoted back in a repair turn. */
export const MAX_ARIS_AI_REPAIR_ECHO_CHARS = 20_000

export interface ArisAiGenerationMessage {
  readonly role: 'system' | 'user' | 'assistant'
  readonly content: string
}

/** Exactly what one physical attempt would send. */
export interface ArisAiGenerationRequest {
  /** 1 for the first attempt, then one per semantic repair turn. */
  readonly attemptNumber: number
  /** System prompt (constant across the run). */
  readonly system: string
  /** The user turn for THIS attempt (the repair message on later attempts). */
  readonly user: string
  /** Full ordered turn list, ready for a provider adapter. */
  readonly messages: readonly ArisAiGenerationMessage[]
  /** Present on attempt 1 only — never on a repair turn (§16.6 step 5). */
  readonly attachment?: GenAttachment
}

export type ArisAiSend = (request: ArisAiGenerationRequest, signal: AbortSignal) => Promise<string>

export type ArisAiGenerationFailureReason = 'semantic-exhausted' | 'transport' | 'cancelled'

export interface ArisAiGenerationSuccess {
  readonly ok: true
  readonly draft: ArisAiDraftV1
  /** Advisory EPC findings that did not block the draft. */
  readonly warnings: readonly ArisAiValidationFinding[]
  readonly semanticAttemptsUsed: number
  readonly requestsSent: number
}

export interface ArisAiGenerationFailure {
  readonly ok: false
  readonly reason: ArisAiGenerationFailureReason
  readonly findings: readonly ArisAiValidationFinding[]
  readonly semanticAttemptsUsed: number
  readonly requestsSent: number
  /** Set for `'transport'` — the original rejection, unmodified. */
  readonly error?: unknown
}

export type ArisAiGenerationResult = ArisAiGenerationSuccess | ArisAiGenerationFailure

export interface ArisAiGenerationInput {
  readonly system: string
  readonly user: string
  /** Attached PDF/image, already capability- and size-checked. */
  readonly attachment?: GenAttachment
  readonly send: ArisAiSend
  readonly signal: AbortSignal
  /** Progress hook — called before each repair turn is sent. */
  readonly onRepairTurn?: (
    attemptNumber: number,
    findings: readonly ArisAiValidationFinding[]
  ) => void
}

/** True for a failure that belongs to the transport, not to model content. */
export function isArisAiTransportFailure(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const candidate = error as { transport?: unknown; name?: unknown }
  if (candidate.transport === true) return true
  return (
    candidate.name === 'TransportError' ||
    candidate.name === 'ProviderHttpError' ||
    candidate.name === 'ProviderResponseError' ||
    candidate.name === 'ResponseBodyLimitError'
  )
}

/** True for an abort — the user cancelled, which is neither class of failure. */
export function isArisAiCancellation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const candidate = error as { name?: unknown; code?: unknown }
  return candidate.name === 'AbortError' || candidate.code === 'cancelled'
}

/**
 * Parse the first JSON object out of a bounded model response, tolerating a
 * markdown fence. Throws a plain `Error` whose message is safe to quote — the
 * response text itself is never embedded in it.
 */
export function parseArisAiResponseJson(text: string): unknown {
  if (text.length > MAX_ARIS_AI_RESPONSE_CHARS) {
    throw new Error(
      `The response exceeded the ${MAX_ARIS_AI_RESPONSE_CHARS}-character bound for a draft.`
    )
  }
  const trimmed = text.trim()
  const fenced = /```(?:json)?\s*([\s\S]*?)```/u.exec(trimmed)
  const candidate = fenced?.[1]?.trim() ?? trimmed
  return JSON.parse(candidate) as unknown
}

function boundedEcho(text: string): string {
  return text.length <= MAX_ARIS_AI_REPAIR_ECHO_CHARS
    ? text
    : `${text.slice(0, MAX_ARIS_AI_REPAIR_ECHO_CHARS)}…`
}

function cancelled(semanticAttemptsUsed: number, requestsSent: number): ArisAiGenerationFailure {
  return { ok: false, reason: 'cancelled', findings: [], semanticAttemptsUsed, requestsSent }
}

/**
 * Run steps 3–10. Never throws for a provider failure: every outcome comes
 * back as a result object so the caller can decide what the user sees.
 */
export async function runArisAiGeneration(
  input: ArisAiGenerationInput
): Promise<ArisAiGenerationResult> {
  let state = INITIAL_ARIS_AI_REPAIR_STATE
  // Cleared after the first send — the structural half of "attachment only on
  // the first attempt". Nothing below can reintroduce it.
  let attachment: GenAttachment | undefined = input.attachment
  let userTurn = input.user
  let history: ArisAiGenerationMessage[] = [
    { role: 'system', content: input.system },
    { role: 'user', content: input.user }
  ]
  let attemptNumber = 1
  let requestsSent = 0

  for (;;) {
    if (input.signal.aborted) return cancelled(state.semanticAttemptsUsed, requestsSent)

    const request: ArisAiGenerationRequest = {
      attemptNumber,
      system: input.system,
      user: userTurn,
      messages: history,
      ...(attachment === undefined ? {} : { attachment })
    }

    let text: string
    try {
      requestsSent += 1
      text = await input.send(request, input.signal)
    } catch (error) {
      // Whatever happened, the attachment is spent: it is never re-sent.
      attachment = undefined
      if (isArisAiCancellation(error) || input.signal.aborted) {
        return cancelled(state.semanticAttemptsUsed, requestsSent)
      }
      // §4.3: a transport/auth/rate failure must not consume a semantic
      // attempt. Routing it through the state machine proves the counter is
      // left alone. An unclassifiable rejection is treated the same way — it
      // never came back as model output, so it cannot be a semantic failure
      // of one.
      state = advanceArisAiRepairState({ state, failureClass: 'transport' }).state
      return {
        ok: false,
        reason: 'transport',
        findings: [],
        semanticAttemptsUsed: state.semanticAttemptsUsed,
        requestsSent,
        error
      }
    }
    attachment = undefined
    if (input.signal.aborted) return cancelled(state.semanticAttemptsUsed, requestsSent)

    let findings: readonly ArisAiValidationFinding[] = []
    let warnings: readonly ArisAiValidationFinding[] = []
    let draft: ArisAiDraftV1 | null = null

    let raw: unknown
    let jsonError: string | null = null
    try {
      // Step 6: parse a bounded response.
      raw = parseArisAiResponseJson(text)
    } catch (error) {
      jsonError = error instanceof Error ? error.message : String(error)
    }

    if (jsonError !== null) {
      findings = [
        finding('response-not-json', '$', `The response was not strict JSON: ${jsonError}`)
      ]
    } else {
      // Steps 7 + 8 (schema and type vocabulary, plus the §16.4 forbidden
      // content scan that runs first inside validateArisAiDraft).
      const validation = validateArisAiDraft(raw)
      if (!validation.ok) {
        findings = validation.findings
      } else {
        // Step 9: EPC semantics.
        const semantics = validateArisAiDraftEpcSemantics(validation.draft)
        warnings = semantics.warnings
        findings = semantics.errors
        if (semantics.errors.length === 0) draft = validation.draft
      }
    }

    if (draft) {
      return {
        ok: true,
        draft,
        warnings,
        semanticAttemptsUsed: state.semanticAttemptsUsed,
        requestsSent
      }
    }

    // Step 10: one semantic repair turn, if any remain.
    const advanced = advanceArisAiRepairState({ state, failureClass: 'semantic' })
    state = advanced.state
    if (advanced.outcome === 'exhausted') {
      return {
        ok: false,
        reason: 'semantic-exhausted',
        findings,
        semanticAttemptsUsed: state.semanticAttemptsUsed,
        requestsSent
      }
    }

    const echo = boundedEcho(text)
    userTurn = buildArisAiRepairMessage({
      previousResponseText: echo,
      findings,
      attemptNumber: state.semanticAttemptsUsed
    })
    history = [
      { role: 'system', content: input.system },
      { role: 'user', content: input.user },
      { role: 'assistant', content: echo },
      { role: 'user', content: userTurn }
    ]
    attemptNumber += 1
    input.onRepairTurn?.(state.semanticAttemptsUsed, findings)
  }
}

export { MAX_SEMANTIC_REPAIR_ATTEMPTS }
