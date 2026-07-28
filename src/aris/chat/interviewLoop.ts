/**
 * The interview loop — plan section 18.2 — modeled as a pure reducer/state machine so it is
 * fully testable without a provider: every transition is a deterministic function of
 * `(state, event, host)`, and `host` (an `ArisChatInterviewHost`) is itself pure/synchronous —
 * no AI request is ever made from inside this module. A real caller drives the reducer from
 * outside: it fetches an AI-produced patch proposal (subject to plan 4.3's AI request rules —
 * consent, cancelability, etc., all out of this lane's scope) and feeds the raw JSON in as a
 * `proposalReceived` event; every other input (`answersSubmitted`, `confirmationDecision`,
 * `finish`, `cancel`) is plain data the UI already has.
 *
 * ## Flow (plan 18.2 steps 1-13)
 *
 * `startArisChatInterview` reads the document (step 1), scans gaps (step 2, via
 * `host.scanGaps`), and — if there are any — asks up to three questions (step 3). Answers are
 * accumulated in `state.answers` and never cleared (step 5: preserved for the session).
 * `proposalReceived` validates the raw value against `ArisPatchProposalV1` (step 7), checks the
 * base revision and every target id via `host.verifyProposalTargets` (step 8), classifies each
 * command (step 9, via `classification.ts`), applies the automatic ones immediately through
 * `applySafeCommandsAtomically` (step 10), and — if anything needs confirmation — moves to
 * `awaitingConfirmation` (step 11) rather than applying it. Every successful step ends by
 * rescanning gaps (step 12) and either stopping (`clean`), starting the next round, or stopping
 * at the round limit (step 13, `roundLimitReached`, capped at `MAX_ROUNDS_PER_INTERVIEW = 5`).
 *
 * ## Invalid proposals apply nothing
 *
 * A structurally invalid proposal, a stale base revision, or an unapplicable command payload
 * all return to `awaitingProposal` with `lastError` set and the document byte-for-byte
 * unchanged (`applySafeCommandsAtomically`'s rollback guarantee, or — for schema/verify
 * failures — because the document is never touched at all). This is exit-gate item 4.
 */

import { applySafeCommandsAtomically, applySelectedConfirmedCommands, type ArisChatApplyHost, type ArisChatApplyReceipt } from './applyEngine'
import type { ArisChatClassificationContext } from './classification'
import { partitionCommandsByClassification } from './classification'
import type { ArisChatGap } from './gapScanner'
import { ArisPatchSchemaError, parseArisPatchProposal, type ArisChatCommand, type ArisPatchProposalV1 } from './patchSchema'

export const MAX_ROUNDS_PER_INTERVIEW = 5
export const MAX_QUESTIONS_PER_ROUND = 3

export interface ArisChatQuestion {
  readonly id: string
  readonly messageKey: string
  readonly messageParams?: Readonly<Record<string, string>>
  readonly gapKind: ArisChatGap['kind']
  readonly targetIds: readonly string[]
}

export type ArisChatProposalTargetVerification = 'ok' | 'stale-revision' | 'target-removed'

export interface ArisChatInterviewHost<TDocument> extends ArisChatApplyHost<TDocument> {
  readonly scanGaps: (document: TDocument) => readonly ArisChatGap[]
  /**
   * Confirms the proposal's `baseRevision` matches the live document and every command's
   * target ids still resolve. `'target-removed'` means an entity the interview was about was
   * deleted out from under the session (plan 18.2 step 13's "target removed" exit).
   */
  readonly verifyProposalTargets: (document: TDocument, proposal: ArisPatchProposalV1) => ArisChatProposalTargetVerification
  /** Optional per-command classification context (ambiguous target / id change overrides). */
  readonly classifyCommand?: (command: ArisChatCommand, document: TDocument) => ArisChatClassificationContext
}

export class ArisChatInterviewError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ArisChatInterviewError'
  }
}

interface ArisChatInterviewStateBase<TDocument> {
  readonly document: TDocument
  readonly round: number
  readonly answers: Readonly<Record<string, string>>
  /** Confirm-classified commands never applied (rejected, unselected, or superseded). */
  readonly suggestions: readonly ArisChatCommand[]
  readonly receipts: readonly ArisChatApplyReceipt[]
  readonly gaps: readonly ArisChatGap[]
}

