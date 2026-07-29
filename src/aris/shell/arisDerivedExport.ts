/**
 * Derived AML export (plan §9), composed for the mounted shell.
 *
 * The imported original is never touched. What the user edited on the canvas is
 * the *working document*; what ARIS reads is *bytes*. This module is the bridge:
 * it diffs the live working document against the pinned imported document and
 * expresses each difference as a byte-addressed {@link AmlEdit} built by the
 * writer's own edit builders, so every byte nobody changed is copied verbatim.
 *
 * `src/aris/canvas` publishes a whole `ArisWorkingDocument` per revision rather
 * than a per-command byte intent, so the mapping is recovered by comparing the
 * two documents record by record. Every difference is routed to the writer
 * builder that owns its record shape (plan §9.1 for existing records, §9.2 for
 * new ones); the writer allocates source-style ids, keeps canonical child order
 * and escapes text, and this module only decides *which* builder to call and
 * *where* to anchor it.
 *
 * Two rules hold everywhere below:
 *
 * 1. Nothing is invented. Locale ids are the raw tokens the source itself
 *    declared (`&LocaleId.AEar;` in the AnimalWF export), attribute names are
 *    exactly the ones `src/aris/source/semanticIndex.ts` read the value from, so
 *    every write is the inverse of a read, and no GUIDs are minted for records
 *    the user created — an invented identity is worse than an absent optional
 *    child.
 * 2. Anything this module cannot express is REPORTED (`unmapped`), never
 *    silently dropped: an export that quietly lost an edit would be worse than
 *    one that admits the gap. {@link ARIS_DERIVED_UNMAPPED_KINDS} enumerates
 *    every remaining gap and why it is out of scope.
 *
 * Nothing here decides whether a download may proceed. {@link exportArisDerivedAml}
 * delegates that to the writer's `exportDerivedAml`, which runs all nine §9.3
 * validations and throws rather than return unvalidated bytes.
 */

import type {
  ArisAttribute,
  ArisAttributeOccurrence,
  ArisConnectionDefinition,
  ArisConnectionOccurrence,
  ArisFreeText,
  ArisLane,
  ArisLocalizedValue,
  ArisModel,
  ArisObjectDefinition,
  ArisObjectOccurrence,
  ArisWorkingDocument
} from '../model/types'
import {
  ancestorsOf,
  attrDefSpec,
  attrOccSpec,
  childrenNamed,
  createArisIdAllocator,
  createConnectionDefinitionEdits,
  createConnectionOccurrenceEdits,
  createObjectDefinitionEdits,
  createObjectOccurrenceEdits,
  declaredIds,
  deleteElementEdits,
  deleteRecordsCascade,
  exportDerivedAml,
  insertChildEdits,
  moveOccurrenceEdits,
  parseArisId,
  positionSpec,
  prepareDerivedAml,
  readWriterSourceView,
  rerouteConnectionEdits,
  resizeOccurrenceEdits,
  setAttributeEdits,
  setLocalizedAttributeEdits,
  sizeSpec,
  type AmlEdit,
  type ArisDefinitionIdKind,
  type ArisIdAllocator,
  type ArisOccurrenceIdKind,
  type AttributeDefinitionSpec,
  type AttributeOccurrenceSpec,
  type ConnectionDefinitionSpec,
  type ConnectionOccurrenceSpec,
  type DerivedAmlExport,
  type ElementSpec,
  type EmittedAttribute,
  type LocalizedTextSpec,
  type ObjectDefinitionSpec,
  type ObjectOccurrenceSpec,
  type PointSpec,
  type RandomSource,
  type WriterElement,
  type WriterSourceView
} from '../writer'
import { tk } from './shellI18n'

/** One difference the writer could not address against the original bytes. */
export interface ArisUnmappedEdit {
  readonly sourceId: string
  readonly reason: string
}

export interface ArisDerivedEditSet {
  readonly edits: readonly AmlEdit[]
  readonly unmapped: readonly ArisUnmappedEdit[]
  /** Ids the edit set introduces, for the §9.3 source-accounting check. */
  readonly addedIds: readonly string[]
  /** Ids the edit set removes, including everything a cascade took with them. */
  readonly removedIds: readonly string[]
}

/**
 * Every difference this module still refuses to express, with the reason.
 *
 * These are gaps in the *format mapping*, not in the writer: each one names a
 * record the canvas can hold but whose byte position in an ARIS export cannot be
 * derived from the working document alone.
 */
export const ARIS_DERIVED_UNMAPPED_KINDS: Readonly<Record<string, string>> = Object.freeze({
  'aris.export.unmapped.newModel':
    'Model {id} was created after import. A derived export rewrites the imported document; whole new models belong to a new export, not to a patch of this one.',
  'aris.export.unmapped.removedModel':
    'Model {id} is missing from the working document. Removing a whole model from a derived export is out of scope; no canvas gesture produces it.',
  'aris.export.unmapped.defaultLocale':
    'Record {id} carries a value with no locale id, so there is no source `LocaleId` token to address it by.',
  'aris.export.unmapped.clearedAttribute':
    'Record {id} cleared "{attribute}". The working model reads a missing attribute and an empty one alike, so clearing cannot be distinguished from never having had a value.',
  'aris.export.unmapped.missingAnchor':
    'Record {id} has no anchor in the imported document: {anchor} is not a record this source declares.',
  'aris.export.unmapped.movedConnectionSource':
    'Connection {id} was re-attached to a different source occurrence. AML nests a connection under its source, so moving it would mean re-emitting the record and discarding the pen and label children the original carried.',
  'aris.export.unmapped.linkedModelsOnNewDefinition':
    'New definition {id} carries model assignments. Assignments on a record that does not exist yet in the source have no attribute to patch.',
  'aris.export.unmapped.unknownRecord':
    'Record {id} is in the working document but no imported record declares that id.'
})

