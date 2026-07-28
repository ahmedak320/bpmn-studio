import {
  attrDefSpec,
  attrValueSpec,
  canonicalChildRank,
  connectionDefinitionSpec,
  connectionOccurrenceSpec,
  objectDefinitionSpec,
  objectOccurrenceSpec,
  positionSpec,
  renderRecord,
  styledTextSpec,
  type AttributeDefinitionSpec,
  type ConnectionDefinitionSpec,
  type ConnectionOccurrenceSpec,
  type ElementSpec,
  type EmitContext,
  type LocalizedTextSpec,
  type ObjectDefinitionSpec,
  type ObjectOccurrenceSpec,
  type PointSpec,
  type SizeSpec
} from './emit'
import { ArisWriterError } from './errors'
import { escapeXmlAttributeValue } from './escapeXml'
import { deleteEdit, insertEdit, replaceEdit, type AmlEdit } from './patch'
import { makeSpan, type WriterSpan } from './spans'
import {
  childrenNamed,
  childrenOf,
  isListReferenceAttribute,
  requireAttribute,
  requireElementById,
  type WriterElement,
  type WriterReference,
  type WriterSourceView
} from './sourceView'

/**
 * High-level edit builders (plan section 9.1/9.2).
 *
 * Every builder returns {@link AmlEdit}s addressed against the ORIGINAL document. Nothing here
 * mutates anything: the caller collects edits from as many builders as it likes and hands the
 * whole set to `applyAmlEdits`, which rejects any overlap. That is what makes an edit batch
 * atomic — a rename that touched the declaration but not a reference would either be applied
 * whole or not at all.
 */

function emitContextFor(view: WriterSourceView, indent: string): EmitContext {
  return { indent, indentUnit: view.indentUnit, newline: view.newline }
}

function descendantsOf(view: WriterSourceView, element: WriterElement): WriterElement[] {
  const collected: WriterElement[] = []
  const walk = (current: WriterElement): void => {
    childrenOf(view, current).forEach((child) => {
      collected.push(child)
      walk(child)
    })
  }
  walk(element)
  return collected
}

/** Expand a locale id through the document's internal entity declarations. */
function resolveLocaleId(view: WriterSourceView, localeId: string): string {
  const match = /^&([A-Za-z_][A-Za-z0-9_.:-]*);$/.exec(localeId)
  if (!match) return localeId
  return view.entities.get(match[1]!) ?? localeId
}

function localeIdsMatch(view: WriterSourceView, left: string, right: string): boolean {
  if (left === right) return true
  return resolveLocaleId(view, left) === resolveLocaleId(view, right)
}

// --- Attributes --------------------------------------------------------------------------

/**
 * Set an attribute on an existing element.
 *
 * When the attribute exists, only its VALUE span is replaced. The attribute keeps its position
 * among its siblings and its original quote character, so attribute order and quote style
 * survive exactly as section 9.1 requires. When it does not exist, the new attribute is
 * appended after the last existing one, which is the only insertion point that cannot disturb
 * the order of the attributes already there.
 */
export function setAttributeEdits(
  view: WriterSourceView,
  element: WriterElement,
  name: string,
  value: string
): readonly AmlEdit[] {
  const existing = element.attributeByName.get(name)
  const label = `set ${element.path}/@${name}`
  if (existing) {
    const escaped = escapeXmlAttributeValue(value, `Attribute "${name}"`)
    return [replaceEdit(existing.valueSpan, escaped, label)]
  }
  const last = element.attributes[element.attributes.length - 1]
  const anchor = last
    ? last.span.end
    : element.startTagSpan.start + 1 + element.name.length
  const escaped = escapeXmlAttributeValue(value, `Attribute "${name}"`)
  return [insertEdit(anchor, ` ${name}="${escaped}"`, label)]
}

/** Append an id to a `*.IdRefs` list, creating the attribute when it is absent. */
export function appendIdRefEdits(
  view: WriterSourceView,
  element: WriterElement,
  attributeName: string,
  id: string
): readonly AmlEdit[] {
  if (!isListReferenceAttribute(attributeName)) {
    throw new ArisWriterError(
      'invalid-id',
      `"${attributeName}" is not a list-reference attribute (expected a *.IdRefs name).`,
      { detail: { attributeName } }
    )
  }
  const existing = element.attributeByName.get(attributeName)
  if (!existing) return setAttributeEdits(view, element, attributeName, id)
  const separator = existing.value.length === 0 || /\s$/.test(existing.value) ? '' : ' '
  return [
    insertEdit(
      existing.valueSpan.end,
      `${separator}${escapeXmlAttributeValue(id, attributeName)}`,
      `append ${element.path}/@${attributeName}`
    )
  ]
}

