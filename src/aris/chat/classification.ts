/**
 * Automatic/confirmation classification policy — plan section 18.4. This is the
 * security-critical part of Phase 15: it decides which AI-proposed commands are safe enough to
 * apply without a human looking at them first.
 *
 * ## Policy
 *
 * Automatic (applied after schema/precondition validation, no human step): `setLocalizedName`,
 * `setAttribute`, `addAttributeValue`, `addMetadataDefinition`, `addMetadataOccurrence`,
 * `addMetadataConnection` — this maps exactly onto plan 18.4's automatic bullet list (English/
 * Arabic names + translations -> `setLocalizedName`; owners/inputs/outputs/systems/process
 * codes/decision basis/notes -> `setAttribute`; additive metadata attributes ->
 * `addAttributeValue`; additive metadata satellite definitions/occurrences/relations ->
 * `addMetadataDefinition`/`addMetadataOccurrence`/`addMetadataConnection`).
 *
 * Requires explicit confirmation (everything else): `addCoreObject` (new core control-flow
 * object), `addCoreConnection` (new core control-flow connection / return back-edge — both are
 * "new core control-flow connection" per 18.4, distinguished only by the `isReturnBackEdge`
 * flag, which does not change the classification), `setAssignment` (model assignment),
 * `reconnect` (reconnection/retargeting), `deleteConnection`/`deleteOccurrence`/
 * `deleteDefinition` (deletion), `removeAttachment` (attachment removal).
 *
 * `setRoute` is deliberately classified `confirm` even though moving a connection's bend points
 * changes no semantic content and is not destructive: plan 18.4 enumerates the automatic set
 * exhaustively and does not mention routing, so this module treats "not explicitly listed as
 * automatic" as "requires confirmation" rather than inferring safety. This is a conservative
 * design choice — it can only ever move a command *out* of the automatic set, which the
 * invariant test below confirms can never break the safety guarantee.
 *
 * ## The one invariant that must never break
 *
 * No destructive command (`deleteConnection`, `deleteOccurrence`, `deleteDefinition`,
 * `removeAttachment`) and no topology-changing command (`addCoreObject`, `addCoreConnection`,
 * `reconnect`, `setAssignment`) may ever be classified `automatic`. `classification.test.ts`
 * enumerates the full command-kind space and asserts this for every one of them, so a future
 * edit that moves one of these kinds into `AUTOMATIC_COMMAND_KINDS` fails loudly.
 *
 * ## Overrides
 *
 * Two override conditions from plan 18.4 — "ID change" and "ambiguous target" — do not
 * correspond to any field on the fifteen commands today (none of them renames an id), so they
 * are modeled as caller-supplied flags on `ArisChatClassificationContext` rather than baked
 * into any one command's schema. A caller that resolves a command's targets against the live
 * document and finds more than one candidate, or that detects the command would change an
 * entity's id, sets the corresponding flag; `classifyPatchCommand` then forces `confirm`
 * regardless of the command's kind.
 */

import type { ArisChatCommand, ArisChatCommandKind } from './patchSchema'

export type ArisChatClassification = 'automatic' | 'confirm'

/** Exactly the commands plan 18.4 lists as automatic. */
export const AUTOMATIC_COMMAND_KINDS: ReadonlySet<ArisChatCommandKind> = Object.freeze(
  new Set<ArisChatCommandKind>([
    'setLocalizedName',
    'setAttribute',
    'addAttributeValue',
    'addMetadataDefinition',
    'addMetadataOccurrence',
    'addMetadataConnection'
  ])
)

/** Commands that remove something. Never automatic — see the module-level invariant. */
export const DESTRUCTIVE_COMMAND_KINDS: ReadonlySet<ArisChatCommandKind> = Object.freeze(
  new Set<ArisChatCommandKind>([
    'deleteConnection',
    'deleteOccurrence',
    'deleteDefinition',
    'removeAttachment'
  ])
)

/** Commands that change control-flow topology or model assignment. Never automatic. */
export const TOPOLOGY_COMMAND_KINDS: ReadonlySet<ArisChatCommandKind> = Object.freeze(
  new Set<ArisChatCommandKind>(['addCoreObject', 'addCoreConnection', 'reconnect', 'setAssignment'])
)

export interface ArisChatClassificationContext {
  /** True when resolving this command's targets against the live document is ambiguous. */
  readonly ambiguousTarget?: boolean
  /** True when applying this command would change an entity's stable id. */
  readonly impliesIdChange?: boolean
}

/** Classifies a bare command kind, ignoring any context override. */
export function classifyCommandKind(kind: ArisChatCommandKind): ArisChatClassification {
  return AUTOMATIC_COMMAND_KINDS.has(kind) ? 'automatic' : 'confirm'
}

/**
 * Classifies a full command, honoring the "ID change" / "ambiguous target" overrides from plan
 * 18.4. Either override forces `confirm` even for a kind that is normally automatic.
 */
export function classifyPatchCommand(
  command: ArisChatCommand,
  context: ArisChatClassificationContext = {}
): ArisChatClassification {
  if (context.ambiguousTarget || context.impliesIdChange) return 'confirm'
  return classifyCommandKind(command.kind)
}

export function isDestructiveCommandKind(kind: ArisChatCommandKind): boolean {
  return DESTRUCTIVE_COMMAND_KINDS.has(kind)
}

export function isTopologyCommandKind(kind: ArisChatCommandKind): boolean {
  return TOPOLOGY_COMMAND_KINDS.has(kind)
}

/** Partitions commands into automatic vs. confirm-required, preserving relative order. */
export function partitionCommandsByClassification(
  commands: readonly ArisChatCommand[],
  contextFor: (command: ArisChatCommand) => ArisChatClassificationContext = () => ({})
): {
  readonly automatic: readonly ArisChatCommand[]
  readonly confirm: readonly ArisChatCommand[]
} {
  const automatic: ArisChatCommand[] = []
  const confirm: ArisChatCommand[] = []
  for (const command of commands) {
    if (classifyPatchCommand(command, contextFor(command)) === 'automatic') automatic.push(command)
    else confirm.push(command)
  }
  return { automatic: Object.freeze(automatic), confirm: Object.freeze(confirm) }
}
