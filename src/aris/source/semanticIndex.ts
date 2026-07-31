import { decodeAmlEntities, localeLang } from '../../library/amlParse'
import type { TokenizedXmlDocument, XmlElementNode, XmlNode, XmlSpan } from './xmlTokenizer'

export type AmlDiagnosticSeverity = 'warning' | 'error'

export interface AmlDiagnostic {
  readonly severity: AmlDiagnosticSeverity
  readonly code: string
  readonly message: string
  readonly path: string | null
  readonly sourceId: string | null
  readonly span: XmlSpan | null
}

export interface ArisSourceParentRelationship {
  readonly elementName: string
  readonly path: string
  readonly sourceId: string | null
}

export interface ArisSourceRecordBase<TParsed extends Record<string, unknown>> {
  readonly recordKind: string
  readonly elementName: string
  readonly sourceId: string | null
  readonly path: string
  readonly parent: ArisSourceParentRelationship | null
  readonly span: XmlSpan
  readonly rawAttributes: Readonly<Record<string, string>>
  readonly parsed: Readonly<TParsed>
  readonly unknownAttributes: Readonly<Record<string, string>>
  readonly unknownChildren: readonly string[]
}

/**
 * A single styled-text descendant of an `AttrValue` (`StyledElement`, `Paragraph`, `Bold`,
 * `PlainText`, `LineBreak`, `Font`, …). These elements are absorbed into their owning
 * attribute record rather than being indexed separately, so the run list is what guarantees
 * their raw attributes, byte spans, and paths survive the semantic pass.
 */
export interface ArisStyledRunRecord {
  readonly elementName: string
  readonly path: string
  readonly span: XmlSpan
  readonly rawAttributes: Readonly<Record<string, string>>
  /** Decoded CSS colors; `rawAttributes` remains byte-for-byte source evidence. */
  readonly decodedColors: ArisDecodedColorAttributes
  readonly text: string
}

/** Every AML color spelling a styled/source element can carry, decoded at the source boundary. */
export interface ArisDecodedColorAttributes {
  readonly color: string | null
  readonly color2: string | null
  readonly fillColor: string | null
  readonly backColor: string | null
  readonly textColor: string | null
}

/**
 * Decode a Windows COLORREF serialized by AML.
 *
 * AML stores the numeric value as an unpadded hexadecimal `0xBBGGRR`. CSS needs `#RRGGBB`, so
 * the low and high bytes must be exchanged (`d7c49d` → `#9dc4d7`). The raw attribute remains on
 * each semantic record for lossless round-trip; parsed color fields use only this unambiguous CSS
 * spelling. `-1` is the Windows "no color" sentinel.
 */
export function amlColorRefToCss(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null
  const trimmed = raw.trim()
  if (trimmed === '' || trimmed === '-1' || !/^[0-9a-fA-F]{1,8}$/u.test(trimmed)) return null
  const parsed = Number.parseInt(trimmed, 16)
  if (!Number.isFinite(parsed) || Number.isNaN(parsed) || parsed < 0) return null
  const colorRef = Math.min(parsed, 0xffffff)
  const red = colorRef & 0xff
  const green = (colorRef >>> 8) & 0xff
  const blue = (colorRef >>> 16) & 0xff
  return `#${[red, green, blue].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`
}

function decodeColorAttributes(
  attributes: Readonly<Record<string, string>>
): ArisDecodedColorAttributes {
  return Object.freeze({
    color: amlColorRefToCss(attributes.Color),
    color2: amlColorRefToCss(attributes.Color2),
    fillColor: amlColorRefToCss(attributes.FillColor),
    backColor: amlColorRefToCss(attributes.BackColor),
    textColor: amlColorRefToCss(attributes.TextColor)
  })
}

export interface ArisAttributeValueRecord {
  readonly localeId: string | null
  readonly locale: 'en' | 'ar' | undefined
  readonly text: string
  readonly path: string
  readonly span: XmlSpan
  readonly runs: readonly ArisStyledRunRecord[]
}

export type ArisFontRecord = ArisSourceRecordBase<{
  readonly ownerElementName: string | null
  readonly ownerPath: string | null
  readonly ownerSourceId: string | null
  readonly localeId: string | null
  readonly locale: 'en' | 'ar' | undefined
  readonly faceName: string | null
  readonly height: number | null
  readonly width: number | null
  readonly weight: number | null
  readonly italic: string | null
  readonly underline: string | null
  readonly strikeOut: string | null
  readonly color: string | null
  readonly sourceTag: 'Font' | 'FontNode' | 'LogFont'
}>

export type ArisPenRecord = ArisSourceRecordBase<{
  readonly ownerElementName: string | null
  readonly ownerPath: string | null
  readonly ownerSourceId: string | null
  readonly color: string | null
  readonly style: string | null
  readonly width: number | null
}>

export type ArisBrushRecord = ArisSourceRecordBase<{
  readonly ownerElementName: string | null
  readonly ownerPath: string | null
  readonly ownerSourceId: string | null
  readonly color: string | null
  readonly color2: string | null
  readonly brushType: string | null
}>

export type ArisPositionRecord = ArisSourceRecordBase<{
  readonly ownerElementName: string | null
  readonly ownerPath: string | null
  readonly ownerSourceId: string | null
  readonly x: number | null
  readonly y: number | null
}>

export type ArisSizeRecord = ArisSourceRecordBase<{
  readonly ownerElementName: string | null
  readonly ownerPath: string | null
  readonly ownerSourceId: string | null
  readonly dx: number | null
  readonly dy: number | null
}>

export interface ArisRoutePointRecord {
  readonly connectionOccurrenceId: string | null
  readonly modelId: string | null
  readonly path: string
  readonly span: XmlSpan
  readonly pointIndex: number
  readonly x: number | null
  readonly y: number | null
}

export interface ArisGuidReferenceRecord {
  readonly guidType: 'GUID' | 'MasterGUID' | 'SymbolGUID' | 'TemplateGUID' | 'ExternalGUID'
  readonly value: string
  readonly ownerElementName: string | null
  readonly ownerPath: string | null
  readonly ownerSourceId: string | null
  readonly path: string
  readonly span: XmlSpan
}

export type ArisDatabaseRecord = ArisSourceRecordBase<{
  readonly databaseName: string | null
  readonly createDate: string | null
  readonly createTime: string | null
  readonly userName: string | null
  readonly arisExeVersion: string | null
}>

export type ArisLanguageRecord = ArisSourceRecordBase<{
  readonly localeId: string | null
  readonly locale: 'en' | 'ar' | undefined
  readonly codepage: string | null
  readonly languageName: string | null
}>

export type ArisGroupRecord = ArisSourceRecordBase<{
  readonly groupId: string | null
  readonly parentGroupId: string | null
  readonly typeNum: string | null
  readonly creator: string | null
  readonly creationTimestamp: string | null
  readonly lastModifier: string | null
  readonly lastModificationTimestamp: string | null
  readonly lastUpdated: string | null
  readonly compositePosition: number | null
  readonly compositeType: number | null
  readonly guid: string | null
}>

export type ArisModelRecord = ArisSourceRecordBase<{
  readonly modelId: string | null
  readonly groupId: string | null
  readonly modelType: string | null
  readonly attrHandling: string | null
  readonly cxnMode: string | null
  readonly gridUse: string | null
  readonly gridSize: number | null
  readonly scale: number | null
  readonly printScale: number | null
  readonly backColor: string | null
  readonly curveRadius: number | null
  readonly arcRadius: number | null
  readonly creator: string | null
  readonly creationTimestamp: string | null
  readonly lastModifier: string | null
  readonly lastModificationTimestamp: string | null
  readonly flag: string | null
  readonly guid: string | null
  readonly masterGuid: string | null
  readonly templateGuid: string | null
}>

export type ArisObjectDefinitionRecord = ArisSourceRecordBase<{
  readonly objectDefinitionId: string | null
  readonly groupId: string | null
  readonly typeNum: string | null
  readonly symbolNum: string | null
  readonly creator: string | null
  readonly creationTimestamp: string | null
  readonly lastModifier: string | null
  readonly lastModificationTimestamp: string | null
  readonly lastUpdated: string | null
  readonly compositePosition: number | null
  readonly compositeType: number | null
  readonly linkedModelIds: readonly string[]
  readonly outboundConnectionDefinitionIds: readonly string[]
  readonly guid: string | null
  readonly masterGuid: string | null
  readonly symbolGuid: string | null
}>

