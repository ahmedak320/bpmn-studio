import type { ArisExcelIssue } from './issues'
import type { ArisWorkbookParseResult } from './workbookModel'

/**
 * Worker message contract. The request carries raw bytes (transferable) and the
 * response carries the finished parse result, so no DOM object ever crosses the
 * boundary. Failures cross as a localizable issue, never as an English string.
 */
export interface ArisWorkbookWorkerRequest {
  readonly type: 'parse'
  readonly requestId: string
  readonly fileName: string
  readonly bytes: ArrayBuffer
  readonly mimeType?: string
}

export type ArisWorkbookWorkerResponse =
  | {
      readonly type: 'result'
      readonly requestId: string
      readonly result: ArisWorkbookParseResult
    }
  | {
      readonly type: 'error'
      readonly requestId: string
      readonly issue: ArisExcelIssue
    }