interface DiffContext {
  readonly view: WriterSourceView
  readonly original: ArisWorkingDocument
  readonly live: ArisWorkingDocument
  readonly edits: AmlEdit[]
  readonly unmapped: ArisUnmappedEdit[]
  readonly allocator: ArisIdAllocator
  /** Working-model id to the source-style id the derived document will carry. */
  readonly ids: Map<string, string>
  readonly added: Set<string>
  readonly removed: Set<string>
  /** Ids a cascading delete already removed; every other edit must leave them alone. */
  readonly suppressed: Set<string>
}

const NAME_ATTRIBUTE_TYPES: ReadonlySet<string> = new Set(['AT_NAME', 'Name'])

/** The key `buildFromSource` uses for a value whose `<AttrValue>` declared no `LocaleId`. */
const DEFAULT_LOCALE_KEY = 'default'

function report(
  context: DiffContext,
  sourceId: string,
  key: keyof typeof ARIS_DERIVED_UNMAPPED_KINDS,
  vars: Record<string, string | number>
): void {
  context.unmapped.push({
    sourceId,
    reason: tk(key, ARIS_DERIVED_UNMAPPED_KINDS[key]!, vars)
  })
}

/**
 * Run one builder, keeping its edits only if it produced them all.
 *
 * A builder that throws contributes nothing — never a half-applied record — and
 * is reported instead, which is what keeps `unmapped` honest.
 */
function collect(
  context: DiffContext,
  sourceId: string,
  build: () => readonly AmlEdit[],
  onSuccess?: () => void
): boolean {
  try {
    const built = build()
    context.edits.push(...built)
    onSuccess?.()
    return true
  } catch (error) {
    context.unmapped.push({
      sourceId,
      reason: error instanceof Error ? error.message : String(error)
    })
    return false
  }
}

// --- addressing helpers -------------------------------------------------------------------

function requireLiveElement(context: DiffContext, id: string): WriterElement | null {
  const element = context.view.byId.get(id)
  if (element) return element
  report(context, id, 'aris.export.unmapped.unknownRecord', { id })
  return null
}

/** The `AttrDef.Type` this record already uses for its name, so a rename patches it in place. */
function nameAttributeType(view: WriterSourceView, ownerId: string): string {
  const owner = view.byId.get(ownerId)
  if (!owner) return 'AT_NAME'
  for (const child of childrenNamed(view, owner, 'AttrDef')) {
    const type = child.attributeByName.get('AttrDef.Type')?.value
    if (type !== undefined && NAME_ATTRIBUTE_TYPES.has(type)) return type
  }
  return 'AT_NAME'
}

function nearestGroupId(view: WriterSourceView, element: WriterElement): string | null {
  for (const ancestor of ancestorsOf(view, element)) {
    if (ancestor.name === 'Group' && ancestor.sourceId !== null) return ancestor.sourceId
  }
  return null
}

/**
 * The group a newly created object definition belongs in (plan §9.2, "Insert
 * definitions in correct group/database position").
 *
 * The definition's own occurrences are the only evidence the working document
 * carries about where it belongs, so the group that holds the model drawing it
 * wins. Failing that the export's existing definitions decide, and only if the
 * source declares none at all does the root group take over.
 */
function resolveGroupForDefinition(context: DiffContext, definitionId: string): string | null {
  for (const model of context.live.models.values()) {
    if (!model.occurrences.some((occurrence) => occurrence.definitionId === definitionId)) continue
    const element = context.view.byId.get(model.id)
    if (!element) continue
    const group = nearestGroupId(context.view, element)
    if (group !== null) return group
  }
  const existing = context.view.elements.find((element) => element.name === 'ObjDef')
  if (existing) {
    const group = nearestGroupId(context.view, existing)
    if (group !== null) return group
  }
  const anyGroup = context.view.elements.find(
    (element) => element.name === 'Group' && element.sourceId !== null
  )
  return anyGroup?.sourceId ?? null
}

/**
 * Map a working-model id to the id the derived document will declare.
 *
 * Records that already exist in the source keep their id — a derived export never
 * renumbers what it did not create. Canvas-authored records carry sequential ids
 * (`ObjDef.7`) that are not in the ARIS format at all, so they are allocated a
 * real source-style id here; a record that already carries a well-formed id of
 * the right kind keeps it, so a document that round-trips through an export and
 * back does not drift.
 */
function sourceIdFor(
  context: DiffContext,
  workingId: string,
  kind: ArisDefinitionIdKind | ArisOccurrenceIdKind,
  modelSourceId?: string
): string {
  if (context.view.byId.has(workingId)) return workingId
  const cached = context.ids.get(workingId)
  if (cached !== undefined) return cached

  const parsed = parseArisId(workingId)
  const allocated =
    parsed !== null && parsed.kind === kind && !context.allocator.has(workingId)
      ? context.allocator.reserve(workingId)
      : modelSourceId === undefined
        ? context.allocator.allocateDefinitionId(kind as ArisDefinitionIdKind)
        : context.allocator.allocateOccurrenceId(kind as ArisOccurrenceIdKind, modelSourceId)
  context.ids.set(workingId, allocated)
  return allocated
}

// --- localized values and attributes ------------------------------------------------------

function localizedSpecs(value: ArisLocalizedValue): LocalizedTextSpec[] {
  return Object.entries(value.values)
    .filter(([localeId]) => localeId !== DEFAULT_LOCALE_KEY)
    .map(([localeId, text]) => ({ localeId, text }))
}

function attributeSpecs(attributes: readonly ArisAttribute[]): AttributeDefinitionSpec[] {
  return attributes
    .map((attribute) => ({
      type: attribute.type,
      values: attribute.values.flatMap((value): LocalizedTextSpec[] =>
        value.localeId === null ? [] : [{ localeId: value.localeId, text: value.text }]
      )
    }))
    .filter((attribute) => attribute.values.length > 0)
}

/** Remove one `<AttrValue>` — or the whole `<AttrDef>` when it was the last one. */
function removeLocalizedValue(
  context: DiffContext,
  ownerId: string,
  type: string,
  localeId: string
): void {
  const owner = requireLiveElement(context, ownerId)
  if (!owner) return
  const attrDef = childrenNamed(context.view, owner, 'AttrDef').find(
    (candidate) => candidate.attributeByName.get('AttrDef.Type')?.value === type
  )
  if (!attrDef) return
  const values = childrenNamed(context.view, attrDef, 'AttrValue')
  const target = values.find(
    (candidate) => candidate.attributeByName.get('LocaleId')?.value === localeId
  )
  if (!target) return
  const doomed = values.length === 1 ? attrDef : target
  collect(context, ownerId, () =>
    deleteElementEdits(context.view, [doomed], `remove ${type} ${localeId} from ${ownerId}`)
  )
}