export type ArisChatInterviewState<TDocument> =
  | (ArisChatInterviewStateBase<TDocument> & { readonly status: 'awaitingAnswers'; readonly questions: readonly ArisChatQuestion[] })
  | (ArisChatInterviewStateBase<TDocument> & {
      readonly status: 'awaitingProposal'
      readonly questions: readonly ArisChatQuestion[]
      readonly lastError?: string
    })
  | (ArisChatInterviewStateBase<TDocument> & {
      readonly status: 'awaitingConfirmation'
      readonly pendingConfirmCommands: readonly ArisChatCommand[]
      readonly confirmBaseRevision: number
      readonly lastError?: string
    })
  | (ArisChatInterviewStateBase<TDocument> & { readonly status: 'clean' })
  | (ArisChatInterviewStateBase<TDocument> & { readonly status: 'finished' })
  | (ArisChatInterviewStateBase<TDocument> & { readonly status: 'canceled' })
  | (ArisChatInterviewStateBase<TDocument> & { readonly status: 'aborted'; readonly reason: 'targetRemoved' })
  | (ArisChatInterviewStateBase<TDocument> & { readonly status: 'roundLimitReached' })

export type ArisChatInterviewTerminalStatus = 'clean' | 'finished' | 'canceled' | 'aborted' | 'roundLimitReached'

export const TERMINAL_INTERVIEW_STATUSES: ReadonlySet<string> = Object.freeze(
  new Set<ArisChatInterviewTerminalStatus>(['clean', 'finished', 'canceled', 'aborted', 'roundLimitReached'])
)

export type ArisChatInterviewEvent =
  | { readonly type: 'answersSubmitted'; readonly answers: Readonly<Record<string, string>> }
  | { readonly type: 'proposalReceived'; readonly raw: unknown }
  | { readonly type: 'confirmationDecision'; readonly selectedCommandIds: ReadonlySet<string> }
  | { readonly type: 'finish' }
  | { readonly type: 'cancel' }

function deriveQuestions(gaps: readonly ArisChatGap[]): readonly ArisChatQuestion[] {
  return Object.freeze(
    gaps.slice(0, MAX_QUESTIONS_PER_ROUND).map((gap) =>
      Object.freeze({
        id: `${gap.kind}:${gap.targetIds.join(',')}`,
        messageKey: gap.messageKey,
        messageParams: gap.messageParams,
        gapKind: gap.kind,
        targetIds: gap.targetIds
      })
    )
  )
}

function beginRound<TDocument>(
  document: TDocument,
  round: number,
  answers: Readonly<Record<string, string>>,
  suggestions: readonly ArisChatCommand[],
  receipts: readonly ArisChatApplyReceipt[],
  gaps: readonly ArisChatGap[]
): ArisChatInterviewState<TDocument> {
  return {
    status: 'awaitingAnswers',
    document,
    round,
    answers,
    suggestions,
    receipts,
    gaps,
    questions: deriveQuestions(gaps)
  }
}

/** Plan 18.2 steps 1-3: read the document, scan gaps, ask the first round's questions. */
export function startArisChatInterview<TDocument>(
  document: TDocument,
  host: ArisChatInterviewHost<TDocument>
): ArisChatInterviewState<TDocument> {
  const gaps = host.scanGaps(document)
  if (gaps.length === 0) {
    return { status: 'clean', document, round: 0, answers: {}, suggestions: [], receipts: [], gaps: [] }
  }
  return beginRound(document, 1, {}, [], [], gaps)
}

function completeRound<TDocument>(
  document: TDocument,
  round: number,
  answers: Readonly<Record<string, string>>,
  suggestions: readonly ArisChatCommand[],
  receipts: readonly ArisChatApplyReceipt[],
  host: ArisChatInterviewHost<TDocument>
): ArisChatInterviewState<TDocument> {
  const gaps = host.scanGaps(document)
  if (gaps.length === 0) {
    return { status: 'clean', document, round, answers, suggestions, receipts, gaps: [] }
  }
  if (round >= MAX_ROUNDS_PER_INTERVIEW) {
    return { status: 'roundLimitReached', document, round, answers, suggestions, receipts, gaps }
  }
  return beginRound(document, round + 1, answers, suggestions, receipts, gaps)
}

