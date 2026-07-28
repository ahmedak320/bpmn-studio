import { tokenizeXmlDocument, XmlTokenizerError } from './xmlTokenizer'
import type {
  XmlTokenizerWorkerRequest,
  XmlTokenizerWorkerResponse
} from './xmlTokenizerWorkerProtocol'

interface WorkerMessageEvent<T> {
  readonly data: T
}

interface XmlTokenizerWorkerScope {
  addEventListener(
    type: 'message',
    listener: (event: WorkerMessageEvent<XmlTokenizerWorkerRequest>) => void
  ): void
  postMessage(message: XmlTokenizerWorkerResponse): void
}

export function handleXmlTokenizerWorkerRequest(
  request: XmlTokenizerWorkerRequest,
  post: (response: XmlTokenizerWorkerResponse) => void
): void {
  try {
    post({
      type: 'result',
      requestId: request.requestId,
      document: tokenizeXmlDocument(request.text, request.limits)
    })
  } catch (cause) {
    post({
      type: 'error',
      requestId: request.requestId,
      code: cause instanceof XmlTokenizerError ? cause.code : 'unknown',
      message: cause instanceof Error ? cause.message : String(cause)
    })
  }
}

const workerScope = globalThis as unknown as Partial<XmlTokenizerWorkerScope>
if (
  typeof workerScope.addEventListener === 'function' &&
  typeof workerScope.postMessage === 'function' &&
  typeof document === 'undefined'
) {
  workerScope.addEventListener('message', (event) => {
    handleXmlTokenizerWorkerRequest(event.data, (response) => workerScope.postMessage?.(response))
  })
}
