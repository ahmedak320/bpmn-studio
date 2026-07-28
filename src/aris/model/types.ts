/**
 * Native ARIS working-model contracts.
 *
 * These types intentionally define only the narrow surface Phase 5 needs. They
 * avoid importing the concrete semantic-index types in `src/aris/source` because
 * that file is being reshaped by another agent. Structural typing lets the real
 * source index flow through `buildFromSource` without a hard type dependency.
 */

/** Database header taken from the AML `Header-Info` element. */
export interface ArisDatabase {
  readonly databaseName: string | null
  readonly createDate: string | null
  readonly createTime: string | null
  readonly userName: string | null
  readonly arisExeVersion: string | null
}

/** Bilingual or multi-locale text stored by locale identifier. */
export interface ArisLocalizedValue {
  readonly values: Readonly<Record<string, string>>
  readonly fallback: string | null
}

/** A named attribute value list attached to a definition or model. */
export interface ArisAttribute {
  readonly type: string
  readonly values: readonly ArisAttributeValue[]
}

export interface ArisAttributeValue {
  readonly localeId: string | null
  readonly text: string
}

/** A rendered attribute occurrence attached to an object or connection occurrence. */
export interface ArisAttributeOccurrence {
  readonly attributeType: string
  readonly port: string | null
  readonly orderNum: number | null
  readonly alignment: string | null
  readonly offsetX: number | null
  readonly offsetY: number | null
  readonly width: number | null
  readonly height: number | null
  readonly rotation: number | null
}

/** Supported model types for the first stable scope. */
export type ArisSupportedModelType = 'MT_EEPC' | 'MT_VAL_ADD_CHN_DGM'

/** Escape-hatch marker for a model type outside the supported scope. */
export type ArisUnsupportedModelType = string & { readonly __unsupported: true }

export type ArisModelType = ArisSupportedModelType | ArisUnsupportedModelType

/** A connection definition between two object definitions. */
export interface ArisConnectionDefinition {
  readonly id: string
  readonly type: string
  readonly fromObjectDefinitionId: string
  readonly toObjectDefinitionId: string
  readonly names: ArisLocalizedValue
  readonly attributes: readonly ArisAttribute[]
}

/** A swimlane or partition inside a model. */
export interface ArisLane {
  readonly id: string
  readonly modelId: string
  readonly names: ArisLocalizedValue
  readonly laneType: string | null
  readonly orientation: string | null
  readonly startBorder: number | null
  readonly endBorder: number | null
}

/** Free text occurrence placed on a model canvas. */
export interface ArisFreeText {
  readonly id: string
  readonly modelId: string
  readonly definitionId: string | null
  readonly text: ArisLocalizedValue
  readonly bounds: ArisBounds
  readonly style: ArisOccurrenceStyle
}

/** Model-level layout state such as scale, grid, and background. */
export interface ArisLayoutState {
  readonly scale: number | null
  readonly gridSize: number | null
  readonly backColor: string | null
  readonly printScale: number | null
  readonly curveRadius: number | null
  readonly arcRadius: number | null
}

