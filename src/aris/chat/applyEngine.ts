/**
 * Atomic safe application (plan 18.5) and confirmation-gated application (plan 18.6).
 *
 * ## The seam
 *
 * This engine is generic over `TDocument` and never imports `src/aris/model` or
 * `src/aris/packages` (transaction/revisions/accounting) directly — it is handed an
 * `ArisChatApplyHost<TDocument>` that knows how to read a revision number, apply one command to
 * a document (a pure function: given the immutable-document convention already used by
 * `src/aris/model/commands.ts`, `applyCommand` returns a *new* document and never mutates its
 * input), run the three post-application validation passes, and persist a draft revision. A
 * real integration wires a host backed by `src/aris/model` + `src/aris/packages`; the test
 * suite here wires a small in-memory host so every rule in 18.5/18.6 is verified without a
 * document, network, or provider.
 *
 * ## Why rollback is trivial and provably total
 *
 * Because every step operates on a local `current` variable and the function only ever returns
 * `current` after every command has applied AND every validation pass has come back clean, a
 * failure at any point simply returns the untouched `document` parameter — the exact same
 * object reference the caller passed in. There is no in-place mutation anywhere in this file,
 * so "rollback" is not a separate code path that could itself have a bug: it is the absence of
 * ever committing to the caller. `applyEngine.test.ts` proves this for injected failures at
 * every command index 1..N, and separately for each of the three post-apply validation passes.
 */

import { classifyCommandKind } from './classification'
import type { ArisChatCommand, ArisChatCommandKind } from './patchSchema'

export interface ArisChatValidationIssue {
  readonly code: string
  readonly message: string
}

/**
 * Host operations this engine needs from the real document/command layer. `applyCommand` is
 * expected to throw (any error) on a precondition failure — the engine treats any thrown error
 * as "this command could not be applied" and aborts the whole batch.
 */
export interface ArisChatApplyHost<TDocument> {
  readonly getRevision: (document: TDocument) => number
  readonly applyCommand: (document: TDocument, command: ArisChatCommand) => TDocument
  readonly validateSemantic?: (document: TDocument) => readonly ArisChatValidationIssue[]
  readonly validateReference?: (document: TDocument) => readonly ArisChatValidationIssue[]
  readonly validateAccounting?: (document: TDocument) => readonly ArisChatValidationIssue[]
  /** Persists a draft revision (plan 18.5 step 5) and returns its id. Never called on failure. */
  readonly saveDraftRevision?: (document: TDocument, receipt: ArisChatApplyReceipt) => string
}

export interface ArisChatReceiptEntry {
  readonly commandId: string
  readonly kind: ArisChatCommandKind
  readonly targetIds: readonly string[]
  readonly origin: 'ai-auto' | 'ai-confirmed'
}

export interface ArisChatApplyReceipt {
  readonly revisionBefore: number
  readonly revisionAfter: number
  readonly entries: readonly ArisChatReceiptEntry[]
  /** Draft revision id from `host.saveDraftRevision`, or `null` when the host does not persist. */
  readonly draftRevisionId: string | null
}

export type ArisChatApplyFailureReason =
  | 'stale-revision'
  | 'non-automatic-command'
  | 'no-commands-selected'
  | 'command-application-failed'
  | 'semantic-validation-failed'
  | 'reference-validation-failed'
  | 'accounting-validation-failed'

export type ArisChatApplyOutcome<TDocument> =
  | { readonly ok: true; readonly document: TDocument; readonly receipt: ArisChatApplyReceipt }
  | { readonly ok: false; readonly document: TDocument; readonly reason: ArisChatApplyFailureReason; readonly detail?: string }

/** One-click undo descriptor (plan 18.5 step 7) — restoring is the revision store's job. */
export interface ArisChatUndoDescriptor {
  readonly targetRevision: number
  readonly commandIds: readonly string[]
}

export function buildUndoDescriptor(receipt: ArisChatApplyReceipt): ArisChatUndoDescriptor {
  return Object.freeze({
    targetRevision: receipt.revisionBefore,
    commandIds: Object.freeze(receipt.entries.map((entry) => entry.commandId))
  })
}

