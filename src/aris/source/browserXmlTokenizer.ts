import XmlTokenizerWorker from './xmlTokenizer.worker?worker&inline'

import { createRetainedInlineWorker } from '../../workers/inlineWorker'
import {
  tokenizeXmlDocument,
  XmlTokenizerError,
  type TokenizedXmlDocument,
  type XmlTokenizerLimits
} from './xmlTokenizer'
import type {
  XmlTokenizerWorkerRequest,
  XmlTokenizerWorkerResponse
} from './xmlTokenizerWorkerProtocol'

export interface WorkerLike {
  postMessage(message: unknown, transfer?: Transferable[]): void
  terminate(): void
  addEventListener(
    type: 'message',
    listener: (event: MessageEvent<XmlTokenizerWorkerResponse>) => void
  ): void
  addEventListener(type: 'error', listener: (event: ErrorEvent) => void): void
  removeEventListener(
    type: 'message',
    listener: (event: MessageEvent<XmlTokenizerWorkerResponse>) => void
  ): void
  removeEventListener(type: 'error', listener: (event: ErrorEvent) => void): void
}

export type XmlTokenizerWorkerFactory = () => WorkerLike

export const createXmlTokenizerWorker: XmlTokenizerWorkerFactory = () =>
  createRetainedInlineWorker(() => new XmlTokenizerWorker({ name: 'orbitpm-xml-tokenizer' }))

export interface BrowserXmlTokenizerOptions {
  readonly signal?: AbortSignal
  readonly limits?: Partial<XmlTokenizerLimits>
  readonly workerFactory?: XmlTokenizerWorkerFactory
}

let requestSequence = 0

function nextRequestId(): string {
  requestSequence += 1
  return `xml-tokenizer-${Date.now().toString(36)}-${requestSequence.toString(36)}`
}

function aborted(): DOMException {
  return new DOMException('XML tokenization was cancelled.', 'AbortError')
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw aborted()
}

// Deliberately `async`: every throw below (including the synchronous
// `throwIfAborted` and any thrown `XmlTokenizerError` from the tokenizer
// itself) is converted into a promise rejection instead of escaping this
// function synchronously. Callers rely on `tokenizeXmlInBrowser` always
// returning a promise that settles, never throwing directly.
async function fallbackTokenize(
  text: string,
  options: BrowserXmlTokenizerOptions
): Promise<TokenizedXmlDocument> {
  throwIfAborted(options.signal)
  try {
    return tokenizeXmlDocument(text, options.limits, options.signal)
  } catch (cause) {
    if (cause instanceof XmlTokenizerError && cause.code === 'cancelled') {
      throw aborted()
    }
    throw cause
  }
}

export function tokenizeXmlInBrowser(
  text: string,
  options: BrowserXmlTokenizerOptions = {}
): Promise<TokenizedXmlDocument> {
  if (typeof Worker === 'undefined') return fallbackTokenize(text, options)
  let worker: WorkerLike
  try {
    worker = (options.workerFactory ?? createXmlTokenizerWorker)()
  } catch {
    return fallbackTokenize(text, options)
  }
  if (options.signal?.aborted) {
    // Never leave a constructed worker thread dangling: an already-aborted
    // signal must terminate it immediately instead of posting any work.
    worker.terminate()
    return Promise.reject(aborted())
  }
  const requestId = nextRequestId()
  return new Promise<TokenizedXmlDocument>((resolve, reject) => {
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
    const onMessage = (event: MessageEvent<XmlTokenizerWorkerResponse>): void => {
      const response = event.data
      if (!response || response.requestId !== requestId) return
      if (response.type === 'error') {
        finish(() =>
          reject(
            response.code === 'unknown'
              ? new Error(response.message)
              : new XmlTokenizerError(response.code, response.message, 0)
          )
        )
        return
      }
      finish(() => resolve(response.document))
    }
    const onError = (): void => finish(() => reject(new Error('XML tokenizer worker failed.')))

    options.signal?.addEventListener('abort', onAbort, { once: true })
    worker.addEventListener('message', onMessage)
    worker.addEventListener('error', onError)
    const request: XmlTokenizerWorkerRequest = {
      type: 'tokenize',
      requestId,
      text,
      limits: options.limits
    }
    worker.postMessage(request)
  })
}
