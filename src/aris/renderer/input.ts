/**
 * Narrow structural input contract for the renderer — Plan Section 12.1.
 *
 * `src/aris/source/semanticIndex.ts` (owned by the source lane) already indexes every visual
 * input the plan lists: `ObjOcc` position/size, symbol number, z-order, pen/brush, connection
 * route points, attribute occurrence placement, fonts, model background/scale/grid, lanes, free
 * text, and OLE/blob placement. Rather than importing its concrete `ArisSourceIndex` type (and
 * coupling this lane to every field it happens to carry), this file declares the minimal shape
 * the renderer actually reads. `ArisSourceIndex` values are structurally assignable to
 * `ArisRenderSourceInput` as-is — no adapter object is required — so this stays a compile-time
 * seam, not a runtime dependency.
 */

// ---------------------------------------------------------------------------------------------
// Shared record shape
// ---------------------------------------------------------------------------------------------

/** The subset of `ArisSourceRecordBase` the renderer reads, for any record kind. */
export interface RenderSourceRecord<TParsed> {
  readonly sourceId: string | null
  readonly path: string
  readonly parsed: TParsed
}

// ---------------------------------------------------------------------------------------------
// Style catalog (pens, brushes, fonts, font style sheets)
// ---------------------------------------------------------------------------------------------

export interface RenderSourcePenParsed {
  readonly ownerSourceId: string | null
  readonly color: string | null
  readonly style: string | null
  readonly width: number | null
}
export type RenderSourcePen = RenderSourceRecord<RenderSourcePenParsed>

export interface RenderSourceBrushParsed {
  readonly ownerSourceId: string | null
  readonly color: string | null
  readonly color2: string | null
  readonly brushType: string | null
}
export type RenderSourceBrush = RenderSourceRecord<RenderSourceBrushParsed>

export interface RenderSourceFontParsed {
  readonly ownerSourceId: string | null
  readonly localeId: string | null
  readonly locale: 'en' | 'ar' | undefined
  readonly faceName: string | null
  readonly height: number | null
  readonly weight: number | null
  readonly italic: string | null
  readonly underline: string | null
  readonly strikeOut: string | null
  readonly color: string | null
}
export type RenderSourceFont = RenderSourceRecord<RenderSourceFontParsed>

export interface RenderSourceFontStyleSheetParsed {
  readonly fontStyleSheetId: string | null
}
export type RenderSourceFontStyleSheet = RenderSourceRecord<RenderSourceFontStyleSheetParsed>

export interface ArisRenderSourceStyleCatalog {
  readonly fontStyleSheets: ReadonlyMap<string, RenderSourceFontStyleSheet>
  readonly fonts: readonly RenderSourceFont[]
  readonly pens: readonly RenderSourcePen[]
  readonly brushes: readonly RenderSourceBrush[]
}

// ---------------------------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------------------------

export interface RenderSourceModelParsed {
  readonly modelId: string | null
  readonly modelType: string | null
  readonly gridUse: string | null
  readonly gridSize: number | null
  readonly scale: number | null
  readonly printScale: number | null
  readonly backColor: string | null
  readonly templateGuid: string | null
}
export type RenderSourceModel = RenderSourceRecord<RenderSourceModelParsed>

// ---------------------------------------------------------------------------------------------
// Object definitions / occurrences
// ---------------------------------------------------------------------------------------------

export interface RenderSourceObjectDefinitionParsed {
  readonly objectDefinitionId: string | null
  readonly typeNum: string | null
  readonly symbolNum: string | null
}
export type RenderSourceObjectDefinition = RenderSourceRecord<RenderSourceObjectDefinitionParsed>

export interface RenderSourceObjectOccurrenceParsed {
  readonly objectOccurrenceId: string | null
  readonly modelId: string | null
  readonly objectDefinitionId: string | null
  readonly symbolNum: string | null
  readonly zorder: number | null
  readonly x: number | null
  readonly y: number | null
  readonly dx: number | null
  readonly dy: number | null
  readonly symbolGuid: string | null
}
export type RenderSourceObjectOccurrence = RenderSourceRecord<RenderSourceObjectOccurrenceParsed>

// ---------------------------------------------------------------------------------------------
// Connection definitions / occurrences / route points
// ---------------------------------------------------------------------------------------------

export interface RenderSourceConnectionDefinitionParsed {
  readonly connectionDefinitionId: string | null
  readonly connectionType: string | null
}
export type RenderSourceConnectionDefinition =
  RenderSourceRecord<RenderSourceConnectionDefinitionParsed>

export interface RenderSourceConnectionOccurrenceParsed {
  readonly connectionOccurrenceId: string | null
  readonly modelId: string | null
  readonly fromObjectOccurrenceId: string | null
  readonly toObjectOccurrenceId: string | null
  readonly connectionDefinitionId: string | null
  readonly zorder: number | null
  readonly srcArrow: string | null
  readonly tgtArrow: string | null
  readonly visible: string | null
}
export type RenderSourceConnectionOccurrence =
  RenderSourceRecord<RenderSourceConnectionOccurrenceParsed>