export type ArisObjectOccurrenceRecord = ArisSourceRecordBase<{
  readonly objectOccurrenceId: string | null
  readonly modelId: string | null
  readonly objectDefinitionId: string | null
  readonly symbolNum: string | null
  readonly toConnectionOccurrenceIds: readonly string[]
  readonly flags: string | null
  readonly zorder: number | null
  readonly hints: string | null
  readonly sequenceNumber: number | null
  readonly x: number | null
  readonly y: number | null
  readonly dx: number | null
  readonly dy: number | null
  readonly externalGuid: string | null
  readonly symbolGuid: string | null
  readonly fillColor: string | null
  readonly strokeColor: string | null
}>

export type ArisConnectionDefinitionRecord = ArisSourceRecordBase<{
  readonly connectionDefinitionId: string | null
  readonly fromObjectDefinitionId: string | null
  readonly toObjectDefinitionId: string | null
  readonly connectionType: string | null
  readonly sourceOrderNum: number | null
  readonly targetOrderNum: number | null
  readonly creator: string | null
  readonly creationTimestamp: string | null
  readonly lastModifier: string | null
  readonly lastModificationTimestamp: string | null
  readonly guid: string | null
}>

export type ArisConnectionOccurrenceRecord = ArisSourceRecordBase<{
  readonly connectionOccurrenceId: string | null
  readonly modelId: string | null
  readonly fromObjectOccurrenceId: string | null
  readonly toObjectOccurrenceId: string | null
  readonly connectionDefinitionId: string | null
  readonly zorder: number | null
  readonly hints: string | null
  readonly srcArrow: string | null
  readonly tgtArrow: string | null
  readonly embedding: string | null
  readonly visible: string | null
  readonly routePointCount: number
  readonly color: string | null
}>

export type ArisAttributeRecord = ArisSourceRecordBase<{
  readonly ownerElementName: string | null
  readonly ownerPath: string | null
  readonly ownerSourceId: string | null
  readonly attributeType: string | null
  readonly values: readonly ArisAttributeValueRecord[]
}>

export type ArisAttributeOccurrenceRecord = ArisSourceRecordBase<{
  readonly ownerElementName: string | null
  readonly ownerPath: string | null
  readonly ownerSourceId: string | null
  readonly attributeType: string | null
  readonly port: string | null
  readonly orderNum: number | null
  readonly alignment: string | null
  readonly symbolFlag: string | null
  readonly fontStyleSheetId: string | null
  readonly offsetX: number | null
  readonly offsetY: number | null
  readonly rotation: number | null
  readonly dx: number | null
  readonly dy: number | null
  readonly color: string | null
  readonly fillColor: string | null
}>

export type ArisLaneRecord = ArisSourceRecordBase<{
  readonly laneId: string | null
  readonly modelId: string | null
  readonly laneType: string | null
  readonly orientation: string | null
  readonly startBorder: number | null
  readonly endBorder: number | null
  readonly guid: string | null
}>

export type ArisFreeTextRecord = ArisSourceRecordBase<{
  readonly freeTextDefinitionId: string | null
  readonly isModelAttr: string | null
  readonly creator: string | null
  readonly creationTimestamp: string | null
  readonly lastModifier: string | null
  readonly lastModificationTimestamp: string | null
  readonly lastUpdated: string | null
  readonly guid: string | null
}>

export type ArisFreeTextOccurrenceRecord = ArisSourceRecordBase<{
  readonly modelId: string | null
  readonly freeTextDefinitionId: string | null
  readonly fontStyleSheetId: string | null
  readonly symbolFlag: string | null
  readonly alignment: string | null
  readonly zorder: number | null
  readonly x: number | null
  readonly y: number | null
  readonly dx: number | null
  readonly dy: number | null
  readonly color: string | null
  readonly fillColor: string | null
}>

export type ArisAttachmentRecord = ArisSourceRecordBase<{
  readonly attachmentId: string | null
  readonly creator: string | null
  readonly creationTimestamp: string | null
  readonly lastModifier: string | null
  readonly lastModificationTimestamp: string | null
  readonly guid: string | null
  readonly blobCount: number
}>

export type ArisAttachmentOccurrenceRecord = ArisSourceRecordBase<{
  readonly modelId: string | null
  readonly attachmentOccurrenceId: string | null
  readonly attachmentId: string | null
  readonly zorder: number | null
  readonly x: number | null
  readonly y: number | null
  readonly dx: number | null
  readonly dy: number | null
}>

export type ArisBlobRecord = ArisSourceRecordBase<{
  readonly ownerElementName: string | null
  readonly ownerPath: string | null
  readonly ownerSourceId: string | null
  readonly textLength: number
  readonly preview: string
}>

export type ArisFontStyleSheetRecord = ArisSourceRecordBase<{
  readonly fontStyleSheetId: string | null
  readonly guid: string | null
  readonly fontNodeCount: number
}>

export type ArisUnknownRecord = ArisSourceRecordBase<{
  readonly textPreview: string
}>

/** The top-level element of the AML document (`AML`), indexed so no element is unaccounted for. */
export type ArisDocumentRootRecord = ArisSourceRecordBase<{
  readonly rootElementName: string
  readonly childElementNames: readonly string[]
}>

/** One `LinkedModels.IdRefs` entry, i.e. one object-definition-to-model assignment. */
export interface ArisLinkedModelAssignmentRecord {
  readonly objectDefinitionId: string | null
  readonly objectDefinitionPath: string
  readonly modelId: string
  readonly assignmentIndex: number
  readonly span: XmlSpan
}

/** An attribute on a recognized element that the semantic index does not model explicitly. */
export interface ArisUnknownAttributeRecord {
  readonly elementName: string
  readonly path: string
  readonly sourceId: string | null
  readonly attributeName: string
  readonly value: string
  readonly span: XmlSpan
}

export type ArisElementDisposition = 'record' | 'absorbed' | 'unknown'

/**
 * Accounting entry proving that a concrete-syntax element is represented somewhere in the
 * semantic index. `record` elements produce their own record, `absorbed` elements are folded
 * into the nearest enclosing record (which retains their raw material), and `unknown` elements
 * are preserved verbatim in {@link ArisSourceIndex.unknownRecords}.
 */
export interface ArisElementAccountingEntry {
  readonly path: string
  readonly elementName: string
  readonly disposition: ArisElementDisposition
  readonly recordKind: string
  readonly recordPath: string
}

/** Any indexed record, regardless of kind. */
export type ArisAnyRecord = ArisSourceRecordBase<Record<string, unknown>>

export interface ArisSourceStyleCatalog {
  readonly fontStyleSheets: ReadonlyMap<string, ArisFontStyleSheetRecord>
  readonly fonts: readonly ArisFontRecord[]
  readonly pens: readonly ArisPenRecord[]
  readonly brushes: readonly ArisBrushRecord[]
}

export interface ArisSourceIndex {
  // --- Plan section 6.5 named members (authoritative names/shapes) ---
  readonly models: ReadonlyMap<string, ArisModelRecord>
  readonly objectDefinitions: ReadonlyMap<string, ArisObjectDefinitionRecord>
  readonly objectOccurrences: ReadonlyMap<string, ArisObjectOccurrenceRecord>
  readonly connectionDefinitions: ReadonlyMap<string, ArisConnectionDefinitionRecord>
  readonly connectionOccurrences: ReadonlyMap<string, ArisConnectionOccurrenceRecord>
  readonly attributes: readonly ArisAttributeRecord[]
  readonly lanes: ReadonlyMap<string, ArisLaneRecord>
  readonly freeText: ReadonlyMap<string, ArisFreeTextRecord>
  readonly attachments: ReadonlyMap<string, ArisAttachmentRecord>
  readonly styles: ArisSourceStyleCatalog
  readonly unknownRecords: readonly ArisUnknownRecord[]
  // --- Additional plan section 6.4 coverage ---
  readonly root: ArisDocumentRootRecord | null
  readonly database: ArisDatabaseRecord | null
  readonly groups: ReadonlyMap<string, ArisGroupRecord>
  readonly languages: readonly ArisLanguageRecord[]
  readonly attributeOccurrences: readonly ArisAttributeOccurrenceRecord[]
  readonly linkedModelAssignments: readonly ArisLinkedModelAssignmentRecord[]
  readonly freeTextOccurrences: readonly ArisFreeTextOccurrenceRecord[]
  readonly attachmentOccurrences: readonly ArisAttachmentOccurrenceRecord[]
  readonly blobs: readonly ArisBlobRecord[]
  readonly guidReferences: readonly ArisGuidReferenceRecord[]
  readonly templateReferences: readonly ArisGuidReferenceRecord[]
  readonly positions: readonly ArisPositionRecord[]
  readonly sizes: readonly ArisSizeRecord[]
  readonly routePoints: readonly ArisRoutePointRecord[]
  readonly unknownAttributes: readonly ArisUnknownAttributeRecord[]
  /**
   * Records dropped from an id-keyed map: either because their source ID was already taken
   * (a duplicate) or because the element had no source ID attribute to key on at all. Either
   * way the record is retained here verbatim — see `registerById` in `semanticIndex.ts` — so a
   * record can never vanish silently just because it could not be registered by ID. The
   * diagnostic pushed alongside each case (`duplicate-id` or `missing-source-id`) says which
   * one applies.
   */
  readonly supersededRecords: readonly ArisAnyRecord[]
  readonly elementAccounting: ReadonlyMap<string, ArisElementAccountingEntry>
}

