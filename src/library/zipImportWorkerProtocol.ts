import type { ArchiveErrorCode } from '../security/archivePreflight'
import type { LibraryImportResult } from './zipImport'

export interface LibraryZipWorkerParseRequest {
  readonly type: 'parse'
  readonly requestId: string
  readonly bytes: ArrayBuffer
}

export type LibraryZipWorkerResponse =
  | {
      readonly type: 'result'
      readonly requestId: string
      readonly result: LibraryImportResult
    }
  | {
      readonly type: 'error'
      readonly requestId: string
      readonly code: ArchiveErrorCode | 'unknown'
      readonly message: string
    }
