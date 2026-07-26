import SpreadsheetModelReviewWorker from './modelReview.worker?worker&inline'

import { SpreadsheetError, type SpreadsheetErrorCode } from './errors'
import type {
  SpreadsheetModelReviewInput,
  SpreadsheetModelReviewProgress,
  SpreadsheetModelReviewResult,
  SpreadsheetModelReviewWorkerRequest
} from './modelReviewProtocol'
import { SPREADSHEET_MODEL_REVIEW_STAGE_COUNT } from './modelReviewProtocol'

export interface SpreadsheetModelReviewWorkerLike {
  postMessage(message: SpreadsheetModelReviewWorkerRequest): void
  terminate(): void
  addEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void
  addEventListener(type: 'error', listener: (event: ErrorEvent) => void): void
  removeEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void
  removeEventListener(type: 'error', listener: (event: ErrorEvent) => void): void
}

export type SpreadsheetModelReviewWorkerFactory = () => SpreadsheetModelReviewWorkerLike

export interface RunSpreadsheetModelReviewOptions {
  readonly signal?: AbortSignal
  readonly onProgress?: (progress: SpreadsheetModelReviewProgress) => void
  readonly workerFactory?: SpreadsheetModelReviewWorkerFactory
}

const KNOWN_ERROR_CODES = new Set<SpreadsheetErrorCode>([
  'unsupported-format',
  'legacy-excel-format',
  'macro-enabled-format',
  'encrypted-workbook',
  'malformed-csv',
  'invalid-utf8',
  'malformed-zip',
  'zip64-unsupported',
  'multi-disk-zip',
  'unsupported-compression',
  'unsafe-zip-path',
  'duplicate-zip-entry',
  'macro-content',
  'missing-xlsx-part',
  'compressed-size-limit',
  'uncompressed-size-limit',
  'worksheet-limit',
  'row-limit',
  'column-limit',
  'cell-count-limit',
  'cell-length-limit',
  'node-process-limit',
  'node-transaction-limit',
  'formula-without-cache',
  'parse-cancelled',
  'adapter-contract-violation',
  'invalid-mapping-preset',
  'blocking-validation',
  'transaction-failed'
])

let requestSequence = 0

function nextRequestId(): string {
  requestSequence += 1
  return `spreadsheet-review-${Date.now().toString(36)}-${requestSequence.toString(36)}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function safeResponseDetails(value: unknown): Readonly<Record<string, string | number | boolean>> {
  if (!isRecord(value)) return Object.freeze({})
  const result: Record<string, string | number | boolean> = {}
  for (const [key, detail] of Object.entries(value).slice(0, 24)) {
    if (!/^[a-zA-Z0-9_.-]{1,64}$/.test(key)) continue
    if (typeof detail === 'string') result[key] = detail.slice(0, 256)
    else if (typeof detail === 'boolean') result[key] = detail
    else if (typeof detail === 'number' && Number.isFinite(detail)) result[key] = detail
  }
  return Object.freeze(result)
}

function contractError(): SpreadsheetError {
  return new SpreadsheetError('adapter-contract-violation', {
    contract: 'spreadsheet-model-review-worker'
  })
}

export const createSpreadsheetModelReviewWorker: SpreadsheetModelReviewWorkerFactory = () =>
  new SpreadsheetModelReviewWorker({
    name: 'orbitpm-spreadsheet-model-review'
  })

/**
 * Runs one isolated review job. Callers should abort the previous invocation
 * before starting a replacement; a late response cannot resolve a different
 * invocation because every job owns both its request id and worker instance.
 */
export function runSpreadsheetModelReview(
  input: SpreadsheetModelReviewInput,
  options: RunSpreadsheetModelReviewOptions = {}
): Promise<SpreadsheetModelReviewResult> {
  if (options.signal?.aborted) {
    return Promise.reject(new SpreadsheetError('parse-cancelled'))
  }

  const worker = (options.workerFactory ?? createSpreadsheetModelReviewWorker)()
  const requestId = nextRequestId()

  return new Promise<SpreadsheetModelReviewResult>((resolve, reject) => {
    let settled = false

    const detach = (): void => {
      options.signal?.removeEventListener('abort', onAbort)
      worker.removeEventListener('message', onMessage)
      worker.removeEventListener('error', onError)
    }
    const finish = (callback: () => void): void => {
      if (settled) return
      settled = true
      detach()
      worker.terminate()
      callback()
    }
    const onAbort = (): void => {
      if (settled) return
      settled = true
      detach()
      try {
        worker.postMessage({ type: 'cancel', requestId })
      } catch {
        // Termination below is the authoritative cancellation mechanism.
      }
      worker.terminate()
      reject(new SpreadsheetError('parse-cancelled'))
    }
    const onMessage = (event: MessageEvent<unknown>): void => {
      if (settled || !isRecord(event.data)) return
      const response = event.data
      if (response.requestId !== requestId) return
      if (response.type === 'progress') {
        if (!isRecord(response.progress)) {
          finish(() => reject(contractError()))
          return
        }
        const { phase, completed, total } = response.progress
        if (
          ![
            'build-model',
            'apply-destination',
            'infer-graph',
            'apply-inference',
            'validate-model'
          ].includes(String(phase)) ||
          typeof completed !== 'number' ||
          !Number.isInteger(completed) ||
          completed < 0 ||
          completed > SPREADSHEET_MODEL_REVIEW_STAGE_COUNT ||
          typeof total !== 'number' ||
          total !== SPREADSHEET_MODEL_REVIEW_STAGE_COUNT
        ) {
          finish(() => reject(contractError()))
          return
        }
        options.onProgress?.(response.progress as unknown as SpreadsheetModelReviewProgress)
        return
      }
      if (response.type === 'error') {
        if (
          typeof response.code !== 'string' ||
          !KNOWN_ERROR_CODES.has(response.code as SpreadsheetErrorCode)
        ) {
          finish(() => reject(contractError()))
          return
        }
        finish(() =>
          reject(
            new SpreadsheetError(response.code as SpreadsheetErrorCode, {
              ...safeResponseDetails(response.details)
            })
          )
        )
        return
      }
      if (response.type === 'result' && isRecord(response.result)) {
        finish(() => resolve(response.result as unknown as SpreadsheetModelReviewResult))
        return
      }
      finish(() => reject(contractError()))
    }
    const onError = (): void => {
      finish(() => reject(contractError()))
    }

    options.signal?.addEventListener('abort', onAbort, { once: true })
    worker.addEventListener('message', onMessage)
    worker.addEventListener('error', onError)
    if (options.signal?.aborted) {
      onAbort()
      return
    }
    try {
      worker.postMessage({
        type: 'review',
        requestId,
        input
      })
    } catch {
      finish(() => reject(contractError()))
    }
  })
}
