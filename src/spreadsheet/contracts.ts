import type { SpreadsheetErrorCode } from './errors'

export const PROCESS_WORKBOOK_MODEL_VERSION = 1 as const
export const MAPPING_PRESET_VERSION = 2 as const
export const OFFICIAL_TEMPLATE_VERSION = '0.4.5.1' as const

export type SpreadsheetLocale = 'en' | 'ar'
export type CellPrimitive = string | number | boolean | Date | null

export interface CellProvenance {
  readonly worksheet: string
  /** One-based worksheet row. */
  readonly row: number
  /** One-based worksheet column. */
  readonly column: number
  readonly address: string
  readonly rawValue?: unknown
  readonly displayedValue?: CellPrimitive
}

export interface RecordProvenance {
  readonly worksheet: string
  readonly row: number
  readonly fields?: Readonly<Record<string, CellProvenance>>
}

export interface BilingualValue {
  readonly en?: string
  readonly ar?: string
  readonly active: SpreadsheetLocale
}

export type BpmnNodeType =
  | 'task'
  | 'userTask'
  | 'serviceTask'
  | 'sendTask'
  | 'receiveTask'
  | 'businessRuleTask'
  | 'manualTask'
  | 'scriptTask'
  | 'callActivity'
  | 'subProcess'
  | 'startEvent'
  | 'endEvent'
  | 'intermediateCatchEvent'
  | 'intermediateThrowEvent'
  | 'exclusiveGateway'
  | 'inclusiveGateway'
  | 'parallelGateway'
  | 'complexGateway'
  | 'eventBasedGateway'

export const BPMN_NODE_TYPES: readonly BpmnNodeType[] = Object.freeze([
  'task',
  'userTask',
  'serviceTask',
  'sendTask',
  'receiveTask',
  'businessRuleTask',
  'manualTask',
  'scriptTask',
  'callActivity',
  'subProcess',
  'startEvent',
  'endEvent',
  'intermediateCatchEvent',
  'intermediateThrowEvent',
  'exclusiveGateway',
  'inclusiveGateway',
  'parallelGateway',
  'complexGateway',
  'eventBasedGateway'
])

export type EventDefinition =
  | 'none'
  | 'message'
  | 'timer'
  | 'signal'
  | 'conditional'
  | 'link'
  | 'error'
  | 'escalation'
  | 'terminate'

export type IdOrigin = 'explicit' | 'generated'

export interface WorkbookProcess {
  readonly id: string
  readonly idOrigin: IdOrigin
  readonly name: BilingualValue
  readonly description?: BilingualValue
  readonly owner?: BilingualValue
  readonly folder?: string
  readonly activeLanguage: SpreadsheetLocale
  readonly provenance: RecordProvenance
}

export type ParticipantType = 'pool' | 'lane'

export interface WorkbookParticipant {
  readonly processId: string
  readonly id: string
  readonly idOrigin: IdOrigin
  readonly type: ParticipantType
  readonly parentId?: string
  readonly order?: number
  readonly name: BilingualValue
  readonly provenance: RecordProvenance
}

export interface MappedTransition {
  readonly targetStepId: string
  readonly condition?: BilingualValue
  readonly isDefault?: boolean
  readonly provenance?: CellProvenance
}

export interface WorkbookNodeMetadata {
  readonly owner?: BilingualValue
  readonly raci?: string
  readonly responsibleParties?: readonly BilingualValue[]
  readonly channel?: BilingualValue
  readonly channelDetail?: BilingualValue
  readonly inputs?: readonly BilingualValue[]
  readonly outputs?: readonly BilingualValue[]
  readonly cc?: readonly BilingualValue[]
  readonly decisionBasis?: BilingualValue
  readonly triggers?: BilingualValue
  readonly notes?: BilingualValue
  readonly calledProcessId?: string
  /**
   * Set only after an explicit review. The generator must omit calledElement
   * when this is true rather than pretending the link resolved.
   */
  readonly reviewedUnlinkedCall?: boolean
  readonly eventDefinition?: EventDefinition
}

export interface WorkbookNode {
  readonly processId: string
  readonly id: string
  readonly idOrigin: IdOrigin
  readonly order?: number
  readonly type: BpmnNodeType | 'unknown'
  readonly rawType?: string
  readonly name: BilingualValue
  readonly poolId?: string
  readonly laneId?: string
  readonly participantId?: string
  readonly metadata: WorkbookNodeMetadata
  /** Mapped next-step values retained until the explicit inference review. */
  readonly nextStepIds?: readonly string[]
  /** Rich mapped transitions can carry conditions/default state. */
  readonly mappedTransitions?: readonly MappedTransition[]
  readonly provenance: RecordProvenance
}

