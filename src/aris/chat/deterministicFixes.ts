/**
 * Deterministic fix planner — Lane L5d (plan §18 "N issues — Fix…").
 *
 * Turns the fifteen §18.1 gap kinds (`scanArisChatGaps`) into a THREE-TIER fix plan the
 * `ArisFixMissingDialog` renders:
 *
 *   - **Tier A — safe translation fills** (`translationFillTargets`): a missing English/Arabic
 *     name whose COUNTERPART language already exists. Filling the missing side is a
 *     `setLocalizedName`, which `classification.ts` classifies `automatic`, so the dialog offers
 *     it as one safe click that routes into the translate controller's fill path.
 *   - **Tier B — deterministic structural proposals** (`confirmProposals`): a concrete,
 *     schema-valid `ArisChatCommand[]` per gap, confirm-gated with a before/after preview.
 *   - **Tier C — needs answers** (`interviewGaps`): everything a deterministic rule cannot fix
 *     on its own; routed into the chat drawer's interview tab.
 *
 * ## Tier table (all fifteen gap kinds)
 *
 * | Gap kind                        | Tier | How                                                        |
 * |---------------------------------|------|------------------------------------------------------------|
 * | missingEnglishName              | A/C  | A when the Arabic name exists (`hasArabicName`), else C     |
 * | missingArabicName               | A/C  | A when the English name exists (`hasEnglishName`), else C   |
 * | missingProcessCode              | C    | needs the actual code                                       |
 * | missingOwner                    | C    | needs the responsible person/role                          |
 * | missingInputsOutputsSystems     | C    | needs the input/output/system to attach                    |
 * | missingDecisionBasis            | C    | needs the decision criteria                                |
 * | missingXorOutcomes              | C    | needs the branch outcome labels                            |
 * | missingReturnTarget             | C    | needs the return destination                               |
 * | missingStartOrEndEvent          | B    | addCoreObject (OT_EVT) + addCoreConnection to/from func     |
 * | invalidSequence                 | C    | needs a human to repair the alternation                    |
 * | danglingObjectOrConnection      | B    | full-cluster cascade (see `buildDanglingClusterCommands`)   |
 * | missingLinkedModel              | C    | needs the model to link                                    |
 * | missingAttachment               | C    | needs the file to attach                                   |
 * | unusedDefinition                | B/C  | B: deleteDefinition (object def); standalone connection def ⇒ C (orphaned connection defs are removed inline by the dangling cascade's deleteConnectionDefinition) |
 * | unaccountedSourceContent        | C    | needs a human to account for the source record             |
 *
 * ## Determinism & boundary
 *
 * This module has NO AI and NO network. It operates on the structural `ArisChatWorkingDocument`
 * (the real `ArisWorkingDocument` is structurally assignable, exactly as `scanArisGaps` already
 * relies on), so it never imports `src/aris/model`. Placeholder ids (`fix-start-event::…`) are
 * correlation tokens; the gesture allocator (`arisChatHost.ts`) maps them to real, collision-
 * checked ids at apply time — they never appear in the resulting document.
 */

import { FLOW_CONNECTION_TYPES, OT_EVT, OT_FUNC } from '../epc/constants'
import type { ArisChatGap, ArisChatGapKind } from './gapScanner'
import { hasArabicName, hasEnglishName } from './locale'
import type { ArisChatCommand, ArisChatCommandKind } from './patchSchema'
import type { ArisChatLocalizedValue, ArisChatWorkingDocument } from './types'

/** One Tier-B (confirm-gated) structural proposal. */
export interface ArisFixConfirmProposal {
  readonly gap: ArisChatGap
  readonly commands: readonly ArisChatCommand[]
  /** i18n message key describing the proposal (rendered with a fallback by the dialog). */
  readonly labelKey: string
}

export interface ArisDeterministicFixPlan {
  /** Tier A — a counterpart-language name exists, so the missing side is a safe auto-fill. */
  readonly translationFillTargets: readonly ArisChatGap[]
  /** Tier B — deterministic structural proposals, each confirm-gated. */
  readonly confirmProposals: readonly ArisFixConfirmProposal[]
  /** Tier C — routed into the chat drawer's interview tab. */
  readonly interviewGaps: readonly ArisChatGap[]
}

