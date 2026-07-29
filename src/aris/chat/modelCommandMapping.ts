/**
 * Documents how each of the fifteen `ArisChatCommandKind`s (plan 18.3) ultimately becomes one
 * or more real `ArisEditCommand`s from `src/aris/model/commands.ts` (24 `ArisCommandKind`
 * values, read read-only while authoring this module — see `src/aris/model/commands.ts`).
 *
 * This module intentionally does NOT import `src/aris/model`: per this lane's brief, patch
 * commands are translated into real `ArisEditCommand`s at the integration seam that wires this
 * chat module to the live document (outside this lane's scope), not here. What follows is the
 * documented mapping that translation must implement, expressed as plain data so it can be
 * unit-tested for completeness (every chat command kind has an entry) without depending on
 * `src/aris/model` at all.
 *
 * Two mappings need more than a 1:1 rename:
 *   - `addMetadataConnection`, `addCoreObject` and `addCoreConnection` each produce TWO model
 *     commands (a `create*Definition` + a `create*Occurrence`). Only `addCoreObject` actually
 *     gets wrapped in one `transaction` command (see `applyTransaction` /
 *     `ArisCommandKind.transaction` in `src/aris/model/commands.ts`) — that works because
 *     `createOccurrence`'s precondition only checks that `modelId` resolves, not `definitionId`,
 *     so it does not matter that the definition is only folded into the document by the first
 *     subcommand inside the same transaction.
 *     `addMetadataConnection`/`addCoreConnection` do NOT get the same treatment:
 *     `createConnectionOccurrence`'s precondition also demands `definitionId` resolve, and
 *     `transaction`'s precondition check (`validatePreconditions`'s `case 'transaction'` in
 *     `src/aris/model/commands.ts`) validates every subcommand against the document as it stood
 *     BEFORE the transaction, never one folded forward by an earlier subcommand in the same
 *     transaction — so wrapping `createConnectionDefinition` + `createConnectionOccurrence` in
 *     one `transaction` always fails. Both `src/aris/shell/arisChatHost.ts` and
 *     `src/aris/canvas/commandBridge.ts` independently hit this wall and both apply the pair as
 *     an ORDERED PAIR of top-level commands instead (see those files' module docs). Below,
 *     `requiresTransactionWrapper` is `true` for all three because all three pairs must be
 *     applied together as one coupled unit — it does not mean the integration seam necessarily
 *     uses a literal `transaction` command to do it; for the two connection kinds it cannot.
 *   - `removeAttachment` DOES map to a real `ArisCommandKind`: attachments are stored as one
 *     value of the `AT_ORBITPM_ATTACHMENT` object-definition attribute
 *     (`src/aris/canvas/attachments.ts`), not as a dedicated model record, so removing one is a
 *     plain `setAttribute` command built by that module's own `removeAttachmentCommand`. This
 *     lane still only classifies and schema-validates the chat command; the integration seam
 *     (`src/aris/shell/arisChatHost.ts`) performs the actual translation.
 */

import type { ArisChatCommandKind } from './patchSchema'

/** One real `src/aris/model/commands.ts` `ArisCommandKind` value, by name (not imported). */
export type ModelCommandKindName =
  | 'setLocalizedName'
  | 'setAttribute'
  | 'addAttributeValue'
  | 'removeAttributeValue'
  | 'moveOccurrence'
  | 'resizeOccurrence'
  | 'restyleOccurrence'
  | 'setOccurrenceSymbol'
  | 'setAttributeOccurrencePlacement'
  | 'createDefinition'
  | 'createOccurrence'
  | 'createConnectionDefinition'
  | 'createConnectionOccurrence'
  | 'setConnectionRoute'
  | 'reconnectConnection'
  | 'deleteOccurrence'
  | 'deleteDefinition'
  | 'deleteConnection'
  | 'deleteConnectionDefinition'
  | 'addLane'
  | 'editLane'
  | 'deleteLane'
  | 'addFreeText'
  | 'editFreeText'
  | 'deleteFreeText'
  | 'setModelAssignment'
  | 'transaction'

export interface ModelCommandMappingEntry {
  readonly chatCommandKind: ArisChatCommandKind
  /** The real model command kind(s) this patch command becomes. Empty means "no equivalent". */
  readonly modelCommandKinds: readonly ModelCommandKindName[]
  /**
   * True when the model commands above must be applied together as one coupled unit. For
   * `addCoreObject` that unit is literally one `transaction` `ArisEditCommand`. For
   * `addMetadataConnection`/`addCoreConnection` a literal `transaction` cannot express the pair
   * — `createConnectionOccurrence`'s precondition can never see a `createConnectionDefinition`
   * from earlier in the same transaction (see the module doc above) — so the integration seam
   * applies them as an ordered pair of top-level commands instead. This field is still `true`
   * for both because the two commands remain coupled; it does not promise a literal
   * `transaction` wrapper.
   */
  readonly requiresTransactionWrapper: boolean
  readonly note?: string
}