export interface SemanticArisDocument {
  readonly index: ArisSourceIndex
  readonly diagnostics: readonly AmlDiagnostic[]
}

interface ElementContext {
  readonly node: XmlElementNode
  readonly path: string
  readonly parent: ElementContext | null
  readonly attributes: Readonly<Record<string, string>>
  readonly sourceId: string | null
}

const SOURCE_ID_ATTRIBUTES = [
  'Group.ID',
  'Model.ID',
  'ObjDef.ID',
  'ObjOcc.ID',
  'CxnDef.ID',
  'CxnOcc.ID',
  'Lane.ID',
  'FFTextDef.ID',
  'OLEDef.ID',
  'OLEOcc.ID',
  'FontSS.ID'
] as const

/**
 * Elements whose AML representation legitimately carries no id attribute at all — unlike
 * `ObjOcc`, `CxnOcc`, `Lane`, etc. (all of which always carry one of `SOURCE_ID_ATTRIBUTES` in
 * real exports) — but whose record must still become an addressable working-model entity.
 * `FFTextOcc` is the confirmed case: ARIS never emits an id for a free-text occurrence (it is
 * referenced only by `FFTextDef.IdRef` plus its position in the document), so without this list
 * every one of them falls through `sourceId === null` and is silently dropped by the `!item.id`
 * guards in `buildFromSource.ts`.
 *
 * A record whose element is in this set gets a synthesized id (see {@link synthesizeSourceId})
 * whenever it has no real one, instead of being left with `sourceId: null`.
 */
const SYNTHETIC_SOURCE_ID_ELEMENTS: ReadonlySet<string> = new Set(['FFTextOcc'])

/**
 * Deterministically synthesize an id for a record that has no source id attribute to begin
 * with. Derived from the element's document path — itself already unique and stable for a
 * given source document, since it is built from the element name plus its 1-based index among
 * same-named siblings, recursively from the document root (see `visit` below) — rather than
 * from an incrementing counter, so the same import always produces the same id (revisions and
 * undo stay stable across independent builds of the same source). The `synthetic:` prefix
 * guarantees it can never collide with a genuine ARIS id, which always starts with the element
 * type name followed by a `.` (e.g. `FFTextDef.xxxxx`).
 */
function synthesizeSourceId(elementName: string, path: string): string {
  return `synthetic:${elementName}:${path}`
}

/**
 * Elements that produce their own record in the semantic index, mapped to the `recordKind`
 * stamped on that record. Every entry here must be handled by the `visit` switch below.
 */
const RECORD_KIND_BY_ELEMENT: Readonly<Record<string, string>> = Object.freeze({
  'Header-Info': 'database',
  Language: 'language',
  Group: 'group',
  Model: 'model',
  ObjDef: 'object-definition',
  ObjOcc: 'object-occurrence',
  CxnDef: 'connection-definition',
  CxnOcc: 'connection-occurrence',
  AttrDef: 'attribute',
  AttrOcc: 'attribute-occurrence',
  Lane: 'lane',
  FFTextDef: 'free-text',
  FFTextOcc: 'free-text-occurrence',
  OLEDef: 'attachment',
  OLEOcc: 'attachment-occurrence',
  Blob: 'blob',
  FontStyleSheet: 'font-style-sheet',
  Font: 'font',
  FontNode: 'font',
  LogFont: 'font',
  Pen: 'pen',
  Brush: 'brush',
  Position: 'position',
  Size: 'size',
  GUID: 'guid-reference',
  MasterGUID: 'guid-reference',
  SymbolGUID: 'guid-reference',
  TemplateGUID: 'guid-reference',
  ExternalGUID: 'guid-reference'
})

/**
 * Elements that carry no record of their own because the nearest enclosing record already
 * retains their content. The value lists the record kinds allowed to absorb them; anything
 * else is treated as an unknown element and reported, so absorption can never hide material.
 */
const ABSORBING_RECORD_KINDS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  LanguageName: ['language'],
  AttrValue: ['attribute'],
  StyledElement: ['attribute'],
  Paragraph: ['attribute'],
  PlainText: ['attribute'],
  Bold: ['attribute'],
  LineBreak: ['attribute'],
  Flag: ['model']
})

const DOCUMENT_ROOT_RECORD_KIND = 'document-root'

function attrsOf(node: XmlElementNode): Readonly<Record<string, string>> {
  const attributes = Object.fromEntries(
    node.startTag.attributes.map((attribute) => [attribute.name, attribute.value])
  )
  return Object.freeze(attributes)
}

function childElements(node: XmlElementNode): readonly XmlElementNode[] {
  return node.children.filter((child): child is XmlElementNode => child.kind === 'element')
}

function childLeafText(node: XmlElementNode): string {
  return node.children
    .flatMap((child) => {
      if (child.kind === 'element') return []
      if (child.kind === 'comment' || child.kind === 'processing-instruction') return []
      return [child.token.content]
    })
    .join('')
}

function elementText(node: XmlElementNode, entityMap: Readonly<Record<string, string>>): string {
  const fragments: string[] = []
  const append = (candidate: XmlNode): void => {
    if (candidate.kind === 'element') {
      if (candidate.name === 'LineBreak') {
        fragments.push('\n')
        return
      }
      const attrs = attrsOf(candidate)
      if (candidate.name === 'PlainText') {
        fragments.push(attrs.TextValue ?? '')
        return
      }
      candidate.children.forEach(append)
      return
    }
    if (candidate.kind === 'comment' || candidate.kind === 'processing-instruction') return
    fragments.push(candidate.token.content)
  }
  node.children.forEach(append)
  return decodeAmlEntities(fragments.join(''), entityMap).trim()
}

function parseOptionalInteger(value: string | null | undefined): number | null {
  if (!value) return null
  if (!/^-?\d+$/u.test(value.trim())) return null
  return Number.parseInt(value, 10)
}

function textPreview(value: string, limit = 160): string {
  const normalized = value.replace(/\s+/gu, ' ').trim()
  return normalized.length <= limit ? normalized : `${normalized.slice(0, limit)}…`
}

function deriveSourceId(attributes: Readonly<Record<string, string>>): string | null {
  for (const key of SOURCE_ID_ATTRIBUTES) {
    const value = attributes[key]
    if (value) return value
  }
  return null
}

function spanOf(node: XmlElementNode): XmlSpan {
  return node.endTag
    ? { start: node.startTag.span.start, end: node.endTag.span.end }
    : node.startTag.span
}

function attributeValueSpan(node: XmlElementNode, attributeName: string): XmlSpan {
  const attribute = node.startTag.attributes.find((candidate) => candidate.name === attributeName)
  return attribute ? attribute.valueSpan : node.startTag.span
}

function parentRef(context: ElementContext | null): ArisSourceParentRelationship | null {
  if (!context) return null
  return Object.freeze({
    elementName: context.node.name,
    path: context.path,
    sourceId: context.sourceId
  })
}

function unknownAttributes(
  attributes: Readonly<Record<string, string>>,
  known: readonly string[]
): Readonly<Record<string, string>> {
  const allowed = new Set(known)
  return Object.freeze(
    Object.fromEntries(Object.entries(attributes).filter(([name]) => !allowed.has(name)))
  )
}