export interface RenderSourceRoutePoint {
  readonly connectionOccurrenceId: string | null
  readonly modelId: string | null
  readonly pointIndex: number
  readonly x: number | null
  readonly y: number | null
}

// ---------------------------------------------------------------------------------------------
// Attributes / attribute occurrences (names + placement)
// ---------------------------------------------------------------------------------------------

export interface RenderSourceAttributeValue {
  readonly locale: 'en' | 'ar' | undefined
  readonly text: string
}

export interface RenderSourceAttributeParsed {
  readonly ownerSourceId: string | null
  readonly attributeType: string | null
  readonly values: readonly RenderSourceAttributeValue[]
}
export type RenderSourceAttribute = RenderSourceRecord<RenderSourceAttributeParsed>

export interface RenderSourceAttributeOccurrenceParsed {
  readonly ownerSourceId: string | null
  readonly attributeType: string | null
  readonly port: string | null
  readonly orderNum: number | null
  readonly alignment: string | null
  /** `TEXT` or `SYMBOL` — whether this placement draws the attribute's text or its symbol. */
  readonly symbolFlag: string | null
  readonly fontStyleSheetId: string | null
  readonly offsetX: number | null
  readonly offsetY: number | null
  readonly rotation: number | null
  readonly dx: number | null
  readonly dy: number | null
}
export type RenderSourceAttributeOccurrence =
  RenderSourceRecord<RenderSourceAttributeOccurrenceParsed>

// ---------------------------------------------------------------------------------------------
// Lanes
// ---------------------------------------------------------------------------------------------

export interface RenderSourceLaneParsed {
  readonly laneId: string | null
  readonly modelId: string | null
  readonly laneType: string | null
  readonly orientation: string | null
  readonly startBorder: number | null
  readonly endBorder: number | null
}
export type RenderSourceLane = RenderSourceRecord<RenderSourceLaneParsed>

// ---------------------------------------------------------------------------------------------
// Free text
// ---------------------------------------------------------------------------------------------

export interface RenderSourceFreeTextOccurrenceParsed {
  readonly modelId: string | null
  readonly freeTextDefinitionId: string | null
  readonly fontStyleSheetId: string | null
  readonly zorder: number | null
  readonly x: number | null
  readonly y: number | null
  readonly dx: number | null
  readonly dy: number | null
}
export type RenderSourceFreeTextOccurrence =
  RenderSourceRecord<RenderSourceFreeTextOccurrenceParsed>

// ---------------------------------------------------------------------------------------------
// OLE / attachments / blobs
// ---------------------------------------------------------------------------------------------

export interface RenderSourceAttachmentParsed {
  readonly attachmentId: string | null
  readonly blobCount: number
}
export type RenderSourceAttachment = RenderSourceRecord<RenderSourceAttachmentParsed>

export interface RenderSourceAttachmentOccurrenceParsed {
  readonly modelId: string | null
  readonly attachmentOccurrenceId: string | null
  readonly attachmentId: string | null
  readonly zorder: number | null
  readonly x: number | null
  readonly y: number | null
  readonly dx: number | null
  readonly dy: number | null
}
export type RenderSourceAttachmentOccurrence =
  RenderSourceRecord<RenderSourceAttachmentOccurrenceParsed>

// ---------------------------------------------------------------------------------------------
// Cross-package reference GUIDs (Section 12.3 "missing reference export")
// ---------------------------------------------------------------------------------------------

export interface RenderSourceGuidReference {
  readonly guidType: 'GUID' | 'MasterGUID' | 'SymbolGUID' | 'TemplateGUID' | 'ExternalGUID'
  readonly value: string
  readonly ownerSourceId: string | null
}

// ---------------------------------------------------------------------------------------------
// Top-level input
// ---------------------------------------------------------------------------------------------

export interface ArisRenderSourceInput {
  readonly models: ReadonlyMap<string, RenderSourceModel>
  readonly objectDefinitions: ReadonlyMap<string, RenderSourceObjectDefinition>
  readonly objectOccurrences: ReadonlyMap<string, RenderSourceObjectOccurrence>
  readonly connectionDefinitions: ReadonlyMap<string, RenderSourceConnectionDefinition>
  readonly connectionOccurrences: ReadonlyMap<string, RenderSourceConnectionOccurrence>
  readonly routePoints: readonly RenderSourceRoutePoint[]
  readonly attributes: readonly RenderSourceAttribute[]
  readonly attributeOccurrences: readonly RenderSourceAttributeOccurrence[]
  readonly lanes: ReadonlyMap<string, RenderSourceLane>
  readonly freeTextOccurrences: readonly RenderSourceFreeTextOccurrence[]
  readonly attachments: ReadonlyMap<string, RenderSourceAttachment>
  readonly attachmentOccurrences: readonly RenderSourceAttachmentOccurrence[]
  readonly styles: ArisRenderSourceStyleCatalog
  readonly guidReferences: readonly RenderSourceGuidReference[]
}