/**
 * The command kind a Tier-A translation fill becomes. Exported so the classification-invariant
 * test can assert `AUTOMATIC_COMMAND_KINDS.has(ARIS_FIX_TRANSLATION_FILL_COMMAND_KIND)` and the
 * tier policy can never silently drift out of the automatic set.
 */
export const ARIS_FIX_TRANSLATION_FILL_COMMAND_KIND: ArisChatCommandKind = 'setLocalizedName'

/** i18n message keys the start/end-event proposals resolve their bilingual names from (L2b pair). */
export const ARIS_FIX_START_EVENT_NAME_KEY = 'aris.fix.startEvent.name'
export const ARIS_FIX_END_EVENT_NAME_KEY = 'aris.fix.endEvent.name'

/** Bilingual names the start/end-event proposals author, resolved at build time (see key pair). */
const START_EVENT_NAME = Object.freeze({ en: 'Process started', ar: 'بدأت العملية' })
const END_EVENT_NAME = Object.freeze({ en: 'Process completed', ar: 'اكتملت العملية' })

/**
 * Control-flow connection types the start/end proposals author, per the EPC adapter's census
 * (`src/aris/epc/constants.ts` `FLOW_CONNECTION_TYPES`): an event ACTIVATES a function
 * (`CT_ACTIV_1`, OT_EVT→OT_FUNC), a function CREATES an event (`CT_CRT_1`, OT_FUNC→OT_EVT).
 */
const START_CONNECTION_TYPE = 'CT_ACTIV_1'
const END_CONNECTION_TYPE = 'CT_CRT_1'

/** Default event symbol for a newly authored OT_EVT occurrence (ST_EV — the EEPC event shape). */
const EVENT_SYMBOL = 'ST_EV'

/** The gap messageKeys `checkStartEndCompleteness` emits, used to split start vs end. */
const MISSING_START_MESSAGE_KEY = 'aris.epc.finding.missingStartEvent'
const MISSING_END_MESSAGE_KEY = 'aris.epc.finding.missingEndEvent'

/** The gap messageKeys `checkLocalDanglingReferences` emits for a dangling CONNECTION occurrence. */
const DANGLING_CONNECTION_MESSAGE_KEY = 'aris.chat.gap.dangling.connectionEndpoint'

/** Label key shared by every deletion proposal (registered — `src/i18n/dictionaries.ts`). */
const PROPOSE_REMOVAL_LABEL_KEY = 'aris.chat.proposeRemoval'

/** English fallbacks for the proposal label keys the dialog may receive (dialog is i18n-gated). */
export const ARIS_FIX_PROPOSAL_LABEL_FALLBACK: Readonly<Record<string, string>> = Object.freeze({
  [ARIS_FIX_START_EVENT_NAME_KEY]: START_EVENT_NAME.en,
  [ARIS_FIX_END_EVENT_NAME_KEY]: END_EVENT_NAME.en,
  [PROPOSE_REMOVAL_LABEL_KEY]: 'Propose removing it'
})

/** English fallbacks per gap kind, so the Tier-C list renders readable text before X1 lands. */
export const ARIS_FIX_GAP_KIND_FALLBACK: Readonly<Record<ArisChatGapKind, string>> = Object.freeze({
  missingEnglishName: 'Missing English name',
  missingArabicName: 'Missing Arabic name',
  missingProcessCode: 'Missing process code',
  missingOwner: 'Missing owner / responsibility',
  missingInputsOutputsSystems: 'Missing inputs, outputs or systems',
  missingDecisionBasis: 'Missing decision basis',
  missingXorOutcomes: 'Missing XOR branch outcomes',
  missingReturnTarget: 'Missing return target',
  missingStartOrEndEvent: 'Missing start or end event',
  invalidSequence: 'Invalid event/function sequence',
  danglingObjectOrConnection: 'Dangling object or connection',
  missingLinkedModel: 'Missing linked model',
  missingAttachment: 'Missing attachment',
  unusedDefinition: 'Unused definition',
  unaccountedSourceContent: 'Unaccounted source content'
})

