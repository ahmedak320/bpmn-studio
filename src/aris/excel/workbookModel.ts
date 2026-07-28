import type { ArisExcelIssue } from './issues'
import type {
  ArisAttributeOwnerKind,
  ArisTemplateModelType,
  ArisObjectType,
  ArisRoutePoint,
  ArisSheetName
} from './templateSchema'

/**
 * `ArisWorkbookModel` is the seam between the workbook pipeline and everything
 * downstream (AML generation, layout, accounting, transactional commit).
 *
 * Contract for consumers (the AML generator lane in particular):
 * - It is produced only by `parseArisWorkbook` and only when the result status
 *   is `accepted` (no `error`-severity issue was raised).
 * - Every scalar is an `ArisSourcedValue<T>`: the coerced value, the raw cell
 *   text exactly as authored, and the sheet + A1 address it came from. Nothing
 *   downstream ever has to guess where a value originated, so source-cell
 *   provenance reaches accounting and issue reporting unchanged (§15.6).
 * - Absent optional values are `undefined` rather than empty strings.
 * - Identifiers are validated for uniqueness and referential integrity before
 *   the model is built; a consumer may assume every reference resolves.
 * - Coordinates/sizes are optional on purpose: the layout lane fills the gaps.
 * - The model contains NO AML, NO layout, and NO transaction state. Generating
 *   AML, allocating missing IDs, laying out, and committing are downstream
 *   responsibilities (§15.3 steps 9-13).
 */

export interface ArisCellProvenance {
  readonly sheet: ArisSheetName | string
  /** A1-style address, e.g. `C7`. */
  readonly cell: string
  readonly row: number
  /** Column letters, e.g. `C`. */
  readonly column: string
  /** Header name of the column, e.g. `object_id`. */
  readonly field: string
}

export interface ArisRowProvenance {
  readonly sheet: ArisSheetName | string
  readonly row: number
}

export interface ArisSourcedValue<T> {
  readonly value: T
  /** The cell text exactly as authored, before coercion or trimming. */
  readonly raw: string
  readonly provenance: ArisCellProvenance
}

export interface ArisWorkbookModelRecord {
  readonly modelId: ArisSourcedValue<string>
  readonly modelType: ArisSourcedValue<ArisTemplateModelType>
  readonly nameEn: ArisSourcedValue<string>
  readonly nameAr?: ArisSourcedValue<string>
  readonly processCode?: ArisSourcedValue<string>
  readonly descriptionEn?: ArisSourcedValue<string>
  readonly descriptionAr?: ArisSourcedValue<string>
  readonly orientation?: ArisSourcedValue<string>
  readonly source: ArisRowProvenance
}

export interface ArisWorkbookObjectRecord {
  readonly modelId: ArisSourcedValue<string>
  readonly objectId: ArisSourcedValue<string>
  readonly occurrenceId: ArisSourcedValue<string>
  readonly objectType: ArisSourcedValue<ArisObjectType>
  readonly symbolType: ArisSourcedValue<string>
  readonly nameEn: ArisSourcedValue<string>
  readonly nameAr?: ArisSourcedValue<string>
  readonly laneId?: ArisSourcedValue<string>
  readonly order?: ArisSourcedValue<number>
  readonly x?: ArisSourcedValue<number>
  readonly y?: ArisSourcedValue<number>
  readonly width?: ArisSourcedValue<number>
  readonly height?: ArisSourcedValue<number>
  readonly assignedModelId?: ArisSourcedValue<string>
  readonly styleId?: ArisSourcedValue<string>
  readonly source: ArisRowProvenance
}

export interface ArisWorkbookConnectionRecord {
  readonly modelId: ArisSourcedValue<string>
  readonly connectionId: ArisSourcedValue<string>
  readonly sourceOccurrenceId: ArisSourcedValue<string>
  readonly targetOccurrenceId: ArisSourcedValue<string>
  readonly connectionType: ArisSourcedValue<string>
  readonly nameEn?: ArisSourcedValue<string>
  readonly nameAr?: ArisSourcedValue<string>
  readonly routePoints?: ArisSourcedValue<readonly ArisRoutePoint[]>
  readonly styleId?: ArisSourcedValue<string>
  readonly source: ArisRowProvenance
}

export interface ArisWorkbookAttributeRecord {
  readonly ownerKind: ArisSourcedValue<ArisAttributeOwnerKind>
  readonly ownerId: ArisSourcedValue<string>
  readonly attributeType: ArisSourcedValue<string>
  readonly language?: ArisSourcedValue<string>
  readonly value?: ArisSourcedValue<string>
  readonly valueType?: ArisSourcedValue<string>
  readonly sequence?: ArisSourcedValue<number>
  readonly source: ArisRowProvenance
}

export interface ArisWorkbookAssignmentRecord {
  readonly sourceObjectId: ArisSourcedValue<string>
  readonly targetModelId: ArisSourcedValue<string>
  readonly assignmentType: ArisSourcedValue<string>
  readonly source: ArisRowProvenance
}

export interface ArisWorkbookLaneRecord {
  readonly modelId: ArisSourcedValue<string>
  readonly laneId: ArisSourcedValue<string>
  readonly nameEn: ArisSourcedValue<string>
  readonly nameAr?: ArisSourcedValue<string>
  readonly x?: ArisSourcedValue<number>
  readonly y?: ArisSourcedValue<number>
  readonly width?: ArisSourcedValue<number>
  readonly height?: ArisSourcedValue<number>
  readonly orientation?: ArisSourcedValue<string>
  readonly source: ArisRowProvenance
}