function removeAttributeDefinition(context: DiffContext, ownerId: string, type: string): void {
  const owner = requireLiveElement(context, ownerId)
  if (!owner) return
  const attrDef = childrenNamed(context.view, owner, 'AttrDef').find(
    (candidate) => candidate.attributeByName.get('AttrDef.Type')?.value === type
  )
  if (!attrDef) return
  collect(context, ownerId, () =>
    deleteElementEdits(context.view, [attrDef], `remove ${type} from ${ownerId}`)
  )
}

/**
 * Diff one localized value (a name) and patch only the locales that moved.
 *
 * Adding an Arabic value next to an existing English one is the same code path as
 * changing the English one: the writer finds the `<AttrDef>` that is already
 * there and inserts a sibling `<AttrValue>` carrying the source's own locale
 * token, so the English value's bytes never move.
 */
function diffLocalizedValue(
  context: DiffContext,
  ownerId: string,
  type: string,
  before: ArisLocalizedValue,
  after: ArisLocalizedValue
): void {
  for (const [localeId, text] of Object.entries(after.values)) {
    if (before.values[localeId] === text) continue
    if (localeId === DEFAULT_LOCALE_KEY) {
      report(context, ownerId, 'aris.export.unmapped.defaultLocale', { id: ownerId })
      continue
    }
    collect(context, ownerId, () =>
      setLocalizedAttributeEdits(context.view, ownerId, { type, localeId, text })
    )
  }
  for (const localeId of Object.keys(before.values)) {
    if (localeId in after.values) continue
    if (localeId === DEFAULT_LOCALE_KEY) {
      report(context, ownerId, 'aris.export.unmapped.defaultLocale', { id: ownerId })
      continue
    }
    removeLocalizedValue(context, ownerId, type, localeId)
  }
}

/** Diff every non-name attribute of a record that carries `<AttrDef>` children. */
function diffAttributes(
  context: DiffContext,
  ownerId: string,
  before: readonly ArisAttribute[],
  after: readonly ArisAttribute[]
): void {
  const beforeByType = new Map(before.map((attribute) => [attribute.type, attribute]))
  const afterByType = new Map(after.map((attribute) => [attribute.type, attribute]))

  for (const [type, attribute] of afterByType) {
    const previous = beforeByType.get(type)
    for (const value of attribute.values) {
      if (value.localeId === null) {
        report(context, ownerId, 'aris.export.unmapped.defaultLocale', { id: ownerId })
        continue
      }
      const localeId = value.localeId
      const old = previous?.values.find((candidate) => candidate.localeId === localeId)
      if (old !== undefined && old.text === value.text) continue
      collect(context, ownerId, () =>
        setLocalizedAttributeEdits(context.view, ownerId, { type, localeId, text: value.text })
      )
    }
    previous?.values.forEach((value) => {
      if (value.localeId === null) return
      if (attribute.values.some((candidate) => candidate.localeId === value.localeId)) return
      removeLocalizedValue(context, ownerId, type, value.localeId)
    })
  }

  for (const type of beforeByType.keys()) {
    if (afterByType.has(type)) continue
    removeAttributeDefinition(context, ownerId, type)
  }
}

/**
 * Patch one raw XML attribute, and only when the working model can prove it moved.
 *
 * Clearing is deliberately not expressed: `buildFromSource` reads an absent
 * attribute and an empty one to the same `null`, so a `value -> null` transition
 * cannot be told apart from a value that was never there.
 */
function diffRawAttribute(
  context: DiffContext,
  element: WriterElement,
  sourceId: string,
  name: string,
  before: string | number | null,
  after: string | number | null
): void {
  if (before === after) return
  if (after === null || after === '') {
    if (before === null || before === '') return
    report(context, sourceId, 'aris.export.unmapped.clearedAttribute', {
      id: sourceId,
      attribute: name
    })
    return
  }
  collect(context, sourceId, () => setAttributeEdits(context.view, element, name, String(after)))
}

// --- deletions ----------------------------------------------------------------------------

/**
 * Collect every record the working document dropped and delete it with its
 * references (plan §9.1, "Update all references atomically").
 *
 * Deletions run first and publish their cascade into `suppressed`, because an
 * edit addressed *inside* a span another edit deletes is an overlap the patcher
 * rejects outright — a deleted occurrence whose geometry also changed would
 * otherwise fail the whole export rather than one record.
 */
function collectDeletions(context: DiffContext): void {
  const doomed: string[] = []
  const consider = (id: string): void => {
    if (id !== '' && context.view.byId.has(id)) doomed.push(id)
  }

  for (const id of context.original.objectDefinitions.keys()) {
    if (!context.live.objectDefinitions.has(id)) consider(id)
  }
  for (const id of context.original.connectionDefinitions.keys()) {
    if (!context.live.connectionDefinitions.has(id)) consider(id)
  }
  for (const [modelId, originalModel] of context.original.models) {
    const liveModel = context.live.models.get(modelId)
    if (!liveModel) {
      report(context, modelId, 'aris.export.unmapped.removedModel', { id: modelId })
      continue
    }
    const liveOccurrences = new Set(liveModel.occurrences.map((entry) => entry.id))
    originalModel.occurrences.forEach((entry) => {
      if (!liveOccurrences.has(entry.id)) consider(entry.id)
    })
    const liveConnections = new Set(liveModel.connectionOccurrences.map((entry) => entry.id))
    originalModel.connectionOccurrences.forEach((entry) => {
      if (!liveConnections.has(entry.id)) consider(entry.id)
    })
    const liveLanes = new Set(liveModel.lanes.map((entry) => entry.id))
    originalModel.lanes.forEach((entry) => {
      if (!liveLanes.has(entry.id)) consider(entry.id)
    })
    const liveFreeText = new Set(liveModel.freeText.map((entry) => entry.id))
    originalModel.freeText.forEach((entry) => {
      if (!liveFreeText.has(entry.id)) consider(entry.id)
    })
  }

  if (doomed.length === 0) return
  try {
    const result = deleteRecordsCascade(context.view, doomed)
    context.edits.push(...result.edits)
    result.deletedIds.forEach((id) => {
      context.removed.add(id)
      context.suppressed.add(id)
    })
  } catch (error) {
    context.unmapped.push({
      sourceId: doomed.join(' '),
      reason: error instanceof Error ? error.message : String(error)
    })
  }
}

