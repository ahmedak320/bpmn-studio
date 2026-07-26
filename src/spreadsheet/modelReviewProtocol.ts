import type {
  GraphInferencePlan,
  ParsedWorkbookData,
  ProcessWorkbookModel,
  RecordProvenance,
  SpreadsheetValidationIssue,
  WorkbookValidationReport
} from './contracts'
import type { SpreadsheetErrorCode } from './errors'
import type { ModelBuildOptions } from './modelBuilder'

export const SPREADSHEET_MODEL_REVIEW_STAGE_COUNT = 5

export type SpreadsheetModelReviewPhase =
  'build-model' | 'apply-destination' | 'infer-graph' | 'apply-inference' | 'validate-model'

export interface SpreadsheetModelReviewProgress {
  readonly phase: SpreadsheetModelReviewPhase
  /** Number of complete stages. */
  readonly completed: number
  readonly total: typeof SPREADSHEET_MODEL_REVIEW_STAGE_COUNT
}

/**
 * This deliberately contains data only. AbortSignal, callbacks, Sets, file
 * handles, and workspace adapters stay on the browser side of the worker.
 */
export interface SpreadsheetModelReviewInput {
  readonly workbook: ParsedWorkbookData
  readonly buildOptions: ModelBuildOptions
  readonly destinationFolder: string
  readonly knownProcessIds: readonly string[]
  readonly sourceIssues?: readonly SpreadsheetValidationIssue[]
  readonly confirmSyntheticBoundaries: boolean
}

export interface SpreadsheetModelReviewResult {
  readonly model: ProcessWorkbookModel
  readonly inference: GraphInferencePlan
  readonly validation: WorkbookValidationReport
  readonly issues: readonly SpreadsheetValidationIssue[]
  readonly additionalIssues: readonly SpreadsheetValidationIssue[]
  readonly skippedRows: readonly RecordProvenance[]
  readonly ready: boolean
}

export interface SpreadsheetModelReviewRunRequest {
  readonly type: 'review'
  readonly requestId: string
  readonly input: SpreadsheetModelReviewInput
}

export interface SpreadsheetModelReviewCancelRequest {
  readonly type: 'cancel'
  readonly requestId: string
}

export type SpreadsheetModelReviewWorkerRequest =
  SpreadsheetModelReviewRunRequest | SpreadsheetModelReviewCancelRequest

export interface SpreadsheetModelReviewProgressResponse {
  readonly type: 'progress'
  readonly requestId: string
  readonly progress: SpreadsheetModelReviewProgress
}

export interface SpreadsheetModelReviewResultResponse {
  readonly type: 'result'
  readonly requestId: string
  readonly result: SpreadsheetModelReviewResult
}

export interface SpreadsheetModelReviewErrorResponse {
  readonly type: 'error'
  readonly requestId: string
  readonly code: SpreadsheetErrorCode
  readonly details: Readonly<Record<string, string | number | boolean>>
}

export type SpreadsheetModelReviewWorkerResponse =
  | SpreadsheetModelReviewProgressResponse
  | SpreadsheetModelReviewResultResponse
  | SpreadsheetModelReviewErrorResponse
