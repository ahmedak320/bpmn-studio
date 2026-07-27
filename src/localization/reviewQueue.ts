import type {
  ReviewedXmlIngestionReviewer,
  ReviewedXmlIngestionReviewRequest,
  ReviewedXmlIngestionReviewResult
} from './xmlIngestion'

interface PendingReview {
  readonly request: ReviewedXmlIngestionReviewRequest
  readonly signal?: AbortSignal
  readonly resolve: (result: ReviewedXmlIngestionReviewResult) => void
  abortListener?: () => void
  settled: boolean
}

export type ReviewedXmlReviewQueueListener = (
  request: ReviewedXmlIngestionReviewRequest | null
) => void

/**
 * Serializes every ingestion boundary through one visible, awaited dialog.
 * Cancellation resolves fail-closed and never rejects a caller merely because
 * its tab, workspace, or enclosing operation was superseded.
 */
export class ReviewedXmlReviewQueue {
  readonly #onActiveChange: ReviewedXmlReviewQueueListener
  readonly #pending: PendingReview[] = []
  #active: PendingReview | null = null
  #disposed = false
  #cancelling = false

  constructor(onActiveChange: ReviewedXmlReviewQueueListener) {
    this.#onActiveChange = onActiveChange
  }

  get activeRequest(): ReviewedXmlIngestionReviewRequest | null {
    return this.#active?.request ?? null
  }

  readonly review: ReviewedXmlIngestionReviewer = (request, context) => {
    if (this.#disposed || context.signal?.aborted) {
      return Promise.resolve({ status: 'cancelled' })
    }

    return new Promise<ReviewedXmlIngestionReviewResult>((resolve) => {
      const pending: PendingReview = {
        request,
        signal: context.signal,
        resolve,
        settled: false
      }
      if (context.signal) {
        pending.abortListener = () => {
          this.#settle(pending, { status: 'cancelled' })
        }
        context.signal.addEventListener('abort', pending.abortListener, { once: true })
      }
      this.#pending.push(pending)
      this.#pump()
    })
  }

  decide(result: ReviewedXmlIngestionReviewResult): boolean {
    const active = this.#active
    if (!active) return false
    if (result.status === 'completed' && result.reviewDigest !== active.request.reviewDigest) {
      this.#settle(active, { status: 'cancelled' })
      return false
    }
    this.#settle(active, result)
    return true
  }

  cancelAll(): void {
    if (this.#active === null && this.#pending.length === 0) {
      this.#onActiveChange(null)
      return
    }
    this.#cancelling = true
    const all = [
      ...(this.#active ? [this.#active] : []),
      ...this.#pending.filter((candidate) => candidate !== this.#active)
    ]
    this.#active = null
    this.#pending.length = 0
    for (const pending of all) {
      if (pending.settled) continue
      pending.settled = true
      this.#removeAbortListener(pending)
      pending.resolve({ status: 'cancelled' })
    }
    this.#cancelling = false
    this.#onActiveChange(null)
  }

  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    this.cancelAll()
  }

  #removeAbortListener(pending: PendingReview): void {
    if (pending.signal && pending.abortListener) {
      pending.signal.removeEventListener('abort', pending.abortListener)
    }
    pending.abortListener = undefined
  }

  #settle(pending: PendingReview, result: ReviewedXmlIngestionReviewResult): void {
    if (pending.settled) return
    pending.settled = true
    this.#removeAbortListener(pending)
    if (this.#active === pending) {
      this.#active = null
    } else {
      const index = this.#pending.indexOf(pending)
      if (index >= 0) this.#pending.splice(index, 1)
    }
    pending.resolve(result)
    if (!this.#cancelling) this.#pump()
  }

  #pump(): void {
    if (this.#disposed || this.#active) return
    while (this.#pending.length > 0) {
      const pending = this.#pending.shift()!
      if (pending.settled) continue
      if (pending.signal?.aborted) {
        pending.settled = true
        this.#removeAbortListener(pending)
        pending.resolve({ status: 'cancelled' })
        continue
      }
      this.#active = pending
      this.#onActiveChange(pending.request)
      return
    }
    this.#onActiveChange(null)
  }
}
