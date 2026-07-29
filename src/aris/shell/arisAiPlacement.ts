/**
 * Placement and recovery for a generated ARIS model (plan §16.7).
 *
 * Generation is long: a large PDF plus up to three repair turns can run for
 * minutes, and the user is free to switch workspace, close the panel, or
 * cancel while it does. §16.7 states the four rules that follow from that:
 *
 *  - "If workspace changes before placement, do not write into the stale
 *    destination." — {@link resolveArisAiPlacement} compares the workspace the
 *    request was STARTED against with the one live at placement time. Not
 *    equal ⇒ `discarded`. The decision is a pure function so it can be
 *    asserted directly, and it fails closed: an unknown current workspace is
 *    treated as a change.
 *  - "Preserve generated AML as a recoverable download." — a discarded result
 *    is still exact AML. {@link arisAiRecoveryArtifact} names it and hands
 *    back the bytes the ordinary download path takes.
 *  - "Cancel/close must abort requests and placement." — an aborted signal
 *    produces `discarded` with reason `cancelled` regardless of workspace.
 *  - "Never partially create a multi-model AI result." — a draft becomes ONE
 *    AML document (arisAiCreate.ts) placed by ONE call. There is no partial
 *    state to leave behind: either that call happens or the artifact is
 *    offered for download instead.
 */

export type ArisAiPlacementDiscardReason = 'stale-workspace' | 'cancelled'

export type ArisAiPlacementDecision =
  | { readonly status: 'place' }
  | { readonly status: 'discarded'; readonly reason: ArisAiPlacementDiscardReason }

export interface ArisAiPlacementInput {
  /** Workspace identity captured when the request was sent. */
  readonly requestedWorkspaceId: string | null
  /** Workspace identity now, at placement time. */
  readonly currentWorkspaceId: string | null
  /** True when the user cancelled or the surface closed. */
  readonly aborted: boolean
}

/**
 * Decide whether a finished generation may be written into the workspace.
 * Cancellation is checked first: a cancelled request never places, even if the
 * workspace never moved.
 */
export function resolveArisAiPlacement(input: ArisAiPlacementInput): ArisAiPlacementDecision {
  if (input.aborted) return { status: 'discarded', reason: 'cancelled' }
  if (input.requestedWorkspaceId !== input.currentWorkspaceId) {
    return { status: 'discarded', reason: 'stale-workspace' }
  }
  return { status: 'place' }
}

const UNSAFE_FILE_NAME_CHARS = /[^\p{L}\p{N}._-]+/gu

/** Stable, filesystem-safe name for the recoverable download. */
export function arisAiRecoveryFileName(requestedName: string): string {
  // Path separators become '-', then any leading/trailing '-' or '.' run is
  // dropped so a name like "../../etc/passwd" cannot survive as "..-..-etc…".
  const base = requestedName
    .trim()
    .replace(UNSAFE_FILE_NAME_CHARS, '-')
    .replace(/^[-.]+|[-.]+$/gu, '')
  return `${base === '' ? 'aris-model' : base.slice(0, 80)}-recovery.aml`
}

export interface ArisAiRecoveryArtifact {
  readonly fileName: string
  readonly bytes: Uint8Array
  readonly mimeType: 'application/xml'
  readonly reason: ArisAiPlacementDiscardReason
}

/** Package discarded AML for the ordinary download path. Never lossy. */
export function arisAiRecoveryArtifact(
  requestedName: string,
  xml: string,
  reason: ArisAiPlacementDiscardReason
): ArisAiRecoveryArtifact {
  return Object.freeze({
    fileName: arisAiRecoveryFileName(requestedName),
    bytes: new TextEncoder().encode(xml),
    mimeType: 'application/xml' as const,
    reason
  })
}
