/**
 * ARIS re-export preparation — plan §20.3 steps 1-3 (Phase 17).
 *
 * Phase 17's live ARIS compatibility gate needs a human to import a derived AML into a real ARIS
 * installation, which this repository cannot do unattended. This script prepares everything up to
 * that hand-off:
 *
 *   1. Import the golden AML (the same real parser every other ARIS script uses).             (§20.3 step 1)
 *   2. Make the nine representative edits §20.3 step 2 lists, picked from the document's own
 *      content — nothing about a specific customer export is hard-coded.                       (§20.3 step 2)
 *   3. Export the derived AML to a file, and a machine-readable manifest of exactly what changed
 *      next to it, so `scripts/aris-reexport-compare.ts` can verify the round trip later without
 *      a human re-deriving what "intended" means.                                              (§20.3 step 3)
 *
 * Every edit goes through the real production authoring API: `src/aris/canvas/commandFactory.ts`
 * builds the `ArisEditCommand`s exactly as the canvas does, `src/aris/model/commands.ts#applyCommand`
 * applies them, and `src/aris/shell/arisDerivedExport.ts#prepareArisDerivedExport` recovers
 * byte-addressed edits against the original bytes — the same pipeline
 * `src/aris/shell/arisDerivedExport.animalwf.test.ts` already proves round-trips a rename, a
 * create and a delete against the real AnimalWF export.
 *
 * New records (a satellite occurrence, a new core connection, a new XOR return connection, and
 * any connection definition either needs) get a fresh ARIS-style source id allocated at export
 * time — the working-model id used while building the edit is not what ends up in the file. After
 * writing the derived AML this script re-parses its own output and locates each new record by the
 * structural signature it was created with (definition + exact bounds for the satellite occurrence;
 * stable pre-existing endpoint ids for new connections), so the manifest records real, checkable
 * ids rather than internal working ids nobody else can see.
 *
 * ## Usage
 *
 * ```sh
 * npm run test:aris:reexport-prep -- <golden.aml-or-xml>
 * npm run test:aris:reexport-prep -- <golden.aml> --model=<modelId> --out=derived.aml
 * ```
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { addAttachmentCommand, type ArisAttachment } from '../src/aris/canvas/attachments'
import {
  createConnectionDefinitionCommand,
  createOccurrenceCommand,
  createConnectionOccurrenceCommand,
  moveOccurrenceCommand,
  setAttributeCommand,
  setConnectionRouteCommand,
  setLocalizedNameCommand,
  setModelAssignmentCommand,
  type ArisCommandContext
} from '../src/aris/canvas/commandFactory'
import {
  isSatelliteObjectType,
  resolveConnectionType,
  ruleOperatorOfSymbol
} from '../src/aris/canvas/vocabulary'
import { applyCommand, type ArisEditCommand } from '../src/aris/model/commands'
import type { ArisModel, ArisObjectOccurrence, ArisWorkingDocument } from '../src/aris/model/types'
import { buildArisStudioDocument } from '../src/aris/shell/arisStudioDocument'
import { derivedAmlFileName, prepareArisDerivedExport } from '../src/aris/shell/arisDerivedExport'
import { createArisXmlSourcePackage } from '../src/aris/source/sourcePackage'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')

// Synthetic, unmistakably OrbitPM-authored values — never resembling real customer content, the
// same convention `arisDerivedExport.animalwf.test.ts` uses for its own probe values.
const RENAME_VALUE = 'OrbitPM Phase 17 rename probe'
const ATTRIBUTE_TYPE = 'AT_ORBITPM_PHASE17_NOTE'
const ATTRIBUTE_VALUE = 'OrbitPM Phase 17 attribute probe'
const MOVE_OFFSET = { dx: 180, dy: 140 }
const ROUTE_BEND_OFFSET_Y = -90
const SATELLITE_OFFSET = { dx: 260, dy: 0 }
// `addAttachmentCommand` (src/aris/canvas/attachments.ts) stores each attachment as an
// `<AttrValue LocaleId="...">` keyed by the attachment's own id, and the writer's
// `assertSourceLocaleId` (src/aris/writer/escapeXml.ts) only accepts a decimal literal or an
// entity reference there — anything else is correctly refused rather than corrupting the AML, and
// shows up as an unmapped edit. A purely numeric id keeps the attachment inside that contract.
const ATTACHMENT_ID = '900170001'
const ATTACHMENT_FILE_NAME = 'phase17-reexport-probe.txt'
const ATTACHMENT_MIME_TYPE = 'text/plain'
const ATTACHMENT_CONTENT = 'OrbitPM Phase 17 re-export probe attachment.\n'

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

interface ParsedArgs {
  readonly positionals: readonly string[]
  readonly flags: ReadonlyMap<string, string>
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const positionals: string[] = []
  const flags = new Map<string, string>()
  for (const arg of argv) {
    const match = /^--([a-zA-Z0-9-]+)=(.*)$/.exec(arg)
    if (match) flags.set(match[1] as string, match[2] as string)
    else positionals.push(arg)
  }
  return { positionals: Object.freeze(positionals), flags }
}

function printUsage(): void {
  console.error(
    [
      'Usage: npm run test:aris:reexport-prep -- <golden.aml-or-xml> [options]',
      '',
      'Required:',
      '  <golden.aml-or-xml>  Path to the golden ARIS AML/XML export (plan §20.1).',
      '',
      'Options:',
      '  --model=<modelId>       Force the model the nine edits are made in. Defaults to the',
      '                          MT_EEPC model with the most objects (falls back to the largest',
      '                          MT_VAL_ADD_CHN_DGM model when the export has no EEPC model).',
      '  --out=<path.aml>        Where to write the derived AML. Defaults to',
      '                          local-evidence/aris-phase17/<name>.derived.xml (git-ignored).',
      '  --manifest=<path.json>  Where to write the edit manifest. Defaults to <out> with its',
      '                          extension replaced by .manifest.json.',
      '',
      'Output is written only to a git-ignored path: the golden export is private customer data.'
    ].join('\n')
  )
}

const { positionals, flags } = parseArgs(process.argv.slice(2))
if (positionals.length < 1) {
  printUsage()
  process.exit(1)
}

const abs = (value: string): string => (isAbsolute(value) ? value : resolve(REPO, value))
const amlPath = abs(positionals[0] as string)
if (!existsSync(amlPath)) {
  console.error(`Golden AML/XML not found at ${amlPath}.`)
  process.exit(1)
}
const forcedModelId = flags.get('model') ?? null
const outPath = abs(
  flags.get('out') ?? `local-evidence/aris-phase17/${derivedAmlFileName(basename(amlPath))}`
)
function manifestPathFor(derivedPath: string): string {
  const dot = derivedPath.lastIndexOf('.')
  return dot <= 0 ? `${derivedPath}.manifest.json` : `${derivedPath.slice(0, dot)}.manifest.json`
}
const manifestPath = abs(flags.get('manifest') ?? manifestPathFor(outPath))

function assertGitIgnored(path: string): void {
  try {
    execFileSync('git', ['check-ignore', '-q', '--', path], { cwd: REPO, stdio: 'ignore' })
  } catch {
    throw new Error(
      `Refusing to write ${path}: it is not git-ignored. A derived export built from a private ` +
        'golden ARIS export must never enter the repository.'
    )
  }
}

// ---------------------------------------------------------------------------
// Small pure helpers over the working model (plan §11.3 vocabulary)
// ---------------------------------------------------------------------------

type ControlFlowRole = 'function' | 'event' | 'rule' | 'other'

function controlFlowRole(objectType: string): ControlFlowRole {
  if (objectType === 'OT_FUNC') return 'function'
  if (objectType === 'OT_EVT') return 'event'
  if (objectType === 'OT_RULE') return 'rule'
  return 'other'
}

function buildObjectTypeIndex(document: ArisWorkingDocument): ReadonlyMap<string, string> {
  const map = new Map<string, string>()
  for (const model of document.models.values()) {
    for (const occurrence of model.occurrences) {
      const definition = document.objectDefinitions.get(occurrence.definitionId)
      map.set(occurrence.id, definition?.type ?? 'OT_UNKNOWN')
    }
  }
  return map
}

/** Pick the richest renderable model to make the nine edits in — EEPC preferred over VACD. */
function chooseModel(document: ArisWorkingDocument, forcedId: string | null): ArisModel {
  if (forcedId) {
    const forced = document.models.get(forcedId)
    if (!forced) throw new Error(`--model=${forcedId} does not exist in this document.`)
    return forced
  }
  const candidates = [...document.models.values()].filter(
    (model) => !model.unsupported && model.occurrences.length > 0
  )
  if (candidates.length === 0) {
    throw new Error('The golden document has no renderable model with any objects to edit.')
  }
  const byPreference = (model: ArisModel): number => (model.type === 'MT_EEPC' ? 1 : 0)
  candidates.sort(
    (left, right) =>
      byPreference(right) - byPreference(left) || right.occurrences.length - left.occurrences.length
  )
  return candidates[0] as ArisModel
}