// --- creations ----------------------------------------------------------------------------

function connectionDefinitionSpecFor(
  context: DiffContext,
  connection: ArisConnectionDefinition
): ConnectionDefinitionSpec {
  return {
    id: sourceIdFor(context, connection.id, 'CxnDef'),
    type: connection.type,
    targetObjectDefinitionId: sourceIdFor(context, connection.toObjectDefinitionId, 'ObjDef')
  }
}

function newConnectionDefinitionsFrom(
  context: DiffContext,
  fromDefinitionId: string
): readonly ArisConnectionDefinition[] {
  return [...context.live.connectionDefinitions.values()].filter(
    (connection) =>
      connection.fromObjectDefinitionId === fromDefinitionId &&
      !context.original.connectionDefinitions.has(connection.id)
  )
}

function objectDefinitionSpecFor(
  context: DiffContext,
  definition: ArisObjectDefinition,
  nested: readonly ArisConnectionDefinition[]
): ObjectDefinitionSpec {
  const nestedSpecs = nested.map((connection) => connectionDefinitionSpecFor(context, connection))
  const spec: ObjectDefinitionSpec = {
    id: sourceIdFor(context, definition.id, 'ObjDef'),
    typeNum: definition.type,
    ...(definition.defaultSymbol ? { symbolNum: definition.defaultSymbol } : {}),
    ...(nestedSpecs.length > 0
      ? {
          connectionDefinitionIds: nestedSpecs.map((entry) => entry.id),
          connectionDefinitions: nestedSpecs
        }
      : {}),
    attributes: [
      ...(localizedSpecs(definition.names).length > 0
        ? [{ type: 'AT_NAME', values: localizedSpecs(definition.names) }]
        : []),
      ...attributeSpecs(definition.attributes)
    ]
  }
  return spec
}

/** Object definitions the canvas created, with any connection definitions they own. */
function collectCreatedDefinitions(context: DiffContext): void {
  for (const [id, definition] of context.live.objectDefinitions) {
    if (context.original.objectDefinitions.has(id)) continue
    if (context.view.byId.has(id)) continue

    const groupId = resolveGroupForDefinition(context, id)
    if (groupId === null) {
      report(context, id, 'aris.export.unmapped.missingAnchor', { id, anchor: 'a <Group>' })
      continue
    }
    if (definition.linkedModelIds.length > 0) {
      report(context, id, 'aris.export.unmapped.linkedModelsOnNewDefinition', { id })
    }

    const nested = newConnectionDefinitionsFrom(context, id)
    collect(
      context,
      id,
      () => {
        const spec = objectDefinitionSpecFor(context, definition, nested)
        return createObjectDefinitionEdits(context.view, groupId, spec)
      },
      () => {
        context.added.add(sourceIdFor(context, id, 'ObjDef'))
        nested.forEach((connection) =>
          context.added.add(sourceIdFor(context, connection.id, 'CxnDef'))
        )
      }
    )
  }
}

/** Connection definitions whose source object definition was already in the export. */
function collectCreatedConnectionDefinitions(context: DiffContext): void {
  for (const [id, connection] of context.live.connectionDefinitions) {
    if (context.original.connectionDefinitions.has(id)) continue
    if (context.view.byId.has(id)) continue
    const from = connection.fromObjectDefinitionId
    // Connection definitions owned by a brand-new definition are emitted nested inside it.
    if (!context.view.byId.has(from)) {
      if (context.live.objectDefinitions.has(from)) continue
      report(context, id, 'aris.export.unmapped.missingAnchor', { id, anchor: from })
      continue
    }
    if (context.suppressed.has(from)) continue

    collect(
      context,
      id,
      () =>
        createConnectionDefinitionEdits(
          context.view,
          from,
          connectionDefinitionSpecFor(context, connection)
        ),
      () => context.added.add(sourceIdFor(context, id, 'CxnDef'))
    )
  }
}

function centreOf(occurrence: ArisObjectOccurrence): PointSpec {
  return {
    x: Math.round(occurrence.bounds.x + occurrence.bounds.width / 2),
    y: Math.round(occurrence.bounds.y + occurrence.bounds.height / 2)
  }
}

/**
 * The route to emit for a new connection occurrence.
 *
 * `<CxnOcc>` needs at least one `<Position>`, and the canvas may hand over an
 * empty route for a connection it has not laid out yet. Falling back to the two
 * endpoint centres derives the route from geometry the document already holds
 * rather than inventing a shape.
 */
function routeFor(model: ArisModel, connection: ArisConnectionOccurrence): readonly PointSpec[] {
  if (connection.route.length > 0) {
    return connection.route.map((point) => ({ x: Math.round(point.x), y: Math.round(point.y) }))
  }
  const source = model.occurrences.find((entry) => entry.id === connection.sourceOccurrenceId)
  const target = model.occurrences.find((entry) => entry.id === connection.targetOccurrenceId)
  if (!source || !target) return []
  return [centreOf(source), centreOf(target)]
}

function connectionOccurrenceSpecFor(
  context: DiffContext,
  model: ArisModel,
  modelSourceId: string,
  connection: ArisConnectionOccurrence
): ConnectionOccurrenceSpec {
  return {
    id: sourceIdFor(context, connection.id, 'CxnOcc', modelSourceId),
    connectionDefinitionId: sourceIdFor(context, connection.definitionId, 'CxnDef'),
    targetObjectOccurrenceId: sourceIdFor(
      context,
      connection.targetOccurrenceId,
      'ObjOcc',
      modelSourceId
    ),
    points: routeFor(model, connection),
    ...(connection.style.color ? { penColor: connection.style.color } : {})
  }
}