export type FlowOrigin = 'explicit' | 'mapped' | 'inferred-order' | 'synthetic-boundary'

export interface WorkbookFlow {
  readonly processId: string
  readonly id: string
  readonly idOrigin: IdOrigin
  readonly sourceStepId: string
  readonly targetStepId: string
  readonly condition?: BilingualValue
  readonly isDefault: boolean
  readonly origin: FlowOrigin
  readonly provenance: RecordProvenance
}

export interface WorkbookGlossaryEntry {
  readonly english: string
  readonly arabic: string
  readonly doNotTranslate: boolean
  readonly caseSensitive: boolean
  readonly provenance: RecordProvenance
}

export interface SourceWorksheet {
  readonly name: string
  readonly headerRow: number
  readonly rowCount: number
  readonly columnCount: number
  readonly headerSignature: string
}

export interface ProcessWorkbookModel {
  readonly version: typeof PROCESS_WORKBOOK_MODEL_VERSION
  readonly templateVersion?: string
  readonly source: {
    readonly fileName: string
    readonly format: 'xlsx' | 'csv'
    readonly officialTemplate: boolean
    readonly worksheets: readonly SourceWorksheet[]
  }
  readonly processes: readonly WorkbookProcess[]
  readonly participants: readonly WorkbookParticipant[]
  readonly nodes: readonly WorkbookNode[]
  readonly flows: readonly WorkbookFlow[]
  readonly glossary: readonly WorkbookGlossaryEntry[]
}

export type CanonicalSheet = 'processes' | 'participants' | 'steps' | 'flows' | 'glossary'

export interface SheetSelection {
  readonly worksheet: string
  readonly headerRow: number
}

export type FieldMappings = Readonly<
  Partial<Record<CanonicalSheet, Readonly<Record<string, string>>>>
>

export interface MappingValueMappings {
  /**
   * Normalized displayed spreadsheet value -> canonical BPMN type.
   *
   * Keys contain only reviewed type labels, never worksheet rows or other
   * workbook contents.
   */
  readonly stepTypes: Readonly<Record<string, BpmnNodeType>>
  /** Normalized displayed spreadsheet value -> canonical participant type. */
  readonly participantTypes: Readonly<Record<string, ParticipantType>>
}

export interface MappingPreset {
  readonly version: typeof MAPPING_PRESET_VERSION
  readonly name: string
  readonly headerSignatures: Readonly<Partial<Record<CanonicalSheet, string>>>
  readonly selectedSheets: Readonly<Partial<Record<CanonicalSheet, SheetSelection>>>
  /** Canonical field -> displayed header. Never cell contents. */
  readonly fieldMappings: FieldMappings
  /** Explicit repairs for otherwise unknown raw type labels. */
  readonly valueMappings: MappingValueMappings
  readonly delimiters: {
    readonly list: readonly string[]
  }
  readonly inference: {
    readonly flowMode: 'explicit' | 'next-step' | 'numeric-order' | 'auto'
    readonly syntheticBoundaries: 'review' | 'never'
    readonly requireGatewayConditions: true
  }
  readonly locale: SpreadsheetLocale
}

export interface MappingDraft extends MappingPreset {
  readonly draftKey: string
  readonly updatedAt: string
  readonly destinationFolder?: string
  readonly collisionBehavior?: CollisionBehavior
  /** Reviewed low-confidence `sheetRole.canonicalField` mappings only. */
  readonly confirmedMappings?: readonly string[]
  readonly defaultProcessId?: string
  readonly defaultNameEn?: string
  readonly defaultNameAr?: string
  /**
   * Synthetic-event approval is restored only when `sourceIdentity` still
   * matches the exact browser File metadata.
   */
  readonly syntheticBoundaryConfirmed?: boolean
  /** File size and last-modified identity; never workbook contents. */
  readonly sourceIdentity?: string
}

export interface MappingDraftStore {
  load(draftKey: string): Promise<MappingDraft | undefined>
  save(draft: MappingDraft): Promise<void>
  remove(draftKey: string): Promise<void>
}

export interface WorkbookCell {
  readonly value: CellPrimitive
  readonly rawValue?: unknown
  /** Formula text is metadata only and must never be evaluated. */
  readonly formula?: string
  readonly cachedValuePresent?: boolean
}

export interface WorkbookSheetData {
  readonly name: string
  readonly rows: readonly (readonly WorkbookCell[])[]
}