// --- lookup helpers ---------------------------------------------------------------------------

interface ChatOccurrenceRef {
  readonly id: string
  readonly definitionId: string
}

function resolveNames(
  document: ArisChatWorkingDocument,
  id: string
): ArisChatLocalizedValue | null {
  const model = document.models.get(id)
  if (model) return model.names
  const definition = document.objectDefinitions.get(id)
  if (definition) return definition.names
  return null
}

/** Which model an object OR connection occurrence id belongs to, or `undefined` if unknown. */
function modelIdForOccurrence(document: ArisChatWorkingDocument, id: string): string | undefined {
  for (const model of document.models.values()) {
    if (model.occurrences.some((occurrence) => occurrence.id === id)) return model.id
    if (model.connectionOccurrences.some((connection) => connection.id === id)) return model.id
  }
  return undefined
}

function isConnectionOccurrence(document: ArisChatWorkingDocument, id: string): boolean {
  for (const model of document.models.values()) {
    if (model.connectionOccurrences.some((connection) => connection.id === id)) return true
  }
  return false
}

function functionOccurrences(
  document: ArisChatWorkingDocument,
  modelId: string
): readonly ChatOccurrenceRef[] {
  const model = document.models.get(modelId)
  if (!model) return []
  return model.occurrences.filter(
    (occurrence) => document.objectDefinitions.get(occurrence.definitionId)?.type === OT_FUNC
  )
}

/** The function with no incoming control flow (the entry), tie-broken by occurrence order. */
function firstFunction(
  document: ArisChatWorkingDocument,
  modelId: string
): ChatOccurrenceRef | null {
  const functions = functionOccurrences(document, modelId)
  if (functions.length === 0) return null
  const model = document.models.get(modelId)!
  const flowTargets = new Set<string>()
  for (const connection of model.connectionOccurrences) {
    const type = document.connectionDefinitions.get(connection.definitionId)?.type
    if (type && FLOW_CONNECTION_TYPES.has(type)) flowTargets.add(connection.targetOccurrenceId)
  }
  return functions.find((occurrence) => !flowTargets.has(occurrence.id)) ?? functions[0]!
}

/** The function with no outgoing control flow (the exit), tie-broken by occurrence order. */
function lastFunction(
  document: ArisChatWorkingDocument,
  modelId: string
): ChatOccurrenceRef | null {
  const functions = functionOccurrences(document, modelId)
  if (functions.length === 0) return null
  const model = document.models.get(modelId)!
  const flowSources = new Set<string>()
  for (const connection of model.connectionOccurrences) {
    const type = document.connectionDefinitions.get(connection.definitionId)?.type
    if (type && FLOW_CONNECTION_TYPES.has(type)) flowSources.add(connection.sourceOccurrenceId)
  }
  for (let index = functions.length - 1; index >= 0; index -= 1) {
    if (!flowSources.has(functions[index]!.id)) return functions[index]!
  }
  return functions[functions.length - 1]!
}

/** Models with zero OT_EVT occurrences, in document iteration order (both start+end are missing). */
function eventlessModelIds(document: ArisChatWorkingDocument): readonly string[] {
  const ids: string[] = []
  for (const model of document.models.values()) {
    const hasEvent = model.occurrences.some(
      (occurrence) => document.objectDefinitions.get(occurrence.definitionId)?.type === OT_EVT
    )
    if (!hasEvent) ids.push(model.id)
  }
  return ids
}

// --- Tier B builders --------------------------------------------------------------------------

function localizedNames(locales: { en: string; ar: string }, name: { en: string; ar: string }) {
  return {
    values: { [locales.en]: name.en, [locales.ar]: name.ar },
    fallback: name.en
  }
}

