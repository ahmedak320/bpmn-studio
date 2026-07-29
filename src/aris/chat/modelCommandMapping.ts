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
 *   - `addMetadataConnection`, `addCoreObject`, `addCoreConnection` each produce TWO model
 *     commands (a `create*Definition` + a `create*Occurrence`), which the real command system
 *     wraps in one `transaction` command (see `applyTransaction` / `ArisCommandKind.transaction`
 *     in `src/aris/model/commands.ts`) so they commit atomically.
 *   - `removeAttachment` has NO corresponding `ArisCommandKind` — attachments are not part of
 *     `ArisWorkingDocument` today (they live in `ArisPendingAttachment` /
 *     `src/aris/packages/accounting.ts`, outside the model layer). Applying it is therefore the
 *     integration seam's job entirely; this lane only classifies and schema-validates it.
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
  /** True when the model commands above must be wrapped in one `transaction` to be atomic. */
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
    requiresTransactionWrapper: true
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
    note: 'Also covers the "return back-edge" case (payload.isReturnBackEdge); same model commands, same classification.'
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
    modelCommandKinds: [],
    requiresTransactionWrapper: false,
    note: 'No corresponding ArisCommandKind — attachments live outside src/aris/model today (see module doc).'
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