function attributeOccurrenceSpecFor(placement: ArisAttributeOccurrence): AttributeOccurrenceSpec {
  return {
    typeNum: placement.attributeType,
    ...(placement.port !== null ? { port: placement.port } : {}),
    ...(placement.orderNum !== null ? { orderNum: Math.round(placement.orderNum) } : {}),
    ...(placement.alignment !== null ? { alignment: placement.alignment } : {}),
    ...(placement.offsetX !== null ? { offsetX: Math.round(placement.offsetX) } : {}),
    ...(placement.offsetY !== null ? { offsetY: Math.round(placement.offsetY) } : {}),
    ...(placement.rotation !== null ? { rotation: Math.round(placement.rotation) } : {}),
    ...(placement.width !== null && placement.height !== null
      ? { size: { dx: Math.round(placement.width), dy: Math.round(placement.height) } }
      : {})
  }
}

function objectOccurrenceSpecFor(
  context: DiffContext,
  model: ArisModel,
  modelSourceId: string,
  occurrence: ArisObjectOccurrence,
  nested: readonly ArisConnectionOccurrence[]
): ObjectOccurrenceSpec {
  const nestedSpecs = nested.map((connection) =>
    connectionOccurrenceSpecFor(context, model, modelSourceId, connection)
  )
  return {
    id: sourceIdFor(context, occurrence.id, 'ObjOcc', modelSourceId),
    objectDefinitionId: sourceIdFor(context, occurrence.definitionId, 'ObjDef'),
    ...(occurrence.symbol ? { symbolNum: occurrence.symbol } : {}),
    position: { x: Math.round(occurrence.bounds.x), y: Math.round(occurrence.bounds.y) },
    size: { dx: Math.round(occurrence.bounds.width), dy: Math.round(occurrence.bounds.height) },
    ...(occurrence.style.fillColor ? { brushColor: occurrence.style.fillColor } : {}),
    ...(nestedSpecs.length > 0
      ? {
          connectionOccurrenceIds: nestedSpecs.map((entry) => entry.id),
          connectionOccurrences: nestedSpecs
        }
      : {}),
    ...(occurrence.attributeOccurrences.length > 0
      ? { attributeOccurrences: occurrence.attributeOccurrences.map(attributeOccurrenceSpecFor) }
      : {})
  }
}

function laneSpecFor(lane: ArisLane, id: string): ElementSpec {
  const attributes: EmittedAttribute[] = [{ name: 'Lane.ID', value: id }]
  if (lane.laneType !== null) attributes.push({ name: 'Lane.Type', value: lane.laneType })
  if (lane.orientation !== null) attributes.push({ name: 'Orientation', value: lane.orientation })
  if (lane.startBorder !== null) {
    attributes.push({ name: 'StartBorder', value: String(Math.round(lane.startBorder)) })
  }
  if (lane.endBorder !== null) {
    attributes.push({ name: 'EndBorder', value: String(Math.round(lane.endBorder)) })
  }
  const values = localizedSpecs(lane.names)
  return {
    name: 'Lane',
    attributes,
    children: values.length > 0 ? [attrDefSpec({ type: 'AT_NAME', values })] : []
  }
}

function freeTextDefinitionSpecFor(text: ArisFreeText, id: string): ElementSpec {
  const values = localizedSpecs(text.text)
  return {
    name: 'FFTextDef',
    attributes: [{ name: 'FFTextDef.ID', value: id }],
    children: values.length > 0 ? [attrDefSpec({ type: 'AT_NAME', values })] : []
  }
}

function freeTextOccurrenceSpecFor(text: ArisFreeText, definitionId: string): ElementSpec {
  const attributes: EmittedAttribute[] = [{ name: 'FFTextDef.IdRef', value: definitionId }]
  if (text.style.fontStyleSheetId !== null) {
    attributes.push({ name: 'FontSS.IdRef', value: text.style.fontStyleSheetId })
  }
  return {
    name: 'FFTextOcc',
    attributes,
    children: [
      positionSpec({ x: Math.round(text.bounds.x), y: Math.round(text.bounds.y) }),
      sizeSpec({ dx: Math.round(text.bounds.width), dy: Math.round(text.bounds.height) })
    ]
  }
}