function unknownChildren(
  node: XmlElementNode,
  knownChildren: readonly string[]
): readonly string[] {
  const allowed = new Set(knownChildren)
  return Object.freeze(
    childElements(node)
      .map((child) => child.name)
      .filter((name) => !allowed.has(name))
  )
}

function nearestAncestor(
  context: ElementContext | null,
  tagNames: readonly string[]
): ElementContext | null {
  const allowed = new Set(tagNames)
  let current = context?.parent ?? null
  while (current) {
    if (allowed.has(current.node.name)) return current
    current = current.parent
  }
  return null
}

function directChild(context: ElementContext, tagName: string): XmlElementNode | null {
  return childElements(context.node).find((child) => child.name === tagName) ?? null
}

function directChildren(context: ElementContext, tagName: string): readonly XmlElementNode[] {
  return childElements(context.node).filter((child) => child.name === tagName)
}

function readGuidValue(
  context: ElementContext,
  tagName: 'GUID' | 'MasterGUID' | 'SymbolGUID' | 'TemplateGUID' | 'ExternalGUID',
  entityMap: Readonly<Record<string, string>>
): string | null {
  const child = directChild(context, tagName)
  return child ? elementText(child, entityMap) || null : null
}

function readPositionPair(context: ElementContext): { x: number | null; y: number | null } {
  const child = directChild(context, 'Position')
  if (!child) return { x: null, y: null }
  const attrs = attrsOf(child)
  return {
    x: parseOptionalInteger(attrs['Pos.X']),
    y: parseOptionalInteger(attrs['Pos.Y'])
  }
}

function readSizePair(context: ElementContext): { dx: number | null; dy: number | null } {
  const child = directChild(context, 'Size')
  if (!child) return { dx: null, dy: null }
  const attrs = attrsOf(child)
  return {
    dx: parseOptionalInteger(attrs['Size.dX']),
    dy: parseOptionalInteger(attrs['Size.dY'])
  }
}

function splitRefs(raw: string | null | undefined): readonly string[] {
  return Object.freeze(raw?.trim().split(/\s+/u).filter(Boolean) ?? [])
}

function recordBase<TParsed extends Record<string, unknown>>(
  context: ElementContext,
  recordKind: string,
  parsed: TParsed,
  options: {
    readonly knownAttributes: readonly string[]
    readonly knownChildren: readonly string[]
  }
): ArisSourceRecordBase<TParsed> {
  return Object.freeze({
    recordKind,
    elementName: context.node.name,
    sourceId: context.sourceId,
    path: context.path,
    parent: parentRef(context.parent),
    span: context.node.endTag
      ? { start: context.node.startTag.span.start, end: context.node.endTag.span.end }
      : context.node.startTag.span,
    rawAttributes: context.attributes,
    parsed: Object.freeze(parsed),
    unknownAttributes: unknownAttributes(context.attributes, options.knownAttributes),
    unknownChildren: unknownChildren(context.node, options.knownChildren)
  })
}

function duplicateIdDiagnostic(
  kind: string,
  context: ElementContext,
  sourceId: string
): AmlDiagnostic {
  return Object.freeze({
    severity: 'warning',
    code: 'duplicate-id',
    message: `Duplicate ${kind} source ID "${sourceId}" was encountered. The first record was kept.`,
    path: context.path,
    sourceId,
    span: context.node.startTag.span
  })
}

/**
 * A record that was supposed to key an id-keyed map (`ObjDef`, `ObjOcc`, `CxnDef`, `CxnOcc`,
 * `Group`, `Model`, `FFTextDef`, `OLEDef`, `FontStyleSheet`, `Lane`) has no source ID at all.
 *
 * This is a warning, not an error: the pipeline does not reject the record, it degrades
 * gracefully — the raw content is preserved verbatim in `supersededRecords` exactly like a
 * duplicate ID (see `duplicateIdDiagnostic`), and the rest of the import proceeds. It is
 * surfaced as a diagnostic (rather than, say, being silently synthesized an id) because unlike
 * `FFTextOcc` — which legitimately never carries an id in ARIS exports, see
 * `SYNTHETIC_SOURCE_ID_ELEMENTS` — every one of these kinds always carries an id attribute in a
 * well-formed export. Its absence here means either malformed/hand-written input or an ARIS
 * variant this parser has not seen, and that is exactly the situation the plan (§6.4/§10.3)
 * wants reported rather than quietly papered over with an invented identity.
 */
function missingIdDiagnostic(kind: string, context: ElementContext): AmlDiagnostic {
  return Object.freeze({
    severity: 'warning',
    code: 'missing-source-id',
    message: `A ${kind} element at "${context.path}" has no source ID attribute, so it cannot become an addressable ${kind} record. Its raw content was retained (see supersededRecords) but nothing else in the source can reference it by ID.`,
    path: context.path,
    sourceId: null,
    span: context.node.startTag.span
  })
}

function registerById<T extends ArisAnyRecord>(
  storage: Map<string, T>,
  context: ElementContext,
  kind: string,
  record: T,
  diagnostics: AmlDiagnostic[],
  superseded: ArisAnyRecord[]
): void {
  if (!record.sourceId) {
    diagnostics.push(missingIdDiagnostic(kind, context))
    // Retained verbatim — never dropped — exactly like a duplicate-id loser below. This is the
    // guard against the FFTextOcc failure mode: a record that cannot be registered by ID must
    // still show up somewhere, loudly, instead of silently disappearing from every typed map.
    superseded.push(record)
    return
  }
  if (storage.has(record.sourceId)) {
    diagnostics.push(duplicateIdDiagnostic(kind, context, record.sourceId))
    // The losing record is still retained verbatim so that a duplicate ID never causes
    // source material to disappear silently.
    superseded.push(record)
    return
  }
  storage.set(record.sourceId, record)
}

function collectStyledRuns(
  node: XmlElementNode,
  path: string,
  entityMap: Readonly<Record<string, string>>,
  sink: ArisStyledRunRecord[]
): void {
  const counts = new Map<string, number>()
  childElements(node).forEach((child) => {
    const index = (counts.get(child.name) ?? 0) + 1
    counts.set(child.name, index)
    const childPath = `${path}/${child.name}[${index}]`
    sink.push(
      Object.freeze({
        elementName: child.name,
        path: childPath,
        span: spanOf(child),
        rawAttributes: attrsOf(child),
        decodedColors: decodeColorAttributes(attrsOf(child)),
        text: elementText(child, entityMap)
      })
    )
    collectStyledRuns(child, childPath, entityMap, sink)
  })
}

function createAttributeValues(
  context: ElementContext,
  entityMap: Readonly<Record<string, string>>
): readonly ArisAttributeValueRecord[] {
  return Object.freeze(
    directChildren(context, 'AttrValue').map((valueNode, index) => {
      const valueAttrs = attrsOf(valueNode)
      const path = `${context.path}/AttrValue[${index + 1}]`
      const localeId = valueAttrs.LocaleId ?? null
      const runs: ArisStyledRunRecord[] = []
      collectStyledRuns(valueNode, path, entityMap, runs)
      return Object.freeze({
        localeId,
        locale: localeLang(localeId ?? undefined),
        text: elementText(valueNode, entityMap),
        path,
        span: spanOf(valueNode),
        runs: Object.freeze(runs)
      })
    })
  )
}

function makeUnknownRecord(
  context: ElementContext,
  entityMap: Readonly<Record<string, string>>
): ArisUnknownRecord {
  return recordBase(
    context,
    'unknown',
    {
      textPreview: textPreview(elementText(context.node, entityMap) || childLeafText(context.node))
    },
    // Nothing about an unrecognized element is "known": every attribute and child name is
    // mirrored into unknownAttributes/unknownChildren so the record is self-describing.
    { knownAttributes: [], knownChildren: [] }
  )
}