/**
 * One start/end-event proposal: an `addCoreObject` (the event) followed by an `addCoreConnection`
 * joining it to the first/last function. The two commands are ordered so the connection can name
 * the event's placeholder ids; the gesture allocator resolves the placeholders to real ids.
 */
function buildStartEndProposal(
  document: ArisChatWorkingDocument,
  gap: ArisChatGap,
  modelId: string,
  locales: { en: string; ar: string }
): ArisFixConfirmProposal {
  const isStart = gap.messageKey === MISSING_START_MESSAGE_KEY
  const role = isStart ? 'start' : 'end'
  const name = isStart ? START_EVENT_NAME : END_EVENT_NAME
  const definitionPlaceholder = `fix-${role}-event-def::${modelId}`
  const occurrencePlaceholder = `fix-${role}-event::${modelId}`
  const connectionDefPlaceholder = `fix-${role}-conn-def::${modelId}`
  const connectionOccPlaceholder = `fix-${role}-conn::${modelId}`

  const eventCommand: ArisChatCommand = {
    commandId: `fix-add-${role}-event::${modelId}`,
    kind: 'addCoreObject',
    targetIds: [occurrencePlaceholder],
    payload: {
      definitionId: definitionPlaceholder,
      occurrenceId: occurrencePlaceholder,
      modelId,
      objectType: 'OT_EVT',
      symbol: EVENT_SYMBOL,
      names: localizedNames(locales, name)
    }
  }

  const commands: ArisChatCommand[] = [eventCommand]

  const anchor = isStart ? firstFunction(document, modelId) : lastFunction(document, modelId)
  if (anchor) {
    const connectionCommand: ArisChatCommand = {
      commandId: `fix-add-${role}-conn::${modelId}`,
      kind: 'addCoreConnection',
      targetIds: [connectionOccPlaceholder, anchor.id],
      payload: {
        connectionDefinitionId: connectionDefPlaceholder,
        connectionType: isStart ? START_CONNECTION_TYPE : END_CONNECTION_TYPE,
        connectionOccurrenceId: connectionOccPlaceholder,
        modelId,
        fromObjectDefinitionId: isStart ? definitionPlaceholder : anchor.definitionId,
        toObjectDefinitionId: isStart ? anchor.definitionId : definitionPlaceholder,
        sourceOccurrenceId: isStart ? occurrencePlaceholder : anchor.id,
        targetOccurrenceId: isStart ? anchor.id : occurrencePlaceholder
      }
    }
    commands.push(connectionCommand)
  }

  return {
    gap,
    commands,
    labelKey: isStart ? ARIS_FIX_START_EVENT_NAME_KEY : ARIS_FIX_END_EVENT_NAME_KEY
  }
}

/**
 * Full-cluster cascade for one dangling/orphan gap's targets.
 *
 * A bare `deleteOccurrence` on an object occurrence that still has connection occurrences attached
 * leaves those connections with a dangling endpoint, and the model layer's post-apply
 * `validateDocument` rejects the whole batch (`dangling-connection-endpoint`) — exactly what the
 * interactive canvas delete avoids by cascading attached connections first. Cascading connections
 * ALONE is not enough either: it strands the connection definitions those occurrences were the
 * last users of, which the gap scan then reports as new `unusedDefinition` gaps (the count rises).
 * So this emits a FULL cluster, IN ORDER, per object-occurrence target `id`:
 *   (a) `deleteConnection` for every connection occurrence attached to `id`
 *       (source or target endpoint), de-duped across the gap's targets via `claimedConnections`;
 *   (b) the `deleteOccurrence` for `id` itself;
 *   (c) `deleteConnectionDefinition` for each connection definition left with zero occurrences
 *       once (a) is applied;
 *   (d) `deleteDefinition` for the object definition if `id` was its last occurrence.
 * A connection-occurrence target keeps the bare `deleteConnection` path. Command ids are
 * deterministic per record id, so a connection/definition shared by two clusters yields the same
 * command id in each — `ArisFixMissingDialog` de-dupes selected commands by id so select-all never
 * double-deletes.
 */