/** Everything the canvas added inside a model that the source already declares. */
function collectCreatedInModel(context: DiffContext, model: ArisModel, original: ArisModel): void {
  const modelElement = context.view.byId.get(model.id)
  if (!modelElement) {
    report(context, model.id, 'aris.export.unmapped.unknownRecord', { id: model.id })
    return
  }
  if (context.suppressed.has(model.id)) return

  const originalOccurrences = new Set(original.occurrences.map((entry) => entry.id))
  const originalConnections = new Set(original.connectionOccurrences.map((entry) => entry.id))
  const newConnections = model.connectionOccurrences.filter(
    (connection) => !originalConnections.has(connection.id) && !context.view.byId.has(connection.id)
  )

  for (const occurrence of model.occurrences) {
    if (originalOccurrences.has(occurrence.id)) continue
    if (context.view.byId.has(occurrence.id)) continue
    const nested = newConnections.filter(
      (connection) => connection.sourceOccurrenceId === occurrence.id
    )
    collect(
      context,
      occurrence.id,
      () =>
        createObjectOccurrenceEdits(
          context.view,
          model.id,
          objectOccurrenceSpecFor(context, model, model.id, occurrence, nested)
        ),
      () => {
        context.added.add(sourceIdFor(context, occurrence.id, 'ObjOcc', model.id))
        nested.forEach((connection) =>
          context.added.add(sourceIdFor(context, connection.id, 'CxnOcc', model.id))
        )
      }
    )
  }

  for (const connection of newConnections) {
    const from = connection.sourceOccurrenceId
    // Connections leaving a brand-new occurrence are emitted nested inside it.
    if (!context.view.byId.has(from)) {
      if (model.occurrences.some((entry) => entry.id === from)) continue
      report(context, connection.id, 'aris.export.unmapped.missingAnchor', {
        id: connection.id,
        anchor: from
      })
      continue
    }
    if (context.suppressed.has(from)) continue
    collect(
      context,
      connection.id,
      () =>
        createConnectionOccurrenceEdits(
          context.view,
          from,
          connectionOccurrenceSpecFor(context, model, model.id, connection)
        ),
      () => context.added.add(sourceIdFor(context, connection.id, 'CxnOcc', model.id))
    )
  }

  const originalLanes = new Set(original.lanes.map((entry) => entry.id))
  for (const lane of model.lanes) {
    if (originalLanes.has(lane.id)) continue
    if (context.view.byId.has(lane.id)) continue
    collect(
      context,
      lane.id,
      () => {
        const id = sourceIdFor(context, lane.id, 'Lane', model.id)
        return insertChildEdits(context.view, modelElement, laneSpecFor(lane, id), `create ${id}`)
      },
      () => context.added.add(sourceIdFor(context, lane.id, 'Lane', model.id))
    )
  }

  const originalFreeText = new Set(original.freeText.map((entry) => entry.id))
  const root =
    context.view.rootPath === null ? null : context.view.byPath.get(context.view.rootPath)
  for (const text of model.freeText) {
    if (originalFreeText.has(text.id)) continue
    if (context.view.byId.has(text.id)) continue
    if (!root) {
      report(context, text.id, 'aris.export.unmapped.missingAnchor', {
        id: text.id,
        anchor: '<AML>'
      })
      continue
    }
    collect(
      context,
      text.id,
      () => {
        const definitionId = sourceIdFor(context, text.definitionId ?? text.id, 'FFTextDef')
        return [
          ...insertChildEdits(
            context.view,
            root,
            freeTextDefinitionSpecFor(text, definitionId),
            `create ${definitionId}`
          ),
          ...insertChildEdits(
            context.view,
            modelElement,
            freeTextOccurrenceSpecFor(text, definitionId),
            `place ${definitionId} in ${model.id}`
          )
        ]
      },
      () => context.added.add(sourceIdFor(context, text.definitionId ?? text.id, 'FFTextDef'))
    )
  }
}

// --- updates ------------------------------------------------------------------------------

function diffObjectDefinitions(context: DiffContext): void {
  for (const [id, live] of context.live.objectDefinitions) {
    const before = context.original.objectDefinitions.get(id)
    if (!before) continue
    if (context.suppressed.has(id)) continue
    const element = context.view.byId.get(id)
    if (!element) continue

    diffLocalizedValue(context, id, nameAttributeType(context.view, id), before.names, live.names)
    diffAttributes(context, id, before.attributes, live.attributes)
    if (live.type !== before.type) {
      diffRawAttribute(context, element, id, 'TypeNum', before.type, live.type)
    }
    if (live.defaultSymbol !== before.defaultSymbol) {
      diffRawAttribute(context, element, id, 'SymbolNum', before.defaultSymbol, live.defaultSymbol)
    }
    const beforeLinks = [...before.linkedModelIds].join(' ')
    const liveLinks = [...live.linkedModelIds].join(' ')
    if (beforeLinks !== liveLinks) {
      diffRawAttribute(context, element, id, 'LinkedModels.IdRefs', beforeLinks, liveLinks)
    }
  }
}

function diffConnectionDefinitions(context: DiffContext): void {
  for (const [id, live] of context.live.connectionDefinitions) {
    const before = context.original.connectionDefinitions.get(id)
    if (!before) continue
    if (context.suppressed.has(id)) continue
    const element = context.view.byId.get(id)
    if (!element) continue

    diffLocalizedValue(context, id, nameAttributeType(context.view, id), before.names, live.names)
    diffAttributes(context, id, before.attributes, live.attributes)
    diffRawAttribute(context, element, id, 'CxnDef.Type', before.type, live.type)
    if (live.toObjectDefinitionId !== before.toObjectDefinitionId) {
      diffRawAttribute(
        context,
        element,
        id,
        'ToObjDef.IdRef',
        before.toObjectDefinitionId,
        live.toObjectDefinitionId
      )
    }
  }
}

function diffOccurrence(
  context: DiffContext,
  before: ArisObjectOccurrence,
  live: ArisObjectOccurrence
): void {
  const id = live.id
  if (context.suppressed.has(id)) return
  const bounds = live.bounds

  if (bounds.x !== before.bounds.x || bounds.y !== before.bounds.y) {
    collect(context, id, () =>
      moveOccurrenceEdits(context.view, id, {
        x: Math.round(bounds.x),
        y: Math.round(bounds.y)
      })
    )
  }
  if (bounds.width !== before.bounds.width || bounds.height !== before.bounds.height) {
    collect(context, id, () =>
      resizeOccurrenceEdits(context.view, id, {
        dx: Math.round(bounds.width),
        dy: Math.round(bounds.height)
      })
    )
  }

  const element = context.view.byId.get(id)
  if (!element) return
  diffRawAttribute(context, element, id, 'SymbolNum', before.symbol, live.symbol)
  diffRawAttribute(context, element, id, 'FillColor', before.style.fillColor, live.style.fillColor)
  diffRawAttribute(context, element, id, 'Color', before.style.strokeColor, live.style.strokeColor)
  diffRawAttribute(
    context,
    element,
    id,
    'FontSS.IdRef',
    before.style.fontStyleSheetId,
    live.style.fontStyleSheetId
  )
  diffRawAttribute(context, element, id, 'Zorder', before.style.zOrder, live.style.zOrder)
  diffAttributeOccurrences(
    context,
    element,
    id,
    before.attributeOccurrences,
    live.attributeOccurrences
  )
}

/**
 * Diff the `<AttrOcc>` placement records of an occurrence.
 *
 * These are the only "attributes" an occurrence carries in AML — the value lives
 * on the definition, the occurrence only says where it is drawn — so an
 * occurrence-scoped attribute edit lands here rather than on an `<AttrDef>`.
 */
