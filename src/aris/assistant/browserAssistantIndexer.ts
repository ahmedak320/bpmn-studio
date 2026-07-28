// Browser entry point for off-thread index building — mirrors
// `src/aris/source/browserXmlTokenizer.ts`'s worker-with-fallback shape:
// prefer a real Worker (an inline, retained-blob-URL worker, same helper the
// XML tokenizer uses), fall back to synchronous in-thread building when
// `Worker` is unavailable (Node tests, locked-down hosts) or construction
// fails, and always resolve/reject the returned promise rather than throwing
// synchronously.

import IndexBuilderWorker from './indexBuilder.worker?worker&inline'

import { createRetainedInlineWorker } from '../../workers/inlineWorker'
import { buildAllDigests } from './digest'
import type { IndexBuilderWorkerRequest, IndexBuilderWorkerResponse } from './indexWorkerProtocol'
import type { ArisAssistantModelInput, ArisProcessDigest } from './types'

export interface WorkerLike {
  postMessage(message: unknown, transfer?: Transferable[]): void
  terminate(): void
  addEventListener(
    type: 'message',
    listener: (event: MessageEvent<IndexBuilderWorkerResponse>) => void
  ): void
  addEventListener(type: 'error', listener: (event: ErrorEvent) => void): void
  removeEventListener(
    type: 'message',
    listener: (event: MessageEvent<IndexBuilderWorkerResponse>) => void
  ): void
  removeEventListener(type: 'error', listener: (event: ErrorEvent) => void): void
}

export type IndexBuilderWorkerFactory = () => WorkerLike

export const createIndexBuilderWorker: IndexBuilderWorkerFactory = () =>
  createRetainedInlineWorker(() => new IndexBuilderWorker({ name: 'orbitpm-assistant-index-builder' }))

export interface BuildDigestsInBrowserOptions {
  readonly signal?: AbortSignal
  readonly workerFactory?: IndexBuilderWorkerFactory
}

let requestSequence = 0

function nextRequestId(): string {
  requestSequence += 1
  return `assistant-index-${Date.now().toString(36)}-${requestSequence.toString(36)}`
}

function aborted(): DOMException {
  return new DOMException('Index building was cancelled.', 'AbortError')
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw aborted()
}

async function fallbackBuild(
  models: readonly ArisAssistantModelInput[],
  options: BuildDigestsInBrowserOptions
): Promise<ArisProcessDigest[]> {
  throwIfAborted(options.signal)
  return buildAllDigests(models)
}

/** Build digests for many models off the UI thread when a Worker is available, in-thread otherwise. */
export function buildDigestsInBrowser(
  models: readonly ArisAssistantModelInput[],
  options: BuildDigestsInBrowserOptions = {}
): Promise<ArisProcessDigest[]> {
  if (typeof Worker === 'undefined') return fallbackBuild(models, options)
  let worker: WorkerLike
  try {
    worker = (options.workerFactory ?? createIndexBuilderWorker)()
  } catch {
    return fallbackBuild(models, options)
  }
  if (options.signal?.aborted) {
    worker.terminate()
    return Promise.reject(aborted())
  }
  const requestId = nextRequestId()
  return new Promise<ArisProcessDigest[]>((resolve, reject) => {
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
    const onMessage = (event: MessageEvent<IndexBuilderWorkerResponse>): void => {
      const response = event.data
      if (!response || response.requestId !== requestId) return
      if (response.type === 'error') {
        finish(() => reject(new Error(response.message)))
        return
      }
      finish(() => resolve([...response.digests]))
    }
    const onError = (): void => finish(() => reject(new Error('Assistant index builder worker failed.')))

    options.signal?.addEventListener('abort', onAbort, { once: true })
    worker.addEventListener('message', onMessage)
    worker.addEventListener('error', onError)
    const request: IndexBuilderWorkerRequest = { type: 'build', requestId, models }
    worker.postMessage(request)
  })
}