function buildDanglingClusterCommands(
  document: ArisChatWorkingDocument,
  targets: readonly string[]
): readonly ArisChatCommand[] {
  const commands: ArisChatCommand[] = []
  const claimedConnections = new Set<string>()
  const deletedObjectOccurrences = new Set<string>()
  const emittedConnectionDefinitions = new Set<string>()
  const emittedObjectDefinitions = new Set<string>()

  // Document-wide occurrence rosters per definition, so "zero remaining" is exact.
  const connectionOccurrenceIdsByDefinition = new Map<string, string[]>()
  const objectOccurrenceIdsByDefinition = new Map<string, string[]>()
  const objectOccurrenceById = new Map<string, ChatOccurrenceRef>()
  for (const model of document.models.values()) {
    for (const connection of model.connectionOccurrences) {
      const list = connectionOccurrenceIdsByDefinition.get(connection.definitionId) ?? []
      list.push(connection.id)
      connectionOccurrenceIdsByDefinition.set(connection.definitionId, list)
    }
    for (const occurrence of model.occurrences) {
      const list = objectOccurrenceIdsByDefinition.get(occurrence.definitionId) ?? []
      list.push(occurrence.id)
      objectOccurrenceIdsByDefinition.set(occurrence.definitionId, list)
      objectOccurrenceById.set(occurrence.id, occurrence)
    }
  }

  const emitDeleteConnection = (connectionId: string): void => {
    if (claimedConnections.has(connectionId)) return
    claimedConnections.add(connectionId)
    commands.push({
      commandId: `fix-delete-connection::${connectionId}`,
      kind: 'deleteConnection',
      targetIds: [connectionId],
      payload: { connectionOccurrenceId: connectionId }
    })
  }

  for (const id of targets) {
    if (isConnectionOccurrence(document, id)) {
      emitDeleteConnection(id)
      continue
    }
    const occurrence = objectOccurrenceById.get(id)
    if (!occurrence) continue

    // (a) every connection occurrence whose source/target endpoint is this object occurrence.
    const attached: { readonly id: string; readonly definitionId: string }[] = []
    for (const model of document.models.values()) {
      for (const connection of model.connectionOccurrences) {
        if (connection.sourceOccurrenceId === id || connection.targetOccurrenceId === id) {
          attached.push({ id: connection.id, definitionId: connection.definitionId })
        }
      }
    }
    for (const connection of attached) emitDeleteConnection(connection.id)

    // (b) the dangling object occurrence itself.
    deletedObjectOccurrences.add(id)
    commands.push({
      commandId: `fix-delete-occurrence::${id}`,
      kind: 'deleteOccurrence',
      targetIds: [id],
      payload: { occurrenceId: id }
    })

    // (c) connection definitions left with zero occurrences once (a) is applied.
    for (const connection of attached) {
      const definitionId = connection.definitionId
      if (emittedConnectionDefinitions.has(definitionId)) continue
      if (!document.connectionDefinitions.has(definitionId)) continue
      const roster = connectionOccurrenceIdsByDefinition.get(definitionId) ?? []
      if (roster.every((occurrenceId) => claimedConnections.has(occurrenceId))) {
        emittedConnectionDefinitions.add(definitionId)
        commands.push({
          commandId: `fix-delete-connection-definition::${definitionId}`,
          kind: 'deleteConnectionDefinition',
          targetIds: [definitionId],
          payload: { definitionId }
        })
      }
    }

    // (d) the object definition if this was its last surviving occurrence.
    const objectDefinitionId = occurrence.definitionId
    if (
      !emittedObjectDefinitions.has(objectDefinitionId) &&
      document.objectDefinitions.has(objectDefinitionId)
    ) {
      const roster = objectOccurrenceIdsByDefinition.get(objectDefinitionId) ?? []
      if (roster.every((occurrenceId) => deletedObjectOccurrences.has(occurrenceId))) {
        emittedObjectDefinitions.add(objectDefinitionId)
        commands.push({
          commandId: `fix-delete-definition::${objectDefinitionId}`,
          kind: 'deleteDefinition',
          targetIds: [objectDefinitionId],
          payload: { definitionId: objectDefinitionId }
        })
      }
    }
  }

  return commands
}

