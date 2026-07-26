import { SpreadsheetError } from './errors'
import { computeSpreadsheetModelReview } from './modelReview'
import type {
  SpreadsheetModelReviewRunRequest,
  SpreadsheetModelReviewWorkerRequest,
  SpreadsheetModelReviewWorkerResponse
} from './modelReviewProtocol'

interface WorkerMessageEvent<T> {
  readonly data: T
}

interface SpreadsheetModelReviewWorkerScope {
  addEventListener(
    type: 'message',
    listener: (event: WorkerMessageEvent<SpreadsheetModelReviewWorkerRequest>) => void
  ): void
  postMessage(message: SpreadsheetModelReviewWorkerResponse): void
}

const MAX_ERROR_DETAIL_COUNT = 24
const MAX_ERROR_STRING_LENGTH = 256

function safeErrorDetails(details: unknown): Readonly<Record<string, string | number | boolean>> {
  if (!details || typeof details !== 'object' || Array.isArray(details)) {
    return Object.freeze({})
  }
  const safe: Record<string, string | number | boolean> = {}
  for (const [key, value] of Object.entries(details).slice(0, MAX_ERROR_DETAIL_COUNT)) {
    if (!/^[a-zA-Z0-9_.-]{1,64}$/.test(key)) continue
    if (typeof value === 'string') {
      safe[key] = value.slice(0, MAX_ERROR_STRING_LENGTH)
    } else if (typeof value === 'boolean') {
      safe[key] = value
    } else if (typeof value === 'number' && Number.isFinite(value)) {
      safe[key] = value
    }
  }
  return Object.freeze(safe)
}

function workerError(
  requestId: string,
  cause: unknown
): Extract<SpreadsheetModelReviewWorkerResponse, { type: 'error' }> {
  if (cause instanceof SpreadsheetError) {
    return {
      type: 'error',
      requestId,
      code: cause.code,
      details: safeErrorDetails(cause.details)
    }
  }
  // Never copy an arbitrary thrown value, stack, or message across the trust
  // boundary. The stable contract identifier is enough to localize the error.
  return {
    type: 'error',
    requestId,
    code: 'adapter-contract-violation',
    details: Object.freeze({ contract: 'spreadsheet-model-review-worker' })
  }
}

export function handleSpreadsheetModelReviewRequest(
  request: SpreadsheetModelReviewRunRequest,
  post: (response: SpreadsheetModelReviewWorkerResponse) => void,
  isCancelled: () => boolean = () => false
): void {
  try {
    const result = computeSpreadsheetModelReview(request.input, {
      isCancelled,
      onProgress: (progress) => {
        if (!isCancelled()) {
          post({
            type: 'progress',
            requestId: request.requestId,
            progress
          })
        }
      }
    })
    if (!isCancelled()) {
      post({
        type: 'result',
        requestId: request.requestId,
        result
      })
    }
  } catch (cause) {
    if (!isCancelled()) post(workerError(request.requestId, cause))
  }
}

const workerScope = globalThis as unknown as Partial<SpreadsheetModelReviewWorkerScope>
if (
  typeof workerScope.addEventListener === 'function' &&
  typeof workerScope.postMessage === 'function' &&
  typeof document === 'undefined'
) {
  const cancelled = new Set<string>()
  workerScope.addEventListener('message', (event) => {
    const request = event.data
    if (request.type === 'cancel') {
      cancelled.add(request.requestId)
      return
    }
    cancelled.delete(request.requestId)
    handleSpreadsheetModelReviewRequest(
      request,
      (response) => workerScope.postMessage?.(response),
      () => cancelled.has(request.requestId)
    )
    cancelled.delete(request.requestId)
  })
}