function diffAttributeOccurrences(
  context: DiffContext,
  owner: WriterElement,
  ownerId: string,
  before: readonly ArisAttributeOccurrence[],
  after: readonly ArisAttributeOccurrence[]
): void {
  const beforeByType = new Map(before.map((entry) => [entry.attributeType, entry]))
  const elements = childrenNamed(context.view, owner, 'AttrOcc')

  for (const placement of after) {
    const previous = beforeByType.get(placement.attributeType)
    const element = elements.find(
      (candidate) => candidate.attributeByName.get('AttrTypeNum')?.value === placement.attributeType
    )
    if (!element) {
      collect(context, ownerId, () =>
        insertChildEdits(
          context.view,
          owner,
          attrOccSpec(attributeOccurrenceSpecFor(placement)),
          `place ${placement.attributeType} on ${ownerId}`
        )
      )
      continue
    }
    if (previous === undefined) continue
    diffRawAttribute(context, element, ownerId, 'Port', previous.port, placement.port)
    diffRawAttribute(context, element, ownerId, 'OrderNum', previous.orderNum, placement.orderNum)
    diffRawAttribute(
      context,
      element,
      ownerId,
      'Alignment',
      previous.alignment,
      placement.alignment
    )
    diffRawAttribute(context, element, ownerId, 'OffsetX', previous.offsetX, placement.offsetX)
    diffRawAttribute(context, element, ownerId, 'OffsetY', previous.offsetY, placement.offsetY)
    diffRawAttribute(context, element, ownerId, 'Rotation', previous.rotation, placement.rotation)
    if (previous.width === placement.width && previous.height === placement.height) continue
    if (placement.width === null || placement.height === null) continue
    const size = childrenNamed(context.view, element, 'Size')[0]
    const dx = Math.round(placement.width)
    const dy = Math.round(placement.height)
    if (size) {
      collect(context, ownerId, () => [
        ...setAttributeEdits(context.view, size, 'Size.dX', String(dx)),
        ...setAttributeEdits(context.view, size, 'Size.dY', String(dy))
      ])
    } else {
      collect(context, ownerId, () =>
        insertChildEdits(context.view, element, sizeSpec({ dx, dy }), `size ${ownerId}`)
      )
    }
  }
}

function routesDiffer(
  left: readonly { readonly x: number; readonly y: number }[],
  right: readonly { readonly x: number; readonly y: number }[]
): boolean {
  if (left.length !== right.length) return true
  return left.some((point, index) => point.x !== right[index]!.x || point.y !== right[index]!.y)
}

function diffConnectionOccurrence(
  context: DiffContext,
  before: ArisConnectionOccurrence,
  live: ArisConnectionOccurrence
): void {
  const id = live.id
  if (context.suppressed.has(id)) return

  if (live.route.length > 0 && routesDiffer(live.route, before.route)) {
    collect(context, id, () =>
      rerouteConnectionEdits(
        context.view,
        id,
        live.route.map((point) => ({ x: Math.round(point.x), y: Math.round(point.y) }))
      )
    )
  }

  const element = context.view.byId.get(id)
  if (!element) return
  if (live.sourceOccurrenceId !== before.sourceOccurrenceId) {
    report(context, id, 'aris.export.unmapped.movedConnectionSource', { id })
  }
  if (live.targetOccurrenceId !== before.targetOccurrenceId) {
    diffRawAttribute(
      context,
      element,
      id,
      'ToObjOcc.IdRef',
      before.targetOccurrenceId,
      live.targetOccurrenceId
    )
  }
  diffRawAttribute(context, element, id, 'CxnDef.IdRef', before.definitionId, live.definitionId)
  diffRawAttribute(context, element, id, 'Color', before.style.color, live.style.color)
  diffRawAttribute(context, element, id, 'SrcArrow', before.style.srcArrow, live.style.srcArrow)
  diffRawAttribute(context, element, id, 'TgtArrow', before.style.tgtArrow, live.style.tgtArrow)
  diffRawAttribute(
    context,
    element,
    id,
    'FontSS.IdRef',
    before.style.fontStyleSheetId,
    live.style.fontStyleSheetId
  )
  diffRawAttribute(context, element, id, 'Zorder', before.style.zOrder, live.style.zOrder)
}

function diffLane(context: DiffContext, before: ArisLane, live: ArisLane): void {
  const id = live.id
  if (context.suppressed.has(id)) return
  const element = context.view.byId.get(id)
  if (!element) return
  diffLocalizedValue(context, id, nameAttributeType(context.view, id), before.names, live.names)
  diffRawAttribute(context, element, id, 'Lane.Type', before.laneType, live.laneType)
  diffRawAttribute(context, element, id, 'Orientation', before.orientation, live.orientation)
  diffRawAttribute(context, element, id, 'StartBorder', before.startBorder, live.startBorder)
  diffRawAttribute(context, element, id, 'EndBorder', before.endBorder, live.endBorder)
}

function diffFreeText(context: DiffContext, before: ArisFreeText, live: ArisFreeText): void {
  const id = live.id
  if (context.suppressed.has(id)) return
  const definitionId = live.definitionId
  if (definitionId !== null && !context.suppressed.has(definitionId)) {
    diffLocalizedValue(
      context,
      definitionId,
      nameAttributeType(context.view, definitionId),
      before.text,
      live.text
    )
  }
  const bounds = live.bounds
  const moved = bounds.x !== before.bounds.x || bounds.y !== before.bounds.y
  const resized = bounds.width !== before.bounds.width || bounds.height !== before.bounds.height
  if (!moved && !resized) return
  const element = context.view.byId.get(id)
  if (!element) {
    // A real `<FFTextOcc>` frequently carries no id attribute at all, so the
    // working model synthesizes one from the record's path. No byte in the
    // source carries that id, which means there is nothing to address the
    // geometry by. Report it — a moved note that silently failed to move would
    // be worse than a note the export admits it could not write.
    report(context, id, 'aris.export.unmapped.unknownRecord', { id })
    return
  }
  if (moved) {
    collect(context, id, () =>
      moveOccurrenceEdits(context.view, id, { x: Math.round(bounds.x), y: Math.round(bounds.y) })
    )
  }
  if (resized) {
    collect(context, id, () =>
      resizeOccurrenceEdits(context.view, id, {
        dx: Math.round(bounds.width),
        dy: Math.round(bounds.height)
      })
    )
  }
}