// --- planner ----------------------------------------------------------------------------------

/**
 * Split `gaps` into the three fix tiers for `document`. Pure and deterministic: the same document
 * and gap list always produce the same plan.
 *
 * `locales` are the document's actual English/Arabic locale ids (see `detectLocaleIds`), used to
 * key the bilingual names the start/end-event proposals author.
 */
export function buildDeterministicFixPlan(
  document: ArisChatWorkingDocument,
  gaps: readonly ArisChatGap[],
  locales: { readonly en: string; readonly ar: string }
): ArisDeterministicFixPlan {
  const translationFillTargets: ArisChatGap[] = []
  const confirmProposals: ArisFixConfirmProposal[] = []
  const interviewGaps: ArisChatGap[] = []

  // Positional fallback queues for start/end gaps whose model cannot be recovered from targetIds
  // (a model with no events at all yields empty-target findings, in document order).
  const eventlessStartQueue = [...eventlessModelIds(document)]
  const eventlessEndQueue = [...eventlessModelIds(document)]

  for (const gap of gaps) {
    switch (gap.kind) {
      case 'missingEnglishName':
      case 'missingArabicName': {
        const names = resolveNames(document, gap.targetIds[0] ?? '')
        const counterpartPresent =
          names !== null &&
          (gap.kind === 'missingEnglishName' ? hasArabicName(names) : hasEnglishName(names))
        if (counterpartPresent) translationFillTargets.push(gap)
        else interviewGaps.push(gap)
        break
      }
      case 'missingStartOrEndEvent': {
        const isStart = gap.messageKey === MISSING_START_MESSAGE_KEY
        let modelId = gap.targetIds[0]
          ? modelIdForOccurrence(document, gap.targetIds[0])
          : undefined
        if (!modelId) {
          modelId = (isStart ? eventlessStartQueue : eventlessEndQueue).shift()
        }
        if (
          modelId &&
          document.models.has(modelId) &&
          (gap.messageKey === MISSING_START_MESSAGE_KEY ||
            gap.messageKey === MISSING_END_MESSAGE_KEY)
        ) {
          confirmProposals.push(buildStartEndProposal(document, gap, modelId, locales))
        } else {
          interviewGaps.push(gap)
        }
        break
      }
      case 'unusedDefinition': {
        const target = gap.targetIds[0] ?? ''
        if (document.objectDefinitions.has(target)) {
          confirmProposals.push({
            gap,
            commands: [
              {
                commandId: `fix-delete-definition::${target}`,
                kind: 'deleteDefinition',
                targetIds: [target],
                payload: { definitionId: target }
              }
            ],
            labelKey: PROPOSE_REMOVAL_LABEL_KEY
          })
        } else {
          // An unused CONNECTION definition has no deleteDefinition counterpart; route to Tier C.
          interviewGaps.push(gap)
        }
        break
      }
      case 'danglingObjectOrConnection': {
        // A locally-detected dangling connection references its own connection-occurrence id; the
        // epc-derived findings reference node ids. Resolve each target to the delete that removes
        // it, preferring the connection delete for the local connection-endpoint finding.
        const targets =
          gap.messageKey === DANGLING_CONNECTION_MESSAGE_KEY
            ? gap.targetIds.slice(0, 1)
            : gap.targetIds
        const commands = buildDanglingClusterCommands(document, targets)
        if (commands.length > 0) {
          confirmProposals.push({ gap, commands, labelKey: PROPOSE_REMOVAL_LABEL_KEY })
        } else {
          interviewGaps.push(gap)
        }
        break
      }
      default:
        interviewGaps.push(gap)
        break
    }
  }

  return {
    translationFillTargets: Object.freeze(translationFillTargets),
    confirmProposals: Object.freeze(confirmProposals),
    interviewGaps: Object.freeze(interviewGaps)
  }
}