// --- Renaming ids ------------------------------------------------------------------------

/**
 * Rename a source id, rewriting the declaration and every reference in one edit batch.
 *
 * Atomicity is structural: all edits go into a single batch, and `applyAmlEdits` either applies
 * the whole batch or throws. A rename can therefore never leave a dangling reference behind —
 * and the export validator independently re-checks that in the derived document.
 *
 * Note that occurrence-scope ids embed their owning model's id body. Renaming a `Model` does
 * not rewrite that embedded body; the embedded body is decorative in the AML format (occurrence
 * ownership is expressed by nesting, not by the id), and rewriting it would change ids the
 * caller did not ask to change.
 */
export function renameSourceIdEdits(
  view: WriterSourceView,
  from: string,
  to: string
): readonly AmlEdit[] {
  const element = requireElementById(view, from)
  if (element.sourceIdAttribute === null) {
    throw new ArisWriterError('unknown-record', `Element "${element.path}" declares no id.`)
  }
  if (from !== to && view.byId.has(to)) {
    throw new ArisWriterError('invalid-id', `Cannot rename "${from}" to "${to}": id already taken.`, {
      detail: { from, to }
    })
  }
  const declaration = requireAttribute(element, element.sourceIdAttribute)
  const escaped = escapeXmlAttributeValue(to, element.sourceIdAttribute)
  const edits: AmlEdit[] = [
    replaceEdit(declaration.valueSpan, escaped, `rename declaration ${from} -> ${to}`)
  ]
  ;(view.referencesByTarget.get(from) ?? []).forEach((reference, index) => {
    edits.push(
      replaceEdit(reference.span, escaped, `rename reference ${index} ${from} -> ${to}`)
    )
  })
  return edits
}

// --- Localized attributes ----------------------------------------------------------------

export interface LocalizedAttributeEdit {
  /** ARIS attribute type, e.g. `AT_NAME` or `AT_DESC`. */
  readonly type: string
  /** Locale id copied verbatim from the source (`view.localeIds`). */
  readonly localeId: string
  readonly text: string
}

function findPlainTextCarrier(
  view: WriterSourceView,
  attrValue: WriterElement
): WriterElement | null {
  const candidates = descendantsOf(view, attrValue).filter(
    (descendant) => descendant.name === 'PlainText' && descendant.attributeByName.has('TextValue')
  )
  return candidates[candidates.length - 1] ?? null
}

/**
 * Set (or add) a localized attribute value on any record that carries `AttrDef` children.
 *
 * Locale ids are never invented: the caller passes one of `view.localeIds`, which are the raw
 * `LocaleId` tokens the source declared — in the AnimalWF export those are entity references
 * such as `&LocaleId.AEar;`, and they are reproduced verbatim.
 */
export function setLocalizedAttributeEdits(
  view: WriterSourceView,
  ownerId: string,
  change: LocalizedAttributeEdit
): readonly AmlEdit[] {
  const owner = requireElementById(view, ownerId)
  const attrDef = childrenNamed(view, owner, 'AttrDef').find(
    (candidate) => candidate.attributeByName.get('AttrDef.Type')?.value === change.type
  )
  const value: LocalizedTextSpec = { localeId: change.localeId, text: change.text }

  if (!attrDef) {
    return insertChildEdits(
      view,
      owner,
      attrDefSpec({ type: change.type, values: [value] }),
      `add ${change.type} to ${ownerId}`
    )
  }

  const attrValue = childrenNamed(view, attrDef, 'AttrValue').find((candidate) => {
    const localeId = candidate.attributeByName.get('LocaleId')?.value
    return localeId !== undefined && localeIdsMatch(view, localeId, change.localeId)
  })

  if (!attrValue) {
    return insertChildEdits(
      view,
      attrDef,
      attrValueSpec(value),
      `add ${change.type} ${change.localeId} to ${ownerId}`
    )
  }

  const carrier = findPlainTextCarrier(view, attrValue)
  if (carrier) return setAttributeEdits(view, carrier, 'TextValue', change.text)

  if (attrValue.contentSpan === null) {
    return insertChildEdits(view, attrValue, styledTextSpec(change.text), `set ${ownerId}`)
  }
  const context = emitContextFor(view, attrValue.indent + view.indentUnit)
  const rendered = renderRecord(styledTextSpec(change.text), context)
  return [
    replaceEdit(
      attrValue.contentSpan,
      `${view.newline}${rendered}${view.newline}${attrValue.indent}`,
      `set ${change.type} ${change.localeId} on ${ownerId}`
    )
  ]
}

