import { ArisExcelIssueError, createArisExcelIssue } from './issues'
import { parseArisWorkbook } from './workbookParser'
import type {
  ArisWorkbookWorkerRequest,
  ArisWorkbookWorkerResponse
} from './workbookParserWorkerProtocol'

interface WorkerMessageEvent<T> {
  readonly data: T
}

interface ArisWorkbookWorkerScope {
  addEventListener(
    type: 'message',
    listener: (event: WorkerMessageEvent<ArisWorkbookWorkerRequest>) => void
  ): void
  postMessage(message: ArisWorkbookWorkerResponse): void
}

export function handleArisWorkbookWorkerRequest(
  request: ArisWorkbookWorkerRequest,
  post: (response: ArisWorkbookWorkerResponse) => void
): void {
  try {
    post({
      type: 'result',
      requestId: request.requestId,
      result: parseArisWorkbook(
        request.fileName,
        new Uint8Array(request.bytes),
        request.mimeType === undefined ? {} : { mimeType: request.mimeType }
      )
    })
  } catch (cause) {
    post({
      type: 'error',
      requestId: request.requestId,
      issue:
        cause instanceof ArisExcelIssueError
          ? cause.issue
          : createArisExcelIssue('internal-error', 'error', {
              details: { reason: cause instanceof Error ? cause.name : 'unknown' }
            })
    })
  }
}

const workerScope = globalThis as unknown as Partial<ArisWorkbookWorkerScope>
if (
  typeof workerScope.addEventListener === 'function' &&
  typeof workerScope.postMessage === 'function' &&
  typeof document === 'undefined'
) {
  workerScope.addEventListener('message', (event) => {
    handleArisWorkbookWorkerRequest(event.data, (response) => workerScope.postMessage?.(response))
  })
}