/** Any non-empty locale token declared anywhere in the document — reused everywhere a localized
 *  text value needs a real `LocaleId`, since a `null` locale is unexportable (plan §9.1). */
function findAnyLocaleId(document: ArisWorkingDocument): string {
  for (const definition of document.objectDefinitions.values()) {
    for (const [localeId, text] of Object.entries(definition.names.values)) {
      if (text.trim() !== '') return localeId
    }
  }
  for (const model of document.models.values()) {
    for (const [localeId, text] of Object.entries(model.names.values)) {
      if (text.trim() !== '') return localeId
    }
  }
  return 'en'
}

interface ControlFlowGraph {
  readonly forward: ReadonlyMap<string, ReadonlySet<string>>
  readonly backward: ReadonlyMap<string, ReadonlySet<string>>
}

function buildControlFlowGraph(
  model: ArisModel,
  objectTypeOf: ReadonlyMap<string, string>
): ControlFlowGraph {
  const controlIds = new Set(
    model.occurrences
      .filter((occurrence) => controlFlowRole(objectTypeOf.get(occurrence.id) ?? '') !== 'other')
      .map((occurrence) => occurrence.id)
  )
  const forward = new Map<string, Set<string>>()
  const backward = new Map<string, Set<string>>()
  for (const connection of model.connectionOccurrences) {
    if (
      !controlIds.has(connection.sourceOccurrenceId) ||
      !controlIds.has(connection.targetOccurrenceId)
    ) {
      continue
    }
    if (!forward.has(connection.sourceOccurrenceId))
      forward.set(connection.sourceOccurrenceId, new Set())
    forward.get(connection.sourceOccurrenceId)?.add(connection.targetOccurrenceId)
    if (!backward.has(connection.targetOccurrenceId))
      backward.set(connection.targetOccurrenceId, new Set())
    backward.get(connection.targetOccurrenceId)?.add(connection.sourceOccurrenceId)
  }
  return { forward, backward }
}