export interface ArisWorkbookFreeTextRecord {
  readonly modelId: ArisSourcedValue<string>
  readonly textId: ArisSourcedValue<string>
  readonly textEn: ArisSourcedValue<string>
  readonly textAr?: ArisSourcedValue<string>
  readonly x?: ArisSourcedValue<number>
  readonly y?: ArisSourcedValue<number>
  readonly width?: ArisSourcedValue<number>
  readonly height?: ArisSourcedValue<number>
  readonly styleId?: ArisSourcedValue<string>
  readonly source: ArisRowProvenance
}

export interface ArisWorkbookStyleRecord {
  readonly styleId: ArisSourcedValue<string>
  readonly fillColor?: ArisSourcedValue<string>
  readonly strokeColor?: ArisSourcedValue<string>
  readonly strokeWidth?: ArisSourcedValue<number>
  readonly lineStyle?: ArisSourcedValue<string>
  readonly fontFamily?: ArisSourcedValue<string>
  readonly fontSize?: ArisSourcedValue<number>
  readonly fontWeight?: ArisSourcedValue<string>
  readonly textColor?: ArisSourcedValue<string>
  readonly zOrder?: ArisSourcedValue<number>
  readonly source: ArisRowProvenance
}

export interface ArisWorkbookGlossaryRecord {
  readonly english: ArisSourcedValue<string>
  readonly arabic: ArisSourcedValue<string>
  readonly doNotTranslate?: ArisSourcedValue<boolean>
  readonly caseSensitive?: ArisSourcedValue<boolean>
  readonly source: ArisRowProvenance
}

export interface ArisWorkbookCounts {
  readonly models: number
  readonly objectDefinitions: number
  readonly objectOccurrences: number
  readonly connections: number
  readonly lanes: number
  readonly freeText: number
  readonly styles: number
  readonly attributes: number
  readonly assignments: number
  readonly glossary: number
  readonly controlFlowObjectsByModel: ReadonlyMap<string, number>
}

export interface ArisWorkbookIndex {
  readonly modelsById: ReadonlyMap<string, ArisWorkbookModelRecord>
  /** Every occurrence of an object definition, keyed by `object_id`. */
  readonly occurrencesByObjectId: ReadonlyMap<string, readonly ArisWorkbookObjectRecord[]>
  readonly occurrencesById: ReadonlyMap<string, ArisWorkbookObjectRecord>
  readonly objectsByModelId: ReadonlyMap<string, readonly ArisWorkbookObjectRecord[]>
  readonly connectionsByModelId: ReadonlyMap<string, readonly ArisWorkbookConnectionRecord[]>
  readonly lanesById: ReadonlyMap<string, ArisWorkbookLaneRecord>
  readonly stylesById: ReadonlyMap<string, ArisWorkbookStyleRecord>
  readonly freeTextById: ReadonlyMap<string, ArisWorkbookFreeTextRecord>
  /** Target model ids assigned to each object definition, in workbook order. */
  readonly assignedModelIdsByObjectId: ReadonlyMap<string, readonly string[]>
}

export interface ArisWorkbookSource {
  readonly fileName: string
  readonly byteLength: number
}

export interface ArisWorkbookTemplateDetection {
  readonly official: boolean
  readonly templateVersion?: string
  readonly templateKind?: string
  /** True when the retired BPMN-oriented 0.4.5 workbook was recognized. */
  readonly legacyBpmnWorkbook: boolean
  /** Where the identity was found: custom property and/or banner cell. */
  readonly evidence: readonly ('custom-property' | 'identity-property' | 'banner-cell')[]
}

/** The validated, provenance-carrying in-memory workbook (§15.3 step 7). */
export interface ArisWorkbookModel {
  readonly templateVersion: string
  readonly detection: ArisWorkbookTemplateDetection
  readonly source: ArisWorkbookSource
  readonly models: readonly ArisWorkbookModelRecord[]
  readonly objects: readonly ArisWorkbookObjectRecord[]
  readonly connections: readonly ArisWorkbookConnectionRecord[]
  readonly attributes: readonly ArisWorkbookAttributeRecord[]
  readonly assignments: readonly ArisWorkbookAssignmentRecord[]
  readonly lanes: readonly ArisWorkbookLaneRecord[]
  readonly freeText: readonly ArisWorkbookFreeTextRecord[]
  readonly styles: readonly ArisWorkbookStyleRecord[]
  readonly glossary: readonly ArisWorkbookGlossaryRecord[]
  readonly index: ArisWorkbookIndex
  readonly counts: ArisWorkbookCounts
}

export interface ArisWorkbookParseResult {
  /** `accepted` only when no issue has `error` severity. */
  readonly status: 'accepted' | 'rejected'
  readonly fileName: string
  readonly detection: ArisWorkbookTemplateDetection
  /** Present exactly when `status === 'accepted'`. */
  readonly model?: ArisWorkbookModel
  readonly issues: readonly ArisExcelIssue[]
  readonly issueCounts: {
    readonly errors: number
    readonly warnings: number
    readonly infos: number
  }
}

/** Narrowing helper for downstream lanes (AML generation, commit). */
export function isAcceptedArisWorkbook(
  result: ArisWorkbookParseResult
): result is ArisWorkbookParseResult & { readonly model: ArisWorkbookModel } {
  return result.status === 'accepted' && result.model !== undefined
}

/** Renders a provenance record as `Sheet!A1` for logs and accounting rows. */
export function formatProvenance(provenance: ArisCellProvenance): string {
  return `${provenance.sheet}!${provenance.cell}`
}
