import LibraryZipImportWorker from './zipImport.worker?worker&inline'

import { ArchivePreflightError, type ArchiveErrorCode } from '../security/archivePreflight'
import { createRetainedInlineWorker } from '../workers/inlineWorker'
import { assertLibraryZipCompressedSize, type LibraryImportResult } from './zipImport'
import type {
  LibraryZipWorkerParseRequest,
  LibraryZipWorkerResponse
} from './zipImportWorkerProtocol'

interface WorkerLike {
  postMessage(message: unknown, transfer?: Transferable[]): void
  terminate(): void
  addEventListener(
    type: 'message',
    listener: (event: MessageEvent<LibraryZipWorkerResponse>) => void
  ): void
  addEventListener(type: 'error', listener: (event: ErrorEvent) => void): void
  removeEventListener(
    type: 'message',
    listener: (event: MessageEvent<LibraryZipWorkerResponse>) => void
  ): void
  removeEventListener(type: 'error', listener: (event: ErrorEvent) => void): void
}

export type LibraryZipWorkerFactory = () => WorkerLike

export const createLibraryZipWorker: LibraryZipWorkerFactory = () =>
  createRetainedInlineWorker(
    () => new LibraryZipImportWorker({ name: 'orbitpm-library-zip-parser' })
  )

export interface BrowserLibraryZipOptions {
  readonly signal?: AbortSignal
  readonly workerFactory?: LibraryZipWorkerFactory
}

let requestSequence = 0

function aborted(): ArchivePreflightError {
  return new ArchivePreflightError('aborted', 'Archive processing was cancelled')
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw aborted()
}

function nextRequestId(): string {
  requestSequence += 1
  return `library-zip-${Date.now().toString(36)}-${requestSequence.toString(36)}`
}

function runLibraryZipWorker(
  bytes: ArrayBuffer,
  options: BrowserLibraryZipOptions
): Promise<LibraryImportResult> {
  throwIfAborted(options.signal)
  const worker = (options.workerFactory ?? createLibraryZipWorker)()
  const requestId = nextRequestId()

  return new Promise<LibraryImportResult>((resolve, reject) => {
    let settled = false
    const finish = (callback: () => void): void => {
      if (settled) return
      settled = true
      options.signal?.removeEventListener('abort', onAbort)
      worker.removeEventListener('message', onMessage)
      worker.removeEventListener('error', onError)
      worker.terminate()
      callback()
    }
    const onAbort = (): void => finish(() => reject(aborted()))
    const onMessage = (event: MessageEvent<LibraryZipWorkerResponse>): void => {
      const response = event.data
      if (!response || response.requestId !== requestId) return
      if (response.type === 'error') {
        finish(() => {
          const error =
            response.code === 'unknown'
              ? new Error(response.message)
              : new ArchivePreflightError(response.code as ArchiveErrorCode, response.message)
          reject(error)
        })
        return
      }
      finish(() => resolve(response.result))
    }
    const onError = (): void => finish(() => reject(new Error('Library ZIP parser worker failed')))

    options.signal?.addEventListener('abort', onAbort, { once: true })
    worker.addEventListener('message', onMessage)
    worker.addEventListener('error', onError)
    const request: LibraryZipWorkerParseRequest = { type: 'parse', requestId, bytes }
    worker.postMessage(request, [bytes])
  })
}

/**
 * Browser boundary for whole-library ZIP import. Only bounded bytes cross into
 * the worker, where preflight, selective inflation, CRC, decoding, and manifest
 * parsing all complete before a structured result returns.
 */
export async function readLibraryZipFileInWorker(
  file: Pick<File, 'size' | 'arrayBuffer'>,
  options: BrowserLibraryZipOptions = {}
): Promise<LibraryImportResult> {
  throwIfAborted(options.signal)
  assertLibraryZipCompressedSize(file.size)
  const bytes = await file.arrayBuffer()
  throwIfAborted(options.signal)
  assertLibraryZipCompressedSize(bytes.byteLength)
  return runLibraryZipWorker(bytes, options)
}