export interface ArisBounds {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface ArisPoint {
  readonly x: number
  readonly y: number
}

/** Visual style of an object occurrence. */
export interface ArisOccurrenceStyle {
  readonly symbol: string | null
  readonly fillColor: string | null
  readonly strokeColor: string | null
  readonly strokeWidth: number | null
  readonly lineStyle: string | null
  readonly fontStyleSheetId: string | null
  readonly zOrder: number | null
}

/** Visual style of a connection occurrence. */
export interface ArisConnectionStyle {
  readonly color: string | null
  readonly width: number | null
  readonly lineStyle: string | null
  readonly srcArrow: string | null
  readonly tgtArrow: string | null
  readonly fontStyleSheetId: string | null
  readonly zOrder: number | null
}

/** A catalog of visual styles referenced by occurrences. */
export interface ArisStyle {
  readonly id: string
  readonly fillColor: string | null
  readonly strokeColor: string | null
  readonly strokeWidth: number | null
  readonly lineStyle: string | null
  readonly fontFamily: string | null
  readonly fontSize: number | null
  readonly fontWeight: string | null
  readonly textColor: string | null
  readonly zOrder: number | null
}

export interface ArisStyleCatalog {
  readonly styles: ReadonlyMap<string, ArisStyle>
}

/** Object definition — may have zero or more occurrences. */
export interface ArisObjectDefinition {
  readonly id: string
  readonly type: string
  readonly defaultSymbol: string | null
  readonly names: ArisLocalizedValue
  readonly attributes: readonly ArisAttribute[]
  readonly linkedModelIds: readonly string[]
  readonly rawAttributes: Readonly<Record<string, string>>
}

/** Object occurrence — references a definition and adds occurrence-local geometry/style. */
export interface ArisObjectOccurrence {
  readonly id: string
  readonly definitionId: string
  readonly modelId: string
  readonly symbol: string
  readonly bounds: ArisBounds
  readonly style: ArisOccurrenceStyle
  readonly attributeOccurrences: readonly ArisAttributeOccurrence[]
  readonly rawAttributes: Readonly<Record<string, string>>
}

/** Connection occurrence — references a definition and adds route/style endpoints. */
export interface ArisConnectionOccurrence {
  readonly id: string
  readonly definitionId: string
  readonly modelId: string
  readonly sourceOccurrenceId: string
  readonly targetOccurrenceId: string
  readonly route: readonly ArisPoint[]
  readonly style: ArisConnectionStyle
  readonly rawAttributes: Readonly<Record<string, string>>
}

/**
 * A model in the working document.
 *
 * The supported types are `MT_EEPC` and `MT_VAL_ADD_CHN_DGM`. Models with any
 * other `Model.Type` are represented through the explicit `unsupported` escape
 * hatch, which preserves the raw source record so nothing is silently dropped.
 */
export interface ArisModel {
  readonly id: string
  readonly type: ArisModelType
  readonly names: ArisLocalizedValue
  readonly attributes: readonly ArisAttribute[]
  readonly occurrences: readonly ArisObjectOccurrence[]
  readonly connectionOccurrences: readonly ArisConnectionOccurrence[]
  readonly lanes: readonly ArisLane[]
  readonly freeText: readonly ArisFreeText[]
  readonly layout: ArisLayoutState
  readonly unsupported: boolean
  readonly rawSourceRecord: unknown
}

/**
 * The editable ARIS working document. It keeps the source index attached so
 * every original record remains reachable and raw content is never lost.
 */
export interface ArisWorkingDocument {
  readonly database: ArisDatabase
  readonly models: ReadonlyMap<string, ArisModel>
  readonly objectDefinitions: ReadonlyMap<string, ArisObjectDefinition>
  readonly connectionDefinitions: ReadonlyMap<string, ArisConnectionDefinition>
  readonly styleCatalog: ArisStyleCatalog
  readonly sourceIndex: ArisSourceIndexLike
  readonly revision: number
}

/**
 * Narrow structural view of the semantic source index consumed by
 * `buildFromSource`. This decouples the working model from the concrete
 * `ArisSourceIndex` type while still requiring every record the builder needs.
 */
export interface ArisSourceIndexLike {
  readonly database: { readonly parsed: ArisDatabase } | null
  readonly models: ReadonlyMap<string, ArisSourceModelRecordLike>
  readonly objectDefinitions: ReadonlyMap<string, ArisSourceObjectDefinitionRecordLike>
  readonly objectOccurrences: ReadonlyMap<string, ArisSourceObjectOccurrenceRecordLike>
  readonly connectionDefinitions: ReadonlyMap<string, ArisSourceConnectionDefinitionRecordLike>
  readonly connectionOccurrences: ReadonlyMap<string, ArisSourceConnectionOccurrenceRecordLike>
  readonly attributes: readonly ArisSourceAttributeRecordLike[]
  readonly attributeOccurrences: readonly ArisSourceAttributeOccurrenceRecordLike[]
  readonly lanes: ReadonlyMap<string, ArisSourceLaneRecordLike>
  readonly freeText: ReadonlyMap<string, ArisSourceFreeTextRecordLike>
  readonly freeTextOccurrences: readonly ArisSourceFreeTextOccurrenceRecordLike[]
  readonly styles: {
    readonly fontStyleSheets: ReadonlyMap<string, { readonly parsed: { readonly fontStyleSheetId: string | null } }>
  }
  readonly unknownRecords: readonly unknown[]
  readonly routePoints: readonly ArisSourceRoutePointRecordLike[]
}

export interface ArisSourceRecordBaseLike<TParsed extends Record<string, unknown>> {
  readonly sourceId: string | null
  readonly rawAttributes: Readonly<Record<string, string>>
  readonly parsed: Readonly<TParsed>
}

export type ArisSourceModelRecordLike = ArisSourceRecordBaseLike<{
  readonly modelId: string | null
  readonly modelType: string | null
  readonly groupId: string | null
  readonly gridSize: number | null
  readonly scale: number | null
  readonly printScale: number | null
  readonly backColor: string | null
  readonly curveRadius: number | null
  readonly arcRadius: number | null
}>

export type ArisSourceObjectDefinitionRecordLike = ArisSourceRecordBaseLike<{
  readonly objectDefinitionId: string | null
  readonly typeNum: string | null
  readonly symbolNum: string | null
  readonly linkedModelIds: readonly string[]
}>

export type ArisSourceObjectOccurrenceRecordLike = ArisSourceRecordBaseLike<{
  readonly objectOccurrenceId: string | null
  readonly modelId: string | null
  readonly objectDefinitionId: string | null
  readonly symbolNum: string | null
  readonly x: number | null
  readonly y: number | null
  readonly dx: number | null
  readonly dy: number | null
  readonly zorder: number | null
}>

export type ArisSourceConnectionDefinitionRecordLike = ArisSourceRecordBaseLike<{
  readonly connectionDefinitionId: string | null
  readonly fromObjectDefinitionId: string | null
  readonly toObjectDefinitionId: string | null
  readonly connectionType: string | null
}>

export type ArisSourceConnectionOccurrenceRecordLike = ArisSourceRecordBaseLike<{
  readonly connectionOccurrenceId: string | null
  readonly modelId: string | null
  readonly fromObjectOccurrenceId: string | null
  readonly toObjectOccurrenceId: string | null
  readonly connectionDefinitionId: string | null
  readonly srcArrow: string | null
  readonly tgtArrow: string | null
  readonly zorder: number | null
}>

export type ArisSourceAttributeRecordLike = ArisSourceRecordBaseLike<{
  readonly ownerSourceId: string | null
  readonly attributeType: string | null
  readonly values: readonly { readonly localeId: string | null; readonly text: string }[]
}>

export type ArisSourceAttributeOccurrenceRecordLike = ArisSourceRecordBaseLike<{
  readonly ownerSourceId: string | null
  readonly attributeType: string | null
  readonly port: string | null
  readonly orderNum: number | null
  readonly alignment: string | null
  readonly offsetX: number | null
  readonly offsetY: number | null
  readonly rotation: number | null
  readonly dx: number | null
  readonly dy: number | null
}>

export type ArisSourceLaneRecordLike = ArisSourceRecordBaseLike<{
  readonly laneId: string | null
  readonly modelId: string | null
  readonly laneType: string | null
  readonly orientation: string | null
  readonly startBorder: number | null
  readonly endBorder: number | null
}>

export type ArisSourceFreeTextRecordLike = ArisSourceRecordBaseLike<{
  readonly freeTextDefinitionId: string | null
}>

export type ArisSourceFreeTextOccurrenceRecordLike = ArisSourceRecordBaseLike<{
  readonly modelId: string | null
  readonly freeTextDefinitionId: string | null
  readonly x: number | null
  readonly y: number | null
  readonly dx: number | null
  readonly dy: number | null
  readonly zorder: number | null
}>

export interface ArisSourceRoutePointRecordLike {
  readonly connectionOccurrenceId: string | null
  readonly pointIndex: number
  readonly x: number | null
  readonly y: number | null
}
