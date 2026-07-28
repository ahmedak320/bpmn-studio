import { ArisWriterError } from './errors'
import {
  assertSourceLocaleId,
  assertXmlName,
  escapeXmlAttributeValue,
  escapeXmlText
} from './escapeXml'

/**
 * Emission of brand-new AML records (plan section 9.2).
 *
 * Child order matters to ARIS: the AnimalWF export writes each record's children in one fixed
 * sequence, and the renderers below reproduce it by construction rather than trusting the
 * caller. {@link CANONICAL_CHILD_ORDER} is the sequence observed in that export.
 */
export const CANONICAL_CHILD_ORDER: Readonly<Record<string, readonly string[]>> = Object.freeze({
  AML: Object.freeze(['Header-Info', 'Language', 'FontStyleSheet', 'FFTextDef', 'OLEDef', 'Group']),
  Group: Object.freeze(['GUID', 'AttrDef', 'Group', 'ObjDef', 'Model']),
  ObjDef: Object.freeze(['GUID', 'MasterGUID', 'SymbolGUID', 'AttrDef', 'CxnDef']),
  Model: Object.freeze([
    'Flag',
    'GUID',
    'MasterGUID',
    'TemplateGUID',
    'Lane',
    'AttrDef',
    'ObjOcc',
    'FFTextOcc',
    'GfxObj',
    'OLEOcc',
    'Union'
  ]),
  ObjOcc: Object.freeze([
    'SymbolGUID',
    'Brush',
    'Pen',
    'Position',
    'Size',
    'ExternalGUID',
    'CxnOcc',
    'AttrOcc'
  ]),
  CxnDef: Object.freeze(['GUID']),
  CxnOcc: Object.freeze(['Pen', 'Position', 'AttrOcc']),
  AttrDef: Object.freeze(['AttrValue']),
  AttrOcc: Object.freeze(['Size']),
  Lane: Object.freeze(['GUID', 'Pen', 'Brush', 'AttrDef']),
  FFTextDef: Object.freeze(['GUID', 'AttrDef']),
  FFTextOcc: Object.freeze(['Position', 'Size']),
  OLEDef: Object.freeze(['GUID', 'Blob', 'AttrDef']),
  OLEOcc: Object.freeze(['Position', 'Size'])
})

/**
 * Rank of `child` within `parent`'s canonical order, or `Infinity` when the parent has no
 * recorded order (unknown/extension elements sort last, so they are never interleaved into a
 * known sequence).
 */
export function canonicalChildRank(parent: string, child: string): number {
  const order = CANONICAL_CHILD_ORDER[parent]
  if (!order) return Number.POSITIVE_INFINITY
  const index = order.indexOf(child)
  return index === -1 ? Number.POSITIVE_INFINITY : index
}

export interface EmitContext {
  /** Indentation already applied to the element's opening line. */
  readonly indent: string
  readonly indentUnit: string
  readonly newline: string
}

export const DEFAULT_EMIT_CONTEXT: EmitContext = Object.freeze({
  indent: '',
  indentUnit: '\t',
  newline: '\n'
})

/**
 * An attribute to emit. `raw: true` bypasses escaping and is reserved for tokens copied
 * verbatim out of the source (locale ids, which the AnimalWF export writes as entity
 * references). Raw values are validated by their caller before reaching here.
 */
export interface EmittedAttribute {
  readonly name: string
  readonly value: string
  readonly raw?: boolean
}

export function renderAttributes(attributes: readonly EmittedAttribute[]): string {
  return attributes
    .map((attribute) => {
      assertXmlName(attribute.name, 'Attribute name')
      const value = attribute.raw === true
        ? attribute.value
        : escapeXmlAttributeValue(attribute.value, `Attribute "${attribute.name}"`)
      return ` ${attribute.name}="${value}"`
    })
    .join('')
}

export interface ElementSpec {
  readonly name: string
  readonly attributes?: readonly EmittedAttribute[]
  readonly children?: readonly ElementSpec[]
  /** Text content. Mutually exclusive with `children`. */
  readonly text?: string
}

/**
 * Render an element tree to XML, sorting children into their parent's canonical order.
 *
 * Sorting is stable within a rank, so two `Position` children of a `CxnOcc` keep the route order
 * the caller supplied.
 */
export function renderElementSpec(spec: ElementSpec, context: EmitContext): string {
  assertXmlName(spec.name, 'Element name')
  const attributes = renderAttributes(spec.attributes ?? [])
  if (spec.text !== undefined && spec.children !== undefined && spec.children.length > 0) {
    throw new ArisWriterError(
      'ambiguous-anchor',
      `Element <${spec.name}> was given both text and child elements.`,
      { detail: { element: spec.name } }
    )
  }
  if (spec.text !== undefined) {
    return `${context.indent}<${spec.name}${attributes}>${escapeXmlText(spec.text, `<${spec.name}> text`)}</${spec.name}>`
  }
  const declared = spec.children ?? []
  if (declared.length === 0) return `${context.indent}<${spec.name}${attributes}/>`

  const children = declared
    .map((child, index) => ({ child, index, rank: canonicalChildRank(spec.name, child.name) }))
    .sort((a, b) => (a.rank === b.rank ? a.index - b.index : a.rank - b.rank))
    .map((entry) => entry.child)

  const childContext: EmitContext = {
    indent: context.indent + context.indentUnit,
    indentUnit: context.indentUnit,
    newline: context.newline
  }
  const body = children
    .map((child) => renderElementSpec(child, childContext))
    .join(context.newline)
  return (
    `${context.indent}<${spec.name}${attributes}>${context.newline}` +
    `${body}${context.newline}${context.indent}</${spec.name}>`
  )
}

