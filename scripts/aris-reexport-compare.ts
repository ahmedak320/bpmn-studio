/**
 * ARIS re-export comparison — plan §20.3 steps 7-8 (Phase 17).
 *
 * After a human imports the derived AML from `scripts/aris-reexport-prep.ts` into a real ARIS
 * installation and re-exports it (§20.3 steps 4-6, which need a live ARIS and cannot run here),
 * this script does the comparison §20.3 step 7 asks for — definitions, occurrences, connections,
 * IDs, attributes, linked models, geometry, and attachments — between the file that went INTO
 * ARIS (the derived AML) and the file that came back OUT (the re-exported AML), and reports
 * whether the nine intended edits made it through and whether anything else moved (§20.3 step 8).
 *
 * ## Why two kinds of matching
 *
 * Records that already existed in the golden AML keep their id through a real ARIS round trip, so
 * they are matched by id. Records this repo's writer created fresh (the new satellite occurrence,
 * the new core connection, the new XOR return connection) got a locally-allocated ARIS-style id at
 * export time that ARIS's own database has never seen — whether ARIS preserves that id or mints
 * its own on import is exactly the live-ARIS behavior §20.3 exists to observe, not something this
 * repository can predict. So for those, this script first tries the id the prep script's manifest
 * recorded (`createdDerivedIds`), and falls back to matching by stable endpoint pair (for
 * connections) or by definition + approximate position (for the satellite occurrence), always
 * reporting which method matched so the confidence level is never hidden.
 *
 * ## "Unintended semantic loss" (§20.3 step 8, "should be zero")
 *
 * Every difference between the derived and re-exported documents is listed under `recordDiffs`,
 * independent of the manifest — nothing is filtered out before it reaches the report. Each entry
 * is then tagged `explainedByIntendedEdit` when its id was the target of a manifest edit whose own
 * confirmation (above) succeeded. `summary.unintendedSemanticLoss` counts the `removed`/`changed`
 * entries left unexplained — the number plan §20.3 step 8 says should be zero.
 *
 * ## Usage
 *
 * ```sh
 * npm run test:aris:reexport-compare -- <derived.aml> <reexported.aml>
 * npm run test:aris:reexport-compare -- <derived.aml> <reexported.aml> --manifest=<path.json> --out=<report.json>
 * ```
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  listAttachments,
  type ArisAttachment as ArisFileAttachment
} from '../src/aris/canvas/attachments'
import { findConnectionOccurrence, findOccurrence } from '../src/aris/canvas/commandFactory'
import type {
  ArisAttachment as ArisOleAttachment,
  ArisAttribute,
  ArisConnectionDefinition,
  ArisConnectionOccurrence,
  ArisFreeText,
  ArisLane,
  ArisLocalizedValue,
  ArisObjectDefinition,
  ArisObjectOccurrence,
  ArisPoint,
  ArisWorkingDocument
} from '../src/aris/model/types'
import { buildArisStudioDocument } from '../src/aris/shell/arisStudioDocument'
import { createArisXmlSourcePackage } from '../src/aris/source/sourcePackage'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')

/** AML-to-AML geometry is compared exactly by default: both files are integer ARIS units, not
 *  pixels, so §20.2's 2px/3px visual tolerances do not apply here. Loosen with --geometry-tolerance
 *  once a real ARIS round trip shows it snaps or nudges coordinates. */
const DEFAULT_GEOMETRY_TOLERANCE = 0
/** Search radius (AML units) used only as a last-resort fallback to find the satellite occurrence
 *  by definition + position when its id did not survive the round trip. */
const SATELLITE_BOUNDS_FALLBACK_TOLERANCE = 50

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
      'Usage: npm run test:aris:reexport-compare -- <derived.aml> <reexported.aml> [options]',
      '',
      'Required:',
      '  <derived.aml>     The AML scripts/aris-reexport-prep.ts wrote and that was imported into ARIS.',
      '  <reexported.aml>  What ARIS produced when that import was re-exported (plan §20.3 step 6).',
      '',
      'Options:',
      '  --manifest=<path.json>       The edit manifest scripts/aris-reexport-prep.ts wrote. Defaults',
      '                               to <derived.aml> with its extension replaced by .manifest.json.',
      '  --geometry-tolerance=<n>     AML-unit tolerance for move/route confirmation (default 0 — an',
      '                               AML-to-AML comparison has no rendering step, so an exact match',
      '                               is the honest default until a real ARIS round trip says otherwise).',
      '  --out=<path.json>            Where to write the structured report. Defaults to',
      '                               local-evidence/aris-phase17/reexport-compare.json (git-ignored).',
      '',
      'Output is written only to a git-ignored path: both inputs are private customer data.'
    ].join('\n')
  )
}