export const PATCH_TO_MODEL_COMMAND_MAPPING: readonly ModelCommandMappingEntry[] = Object.freeze([
  {
    chatCommandKind: 'setLocalizedName',
    modelCommandKinds: ['setLocalizedName'],
    requiresTransactionWrapper: false
  },
  {
    chatCommandKind: 'setAttribute',
    modelCommandKinds: ['setAttribute'],
    requiresTransactionWrapper: false
  },
  {
    chatCommandKind: 'addAttributeValue',
    modelCommandKinds: ['addAttributeValue'],
    requiresTransactionWrapper: false
  },
  {
    chatCommandKind: 'addMetadataDefinition',
    modelCommandKinds: ['createDefinition'],
    requiresTransactionWrapper: false,
    note: 'Object-definition satellite (non-core-control-flow type, enforced by the schema refine).'
  },
  {
    chatCommandKind: 'addMetadataOccurrence',
    modelCommandKinds: ['createOccurrence'],
    requiresTransactionWrapper: false
  },
  {
    chatCommandKind: 'addMetadataConnection',
    modelCommandKinds: ['createConnectionDefinition', 'createConnectionOccurrence'],
    requiresTransactionWrapper: true,
    note:
      'Applied as an ordered pair of top-level commands, not a literal `transaction` — ' +
      "createConnectionOccurrence's precondition needs definitionId to resolve, which a " +
      'transaction cannot guarantee for a subcommand created earlier in the same transaction ' +
      '(see module doc).'
  },
  {
    chatCommandKind: 'addCoreObject',
    modelCommandKinds: ['createDefinition', 'createOccurrence'],
    requiresTransactionWrapper: true,
    note: 'objectType restricted to OT_FUNC/OT_EVT/OT_RULE by the schema enum.'
  },
  {
    chatCommandKind: 'addCoreConnection',
    modelCommandKinds: ['createConnectionDefinition', 'createConnectionOccurrence'],
    requiresTransactionWrapper: true,
    note:
      'Also covers the "return back-edge" case (payload.isReturnBackEdge); same model commands, ' +
      'same classification. Applied as an ordered pair of top-level commands, not a literal ' +
      '`transaction` — same precondition constraint as addMetadataConnection (see module doc).'
  },
  {
    chatCommandKind: 'setAssignment',
    modelCommandKinds: ['setModelAssignment'],
    requiresTransactionWrapper: false
  },
  {
    chatCommandKind: 'setRoute',
    modelCommandKinds: ['setConnectionRoute'],
    requiresTransactionWrapper: false
  },
  {
    chatCommandKind: 'reconnect',
    modelCommandKinds: ['reconnectConnection'],
    requiresTransactionWrapper: false
  },
  {
    chatCommandKind: 'deleteConnection',
    modelCommandKinds: ['deleteConnection'],
    requiresTransactionWrapper: false
  },
  {
    chatCommandKind: 'deleteOccurrence',
    modelCommandKinds: ['deleteOccurrence'],
    requiresTransactionWrapper: false
  },
  {
    chatCommandKind: 'deleteDefinition',
    modelCommandKinds: ['deleteDefinition'],
    requiresTransactionWrapper: false
  },
  {
    chatCommandKind: 'removeAttachment',
    modelCommandKinds: ['setAttribute'],
    requiresTransactionWrapper: false,
    note:
      'Attachments are one value of the AT_ORBITPM_ATTACHMENT object-definition attribute, not ' +
      'a dedicated ArisCommandKind, so removal is a setAttribute command built by ' +
      'removeAttachmentCommand in src/aris/canvas/attachments.ts (see module doc).'
  }
])

/** `src/aris/model` `ArisCommandKind` values with no chat-patch-command counterpart today. */
export const MODEL_COMMAND_KINDS_WITHOUT_CHAT_COMMAND: readonly ModelCommandKindName[] =
  Object.freeze([
    'removeAttributeValue',
    'moveOccurrence',
    'resizeOccurrence',
    'restyleOccurrence',
    'setOccurrenceSymbol',
    'setAttributeOccurrencePlacement',
    'deleteConnectionDefinition',
    'addLane',
    'editLane',
    'deleteLane',
    'addFreeText',
    'editFreeText',
    'deleteFreeText',
    'transaction'
  ])
