import { describe, expect, it, vi } from 'vitest'

import {
  runSpreadsheetModelReview,
  type SpreadsheetModelReviewWorkerFactory,
  type SpreadsheetModelReviewWorkerLike
} from './browserModelReview'
import { SpreadsheetError } from './errors'
import type {
  SpreadsheetModelReviewInput,
  SpreadsheetModelReviewResult,
  SpreadsheetModelReviewWorkerRequest
} from './modelReviewProtocol'

class FakeWorker implements SpreadsheetModelReviewWorkerLike {
  readonly posted: SpreadsheetModelReviewWorkerRequest[] = []
  terminated = false
  private readonly messages = new Set<(event: MessageEvent<unknown>) => void>()
  private readonly errors = new Set<(event: ErrorEvent) => void>()

  postMessage(message: SpreadsheetModelReviewWorkerRequest): void {
    this.posted.push(message)
  }

  terminate(): void {
    this.terminated = true
  }

  addEventListener(
    type: 'message' | 'error',
    listener: ((event: MessageEvent<unknown>) => void) | ((event: ErrorEvent) => void)
  ): void {
    if (type === 'message') {
      this.messages.add(listener as (event: MessageEvent<unknown>) => void)
    } else {
      this.errors.add(listener as (event: ErrorEvent) => void)
    }
  }

  removeEventListener(
    type: 'message' | 'error',
    listener: ((event: MessageEvent<unknown>) => void) | ((event: ErrorEvent) => void)
  ): void {
    if (type === 'message') {
      this.messages.delete(listener as (event: MessageEvent<unknown>) => void)
    } else {
      this.errors.delete(listener as (event: ErrorEvent) => void)
    }
  }

  respond(data: unknown): void {
    for (const listener of this.messages) {
      listener({ data } as MessageEvent<unknown>)
    }
  }

  crash(): void {
    for (const listener of this.errors) {
      listener({ message: 'private worker failure' } as ErrorEvent)
    }
  }
}

const unusedInput = {} as SpreadsheetModelReviewInput

function result(label: string): SpreadsheetModelReviewResult {
  return { label } as unknown as SpreadsheetModelReviewResult
}

function factory(worker: FakeWorker): SpreadsheetModelReviewWorkerFactory {
  return () => worker
}

describe('browser spreadsheet model review boundary', () => {
  it('forwards measurable progress, resolves its matching result, and terminates', async () => {
    const worker = new FakeWorker()
    const onProgress = vi.fn()
    const pending = runSpreadsheetModelReview(unusedInput, {
      workerFactory: factory(worker),
      onProgress
    })
    const request = worker.posted[0]
    expect(request?.type).toBe('review')
    const requestId = request!.requestId

    worker.respond({
      type: 'progress',
      requestId,
      progress: { phase: 'infer-graph', completed: 2, total: 5 }
    })
    worker.respond({
      type: 'result',
      requestId,
      result: result('current')
    })

    await expect(pending).resolves.toEqual({ label: 'current' })
    expect(onProgress).toHaveBeenCalledWith({
      phase: 'infer-graph',
      completed: 2,
      total: 5
    })
    expect(worker.terminated).toBe(true)
  })

  it('terminates on abort and ignores every response emitted after cancellation', async () => {
    const worker = new FakeWorker()
    const controller = new AbortController()
    const onProgress = vi.fn()
    const pending = runSpreadsheetModelReview(unusedInput, {
      workerFactory: factory(worker),
      signal: controller.signal,
      onProgress
    })
    const request = worker.posted[0]!

    controller.abort()
    await expect(pending).rejects.toMatchObject({
      code: 'parse-cancelled'
    } satisfies Partial<SpreadsheetError>)
    expect(worker.posted.at(-1)).toEqual({
      type: 'cancel',
      requestId: request.requestId
    })
    expect(worker.terminated).toBe(true)

    worker.respond({
      type: 'progress',
      requestId: request.requestId,
      progress: { phase: 'validate-model', completed: 5, total: 5 }
    })
    worker.respond({
      type: 'result',
      requestId: request.requestId,
      result: result('late')
    })
    expect(onProgress).not.toHaveBeenCalled()
  })

  it('ignores a stale request id and accepts only the current job response', async () => {
    const worker = new FakeWorker()
    const pending = runSpreadsheetModelReview(unusedInput, {
      workerFactory: factory(worker)
    })
    const request = worker.posted[0]!

    worker.respond({
      type: 'result',
      requestId: `${request.requestId}-stale`,
      result: result('stale')
    })
    expect(worker.terminated).toBe(false)

    worker.respond({
      type: 'result',
      requestId: request.requestId,
      result: result('fresh')
    })
    await expect(pending).resolves.toEqual({ label: 'fresh' })
    expect(worker.terminated).toBe(true)
  })

  it('turns worker crashes and untrusted error codes into a data-free contract error', async () => {
    const crashedWorker = new FakeWorker()
    const crashed = runSpreadsheetModelReview(unusedInput, {
      workerFactory: factory(crashedWorker)
    })
    crashedWorker.crash()
    await expect(crashed).rejects.toMatchObject({
      code: 'adapter-contract-violation',
      details: { contract: 'spreadsheet-model-review-worker' }
    })

    const malformedWorker = new FakeWorker()
    const malformed = runSpreadsheetModelReview(unusedInput, {
      workerFactory: factory(malformedWorker)
    })
    const request = malformedWorker.posted[0]!
    malformedWorker.respond({
      type: 'error',
      requestId: request.requestId,
      code: 'private-secret-code',
      details: { message: 'private row contents' }
    })
    await expect(malformed).rejects.toMatchObject({
      code: 'adapter-contract-violation',
      details: { contract: 'spreadsheet-model-review-worker' }
    })
  })

  it('does not allocate a worker for an already-aborted request', async () => {
    const workerFactory = vi.fn<SpreadsheetModelReviewWorkerFactory>()
    const controller = new AbortController()
    controller.abort()

    await expect(
      runSpreadsheetModelReview(unusedInput, {
        workerFactory,
        signal: controller.signal
      })
    ).rejects.toMatchObject({ code: 'parse-cancelled' })
    expect(workerFactory).not.toHaveBeenCalled()
  })
})