// --- ARIS record specs -------------------------------------------------------------------

export interface LocalizedTextSpec {
  /** A locale id taken verbatim from the source document (`1033` or `&LocaleId.USen;`). */
  readonly localeId: string
  readonly text: string
}

export interface AttributeDefinitionSpec {
  /** ARIS attribute type, e.g. `AT_NAME`. */
  readonly type: string
  readonly values: readonly LocalizedTextSpec[]
}

export interface PointSpec {
  readonly x: number
  readonly y: number
}

export interface SizeSpec {
  readonly dx: number
  readonly dy: number
}

export interface AttributeOccurrenceSpec {
  readonly typeNum: string
  readonly fontStyleSheetId?: string
  readonly port?: string
  readonly alignment?: string
  readonly size?: SizeSpec
}

function integerAttribute(name: string, value: number): EmittedAttribute {
  if (!Number.isInteger(value)) {
    throw new ArisWriterError('invalid-character', `Attribute "${name}" must be an integer.`, {
      detail: { name, value }
    })
  }
  return { name, value: String(value) }
}

/**
 * `<AttrValue>` carrying a single styled paragraph — the shape ARIS itself writes for a plain
 * localized name. The locale id is emitted verbatim so an entity-reference locale id survives.
 */
export function styledTextSpec(text: string): ElementSpec {
  return {
    name: 'StyledElement',
    children: [
      {
        name: 'Paragraph',
        attributes: [
          { name: 'Alignment', value: 'UNDEFINED' },
          { name: 'Indent', value: '0' }
        ]
      },
      {
        name: 'StyledElement',
        children: [{ name: 'PlainText', attributes: [{ name: 'TextValue', value: text }] }]
      }
    ]
  }
}

export function attrValueSpec(value: LocalizedTextSpec): ElementSpec {
  return {
    name: 'AttrValue',
    attributes: [{ name: 'LocaleId', value: assertSourceLocaleId(value.localeId), raw: true }],
    children: [styledTextSpec(value.text)]
  }
}

export function attrDefSpec(definition: AttributeDefinitionSpec): ElementSpec {
  return {
    name: 'AttrDef',
    attributes: [{ name: 'AttrDef.Type', value: definition.type }],
    children: definition.values.map(attrValueSpec)
  }
}

function attrOccSpec(occurrence: AttributeOccurrenceSpec): ElementSpec {
  const attributes: EmittedAttribute[] = [{ name: 'AttrTypeNum', value: occurrence.typeNum }]
  if (occurrence.port !== undefined) attributes.push({ name: 'Port', value: occurrence.port })
  if (occurrence.alignment !== undefined) {
    attributes.push({ name: 'Alignment', value: occurrence.alignment })
  }
  if (occurrence.fontStyleSheetId !== undefined) {
    attributes.push({ name: 'FontSS.IdRef', value: occurrence.fontStyleSheetId })
  }
  const children: ElementSpec[] = []
  if (occurrence.size) {
    children.push({
      name: 'Size',
      attributes: [
        integerAttribute('Size.dX', occurrence.size.dx),
        integerAttribute('Size.dY', occurrence.size.dy)
      ]
    })
  }
  return { name: 'AttrOcc', attributes, children }
}

export function positionSpec(point: PointSpec): ElementSpec {
  return {
    name: 'Position',
    attributes: [integerAttribute('Pos.X', point.x), integerAttribute('Pos.Y', point.y)]
  }
}

export function sizeSpec(size: SizeSpec): ElementSpec {
  return {
    name: 'Size',
    attributes: [integerAttribute('Size.dX', size.dx), integerAttribute('Size.dY', size.dy)]
  }
}

export interface ObjectDefinitionSpec {
  readonly id: string
  readonly typeNum: string
  readonly symbolNum?: string
  readonly guid?: string
  readonly connectionDefinitionIds?: readonly string[]
  readonly attributes?: readonly AttributeDefinitionSpec[]
  readonly connectionDefinitions?: readonly ConnectionDefinitionSpec[]
}