/** Every node with a path (through control-flow edges) that reaches `nodeId`. BFS, not recursive. */
function ancestorsOf(nodeId: string, backward: ReadonlyMap<string, ReadonlySet<string>>): string[] {
  const seen = new Set<string>([nodeId])
  const order: string[] = []
  const queue: string[] = [nodeId]
  while (queue.length > 0) {
    const current = queue.shift() as string
    for (const previous of backward.get(current) ?? []) {
      if (seen.has(previous)) continue
      seen.add(previous)
      order.push(previous)
      queue.push(previous)
    }
  }
  return order
}

interface ConnectionPair {
  readonly source: ArisObjectOccurrence
  readonly target: ArisObjectOccurrence
  readonly connectionType: string
  readonly fallback: boolean
}

/** First not-yet-connected control-flow pair whose types resolve to a known connection type. */
function findCoreConnectionPair(
  model: ArisModel,
  objectTypeOf: ReadonlyMap<string, string>,
  exclude: { readonly source: string; readonly target: string } | null
): ConnectionPair | null {
  const existing = new Set(
    model.connectionOccurrences.map((c) => `${c.sourceOccurrenceId}->${c.targetOccurrenceId}`)
  )
  const controlOccurrences = model.occurrences.filter(
    (occurrence) => controlFlowRole(objectTypeOf.get(occurrence.id) ?? '') !== 'other'
  )
  for (const source of controlOccurrences) {
    for (const target of controlOccurrences) {
      if (source.id === target.id) continue
      if (exclude && exclude.source === source.id && exclude.target === target.id) continue
      if (existing.has(`${source.id}->${target.id}`) || existing.has(`${target.id}->${source.id}`))
        continue
      const resolved = resolveConnectionType(
        model.type,
        objectTypeOf.get(source.id) ?? 'OT_UNKNOWN',
        objectTypeOf.get(target.id) ?? 'OT_UNKNOWN'
      )
      if (resolved.fallback) continue
      return { source, target, connectionType: resolved.connectionType, fallback: false }
    }
  }
  return null
}

/** An XOR rule plus one of its ancestors it does not already point back to — a genuine loop. */
function findXorReturnPair(
  model: ArisModel,
  objectTypeOf: ReadonlyMap<string, string>
): ConnectionPair | null {
  const xor = model.occurrences.find(
    (occurrence) =>
      objectTypeOf.get(occurrence.id) === 'OT_RULE' &&
      ruleOperatorOfSymbol(occurrence.symbol) === 'XOR'
  )
  if (!xor) return null
  const { forward, backward } = buildControlFlowGraph(model, objectTypeOf)
  const alreadyTargeted = forward.get(xor.id) ?? new Set<string>()
  const byId = new Map(model.occurrences.map((occurrence) => [occurrence.id, occurrence]))

  const ancestors = ancestorsOf(xor.id, backward).filter((id) => !alreadyTargeted.has(id))
  const preferredAncestor =
    ancestors.find((id) => objectTypeOf.get(id) === 'OT_FUNC') ?? ancestors[0]
  const target = preferredAncestor
    ? (byId.get(preferredAncestor) as ArisObjectOccurrence)
    : (model.occurrences.find(
        (occurrence) =>
          occurrence.id !== xor.id &&
          objectTypeOf.get(occurrence.id) === 'OT_FUNC' &&
          !alreadyTargeted.has(occurrence.id)
      ) ?? null)
  if (!target) return null

  const resolved = resolveConnectionType(
    model.type,
    'OT_RULE',
    objectTypeOf.get(target.id) ?? 'OT_UNKNOWN'
  )
  return {
    source: xor,
    target,
    connectionType: resolved.connectionType,
    fallback: resolved.fallback
  }
}

// ---------------------------------------------------------------------------
// Manifest shape — consumed by scripts/aris-reexport-compare.ts
// ---------------------------------------------------------------------------