const { positionals, flags } = parseArgs(process.argv.slice(2))
if (positionals.length < 2) {
  printUsage()
  process.exit(1)
}

const abs = (value: string): string => (isAbsolute(value) ? value : resolve(REPO, value))
const derivedPath = abs(positionals[0] as string)
const reexportedPath = abs(positionals[1] as string)
if (!existsSync(derivedPath)) {
  console.error(`Derived AML not found at ${derivedPath}.`)
  process.exit(1)
}
if (!existsSync(reexportedPath)) {
  console.error(`Re-exported AML not found at ${reexportedPath}.`)
  process.exit(1)
}
function manifestPathFor(derivedFilePath: string): string {
  const dot = derivedFilePath.lastIndexOf('.')
  return dot <= 0
    ? `${derivedFilePath}.manifest.json`
    : `${derivedFilePath.slice(0, dot)}.manifest.json`
}
const manifestPath = abs(flags.get('manifest') ?? manifestPathFor(derivedPath))
const geometryTolerance = Number(flags.get('geometry-tolerance') ?? DEFAULT_GEOMETRY_TOLERANCE)
const outPath = abs(flags.get('out') ?? 'local-evidence/aris-phase17/reexport-compare.json')

function assertGitIgnored(path: string): void {
  try {
    execFileSync('git', ['check-ignore', '-q', '--', path], { cwd: REPO, stdio: 'ignore' })
  } catch {
    throw new Error(
      `Refusing to write ${path}: it is not git-ignored. A re-export comparison report is derived ` +
        'from private customer data and must never enter the repository.'
    )
  }
}

// ---------------------------------------------------------------------------
// Manifest shape — must match what scripts/aris-reexport-prep.ts writes
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
    readonly stableSourceIds: readonly string[]
    readonly createdWorkingIds: readonly string[]
    readonly createdDerivedIds: readonly string[]
  }
  readonly expected: Readonly<Record<string, unknown>>
}

interface Manifest {
  readonly modelId: string
  readonly edits: readonly ManifestEditEntry[]
}

function loadManifest(path: string): Manifest | null {
  if (!existsSync(path)) return null
  return JSON.parse(readFileSync(path, 'utf8')) as Manifest
}

// ---------------------------------------------------------------------------
// Generic field-level diffing
// ---------------------------------------------------------------------------

interface FieldDiff {
  readonly field: string
  readonly before: unknown
  readonly after: unknown
}

function diffLocalizedValues(before: ArisLocalizedValue, after: ArisLocalizedValue): FieldDiff[] {
  const diffs: FieldDiff[] = []
  const keys = new Set([...Object.keys(before.values), ...Object.keys(after.values)])
  for (const key of keys) {
    const beforeValue = before.values[key] ?? null
    const afterValue = after.values[key] ?? null
    if (beforeValue !== afterValue)
      diffs.push({ field: `names.${key}`, before: beforeValue, after: afterValue })
  }
  return diffs
}

function sortedAttributeValueKey(attribute: ArisAttribute | undefined): string {
  if (!attribute) return ''
  return JSON.stringify(
    [...attribute.values]
      .map((v) => [v.localeId, v.text] as const)
      .sort(([a], [b]) => (a ?? '').localeCompare(b ?? ''))
  )
}

function diffAttributeLists(
  before: readonly ArisAttribute[],
  after: readonly ArisAttribute[]
): FieldDiff[] {
  const diffs: FieldDiff[] = []
  const beforeByType = new Map(before.map((attribute) => [attribute.type, attribute]))
  const afterByType = new Map(after.map((attribute) => [attribute.type, attribute]))
  const types = new Set([...beforeByType.keys(), ...afterByType.keys()])
  for (const type of types) {
    const beforeAttribute = beforeByType.get(type)
    const afterAttribute = afterByType.get(type)
    if (sortedAttributeValueKey(beforeAttribute) !== sortedAttributeValueKey(afterAttribute)) {
      diffs.push({
        field: `attributes.${type}`,
        before: beforeAttribute?.values ?? null,
        after: afterAttribute?.values ?? null
      })
    }
  }
  return diffs
}