function handleProposalReceived<TDocument>(
  state: Extract<ArisChatInterviewState<TDocument>, { status: 'awaitingProposal' }>,
  raw: unknown,
  host: ArisChatInterviewHost<TDocument>
): ArisChatInterviewState<TDocument> {
  let proposal: ArisPatchProposalV1
  try {
    proposal = parseArisPatchProposal(raw)
  } catch (error) {
    const message = error instanceof ArisPatchSchemaError ? error.message : String(error)
    return { ...state, lastError: message }
  }

  const verification = host.verifyProposalTargets(state.document, proposal)
  if (verification === 'target-removed') {
    return {
      status: 'aborted',
      reason: 'targetRemoved',
      document: state.document,
      round: state.round,
      answers: state.answers,
      suggestions: state.suggestions,
      receipts: state.receipts,
      gaps: state.gaps
    }
  }
  if (verification === 'stale-revision') {
    return { ...state, lastError: 'stale-revision' }
  }

  const { automatic, confirm } = partitionCommandsByClassification(proposal.commands, (command) =>
    host.classifyCommand ? host.classifyCommand(command, state.document) : {}
  )

  const applied = applySafeCommandsAtomically(state.document, proposal.baseRevision, automatic, host)
  if (!applied.ok) {
    return { ...state, lastError: `${applied.reason}${applied.detail ? `: ${applied.detail}` : ''}` }
  }

  const receipts = applied.receipt.entries.length > 0 ? [...state.receipts, applied.receipt] : state.receipts

  if (confirm.length > 0) {
    return {
      status: 'awaitingConfirmation',
      document: applied.document,
      round: state.round,
      answers: state.answers,
      suggestions: state.suggestions,
      receipts,
      gaps: host.scanGaps(applied.document),
      pendingConfirmCommands: confirm,
      confirmBaseRevision: host.getRevision(applied.document)
    }
  }

  return completeRound(applied.document, state.round, state.answers, state.suggestions, receipts, host)
}

function handleConfirmationDecision<TDocument>(
  state: Extract<ArisChatInterviewState<TDocument>, { status: 'awaitingConfirmation' }>,
  selectedCommandIds: ReadonlySet<string>,
  host: ArisChatInterviewHost<TDocument>
): ArisChatInterviewState<TDocument> {
  const result = applySelectedConfirmedCommands(
    state.document,
    state.confirmBaseRevision,
    state.pendingConfirmCommands,
    selectedCommandIds,
    host
  )

  if (!result.outcome.ok) {
    return { ...state, lastError: `${result.outcome.reason}${result.outcome.detail ? `: ${result.outcome.detail}` : ''}` }
  }

  const suggestions = [...state.suggestions, ...result.remainingSuggestions]
  const receipts = [...state.receipts, result.outcome.receipt]
  return completeRound(result.outcome.document, state.round, state.answers, suggestions, receipts, host)
}

/** Advances the interview by exactly one event. Pure — no I/O, no AI request. */
export function advanceArisChatInterview<TDocument>(
  state: ArisChatInterviewState<TDocument>,
  event: ArisChatInterviewEvent,
  host: ArisChatInterviewHost<TDocument>
): ArisChatInterviewState<TDocument> {
  if (TERMINAL_INTERVIEW_STATUSES.has(state.status)) {
    throw new ArisChatInterviewError(`Cannot advance a terminal interview state (${state.status}).`)
  }

  if (event.type === 'cancel') {
    return { status: 'canceled', document: state.document, round: state.round, answers: state.answers, suggestions: state.suggestions, receipts: state.receipts, gaps: state.gaps }
  }
  if (event.type === 'finish') {
    return { status: 'finished', document: state.document, round: state.round, answers: state.answers, suggestions: state.suggestions, receipts: state.receipts, gaps: state.gaps }
  }

  if (state.status === 'awaitingAnswers' && event.type === 'answersSubmitted') {
    return {
      status: 'awaitingProposal',
      document: state.document,
      round: state.round,
      answers: { ...state.answers, ...event.answers },
      suggestions: state.suggestions,
      receipts: state.receipts,
      gaps: state.gaps,
      questions: state.questions
    }
  }

  if (state.status === 'awaitingProposal' && event.type === 'proposalReceived') {
    return handleProposalReceived(state, event.raw, host)
  }

  if (state.status === 'awaitingConfirmation' && event.type === 'confirmationDecision') {
    return handleConfirmationDecision(state, event.selectedCommandIds, host)
  }

  throw new ArisChatInterviewError(`Event "${event.type}" is not valid in state "${state.status}".`)
}