interface ManifestEditEntry {
  readonly index: number
  readonly category: string
  readonly description: string
  readonly commandKind: string
  readonly skipped: boolean
  readonly skipReason: string | null
  readonly targets: {
    readonly modelId: string | null
    /** Ids stable across the ARIS round trip: records that already existed in the golden AML. */
    readonly stableSourceIds: readonly string[]
    /** Working-document ids this run invented for genuinely new records (never in the AML). */
    readonly createdWorkingIds: readonly string[]
    /** Real ARIS-style ids resolved by re-parsing the derived AML, aligned with createdWorkingIds. */
    readonly createdDerivedIds: readonly string[]
  }
  readonly expected: Readonly<Record<string, unknown>>
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const amlBytes = new Uint8Array(readFileSync(amlPath))
  // Same real parser + semantic index every other ARIS script uses (see the module doc comment
  // for why `createArisXmlSourcePackage` is the actual entry point rather than `parseAmlDocument`).
  const pkg = await createArisXmlSourcePackage({
    name: basename(amlPath),
    relPath: null,
    bytes: amlBytes
  })
  const studio = buildArisStudioDocument(pkg)
  const original = studio.source

  const model = chooseModel(original, forcedModelId)
  const objectTypeOf = buildObjectTypeIndex(original)
  const localeId = findAnyLocaleId(original)

  // Target selection happens entirely against the pristine original: edits 1-4 never change
  // topology, so picking the edit 5/6 pairs up front (before any command runs) is safe and keeps
  // "which objects get touched" decoupled from "in what order the commands run".
  const anchorOccurrence: ArisObjectOccurrence =
    model.occurrences.find((o) => controlFlowRole(objectTypeOf.get(o.id) ?? '') === 'function') ??
    model.occurrences.find((o) => controlFlowRole(objectTypeOf.get(o.id) ?? '') !== 'other') ??
    (model.occurrences[0] as ArisObjectOccurrence)
  const anchorDefinition = original.objectDefinitions.get(anchorOccurrence.definitionId)
  if (!anchorDefinition) {
    throw new Error(`Occurrence ${anchorOccurrence.id} references a missing object definition.`)
  }

  const rerouteTarget =
    [...model.connectionOccurrences].sort(
      (left, right) => right.route.length - left.route.length
    )[0] ?? null

  const xorReturnPair = findXorReturnPair(model, objectTypeOf)
  const coreConnectionPair = findCoreConnectionPair(
    model,
    objectTypeOf,
    xorReturnPair && { source: xorReturnPair.source.id, target: xorReturnPair.target.id }
  )

  const satelliteSource: {
    readonly definitionId: string
    readonly symbol: string
    readonly bounds: ArisObjectOccurrence['bounds']
  } | null = (() => {
    const inModel = model.occurrences.find((o) =>
      isSatelliteObjectType(objectTypeOf.get(o.id) ?? '')
    )
    if (inModel)
      return { definitionId: inModel.definitionId, symbol: inModel.symbol, bounds: inModel.bounds }
    for (const other of original.models.values()) {
      const found = other.occurrences.find((o) =>
        isSatelliteObjectType(objectTypeOf.get(o.id) ?? '')
      )
      if (found)
        return { definitionId: found.definitionId, symbol: found.symbol, bounds: found.bounds }
    }
    return null
  })()

  const assignmentDefinition =
    model.occurrences.find(
      (o) =>
        controlFlowRole(objectTypeOf.get(o.id) ?? '') === 'function' &&
        o.definitionId !== anchorDefinition.id
    )?.definitionId ?? anchorDefinition.id
  const assignmentModelId =
    [...original.models.keys()].find(
      (id) =>
        id !== model.id &&
        !(original.objectDefinitions.get(assignmentDefinition)?.linkedModelIds ?? []).includes(id)
    ) ?? null

  // --- apply the nine edits, in order, against a running live document -----

  let doc: ArisWorkingDocument = original
  let editSeq = 0
  const manifestEntries: ManifestEditEntry[] = []
  const printedChanges: string[] = []

  function ctx(): ArisCommandContext {
    editSeq += 1
    return { commandId: `phase17.edit-${editSeq}`, baseRevision: doc.revision, origin: 'user' }
  }
  function apply(command: ArisEditCommand): ArisEditCommand {
    doc = applyCommand(doc, command)
    return command
  }
  function record(entry: Omit<ManifestEditEntry, 'index'>, changeLine: string): void {
    manifestEntries.push({ index: manifestEntries.length + 1, ...entry })
    printedChanges.push(changeLine)
  }
  function recordSkipped(category: string, description: string, reason: string): void {
    manifestEntries.push({
      index: manifestEntries.length + 1,
      category,
      description,
      commandKind: 'none',
      skipped: true,
      skipReason: reason,
      targets: {
        modelId: model.id,
        stableSourceIds: [],
        createdWorkingIds: [],
        createdDerivedIds: []
      },
      expected: {}
    })
    printedChanges.push(`${manifestEntries.length}. [SKIPPED] ${description} — ${reason}`)
  }

  /** Reuse an existing connection definition between these two definitions/type, or mint one. */
  function findOrCreateConnectionDefinition(
    fromDefId: string,
    toDefId: string,
    connectionType: string
  ): string {
    for (const [id, definition] of doc.connectionDefinitions) {
      if (
        definition.fromObjectDefinitionId === fromDefId &&
        definition.toObjectDefinitionId === toDefId &&
        definition.type === connectionType
      ) {
        return id
      }
    }
    const definitionId = `phase17.cxndef.${editSeq}.${fromDefId}.${toDefId}`
    apply(
      createConnectionDefinitionCommand(ctx(), {
        definitionId,
        connectionType,
        fromObjectDefinitionId: fromDefId,
        toObjectDefinitionId: toDefId
      })
    )
    return definitionId
  }

