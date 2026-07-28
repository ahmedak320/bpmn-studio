// Off-UI-thread digest building (Section 17.2 "Build large indexes off the
// UI thread"). Mirrors `src/aris/source/xmlTokenizer.worker.ts`'s shape
// exactly: a pure request handler that is unit-testable by direct call, plus
// a guarded `addEventListener` bootstrap that only activates inside an
// actual worker scope (never in a Node test process, which has neither
// `document` nor a worker-shaped `globalThis`).

import { buildAllDigests } from './digest'
import type { IndexBuilderWorkerRequest, IndexBuilderWorkerResponse } from './indexWorkerProtocol'

interface WorkerMessageEvent<T> {
  readonly data: T
}

interface IndexBuilderWorkerScope {
  addEventListener(
    type: 'message',
    listener: (event: WorkerMessageEvent<IndexBuilderWorkerRequest>) => void
  ): void
  postMessage(message: IndexBuilderWorkerResponse): void
}

export function handleIndexBuilderWorkerRequest(
  request: IndexBuilderWorkerRequest,
  post: (response: IndexBuilderWorkerResponse) => void
): void {
  try {
    post({ type: 'result', requestId: request.requestId, digests: buildAllDigests(request.models) })
  } catch (cause) {
    post({
      type: 'error',
      requestId: request.requestId,
      message: cause instanceof Error ? cause.message : String(cause)
    })
  }
}

const workerScope = globalThis as unknown as Partial<IndexBuilderWorkerScope>
if (
  typeof workerScope.addEventListener === 'function' &&
  typeof workerScope.postMessage === 'function' &&
  typeof document === 'undefined'
) {
  workerScope.addEventListener('message', (event) => {
    handleIndexBuilderWorkerRequest(event.data, (response) => workerScope.postMessage?.(response))
  })
}