export interface ParsedWorkbookData {
  readonly sheets: readonly WorkbookSheetData[]
  readonly customProperties?: Readonly<Record<string, string>>
}

export interface ParseProgress {
  readonly phase: 'preflight' | 'parse' | 'validate'
  readonly completed: number
  readonly total: number
}

export interface SpreadsheetParseOptions {
  readonly signal?: AbortSignal
  readonly onProgress?: (progress: ParseProgress) => void
}

/**
 * Integration seam for the pinned read-excel-file worker bundle. The adapter
 * must return displayed/cached values only; formatting and formulas are never
 * semantics.
 */
export interface XlsxParserAdapter {
  parseDisplayedValues(
    bytes: Uint8Array,
    options: SpreadsheetParseOptions
  ): Promise<ParsedWorkbookData>
}

/** Integration seam for a worker-based Papa Parse browser adapter. */
export interface CsvParserAdapter {
  parseUtf8(
    bytes: Uint8Array,
    options: SpreadsheetParseOptions & { readonly delimiter: string }
  ): Promise<readonly (readonly string[])[]>
}

export type ValidationSeverity = 'error' | 'review' | 'warning' | 'info'

export interface SpreadsheetValidationIssue {
  readonly code: string
  readonly severity: ValidationSeverity
  readonly messageKey: `spreadsheet.validation.${string}`
  readonly guidanceKey?: `spreadsheet.guidance.${string}`
  readonly processId?: string
  readonly elementId?: string
  readonly worksheet?: string
  readonly cellAddress?: string
  readonly rawValue?: unknown
  readonly normalizedValue?: unknown
  readonly details?: Readonly<Record<string, string | number | boolean>>
}

export interface WorkbookValidationReport {
  readonly issues: readonly SpreadsheetValidationIssue[]
  readonly blocking: boolean
  readonly errorCount: number
  readonly reviewCount: number
  readonly warningCount: number
}

export interface GeneratedIdRecord {
  readonly entity: 'participant' | 'node' | 'flow'
  readonly processId: string
  readonly generatedId: string
  readonly worksheet: string
  readonly row: number
}

export interface InferredFlowRecord {
  readonly processId: string
  readonly flowId: string
  readonly sourceStepId: string
  readonly targetStepId: string
  readonly reason: 'mapped-next-step' | 'numeric-order' | 'synthetic-boundary'
}

export interface SyntheticBoundaryRecord {
  readonly processId: string
  readonly kind: 'start' | 'end'
  readonly node: WorkbookNode
  readonly flow: WorkbookFlow
}

/**
 * Report-safe synthetic boundary provenance. Unlike SyntheticBoundaryRecord,
 * this contains IDs only and never embeds workbook rows, labels, or metadata.
 */
export interface SyntheticBoundarySummaryRecord {
  readonly processId: string
  readonly kind: 'start' | 'end'
  readonly nodeId: string
  readonly flowId: string
  readonly adjacentStepId: string
}

export interface GraphInferencePlan {
  readonly modelFingerprint: string
  readonly flowMode: MappingPreset['inference']['flowMode']
  readonly generatedIds: readonly GeneratedIdRecord[]
  readonly inferredFlows: readonly WorkbookFlow[]
  readonly inferredFlowRecords: readonly InferredFlowRecord[]
  readonly syntheticBoundaries: readonly SyntheticBoundaryRecord[]
  readonly issues: readonly SpreadsheetValidationIssue[]
  readonly requiresSyntheticBoundaryConfirmation: boolean
}

export interface ProcessGraphModel {
  readonly process: WorkbookProcess
  readonly participants: readonly WorkbookParticipant[]
  readonly nodes: readonly WorkbookNode[]
  readonly flows: readonly WorkbookFlow[]
  readonly glossary: readonly WorkbookGlossaryEntry[]
}

export interface PipelineDiagnostic {
  readonly stage: 'moddle' | 'metadata' | 'layout' | 'structural' | 'xsd' | 'lint' | 'link' | 'di'
  readonly severity: 'error' | 'warning'
  readonly code: string
  readonly details?: Readonly<Record<string, string | number | boolean>>
}

export interface GeneratedBpmnArtifact {
  readonly processId: string
  readonly semanticXml: string
  readonly layoutedXml: string
  readonly bytes: Uint8Array
  readonly diagnostics: readonly PipelineDiagnostic[]
}

/**
 * The production adapter is expected to use bpmn-moddle, the shared OrbitPM
 * metadata writer, auto-layout, and the common structural/XSD/lint/link/DI
 * validators. The spreadsheet core deliberately does not route through AI IR.
 */
