import ArisWorkbookParserWorker from './workbookParser.worker?worker&inline'

import { createRetainedInlineWorker } from '../../workers/inlineWorker'
import { ArisExcelIssueError, createArisExcelIssue } from './issues'
import { parseArisWorkbook, type ArisWorkbookParseOptions } from './workbookParser'
import type { ArisWorkbookParseResult } from './workbookModel'
import type {
  ArisWorkbookWorkerRequest,
  ArisWorkbookWorkerResponse
} from './workbookParserWorkerProtocol'

/**
 * Inline-worker boundary for the workbook parser (§15.3 step 4), mirroring
 * `src/aris/source/browserXmlTokenizer.ts`. The worker is terminated on
 * settle, cancel, or failure, and the parser degrades to the identical
 * in-process function when workers are unavailable (for example a `file://`
 * host that blocks blob workers).
 */

interface WorkerLike {
  postMessage(message: unknown, transfer?: Transferable[]): void
  terminate(): void
  addEventListener(
    type: 'message',
    listener: (event: MessageEvent<ArisWorkbookWorkerResponse>) => void
  ): void
  addEventListener(type: 'error', listener: (event: ErrorEvent) => void): void
  removeEventListener(
    type: 'message',
    listener: (event: MessageEvent<ArisWorkbookWorkerResponse>) => void
  ): void
  removeEventListener(type: 'error', listener: (event: ErrorEvent) => void): void
}

export type ArisWorkbookWorkerFactory = () => WorkerLike

export const createArisWorkbookParserWorker: ArisWorkbookWorkerFactory = () =>
  createRetainedInlineWorker(
    () => new ArisWorkbookParserWorker({ name: 'orbitpm-aris-workbook-parser' })
  )

export interface BrowserArisWorkbookParseOptions extends ArisWorkbookParseOptions {
  readonly signal?: AbortSignal
  readonly workerFactory?: ArisWorkbookWorkerFactory
}

let requestSequence = 0

function nextRequestId(): string {
  requestSequence += 1
  return `aris-workbook-${requestSequence.toString(36)}`
}

function aborted(): DOMException {
  return new DOMException('ARIS workbook parsing was cancelled.', 'AbortError')
}

function copyBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}

function parseInProcess(
  fileName: string,
  bytes: Uint8Array,
  options: BrowserArisWorkbookParseOptions
): Promise<ArisWorkbookParseResult> {
  if (options.signal?.aborted) return Promise.reject(aborted())
  return Promise.resolve(
    parseArisWorkbook(
      fileName,
      bytes,
      options.mimeType === undefined ? {} : { mimeType: options.mimeType }
    )
  )
}

export function parseArisWorkbookInBrowser(
  fileName: string,
  bytes: Uint8Array,
  options: BrowserArisWorkbookParseOptions = {}
): Promise<ArisWorkbookParseResult> {
  if (typeof Worker === 'undefined' && !options.workerFactory) {
    return parseInProcess(fileName, bytes, options)
  }
  let worker: WorkerLike
  try {
    worker = (options.workerFactory ?? createArisWorkbookParserWorker)()
  } catch {
    return parseInProcess(fileName, bytes, options)
  }
  if (options.signal?.aborted) {
    worker.terminate()
    return Promise.reject(aborted())
  }

  const requestId = nextRequestId()
  return new Promise<ArisWorkbookParseResult>((resolve, reject) => {
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
    const onMessage = (event: MessageEvent<ArisWorkbookWorkerResponse>): void => {
      const response = event.data
      if (!response || response.requestId !== requestId) return
      if (response.type === 'error') {
        finish(() => reject(new ArisExcelIssueError(response.issue)))
        return
      }
      finish(() => resolve(response.result))
    }
    const onError = (): void =>
      finish(() =>
        reject(
          new ArisExcelIssueError(
            createArisExcelIssue('internal-error', 'error', {
              details: { reason: 'worker-failed' }
            })
          )
        )
      )

    options.signal?.addEventListener('abort', onAbort, { once: true })
    worker.addEventListener('message', onMessage)
    worker.addEventListener('error', onError)
    const buffer = copyBuffer(bytes)
    const request: ArisWorkbookWorkerRequest = {
      type: 'parse',
      requestId,
      fileName,
      bytes: buffer,
      ...(options.mimeType === undefined ? {} : { mimeType: options.mimeType })
    }
    worker.postMessage(request, [buffer])
  })
}