export function objectDefinitionSpec(definition: ObjectDefinitionSpec): ElementSpec {
  const attributes: EmittedAttribute[] = [
    { name: 'ObjDef.ID', value: definition.id },
    { name: 'TypeNum', value: definition.typeNum }
  ]
  if (definition.symbolNum !== undefined) {
    attributes.push({ name: 'SymbolNum', value: definition.symbolNum })
  }
  if (definition.connectionDefinitionIds && definition.connectionDefinitionIds.length > 0) {
    attributes.push({
      name: 'ToCxnDefs.IdRefs',
      value: definition.connectionDefinitionIds.join(' ')
    })
  }
  const children: ElementSpec[] = []
  if (definition.guid !== undefined) children.push({ name: 'GUID', text: definition.guid })
  ;(definition.attributes ?? []).forEach((attribute) => children.push(attrDefSpec(attribute)))
  ;(definition.connectionDefinitions ?? []).forEach((connection) =>
    children.push(connectionDefinitionSpec(connection))
  )
  return { name: 'ObjDef', attributes, children }
}

export interface ConnectionDefinitionSpec {
  readonly id: string
  readonly type: string
  readonly targetObjectDefinitionId: string
  readonly guid?: string
}

export function connectionDefinitionSpec(definition: ConnectionDefinitionSpec): ElementSpec {
  const children: ElementSpec[] = []
  if (definition.guid !== undefined) children.push({ name: 'GUID', text: definition.guid })
  return {
    name: 'CxnDef',
    attributes: [
      { name: 'CxnDef.ID', value: definition.id },
      { name: 'CxnDef.Type', value: definition.type },
      { name: 'ToObjDef.IdRef', value: definition.targetObjectDefinitionId }
    ],
    children
  }
}

export interface ObjectOccurrenceSpec {
  readonly id: string
  readonly objectDefinitionId: string
  readonly symbolNum?: string
  readonly position: PointSpec
  readonly size: SizeSpec
  readonly brushColor?: string
  readonly connectionOccurrenceIds?: readonly string[]
  readonly connectionOccurrences?: readonly ConnectionOccurrenceSpec[]
  readonly attributeOccurrences?: readonly AttributeOccurrenceSpec[]
}

export function objectOccurrenceSpec(occurrence: ObjectOccurrenceSpec): ElementSpec {
  const attributes: EmittedAttribute[] = [
    { name: 'ObjOcc.ID', value: occurrence.id },
    { name: 'ObjDef.IdRef', value: occurrence.objectDefinitionId }
  ]
  if (occurrence.connectionOccurrenceIds && occurrence.connectionOccurrenceIds.length > 0) {
    attributes.push({
      name: 'ToCxnOccs.IdRefs',
      value: occurrence.connectionOccurrenceIds.join(' ')
    })
  }
  if (occurrence.symbolNum !== undefined) {
    attributes.push({ name: 'SymbolNum', value: occurrence.symbolNum })
  }
  const children: ElementSpec[] = []
  if (occurrence.brushColor !== undefined) {
    children.push({
      name: 'Brush',
      attributes: [
        { name: 'Color', value: occurrence.brushColor },
        { name: 'Color2', value: '0' },
        { name: 'BrushType', value: 'SOLID' }
      ]
    })
  }
  children.push(positionSpec(occurrence.position))
  children.push(sizeSpec(occurrence.size))
  ;(occurrence.connectionOccurrences ?? []).forEach((connection) =>
    children.push(connectionOccurrenceSpec(connection))
  )
  ;(occurrence.attributeOccurrences ?? []).forEach((attribute) =>
    children.push(attrOccSpec(attribute))
  )
  return { name: 'ObjOcc', attributes, children }
}

export interface ConnectionOccurrenceSpec {
  readonly id: string
  readonly connectionDefinitionId: string
  readonly targetObjectOccurrenceId: string
  readonly points: readonly PointSpec[]
  readonly penColor?: string
  readonly attributeOccurrences?: readonly AttributeOccurrenceSpec[]
}

export function connectionOccurrenceSpec(occurrence: ConnectionOccurrenceSpec): ElementSpec {
  if (occurrence.points.length === 0) {
    throw new ArisWriterError(
      'ambiguous-anchor',
      `Connection occurrence "${occurrence.id}" needs at least one route point.`,
      { detail: { id: occurrence.id } }
    )
  }
  const children: ElementSpec[] = [
    {
      name: 'Pen',
      attributes: [
        { name: 'Color', value: occurrence.penColor ?? '0' },
        { name: 'Style', value: '0' },
        { name: 'Width', value: '1' }
      ]
    },
    ...occurrence.points.map(positionSpec),
    ...(occurrence.attributeOccurrences ?? []).map(attrOccSpec)
  ]
  return {
    name: 'CxnOcc',
    attributes: [
      { name: 'CxnOcc.ID', value: occurrence.id },
      { name: 'CxnDef.IdRef', value: occurrence.connectionDefinitionId },
      { name: 'ToObjOcc.IdRef', value: occurrence.targetObjectOccurrenceId }
    ],
    children
  }
}

/** Render any record spec to XML at the given indentation. */
export function renderRecord(spec: ElementSpec, context: EmitContext = DEFAULT_EMIT_CONTEXT): string {
  return renderElementSpec(spec, context)
}
