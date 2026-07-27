import DocxParserWorker from './docx.worker?worker&inline'

import { createRetainedInlineWorker } from '../workers/inlineWorker'
import { assertDocxCompressedSize, DocxParseError } from './docx'
import type { DocxWorkerParseRequest, DocxWorkerResponse } from './docxWorkerProtocol'

interface WorkerLike {
  postMessage(message: unknown, transfer?: Transferable[]): void
  terminate(): void
  addEventListener(
    type: 'message',
    listener: (event: MessageEvent<DocxWorkerResponse>) => void
  ): void
  addEventListener(type: 'error', listener: (event: ErrorEvent) => void): void
  removeEventListener(
    type: 'message',
    listener: (event: MessageEvent<DocxWorkerResponse>) => void
  ): void
  removeEventListener(type: 'error', listener: (event: ErrorEvent) => void): void
}

export type DocxWorkerFactory = () => WorkerLike

export const createDocxWorker: DocxWorkerFactory = () =>
  createRetainedInlineWorker(() => new DocxParserWorker({ name: 'orbitpm-docx-parser' }))

export interface BrowserDocxParseOptions {
  readonly signal?: AbortSignal
  readonly workerFactory?: DocxWorkerFactory
}

let requestSequence = 0

function aborted(): DocxParseError {
  return new DocxParseError('aborted', 'DOCX processing was cancelled')
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw aborted()
}

function nextRequestId(): string {
  requestSequence += 1
  return `docx-${Date.now().toString(36)}-${requestSequence.toString(36)}`
}

function runDocxWorker(bytes: ArrayBuffer, options: BrowserDocxParseOptions): Promise<string> {
  throwIfAborted(options.signal)
  const worker = (options.workerFactory ?? createDocxWorker)()
  const requestId = nextRequestId()

  return new Promise<string>((resolve, reject) => {
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
    const onMessage = (event: MessageEvent<DocxWorkerResponse>): void => {
      const response = event.data
      if (!response || response.requestId !== requestId) return
      if (response.type === 'error') {
        finish(() => reject(new DocxParseError(response.code, response.message)))
        return
      }
      finish(() => resolve(response.text))
    }
    const onError = (): void =>
      finish(() => reject(new DocxParseError('malformed-archive', 'DOCX parser worker failed')))

    options.signal?.addEventListener('abort', onAbort, { once: true })
    worker.addEventListener('message', onMessage)
    worker.addEventListener('error', onError)
    const request: DocxWorkerParseRequest = { type: 'parse', requestId, bytes }
    worker.postMessage(request, [bytes])
  })
}

/**
 * Browser boundary for DOCX: reject from File metadata, then transfer the
 * bounded bytes to a dedicated worker for ZIP preflight, inflate, CRC, UTF-8,
 * XML tokenization, and output capping.
 */
export async function parseDocxFileInWorker(
  file: Pick<File, 'size' | 'arrayBuffer'>,
  options: BrowserDocxParseOptions = {}
): Promise<string> {
  throwIfAborted(options.signal)
  assertDocxCompressedSize(file.size)
  const bytes = await file.arrayBuffer()
  throwIfAborted(options.signal)
  assertDocxCompressedSize(bytes.byteLength)
  return runDocxWorker(bytes, options)
}