export interface BpmnModelGenerationAdapter {
  generate(graph: ProcessGraphModel, signal?: AbortSignal): Promise<GeneratedBpmnArtifact>
}

export interface BilingualAuditSummary {
  readonly complete: boolean
  readonly missing: number
  readonly invalid: number
  readonly translationRequired: boolean
}

export interface SpreadsheetBilingualAuditAdapter {
  audit(graph: ProcessGraphModel): BilingualAuditSummary
}

export type CollisionBehavior = 'error' | 'overwrite' | 'rename'
export type WorkspaceDeliveryMode = 'directory' | 'opfs' | 'single-file'

export type SpreadsheetImportProgressPhase = 'generate' | 'stage' | 'commit' | 'rollback'

export interface SpreadsheetImportProgress {
  readonly phase: SpreadsheetImportProgressPhase
  readonly completed: number
  readonly total: number
}

export interface ImportDestination {
  readonly processId: string
  readonly path: string
  readonly behavior: 'create' | 'overwrite'
  readonly expectedHash?: string
}

export interface PreparedImportArtifact {
  readonly graph: ProcessGraphModel
  readonly generated: GeneratedBpmnArtifact
  readonly destination: ImportDestination
  readonly checksumSha256: string
  readonly translation: BilingualAuditSummary
}

export interface TransactionalImportPlan {
  readonly version: 1
  readonly id: string
  readonly createdAt: string
  readonly sourceFile: string
  readonly status: 'blocked' | 'ready'
  readonly mode: WorkspaceDeliveryMode
  readonly delivery: 'workspace' | 'open-single' | 'zip'
  readonly validation: WorkbookValidationReport
  readonly artifacts: readonly PreparedImportArtifact[]
  readonly generatedIds: readonly GeneratedIdRecord[]
  readonly inferredFlows: readonly InferredFlowRecord[]
  readonly syntheticBoundaries: readonly SyntheticBoundarySummaryRecord[]
  readonly warnings: readonly SpreadsheetValidationIssue[]
  readonly skippedRows: readonly RecordProvenance[]
  readonly mappingPreset?: MappingPreset
  readonly blockingReason?: SpreadsheetErrorCode | 'translation-review' | 'pipeline-validation'
}

export interface DestinationState {
  readonly path: string
  readonly exists: boolean
  readonly hash?: string
}

export interface ImportDestinationInspector {
  inspect(paths: readonly string[]): Promise<readonly DestinationState[]>
}

export interface StagedImportWrite {
  readonly path: string
  readonly bytes: Uint8Array
  readonly expectedHash?: string
  /** Recovery history must be created before an overwrite. */
  readonly createRecoveryRevision: boolean
}

export interface ImportTransactionCounterProgress {
  readonly completed: number
  readonly total: number
}

export interface ImportTransactionCommitOptions {
  /**
   * Cancellation is honored only while the adapter can still prove a clean
   * rollback. An irreversible browser delivery resolves or rejects according
   * to the delivery callback instead of racing the signal.
   */
  readonly signal?: AbortSignal
  readonly onProgress?: (progress: ImportTransactionCounterProgress) => void
}

export interface ImportDestinationTransaction {
  stage(write: StagedImportWrite): Promise<void>
  commit(options?: ImportTransactionCommitOptions): Promise<void>
  /** Rollback is deliberately unsignalled so cancellation cannot cancel cleanup. */
  rollback(): Promise<void>
}

export interface ImportTransactionFactory {
  begin(transactionId: string): Promise<ImportDestinationTransaction>
}

export interface ImportReportArtifact {
  readonly processId: string
  readonly destinationPath: string
  readonly checksumSha256: string
  readonly bytes: number
  readonly translation: BilingualAuditSummary
}

export interface SpreadsheetImportReport {
  readonly reportVersion: 1
  readonly planId: string
  readonly sourceFile: string
  readonly startedAt: string
  readonly completedAt: string
  readonly status: 'blocked' | 'committed' | 'rolled-back' | 'rollback-failed'
  readonly mapping?: MappingPreset
  readonly generatedIds: readonly GeneratedIdRecord[]
  readonly inferredFlows: readonly InferredFlowRecord[]
  readonly syntheticBoundaries: readonly SyntheticBoundarySummaryRecord[]
  readonly issues: readonly SpreadsheetValidationIssue[]
  readonly skippedRows: readonly RecordProvenance[]
  readonly artifacts: readonly ImportReportArtifact[]
  readonly failure?: {
    readonly code: SpreadsheetErrorCode
    readonly stage: 'prepare' | 'stage' | 'commit' | 'rollback'
  }
}