// --- Geometry ----------------------------------------------------------------------------

function requireGeometryChild(
  view: WriterSourceView,
  occurrenceId: string,
  childName: string
): WriterElement {
  const occurrence = requireElementById(view, occurrenceId)
  const child = childrenNamed(view, occurrence, childName)[0]
  if (!child) {
    throw new ArisWriterError(
      'unknown-record',
      `Occurrence "${occurrenceId}" has no <${childName}> child to update.`,
      { detail: { occurrenceId, childName } }
    )
  }
  return child
}

/** Move an occurrence by rewriting its first `<Position>` child in place. */
export function moveOccurrenceEdits(
  view: WriterSourceView,
  occurrenceId: string,
  point: PointSpec
): readonly AmlEdit[] {
  const position = requireGeometryChild(view, occurrenceId, 'Position')
  return [
    ...setAttributeEdits(view, position, 'Pos.X', String(point.x)),
    ...setAttributeEdits(view, position, 'Pos.Y', String(point.y))
  ]
}

/** Resize an occurrence by rewriting its `<Size>` child in place. */
export function resizeOccurrenceEdits(
  view: WriterSourceView,
  occurrenceId: string,
  size: SizeSpec
): readonly AmlEdit[] {
  const element = requireGeometryChild(view, occurrenceId, 'Size')
  return [
    ...setAttributeEdits(view, element, 'Size.dX', String(size.dx)),
    ...setAttributeEdits(view, element, 'Size.dY', String(size.dy))
  ]
}

/**
 * Replace a connection occurrence's route with a new point list.
 *
 * The whole run of `<Position>` children is replaced by one edit spanning from the first to the
 * last, so the `<Pen>` before it and any `<AttrOcc>` after it — including their formatting —
 * are untouched.
 */
export function rerouteConnectionEdits(
  view: WriterSourceView,
  connectionOccurrenceId: string,
  points: readonly PointSpec[]
): readonly AmlEdit[] {
  if (points.length === 0) {
    throw new ArisWriterError(
      'ambiguous-anchor',
      `Rerouting "${connectionOccurrenceId}" needs at least one route point.`
    )
  }
  const occurrence = requireElementById(view, connectionOccurrenceId)
  const positions = childrenNamed(view, occurrence, 'Position')

  if (positions.length === 0) {
    return points.flatMap((point, index) =>
      insertChildEdits(view, occurrence, positionSpec(point), `reroute point ${index}`)
    )
  }

  const context = emitContextFor(view, positions[0]!.indent)
  const rendered = points
    .map((point) => renderRecord(positionSpec(point), context))
    .join(view.newline)

  const first = positions[0]!
  const last = positions[positions.length - 1]!
  return [
    replaceEdit(
      makeSpan(first.span.start, last.span.end),
      rendered.slice(context.indent.length),
      `reroute ${connectionOccurrenceId}`
    )
  ]
}

// --- Structural insertion ----------------------------------------------------------------

/**
 * Insert a rendered record as a child of `parent`, at the position the parent's canonical child
 * order demands (plan section 9.2, "Add geometry/style records in canonical order").
 *
 * The anchor is always "immediately after the last existing child whose canonical rank is not
 * greater than the new child's", falling back to the start of the parent's content. A
 * self-closing parent is expanded into an open/close pair.
 */
export function insertChildEdits(
  view: WriterSourceView,
  parent: WriterElement,
  spec: ElementSpec,
  label: string
): readonly AmlEdit[] {
  const children = childrenOf(view, parent)
  const siblingIndent = children[0]?.indent ?? parent.indent + view.indentUnit
  const context = emitContextFor(view, siblingIndent)
  const rendered = renderRecord(spec, context)

  if (parent.selfClosing) {
    const closeStart = parent.startTagSpan.end - 2
    return [
      replaceEdit(
        makeSpan(closeStart, parent.startTagSpan.end),
        `>${view.newline}${rendered}${view.newline}${parent.indent}</${parent.name}>`,
        label
      )
    ]
  }
  if (parent.contentSpan === null) {
    throw new ArisWriterError(
      'ambiguous-anchor',
      `Element "${parent.path}" has no content region to insert into.`,
      { detail: { path: parent.path } }
    )
  }

  const rank = canonicalChildRank(parent.name, spec.name)
  let anchor = parent.contentSpan.start
  children.forEach((child) => {
    if (canonicalChildRank(parent.name, child.name) <= rank) anchor = child.span.end
  })
  return [insertEdit(anchor, `${view.newline}${rendered}`, label)]
}

