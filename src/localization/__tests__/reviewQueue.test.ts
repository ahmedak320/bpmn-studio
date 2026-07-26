import { describe, expect, it, vi } from 'vitest'

import { ReviewedXmlReviewQueue, type ReviewedXmlReviewQueueListener } from '../reviewQueue'
import type {
  ReviewedXmlIngestionReviewRequest,
  ReviewedXmlIngestionReviewResult
} from '../xmlIngestion'

function request(digest: string): ReviewedXmlIngestionReviewRequest {
  return {
    version: 1,
    source: 'xml',
    target: 'ar',
    originalXml: '<xml />',
    originalDigest: `original-${digest}`,
    reviewDigest: digest,
    knownProcessIds: [],
    resources: { glossary: [], translationMemory: [] },
    validation: {} as ReviewedXmlIngestionReviewRequest['validation'],
    ingestion: {} as ReviewedXmlIngestionReviewRequest['ingestion'],
    queue: []
  }
}

function completed(digest: string): ReviewedXmlIngestionReviewResult {
  return { status: 'completed', reviewDigest: digest, edits: [] }
}

describe('ReviewedXmlReviewQueue', () => {
  it('serializes reviews and advances only after an explicit decision', async () => {
    const active: Array<string | null> = []
    const queue = new ReviewedXmlReviewQueue((current) =>
      active.push(current?.reviewDigest ?? null)
    )
    const first = queue.review(request('one'), {})
    const second = queue.review(request('two'), {})

    expect(queue.activeRequest?.reviewDigest).toBe('one')
    expect(active).toEqual(['one'])
    expect(queue.decide(completed('one'))).toBe(true)
    await expect(first).resolves.toEqual(completed('one'))
    expect(queue.activeRequest?.reviewDigest).toBe('two')
    expect(queue.decide({ status: 'cancelled' })).toBe(true)
    await expect(second).resolves.toEqual({ status: 'cancelled' })
    expect(active).toEqual(['one', 'two', null])
  })

  it('cancels an active or queued request when its operation signal aborts', async () => {
    const listener = vi.fn<ReviewedXmlReviewQueueListener>()
    const queue = new ReviewedXmlReviewQueue(listener)
    const activeController = new AbortController()
    const queuedController = new AbortController()
    const first = queue.review(request('one'), { signal: activeController.signal })
    const second = queue.review(request('two'), { signal: queuedController.signal })

    queuedController.abort()
    await expect(second).resolves.toEqual({ status: 'cancelled' })
    expect(queue.activeRequest?.reviewDigest).toBe('one')

    activeController.abort()
    await expect(first).resolves.toEqual({ status: 'cancelled' })
    expect(queue.activeRequest).toBeNull()
    expect(listener).toHaveBeenLastCalledWith(null)
  })

  it('cancels every waiter on workspace replacement or disposal', async () => {
    const listener = vi.fn<ReviewedXmlReviewQueueListener>()
    const queue = new ReviewedXmlReviewQueue(listener)
    const first = queue.review(request('one'), {})
    const second = queue.review(request('two'), {})

    queue.cancelAll()
    await expect(first).resolves.toEqual({ status: 'cancelled' })
    await expect(second).resolves.toEqual({ status: 'cancelled' })
    expect(queue.activeRequest).toBeNull()

    queue.dispose()
    await expect(queue.review(request('three'), {})).resolves.toEqual({
      status: 'cancelled'
    })
  })

  it('fails closed when a completed decision echoes the wrong digest', async () => {
    const queue = new ReviewedXmlReviewQueue(() => undefined)
    const result = queue.review(request('current'), {})

    expect(queue.decide(completed('stale'))).toBe(false)
    await expect(result).resolves.toEqual({ status: 'cancelled' })
    expect(queue.activeRequest).toBeNull()
  })
})