  // 1. Rename a name/translation.
  {
    const previous = anchorDefinition.names.values[localeId] ?? ''
    const command = apply(
      setLocalizedNameCommand(
        ctx(),
        doc,
        'objectDefinition',
        anchorDefinition.id,
        localeId,
        RENAME_VALUE
      )
    )
    record(
      {
        category: 'name',
        description: `Rename object definition ${anchorDefinition.id} (locale ${localeId})`,
        commandKind: command.kind,
        skipped: false,
        skipReason: null,
        targets: {
          modelId: model.id,
          stableSourceIds: [anchorDefinition.id],
          createdWorkingIds: [],
          createdDerivedIds: []
        },
        expected: {
          definitionId: anchorDefinition.id,
          localeId,
          previousValue: previous,
          newValue: RENAME_VALUE
        }
      },
      `1. [name] ${anchorDefinition.id} (${localeId}): "${previous}" -> "${RENAME_VALUE}"`
    )
  }

  // 2. Set an attribute.
  {
    const command = apply(
      setAttributeCommand(ctx(), doc, 'objectDefinition', anchorDefinition.id, ATTRIBUTE_TYPE, [
        { localeId, text: ATTRIBUTE_VALUE }
      ])
    )
    record(
      {
        category: 'attribute',
        description: `Set a new attribute (${ATTRIBUTE_TYPE}) on object definition ${anchorDefinition.id}`,
        commandKind: command.kind,
        skipped: false,
        skipReason: null,
        targets: {
          modelId: model.id,
          stableSourceIds: [anchorDefinition.id],
          createdWorkingIds: [],
          createdDerivedIds: []
        },
        expected: {
          definitionId: anchorDefinition.id,
          attributeType: ATTRIBUTE_TYPE,
          localeId,
          value: ATTRIBUTE_VALUE
        }
      },
      `2. [attribute] ${anchorDefinition.id}: ${ATTRIBUTE_TYPE}[${localeId}] = "${ATTRIBUTE_VALUE}"`
    )
  }

  // 3. Move a shape (geometry change).
  {
    const previous = { x: anchorOccurrence.bounds.x, y: anchorOccurrence.bounds.y }
    const next = { x: previous.x + MOVE_OFFSET.dx, y: previous.y + MOVE_OFFSET.dy }
    const command = apply(moveOccurrenceCommand(ctx(), doc, anchorOccurrence.id, next))
    record(
      {
        category: 'geometry',
        description: `Move occurrence ${anchorOccurrence.id}`,
        commandKind: command.kind,
        skipped: false,
        skipReason: null,
        targets: {
          modelId: model.id,
          stableSourceIds: [anchorOccurrence.id],
          createdWorkingIds: [],
          createdDerivedIds: []
        },
        expected: { occurrenceId: anchorOccurrence.id, previous, next }
      },
      `3. [geometry] ${anchorOccurrence.id}: moved (${previous.x}, ${previous.y}) -> (${next.x}, ${next.y})`
    )
  }

  // 4. Reroute a connection.
  if (rerouteTarget) {
    const source = model.occurrences.find((o) => o.id === rerouteTarget.sourceOccurrenceId)
    const target = model.occurrences.find((o) => o.id === rerouteTarget.targetOccurrenceId)
    const midX = source && target ? Math.round((source.bounds.x + target.bounds.x) / 2 + 40) : 0
    const midY =
      source && target
        ? Math.round((source.bounds.y + target.bounds.y) / 2) + ROUTE_BEND_OFFSET_Y
        : 0
    const newRoute = [{ x: midX, y: midY }]
    const command = apply(setConnectionRouteCommand(ctx(), doc, rerouteTarget.id, newRoute))
    record(
      {
        category: 'route',
        description: `Reroute connection occurrence ${rerouteTarget.id}`,
        commandKind: command.kind,
        skipped: false,
        skipReason: null,
        targets: {
          modelId: model.id,
          stableSourceIds: [rerouteTarget.id],
          createdWorkingIds: [],
          createdDerivedIds: []
        },
        expected: {
          connectionOccurrenceId: rerouteTarget.id,
          previousRoute: rerouteTarget.route,
          newRoute
        }
      },
      `4. [route] ${rerouteTarget.id}: route -> [${newRoute.map((p) => `(${p.x},${p.y})`).join(', ')}]`
    )
  } else {
    recordSkipped(
      'route',
      'Reroute a connection',
      `model ${model.id} has no connection occurrences`
    )
  }