function applySequentially<TDocument>(
  document: TDocument,
  commands: readonly ArisChatCommand[],
  host: ArisChatApplyHost<TDocument>
): { readonly ok: true; readonly document: TDocument } | { readonly ok: false; readonly detail: string } {
  let current = document
  try {
    for (const command of commands) {
      current = host.applyCommand(current, command)
    }
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) }
  }
  return { ok: true, document: current }
}

function runPostApplyValidations<TDocument>(
  document: TDocument,
  host: ArisChatApplyHost<TDocument>
):
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: Extract<ArisChatApplyFailureReason, `${string}-validation-failed`>; readonly detail: string } {
  const semantic = host.validateSemantic?.(document) ?? []
  if (semantic.length > 0) {
    return { ok: false, reason: 'semantic-validation-failed', detail: semantic.map((issue) => issue.code).join(', ') }
  }
  const reference = host.validateReference?.(document) ?? []
  if (reference.length > 0) {
    return { ok: false, reason: 'reference-validation-failed', detail: reference.map((issue) => issue.code).join(', ') }
  }
  const accounting = host.validateAccounting?.(document) ?? []
  if (accounting.length > 0) {
    return { ok: false, reason: 'accounting-validation-failed', detail: accounting.map((issue) => issue.code).join(', ') }
  }
  return { ok: true }
}

function buildReceipt<TDocument>(
  revisionBefore: number,
  document: TDocument,
  commands: readonly ArisChatCommand[],
  origin: 'ai-auto' | 'ai-confirmed',
  host: ArisChatApplyHost<TDocument>
): ArisChatApplyReceipt {
  const entries = commands.map((command) =>
    Object.freeze({ commandId: command.commandId, kind: command.kind, targetIds: command.targetIds, origin })
  )
  const draft: ArisChatApplyReceipt = {
    revisionBefore,
    revisionAfter: host.getRevision(document),
    entries: Object.freeze(entries),
    draftRevisionId: null
  }
  const draftRevisionId = host.saveDraftRevision ? host.saveDraftRevision(document, draft) : null
  return Object.freeze({ ...draft, draftRevisionId })
}

/**
 * Plan 18.5 — atomic safe application. `commands` MUST already be the automatic-classified
 * subset (see `classification.ts`); this function re-checks that as a defense-in-depth
 * invariant and aborts (no changes) if any command in the batch is not automatic. Does not
 * export AML (step 9) — this function never touches any export path.
 */
export function applySafeCommandsAtomically<TDocument>(
  document: TDocument,
  proposalBaseRevision: number,
  commands: readonly ArisChatCommand[],
  host: ArisChatApplyHost<TDocument>
): ArisChatApplyOutcome<TDocument> {
  const revisionBefore = host.getRevision(document)
  if (proposalBaseRevision !== revisionBefore) {
    return {
      ok: false,
      document,
      reason: 'stale-revision',
      detail: `Proposal targets revision ${proposalBaseRevision} but the document is at ${revisionBefore}.`
    }
  }

  for (const command of commands) {
    if (classifyCommandKind(command.kind) !== 'automatic') {
      return {
        ok: false,
        document,
        reason: 'non-automatic-command',
        detail: `Command ${command.commandId} (${command.kind}) is not classified automatic.`
      }
    }
  }

  if (commands.length === 0) {
    return buildEmptySuccess(document, revisionBefore, host)
  }

  const applied = applySequentially(document, commands, host)
  if (!applied.ok) {
    return { ok: false, document, reason: 'command-application-failed', detail: applied.detail }
  }

  const validated = runPostApplyValidations(applied.document, host)
  if (!validated.ok) {
    return { ok: false, document, reason: validated.reason, detail: validated.detail }
  }

  const receipt = buildReceipt(revisionBefore, applied.document, commands, 'ai-auto', host)
  return { ok: true, document: applied.document, receipt }
}

function buildEmptySuccess<TDocument>(document: TDocument, revisionBefore: number, host: ArisChatApplyHost<TDocument>): ArisChatApplyOutcome<TDocument> {
  return {
    ok: true,
    document,
    receipt: { revisionBefore, revisionAfter: host.getRevision(document), entries: [], draftRevisionId: null }
  }
}

