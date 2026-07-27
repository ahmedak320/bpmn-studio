import type { DocxErrorCode } from './docx'

export interface DocxWorkerParseRequest {
  readonly type: 'parse'
  readonly requestId: string
  readonly bytes: ArrayBuffer
}

export type DocxWorkerResponse =
  | {
      readonly type: 'result'
      readonly requestId: string
      readonly text: string
    }
  | {
      readonly type: 'error'
      readonly requestId: string
      readonly code: DocxErrorCode
      readonly message: string
    }