  // 5. Add a core connection.
  if (coreConnectionPair) {
    const definitionId = findOrCreateConnectionDefinition(
      coreConnectionPair.source.definitionId,
      coreConnectionPair.target.definitionId,
      coreConnectionPair.connectionType
    )
    const workingId = `phase17.corecxn.${editSeq + 1}`
    const command = apply(
      createConnectionOccurrenceCommand(ctx(), {
        connectionOccurrenceId: workingId,
        definitionId,
        modelId: model.id,
        sourceOccurrenceId: coreConnectionPair.source.id,
        targetOccurrenceId: coreConnectionPair.target.id
      })
    )
    record(
      {
        category: 'core-connection',
        description: `Add a connection ${coreConnectionPair.source.id} -> ${coreConnectionPair.target.id}`,
        commandKind: command.kind,
        skipped: false,
        skipReason: null,
        targets: {
          modelId: model.id,
          stableSourceIds: [coreConnectionPair.source.id, coreConnectionPair.target.id],
          createdWorkingIds: [workingId],
          createdDerivedIds: []
        },
        expected: {
          modelId: model.id,
          sourceOccurrenceId: coreConnectionPair.source.id,
          targetOccurrenceId: coreConnectionPair.target.id,
          connectionType: coreConnectionPair.connectionType,
          connectionDefinitionId: definitionId
        }
      },
      `5. [core-connection] new ${coreConnectionPair.connectionType} connection: ` +
        `${coreConnectionPair.source.id} -> ${coreConnectionPair.target.id}`
    )
  } else {
    recordSkipped(
      'core-connection',
      'Add a core connection',
      `no unconnected control-flow pair with a known connection type was found in model ${model.id}`
    )
  }

  // 6. Add an XOR return edge.
  if (xorReturnPair) {
    const definitionId = findOrCreateConnectionDefinition(
      xorReturnPair.source.definitionId,
      xorReturnPair.target.definitionId,
      xorReturnPair.connectionType
    )
    const workingId = `phase17.xorreturn.${editSeq + 1}`
    const command = apply(
      createConnectionOccurrenceCommand(ctx(), {
        connectionOccurrenceId: workingId,
        definitionId,
        modelId: model.id,
        sourceOccurrenceId: xorReturnPair.source.id,
        targetOccurrenceId: xorReturnPair.target.id
      })
    )
    record(
      {
        category: 'xor-return',
        description: `Add an XOR return edge ${xorReturnPair.source.id} -> ${xorReturnPair.target.id}`,
        commandKind: command.kind,
        skipped: false,
        skipReason: null,
        targets: {
          modelId: model.id,
          stableSourceIds: [xorReturnPair.source.id, xorReturnPair.target.id],
          createdWorkingIds: [workingId],
          createdDerivedIds: []
        },
        expected: {
          modelId: model.id,
          xorOccurrenceId: xorReturnPair.source.id,
          sourceOccurrenceId: xorReturnPair.source.id,
          targetOccurrenceId: xorReturnPair.target.id,
          connectionType: xorReturnPair.connectionType,
          connectionDefinitionId: definitionId,
          connectionTypeIsFallback: xorReturnPair.fallback
        }
      },
      `6. [xor-return] new ${xorReturnPair.connectionType} return edge: ` +
        `${xorReturnPair.source.id} (XOR) -> ${xorReturnPair.target.id}`
    )
  } else {
    recordSkipped(
      'xor-return',
      'Add an XOR return edge',
      `model ${model.id} has no XOR rule occurrence, or every reachable ancestor is already targeted`
    )
  }

  // 7. Add a satellite object.
  if (satelliteSource) {
    const satelliteType =
      original.objectDefinitions.get(satelliteSource.definitionId)?.type ?? 'OT_UNKNOWN'
    const anchorType = objectTypeOf.get(anchorOccurrence.id) ?? 'OT_UNKNOWN'
    const forward = resolveConnectionType(model.type, satelliteType, anchorType)
    const reverse = resolveConnectionType(model.type, anchorType, satelliteType)
    const linkForward = !forward.fallback || reverse.fallback
    const link = linkForward
      ? {
          from: satelliteSource.definitionId,
          to: anchorDefinition.id,
          type: forward.connectionType,
          satelliteIsSource: true
        }
      : {
          from: anchorDefinition.id,
          to: satelliteSource.definitionId,
          type: reverse.connectionType,
          satelliteIsSource: false
        }

    const occurrenceWorkingId = `phase17.satellite.${editSeq + 1}`
    const bounds = {
      x: anchorOccurrence.bounds.x + anchorOccurrence.bounds.width + SATELLITE_OFFSET.dx,
      y: anchorOccurrence.bounds.y + SATELLITE_OFFSET.dy,
      width: satelliteSource.bounds.width,
      height: satelliteSource.bounds.height
    }
    apply(
      createOccurrenceCommand(ctx(), {
        occurrenceId: occurrenceWorkingId,
        definitionId: satelliteSource.definitionId,
        modelId: model.id,
        symbolNum: satelliteSource.symbol,
        bounds
      })
    )
    const connectionDefinitionId = findOrCreateConnectionDefinition(link.from, link.to, link.type)
    const connectionWorkingId = `phase17.satellitecxn.${editSeq + 1}`
    apply(
      createConnectionOccurrenceCommand(ctx(), {
        connectionOccurrenceId: connectionWorkingId,
        definitionId: connectionDefinitionId,
        modelId: model.id,
        sourceOccurrenceId: link.satelliteIsSource ? occurrenceWorkingId : anchorOccurrence.id,
        targetOccurrenceId: link.satelliteIsSource ? anchorOccurrence.id : occurrenceWorkingId
      })
    )
    record(
      {
        category: 'satellite',
        description: `Add a satellite object (${satelliteType}, reusing definition ${satelliteSource.definitionId}), linked to ${anchorOccurrence.id}`,
        commandKind: 'createOccurrence',
        skipped: false,
        skipReason: null,
        targets: {
          modelId: model.id,
          stableSourceIds: [satelliteSource.definitionId, anchorOccurrence.id],
          createdWorkingIds: [occurrenceWorkingId, connectionWorkingId],
          createdDerivedIds: []
        },
        expected: {
          modelId: model.id,
          definitionId: satelliteSource.definitionId,
          objectType: satelliteType,
          bounds,
          link: {
            connectionType: link.type,
            connectionDefinitionId,
            sourceOccurrenceWorkingId: link.satelliteIsSource
              ? occurrenceWorkingId
              : anchorOccurrence.id,
            targetOccurrenceWorkingId: link.satelliteIsSource
              ? anchorOccurrence.id
              : occurrenceWorkingId
          }
        }
      },
      `7. [satellite] new ${satelliteType} occurrence at (${bounds.x}, ${bounds.y}), linked to ${anchorOccurrence.id} ` +
        `via ${link.type}`
    )
  } else {
    recordSkipped(
      'satellite',
      'Add a satellite object',
      'no satellite-type object definition (plan §11.3) exists anywhere in the golden document to reuse'
    )
  }