export function buildSemanticArisDocument(document: TokenizedXmlDocument): SemanticArisDocument {
  const entityMap = Object.freeze(
    Object.fromEntries(
      (document.doctype?.entityDeclarations ?? []).map((entity) => [entity.name, entity.value])
    )
  )
  const diagnostics: AmlDiagnostic[] = []
  let root: ArisDocumentRootRecord | null = null
  let database: ArisDatabaseRecord | null = null
  const groups = new Map<string, ArisGroupRecord>()
  const languages: ArisLanguageRecord[] = []
  const models = new Map<string, ArisModelRecord>()
  const objectDefinitions = new Map<string, ArisObjectDefinitionRecord>()
  const objectOccurrences = new Map<string, ArisObjectOccurrenceRecord>()
  const connectionDefinitions = new Map<string, ArisConnectionDefinitionRecord>()
  const connectionOccurrences = new Map<string, ArisConnectionOccurrenceRecord>()
  const attributes: ArisAttributeRecord[] = []
  const attributeOccurrences: ArisAttributeOccurrenceRecord[] = []
  const lanes = new Map<string, ArisLaneRecord>()
  const freeText = new Map<string, ArisFreeTextRecord>()
  const freeTextOccurrences: ArisFreeTextOccurrenceRecord[] = []
  const attachments = new Map<string, ArisAttachmentRecord>()
  const attachmentOccurrences: ArisAttachmentOccurrenceRecord[] = []
  const blobs: ArisBlobRecord[] = []
  const fontStyleSheets = new Map<string, ArisFontStyleSheetRecord>()
  const fonts: ArisFontRecord[] = []
  const pens: ArisPenRecord[] = []
  const brushes: ArisBrushRecord[] = []
  const guidReferences: ArisGuidReferenceRecord[] = []
  const positions: ArisPositionRecord[] = []
  const sizes: ArisSizeRecord[] = []
  const routePoints: ArisRoutePointRecord[] = []
  const unknownRecords: ArisUnknownRecord[] = []
  const linkedModelAssignments: ArisLinkedModelAssignmentRecord[] = []
  const unknownAttributeRecords: ArisUnknownAttributeRecord[] = []
  const supersededRecords: ArisAnyRecord[] = []
  const elementAccounting = new Map<string, ArisElementAccountingEntry>()

  /**
   * Wraps {@link recordBase} for recognized elements, mirroring every attribute the record does
   * not model into the document-level unknown-attribute list.
   */
  const indexedRecord = <TParsed extends Record<string, unknown>>(
    context: ElementContext,
    recordKind: string,
    parsed: TParsed,
    options: {
      readonly knownAttributes: readonly string[]
      readonly knownChildren: readonly string[]
    }
  ): ArisSourceRecordBase<TParsed> => {
    const base = recordBase(context, recordKind, parsed, options)
    Object.entries(base.unknownAttributes).forEach(([attributeName, value]) => {
      unknownAttributeRecords.push(
        Object.freeze({
          elementName: context.node.name,
          path: context.path,
          sourceId: context.sourceId,
          attributeName,
          value,
          span: attributeValueSpan(context.node, attributeName)
        })
      )
    })
    return base
  }

  const account = (
    context: ElementContext,
    disposition: ArisElementDisposition,
    recordKind: string,
    recordPath: string
  ): void => {
    elementAccounting.set(
      context.path,
      Object.freeze({
        path: context.path,
        elementName: context.node.name,
        disposition,
        recordKind,
        recordPath
      })
    )
  }

  const visit = (
    node: XmlElementNode,
    parent: ElementContext | null,
    path: string,
    owner: { readonly kind: string; readonly path: string } | null
  ): void => {
    const nodeAttributes = attrsOf(node)
    const declaredSourceId = deriveSourceId(nodeAttributes)
    const context: ElementContext = Object.freeze({
      node,
      path,
      parent,
      attributes: nodeAttributes,
      sourceId:
        declaredSourceId ??
        (SYNTHETIC_SOURCE_ID_ELEMENTS.has(node.name) ? synthesizeSourceId(node.name, path) : null)
    })

    const declaredRecordKind = RECORD_KIND_BY_ELEMENT[node.name]
    let childOwner = owner

    if (declaredRecordKind) {
      account(context, 'record', declaredRecordKind, context.path)
      childOwner = { kind: declaredRecordKind, path: context.path }
    }

    switch (node.name) {
      case 'Header-Info': {
        database = indexedRecord(
          context,
          'database',
          {
            databaseName: context.attributes.DatabaseName ?? null,
            createDate: context.attributes.CreateDate ?? null,
            createTime: context.attributes.CreateTime ?? null,
            userName: context.attributes.UserName ?? null,
            arisExeVersion: context.attributes.ArisExeVersion ?? null
          },
          {
            knownAttributes: [
              'DatabaseName',
              'CreateDate',
              'CreateTime',
              'UserName',
              'ArisExeVersion'
            ],
            knownChildren: []
          }
        )
        break
      }
      case 'Language': {
        const nameNode = directChild(context, 'LanguageName')
        languages.push(
          indexedRecord(
            context,
            'language',
            {
              localeId: context.attributes.LocaleId ?? null,
              locale: localeLang(context.attributes.LocaleId),
              codepage: context.attributes.Codepage ?? null,
              languageName: nameNode ? elementText(nameNode, entityMap) || null : null
            },
            {
              knownAttributes: ['LocaleId', 'Codepage'],
              knownChildren: ['LanguageName', 'LogFont']
            }
          )
        )
        break
      }
      case 'Group': {
        const ancestor = nearestAncestor(context, ['Group'])
        const record = indexedRecord(
          context,
          'group',
          {
            groupId: context.attributes['Group.ID'] ?? null,
            parentGroupId: ancestor?.attributes['Group.ID'] ?? null,
            typeNum: context.attributes.TypeNum ?? null,
            creator: context.attributes.Creator ?? null,
            creationTimestamp: context.attributes.CreationTimeStamp ?? null,
            lastModifier: context.attributes.LastModifier ?? null,
            lastModificationTimestamp: context.attributes.LastModificationTimeStamp ?? null,
            lastUpdated: context.attributes.LastUpdated ?? null,
            compositePosition: parseOptionalInteger(context.attributes.CompositePosition),
            compositeType: parseOptionalInteger(context.attributes.CompositeType),
            guid: readGuidValue(context, 'GUID', entityMap)
          },
          {
            knownAttributes: [
              'Group.ID',
              'TypeNum',
              'Creator',
              'CreationTimeStamp',
              'LastModifier',
              'LastModificationTimeStamp',
              'LastUpdated',
              'CompositePosition',
              'CompositeType'
            ],
            knownChildren: ['GUID', 'AttrDef', 'Group', 'ObjDef', 'Model']
          }
        )
        registerById(groups, context, 'group', record, diagnostics, supersededRecords)
        break
      }
      case 'Model': {
        const ancestorGroup = nearestAncestor(context, ['Group'])
        const record = indexedRecord(
          context,
          'model',
          {
            modelId: context.attributes['Model.ID'] ?? null,
            groupId: ancestorGroup?.attributes['Group.ID'] ?? null,
            modelType: context.attributes['Model.Type'] ?? null,
            attrHandling: context.attributes.AttrHandling ?? null,
            cxnMode: context.attributes.CxnMode ?? null,
            gridUse: context.attributes.GridUse ?? null,
            gridSize: parseOptionalInteger(context.attributes.GridSize),
            scale: parseOptionalInteger(context.attributes.Scale),
            printScale: parseOptionalInteger(context.attributes.PrintScale),
            backColor: amlColorRefToCss(context.attributes.BackColor),
            curveRadius: parseOptionalInteger(context.attributes.CurveRadius),
            arcRadius: parseOptionalInteger(context.attributes.ArcRadius),
            creator: context.attributes.Creator ?? null,
            creationTimestamp: context.attributes.CreationTimeStamp ?? null,
            lastModifier: context.attributes.LastModifier ?? null,
            lastModificationTimestamp: context.attributes.LastModificationTimeStamp ?? null,
            flag: directChild(context, 'Flag')
              ? elementText(directChild(context, 'Flag')!, entityMap) || null
              : null,
            guid: readGuidValue(context, 'GUID', entityMap),
            masterGuid: readGuidValue(context, 'MasterGUID', entityMap),
            templateGuid: readGuidValue(context, 'TemplateGUID', entityMap)
          },
          {
            knownAttributes: [
              'Model.ID',
              'Model.Type',
              'AttrHandling',
              'CxnMode',
              'GridUse',
              'GridSize',
              'Scale',
              'PrintScale',
              'BackColor',
              'CurveRadius',
              'ArcRadius',
              'Creator',
              'CreationTimeStamp',
              'LastModifier',
              'LastModificationTimeStamp'
            ],
            knownChildren: [
              'Flag',
              'GUID',
              'MasterGUID',
              'TemplateGUID',
              'Lane',
              'AttrDef',
              'ObjOcc',
              'FFTextOcc',
              'OLEOcc',
              'GfxObj'
            ]
          }
        )
        registerById(models, context, 'model', record, diagnostics, supersededRecords)
        break
      }
      case 'ObjDef': {
        const ancestorGroup = nearestAncestor(context, ['Group'])
        const record = indexedRecord(
          context,
          'object-definition',
          {
            objectDefinitionId: context.attributes['ObjDef.ID'] ?? null,
            groupId: ancestorGroup?.attributes['Group.ID'] ?? null,
            typeNum: context.attributes.TypeNum ?? null,
            symbolNum: context.attributes.SymbolNum ?? null,
            creator: context.attributes.Creator ?? null,
            creationTimestamp: context.attributes.CreationTimeStamp ?? null,
            lastModifier: context.attributes.LastModifier ?? null,
            lastModificationTimestamp: context.attributes.LastModificationTimeStamp ?? null,
            lastUpdated: context.attributes.LastUpdated ?? null,
            compositePosition: parseOptionalInteger(context.attributes.CompositePosition),
            compositeType: parseOptionalInteger(context.attributes.CompositeType),
            linkedModelIds: splitRefs(context.attributes['LinkedModels.IdRefs']),
            outboundConnectionDefinitionIds: splitRefs(context.attributes['ToCxnDefs.IdRefs']),
            guid: readGuidValue(context, 'GUID', entityMap),
            masterGuid: readGuidValue(context, 'MasterGUID', entityMap),
            symbolGuid: readGuidValue(context, 'SymbolGUID', entityMap)
          },
          {
            knownAttributes: [
              'ObjDef.ID',
              'TypeNum',
              'SymbolNum',
              'Creator',
              'CreationTimeStamp',
              'LastModifier',
              'LastModificationTimeStamp',
              'LastUpdated',
              'CompositePosition',
              'CompositeType',
              'LinkedModels.IdRefs',
              'ToCxnDefs.IdRefs'
            ],
            knownChildren: ['GUID', 'MasterGUID', 'SymbolGUID', 'AttrDef', 'CxnDef']
          }
        )
        registerById(
          objectDefinitions,
          context,
          'object definition',
          record,
          diagnostics,
          supersededRecords
        )
        splitRefs(context.attributes['LinkedModels.IdRefs']).forEach((modelId, assignmentIndex) => {
          linkedModelAssignments.push(
            Object.freeze({
              objectDefinitionId: context.attributes['ObjDef.ID'] ?? null,
              objectDefinitionPath: context.path,
              modelId,
              assignmentIndex,
              span: attributeValueSpan(context.node, 'LinkedModels.IdRefs')
            })
          )
        })
        break
      }
      case 'ObjOcc': {
        const ancestorModel = nearestAncestor(context, ['Model'])
        const position = readPositionPair(context)
        const size = readSizePair(context)
        const record = indexedRecord(
          context,
          'object-occurrence',
          {
            objectOccurrenceId: context.attributes['ObjOcc.ID'] ?? null,
            modelId: ancestorModel?.attributes['Model.ID'] ?? null,
            objectDefinitionId: context.attributes['ObjDef.IdRef'] ?? null,
            symbolNum: context.attributes.SymbolNum ?? null,
            toConnectionOccurrenceIds: splitRefs(context.attributes['ToCxnOccs.IdRefs']),
            flags: context.attributes.Flags ?? null,
            zorder: parseOptionalInteger(context.attributes.Zorder),
            hints: context.attributes.Hints ?? null,
            sequenceNumber: parseOptionalInteger(context.attributes.SequenceNumber),
            x: position.x,
            y: position.y,
            dx: size.dx,
            dy: size.dy,
            externalGuid: readGuidValue(context, 'ExternalGUID', entityMap),
            symbolGuid: readGuidValue(context, 'SymbolGUID', entityMap),
            fillColor: amlColorRefToCss(context.attributes.FillColor),
            strokeColor: amlColorRefToCss(context.attributes.Color)
          },
          {
            knownAttributes: [
              'ObjOcc.ID',
              'ObjDef.IdRef',
              'ToCxnOccs.IdRefs',
              'SymbolNum',
              'Flags',
              'Zorder',
              'Hints',
              'SequenceNumber',
              'FillColor',
              'Color'
            ],
            knownChildren: [
              'Brush',
              'Position',
              'Size',
              'ExternalGUID',
              'SymbolGUID',
              'CxnOcc',
              'AttrOcc'
            ]
          }
        )
        registerById(
          objectOccurrences,
          context,
          'object occurrence',
          record,
          diagnostics,
          supersededRecords
        )
        break
      }
      case 'CxnDef': {
        const ancestorDefinition = nearestAncestor(context, ['ObjDef'])
        const record = indexedRecord(
          context,
          'connection-definition',
          {
            connectionDefinitionId: context.attributes['CxnDef.ID'] ?? null,
            fromObjectDefinitionId: ancestorDefinition?.attributes['ObjDef.ID'] ?? null,
            toObjectDefinitionId: context.attributes['ToObjDef.IdRef'] ?? null,
            connectionType: context.attributes['CxnDef.Type'] ?? context.attributes.TypeNum ?? null,
            sourceOrderNum: parseOptionalInteger(context.attributes.SourceOrderNum),
            targetOrderNum: parseOptionalInteger(context.attributes.TargetOrderNum),
            creator: context.attributes.Creator ?? null,
            creationTimestamp: context.attributes.CreationTimeStamp ?? null,
            lastModifier: context.attributes.LastModifier ?? null,
            lastModificationTimestamp: context.attributes.LastModificationTimeStamp ?? null,
            guid: readGuidValue(context, 'GUID', entityMap)
          },
          {
            knownAttributes: [
              'CxnDef.ID',
              'CxnDef.Type',
              'TypeNum',
              'ToObjDef.IdRef',
              'SourceOrderNum',
              'TargetOrderNum',
              'Creator',
              'CreationTimeStamp',
              'LastModifier',
              'LastModificationTimeStamp'
            ],
            knownChildren: ['GUID']
          }
        )
        registerById(
          connectionDefinitions,
          context,
          'connection definition',
          record,
          diagnostics,
          supersededRecords
        )
        break
      }
      case 'CxnOcc': {
        const ancestorOccurrence = nearestAncestor(context, ['ObjOcc'])
        const ancestorModel = nearestAncestor(context, ['Model'])
        const record = indexedRecord(
          context,
          'connection-occurrence',
          {
            connectionOccurrenceId: context.attributes['CxnOcc.ID'] ?? null,
            modelId: ancestorModel?.attributes['Model.ID'] ?? null,
            fromObjectOccurrenceId: ancestorOccurrence?.attributes['ObjOcc.ID'] ?? null,
            toObjectOccurrenceId: context.attributes['ToObjOcc.IdRef'] ?? null,
            connectionDefinitionId: context.attributes['CxnDef.IdRef'] ?? null,
            zorder: parseOptionalInteger(context.attributes.Zorder),
            hints: context.attributes.Hints ?? null,
            srcArrow: context.attributes.SrcArrow ?? null,
            tgtArrow: context.attributes.TgtArrow ?? null,
            embedding: context.attributes.Embedding ?? null,
            visible: context.attributes.Visible ?? null,
            routePointCount: directChildren(context, 'Position').length,
            color: amlColorRefToCss(context.attributes.Color)
          },
          {
            knownAttributes: [
              'CxnOcc.ID',
              'CxnDef.IdRef',
              'ToObjOcc.IdRef',
              'Zorder',
              'Hints',
              'SrcArrow',
              'TgtArrow',
              'Embedding',
              'Visible',
              'Color'
            ],
            knownChildren: ['Pen', 'Position', 'AttrOcc']
          }
        )
        registerById(
          connectionOccurrences,
          context,
          'connection occurrence',
          record,
          diagnostics,
          supersededRecords
        )
        directChildren(context, 'Position').forEach((positionNode, index) => {
          const positionAttrs = attrsOf(positionNode)
          routePoints.push(
            Object.freeze({
              connectionOccurrenceId: context.attributes['CxnOcc.ID'] ?? null,
              modelId: ancestorModel?.attributes['Model.ID'] ?? null,
              path: `${context.path}/Position[${index + 1}]`,
              span: positionNode.endTag
                ? { start: positionNode.startTag.span.start, end: positionNode.endTag.span.end }
                : positionNode.startTag.span,
              pointIndex: index,
              x: parseOptionalInteger(positionAttrs['Pos.X']),
              y: parseOptionalInteger(positionAttrs['Pos.Y'])
            })
          )
        })
        break
      }
      case 'AttrDef': {
        const owner = nearestAncestor(context, [
          'Group',
          'Model',
          'ObjDef',
          'Lane',
          'FFTextDef',
          'OLEDef',
          'FontStyleSheet'
        ])
        attributes.push(
          indexedRecord(
            context,
            'attribute',
            {
              ownerElementName: owner?.node.name ?? null,
              ownerPath: owner?.path ?? null,
              ownerSourceId: owner?.sourceId ?? null,
              attributeType: context.attributes['AttrDef.Type'] ?? null,
              values: createAttributeValues(context, entityMap)
            },
            {
              knownAttributes: ['AttrDef.Type'],
              knownChildren: ['AttrValue']
            }
          )
        )
        break
      }
      case 'AttrOcc': {
        const owner = nearestAncestor(context, ['ObjOcc', 'CxnOcc'])
        const size = readSizePair(context)
        attributeOccurrences.push(
          indexedRecord(
            context,
            'attribute-occurrence',
            {
              ownerElementName: owner?.node.name ?? null,
              ownerPath: owner?.path ?? null,
              ownerSourceId: owner?.sourceId ?? null,
              attributeType: context.attributes.AttrTypeNum ?? null,
              port: context.attributes.Port ?? null,
              orderNum: parseOptionalInteger(context.attributes.OrderNum),
              alignment: context.attributes.Alignment ?? null,
              symbolFlag: context.attributes.SymbolFlag ?? null,
              fontStyleSheetId: context.attributes['FontSS.IdRef'] ?? null,
              offsetX: parseOptionalInteger(context.attributes.OffsetX),
              offsetY: parseOptionalInteger(context.attributes.OffsetY),
              rotation: parseOptionalInteger(context.attributes.Rotation),
              dx: size.dx,
              dy: size.dy,
              color: amlColorRefToCss(context.attributes.Color),
              fillColor: amlColorRefToCss(context.attributes.FillColor)
            },
            {
              knownAttributes: [
                'AttrTypeNum',
                'Port',
                'OrderNum',
                'Alignment',
                'SymbolFlag',
                'FontSS.IdRef',
                'OffsetX',
                'OffsetY',
                'Rotation',
                'Color',
                'FillColor'
              ],
              knownChildren: ['Size']
            }
          )
        )
        break
      }
      case 'Lane': {
        const ancestorModel = nearestAncestor(context, ['Model'])
        const record = indexedRecord(
          context,
          'lane',
          {
            laneId: context.attributes['Lane.ID'] ?? null,
            modelId: ancestorModel?.attributes['Model.ID'] ?? null,
            laneType: context.attributes['Lane.Type'] ?? null,
            orientation: context.attributes.Orientation ?? null,
            startBorder: parseOptionalInteger(context.attributes.StartBorder),
            endBorder: parseOptionalInteger(context.attributes.EndBorder),
            guid: readGuidValue(context, 'GUID', entityMap)
          },
          {
            knownAttributes: ['Lane.ID', 'Lane.Type', 'Orientation', 'StartBorder', 'EndBorder'],
            knownChildren: ['GUID', 'Pen', 'Brush', 'AttrDef']
          }
        )
        registerById(lanes, context, 'lane', record, diagnostics, supersededRecords)
        break
      }
      case 'FFTextDef': {
        const record = indexedRecord(
          context,
          'free-text',
          {
            freeTextDefinitionId: context.attributes['FFTextDef.ID'] ?? null,
            isModelAttr: context.attributes.IsModelAttr ?? null,
            creator: context.attributes.Creator ?? null,
            creationTimestamp: context.attributes.CreationTimeStamp ?? null,
            lastModifier: context.attributes.LastModifier ?? null,
            lastModificationTimestamp: context.attributes.LastModificationTimeStamp ?? null,
            lastUpdated: context.attributes.LastUpdated ?? null,
            guid: readGuidValue(context, 'GUID', entityMap)
          },
          {
            knownAttributes: [
              'FFTextDef.ID',
              'IsModelAttr',
              'Creator',
              'CreationTimeStamp',
              'LastModifier',
              'LastModificationTimeStamp',
              'LastUpdated'
            ],
            knownChildren: ['GUID', 'AttrDef']
          }
        )
        registerById(
          freeText,
          context,
          'free text definition',
          record,
          diagnostics,
          supersededRecords
        )
        break
      }
      case 'FFTextOcc': {
        const ancestorModel = nearestAncestor(context, ['Model'])
        const position = readPositionPair(context)
        const size = readSizePair(context)
        freeTextOccurrences.push(
          indexedRecord(
            context,
            'free-text-occurrence',
            {
              modelId: ancestorModel?.attributes['Model.ID'] ?? null,
              freeTextDefinitionId: context.attributes['FFTextDef.IdRef'] ?? null,
              fontStyleSheetId: context.attributes['FontSS.IdRef'] ?? null,
              symbolFlag: context.attributes.SymbolFlag ?? null,
              alignment: context.attributes.Alignment ?? null,
              zorder: parseOptionalInteger(context.attributes.Zorder),
              x: position.x,
              y: position.y,
              dx: size.dx,
              dy: size.dy,
              color: amlColorRefToCss(context.attributes.Color),
              fillColor: amlColorRefToCss(context.attributes.FillColor)
            },
            {
              knownAttributes: [
                'FFTextDef.IdRef',
                'FontSS.IdRef',
                'SymbolFlag',
                'Alignment',
                'Zorder',
                'Color',
                'FillColor'
              ],
              knownChildren: ['Position', 'Size']
            }
          )
        )
        break
      }
      case 'OLEDef': {
        const record = indexedRecord(
          context,
          'attachment',
          {
            attachmentId: context.attributes['OLEDef.ID'] ?? null,
            creator: context.attributes.Creator ?? null,
            creationTimestamp: context.attributes.CreationTimeStamp ?? null,
            lastModifier: context.attributes.LastModifier ?? null,
            lastModificationTimestamp: context.attributes.LastModificationTimeStamp ?? null,
            guid: readGuidValue(context, 'GUID', entityMap),
            blobCount: directChildren(context, 'Blob').length
          },
          {
            knownAttributes: [
              'OLEDef.ID',
              'Creator',
              'CreationTimeStamp',
              'LastModifier',
              'LastModificationTimeStamp'
            ],
            knownChildren: ['GUID', 'Blob', 'AttrDef']
          }
        )
        registerById(attachments, context, 'attachment', record, diagnostics, supersededRecords)
        break
      }
      case 'OLEOcc': {
        const ancestorModel = nearestAncestor(context, ['Model'])
        const position = readPositionPair(context)
        const size = readSizePair(context)
        attachmentOccurrences.push(
          indexedRecord(
            context,
            'attachment-occurrence',
            {
              modelId: ancestorModel?.attributes['Model.ID'] ?? null,
              attachmentOccurrenceId: context.attributes['OLEOcc.ID'] ?? null,
              attachmentId: context.attributes['OLEDef.IdRef'] ?? null,
              zorder: parseOptionalInteger(context.attributes.Zorder),
              x: position.x,
              y: position.y,
              dx: size.dx,
              dy: size.dy
            },
            {
              knownAttributes: ['OLEOcc.ID', 'OLEDef.IdRef', 'Zorder'],
              knownChildren: ['Position', 'Size']
            }
          )
        )
        break
      }
      case 'Blob': {
        const owner = nearestAncestor(context, ['OLEDef'])
        const raw = elementText(context.node, entityMap) || childLeafText(context.node).trim()
        blobs.push(
          indexedRecord(
            context,
            'blob',
            {
              ownerElementName: owner?.node.name ?? null,
              ownerPath: owner?.path ?? null,
              ownerSourceId: owner?.sourceId ?? null,
              textLength: raw.length,
              preview: textPreview(raw, 48)
            },
            {
              knownAttributes: [],
              knownChildren: []
            }
          )
        )
        break
      }
      case 'FontStyleSheet': {
        const record = indexedRecord(
          context,
          'font-style-sheet',
          {
            fontStyleSheetId: context.attributes['FontSS.ID'] ?? null,
            guid: readGuidValue(context, 'GUID', entityMap),
            fontNodeCount: directChildren(context, 'FontNode').length
          },
          {
            knownAttributes: ['FontSS.ID'],
            knownChildren: ['GUID', 'AttrDef', 'FontNode']
          }
        )
        registerById(
          fontStyleSheets,
          context,
          'font style sheet',
          record,
          diagnostics,
          supersededRecords
        )
        break
      }
      case 'Font':
      case 'FontNode':
      case 'LogFont': {
        const owner = context.parent
        fonts.push(
          indexedRecord(
            context,
            'font',
            {
              ownerElementName: owner?.node.name ?? null,
              ownerPath: owner?.path ?? null,
              ownerSourceId: owner?.sourceId ?? null,
              localeId: context.attributes.LocaleId ?? null,
              locale: localeLang(context.attributes.LocaleId),
              faceName: context.attributes.FaceName ?? context.attributes.Name ?? null,
              height: parseOptionalInteger(context.attributes.Height),
              width: parseOptionalInteger(context.attributes.Width),
              weight: parseOptionalInteger(context.attributes.Weight),
              italic: context.attributes.Italic ?? null,
              underline: context.attributes.Underline ?? null,
              strikeOut: context.attributes.StrikeOut ?? null,
              color: amlColorRefToCss(context.attributes.Color),
              sourceTag: node.name
            },
            {
              knownAttributes: [
                'LocaleId',
                'FaceName',
                'Name',
                'Height',
                'Width',
                'Weight',
                'Italic',
                'Underline',
                'StrikeOut',
                'Color',
                'Escapement',
                'Orientation',
                'CharSet',
                'OutPrecision',
                'ClipPrecision',
                'Quality',
                'PitchAndFamily'
              ],
              knownChildren: []
            }
          )
        )
        break
      }
      case 'Pen': {
        const owner = context.parent
        pens.push(
          indexedRecord(
            context,
            'pen',
            {
              ownerElementName: owner?.node.name ?? null,
              ownerPath: owner?.path ?? null,
              ownerSourceId: owner?.sourceId ?? null,
              color: amlColorRefToCss(context.attributes.Color),
              style: context.attributes.Style ?? null,
              width: parseOptionalInteger(context.attributes.Width)
            },
            {
              knownAttributes: ['Color', 'Style', 'Width'],
              knownChildren: []
            }
          )
        )
        break
      }
      case 'Brush': {
        const owner = context.parent
        brushes.push(
          indexedRecord(
            context,
            'brush',
            {
              ownerElementName: owner?.node.name ?? null,
              ownerPath: owner?.path ?? null,
              ownerSourceId: owner?.sourceId ?? null,
              color: amlColorRefToCss(context.attributes.Color),
              color2: amlColorRefToCss(context.attributes.Color2),
              brushType: context.attributes.BrushType ?? null
            },
            {
              knownAttributes: ['Color', 'Color2', 'BrushType'],
              knownChildren: []
            }
          )
        )
        break
      }
      case 'Position': {
        const owner = context.parent
        positions.push(
          indexedRecord(
            context,
            'position',
            {
              ownerElementName: owner?.node.name ?? null,
              ownerPath: owner?.path ?? null,
              ownerSourceId: owner?.sourceId ?? null,
              x: parseOptionalInteger(context.attributes['Pos.X']),
              y: parseOptionalInteger(context.attributes['Pos.Y'])
            },
            {
              knownAttributes: ['Pos.X', 'Pos.Y'],
              knownChildren: []
            }
          )
        )
        break
      }
      case 'Size': {
        const owner = context.parent
        sizes.push(
          indexedRecord(
            context,
            'size',
            {
              ownerElementName: owner?.node.name ?? null,
              ownerPath: owner?.path ?? null,
              ownerSourceId: owner?.sourceId ?? null,
              dx: parseOptionalInteger(context.attributes['Size.dX']),
              dy: parseOptionalInteger(context.attributes['Size.dY'])
            },
            {
              knownAttributes: ['Size.dX', 'Size.dY'],
              knownChildren: []
            }
          )
        )
        break
      }
      case 'GUID':
      case 'MasterGUID':
      case 'SymbolGUID':
      case 'TemplateGUID':
      case 'ExternalGUID': {
        guidReferences.push(
          Object.freeze({
            guidType: node.name,
            value: elementText(context.node, entityMap),
            ownerElementName: context.parent?.node.name ?? null,
            ownerPath: context.parent?.path ?? null,
            ownerSourceId: context.parent?.sourceId ?? null,
            path: context.path,
            span: spanOf(context.node)
          })
        )
        break
      }
      default: {
        if (parent === null && root === null) {
          // The document element itself. It carries no ARIS semantics of its own, but it must
          // still be an indexed record so that every CST element is attributable. Any further
          // top-level element (only possible in malformed input) falls through to the unknown
          // branch below rather than overwriting this one.
          root = indexedRecord(
            context,
            DOCUMENT_ROOT_RECORD_KIND,
            {
              rootElementName: node.name,
              childElementNames: Object.freeze(childElements(node).map((child) => child.name))
            },
            { knownAttributes: [], knownChildren: childElements(node).map((child) => child.name) }
          )
          account(context, 'record', DOCUMENT_ROOT_RECORD_KIND, context.path)
          childOwner = { kind: DOCUMENT_ROOT_RECORD_KIND, path: context.path }
          break
        }

        const absorbingKinds = ABSORBING_RECORD_KINDS[node.name]
        if (absorbingKinds && owner && absorbingKinds.includes(owner.kind)) {
          // Retained wholesale by the enclosing record (attribute values keep styled runs,
          // languages keep their name, models keep their flag).
          account(context, 'absorbed', owner.kind, owner.path)
          break
        }

        if (absorbingKinds) {
          diagnostics.push(
            Object.freeze({
              severity: 'warning',
              code: 'unaccounted-element',
              message: `Element "${node.name}" appeared outside ${absorbingKinds
                .map((kind) => `"${kind}"`)
                .join(' or ')} and was retained as an unknown record.`,
              path: context.path,
              sourceId: context.sourceId,
              span: node.startTag.span
            })
          )
        }

        unknownRecords.push(makeUnknownRecord(context, entityMap))
        account(context, 'unknown', 'unknown', context.path)
        childOwner = { kind: 'unknown', path: context.path }
      }
    }

    const childCounts = new Map<string, number>()
    childElements(node).forEach((child) => {
      const index = (childCounts.get(child.name) ?? 0) + 1
      childCounts.set(child.name, index)
      visit(child, context, `${path}/${child.name}[${index}]`, childOwner)
    })
  }

  const documentRoots = document.children.filter(
    (node): node is XmlElementNode => node.kind === 'element'
  )
  const rootCounts = new Map<string, number>()
  documentRoots.forEach((documentRoot) => {
    const index = (rootCounts.get(documentRoot.name) ?? 0) + 1
    rootCounts.set(documentRoot.name, index)
    visit(documentRoot, null, `${documentRoot.name}[${index}]`, null)
  })

  return Object.freeze({
    index: Object.freeze({
      models,
      objectDefinitions,
      objectOccurrences,
      connectionDefinitions,
      connectionOccurrences,
      attributes: Object.freeze(attributes),
      lanes,
      freeText,
      attachments,
      styles: Object.freeze({
        fontStyleSheets,
        fonts: Object.freeze(fonts),
        pens: Object.freeze(pens),
        brushes: Object.freeze(brushes)
      }),
      unknownRecords: Object.freeze(unknownRecords),
      root,
      database,
      groups,
      languages: Object.freeze(languages),
      attributeOccurrences: Object.freeze(attributeOccurrences),
      linkedModelAssignments: Object.freeze(linkedModelAssignments),
      freeTextOccurrences: Object.freeze(freeTextOccurrences),
      attachmentOccurrences: Object.freeze(attachmentOccurrences),
      blobs: Object.freeze(blobs),
      guidReferences: Object.freeze(guidReferences),
      templateReferences: Object.freeze(
        guidReferences.filter((reference) => reference.guidType === 'TemplateGUID')
      ),
      positions: Object.freeze(positions),
      sizes: Object.freeze(sizes),
      routePoints: Object.freeze(routePoints),
      unknownAttributes: Object.freeze(unknownAttributeRecords),
      supersededRecords: Object.freeze(supersededRecords),
      elementAccounting
    }),
    diagnostics: Object.freeze(diagnostics)
  })
}