// --- 18.6 confirmation-gated application ----------------------------------------------------

export interface ArisChatConfirmationPreview<TDocument> {
  readonly affectedIds: readonly string[]
  /** Caller-supplied snapshot of the affected ids before/after; `null` when not provided. */
  readonly before: unknown
  readonly after: unknown
  /** The dry-run result. Never persisted — for preview rendering only. */
  readonly simulatedDocument: TDocument
}

export type ArisChatPreviewOutcome<TDocument> =
  | { readonly ok: true; readonly preview: ArisChatConfirmationPreview<TDocument> }
  | { readonly ok: false; readonly reason: 'command-application-failed'; readonly detail: string }

/** Plan 18.6 steps 1-2: affected objects/relations plus a before/after graph preview as data. */
export function buildConfirmationPreview<TDocument>(
  document: TDocument,
  commands: readonly ArisChatCommand[],
  host: ArisChatApplyHost<TDocument>,
  describeTargets?: (document: TDocument, targetIds: readonly string[]) => unknown
): ArisChatPreviewOutcome<TDocument> {
  const affectedIds = Object.freeze([...new Set(commands.flatMap((command) => command.targetIds))].sort())
  const applied = applySequentially(document, commands, host)
  if (!applied.ok) {
    return { ok: false, reason: 'command-application-failed', detail: applied.detail }
  }
  return {
    ok: true,
    preview: {
      affectedIds,
      before: describeTargets ? describeTargets(document, affectedIds) : null,
      after: describeTargets ? describeTargets(applied.document, affectedIds) : null,
      simulatedDocument: applied.document
    }
  }
}

export interface ArisChatSelectiveApplyResult<TDocument> {
  readonly outcome: ArisChatApplyOutcome<TDocument>
  /**
   * Commands from `allProposedCommands` that were not selected (or that were selected but the
   * batch failed) — plan 18.6 step 5: "keep rejected commands in chat as suggestions rather
   * than discarding them". Always a subset of `allProposedCommands`; never mutated.
   */
  readonly remainingSuggestions: readonly ArisChatCommand[]
}

/**
 * Plan 18.6 steps 3-4: apply only the individually selected commands, atomically. Commands the
 * caller did not select — and, on any failure, every proposed command — come back in
 * `remainingSuggestions` rather than being discarded.
 */
export function applySelectedConfirmedCommands<TDocument>(
  document: TDocument,
  proposalBaseRevision: number,
  allProposedCommands: readonly ArisChatCommand[],
  selectedCommandIds: ReadonlySet<string>,
  host: ArisChatApplyHost<TDocument>
): ArisChatSelectiveApplyResult<TDocument> {
  const selected = allProposedCommands.filter((command) => selectedCommandIds.has(command.commandId))
  const unselected = allProposedCommands.filter((command) => !selectedCommandIds.has(command.commandId))

  if (selected.length === 0) {
    return {
      outcome: { ok: false, document, reason: 'no-commands-selected', detail: 'No commands were selected.' },
      remainingSuggestions: allProposedCommands
    }
  }

  const revisionBefore = host.getRevision(document)
  if (proposalBaseRevision !== revisionBefore) {
    return {
      outcome: {
        ok: false,
        document,
        reason: 'stale-revision',
        detail: `Proposal targets revision ${proposalBaseRevision} but the document is at ${revisionBefore}.`
      },
      remainingSuggestions: allProposedCommands
    }
  }

  const applied = applySequentially(document, selected, host)
  if (!applied.ok) {
    return {
      outcome: { ok: false, document, reason: 'command-application-failed', detail: applied.detail },
      remainingSuggestions: allProposedCommands
    }
  }

  const validated = runPostApplyValidations(applied.document, host)
  if (!validated.ok) {
    return {
      outcome: { ok: false, document, reason: validated.reason, detail: validated.detail },
      remainingSuggestions: allProposedCommands
    }
  }

  const receipt = buildReceipt(revisionBefore, applied.document, selected, 'ai-confirmed', host)
  return { outcome: { ok: true, document: applied.document, receipt }, remainingSuggestions: unselected }
}
