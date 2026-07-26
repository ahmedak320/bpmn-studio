import { DocxParseError, extractDocxText } from './docx'
import type { DocxWorkerParseRequest, DocxWorkerResponse } from './docxWorkerProtocol'

interface WorkerMessageEvent<T> {
  readonly data: T
}

interface DocxWorkerScope {
  addEventListener(
    type: 'message',
    listener: (event: WorkerMessageEvent<DocxWorkerParseRequest>) => void
  ): void
  postMessage(message: DocxWorkerResponse): void
}

export function handleDocxWorkerRequest(
  request: DocxWorkerParseRequest,
  post: (response: DocxWorkerResponse) => void
): void {
  try {
    post({
      type: 'result',
      requestId: request.requestId,
      text: extractDocxText(new Uint8Array(request.bytes))
    })
  } catch (cause) {
    const error =
      cause instanceof DocxParseError
        ? cause
        : new DocxParseError(
            'malformed-archive',
            cause instanceof Error ? cause.message : String(cause)
          )
    post({
      type: 'error',
      requestId: request.requestId,
      code: error.code,
      message: error.message
    })
  }
}

const workerScope = globalThis as unknown as Partial<DocxWorkerScope>
if (
  typeof workerScope.addEventListener === 'function' &&
  typeof workerScope.postMessage === 'function' &&
  typeof document === 'undefined'
) {
  workerScope.addEventListener('message', (event) => {
    handleDocxWorkerRequest(event.data, (response) => workerScope.postMessage?.(response))
  })
}