function diffModel(context: DiffContext, before: ArisModel, live: ArisModel): void {
  const id = live.id
  if (context.suppressed.has(id)) return
  const element = context.view.byId.get(id)
  if (!element) {
    report(context, id, 'aris.export.unmapped.unknownRecord', { id })
    return
  }

  diffLocalizedValue(context, id, nameAttributeType(context.view, id), before.names, live.names)
  diffAttributes(context, id, before.attributes, live.attributes)
  diffRawAttribute(context, element, id, 'GridSize', before.layout.gridSize, live.layout.gridSize)
  diffRawAttribute(context, element, id, 'Scale', before.layout.scale, live.layout.scale)
  diffRawAttribute(
    context,
    element,
    id,
    'PrintScale',
    before.layout.printScale,
    live.layout.printScale
  )
  diffRawAttribute(
    context,
    element,
    id,
    'BackColor',
    before.layout.backColor,
    live.layout.backColor
  )

  const beforeOccurrences = new Map(before.occurrences.map((entry) => [entry.id, entry]))
  live.occurrences.forEach((occurrence) => {
    const previous = beforeOccurrences.get(occurrence.id)
    if (previous) diffOccurrence(context, previous, occurrence)
  })

  const beforeConnections = new Map(before.connectionOccurrences.map((entry) => [entry.id, entry]))
  live.connectionOccurrences.forEach((connection) => {
    const previous = beforeConnections.get(connection.id)
    if (previous) diffConnectionOccurrence(context, previous, connection)
  })

  const beforeLanes = new Map(before.lanes.map((entry) => [entry.id, entry]))
  live.lanes.forEach((lane) => {
    const previous = beforeLanes.get(lane.id)
    if (previous) diffLane(context, previous, lane)
  })

  const beforeFreeText = new Map(before.freeText.map((entry) => [entry.id, entry]))
  live.freeText.forEach((text) => {
    const previous = beforeFreeText.get(text.id)
    if (previous) diffFreeText(context, previous, text)
  })

  collectCreatedInModel(context, live, before)
}

// --- entry points -------------------------------------------------------------------------

export interface ArisDerivedEditOptions {
  /**
   * Randomness for source-style id allocation. Injectable so a test can assert on
   * the exact ids a create produces; production uses the writer's CSPRNG default.
   */
  readonly random?: RandomSource
}

/**
 * Diff `live` against `original` and express every difference as edits addressed
 * at the original bytes.
 */
export function buildArisDerivedEdits(
  view: WriterSourceView,
  original: ArisWorkingDocument,
  live: ArisWorkingDocument,
  options: ArisDerivedEditOptions = {}
): ArisDerivedEditSet {
  const context: DiffContext = {
    view,
    original,
    live,
    edits: [],
    unmapped: [],
    allocator: createArisIdAllocator({
      existingIds: declaredIds(view),
      ...(options.random ? { random: options.random } : {})
    }),
    ids: new Map(),
    added: new Set(),
    removed: new Set(),
    suppressed: new Set()
  }

  collectDeletions(context)
  collectCreatedDefinitions(context)
  collectCreatedConnectionDefinitions(context)

  for (const [modelId, liveModel] of live.models) {
    const originalModel = original.models.get(modelId)
    if (!originalModel) {
      report(context, modelId, 'aris.export.unmapped.newModel', { id: modelId })
      continue
    }
    diffModel(context, originalModel, liveModel)
  }

  diffObjectDefinitions(context)
  diffConnectionDefinitions(context)

  return Object.freeze({
    edits: Object.freeze(context.edits),
    unmapped: Object.freeze(context.unmapped),
    addedIds: Object.freeze([...context.added]),
    removedIds: Object.freeze([...context.removed])
  })
}

export interface ArisDerivedExportPreview {
  readonly result: DerivedAmlExport
  readonly editCount: number
  readonly unmapped: readonly ArisUnmappedEdit[]
  readonly addedIds: readonly string[]
  readonly removedIds: readonly string[]
}

export interface ArisDerivedExportInput extends ArisDerivedEditOptions {
  /** The exact decoded text of the imported original. Read, never written. */
  readonly originalText: string
  /** The pinned imported working document. */
  readonly original: ArisWorkingDocument
  /** The document the canvas currently holds. */
  readonly live: ArisWorkingDocument
}

function derive(
  input: ArisDerivedExportInput,
  run: (payload: {
    readonly originalText: string
    readonly edits: readonly AmlEdit[]
    readonly addedIds: readonly string[]
    readonly removedIds: readonly string[]
  }) => DerivedAmlExport
): ArisDerivedExportPreview {
  const view = readWriterSourceView(input.originalText)
  const { edits, unmapped, addedIds, removedIds } = buildArisDerivedEdits(
    view,
    input.original,
    input.live,
    input.random ? { random: input.random } : {}
  )
  return Object.freeze({
    result: run({ originalText: input.originalText, edits, addedIds, removedIds }),
    editCount: edits.length,
    unmapped,
    addedIds,
    removedIds
  })
}

/**
 * Build the derived document and run every §9.3 validation WITHOUT throwing, so a
 * blocked export can be explained instead of silently failing.
 */
export function prepareArisDerivedExport(input: ArisDerivedExportInput): ArisDerivedExportPreview {
  return derive(input, prepareDerivedAml)
}

/**
 * The download path. Throws `ArisWriterError` when any §9.3 check failed, so bytes
 * ARIS would reject can never reach a user's disk labelled as their model.
 */
export function exportArisDerivedAml(input: ArisDerivedExportInput): ArisDerivedExportPreview {
  return derive(input, exportDerivedAml)
}

/** `animalwf.aml` → `animalwf.derived.aml`. */
export function derivedAmlFileName(sourceName: string): string {
  const trimmed = sourceName.trim() === '' ? 'export' : sourceName.trim()
  const dot = trimmed.lastIndexOf('.')
  if (dot <= 0) return `${trimmed}.derived.aml`
  return `${trimmed.slice(0, dot)}.derived${trimmed.slice(dot)}`
}