  // 8. Set an assignment.
  if (assignmentModelId) {
    const command = apply(
      setModelAssignmentCommand(ctx(), assignmentDefinition, assignmentModelId, 'add')
    )
    record(
      {
        category: 'assignment',
        description: `Link object definition ${assignmentDefinition} to model ${assignmentModelId}`,
        commandKind: command.kind,
        skipped: false,
        skipReason: null,
        targets: {
          modelId: model.id,
          stableSourceIds: [assignmentDefinition, assignmentModelId],
          createdWorkingIds: [],
          createdDerivedIds: []
        },
        expected: {
          objectDefinitionId: assignmentDefinition,
          linkedModelId: assignmentModelId,
          action: 'add'
        }
      },
      `8. [assignment] ${assignmentDefinition}: linked to model ${assignmentModelId}`
    )
  } else {
    recordSkipped(
      'assignment',
      'Set an assignment',
      'no other model exists in the document (or the candidate definition is already linked to every other model)'
    )
  }

  // 9. Add/modify an attachment reference.
  {
    const dataBase64 = Buffer.from(ATTACHMENT_CONTENT, 'utf8').toString('base64')
    const attachment: ArisAttachment = {
      id: ATTACHMENT_ID,
      fileName: ATTACHMENT_FILE_NAME,
      mimeType: ATTACHMENT_MIME_TYPE,
      size: Buffer.byteLength(ATTACHMENT_CONTENT, 'utf8'),
      dataBase64
    }
    const command = apply(addAttachmentCommand(ctx(), doc, anchorDefinition.id, attachment))
    record(
      {
        category: 'attachment',
        description: `Add an attachment reference to object definition ${anchorDefinition.id}`,
        commandKind: command.kind,
        skipped: false,
        skipReason: null,
        targets: {
          modelId: model.id,
          stableSourceIds: [anchorDefinition.id],
          createdWorkingIds: [],
          createdDerivedIds: []
        },
        expected: { definitionId: anchorDefinition.id, attachment }
      },
      `9. [attachment] ${anchorDefinition.id}: attachment "${ATTACHMENT_FILE_NAME}" (${attachment.size} bytes)`
    )
  }

  // --- validate + export -----------------------------------------------------

  const preview = prepareArisDerivedExport({ originalText: pkg.text, original, live: doc })

  if (!preview.result.validation.ok) {
    console.error('')
    console.error('The derived export failed plan §9.3 validation; nothing was written to disk.')
    for (const check of preview.result.validation.checks) {
      if (!check.passed) console.error(`  FAIL ${check.check}`)
    }
    for (const issue of preview.result.validation.issues) {
      console.error(`  issue: ${issue.message}`)
    }
    if (preview.unmapped.length > 0) {
      console.error('unmapped edits:')
      for (const entry of preview.unmapped) console.error(`  ${entry.sourceId}: ${entry.reason}`)
    }
    process.exitCode = 1
    return
  }

  mkdirSync(dirname(outPath), { recursive: true })
  assertGitIgnored(outPath)
  writeFileSync(outPath, preview.result.bytes)

  // --- resolve the real ids new records received on export ------------------

  const derivedPkg = await createArisXmlSourcePackage({
    name: basename(outPath),
    relPath: null,
    bytes: preview.result.bytes
  })
  const derivedStudio = buildArisStudioDocument(derivedPkg)

