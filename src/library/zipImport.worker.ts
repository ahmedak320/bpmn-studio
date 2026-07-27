import { ArchivePreflightError } from '../security/archivePreflight'
import { readLibraryZip } from './zipImport'
import type {
  LibraryZipWorkerParseRequest,
  LibraryZipWorkerResponse
} from './zipImportWorkerProtocol'

interface WorkerMessageEvent<T> {
  readonly data: T
}

interface LibraryZipWorkerScope {
  addEventListener(
    type: 'message',
    listener: (event: WorkerMessageEvent<LibraryZipWorkerParseRequest>) => void
  ): void
  postMessage(message: LibraryZipWorkerResponse): void
}

export function handleLibraryZipWorkerRequest(
  request: LibraryZipWorkerParseRequest,
  post: (response: LibraryZipWorkerResponse) => void
): void {
  try {
    post({
      type: 'result',
      requestId: request.requestId,
      result: readLibraryZip(new Uint8Array(request.bytes))
    })
  } catch (cause) {
    post({
      type: 'error',
      requestId: request.requestId,
      code: cause instanceof ArchivePreflightError ? cause.code : 'unknown',
      message: cause instanceof Error ? cause.message : String(cause)
    })
  }
}

const workerScope = globalThis as unknown as Partial<LibraryZipWorkerScope>
if (
  typeof workerScope.addEventListener === 'function' &&
  typeof workerScope.postMessage === 'function' &&
  typeof document === 'undefined'
) {
  workerScope.addEventListener('message', (event) => {
    handleLibraryZipWorkerRequest(event.data, (response) => workerScope.postMessage?.(response))
  })
}
