/**
 * The seam between `src/aris/chat` (plan §18) and the real ARIS model layer.
 *
 * `src/aris/chat` declares its own structural document shape and its own patch
 * command vocabulary, deliberately without importing `src/aris/model`. The real
 * `ArisWorkingDocument` already satisfies `ArisChatWorkingDocument` structurally,
 * so the only thing missing is the translation of one `ArisChatCommand` into one
 * `ArisEditCommand` — `modelCommandMapping.ts` documents the mapping; this file
 * performs it.
 *
 * Two rules are load-bearing:
 *
 *  - A command kind this seam cannot express THROWS. `applySafeCommandsAtomically`
 *    treats any throw as "this command could not be applied" and aborts the whole
 *    batch with the document untouched, which is precisely the §18.8 guarantee
 *    that an invalid patch changes nothing. Silently skipping would break it.
 *  - Every `ArisEditCommand` is built against the document it will actually be
 *    applied to, so `baseRevision` always matches and a stale proposal is rejected
 *    by the model layer rather than by a hopeful check here.
 */

import { applyCommand as applyModelCommand, type ArisEditCommand } from '../model/commands'
import type { ArisPoint, ArisWorkingDocument } from '../model/types'
import type { ArisChatApplyHost } from '../chat/applyEngine'
import { DEFAULT_GAP_SCAN_CONFIG, scanArisChatGaps, type ArisChatGap } from '../chat/gapScanner'
import type {
  ArisChatInterviewHost,
  ArisChatProposalTargetVerification
} from '../chat/interviewLoop'
import type { ArisChatCommand, ArisPatchProposalV1 } from '../chat/patchSchema'

/** Raised when a patch command has no `src/aris/model` counterpart in this shell. */
export class ArisChatUnsupportedCommandError extends Error {
  readonly kind: string

  constructor(kind: string) {
    super(`Patch command "${kind}" has no model-layer counterpart in this shell build.`)
    this.name = 'ArisChatUnsupportedCommandError'
    this.kind = kind
  }
}

/**
 * Patch command kinds this seam can translate today.
 *
 * The creation kinds (`addCoreObject`, `addMetadataDefinition`, …) are missing on
 * purpose: they require source-style ARIS id allocation and canonical placement,
 * which live in `src/aris/writer`'s allocator and the canvas authoring layer, not
 * in a translation function. Proposing one is not an error in the chat lane — it
 * is simply refused here, loudly.
 */
export const ARIS_CHAT_SUPPORTED_COMMAND_KINDS: ReadonlySet<ArisChatCommand['kind']> =
  Object.freeze(
    new Set<ArisChatCommand['kind']>([
      'setLocalizedName',
      'setAttribute',
      'addAttributeValue',
      'setAssignment',
      'setRoute',
      'reconnect',
      'deleteConnection',
      'deleteOccurrence',
      'deleteDefinition'
    ])
  )

function modelKindFor(kind: ArisChatCommand['kind']): ArisEditCommand['kind'] {
  switch (kind) {
    case 'setLocalizedName':
      return 'setLocalizedName'
    case 'setAttribute':
      return 'setAttribute'
    case 'addAttributeValue':
      return 'addAttributeValue'
    case 'setAssignment':
      return 'setModelAssignment'
    case 'setRoute':
      return 'setConnectionRoute'
    case 'reconnect':
      return 'reconnectConnection'
    case 'deleteConnection':
      return 'deleteConnection'
    case 'deleteOccurrence':
      return 'deleteOccurrence'
    case 'deleteDefinition':
      return 'deleteDefinition'
    default:
      throw new ArisChatUnsupportedCommandError(kind)
  }
}

/**
 * Translate one patch command into the model command that performs it.
 *
 * The payload shapes are identical by construction (see `modelCommandMapping.ts`),
 * so the payload is carried across unchanged rather than re-derived — the one
 * exception being `setRoute`, whose points are narrowed to `ArisPoint`.
 */
export function toArisEditCommand(
  document: ArisWorkingDocument,
  command: ArisChatCommand,
  origin: ArisEditCommand['origin'] = 'ai-auto'
): ArisEditCommand {
  const kind = modelKindFor(command.kind)
  const after =
    command.kind === 'setRoute'
      ? {
          connectionOccurrenceId: command.payload.connectionOccurrenceId,
          route: command.payload.route.map((point): ArisPoint => ({ x: point.x, y: point.y }))
        }
      : command.payload
  return {
    commandId: command.commandId,
    baseRevision: document.revision,
    kind,
    affectedSourceIds: command.targetIds,
    before: null,
    after,
    origin
  }
}

/** Every id a patch command claims to touch still resolves in `document`. */
function targetsResolve(document: ArisWorkingDocument, targetIds: readonly string[]): boolean {
  return targetIds.every((id) => {
    if (document.models.has(id)) return true
    if (document.objectDefinitions.has(id)) return true
    if (document.connectionDefinitions.has(id)) return true
    for (const model of document.models.values()) {
      if (model.occurrences.some((occurrence) => occurrence.id === id)) return true
      if (model.connectionOccurrences.some((connection) => connection.id === id)) return true
    }
    return false
  })
}

export interface ArisChatHostOptions {
  /** Persist a draft revision (plan §18.5 step 5). Omit when the shell does not. */
  readonly saveDraftRevision?: ArisChatApplyHost<ArisWorkingDocument>['saveDraftRevision']
  readonly origin?: ArisEditCommand['origin']
}

/** Build the §18.5/§18.6 apply host over the real working document. */
export function createArisChatApplyHost(
  options: ArisChatHostOptions = {}
): ArisChatApplyHost<ArisWorkingDocument> {
  return {
    getRevision: (document) => document.revision,
    applyCommand: (document, command) =>
      applyModelCommand(document, toArisEditCommand(document, command, options.origin)),
    ...(options.saveDraftRevision ? { saveDraftRevision: options.saveDraftRevision } : {})
  }
}

/** Build the §18.2 interview host: the apply host plus gap scanning and target checks. */
export function createArisChatInterviewHost(
  options: ArisChatHostOptions = {}
): ArisChatInterviewHost<ArisWorkingDocument> {
  return {
    ...createArisChatApplyHost(options),
    scanGaps: (document) => scanArisChatGaps(document, DEFAULT_GAP_SCAN_CONFIG),
    verifyProposalTargets: (
      document,
      proposal: ArisPatchProposalV1
    ): ArisChatProposalTargetVerification => {
      if (proposal.baseRevision !== document.revision) return 'stale-revision'
      for (const command of proposal.commands) {
        if (!targetsResolve(document, command.targetIds)) return 'target-removed'
      }
      return 'ok'
    }
  }
}

/** Scan the live document for §18.1 gaps. */
export function scanArisGaps(document: ArisWorkingDocument): readonly ArisChatGap[] {
  return scanArisChatGaps(document, DEFAULT_GAP_SCAN_CONFIG)
}