  function resolveOccurrenceId(
    modelId: string,
    definitionId: string,
    bounds: {
      readonly x: number
      readonly y: number
      readonly width: number
      readonly height: number
    }
  ): string | null {
    const derivedModel = derivedStudio.source.models.get(modelId)
    if (!derivedModel) return null
    const match = derivedModel.occurrences.find(
      (occurrence) =>
        occurrence.definitionId === definitionId &&
        occurrence.bounds.x === bounds.x &&
        occurrence.bounds.y === bounds.y &&
        occurrence.bounds.width === bounds.width &&
        occurrence.bounds.height === bounds.height
    )
    return match ? match.id : null
  }
  function resolveConnectionOccurrenceId(
    modelId: string,
    sourceOccurrenceId: string,
    targetOccurrenceId: string
  ): string | null {
    const derivedModel = derivedStudio.source.models.get(modelId)
    if (!derivedModel) return null
    const match = derivedModel.connectionOccurrences.find(
      (connection) =>
        connection.sourceOccurrenceId === sourceOccurrenceId &&
        connection.targetOccurrenceId === targetOccurrenceId
    )
    return match ? match.id : null
  }

  const resolvedManifestEntries: ManifestEditEntry[] = manifestEntries.map((entry) => {
    if (entry.skipped || entry.targets.createdWorkingIds.length === 0) return entry
    const resolved: string[] = []
    if (entry.category === 'core-connection' || entry.category === 'xor-return') {
      const expected = entry.expected as {
        sourceOccurrenceId: string
        targetOccurrenceId: string
        modelId: string
      }
      const id = resolveConnectionOccurrenceId(
        expected.modelId,
        expected.sourceOccurrenceId,
        expected.targetOccurrenceId
      )
      if (id) resolved.push(id)
    } else if (entry.category === 'satellite') {
      const expected = entry.expected as {
        modelId: string
        definitionId: string
        bounds: { x: number; y: number; width: number; height: number }
        link: { sourceOccurrenceWorkingId: string; targetOccurrenceWorkingId: string }
      }
      const occurrenceId = resolveOccurrenceId(
        expected.modelId,
        expected.definitionId,
        expected.bounds
      )
      if (occurrenceId) {
        resolved.push(occurrenceId)
        const sourceId =
          expected.link.sourceOccurrenceWorkingId === entry.targets.createdWorkingIds[0]
            ? occurrenceId
            : anchorOccurrence.id
        const targetId =
          expected.link.targetOccurrenceWorkingId === entry.targets.createdWorkingIds[0]
            ? occurrenceId
            : anchorOccurrence.id
        const connectionId = resolveConnectionOccurrenceId(expected.modelId, sourceId, targetId)
        if (connectionId) resolved.push(connectionId)
      }
    }
    return { ...entry, targets: { ...entry.targets, createdDerivedIds: resolved } }
  })

  const manifest = {
    schemaVersion: 1,
    gate: 'orbitpm-aris-reexport-prep',
    planSection: '20.3',
    generatedAt: new Date().toISOString(),
    goldenAml: { path: amlPath, sha256: pkg.sha256, bytes: amlBytes.byteLength },
    derivedAml: {
      path: outPath,
      sha256: derivedPkg.sha256,
      bytes: preview.result.bytes.byteLength
    },
    modelId: model.id,
    modelType: model.type,
    localeId,
    editCount: preview.editCount,
    unmapped: preview.unmapped,
    validation: preview.result.validation,
    edits: resolvedManifestEntries
  }
  mkdirSync(dirname(manifestPath), { recursive: true })
  assertGitIgnored(manifestPath)
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')

  // --- console summary --------------------------------------------------------

  console.log('')
  console.log('ARIS re-export preparation — plan §20.3 steps 1-3')
  console.log(`golden AML  ${amlPath} (sha256 ${pkg.sha256})`)
  console.log(`model       ${model.id} (${model.type}, ${model.occurrences.length} objects)`)
  console.log(`locale      ${localeId}`)
  console.log('')
  console.log('changes made:')
  for (const line of printedChanges) console.log(`  ${line}`)
  console.log('')
  console.log(
    `export: ${preview.editCount} byte-addressed edit(s), ${preview.unmapped.length} unmapped, ` +
      `${preview.result.validation.checks.filter((c) => c.passed).length}/${preview.result.validation.checks.length} §9.3 checks passed`
  )
  console.log(`derived AML written to ${outPath}`)
  console.log(`manifest written to ${manifestPath}`)
  console.log('')
  console.log('Next (plan §20.3 steps 4-6, manual):')
  console.log(`  1. Import ${basename(outPath)} into the target ARIS installation.`)
  console.log('  2. Confirm no fatal import rejection.')
  console.log('  3. Re-export from ARIS, then run:')
  console.log(
    `       npm run test:aris:reexport-compare -- ${outPath} <path-to-aris-reexported.aml> --manifest=${manifestPath}`
  )

  const skippedCount = manifestEntries.filter((entry) => entry.skipped).length
  if (skippedCount > 0) {
    console.log('')
    console.log(
      `${skippedCount} of 9 representative edit(s) were skipped (see skipReason above) — the golden ` +
        'document did not offer a suitable target for them. The remaining edits still produced a ' +
        'valid derived export.'
    )
  }
}

await main()
