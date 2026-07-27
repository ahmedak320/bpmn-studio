import type { ParsedWorkbookData, ParseProgress } from './contracts'
import type { SpreadsheetErrorCode } from './errors'

export type SpreadsheetWorkerFormat = 'xlsx' | 'csv'

export interface SpreadsheetWorkerParseRequest {
  readonly type: 'parse'
  readonly requestId: string
  readonly format: SpreadsheetWorkerFormat
  readonly bytes: ArrayBuffer
  readonly delimiter?: string
}

export interface SpreadsheetWorkerCancelRequest {
  readonly type: 'cancel'
  readonly requestId: string
}

export type SpreadsheetWorkerRequest =
  SpreadsheetWorkerParseRequest | SpreadsheetWorkerCancelRequest

export interface SpreadsheetWorkerProgressResponse {
  readonly type: 'progress'
  readonly requestId: string
  readonly progress: ParseProgress
}

export interface SpreadsheetWorkerXlsxResultResponse {
  readonly type: 'result'
  readonly requestId: string
  readonly format: 'xlsx'
  readonly workbook: ParsedWorkbookData
}

export interface SpreadsheetWorkerCsvResultResponse {
  readonly type: 'result'
  readonly requestId: string
  readonly format: 'csv'
  readonly rows: readonly (readonly string[])[]
}

export interface SpreadsheetWorkerErrorResponse {
  readonly type: 'error'
  readonly requestId: string
  readonly code: SpreadsheetErrorCode
  readonly details: Readonly<Record<string, string | number | boolean>>
}

export type SpreadsheetWorkerResponse =
  | SpreadsheetWorkerProgressResponse
  | SpreadsheetWorkerXlsxResultResponse
  | SpreadsheetWorkerCsvResultResponse
  | SpreadsheetWorkerErrorResponse