function diffLinkedModels(before: readonly string[], after: readonly string[]): FieldDiff[] {
  const beforeSorted = [...before].sort()
  const afterSorted = [...after].sort()
  if (JSON.stringify(beforeSorted) === JSON.stringify(afterSorted)) return []
  return [{ field: 'linkedModelIds', before: beforeSorted, after: afterSorted }]
}

interface Bounds {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

function diffBounds(before: Bounds, after: Bounds, field = 'bounds', tolerance = 0): FieldDiff[] {
  const dx = Math.abs(before.x - after.x)
  const dy = Math.abs(before.y - after.y)
  const dw = Math.abs(before.width - after.width)
  const dh = Math.abs(before.height - after.height)
  if (dx <= tolerance && dy <= tolerance && dw <= tolerance && dh <= tolerance) return []
  return [{ field, before, after }]
}

function routesEqual(
  before: readonly ArisPoint[],
  after: readonly ArisPoint[],
  tolerance = 0
): boolean {
  if (before.length !== after.length) return false
  return before.every((point, index) => {
    const other = after[index] as ArisPoint
    return Math.abs(point.x - other.x) <= tolerance && Math.abs(point.y - other.y) <= tolerance
  })
}

function diffRoute(
  before: readonly ArisPoint[],
  after: readonly ArisPoint[],
  tolerance = 0
): FieldDiff[] {
  if (routesEqual(before, after, tolerance)) return []
  return [{ field: 'route', before, after }]
}

// ---------------------------------------------------------------------------
// Record-level diffing (§20.3 step 7: definitions, occurrences, connections, IDs, attributes,
// linked models, geometry, attachments)
// ---------------------------------------------------------------------------

type RecordKind =
  | 'model'
  | 'objectDefinition'
  | 'connectionDefinition'
  | 'objectOccurrence'
  | 'connectionOccurrence'
  | 'lane'
  | 'freeText'
  | 'attachment'

interface RecordDiff {
  readonly kind: 'removed' | 'added' | 'changed'
  readonly recordType: RecordKind
  readonly id: string
  readonly modelId: string | null
  readonly fields: readonly FieldDiff[]
  explainedByIntendedEdit: boolean
}

function diffById<T extends { readonly id: string }>(
  recordType: RecordKind,
  modelId: string | null,
  before: readonly T[],
  after: readonly T[],
  compare: (before: T, after: T) => FieldDiff[]
): RecordDiff[] {
  const beforeMap = new Map(before.map((entry) => [entry.id, entry]))
  const afterMap = new Map(after.map((entry) => [entry.id, entry]))
  const out: RecordDiff[] = []
  for (const [id, beforeEntry] of beforeMap) {
    const afterEntry = afterMap.get(id)
    if (!afterEntry) {
      out.push({
        kind: 'removed',
        recordType,
        id,
        modelId,
        fields: [],
        explainedByIntendedEdit: false
      })
      continue
    }
    const fields = compare(beforeEntry, afterEntry)
    if (fields.length > 0)
      out.push({ kind: 'changed', recordType, id, modelId, fields, explainedByIntendedEdit: false })
  }
  for (const id of afterMap.keys()) {
    if (!beforeMap.has(id))
      out.push({
        kind: 'added',
        recordType,
        id,
        modelId,
        fields: [],
        explainedByIntendedEdit: false
      })
  }
  return out
}

function buildRecordDiffs(
  derived: ArisWorkingDocument,
  reexported: ArisWorkingDocument,
  tolerance: number
): RecordDiff[] {
  const diffs: RecordDiff[] = []

  diffs.push(
    ...diffById<ArisObjectDefinition>(
      'objectDefinition',
      null,
      [...derived.objectDefinitions.values()],
      [...reexported.objectDefinitions.values()],
      (before, after) => [
        ...diffLocalizedValues(before.names, after.names),
        ...diffAttributeLists(before.attributes, after.attributes),
        ...diffLinkedModels(before.linkedModelIds, after.linkedModelIds),
        ...(before.type !== after.type
          ? [{ field: 'type', before: before.type, after: after.type }]
          : [])
      ]
    )
  )

  diffs.push(
    ...diffById<ArisConnectionDefinition>(
      'connectionDefinition',
      null,
      [...derived.connectionDefinitions.values()],
      [...reexported.connectionDefinitions.values()],
      (before, after) => [
        ...diffLocalizedValues(before.names, after.names),
        ...diffAttributeLists(before.attributes, after.attributes),
        ...(before.type !== after.type
          ? [{ field: 'type', before: before.type, after: after.type }]
          : []),
        ...(before.fromObjectDefinitionId !== after.fromObjectDefinitionId
          ? [
              {
                field: 'fromObjectDefinitionId',
                before: before.fromObjectDefinitionId,
                after: after.fromObjectDefinitionId
              }
            ]
          : []),
        ...(before.toObjectDefinitionId !== after.toObjectDefinitionId
          ? [
              {
                field: 'toObjectDefinitionId',
                before: before.toObjectDefinitionId,
                after: after.toObjectDefinitionId
              }
            ]
          : [])
      ]
    )
  )

  const derivedModelIds = new Set(derived.models.keys())
  const reexportedModelIds = new Set(reexported.models.keys())
  for (const modelId of derivedModelIds) {
    if (!reexportedModelIds.has(modelId)) {
      diffs.push({
        kind: 'removed',
        recordType: 'model',
        id: modelId,
        modelId,
        fields: [],
        explainedByIntendedEdit: false
      })
      continue
    }
    const before = derived.models.get(modelId) as NonNullable<ReturnType<typeof derived.models.get>>
    const after = reexported.models.get(modelId) as NonNullable<
      ReturnType<typeof reexported.models.get>
    >

    diffs.push(
      ...diffById<ArisObjectOccurrence>(
        'objectOccurrence',
        modelId,
        before.occurrences,
        after.occurrences,
        (b, a) => [
          ...diffBounds(b.bounds, a.bounds, 'bounds', tolerance),
          ...(b.definitionId !== a.definitionId
            ? [{ field: 'definitionId', before: b.definitionId, after: a.definitionId }]
            : []),
          ...(b.symbol !== a.symbol ? [{ field: 'symbol', before: b.symbol, after: a.symbol }] : [])
        ]
      )
    )
    diffs.push(
      ...diffById<ArisConnectionOccurrence>(
        'connectionOccurrence',
        modelId,
        before.connectionOccurrences,
        after.connectionOccurrences,
        (b, a) => [
          ...diffRoute(b.route, a.route, tolerance),
          ...(b.sourceOccurrenceId !== a.sourceOccurrenceId
            ? [
                {
                  field: 'sourceOccurrenceId',
                  before: b.sourceOccurrenceId,
                  after: a.sourceOccurrenceId
                }
              ]
            : []),
          ...(b.targetOccurrenceId !== a.targetOccurrenceId
            ? [
                {
                  field: 'targetOccurrenceId',
                  before: b.targetOccurrenceId,
                  after: a.targetOccurrenceId
                }
              ]
            : []),
          ...(b.definitionId !== a.definitionId
            ? [{ field: 'definitionId', before: b.definitionId, after: a.definitionId }]
            : [])
        ]
      )
    )
    diffs.push(
      ...diffById<ArisLane>('lane', modelId, before.lanes, after.lanes, (b, a) => [
        ...diffLocalizedValues(b.names, a.names),
        ...(b.orientation !== a.orientation
          ? [{ field: 'orientation', before: b.orientation, after: a.orientation }]
          : [])
      ])
    )
    diffs.push(
      ...diffById<ArisFreeText>('freeText', modelId, before.freeText, after.freeText, (b, a) => [
        ...diffLocalizedValues(b.text, a.text),
        ...diffBounds(b.bounds, a.bounds, 'bounds', tolerance)
      ])
    )
    diffs.push(
      ...diffById<ArisOleAttachment>(
        'attachment',
        modelId,
        before.attachments,
        after.attachments,
        (b, a) => [
          ...diffBounds(b.bounds, a.bounds, 'bounds', tolerance),
          ...(b.blobCount !== a.blobCount
            ? [{ field: 'blobCount', before: b.blobCount, after: a.blobCount }]
            : [])
        ]
      )
    )
  }
  for (const modelId of reexportedModelIds) {
    if (!derivedModelIds.has(modelId)) {
      diffs.push({
        kind: 'added',
        recordType: 'model',
        id: modelId,
        modelId,
        fields: [],
        explainedByIntendedEdit: false
      })
    }
  }

  return diffs
}

// ---------------------------------------------------------------------------
// Manifest-driven confirmation of the nine intended edits
// ---------------------------------------------------------------------------

type ConfirmationMethod = 'id' | 'endpoint-pair' | 'bounds-match' | 'not-applicable' | 'not-found'

interface ConfirmationResult {
  readonly index: number
  readonly category: string
  readonly description: string
  readonly confirmed: boolean
  readonly method: ConfirmationMethod
  readonly detail: string
  readonly touchedIds: readonly string[]
}

function findConnectionByEndpoints(
  document: ArisWorkingDocument,
  modelId: string,
  sourceOccurrenceId: string,
  targetOccurrenceId: string
): ArisConnectionOccurrence | null {
  const model = document.models.get(modelId)
  if (!model) return null
  return (
    model.connectionOccurrences.find(
      (connection) =>
        connection.sourceOccurrenceId === sourceOccurrenceId &&
        connection.targetOccurrenceId === targetOccurrenceId
    ) ?? null
  )
}

function findConnectionById(
  document: ArisWorkingDocument,
  modelId: string,
  id: string
): ArisConnectionOccurrence | null {
  const model = document.models.get(modelId)
  if (!model) return null
  return model.connectionOccurrences.find((connection) => connection.id === id) ?? null
}

function findOccurrenceById(
  document: ArisWorkingDocument,
  modelId: string,
  id: string
): ArisObjectOccurrence | null {
  const model = document.models.get(modelId)
  if (!model) return null
  return model.occurrences.find((occurrence) => occurrence.id === id) ?? null
}

function findOccurrenceByDefinitionNearBounds(
  document: ArisWorkingDocument,
  modelId: string,
  definitionId: string,
  bounds: Bounds,
  tolerance: number
): ArisObjectOccurrence | null {
  const model = document.models.get(modelId)
  if (!model) return null
  return (
    model.occurrences.find(
      (occurrence) =>
        occurrence.definitionId === definitionId &&
        Math.abs(occurrence.bounds.x - bounds.x) <= tolerance &&
        Math.abs(occurrence.bounds.y - bounds.y) <= tolerance
    ) ?? null
  )
}

function confirmEdit(
  entry: ManifestEditEntry,
  reexported: ArisWorkingDocument,
  tolerance: number
): ConfirmationResult {
  const base = { index: entry.index, category: entry.category, description: entry.description }

  if (entry.category === 'name') {
    const definitionId = entry.targets.stableSourceIds[0] as string
    const expected = entry.expected as { localeId: string; newValue: string }
    const definition = reexported.objectDefinitions.get(definitionId)
    if (!definition) {
      return {
        ...base,
        confirmed: false,
        method: 'not-found',
        detail: `object definition ${definitionId} is missing`,
        touchedIds: [definitionId]
      }
    }
    const value = definition.names.values[expected.localeId] ?? null
    const confirmed = value === expected.newValue
    return {
      ...base,
      confirmed,
      method: 'id',
      detail: confirmed
        ? 'name matches'
        : `expected "${expected.newValue}", found ${JSON.stringify(value)}`,
      touchedIds: [definitionId]
    }
  }

  if (entry.category === 'attribute') {
    const definitionId = entry.targets.stableSourceIds[0] as string
    const expected = entry.expected as { attributeType: string; localeId: string; value: string }
    const definition = reexported.objectDefinitions.get(definitionId)
    if (!definition) {
      return {
        ...base,
        confirmed: false,
        method: 'not-found',
        detail: `object definition ${definitionId} is missing`,
        touchedIds: [definitionId]
      }
    }
    const attribute = definition.attributes.find(
      (candidate) => candidate.type === expected.attributeType
    )
    const found = attribute?.values.find((value) => value.localeId === expected.localeId)
    const confirmed = found?.text === expected.value
    return {
      ...base,
      confirmed,
      method: 'id',
      detail: confirmed
        ? 'attribute value matches'
        : `expected "${expected.value}", found ${JSON.stringify(found?.text ?? null)}`,
      touchedIds: [definitionId]
    }
  }

  if (entry.category === 'geometry') {
    const occurrenceId = entry.targets.stableSourceIds[0] as string
    const expected = entry.expected as { next: { x: number; y: number } }
    const occurrence = findOccurrence(reexported, occurrenceId)
    if (!occurrence) {
      return {
        ...base,
        confirmed: false,
        method: 'not-found',
        detail: `occurrence ${occurrenceId} is missing`,
        touchedIds: [occurrenceId]
      }
    }
    const confirmed =
      Math.abs(occurrence.bounds.x - expected.next.x) <= tolerance &&
      Math.abs(occurrence.bounds.y - expected.next.y) <= tolerance
    return {
      ...base,
      confirmed,
      method: 'id',
      detail: confirmed
        ? 'position matches'
        : `expected (${expected.next.x}, ${expected.next.y}), found (${occurrence.bounds.x}, ${occurrence.bounds.y})`,
      touchedIds: [occurrenceId]
    }
  }

  if (entry.category === 'route') {
    const connectionId = entry.targets.stableSourceIds[0] as string
    const expected = entry.expected as { newRoute: readonly ArisPoint[] }
    const connection = findConnectionOccurrence(reexported, connectionId)
    if (!connection) {
      return {
        ...base,
        confirmed: false,
        method: 'not-found',
        detail: `connection occurrence ${connectionId} is missing`,
        touchedIds: [connectionId]
      }
    }
    const confirmed = routesEqual(connection.route, expected.newRoute, tolerance)
    return {
      ...base,
      confirmed,
      method: 'id',
      detail: confirmed
        ? 'route matches'
        : `expected ${JSON.stringify(expected.newRoute)}, found ${JSON.stringify(connection.route)}`,
      touchedIds: [connectionId]
    }
  }

  if (entry.category === 'core-connection' || entry.category === 'xor-return') {
    const expected = entry.expected as {
      modelId: string
      sourceOccurrenceId: string
      targetOccurrenceId: string
      connectionType: string
    }
    const derivedId = entry.targets.createdDerivedIds[0] ?? null
    let connection = derivedId ? findConnectionById(reexported, expected.modelId, derivedId) : null
    let method: ConfirmationMethod = connection ? 'id' : 'not-found'
    if (!connection) {
      connection = findConnectionByEndpoints(
        reexported,
        expected.modelId,
        expected.sourceOccurrenceId,
        expected.targetOccurrenceId
      )
      if (connection) method = 'endpoint-pair'
    }
    const confirmed = connection !== null
    return {
      ...base,
      confirmed,
      method,
      detail: confirmed
        ? `found via ${method}${connection && connection.id !== derivedId ? ` (id changed: ${derivedId} -> ${connection.id})` : ''}`
        : `no connection ${expected.sourceOccurrenceId} -> ${expected.targetOccurrenceId} in model ${expected.modelId}`,
      touchedIds: [
        expected.sourceOccurrenceId,
        expected.targetOccurrenceId,
        ...(connection ? [connection.id] : [])
      ]
    }
  }

  if (entry.category === 'satellite') {
    const expected = entry.expected as {
      modelId: string
      definitionId: string
      bounds: Bounds
      link: { sourceOccurrenceWorkingId: string; targetOccurrenceWorkingId: string }
    }
    const derivedOccurrenceId = entry.targets.createdDerivedIds[0] ?? null
    let occurrence = derivedOccurrenceId
      ? findOccurrenceById(reexported, expected.modelId, derivedOccurrenceId)
      : null
    let method: ConfirmationMethod = occurrence ? 'id' : 'not-found'
    if (!occurrence) {
      occurrence = findOccurrenceByDefinitionNearBounds(
        reexported,
        expected.modelId,
        expected.definitionId,
        expected.bounds,
        SATELLITE_BOUNDS_FALLBACK_TOLERANCE
      )
      if (occurrence) method = 'bounds-match'
    }
    const connectionDerivedId = entry.targets.createdDerivedIds[1] ?? null
    const connectionStillPresent = occurrence
      ? connectionDerivedId
        ? findConnectionById(reexported, expected.modelId, connectionDerivedId) !== null
        : reexported.models
            .get(expected.modelId)
            ?.connectionOccurrences.some(
              (connection) =>
                connection.sourceOccurrenceId === occurrence?.id ||
                connection.targetOccurrenceId === occurrence?.id
            ) === true
      : false
    const confirmed = occurrence !== null
    return {
      ...base,
      confirmed,
      method,
      detail: confirmed
        ? `occurrence found via ${method}${occurrence && occurrence.id !== derivedOccurrenceId ? ` (id changed: ${derivedOccurrenceId} -> ${occurrence.id})` : ''}; link ${connectionStillPresent ? 'present' : 'MISSING'}`
        : `no occurrence of definition ${expected.definitionId} near (${expected.bounds.x}, ${expected.bounds.y}) in model ${expected.modelId}`,
      touchedIds: occurrence ? [occurrence.id] : []
    }
  }

  if (entry.category === 'assignment') {
    const expected = entry.expected as { objectDefinitionId: string; linkedModelId: string }
    const definition = reexported.objectDefinitions.get(expected.objectDefinitionId)
    if (!definition) {
      return {
        ...base,
        confirmed: false,
        method: 'not-found',
        detail: `object definition ${expected.objectDefinitionId} is missing`,
        touchedIds: [expected.objectDefinitionId]
      }
    }
    const confirmed = definition.linkedModelIds.includes(expected.linkedModelId)
    return {
      ...base,
      confirmed,
      method: 'id',
      detail: confirmed
        ? 'linked model present'
        : `linkedModelIds does not include ${expected.linkedModelId}`,
      touchedIds: [expected.objectDefinitionId]
    }
  }

  if (entry.category === 'attachment') {
    const expected = entry.expected as { definitionId: string; attachment: ArisFileAttachment }
    if (!reexported.objectDefinitions.has(expected.definitionId)) {
      return {
        ...base,
        confirmed: false,
        method: 'not-found',
        detail: `object definition ${expected.definitionId} is missing`,
        touchedIds: [expected.definitionId]
      }
    }
    const attachments = listAttachments(reexported, expected.definitionId)
    const found = attachments.find((candidate) => candidate.id === expected.attachment.id)
    const confirmed =
      found !== undefined &&
      found.fileName === expected.attachment.fileName &&
      found.mimeType === expected.attachment.mimeType &&
      found.size === expected.attachment.size &&
      found.dataBase64 === expected.attachment.dataBase64
    return {
      ...base,
      confirmed,
      method: found ? 'id' : 'not-found',
      detail: confirmed
        ? 'attachment matches byte-for-byte'
        : found
          ? 'attachment present but content differs'
          : 'attachment missing',
      touchedIds: [expected.definitionId]
    }
  }

  return {
    ...base,
    confirmed: false,
    method: 'not-applicable',
    detail: `unrecognized category "${entry.category}"`,
    touchedIds: []
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const derivedBytes = new Uint8Array(readFileSync(derivedPath))
  const reexportedBytes = new Uint8Array(readFileSync(reexportedPath))

  const derivedPkg = await createArisXmlSourcePackage({
    name: basename(derivedPath),
    relPath: null,
    bytes: derivedBytes
  })
  const reexportedPkg = await createArisXmlSourcePackage({
    name: basename(reexportedPath),
    relPath: null,
    bytes: reexportedBytes
  })
  const derivedStudio = buildArisStudioDocument(derivedPkg)
  const reexportedStudio = buildArisStudioDocument(reexportedPkg)

  const manifest = loadManifest(manifestPath)

  const recordDiffs = buildRecordDiffs(
    derivedStudio.source,
    reexportedStudio.source,
    geometryTolerance
  )

  const confirmations: ConfirmationResult[] = []
  if (manifest) {
    for (const entry of manifest.edits) {
      if (entry.skipped) continue
      confirmations.push(confirmEdit(entry, reexportedStudio.source, geometryTolerance))
    }
  }

  const explainedIds = new Set<string>()
  for (const confirmation of confirmations) {
    if (confirmation.confirmed) for (const id of confirmation.touchedIds) explainedIds.add(id)
  }
  for (const diff of recordDiffs) {
    if (explainedIds.has(diff.id)) diff.explainedByIntendedEdit = true
  }

  const unintendedFindings = recordDiffs.filter(
    (diff) => diff.kind !== 'added' && !diff.explainedByIntendedEdit
  )
  const unexpectedAdditions = recordDiffs.filter((diff) => diff.kind === 'added')
  const confirmedCount = confirmations.filter((c) => c.confirmed).length
  const skippedEdits = manifest ? manifest.edits.filter((e) => e.skipped) : []

  const idComparisonByType = (
    recordType: RecordKind
  ): { removed: number; added: number; changed: number } => {
    const scoped = recordDiffs.filter((diff) => diff.recordType === recordType)
    return {
      removed: scoped.filter((d) => d.kind === 'removed').length,
      added: scoped.filter((d) => d.kind === 'added').length,
      changed: scoped.filter((d) => d.kind === 'changed').length
    }
  }

  const report = {
    schemaVersion: 1,
    gate: 'orbitpm-aris-reexport-compare',
    planSection: '20.3',
    generatedAt: new Date().toISOString(),
    derivedAml: { path: derivedPath, sha256: derivedPkg.sha256, bytes: derivedBytes.byteLength },
    reexportedAml: {
      path: reexportedPath,
      sha256: reexportedPkg.sha256,
      bytes: reexportedBytes.byteLength
    },
    manifestPath: manifest ? manifestPath : null,
    geometryToleranceAmlUnits: geometryTolerance,
    idComparison: {
      objectDefinitions: idComparisonByType('objectDefinition'),
      connectionDefinitions: idComparisonByType('connectionDefinition'),
      objectOccurrences: idComparisonByType('objectOccurrence'),
      connectionOccurrences: idComparisonByType('connectionOccurrence'),
      lanes: idComparisonByType('lane'),
      freeText: idComparisonByType('freeText'),
      attachments: idComparisonByType('attachment'),
      models: idComparisonByType('model')
    },
    recordDiffs,
    intendedChanges: {
      totalEdits: manifest ? manifest.edits.length : 0,
      skippedByPrep: skippedEdits.length,
      checked: confirmations.length,
      confirmed: confirmedCount,
      confirmations
    },
    summary: {
      unintendedSemanticLoss: unintendedFindings.length,
      unexpectedAdditions: unexpectedAdditions.length,
      allIntendedChangesConfirmed:
        manifest !== null && confirmations.length > 0 && confirmedCount === confirmations.length
    },
    unintendedFindings,
    unexpectedAdditions
  }

  mkdirSync(dirname(outPath), { recursive: true })
  assertGitIgnored(outPath)
  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')

  // --- console summary -------------------------------------------------------

  console.log('')
  console.log('ARIS re-export comparison — plan §20.3 steps 7-8')
  console.log(`derived     ${derivedPath} (sha256 ${derivedPkg.sha256})`)
  console.log(`re-exported ${reexportedPath} (sha256 ${reexportedPkg.sha256})`)
  console.log(
    `manifest    ${manifest ? manifestPath : 'not found — intended-change confirmation skipped'}`
  )
  console.log('')
  if (manifest) {
    console.log(
      `intended changes: ${confirmedCount}/${confirmations.length} confirmed (${skippedEdits.length} skipped by prep)`
    )
    for (const confirmation of confirmations) {
      console.log(
        `  ${confirmation.confirmed ? 'OK  ' : 'FAIL'} #${confirmation.index} [${confirmation.category}] ` +
          `(${confirmation.method}) ${confirmation.detail}`
      )
    }
  }
  console.log('')
  console.log('record diffs by type (removed / added / changed):')
  for (const recordType of [
    'objectDefinition',
    'connectionDefinition',
    'objectOccurrence',
    'connectionOccurrence',
    'lane',
    'freeText',
    'attachment',
    'model'
  ] as const) {
    const counts = idComparisonByType(recordType)
    if (counts.removed === 0 && counts.added === 0 && counts.changed === 0) continue
    console.log(
      `  ${recordType}: removed=${counts.removed} added=${counts.added} changed=${counts.changed}`
    )
  }
  console.log('')
  console.log(
    `unintended semantic loss: ${unintendedFindings.length} (plan §20.3 step 8 target: 0)`
  )
  for (const finding of unintendedFindings) {
    const fieldSummary = finding.fields.map((f) => f.field).join(', ')
    console.log(
      `  [${finding.kind}] ${finding.recordType} ${finding.id}${fieldSummary ? ` (${fieldSummary})` : ''}`
    )
  }
  if (unexpectedAdditions.length > 0) {
    console.log('')
    console.log(
      `unexpected additions (ARIS added something this run did not request): ${unexpectedAdditions.length}`
    )
    for (const addition of unexpectedAdditions)
      console.log(`  [added] ${addition.recordType} ${addition.id}`)
  }
  console.log('')
  console.log(`report written to ${outPath}`)

  const passed =
    manifest !== null &&
    confirmations.length > 0 &&
    confirmedCount === confirmations.length &&
    unintendedFindings.length === 0

  console.log('')
  if (!manifest) {
    console.log(
      'Phase 17 §20.3 gate: INCOMPLETE — no manifest found, intended changes were not checked.'
    )
    process.exitCode = 1
  } else if (passed) {
    console.log(
      'Phase 17 §20.3 gate: PASS — all intended changes confirmed, zero unintended semantic loss.'
    )
  } else {
    console.log('Phase 17 §20.3 gate: FAIL — see intendedChanges/unintendedFindings above.')
    process.exitCode = 1
  }
}

await main()