// --- Structural deletion -----------------------------------------------------------------

/** Extend a delete span backwards over the element's own indentation and line break. */
function deletionSpan(view: WriterSourceView, element: WriterElement): WriterSpan {
  let start = element.span.start
  while (start > 0 && (view.text[start - 1] === ' ' || view.text[start - 1] === '\t')) start -= 1
  if (start > 0 && view.text[start - 1] === '\n') {
    start -= 1
    if (start > 0 && view.text[start - 1] === '\r') start -= 1
  } else {
    start = element.span.start
  }
  return makeSpan(start, element.span.end)
}

export interface DeleteRecordResult {
  readonly edits: readonly AmlEdit[]
  /** Every id removed, including ids of descendants of the deleted elements. */
  readonly deletedIds: readonly string[]
  /**
   * References through a single-valued `*.IdRef` attribute that would be left dangling.
   * `deleteRecordsCascade` resolves these by deleting the referring records too.
   */
  readonly danglingSingleReferences: readonly WriterReference[]
}

function rebuildListValue(originalValue: string, removed: ReadonlySet<string>): string {
  return originalValue
    .split(/(\s+)/)
    .filter((piece, index) => index % 2 === 1 || !removed.has(piece))
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Delete one or more records by id, cleaning every `*.IdRefs` list that mentioned them.
 *
 * Deleting an element deletes its descendants with it, so nested targets are collapsed into a
 * single span and can never produce overlapping edits.
 */
export function deleteRecordEdits(
  view: WriterSourceView,
  ids: readonly string[]
): DeleteRecordResult {
  const targets = ids.map((id) => requireElementById(view, id))
  const outermost = targets.filter(
    (candidate) =>
      !targets.some(
        (other) =>
          other !== candidate &&
          other.span.start <= candidate.span.start &&
          other.span.end >= candidate.span.end
      )
  )
  const unique = [...new Map(outermost.map((element) => [element.path, element])).values()]

  const deletedIds = new Set<string>()
  unique.forEach((element) => {
    if (element.sourceId !== null) deletedIds.add(element.sourceId)
    descendantsOf(view, element).forEach((descendant) => {
      if (descendant.sourceId !== null) deletedIds.add(descendant.sourceId)
    })
  })

  const insideDeleted = (span: WriterSpan): boolean =>
    unique.some((element) => span.start >= element.span.start && span.end <= element.span.end)

  const edits: AmlEdit[] = unique.map((element) =>
    deleteEdit(deletionSpan(view, element), `delete ${element.sourceId ?? element.path}`)
  )

  const dangling: WriterReference[] = []
  const listAttributes = new Map<string, WriterReference[]>()
  view.references.forEach((reference) => {
    if (!deletedIds.has(reference.targetId)) return
    if (insideDeleted(reference.span)) return
    if (reference.list) {
      const key = `${reference.elementPath}#${reference.attributeName}`
      const bucket = listAttributes.get(key)
      if (bucket) bucket.push(reference)
      else listAttributes.set(key, [reference])
    } else {
      dangling.push(reference)
    }
  })

  listAttributes.forEach((references) => {
    const first = references[0]!
    const element = view.byPath.get(first.elementPath)
    if (!element) return
    const attribute = requireAttribute(element, first.attributeName)
    const rebuilt = rebuildListValue(attribute.value, deletedIds)
    edits.push(
      replaceEdit(
        attribute.valueSpan,
        escapeXmlAttributeValue(rebuilt, first.attributeName),
        `prune ${first.elementPath}/@${first.attributeName}`
      )
    )
  })

  return {
    edits,
    deletedIds: [...deletedIds],
    danglingSingleReferences: dangling
  }
}

/**
 * Delete records and everything that would be left dangling by the deletion.
 *
 * Deleting an object definition therefore also deletes its occurrences (which reference it
 * through `ObjDef.IdRef`) and, transitively, the connection occurrences attached to those.
 */
export function deleteRecordsCascade(
  view: WriterSourceView,
  ids: readonly string[]
): DeleteRecordResult {
  const pending = new Set(ids)
  for (let round = 0; round < 32; round += 1) {
    const result = deleteRecordEdits(view, [...pending])
    if (result.danglingSingleReferences.length === 0) return result
    let grew = false
    result.danglingSingleReferences.forEach((reference) => {
      const element = view.byPath.get(reference.elementPath)
      if (!element) return
      const id = nearestIdentifiedAncestor(view, element)
      if (id !== null && !pending.has(id)) {
        pending.add(id)
        grew = true
      }
    })
    if (!grew) return result
  }
  throw new ArisWriterError(
    'ambiguous-anchor',
    'Cascading delete did not converge; the reference graph appears cyclic.'
  )
}

/** The id of `element` or, failing that, of its closest ancestor that declares one. */
function nearestIdentifiedAncestor(
  view: WriterSourceView,
  element: WriterElement
): string | null {
  let current: WriterElement | null = element
  while (current !== null) {
    if (current.sourceId !== null) return current.sourceId
    current = current.parentPath === null ? null : (view.byPath.get(current.parentPath) ?? null)
  }
  return null
}

// --- Record creation ---------------------------------------------------------------------

/** Insert a new object definition into a group (plan section 9.2, bullet 2). */
export function createObjectDefinitionEdits(
  view: WriterSourceView,
  groupId: string,
  definition: ObjectDefinitionSpec
): readonly AmlEdit[] {
  const group = requireElementById(view, groupId)
  if (group.name !== 'Group') {
    throw new ArisWriterError(
      'unknown-record',
      `"${groupId}" is a <${group.name}>, not a <Group>; object definitions live in groups.`
    )
  }
  return insertChildEdits(view, group, objectDefinitionSpec(definition), `create ${definition.id}`)
}

/** Insert a new occurrence into its model (plan section 9.2, bullet 3). */
export function createObjectOccurrenceEdits(
  view: WriterSourceView,
  modelId: string,
  occurrence: ObjectOccurrenceSpec
): readonly AmlEdit[] {
  const model = requireElementById(view, modelId)
  if (model.name !== 'Model') {
    throw new ArisWriterError(
      'unknown-record',
      `"${modelId}" is a <${model.name}>, not a <Model>; occurrences live in models.`
    )
  }
  return insertChildEdits(view, model, objectOccurrenceSpec(occurrence), `create ${occurrence.id}`)
}

/**
 * Insert a connection definition under its SOURCE object definition and register it in that
 * definition's `ToCxnDefs.IdRefs` list (plan section 9.2, bullet 4).
 */
export function createConnectionDefinitionEdits(
  view: WriterSourceView,
  sourceObjectDefinitionId: string,
  definition: ConnectionDefinitionSpec
): readonly AmlEdit[] {
  const source = requireElementById(view, sourceObjectDefinitionId)
  if (source.name !== 'ObjDef') {
    throw new ArisWriterError(
      'unknown-record',
      `"${sourceObjectDefinitionId}" is a <${source.name}>; a connection definition must be ` +
        'nested under its source <ObjDef>.'
    )
  }
  return [
    ...insertChildEdits(view, source, connectionDefinitionSpec(definition), `create ${definition.id}`),
    ...appendIdRefEdits(view, source, 'ToCxnDefs.IdRefs', definition.id)
  ]
}

/**
 * Insert a connection occurrence under its SOURCE object occurrence and register it in that
 * occurrence's `ToCxnOccs.IdRefs` list (plan section 9.2, bullet 5).
 */
export function createConnectionOccurrenceEdits(
  view: WriterSourceView,
  sourceObjectOccurrenceId: string,
  occurrence: ConnectionOccurrenceSpec
): readonly AmlEdit[] {
  const source = requireElementById(view, sourceObjectOccurrenceId)
  if (source.name !== 'ObjOcc') {
    throw new ArisWriterError(
      'unknown-record',
      `"${sourceObjectOccurrenceId}" is a <${source.name}>; a connection occurrence must be ` +
        'nested under its source <ObjOcc>.'
    )
  }
  return [
    ...insertChildEdits(
      view,
      source,
      connectionOccurrenceSpec(occurrence),
      `create ${occurrence.id}`
    ),
    ...appendIdRefEdits(view, source, 'ToCxnOccs.IdRefs', occurrence.id)
  ]
}

export type { AttributeDefinitionSpec, PointSpec, SizeSpec }
